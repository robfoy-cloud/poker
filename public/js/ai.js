// Hand reading, equity estimates, the bots' decisions and the coach's advice.
// Nothing here ever looks at another player's hidden cards.

import { evaluate, newDeck, chenScore, startingHandName, RANK_NAME, RANK_PLURAL, SUIT_NAME } from './cards.js';

const key = c => c.r + c.s;

export function equity(hole, board, nOpp, iters = 400) {
  if (nOpp < 1) return 1;
  const known = new Set([...hole, ...board].map(key));
  const rest = newDeck().filter(c => !known.has(key(c)));
  let win = 0;
  for (let it = 0; it < iters; it++) {
    // partial Fisher-Yates for the cards we need
    const need = 2 * nOpp + (5 - board.length);
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(Math.random() * (rest.length - i));
      const t = rest[i]; rest[i] = rest[j]; rest[j] = t;
    }
    let k = 0;
    const b = board.slice();
    while (b.length < 5) b.push(rest[k++]);
    const mine = evaluate([...hole, ...b]).score;
    let best = 0, ties = 0, beaten = false;
    for (let o = 0; o < nOpp; o++) {
      const s = evaluate([rest[k++], rest[k++], ...b]).score;
      if (s > mine) { beaten = true; break; }
      if (s === mine) ties++;
      if (s > best) best = s;
    }
    if (!beaten) win += 1 / (ties + 1);
  }
  return win / iters;
}

// Describe what you hold in poker language.
export function readHand(hole, board) {
  const out = { made: '', terms: [], draws: [], outs: 0, cat: -1 };
  if (board.length === 0) {
    const s = startingHandName(hole);
    out.made = s.nick ? `${s.code} (${s.desc}, nicknamed "${s.nick}")` : `${s.code} (${s.desc})`;
    out.chen = chenScore(hole);
    return out;
  }
  const ev = evaluate([...hole, ...board]);
  out.cat = ev.cat; out.ev = ev;
  const bRanks = board.map(c => c.r).sort((a, b) => b - a);
  const uniqB = [...new Set(bRanks)];
  const [h1, h2] = hole[0].r >= hole[1].r ? hole : [hole[1], hole[0]];
  const pocket = h1.r === h2.r;
  const boardEv = board.length >= 5 ? evaluate(board) : null;

  if (boardEv && boardEv.score === ev.score) {
    out.made = `${ev.name} — but it's all on the board, so {{board plays}} and anyone left can share it`;
  } else if (ev.cat === 1) {
    const pr = ev.kickers[0];
    if (pocket && pr > uniqB[0]) out.made = `an {{overpair}} (${RANK_PLURAL[pr].toLowerCase()})`;
    else if (pocket) out.made = `a {{pocket pair}} of ${RANK_PLURAL[pr].toLowerCase()} below the top card on the board`;
    else if (hole.some(c => c.r === pr)) {
      const idx = uniqB.indexOf(pr);
      const kick = hole.find(c => c.r !== pr);
      const kickTxt = kick ? `, ${RANK_NAME[kick.r].toLowerCase()} {{kicker}}` : '';
      if (idx === 0) out.made = `{{top pair}} (${RANK_PLURAL[pr].toLowerCase()}${kickTxt})`;
      else if (idx === uniqB.length - 1) out.made = `{{bottom pair}} (${RANK_PLURAL[pr].toLowerCase()}${kickTxt})`;
      else out.made = `{{middle pair}} (${RANK_PLURAL[pr].toLowerCase()}${kickTxt})`;
    } else out.made = `just the pair on the board — you're really playing {{high card}} (${RANK_NAME[h1.r].toLowerCase()})`;
  } else if (ev.cat === 3) {
    const t = ev.kickers[0];
    if (pocket && h1.r === t) out.made = `a {{set}} of ${RANK_PLURAL[t].toLowerCase()} — very strong and well hidden`;
    else if (hole.some(c => c.r === t)) out.made = `{{trips}} (three ${RANK_PLURAL[t].toLowerCase()}, using the pair on the board)`;
    else out.made = `three of a kind on the board — your hole cards only count as {{kicker|kickers}}`;
  } else if (ev.cat === 2) {
    const [a, b] = ev.kickers;
    const boardPair = uniqB.length < board.length;
    if (pocket && h1.r !== a && h1.r !== b) out.made = `{{two pair}} on the board, with your ${RANK_PLURAL[h1.r].toLowerCase()} not counting`;
    else out.made = `{{two pair}}, ${RANK_PLURAL[a].toLowerCase()} and ${RANK_PLURAL[b].toLowerCase()}${boardPair ? ' (one pair is on the board, which makes it weaker than it looks)' : ''}`;
  } else if (ev.cat === 0) {
    out.made = `{{high card}} — no pair yet`;
    if (h2.r > uniqB[0]) out.terms.push('two {{overcards}}');
    else if (h1.r > uniqB[0]) out.terms.push('one overcard');
  } else {
    const term = ['', '', '', '', 'straight', 'flush', 'full house', 'four of a kind', 'straight flush'][ev.cat];
    out.made = `a {{${term}|${ev.name.toLowerCase()}}}`;
  }

  // Draws (only meaningful with cards still to come)
  if (board.length < 5 && ev.cat < 4) {
    const known = new Set([...hole, ...board].map(key));
    const unseen = newDeck().filter(c => !known.has(key(c)));
    let flushOuts = 0, straightOuts = 0;
    const straightRanks = new Set();
    for (const c of unseen) {
      const e = evaluate([...hole, ...board, c]);
      const eb = evaluate([...board, c]);
      if (e.cat >= 5 && e.cat !== 6 && e.cat !== 7 && eb.score < e.score && e.cat !== 4) flushOuts++;
      else if (e.cat === 4 && eb.score < e.score) { straightOuts++; straightRanks.add(c.r); }
    }
    if (flushOuts >= 7) out.draws.push(`a {{flush draw}} (${flushOuts} outs)`);
    if (straightRanks.size >= 2) out.draws.push(`an {{open-ended straight draw}} (${straightOuts} outs)`);
    else if (straightRanks.size === 1) out.draws.push(`a {{gutshot}} straight draw (${straightOuts} outs)`);
    out.outs = flushOuts + straightOuts;
  }
  return out;
}

