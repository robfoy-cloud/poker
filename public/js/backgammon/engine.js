// Backgammon rules, move generation, position judgement and the computer opponent.
//
// A position is { a: [Int8Array(26), Int8Array(26)] } — for each side, its checkers counted
// from its OWN point of view: a[s][1..24] points, a[s][25] the bar, a[s][0] borne off.
// Side s's point i is the other side's point 25 - i. Side 0 is you.

export const START = () => {
  const a = [new Int8Array(26), new Int8Array(26)];
  for (const s of [0, 1]) { a[s][24] = 2; a[s][13] = 5; a[s][8] = 3; a[s][6] = 5; }
  return { a };
};
export const clone = p => ({ a: [p.a[0].slice(), p.a[1].slice()] });
export const key = p => p.a[0].join(',') + '|' + p.a[1].join(',');
export const pips = (p, s) => { let t = 0; for (let i = 1; i <= 25; i++) t += i * p.a[s][i]; return t; };
const allHome = (p, s) => { for (let i = 7; i <= 25; i++) if (p.a[s][i]) return false; return true; };

// Can side s move one checker from point `from` using die d? Returns the step or null.
export function stepFor(p, s, from, d) {
  const me = p.a[s], them = p.a[1 - s];
  if (!me[from]) return null;
  if (me[25] && from !== 25) return null;          // must enter from the bar first
  const to = from - d;
  if (to <= 0) {
    if (!allHome(p, s)) return null;
    if (to < 0) { for (let i = from + 1; i <= 6; i++) if (me[i]) return null; } // higher die only from the highest point
    return { from, to: 0, die: d, hit: false };
  }
  const opp = them[25 - to];
  if (opp >= 2) return null;
  return { from, to, die: d, hit: opp === 1 };
}

export function applyStep(p, s, st) {
  const q = clone(p);
  q.a[s][st.from]--;
  q.a[s][st.to]++;
  if (st.hit) { q.a[1 - s][25 - st.to]--; q.a[1 - s][25]++; }
  return q;
}

// Every legal full move for a roll, following the rules: use as many dice as possible;
// if only one die can be used, use the larger if you can. Returns [{ steps, pos }] —
// all orders are kept (the board UI needs them); use uniqueMoves() for distinct results.
export function legalMoves(p, s, d1, d2) {
  const dice = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
  const out = [];
  let maxLen = 0;
  const rec = (pos, remaining, steps) => {
    let moved = false;
    const tried = new Set();
    for (let k = 0; k < remaining.length; k++) {
      const d = remaining[k];
      if (tried.has(d)) continue; tried.add(d);
      const rest = remaining.slice(0, k).concat(remaining.slice(k + 1));
      for (let from = 25; from >= 1; from--) {
        const st = stepFor(pos, s, from, d);
        if (!st) continue;
        moved = true;
        rec(applyStep(pos, s, st), rest, steps.concat(st));
      }
    }
    if (!moved) {
      if (steps.length > maxLen) maxLen = steps.length;
      out.push({ steps, pos });
    }
  };
  rec(p, dice, []);
  let moves = out.filter(m => m.steps.length === maxLen);
  if (maxLen === 1 && d1 !== d2) {
    const big = Math.max(d1, d2);
    if (moves.some(m => m.steps[0].die === big)) moves = moves.filter(m => m.steps[0].die === big);
  }
  return moves;
}
export function uniqueMoves(moves) {
  const seen = new Map();
  for (const m of moves) { const k = key(m.pos); if (!seen.has(k)) seen.set(k, m); }
  return [...seen.values()];
}

export const winner = p => (p.a[0][0] === 15 ? 0 : p.a[1][0] === 15 ? 1 : -1);
// 1 = single game, 2 = gammon, 3 = backgammon (for the side that won)
export function winKind(p, w) {
  const l = 1 - w;
  if (p.a[l][0] > 0) return 1;
  for (let i = 19; i <= 25; i++) if (p.a[l][i]) return 3;   // still on the bar or in the winner's home board
  return 2;
}

// Is there still contact (could anyone still hit anyone)?
export function contact(p) {
  let back0 = 0; for (let i = 25; i >= 1; i--) if (p.a[0][i]) { back0 = i; break; }
  let back1 = 0; for (let i = 25; i >= 1; i--) if (p.a[1][i]) { back1 = i; break; }
  return back0 + back1 > 25;
}

// How many of the 36 rolls would let `hitter` hit a checker on its point t (the target's point 25 - t)?
// Counts direct and combination shots, allowing for blocked landing points along the way.
export function shotsAt(p, hitter, t) {
  const me = p.a[hitter], them = p.a[1 - hitter];
  let n = 0;
  for (let d1 = 1; d1 <= 6; d1++) for (let d2 = 1; d2 <= 6; d2++) {
    let hits = false;
    for (let from = 25; from > t && !hits; from--) {
      if (!me[from]) continue;
      if (me[25] && from !== 25) continue;
      const dist = from - t;
      if (dist === d1 || dist === d2) { hits = true; break; }
      if (d1 === d2) {
        for (let k = 2; k <= 4; k++) if (dist === d1 * k) {
          let ok = true;
          for (let j = 1; j < k; j++) { const mid = from - d1 * j; if (them[25 - mid] >= 2) ok = false; }
          if (ok) hits = true;
        }
      } else if (dist === d1 + d2 && !me[25]) {
        if (them[25 - (from - d1)] < 2 || them[25 - (from - d2)] < 2) hits = true;
      }
    }
    if (hits) n++;
  }
  return n;
}

