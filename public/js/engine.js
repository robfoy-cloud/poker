// The game engine: Texas Hold'em rules, no-limit betting, side pots.
// It talks to the outside world through `io` (UI, coach, bots), so it can also run headless in tests.

import { newDeck, shuffle, evaluate, SUITS } from './cards.js';

export const STREETS = ['preflop', 'flop', 'turn', 'river'];

export class Game {
  constructor(opts, io) {
    this.opts = opts; // { players: [{name, isHuman, style}], stack, sb, bb }
    this.io = io;
    this.players = opts.players.map((p, i) => ({
      seat: i, name: p.name, isHuman: !!p.isHuman, style: p.style || null,
      stack: opts.stack, hole: [], folded: false, allIn: false, out: false,
      bet: 0, totalIn: 0, lastAction: '', shown: false,
      stats: { hands: 0, vpip: 0, raises: 0, calls: 0, folds: 0, checks: 0 },
    }));
    this.sb = opts.sb; this.bb = opts.bb;
    this.button = -1;
    this.handNo = 0;
    this.board = []; this.burned = [];
    this.pot = 0;
    this.street = null;
    this.currentBet = 0; this.lastFullRaise = opts.bb;
    this.preflopRaiser = null;
    this.raisesThisStreet = 0;
    this.log = [];
    this.over = false;
  }

  // ---------- helpers ----------
  get n() { return this.players.length; }
  live() { return this.players.filter(p => !p.out); }
  inHand() { return this.players.filter(p => !p.out && !p.folded); }
  canAct() { return this.players.filter(p => !p.out && !p.folded && !p.allIn); }
  nextSeat(from, pred) {
    for (let k = 1; k <= this.n; k++) {
      const s = (from + k) % this.n;
      if (pred(this.players[s])) return s;
    }
    return -1;
  }
  seatFrom(from, pred) { // inclusive
    for (let k = 0; k < this.n; k++) {
      const s = (from + k) % this.n;
      if (pred(this.players[s])) return s;
    }
    return -1;
  }
  totalPot() { return this.pot + this.players.reduce((t, p) => t + p.bet, 0); }
  human() { return this.players.find(p => p.isHuman); }

  // Position names for the current hand, keyed by seat.
  positions() {
    const live = [];
    let s = this.button;
    for (let k = 0; k < this.n; k++) {
      const q = this.players[(s + k) % this.n];
      if (!q.out) live.push(q.seat);
    }
    const names = {};
    const m = live.length;
    if (m === 2) { names[live[0]] = 'BTN/SB'; names[live[1]] = 'BB'; return names; }
    names[live[0]] = 'BTN'; names[live[1]] = 'SB'; names[live[2]] = 'BB';
    const restNames = {
      1: ['UTG'], 2: ['UTG', 'CO'], 3: ['UTG', 'HJ', 'CO'], 4: ['UTG', 'MP', 'HJ', 'CO'],
      5: ['UTG', 'UTG+1', 'MP', 'HJ', 'CO'], 6: ['UTG', 'UTG+1', 'UTG+2', 'MP', 'HJ', 'CO'],
    }[m - 3] || [];
    for (let i = 3; i < m; i++) names[live[i]] = restNames[i - 3];
    return names;
  }

  put(p, amount) {
    amount = Math.min(amount, p.stack);
    p.stack -= amount; p.bet += amount; p.totalIn += amount;
    if (p.stack === 0) p.allIn = true;
    return amount;
  }

  async emit(type, data = {}) {
    this.log.push({ type, ...data });
    if (this.io.event) await this.io.event(type, data, this);
  }