export function boardTexture(board) {
  if (board.length < 3) return '';
  const flop = board.slice(0, 3);
  const suits = new Set(flop.map(c => c.s)).size;
  const ranks = flop.map(c => c.r).sort((a, b) => b - a);
  const paired = new Set(ranks).size < 3;
  const spread = ranks[0] - ranks[2];
  const bits = [];
  if (suits === 3) bits.push('{{rainbow}}');
  else if (suits === 2) bits.push('{{two-tone}}');
  else bits.push(`{{monotone}} (all ${SUIT_NAME[flop[0].s]})`);
  if (paired) bits.push('{{paired board|paired}}');
  const connected = !paired && spread <= 4;
  if (suits === 3 && !connected) bits.push('fairly {{dry board|dry}}');
  else if (suits <= 2 && connected) bits.push('{{wet board|wet}} — lots of draws possible');
  else if (connected) bits.push('connected — straight draws possible');
  return bits.join(', ');
}

// How strong do the opponents look this hand? (from visible actions only)
export function opponentReads(game, me) {
  const reads = [];
  const handStart = lastIndex(game.log, e => e.type === 'newHand');
  const acts = game.log.slice(handStart).filter(e => e.type === 'action');
  for (const p of game.inHand()) {
    if (p === me) continue;
    const mine = acts.filter(a => a.seat === p.seat);
    const aggr = mine.filter(a => a.act.type === 'raise').length;
    const calls = mine.filter(a => a.act.type === 'call').length;
    const s = p.stats;
    const vpip = s.hands >= 4 ? Math.round(100 * s.vpip / s.hands) : null;
    const af = s.calls > 0 ? (s.raises / s.calls) : s.raises;
    let style = '';
    if (vpip != null) {
      style = vpip > 45 ? 'loose' : vpip < 22 ? 'tight' : '';
      if (s.raises + s.calls >= 5) style += (style ? '-' : '') + (af > 1.2 ? 'aggressive' : af < 0.5 ? 'passive' : '');
    }
    reads.push({ seat: p.seat, name: p.name, aggr, calls, vpip, style });
  }
  return reads;
}