// ---------- judging a position ----------
const POINT_W = [0, 1.2, 1.6, 2.2, 3.2, 4.6, 4.2, 3.6, 1.8, 1.2, 0.8, 0.6, 0.5, 0.6, 0.3, 0.3, 0.3, 0.3, 0.6, 1.4, 2.8, 3.0, 1.8, 1.2, 0.8];

function features(p, s) {
  const me = p.a[s], them = p.a[1 - s];
  const f = { blotRisk: 0, points: 0, prime: 0, anchor: 0, stack: 0, homeClosed: 0, back: 0, blots: [] };
  let run = 0, best = 0;
  for (let i = 1; i <= 24; i++) {
    const n = me[i];
    if (n >= 2) { f.points += POINT_W[i]; run++; best = Math.max(best, run); if (i >= 19) f.anchor += i >= 20 && i <= 21 ? 3 : 1.6; if (i <= 6) f.homeClosed++; }
    else run = 0;
    if (n > 3) f.stack += (n - 3) * (i <= 6 ? 0.6 : 0.4);
    if (n === 1) f.blots.push(i);
    if (i >= 19) f.back += n;
  }
  f.prime = best >= 3 ? (best - 2) * (best - 2) * 1.6 : 0;
  return f;
}

// Score for side s, just after s has moved (the other side rolls next). Units are roughly pips.
export function evaluate(p, s) {
  const o = 1 - s;
  const w = winner(p);
  if (w === s) return 1000 * winKind(p, s);
  if (w === o) return -1000 * winKind(p, o);
  const myPips = pips(p, s), oppPips = pips(p, o);
  if (!contact(p)) {
    // a race: the pip count is nearly everything; we've used the tempo, they're on roll
    return (oppPips - myPips) - 4 + (p.a[s][0] - p.a[o][0]) * 0.5 - wastage(p, s) * 0.3;
  }
  const F = features(p, s), G = features(p, o);
  let e = (oppPips - myPips) * 0.9;
  e += (F.points - G.points) * 2.2 + (F.prime - G.prime) * 1.0 + (F.anchor - G.anchor) * 1.2 - (F.stack - G.stack) * 1.0;
  e += p.a[o][25] * (6 + F.homeClosed * 2.5) - p.a[s][25] * (4 + G.homeClosed * 2.5);
  // our blots can be hit on their very next roll
  for (const b of F.blots) {
    const sh = shotsAt(p, o, 25 - b);
    const cost = 6 + (25 - b) * 0.45 + G.homeClosed * 1.5;
    e -= (sh / 36) * cost * (b >= 19 ? 0.4 : 1);
  }
  // their blots are targets for later
  for (const b of G.blots) e += (shotsAt(p, s, 25 - b) / 36) * 3;
  return e;
}
function wastage(p, s) { let w = 0; for (let i = 1; i <= 3; i++) w += p.a[s][i] * (4 - i); return w; }

// Rough chance that side s wins, from a score (s about to be rolled against).
export function winChance(p, s) {
  const o = 1 - s;
  if (!contact(p)) {
    // race: 8-9-12-style rule of thumb turned into a probability
    const mine = pips(p, s), theirs = pips(p, o);
    const lead = (theirs - mine) / Math.max(30, mine) * 100; // percent lead, with s to roll
    return clamp(1 / (1 + Math.exp(-(lead + 4) / 5)), 0.01, 0.99);
  }
  const e = -evaluate(p, o); // s to roll = o has just moved
  return clamp(1 / (1 + Math.exp(-e / 14)), 0.02, 0.98);
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const ROLLS = []; for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) ROLLS.push([a, b, a === b ? 1 : 2]);

// Look one roll deeper: how good is position p for s, if the opponent replies with its best move?
function deep(p, s) {
  const o = 1 - s;
  if (winner(p) >= 0) return evaluate(p, s);
  let total = 0;
  for (const [d1, d2, wgt] of ROLLS) {
    const replies = uniqueMoves(legalMoves(p, o, d1, d2));
    let best = Infinity;
    if (!replies.length || !replies[0].steps.length) best = evaluate(p, s);
    else for (const r of replies) { const v = -evaluate(r.pos, o); if (v < best) best = v; }
    total += best * wgt;
  }
  return total / 36;
}

export const deepScore = (p, s) => deep(p, s);