  // ---------- a whole hand ----------
  async playHand() {
    if (this.over) return;
    this.handNo++;
    for (const p of this.players) {
      Object.assign(p, { hole: [], folded: p.out, allIn: false, bet: 0, totalIn: 0, lastAction: '', shown: false, best: null });
      if (!p.out) p.stats.hands++;
    }
    this.board = []; this.burned = []; this.pot = 0; this.winners = null;
    this.preflopRaiser = null; this.street = 'preflop';

    // Button
    if (this.button < 0) await this.dealForButton();
    else this.button = this.nextSeat(this.button, p => !p.out);
    const live = this.live();
    const headsUp = live.length === 2;
    this.sbSeat = headsUp ? this.button : this.nextSeat(this.button, p => !p.out);
    this.bbSeat = this.nextSeat(this.sbSeat, p => !p.out);
    await this.emit('newHand', { handNo: this.handNo, button: this.button, sbSeat: this.sbSeat, bbSeat: this.bbSeat, headsUp, positions: this.positions() });

    // Blinds
    await this.postBlind(this.players[this.sbSeat], this.sb, 'small');
    await this.postBlind(this.players[this.bbSeat], this.bb, 'big');
    this.currentBet = this.bb; this.lastFullRaise = this.bb; this.raisesThisStreet = 0;

    // Shuffle and deal
    this.deck = shuffle(newDeck());
    const firstSeat = this.nextSeat(this.button, p => !p.out);
    const dealer = this.players[this.button];
    if (dealer.isHuman) await this.humanDealerStep('firstCard', firstSeat);
    await this.emit('dealing', { firstSeat, dealer: this.button });
    for (let round = 0; round < 2; round++) {
      let s = firstSeat;
      for (let k = 0; k < live.length; k++) {
        this.players[s].hole.push(this.deck.pop());
        s = this.nextSeat(s, p => !p.out);
      }
    }
    await this.emit('dealt', {});

    // Pre-flop betting: first to act is left of the big blind.
    const first = this.nextSeat(this.bbSeat, p => !p.out);
    let result = await this.bettingRound(first);
    if (result.reason === 'folds') return this.winUncontested();

    for (const street of ['flop', 'turn', 'river']) {
      await this.collectBets();
      this.street = street;
      if (dealer.isHuman) await this.humanDealerStep(street);
      this.burned.push(this.deck.pop());
      await this.emit('burn', { street });
      const count = street === 'flop' ? 3 : 1;
      for (let i = 0; i < count; i++) this.board.push(this.deck.pop());
      this.currentBet = 0; this.lastFullRaise = this.bb; this.raisesThisStreet = 0; this.streetAggressor = null;
      for (const p of this.players) p.lastAction = p.folded || p.out ? p.lastAction : (p.allIn ? 'All-in' : '');
      const bettingPossible = this.canAct().length >= 2;
      await this.emit('street', { street, cards: this.board.slice(-count), bettingPossible });
      if (bettingPossible) {
        const firstPost = this.nextSeat(this.button, p => !p.out && !p.folded && !p.allIn);
        result = await this.bettingRound(firstPost);
        if (result.reason === 'folds') return this.winUncontested();
      }
    }
    await this.collectBets();
    return this.showdown();
  }

  async dealForButton() {
    const deck = shuffle(newDeck());
    const draws = [];
    for (const p of this.live()) draws.push({ seat: p.seat, card: deck.pop() });
    const suitRank = c => 4 - SUITS.indexOf(c.s); // spades high, then hearts, diamonds, clubs
    draws.sort((a, b) => (b.card.r - a.card.r) || (suitRank(b.card) - suitRank(a.card)));
    this.button = draws[0].seat;
    await this.emit('dealForButton', { draws, button: this.button });
  }

  async postBlind(p, amount, which) {
    const need = Math.min(amount, p.stack);
    if (p.isHuman && this.io.humanPost) {
      for (;;) {
        const pushed = await this.io.humanPost({ which, amount: need, player: p, game: this });
        if (pushed === need) break;
        await this.emit('mistake', { kind: 'wrongBlind', which, pushed, need });
      }
    }
    this.put(p, need);
    p.lastAction = which === 'small' ? 'SB' : 'BB';
    await this.emit('blind', { seat: p.seat, which, amount: need, allIn: p.allIn });
  }

  async humanDealerStep(step, correct) {
    if (!this.io.dealerStep) return;
    if (step === 'firstCard') {
      for (;;) {
        const seat = await this.io.dealerStep({ step, game: this });
        if (seat === correct) { await this.emit('dealerOk', { step }); return; }
        await this.emit('mistake', { kind: 'dealFirst', chosen: seat, correct });
      }
    }
    // flop / turn / river: must burn first, then deal the right number of cards.
    for (;;) {
      const choice = await this.io.dealerStep({ step: step + ':first', street: step, game: this });
      if (choice === 'burn') break;
      await this.emit('mistake', { kind: 'noBurn', street: step });
    }
    for (;;) {
      const count = await this.io.dealerStep({ step: step + ':count', street: step, game: this });
      const right = step === 'flop' ? 3 : 1;
      if (count === right) { await this.emit('dealerOk', { step }); return; }
      await this.emit('mistake', { kind: 'dealCount', street: step, count, right });
    }
  }

  async collectBets() {
    const total = this.players.reduce((t, p) => t + p.bet, 0);
    if (total === 0) return;
    this.pot += total;
    for (const p of this.players) p.bet = 0;
    await this.emit('collect', { amount: total, pot: this.pot });
  }