function lastIndex(arr, f) { for (let i = arr.length - 1; i >= 0; i--) if (f(arr[i])) return i; return 0; }

function roundChips(x, unit) { return Math.max(unit, Math.round(x / unit) * unit); }

// ---------- the coach: what I would do in your seat ----------
export function advise(game, me, ctx) {
  const board = game.board;
  const opps = game.inHand().length - 1;
  const read = readHand(me.hole, board);
  const reads = opponentReads(game, me);
  const pos = game.positions()[me.seat];
  const unit = game.bb >= 10 ? 5 : 1;
  const pot = ctx.pot;
  const reasons = [];
  let action, to;

  const toCall = ctx.toCall;
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  let eqAdj = null;

  if (game.street === 'preflop') {
    const chen = read.chen;
    const late = ['BTN', 'CO', 'BTN/SB'].includes(pos);
    const early = ['UTG', 'UTG+1', 'UTG+2'].includes(pos);
    const openNeed = early ? 9 : late ? 6 : pos === 'SB' ? 7 : 8;
    reasons.push(`You hold ${read.made}. On the Chen scale (a quick hand-scoring method) that's ${chen} — ${chen >= 12 ? 'a premium hand' : chen >= 9 ? 'a strong hand' : chen >= 7 ? 'a playable hand' : chen >= 5 ? 'a marginal hand' : 'a weak hand'}.`);
    reasons.push(`You're in ${posText(pos)}.`);
    const raises = ctx.raisesThisStreet;
    if (raises === 0) {
      if (ctx.canCheck) {
        if (chen >= 10) { action = 'raise'; to = roundChips(ctx.currentBet + 3 * game.bb, unit); reasons.push('Nobody has raised, and as the {{big blind}} you have the {{option}}: with a hand this good, raise rather than check.'); }
        else { action = 'check'; reasons.push('Nobody raised, so as the {{big blind}} you can {{check}} and see the {{flop}} for free.'); }
      } else if (chen >= openNeed) {
        action = 'raise';
        const limpers = game.inHand().filter(p => p !== me && p.bet === game.bb && p.seat !== game.bbSeat).length;
        to = roundChips(3 * game.bb + limpers * game.bb, unit);
        reasons.push(`Good enough to {{open-raise}} from here (I'd want about ${openNeed}+ on the Chen scale in this seat). A standard size is 3 big blinds${limpers ? ', plus one more for each {{limp|limper}}' : ''}.`);
      } else if (chen >= openNeed - 2 && (late || pos === 'SB')) {
        action = 'call';
        reasons.push(`Borderline. From late position a cheap call (a {{limp}}) to see the flop is OK, though many players would just fold.`);
      } else {
        action = 'fold';
        reasons.push(`Not strong enough to play from this seat — {{fold}} and wait for a better spot. Folding most hands pre-flop is normal.`);
      }
    } else {
      const need = 8 + raises * 2;
      reasons.push(`There ${raises === 1 ? 'has been a raise' : `have been ${raises} raises`} already, so you need a stronger hand to continue (about ${need}+). You'd be putting in ${toCall} to win ${pot}: {{pot odds}} of ${(potOdds * 100).toFixed(0)}%.`);
      if (chen >= need + 3 || chen >= 16) {
        action = 'raise'; to = roundChips(ctx.currentBet * 3, unit);
        reasons.push(`This is strong enough to re-raise (${raises === 1 ? 'a {{3-bet}}' : 'a {{4-bet}}'}).`);
      } else if (chen >= need || (potOdds < 0.2 && chen >= need - 3)) {
        action = 'call'; reasons.push('Strong enough to {{call}} and see a flop.');
      } else { action = 'fold'; reasons.push('Not strong enough against that much aggression — fold.'); }
    }
  } else {
    let eq = equity(me.hole, board, opps, 500);
    const strong = reads.filter(r => r.aggr > 0);
    let adj = 1;
    for (const r of strong) adj *= Math.max(0.7, 1 - 0.08 * r.aggr);
    eqAdj = eq * adj;
    reasons.push(`You have ${read.made}${read.terms.length ? ', with ' + read.terms.join(', ') : ''}.`);
    if (read.draws.length) reasons.push(`You also have ${read.draws.join(' and ')}. ${board.length === 3 ? 'With two cards to come, the {{rule of 2 and 4}} says about ' + Math.min(100, read.outs * 4) + '% to hit by the river' : 'With one card to come that is roughly ' + Math.min(100, read.outs * 2) + '%'}.`);
    if (board.length === 3) reasons.push(`The flop is ${boardTexture(board)}.`);
    reasons.push(`Against ${opps} random hand${opps > 1 ? 's' : ''} you'd win about ${(eq * 100).toFixed(0)}% of the time (your {{equity}}).`);
    for (const r of reads) {
      if (r.aggr >= 2) reasons.push(`${r.name} has bet or raised ${r.aggr} times this hand — that usually means a strong hand, so I'd discount my chances.`);
      else if (r.aggr === 1) reasons.push(`${r.name} has shown some strength with a bet or raise.`);
      if (r.style) reasons.push(`${r.name} has been playing ${r.style} so far.`);
    }
    if (strong.length) reasons.push(`Allowing for that, I'd call it nearer ${(eqAdj * 100).toFixed(0)}%.`);
    if (toCall === 0) {
      if (eqAdj > 0.62) { action = 'bet'; to = roundChips(pot * 0.66, unit); reasons.push(`You're probably ahead: make a {{value bet}} of about two-thirds of the pot so worse hands pay you.`); }
      else if (eqAdj > 0.45 && opps <= 2) { action = 'bet'; to = roundChips(pot * 0.5, unit); reasons.push('A half-pot bet is reasonable: you are likely ahead and betting protects your hand.'); }
      else if (read.outs >= 8 && board.length < 5) { action = 'bet'; to = roundChips(pot * 0.5, unit); reasons.push('With a big draw a {{semi-bluff}} works: they may fold now, and you can still hit if called.'); }
      else { action = 'check'; reasons.push('Not strong enough to bet for value — {{check}} and see what happens.'); }
      if (game.preflopRaiser === me.seat && board.length === 3 && action === 'check' && opps === 1) {
        action = 'bet'; to = roundChips(pot * 0.4, unit);
        reasons.push('You raised pre-flop, so a small {{continuation bet}} (c-bet) often takes the pot against one opponent.');
      }
      if (to) to = Math.max(to, game.bb);
    } else {
      reasons.push(`You must put in ${toCall} to win ${pot}. Those {{pot odds}} mean you need to win at least ${(potOdds * 100).toFixed(0)}% of the time to call.`);
      if (eqAdj > 0.7 && !ctx.cannotRaise) { action = 'raise'; to = roundChips(ctx.currentBet * 2.5 + (pot - toCall) * 0.3, unit); reasons.push("You're well ahead: raise for value."); }
      else if (eqAdj >= potOdds) { action = 'call'; reasons.push(`Your chances (${(eqAdj * 100).toFixed(0)}%) beat the price (${(potOdds * 100).toFixed(0)}%), so {{call}}.`); }
      else { action = 'fold'; reasons.push(`Your chances (${(eqAdj * 100).toFixed(0)}%) are below the price (${(potOdds * 100).toFixed(0)}%), so {{fold}} — calling would lose money over time.`); }
    }
  }
  if (to != null) {
    to = Math.max(to, ctx.minRaiseTo);
    if (to >= ctx.maxTo) { to = ctx.maxTo; }
  }
  const allIn = to != null && to >= ctx.maxTo;
  const push = action === 'call' ? toCall : to != null ? to - ctx.myBet : 0;
  return { action: allIn ? 'all-in' : action, base: action, to, push, reasons, read, eqAdj, potOdds, chen: read.chen };
}

