// Cards, deck and hand evaluation for Texas Hold'em.

export const SUITS = ['s', 'h', 'd', 'c'];
export const SUIT_SYMBOL = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const SUIT_NAME = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
export const RANK_CHAR = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
export const RANK_NAME = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
export const RANK_PLURAL = { 2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens', 8: 'Eights', 9: 'Nines', 10: 'Tens', 11: 'Jacks', 12: 'Queens', 13: 'Kings', 14: 'Aces' };

export function cardStr(c) { return RANK_CHAR[c.r] + SUIT_SYMBOL[c.s]; }
export function cardsStr(cs) { return cs.map(cardStr).join(' '); }

export function newDeck() {
  const d = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ r, s });
  return d;
}

function randInt(n) {
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    const a = new Uint32Array(1);
    globalThis.crypto.getRandomValues(a);
    return a[0] % n;
  }
  return Math.floor(Math.random() * n);
}

export function shuffle(arr, rnd = randInt) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const CATEGORY = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

// Highest straight in a set of rank values (array of unique ranks). Returns top rank or 0.
function straightTop(rankSet) {
  const has = new Array(15).fill(false);
  for (const r of rankSet) has[r] = true;
  if (has[14]) has[1] = true; // wheel
  for (let top = 14; top >= 5; top--) {
    let ok = true;
    for (let k = 0; k < 5; k++) if (!has[top - k]) { ok = false; break; }
    if (ok) return top;
  }
  return 0;
}

// Evaluate the best 5-card hand from 5-7 cards.
// Returns { cat, kickers: [...], score, name }
export function evaluate(cards) {
  const counts = new Array(15).fill(0);
  const bySuit = { s: [], h: [], d: [], c: [] };
  for (const c of cards) { counts[c.r]++; bySuit[c.s].push(c.r); }

  let flushSuit = null;
  for (const s of SUITS) if (bySuit[s].length >= 5) flushSuit = s;

  if (flushSuit) {
    const sf = straightTop(bySuit[flushSuit]);
    if (sf) return finish(8, [sf]);
  }

  const quads = [], trips = [], pairs = [], singles = [];
  for (let r = 14; r >= 2; r--) {
    if (counts[r] === 4) quads.push(r);
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
    else if (counts[r] === 1) singles.push(r);
  }

  if (quads.length) {
    const q = quads[0];
    const kicker = [...trips, ...pairs, ...singles, ...quads.slice(1)].sort((a, b) => b - a)[0];
    return finish(7, [q, kicker]);
  }
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const t = trips[0];
    const p = Math.max(trips[1] || 0, pairs[0] || 0);
    return finish(6, [t, p]);
  }
  if (flushSuit) {
    const top = bySuit[flushSuit].sort((a, b) => b - a).slice(0, 5);
    return finish(5, top);
  }
  const uniq = [];
  for (let r = 14; r >= 2; r--) if (counts[r]) uniq.push(r);
  const st = straightTop(uniq);
  if (st) return finish(4, [st]);
  if (trips.length) {
    const t = trips[0];
    const ks = [...pairs, ...singles].sort((a, b) => b - a).slice(0, 2);
    return finish(3, [t, ...ks]);
  }
  if (pairs.length >= 2) {
    const [p1, p2] = pairs;
    const k = [...pairs.slice(2), ...singles].sort((a, b) => b - a)[0];
    return finish(2, [p1, p2, k]);
  }
  if (pairs.length === 1) {
    const ks = singles.slice(0, 3);
    return finish(1, [pairs[0], ...ks]);
  }
  return finish(0, singles.slice(0, 5));
}

function finish(cat, kickers) {
  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 15 + (kickers[i] || 0);
  return { cat, kickers, score, name: handName(cat, kickers) };
}

export function handName(cat, k) {
  switch (cat) {
    case 8: return k[0] === 14 ? 'Royal Flush' : `Straight Flush, ${RANK_NAME[k[0]]} high`;
    case 7: return `Four of a Kind, ${RANK_PLURAL[k[0]]}`;
    case 6: return `Full House, ${RANK_PLURAL[k[0]]} full of ${RANK_PLURAL[k[1]]}`;
    case 5: return `Flush, ${RANK_NAME[k[0]]} high`;
    case 4: return `Straight, ${RANK_NAME[k[0]]} high`;
    case 3: return `Three of a Kind, ${RANK_PLURAL[k[0]]}`;
    case 2: return `Two Pair, ${RANK_PLURAL[k[0]]} and ${RANK_PLURAL[k[1]]}`;
    case 1: return `Pair of ${RANK_PLURAL[k[0]]}`;
    default: return `High Card, ${RANK_NAME[k[0]]}`;
  }
}

