// A blackjack round, start to finish. Talks to the screen and coach through `io`,
// so it can also run on its own in tests.

import { Shoe, RULES, handValue, isBlackjack, isPair, cardValue, bestAction } from './rules.js';

export class BJGame {
  constructor(opts, io) {
    this.opts = opts; // { players: [{name, isHuman, style}], stack, surrender }
    this.io = io;
    this.shoe = new Shoe();
    this.discards = 0;
    this.seats = opts.players.map((p, i) => ({ index: i, name: p.name, isHuman: !!p.isHuman, style: p.style || 'book', stack: opts.stack, hands: [], insurance: 0, out: false, lastBet: RULES.minBet }));
    this.dealer = { cards: [], hidden: true };
    this.round = 0;
    this.house = 0;  // what the casino has won overall (for checking the sums)
    this.over = false;
  }

  get human() { return this.seats.find(s => s.isHuman); }
  get up() { return this.dealer.cards[0]; }
  emit(type, data = {}) { return this.io.event ? this.io.event(type, data, this) : null; }
  draw() { return this.shoe.draw(); }

  async playRound() {
    if (this.over) return;
    this.round++;
    this.dealer = { cards: [], hidden: true };
    for (const s of this.seats) { s.hands = []; s.insurance = 0; if (!s.out && s.stack < RULES.minBet) s.out = true; }
    if (this.shoe.needsShuffle) { this.shoe.reshuffle(); this.discards = 0; await this.emit('shuffle'); }
    if (this.shoe.fresh) { this.shoe.fresh = false; this.draw(); this.discards++; await this.emit('burn'); }
    await this.emit('roundStart', { round: this.round });

    // ---- bets ----
    const playing = this.seats.filter(s => !s.out);
    for (const s of playing) {
      const ctx = { min: RULES.minBet, max: Math.min(RULES.maxBet, s.stack), stack: s.stack, last: s.lastBet };
      let bet = s.isHuman ? await this.io.humanBet(s, ctx, this) : this.botBet(s);
      bet = Math.max(RULES.minBet, Math.min(bet, ctx.max));
      s.stack -= bet; s.lastBet = bet;
      s.hands = [this.newHand(bet)];
      await this.emit('bet', { seat: s, bet });
    }

    // ---- deal: one card each from first base round to third base, then the dealer; twice ----
    await this.emit('dealStart', {});
    for (let r = 0; r < 2; r++) {
      for (const s of playing) { s.hands[0].cards.push(this.draw()); await this.emit('card', { seat: s, hand: s.hands[0], deal: true }); }
      this.dealer.cards.push(this.draw());
      await this.emit('dealerCard', { hole: r === 1, deal: true });
    }
    const upv = cardValue(this.up);

    // ---- insurance and the peek ----
    if (upv === 11) {
      await this.emit('insuranceOffer', {});
      for (const s of playing) {
        const max = Math.floor(s.hands[0].bet / 2);
        if (max < 1 || s.stack < max) continue;
        const take = s.isHuman ? await this.io.humanInsurance(s, { amount: max, blackjack: isBlackjack(s.hands[0].cards) }, this) : (s.style === 'hunch' && Math.random() < 0.4);
        if (take) { s.stack -= max; s.insurance = max; }
        await this.emit('insurance', { seat: s, took: !!take, amount: max });
      }
    }
    let dealerBJ = false;
    if (upv === 11 || upv === 10) {
      dealerBJ = isBlackjack(this.dealer.cards);
      await this.emit('peek', { dealerBJ });
    }
    if (dealerBJ) {
      this.dealer.hidden = false;
      await this.emit('reveal', { dealerBJ: true });
      return this.settle(true);
    }
    for (const s of playing) if (s.insurance) { this.house += s.insurance; await this.emit('insuranceLost', { seat: s, amount: s.insurance }); s.insurance = 0; }

    // ---- player blackjacks are paid at once ----
    for (const s of playing) {
      const h = s.hands[0];
      if (isBlackjack(h.cards)) {
        const win = Math.floor(h.bet * 1.5);
        h.done = true; h.result = 'blackjack'; h.won = win;
        s.stack += h.bet + win; this.house -= win;
        await this.emit('blackjack', { seat: s, hand: h, win });
      }
    }

    // ---- each player in turn ----
    for (const s of playing) {
      for (let i = 0; i < s.hands.length; i++) await this.playHand(s, i);
    }

    // ---- the dealer ----
    const live = playing.some(s => s.hands.some(h => !h.result));
    this.dealer.hidden = false;
    await this.emit('reveal', { dealerBJ: false, live });
    if (live) {
      while (handValue(this.dealer.cards).total < 17) {
        this.dealer.cards.push(this.draw());
        await this.emit('dealerCard', { hole: false, deal: false });
      }
    }
    await this.emit('dealerDone', { live });
    return this.settle(false);
  }

  newHand(bet) { return { cards: [], bet, doubled: false, done: false, fromSplit: false, splitAces: false, result: null, won: 0 }; }

  allowed(s, h) {
    const two = h.cards.length === 2;
    return {
      double: two && !h.splitAces && s.stack >= h.bet,
      split: two && isPair(h.cards) && s.hands.length < RULES.maxHands && s.stack >= h.bet && !h.splitAces,
      surrender: !!this.opts.surrender && two && !h.fromSplit && s.hands.length === 1,
    };
  }

