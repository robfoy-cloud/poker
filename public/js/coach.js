// The coach: narrates the game in poker jargon, explains the rules as they happen,
// gives advice, and points out mistakes. Three levels:
//   1 = Learn  (tells you everything, including what I'd do)
//   2 = Advise (explains the flow; advice when you ask)
//   3 = Test   (silent unless you make a mistake)

import { cardsStr, startingHandName, cardStr } from './cards.js';
import { advise, boardTexture, readHand } from './ai.js';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export class Coach {
  constructor(ui, settings) {
    this.ui = ui;
    this.settings = settings;
    this.lastAdvice = null;
  }
  get level() { return this.settings.level; }

  say(html, kind = 'info') { this.ui.coachSay(html, kind); }

  nm(game, seat, opts = {}) {
    const p = game.players[seat];
    if (p.isHuman) return opts.subject ? 'you' : 'you';
    const pos = game.positions()[seat];
    return opts.noPos || !pos ? p.name : `${p.name} (${pos})`;
  }
  isYou(game, seat) { return game.players[seat].isHuman; }

  async event(type, d, game) {
    const L = this.level;
    const handler = this['on_' + type];
    if (handler) await handler.call(this, d, game, L);
  }

  // ---------- hand set-up ----------
  async on_dealForButton(d, game, L) {
    if (L === 3) return;
    const list = d.draws.map(x => `${game.players[x.seat].isHuman ? 'You' : game.players[x.seat].name}: ${cardStr(x.card)}`).join(', ');
    this.say(`First we {{deal for the button}}: everyone gets one card face up and the highest card becomes the first {{dealer}}. ${list}. ${cap(this.nm(game, d.button, { noPos: true }))} ${this.isYou(game, d.button) ? 'have' : 'has'} the highest card, so ${this.isYou(game, d.button) ? 'you take' : 'takes'} the {{button}}.${L === 1 ? ' (If two cards tie on rank, many card rooms break the tie by suit: spades, hearts, diamonds, clubs.)' : ''}`);
  }

  async on_newHand(d, game, L) {
    this.ui.newHandDivider(d.handNo);
    if (L === 3) return;
    const btn = game.players[d.button];
    const sb = game.players[d.sbSeat], bb = game.players[d.bbSeat];
    const you = s => this.isYou(game, s);
    if (L === 1) {
      let t = `<b>Hand ${d.handNo}.</b> The {{button}} is ${d.handNo > 1 ? 'moved one seat to the left (clockwise) to' : 'with'} ${you(d.button) ? '<b>you</b> — you are the dealer this hand' : btn.name}. `;
      if (d.headsUp) {
        t += `With only two players ({{heads-up}}) the rules change: the button posts the {{small blind}} and the other player posts the {{big blind}}. `;
      } else {
        t += `The player directly to the dealer's left, ${you(d.sbSeat) ? '<b>you</b>' : sb.name}, posts the {{small blind}} (${game.sb}); the next player, ${you(d.bbSeat) ? '<b>you</b>' : bb.name}, posts the {{big blind}} (${game.bb}). `;
      }
      t += `The {{blinds}} are forced bets so there's always something in the {{pot}} to fight for.`;
      this.say(t);
    } else {
      this.say(`<b>Hand ${d.handNo}.</b> ${you(d.button) ? 'You have' : btn.name + ' has'} the {{button}}.`);
    }
  }

  async on_blind(d, game, L) {
    if (L === 3) return;
    const p = game.players[d.seat];
    if (d.allIn && L <= 2) this.say(`${p.isHuman ? 'You don\'t' : p.name + ' doesn\'t'} have enough for the full blind, so ${p.isHuman ? 'you are' : 'they are'} {{all-in}} for ${d.amount}.`);
  }

  // Prompt text when the human must post a blind (shown in the action bar).
  blindPrompt(which, amount) {
    const L = this.level;
    if (L === 1) return `You're the <b>${which} blind</b>: tap chips from your stack to put out <b>${amount}</b>, then press <b>Put in</b>.`;
    if (L === 2) return `Post the ${which} blind.`;
    return `Your move.`;
  }

  dealerPrompt(ctx, game) {
    const L = this.level;
    const first = game.nextSeat(game.button, p => !p.out);
    const fname = game.players[first].name;
    if (ctx.step === 'firstCard') {
      if (L === 1) return `You're the dealer. Cards are dealt clockwise, one at a time, starting with the player on your <b>left</b> (${fname}). <b>Tap ${fname}'s seat</b> to start dealing.`;
      if (L === 2) return `You're the dealer — tap the player who gets the first card.`;
      return `You're dealing. Tap who gets the first card.`;
    }
    const st = ctx.street;
    if (ctx.step.endsWith(':first')) {
      if (L === 1) return `Time for the ${st}. As dealer, first <b>burn</b> a card (discard the top card face down), then deal.`;
      return `Dealer: what do you do first for the ${st}?`;
    }
    if (L === 1) return `Now deal the ${st}: ${st === 'flop' ? '<b>three</b> cards together' : '<b>one</b> card'}, face up.`;
    return `How many cards for the ${st}?`;
  }

  async on_dealerOk(d, game, L) {
    if (L === 1 && d.step === 'firstCard') this.say(`Correct — the first card always goes to the player on the dealer's left.`, 'good');
  }

  async on_dealing(d, game, L) {
    if (L !== 1) return;
    if (this.isYou(game, d.dealer)) return;
    const dealer = game.players[d.dealer].name;
    const first = this.nm(game, d.firstSeat, { noPos: true });
    this.say(`${dealer} shuffles and deals, starting with ${first === 'you' ? 'you (on the dealer\'s left)' : first + ' on the dealer\'s left'} and going clockwise, one card at a time, until everyone has two face-down {{hole cards}}.`);
  }

  async on_dealt(d, game, L) {
    const me = game.human();
    if (L === 3 || !me || me.out) return;
    const s = startingHandName(me.hole);
    const nickTerm = s.nick && ['pocket rockets', 'cowboys', 'ladies', 'hooks', 'big slick'].includes(s.nick.toLowerCase()) ? `{{${s.nick.toLowerCase()}|${s.nick}}}` : s.nick;
    let t = `Your {{hole cards}}: <b>${cardsStr(me.hole)}</b> — written <b>${s.code}</b>${s.nick ? `, known as "${nickTerm}"` : ''}: ${s.desc.replace('pocket pair', '{{pocket pair}}').replace('suited connectors', '{{suited connectors}}').replace(/ suited$/, ' {{suited}}').replace(/ offsuit$/, ' {{offsuit}}')}.`;
    if (L === 1) {
      const first = game.nextSeat(game.bbSeat, p => !p.out);
      const live = game.live().length;
      t += ` Now the {{pre-flop}} betting round. ` + (live === 2
        ? `Heads-up, the button/small blind acts first pre-flop.`
        : `The first player to act is the one to the left of the big blind — called {{under the gun}} because they must decide with everyone still to come: ${this.isYou(game, first) ? '<b>that\'s you</b>' : game.players[first].name}.`);
    }
    this.say(t);
  }

  // ---------- betting ----------
  async on_turn(d, game, L) {
    const p = game.players[d.seat];
    if (!p.isHuman) return;
    const ctx = d.ctx;
    this.lastAdvice = advise(game, p, ctx);
    if (L === 1) {
      let opts;
      if (ctx.canCheck) opts = `nobody has bet, so you can {{check}} or {{bet}} (minimum ${ctx.minRaiseTo - ctx.myBet})`;
      else opts = `you can {{fold}}, {{call}} ${ctx.toCall}${ctx.cannotRaise ? '' : `, or {{raise}} (to at least ${ctx.minRaiseTo} in total, so put in ${ctx.minRaiseTo - ctx.myBet})`}`;
      this.say(`<b>The {{action}} is on you.</b> ${cap(opts)}.`);
      this.showAdvice();
    }
  }

  showAdvice() {
    const a = this.lastAdvice;
    if (!a) return;
    const verb = {
      fold: 'fold', check: 'check', call: `call — put in <b>${a.push}</b>`,
      raise: `raise to <b>${a.to}</b> — put in <b>${a.push}</b>`, bet: `bet <b>${a.to}</b>`,
      'all-in': `go {{all-in}} — put in <b>${a.push}</b>`,
    }[a.action];
    this.say(`<b>What I'd do: ${verb}.</b><br>` + a.reasons.map(r => '• ' + r).join('<br>'), 'advice');
  }

  async on_action(d, game, L) {
    const p = game.players[d.seat];
    if (p.isHuman) { this.reviewHuman(d, game, L); }
    if (L === 3) return;
    if (p.isHuman && L === 2) return;
    const text = this.describeAction(d, game, L);
    if (p.isHuman) { if (L === 1) this.say(text, 'you'); return; }
    this.say(text, 'action');
  }

  describeAction(d, game, L) {
    const p = game.players[d.seat];
    const who = p.isHuman ? 'You' : this.nm(game, d.seat);
    const v = (you, them) => p.isHuman ? you : them;
    const { act, ctx } = d;
    const pre = ctx.street === 'preflop';
    const amt = n => L === 1 ? ` ${n}` : '';
    let t;
    if (act.type === 'fold') {
      t = `${who} ${v('fold', 'folds')}${L === 1 ? ' — gives up the hand and any chips already in the pot' : ''}.`;
    } else if (act.type === 'check') {
      if (pre) t = `${who} ${v('check', 'checks')}${L === 1 ? ` — as the big blind, ${v('your', 'their')} blind already covers the bet, so ${v('you', 'they')} can take the {{option}} to see the flop for free` : ''}.`;
      else t = `${who} {{check|${v('check', 'checks')}}}.`;
    } else if (act.type === 'call') {
      const allIn = p.allIn;
      if (pre && ctx.raisesThisStreet === 0) {
        if (d.seat === game.sbSeat && ctx.toCall < game.bb) t = `${who} ${v('complete', 'completes')} the small blind (${v('add', 'adds')}${amt(act.amount)}${L === 1 ? ' to make a full big blind' : ''}).`;
        else t = `${who} {{limp|${v('limp', 'limps')}}} in${L === 1 ? ` — just ${v('call', 'calls')} the big blind (${act.amount}) without raising` : ''}.`;
      } else t = `${who} {{call|${v('call', 'calls')}}}${amt(act.amount)}${allIn ? ' and is {{all-in}}' : ''}.`;
    } else if (act.type === 'raise') {
      const allIn = p.allIn;
      const n = ctx.raisesThisStreet + 1;
      const to = L === 1 ? ` to ${act.to}` : '';
      if (allIn) t = `${who} {{shove|${v('shove', 'shoves')}}} {{all-in}}${L === 1 ? ` (${act.to} in total this round)` : ''}!`;
      else if (pre) {
        if (n === 1) t = `${who} {{open-raise|${v('open-raise', 'open-raises')}}}${to}.`;
        else if (n === 2) t = `${who} {{3-bet|${v('3-bet', '3-bets')}}}${to}${L === 1 ? ' (re-raises the raiser)' : ''}.`;
        else if (n === 3) t = `${who} {{4-bet|${v('4-bet', '4-bets')}}}${to}.`;
        else t = `${who} {{re-raise|${v('re-raise', 're-raises')}}}${to}.`;
      } else if (ctx.currentBet === 0) {
        if (game.preflopRaiser === d.seat && ctx.street === 'flop') t = `${who} ${v('make', 'makes')} a {{continuation bet}}${amt(act.to)}${L === 1 ? ' — the pre-flop raiser keeps up the pressure' : ''}.`;
        else t = `${who} {{bet|${v('bet', 'bets')}}}${amt(act.to)}.`;
      } else {
        const checkedEarlier = this.checkedThisStreet(game, d.seat);
        if (checkedEarlier) t = `${who} {{check-raise|${v('check-raise', 'check-raises')}}}${to}! ${L === 1 ? 'Checking then raising usually means a strong hand.' : ''}`;
        else t = `${who} {{raise|${v('raise', 'raises')}}}${to}.`;
      }
    }
    return t;
  }

  checkedThisStreet(game, seat) {
    for (let i = game.log.length - 1; i >= 0; i--) {
      const e = game.log[i];
      if (e.type === 'street' || e.type === 'dealt') return false;
      if (e.type === 'action' && e.seat === seat && e.act.type === 'check') return true;
    }
    return false;
  }

  // Compare what you did with what I'd have done. In Test mode only real blunders are flagged.
  reviewHuman(d, game, L) {
    const a = this.lastAdvice;
    if (!a) return;
    const did = d.act.type;
    const ctx = d.ctx;
    let blunder = null;
    if (game.street === 'preflop' || ctx.street === 'preflop') {
      if (did === 'fold' && a.chen >= 14) blunder = `Folding a hand this strong (${a.read.made}) before the flop throws away one of the best starting hands.`;
      if ((did === 'call' || did === 'raise') && a.chen != null && a.chen <= 3 && ctx.toCall >= ctx.stack * 0.4) blunder = `That's a lot of chips to commit with a weak starting hand (${a.read.made}).`;
    } else if (a.eqAdj != null) {
      if (did === 'fold' && a.eqAdj > 0.75) blunder = `You folded while likely well ahead — I estimate about ${(a.eqAdj * 100).toFixed(0)}% to win.`;
      if (did === 'call' && ctx.toCall > 0 && a.eqAdj < a.potOdds * 0.6 && ctx.toCall >= ctx.pot * 0.25) blunder = `That call cost more than your chances justify: you needed ${(a.potOdds * 100).toFixed(0)}% ({{pot odds}}) but had roughly ${(a.eqAdj * 100).toFixed(0)}%.`;
    }
    if (blunder) { this.say(`<b>Mistake:</b> ${blunder}`, 'mistake'); return; }
    if (L === 1) {
      const same = (a.base === did) || (a.base === 'bet' && did === 'raise') || (a.action === 'all-in' && did !== 'fold' && did !== 'check');
      if (!same) this.say(`I'd have played it differently (${a.action}), but that's a judgement call, not a rules mistake.`, 'note');
    }
    this.lastAdvice = null;
  }

  async on_mistake(d, game, L) {
    const k = d.kind;
    let t;
    switch (k) {
      case 'wrongBlind':
        t = L === 3 ? `That's not the right amount for the ${d.which} blind (you put out ${d.pushed}). Count again.`
          : `The ${d.which} blind is <b>${d.need}</b>, but you put out ${d.pushed}. Try again.`;
        break;
      case 'checkFacingBet':
        t = `You can't {{check}} — someone has bet, so you must {{call}}, {{raise}} or {{fold}}.${L < 3 ? ` It costs ${d.toCall} to call.` : ''}`;
        break;
      case 'foldFree':
        t = `Nobody has bet, so you can {{check}} for free — folding gives the hand away for nothing. Press Fold again if you really mean it.`;
        break;
      case 'short':
        t = L === 3 ? `That's {{short}} — not enough to call. Count the bet you're facing again.`
          : `That's {{short}}: you put in ${d.pushed} but need ${d.toCall} to call. (If you don't have enough you can go {{all-in}} for less.)`;
        break;
      case 'cannotRaise':
        t = `You can't raise here: the last {{all-in}} was smaller than a full raise, so the betting isn't re-opened for you. You can only {{call}} or {{fold}}.${L < 3 ? ` Calling costs ${d.toCall}.` : ''}`;
        break;
      case 'smallRaise':
        t = L === 3 ? `That raise is too small. A raise must be at least the size of the previous bet or raise ({{min-raise}}).`
          : `That's more than a call but less than a legal raise. A {{raise}} must be at least the size of the last bet or raise: here the minimum is to ${d.minRaiseTo} in total, so put in at least ${d.minRaiseTo - (d.to - d.pushed)} (or exactly ${d.toCall} to call).`;
        break;
      case 'dealFirst': {
        const correct = game.players[d.correct].name;
        t = L === 3 ? `Wrong player — the deal starts on the dealer's left.` : `The first card goes to the player on the dealer's <b>left</b>, which is ${correct}. Cards then go clockwise.`;
        break;
      }
      case 'noBurn':
        t = `Before dealing the ${d.street}, the dealer must {{burn}} a card — discard the top card face down. It stops anyone gaining from a card they may have glimpsed.`;
        break;
      case 'dealCount':
        t = L === 3 ? `Wrong number of cards for the ${d.street}.` : `The ${d.street} is ${d.right === 3 ? 'three cards dealt together' : 'a single card'}.`;
        break;
    }
    this.say(`<b>Mistake:</b> ${t}`, 'mistake');
  }

  async on_roundEnd(d, game, L) {
    if (L === 3) return;
    const st = { preflop: 'pre-flop', flop: 'flop', turn: 'turn', river: 'river' }[d.street];
    let t;
    const closer = d.closer != null ? (this.isYou(game, d.closer) ? 'you' : game.players[d.closer].name) : null;
    switch (d.reason) {
      case 'folds': {
        const w = game.inHand()[0];
        t = `Everyone else has folded, so the betting stops: ${w.isHuman ? 'you win' : w.name + ' wins'} the pot without a {{showdown}}.`;
        break;
      }
      case 'limped':
        t = `The ${st} betting round is over. Nobody raised, and the big blind ${closer && game.players[d.closer].seat === game.bbSeat ? 'checked their {{option}}' : 'is matched'}, so everyone still in has put in the same amount.`;
        break;
      case 'called':
        t = `The ${st} betting round is over because everyone still in has put in the same amount.${closer ? ` ${cap(closer)} ${closer === 'you' ? 'were' : 'was'} the last to act, {{closing the action}}.` : ''}`;
        break;
      case 'checked':
        t = `Everyone checked, so the ${st} round ends with no more chips going in.`;
        break;
      case 'allin':
        t = `The ${st} betting stops because no more betting is possible: ${game.canAct().length === 0 ? 'everyone left is {{all-in}}' : 'only one player still has chips — everyone else is {{all-in}}'}. The rest of the cards are dealt with no more betting ({{run it out}}).`;
        break;
    }
    if (L === 1 && d.reason !== 'folds') {
      const next = { preflop: 'flop', flop: 'turn', turn: 'river', river: null }[d.street];
      if (next) t += ` Next, the bets are swept into the {{pot}}, the dealer {{burn|burns}} a card, and deals the {{${next}}}.`;
      else t += ` That was the last betting round, so we go to the {{showdown}}.`;
    }
    this.say(t, 'round');
    if (L === 1 && d.reason !== 'folds') await this.ui.waitContinue();
  }

  async on_burn(d, game, L) {
    if (L !== 1) return;
    this.say(`The dealer {{burn|burns}} a card (face down, out of play) before dealing the {{${d.street}}}.`);
  }

  async on_street(d, game, L) {
    if (L === 3) return;
    const names = { flop: 'The {{flop}}', turn: 'The {{turn}} (fourth street)', river: 'The {{river}} (fifth street)' };
    let t = `${names[d.street]}: <b>${cardsStr(d.cards)}</b>.`;
    if (d.street === 'flop') t += ` The board is ${boardTexture(game.board)}.`;
    const me = game.human();
    if (me && !me.folded && !me.out && L === 1) {
      const r = readHand(me.hole, game.board);
      t += ` You now have ${r.made}${r.draws.length ? ' plus ' + r.draws.join(' and ') : ''}.`;
    }
    if (L === 1 && d.bettingPossible) {
      const first = game.nextSeat(game.button, p => !p.out && !p.folded && !p.allIn);
      t += ` After the flop, betting starts with the first player still in to the <b>left of the button</b>: ${this.isYou(game, first) ? '<b>you</b>' : game.players[first].name}.`;
    }
    this.say(t, 'street');
    if (!d.bettingPossible && L <= 2) await this.ui.sleep(900);
  }

  async on_winUncontested(d, game, L) {
    const p = game.players[d.seat];
    this.say(`${p.isHuman ? 'You win' : p.name + ' wins'} the pot${L === 1 ? ` (${d.amount})` : ''} {{uncontested}}${L < 3 ? ` — ${p.isHuman ? 'you don\'t' : 'they don\'t'} have to show ${p.isHuman ? 'your' : 'their'} cards` : ''}.`, 'result');
  }

  async on_showdown(d, game, L) {
    const shows = d.order.map(s => {
      const p = game.players[s];
      return `${p.isHuman ? 'You' : p.name}: <b>${cardsStr(p.hole)}</b> — ${p.best.name}`;
    });
    let t = '';
    if (L < 3) {
      const first = game.players[d.order[0]];
      const why = game.streetAggressor === d.order[0] ? 'the last player to bet or raise on the river shows first' : 'nobody bet on the river, so the first player left of the button shows first';
      t += `<b>{{showdown|Showdown}}.</b> ${L === 1 ? `By convention ${why} (${first.isHuman ? 'you' : first.name}). In a real game a beaten player may {{muck}} instead of showing; here everyone shows so you can learn.<br>` : ''}`;
    }
    t += shows.join('<br>') + '<br>';
    const multi = d.results.length > 1;
    d.results.forEach((r, i) => {
      const names = r.winners.map(s => game.players[s].isHuman ? 'You' : game.players[s].name);
      const potName = !multi ? 'the pot' : i === 0 ? 'the {{main pot}}' : `{{side pot}} ${i}`;
      const amt = L === 1 ? ` (${r.amount})` : '';
      if (r.split) t += `${names.join(' and ')} tie with ${r.hand} — {{split pot|split}} ${potName}${amt}.<br>`;
      else t += `${names[0]} ${names[0] === 'You' ? 'win' : 'wins'} ${potName}${amt} with <b>${r.hand}</b>.<br>`;
    });
    if (multi && L === 1) t += `There were side pots because someone was {{all-in}}: an all-in player can only win as much from each opponent as they put in themselves.`;
    this.say(t, 'result');
  }

  async on_handEnd(d, game, L) {
    for (const s of d.busted) {
      const p = game.players[s];
      this.say(`${p.isHuman ? 'You are' : p.name + ' is'} out of chips and {{bust|busted}}.`, 'result');
    }
    if (d.over) {
      const w = game.live().filter(p => p.stack > 0);
      const human = game.human();
      this.say(human.out ? `Game over — you're out. Start a new game from the menu.` : `Game over — you won all the chips! 🏆`, 'result');
      return;
    }
    await this.ui.waitContinue('Next hand');
  }

  // A plain-text summary of what you can see, for asking Claude.
  stateSummary(game) {
    const me = game.human();
    const pos = game.positions();
    const lines = [];
    lines.push(`No-limit Texas Hold'em, blinds ${game.sb}/${game.bb}. Hand ${game.handNo}. Street: ${game.street}.`);
    lines.push(`My hole cards: ${me.hole.length ? cardsStr(me.hole) : '(none)'}. Board: ${game.board.length ? cardsStr(game.board) : '(none yet)'}.`);
    lines.push(`Pot (including bets in front of players): ${game.totalPot()}.`);
    for (const p of game.players) {
      if (p.out) continue;
      lines.push(`${p.isHuman ? 'Me' : p.name} [${pos[p.seat] || ''}]: stack ${p.stack}, bet this round ${p.bet}${p.folded ? ', folded' : ''}${p.allIn ? ', all-in' : ''}${p.lastAction ? ', last action ' + p.lastAction : ''}.`);
    }
    const hs = (() => { for (let i = game.log.length - 1; i >= 0; i--) if (game.log[i].type === 'newHand') return i; return 0; })();
    const acts = game.log.slice(hs).filter(e => e.type === 'action').map(e => `${game.players[e.seat].isHuman ? 'Me' : game.players[e.seat].name}: ${e.label}${e.act.to ? ' to ' + e.act.to : e.act.amount ? ' ' + e.act.amount : ''} (${e.ctx.street})`);
    if (acts.length) lines.push('Actions this hand: ' + acts.join('; ') + '.');
    return lines.join('\n');
  }
}