  // ---------- betting ----------
  async bettingRound(startSeat) {
    const needs = new Set(this.canAct().map(p => p.seat));
    const cannotRaise = new Set();
    let seat = startSeat;
    let anyBet = this.street === 'preflop';
    let lastAggressor = this.street === 'preflop' ? this.bbSeat : null;
    let voluntaryRaise = false;
    let closer = null;

    for (;;) {
      if (this.inHand().length === 1) break;
      if (needs.size === 0) break;
      seat = this.seatFrom(seat, q => needs.has(q.seat));
      const p = this.players[seat];
      const others = this.canAct().filter(q => q !== p);
      if (others.length === 0 && p.bet >= this.currentBet) { needs.delete(seat); continue; }

      const ctx = this.actionContext(p, cannotRaise.has(seat));
      await this.emit('turn', { seat, ctx });
      const act = p.isHuman ? await this.humanTurn(p, ctx) : this.sanitize(await this.io.botAction(p, ctx, this), p, ctx);
      const label = this.applyAction(p, act, ctx);
      needs.delete(seat);
      if (act.type === 'raise') {
        const increment = act.to - ctx.currentBet;
        this.raisesThisStreet++;
        if (this.street === 'preflop') { this.preflopRaiser = seat; voluntaryRaise = true; }
        lastAggressor = seat;
        anyBet = true;
        if (increment >= this.lastFullRaise) {
          this.lastFullRaise = increment;
          cannotRaise.clear();
          for (const q of this.canAct()) if (q !== p) needs.add(q.seat);
        } else {
          // An all-in for less than a full raise doesn't re-open the betting
          // for players who have already acted: they may only call or fold.
          for (const q of this.canAct()) if (q !== p && !needs.has(q.seat)) { needs.add(q.seat); cannotRaise.add(q.seat); }
        }
      }
      if (needs.size === 0 || this.inHand().length === 1) closer = seat;
      await this.emit('action', { seat, act, label, ctx, pot: this.totalPot() });
      seat = (seat + 1) % this.n;
    }

    let reason;
    if (this.inHand().length === 1) reason = 'folds';
    else if (this.canAct().length <= 1) reason = 'allin';
    else if (this.street === 'preflop' && !voluntaryRaise) reason = 'limped';
    else if (anyBet) reason = 'called';
    else reason = 'checked';
    this.streetAggressor = lastAggressor;
    await this.emit('roundEnd', { street: this.street, reason, closer, lastAggressor });
    return { reason };
  }

  // Make sure a bot's chosen action is legal.
  sanitize(act, p, ctx) {
    if (act.type === 'check' && !ctx.canCheck) act = { type: 'call' };
    if (act.type === 'fold' && ctx.canCheck) act = { type: 'check' };
    if (act.type === 'raise') {
      if (ctx.cannotRaise || ctx.maxTo <= ctx.currentBet) act = { type: ctx.canCheck ? 'check' : 'call' };
      else {
        let to = Math.round(act.to);
        if (to < ctx.minRaiseTo) to = ctx.minRaiseTo;
        if (to > ctx.maxTo) to = ctx.maxTo;
        act = { type: 'raise', to };
      }
    }
    if (act.type === 'call' && ctx.canCheck) act = { type: 'check' };
    return act;
  }

  actionContext(p, cannotRaise) {
    const toCall = Math.max(0, this.currentBet - p.bet);
    const minRaiseTo = this.currentBet === 0 ? this.bb : this.currentBet + this.lastFullRaise;
    return {
      seat: p.seat, street: this.street, toCall: Math.min(toCall, p.stack), fullToCall: toCall,
      currentBet: this.currentBet, minRaiseTo, maxTo: p.bet + p.stack, stack: p.stack, myBet: p.bet,
      canCheck: toCall === 0, cannotRaise, pot: this.totalPot(), raisesThisStreet: this.raisesThisStreet,
      bb: this.bb,
    };
  }

  // Human acts by pushing chips (or folding / checking). We check the maths and the rules.
  async humanTurn(p, ctx) {
    let warnedFold = false;
    for (;;) {
      const r = await this.io.humanAction({ ...ctx, warnedFold }, this);
      if (r.type === 'fold') {
        if (ctx.canCheck && !warnedFold) { warnedFold = true; await this.emit('mistake', { kind: 'foldFree' }); continue; }
        return { type: 'fold' };
      }
      let amount = r.type === 'check' ? 0 : r.amount;
      if (amount === 0) {
        if (ctx.canCheck) return { type: 'check' };
        await this.emit('mistake', { kind: 'checkFacingBet', toCall: ctx.toCall });
        continue;
      }
      if (amount > p.stack) amount = p.stack;
      const allIn = amount === p.stack;
      if (amount < ctx.toCall && !allIn) { await this.emit('mistake', { kind: 'short', pushed: amount, toCall: ctx.toCall }); continue; }
      if (amount <= ctx.toCall) return { type: 'call', amount };
      if (ctx.cannotRaise) {
        await this.emit('mistake', { kind: 'cannotRaise', pushed: amount, toCall: ctx.toCall });
        continue;
      }
      const to = p.bet + amount;
      if (to < ctx.minRaiseTo && !allIn) {
        await this.emit('mistake', { kind: 'smallRaise', pushed: amount, to, minRaiseTo: ctx.minRaiseTo, toCall: ctx.toCall, currentBet: ctx.currentBet });
        continue;
      }
      return { type: 'raise', to };
    }
  }