function posText(pos) {
  return {
    'BTN': 'the best seat — on the {{button}}, you act last after the flop',
    'BTN/SB': 'the {{button}} (heads-up the button is also the {{small blind}}): first to act pre-flop, last after',
    'SB': 'the {{small blind}} — you\'ll act first after the flop, which is a disadvantage',
    'BB': 'the {{big blind}} — you already have a full bet in',
    'UTG': '{{early position}} ({{under the gun}}) — lots of players still to act behind you',
    'UTG+1': '{{early position}}', 'UTG+2': '{{early position}}',
    'MP': '{{middle position}}', 'HJ': 'the {{hijack}} (two right of the button)', 'CO': 'the {{cutoff}} (just right of the button) — good position',
  }[pos] || pos;
}

// ---------- the bots ----------
export const STYLES = {
  rock: { name: 'tight-passive', loose: -1.5, aggr: 0.3, bluff: 0.05 },
  tag: { name: 'tight-aggressive', loose: -0.5, aggr: 0.75, bluff: 0.15 },
  lag: { name: 'loose-aggressive', loose: 1.5, aggr: 0.85, bluff: 0.3 },
  station: { name: 'loose-passive', loose: 2, aggr: 0.2, bluff: 0.05 },
  solid: { name: 'balanced', loose: 0, aggr: 0.55, bluff: 0.12 },
};

