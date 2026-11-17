import * as E from '../public/js/backgammon/engine.js';
const total = (p, s) => { let t = 0; for (let i = 0; i <= 25; i++) t += p.a[s][i]; return t; };
// rule checks
let p = E.START();
const m31 = E.uniqueMoves(E.legalMoves(p, 0, 3, 1));
console.log('3-1 from start distinct moves:', m31.length, '| book found:', !!m31.find(m => E.notation(m.steps) === '8/5 6/5'));
// bar entry: side 0 has a checker on the bar; opponent's home board closed except one point
let q = E.START(); q.a[0][24]--; q.a[0][25]++;
for (const i of [1,2,3,4,5]) q.a[1][i] = 2; q.a[1][6] = 0; q.a[1][13] = 0; q.a[1][8] = 0; q.a[1][24] = 5;
console.log('bar: 6-6 can enter on their 6pt? ', E.legalMoves(q, 0, 6, 6).length, '| 5-5 dance:', E.legalMoves(q, 0, 5, 5)[0].steps.length === 0);
// larger-die rule: only one die playable
let r = { a: [new Int8Array(26), new Int8Array(26)] }; r.a[0][6] = 1; r.a[0][0] = 14; r.a[1][24] = 15;
console.log('bear off 6-5 with one checker on 6:', E.notation(E.legalMoves(r, 0, 6, 5)[0].steps));
let t = Date.now();
p = E.START(); E.rankMoves(p, 0, 6, 6, 2); console.log('2-ply 6-6 from start ms', Date.now() - t);
t = Date.now(); E.rankMoves(p, 0, 4, 2, 2); console.log('2-ply 4-2 ms', Date.now() - t);
// full games: computer vs computer at each level pair; check conservation and that games end
const results = { 0: 0, 1: 0 }, kinds = { 1: 0, 2: 0, 3: 0 };
let maxMs = 0, games = 0;
for (let g = 0; g < 40; g++) {
  let pos = E.START(), s = g % 2, turns = 0;
  const lv = [1 + (g % 4), 1 + ((g >> 2) % 4)];
  while (E.winner(pos) < 0 && turns < 600) {
    const d1 = 1 + Math.floor(Math.random() * 6), d2 = 1 + Math.floor(Math.random() * 6);
    const t0 = Date.now();
    const m = E.computerMove(pos, s, d1, d2, lv[s] === 4 && turns > 40 ? 3 : lv[s], turns < 2);
    maxMs = Math.max(maxMs, Date.now() - t0);
    if (m) pos = m.pos;
    for (const x of [0, 1]) if (total(pos, x) !== 15) throw new Error('checkers not conserved');
    for (let i = 1; i <= 24; i++) if (pos.a[0][i] && pos.a[1][25 - i]) throw new Error('both sides on one point');
    s = 1 - s; turns++;
  }
  const w = E.winner(pos); if (w < 0) throw new Error('game did not finish');
  results[w]++; kinds[E.winKind(pos, w)]++; games++;
}
console.log({ games, results, kinds, slowestMoveMs: maxMs });
// strength check: expert (4) vs rookie (1)
let exp = 0;
for (let g = 0; g < 20; g++) {
  let pos = E.START(), s = g % 2, turns = 0;
  while (E.winner(pos) < 0) { const d1 = 1 + Math.floor(Math.random() * 6), d2 = 1 + Math.floor(Math.random() * 6); const m = E.computerMove(pos, s, d1, d2, s === 0 ? 3 : 1, turns < 2); if (m) pos = m.pos; s = 1 - s; turns++; }
  if (E.winner(pos) === 0) exp++;
}
console.log('club player beat rookie in', exp, 'of 20');