  applyAction(p, act, ctx) {
    const pre = this.street === 'preflop';
    let label;
    if (act.type === 'fold') {
      p.folded = true; label = 'Fold'; p.stats.folds++;
    } else if (act.type === 'check') {
      label = 'Check'; p.stats.checks++;
    } else if (act.type === 'call') {
      const amt = this.put(p, ctx.toCall);
      label = p.allIn ? 'All-in' : 'Call';
      p.stats.calls++;
      if (pre && p.vpipThisHand !== this.handNo) { p.vpipThisHand = this.handNo; p.stats.vpip++; }
      act.amount = amt;
    } else if (act.type === 'raise') {
      let to = Math.min(act.to, p.bet + p.stack);
      act.to = to;
      this.put(p, to - p.bet);
      this.currentBet = Math.max(this.currentBet, to);
      label = p.allIn ? 'All-in' : (ctx.currentBet === 0 ? 'Bet' : 'Raise');
      p.stats.raises++;
      if (pre && p.vpipThisHand !== this.handNo) { p.vpipThisHand = this.handNo; p.stats.vpip++; }
    }
    p.lastAction = label;
    return label;
  }

  // ---------- endings ----------
  async winUncontested() {
    await this.collectBets();
    const w = this.inHand()[0];
    const amount = this.pot;
    w.stack += amount; this.pot = 0;
    this.winners = [{ seat: w.seat, amount }];
    await this.emit('winUncontested', { seat: w.seat, amount });
    return this.endHand();
  }

  buildPots() {
    const contenders = this.inHand();
    const levels = [...new Set(contenders.map(p => p.totalIn))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    levels.forEach((L, idx) => {
      let amount = 0;
      for (const p of this.players) amount += Math.min(p.totalIn, L) - Math.min(p.totalIn, prev);
      if (idx === levels.length - 1) for (const p of this.players) amount += Math.max(0, p.totalIn - L); // dead money above
      const eligible = contenders.filter(p => p.totalIn >= L).map(p => p.seat);
      if (amount > 0) {
        const last = pots[pots.length - 1];
        if (last && last.eligible.length === eligible.length) last.amount += amount;
        else pots.push({ amount, eligible });
      }
      prev = L;
    });
    return pots;
  }

  async showdown() {
    this.street = 'showdown';
    const contenders = this.inHand();
    for (const p of contenders) { p.best = evaluate([...p.hole, ...this.board]); p.shown = true; }
    // Who shows first: last aggressor on the river, otherwise first player left of the button.
    let firstShow = this.streetAggressor != null && !this.players[this.streetAggressor].folded ? this.streetAggressor
      : this.nextSeat(this.button, p => !p.out && !p.folded);
    const order = [];
    let s = firstShow;
    for (let k = 0; k < contenders.length; k++) { order.push(s); s = this.nextSeat(s, p => !p.out && !p.folded); }
    const pots = this.buildPots();
    const results = [];
    const won = {};
    pots.forEach((pot, i) => {
      const elig = pot.eligible.map(x => this.players[x]);
      const best = Math.max(...elig.map(p => p.best.score));
      const ws = elig.filter(p => p.best.score === best);
      // odd chips go to the first winner to the left of the button
      ws.sort((a, b) => ((a.seat - this.button - 1 + this.n) % this.n) - ((b.seat - this.button - 1 + this.n) % this.n));
      const share = Math.floor(pot.amount / ws.length);
      let odd = pot.amount - share * ws.length;
      for (const w of ws) {
        const amt = share + (odd > 0 ? 1 : 0); if (odd > 0) odd--;
        w.stack += amt; won[w.seat] = (won[w.seat] || 0) + amt;
      }
      results.push({ index: i, amount: pot.amount, eligible: pot.eligible, winners: ws.map(w => w.seat), hand: ws[0].best.name, split: ws.length > 1 });
    });
    this.pot = 0;
    this.winners = Object.entries(won).map(([seat, amount]) => ({ seat: +seat, amount }));
    await this.emit('showdown', { order, results, pots });
    return this.endHand();
  }

  async endHand() {
    const busted = [];
    for (const p of this.players) if (!p.out && p.stack === 0) { p.out = true; busted.push(p.seat); }
    const human = this.human();
    if ((human && human.out) || this.live().length < 2) this.over = true;
    await this.emit('handEnd', { busted, over: this.over, winners: this.winners });
  }
}