export function botDecide(game, p, ctx) {
  const st = STYLES[p.style] || STYLES.solid;
  const unit = game.bb >= 10 ? 5 : 1;
  const r = Math.random();
  const toCall = ctx.toCall;
  const pot = ctx.pot;
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;

  if (game.street === 'preflop') {
    const chen = chenScore(p.hole) + st.loose;
    const pos = game.positions()[p.seat];
    const late = ['BTN', 'CO', 'BTN/SB', 'SB'].includes(pos);
    const early = ['UTG', 'UTG+1', 'UTG+2'].includes(pos);
    const openNeed = early ? 9 : late ? 6.5 : 8;
    const raises = ctx.raisesThisStreet;
    if (raises === 0) {
      if (chen >= openNeed + 1 || (chen >= openNeed && r < st.aggr)) return { type: 'raise', to: roundChips(ctx.currentBet + 2 * game.bb + r * game.bb, unit) };
      if (ctx.canCheck) return { type: 'check' };
      if (chen >= openNeed - 1.5 || (late && chen >= 5 && r < 0.4) || (pos === 'SB' && chen >= 4)) return { type: 'call' };
      if (r < st.bluff * 0.4 && late) return { type: 'raise', to: roundChips(3 * game.bb, unit) };
      return { type: 'fold' };
    }
    const need = 8 + raises * 2;
    if (chen >= 17 || (chen >= need + 3 && r < st.aggr)) return { type: 'raise', to: roundChips(ctx.currentBet * (2.6 + r), unit) };
    if (chen >= need || (potOdds < 0.25 && chen >= need - 3) || (ctx.canCheck)) return ctx.canCheck ? { type: 'check' } : { type: 'call' };
    if (toCall <= game.bb && chen >= 4) return { type: 'call' };
    return { type: 'fold' };
  }

  const opps = game.inHand().length - 1;
  let eq = equity(p.hole, game.board, opps, 250);
  // respect aggression from others this street
  eq *= Math.pow(0.9, Math.max(0, ctx.raisesThisStreet - (toCall > 0 ? 0 : 0)));
  const read = readHand(p.hole, game.board);
  if (toCall === 0) {
    if (eq > 0.65 && r < 0.4 + st.aggr * 0.6) return { type: 'raise', to: roundChips(pot * (0.5 + 0.3 * r), unit) };
    if (eq > 0.45 && r < st.aggr * 0.6) return { type: 'raise', to: roundChips(pot * 0.5, unit) };
    if (game.preflopRaiser === p.seat && game.board.length === 3 && r < 0.5 + st.aggr * 0.3) return { type: 'raise', to: roundChips(pot * 0.45, unit) };
    if (read.outs >= 8 && r < st.aggr * 0.5) return { type: 'raise', to: roundChips(pot * 0.55, unit) };
    if (r < st.bluff * 0.5) return { type: 'raise', to: roundChips(pot * 0.6, unit) };
    return { type: 'check' };
  }
  const loose = st.loose > 1 ? 0.08 : 0;
  if (eq > 0.78 && r < 0.3 + st.aggr * 0.6) return { type: 'raise', to: roundChips(ctx.currentBet * 2.5 + pot * 0.2, unit) };
  if (eq + loose >= potOdds * 1.05) return { type: 'call' };
  if (read.outs >= 8 && game.board.length < 5 && potOdds < 0.35) return { type: 'call' };
  if (r < st.bluff * 0.15 && ctx.raisesThisStreet <= 1) return { type: 'raise', to: roundChips(ctx.currentBet * 2.5, unit) };
  return { type: 'fold' };
}