  async playHand(s, i) {
    const h = s.hands[i];
    if (h.done) return;
    if (h.cards.length === 1) { h.cards.push(this.draw()); await this.emit('card', { seat: s, hand: h, splitCard: true }); }
    if (h.splitAces) { h.done = true; await this.emit('splitAcesDone', { seat: s, hand: h }); return; }
    const upv = cardValue(this.up);
    for (;;) {
      const v = handValue(h.cards);
      if (v.total >= 21) break;
      const allowed = this.allowed(s, h);
      const best = bestAction(h.cards, upv, allowed);
      const ctx = { seat: s, handIndex: i, hand: h, upv, allowed, best, hands: s.hands.length };
      await this.emit('turn', ctx);
      let act = s.isHuman ? await this.io.humanAction(s, ctx, this) : this.botAction(s, ctx);
      if ((act === 'double' && !allowed.double) || (act === 'split' && !allowed.split) || (act === 'surrender' && !allowed.surrender)) act = 'hit';
      await this.emit('action', { seat: s, hand: h, act, ctx });
      if (act === 'stand') break;
      if (act === 'surrender') {
        const back = Math.floor(h.bet / 2);
        s.stack += back; this.house += h.bet - back;
        h.result = 'surrender'; h.won = -(h.bet - back);
        await this.emit('surrendered', { seat: s, hand: h, back });
        break;
      }
      if (act === 'double') {
        s.stack -= h.bet; h.bet *= 2; h.doubled = true;
        h.cards.push(this.draw());
        await this.emit('card', { seat: s, hand: h, doubled: true });
        break;
      }
      if (act === 'split') {
        s.stack -= h.bet;
        const aces = h.cards[0].r === 14;
        const other = this.newHand(h.bet);
        other.cards.push(h.cards.pop());
        h.fromSplit = other.fromSplit = true;
        if (aces) h.splitAces = other.splitAces = true;
        s.hands.splice(i + 1, 0, other);
        await this.emit('split', { seat: s, hand: h, other, aces });
        h.cards.push(this.draw());
        await this.emit('card', { seat: s, hand: h, splitCard: true });
        if (aces) { h.done = true; await this.emit('splitAcesDone', { seat: s, hand: h }); return; }
        continue;
      }
      // hit
      h.cards.push(this.draw());
      await this.emit('card', { seat: s, hand: h });
    }
    const v = handValue(h.cards);
    if (v.total > 21 && !h.result) {
      h.result = 'bust'; h.won = -h.bet; this.house += h.bet;
      await this.emit('bust', { seat: s, hand: h });
    }
    h.done = true;
  }

  async settle(dealerBJ) {
    const d = handValue(this.dealer.cards);
    const results = [];
    for (const s of this.seats.filter(x => x.hands.length)) {
      if (s.insurance) {
        const win = s.insurance * 2;
        s.stack += s.insurance + win; this.house -= win;
        results.push({ seat: s, insurance: win });
        s.insurance = 0;
      }
      for (const h of s.hands) {
        if (!h.result) {
          const v = handValue(h.cards);
          const pBJ = isBlackjack(h.cards, h.fromSplit);
          if (dealerBJ) { if (pBJ) { h.result = 'push'; s.stack += h.bet; } else { h.result = 'lose'; h.won = -h.bet; this.house += h.bet; } }
          else if (d.total > 21 || v.total > d.total) { h.result = 'win'; h.won = h.bet; s.stack += h.bet * 2; this.house -= h.bet; }
          else if (v.total === d.total) { h.result = 'push'; h.won = 0; s.stack += h.bet; }
          else { h.result = 'lose'; h.won = -h.bet; this.house += h.bet; }
        }
        results.push({ seat: s, hand: h });
      }
    }
    await this.emit('settle', { results, dealer: d, dealerBJ });
    // cards to the discard tray
    this.discards += this.dealer.cards.length + this.seats.reduce((t, s) => t + s.hands.reduce((u, h) => u + h.cards.length, 0), 0);
    for (const s of this.seats) if (!s.out && s.stack < RULES.minBet) { s.out = true; await this.emit('out', { seat: s }); }
    if (this.human && this.human.out) this.over = true;
    await this.emit('roundEnd', { over: this.over, shuffleNext: this.shoe.needsShuffle });
  }

  // ---------- the other players ----------
  botBet(s) {
    const unit = RULES.minBet;
    const mult = s.style === 'hunch' ? 1 + Math.floor(Math.random() * 6) : 1 + Math.floor(Math.random() * 3);
    return Math.min(s.stack, Math.round((unit * mult) / 5) * 5);
  }
  botAction(s, ctx) {
    const best = ctx.best;
    if (s.style !== 'hunch' || Math.random() > 0.22) return best;
    // a "hunch" player: plays by feel now and then
    const v = handValue(ctx.hand.cards);
    if (best === 'double') return 'hit';
    if (best === 'split') return v.total >= 12 ? 'stand' : 'hit';
    if (best === 'hit' && v.total >= 12) return 'stand';
    if (best === 'stand' && v.total <= 16 && !v.soft) return 'hit';
    return best;
  }
}