// Rank all moves for side s with dice d1-d2. depth 1 = judge the result; 2 = also allow for their best reply.
export function rankMoves(p, s, d1, d2, depth = 2) {
  const moves = uniqueMoves(legalMoves(p, s, d1, d2));
  if (!moves.length || !moves[0].steps.length) return [];
  for (const m of moves) m.score1 = evaluate(m.pos, s);
  moves.sort((x, y) => y.score1 - x.score1);
  if (depth >= 2) {
    const top = moves.slice(0, 10);
    for (const m of top) { m.score = deep(m.pos, s); m.deep = true; }
    for (const m of moves.slice(10)) m.score = m.score1 - 50;
    moves.sort((x, y) => y.score - x.score);
  } else for (const m of moves) m.score = m.score1;
  return moves;
}

// The usual best opening moves (the first roll can't be a double).
export const OPENINGS = {
  '3-1': ['8/5 6/5', 'makes your 5-point, the most valuable point on the board'],
  '4-2': ['8/4 6/4', 'makes your 4-point'],
  '6-1': ['13/7 8/7', 'makes your bar point, blocking their back checkers'],
  '5-3': ['8/3 6/3', 'makes your 3-point'],
  '6-5': ['24/13', '"lover\'s leap": runs a back checker all the way to safety on your midpoint'],
  '6-4': ['24/14', 'runs a back checker towards safety'],
  '6-3': ['24/18 13/10', 'splits the back checkers and brings down a builder'],
  '6-2': ['24/18 13/11', 'splits the back checkers and brings down a builder'],
  '5-4': ['24/20 13/8', 'moves up a back checker and brings one safely to your 8-point'],
  '5-2': ['13/8 13/11', 'brings down two builders for making points'],
  '5-1': ['13/8 24/23', 'brings one checker to safety and splits the back checkers'],
  '4-3': ['24/20 13/10', 'splits and brings down a builder'],
  '4-1': ['24/23 13/9', 'brings down a builder and splits the back checkers'],
  '3-2': ['24/21 13/11', 'splits and brings down a builder'],
  '2-1': ['13/11 6/5', '"slots" your 5-point, hoping to cover it next turn'],
};

export function notation(steps) {
  // e.g. 13/7* 8/7 — combine same checker moving on (13/10/7 -> 13/7), mark hits with *
  const parts = [];
  const used = steps.map(() => false);
  for (let i = 0; i < steps.length; i++) {
    if (used[i]) continue;
    let cur = steps[i]; used[i] = true;
    let from = cur.from, to = cur.to, hit = cur.hit, hitMid = false;
    for (;;) {
      const j = steps.findIndex((t, k) => !used[k] && t.from === to && to !== 0);
      if (j < 0) break;
      if (hit) hitMid = true;
      used[j] = true; to = steps[j].to; hit = steps[j].hit;
    }
    const f = from === 25 ? 'bar' : from, t = to === 0 ? 'off' : to;
    parts.push(`${f}/${t}${hit || hitMid ? '*' : ''}`);
  }
  // merge identical parts: 8/5 8/5 -> 8/5(2)
  const counts = new Map();
  for (const x of parts) counts.set(x, (counts.get(x) || 0) + 1);
  return [...counts].map(([x, n]) => (n > 1 ? `${x}(${n})` : x)).join(' ');
}

export const LEVELS = [
  { id: 1, name: 'Rookie', blurb: 'Just learning. Moves almost at random and leaves checkers open to being hit.' },
  { id: 2, name: 'Novice', blurb: 'Hits when it can and makes points, but doesn\'t think about your reply.' },
  { id: 3, name: 'Club player', blurb: 'Plays sound moves and knows the standard openings.' },
  { id: 4, name: 'Expert', blurb: 'Looks at every reply you could roll. Tough to beat.' },
];

const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

export function computerMove(p, s, d1, d2, level, opening) {
  if (opening && level >= 3) {
    const k = `${Math.max(d1, d2)}-${Math.min(d1, d2)}`;
    const book = OPENINGS[k];
    if (book) {
      const m = uniqueMoves(legalMoves(p, s, d1, d2)).find(x => notation(x.steps) === book[0] || sameMove(x, book[0]));
      if (m) return m;
    }
  }
  const ranked = rankMoves(p, s, d1, d2, level >= 4 ? 2 : 1);
  if (!ranked.length) return null;
  if (level === 1) {
    if (Math.random() < 0.45) return ranked[Math.floor(Math.random() * ranked.length)];
    return pickNoisy(ranked, 14);
  }
  if (level === 2) return pickNoisy(ranked, 5);
  return ranked[0];
}
function sameMove(m, text) {
  const norm = t => t.split(' ').sort().join(' ');
  return norm(notation(m.steps)) === norm(text);
}
function pickNoisy(ranked, sigma) {
  let best = null, bs = -Infinity;
  for (const m of ranked) { const v = m.score + gauss() * sigma; if (v > bs) { bs = v; best = m; } }
  return best;
}

// Cube decisions, using the rough win chance (no gammons — fine for learning).
export function shouldDouble(p, s, level) {
  const w = winChance(p, s);
  const lo = [0, 0.8, 0.72, 0.68, 0.68][level], hi = 0.97;
  return w >= lo && w <= hi;
}
export function shouldTake(p, s, level) {
  const w = winChance(p, s);
  const need = [0, 0.15, 0.22, 0.25, 0.25][level];
  return w >= need;
}