// Nicknames for starting hands — part of the jargon.
export function startingHandName(h) {
  const [a, b] = h[0].r >= h[1].r ? h : [h[1], h[0]];
  const suited = a.s === b.s;
  const pair = a.r === b.r;
  const nick = {
    '14-14': 'Pocket Rockets', '13-13': 'Cowboys', '12-12': 'Ladies', '11-11': 'Hooks',
    '10-10': 'Dimes', '8-8': 'Snowmen', '2-2': 'Ducks', '14-13': 'Big Slick',
    '14-12': 'Big Chick', '13-12': 'Royal Couple', '11-10': '', '7-2': 'the worst hand in poker',
  }[`${a.r}-${b.r}`];
  let code;
  if (pair) code = `${RANK_CHAR[a.r]}${RANK_CHAR[b.r]}`;
  else code = `${RANK_CHAR[a.r]}${RANK_CHAR[b.r]}${suited ? 's' : 'o'}`;
  code = code.replace(/10/g, 'T');
  let desc;
  if (pair) desc = `a pocket pair of ${RANK_PLURAL[a.r].toLowerCase()}`;
  else if (a.r - b.r === 1) desc = suited ? 'suited connectors' : 'offsuit connectors';
  else desc = suited ? `${RANK_NAME[a.r].toLowerCase()}-${RANK_NAME[b.r].toLowerCase()} suited` : `${RANK_NAME[a.r].toLowerCase()}-${RANK_NAME[b.r].toLowerCase()} offsuit`;
  return { code, desc, nick: nick || '', suited, pair };
}

// Chen formula: a classic quick way to score a starting hand (-1 .. 20).
export function chenScore(h) {
  const [a, b] = h[0].r >= h[1].r ? h : [h[1], h[0]];
  const base = { 14: 10, 13: 8, 12: 7, 11: 6 };
  let s = base[a.r] || a.r / 2;
  if (a.r === b.r) s = Math.max(5, s * 2);
  if (a.s === b.s) s += 2;
  const gap = a.r - b.r - 1;
  if (a.r !== b.r) {
    if (gap === 1) s -= 1; else if (gap === 2) s -= 2; else if (gap === 3) s -= 4; else if (gap >= 4) s -= 5;
    if (gap <= 1 && a.r < 12) s += 1;
  }
  return Math.ceil(s);
}

// The Chen formula step by step, for teaching. Returns { steps, raw, total }.
export function chenSteps(h) {
  const [a, b] = h[0].r >= h[1].r ? h : [h[1], h[0]];
  const base = { 14: 10, 13: 8, 12: 7, 11: 6 };
  const steps = [];
  let s = base[a.r] || a.r / 2;
  steps.push({ label: 'Score your highest card', detail: base[a.r] ? `${RANK_NAME[a.r]} = ${s}` : `${RANK_NAME[a.r]}: half its value, ${a.r} ÷ 2`, value: s, kind: 'set' });
  const pair = a.r === b.r;
  if (pair) {
    const doubled = Math.max(5, s * 2);
    steps.push({ label: 'Pair? Double it', detail: s * 2 < 5 ? `${s} × 2 = ${s * 2}, but a pair is worth at least 5` : `${s} × 2`, value: doubled - s, kind: 'add' });
    s = doubled;
  } else steps.push({ label: 'Pair? Double it', detail: 'Not a pair', value: 0, kind: 'skip' });
  if (a.s === b.s) { steps.push({ label: 'Suited? Add 2', detail: `Both ${SUIT_NAME[a.s]}`, value: 2, kind: 'add' }); s += 2; }
  else steps.push({ label: 'Suited? Add 2', detail: 'Different suits', value: 0, kind: 'skip' });
  if (!pair) {
    const gap = a.r - b.r - 1;
    const pen = gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
    steps.push({ label: 'Gap between the cards', detail: gap === 0 ? 'No gap — they are connected' : `${gap} card${gap > 1 ? 's' : ''} missing between them`, value: -pen, kind: pen ? 'add' : 'skip' });
    s -= pen;
    if (gap <= 1 && a.r < 12) { steps.push({ label: 'Straight bonus', detail: 'Gap of 0 or 1 and both cards below a queen', value: 1, kind: 'add' }); s += 1; }
    else steps.push({ label: 'Straight bonus', detail: gap > 1 ? 'Gap too big' : 'A card is queen or higher', value: 0, kind: 'skip' });
  } else {
    steps.push({ label: 'Gap between the cards', detail: 'Not used for pairs', value: 0, kind: 'skip' });
  }
  const total = Math.ceil(s);
  return { steps, raw: s, total, rounded: total !== s };
}
