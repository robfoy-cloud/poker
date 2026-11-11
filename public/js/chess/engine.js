// Chess opponent and analysis. Uses chess.js for the rules and a small
// alpha-beta search with piece-square tables for judgement.
// (Uses chess.js's internal fast move generator; the vendored version is pinned.)

import { Chess } from '../vendor/chess.js';

export const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100000;

// Piece-square tables from White's point of view, rank 8 first (the "simplified evaluation function").
const PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  kEnd: [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50],
};

// Score from the point of view of the side to move.
export function evaluate(chess) {
  const board = chess._board;
  let score = 0, nonPawn = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const pc = board[sq];
    if (pc && pc.type !== 'p' && pc.type !== 'k') nonPawn += VALUE[pc.type];
  }
  const endgame = nonPawn <= 2600;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const pc = board[sq];
    if (!pc) continue;
    const row = sq >> 4, col = sq & 7;
    const idx = pc.color === 'w' ? row * 8 + col : (7 - row) * 8 + col;
    const table = pc.type === 'k' && endgame ? PST.kEnd : PST[pc.type];
    const v = VALUE[pc.type] + table[idx];
    score += pc.color === 'w' ? v : -v;
  }
  return chess.turn() === 'w' ? score : -score;
}

function orderMoves(moves) {
  for (const m of moves) {
    m._order = (m.captured ? 10 * VALUE[m.captured] - VALUE[m.piece] + 10000 : 0) + (m.promotion ? 8000 : 0);
  }
  return moves.sort((a, b) => b._order - a._order);
}

class Search {
  constructor(chess, { quiesce = true, deadline = Infinity } = {}) {
    this.c = chess; this.quiesce = quiesce; this.deadline = deadline; this.nodes = 0; this.stopped = false;
  }
  qsearch(alpha, beta, depth) {
    this.nodes++;
    const stand = evaluate(this.c);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (depth <= 0) return alpha;
    const moves = orderMoves(this.c._moves({ legal: true }).filter(m => m.captured || m.promotion));
    for (const m of moves) {
      this.c._makeMove(m);
      const s = -this.qsearch(-beta, -alpha, depth - 1);
      this.c._undoMove();
      if (s >= beta) return beta;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }
  negamax(depth, alpha, beta, ply) {
    this.nodes++;
    if ((this.nodes & 1023) === 0 && Date.now() > this.deadline) this.stopped = true;
    if (this.stopped) return 0;
    const moves = this.c._moves({ legal: true });
    if (!moves.length) return this.c.isCheck() ? -MATE + ply : 0;
    if (ply > 0 && this.c.isDraw()) return 0;
    if (depth <= 0) return this.quiesce ? this.qsearch(alpha, beta, 4) : evaluate(this.c);
    orderMoves(moves);
    let best = -Infinity;
    for (const m of moves) {
      this.c._makeMove(m);
      const s = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      this.c._undoMove();
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    return best;
  }
}

// Score every legal move (from the mover's side) to the given depth.
// Returns [{ move (verbose chess.js move), score }] best first.
export function scoreMoves(fen, depth, opts = {}) {
  const c = new Chess(fen);
  const s = new Search(c, opts);
  const verbose = c.moves({ verbose: true });
  const internal = c._moves({ legal: true });
  const out = [];
  for (let i = 0; i < internal.length; i++) {
    const m = internal[i];
    c._makeMove(m);
    const score = depth <= 1 ? -(opts.quiesce === false ? evaluate(c) : s.qsearch(-Infinity, Infinity, 4)) : -s.negamax(depth - 1, -Infinity, Infinity, 1);
    c._undoMove();
    const v = verbose.find(x => x.from === sqName(m.from) && x.to === sqName(m.to) && (x.promotion || null) === (m.promotion || null));
    out.push({ move: v, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

function sqName(i) { return 'abcdefgh'[i & 7] + (8 - (i >> 4)); }

// Best move with iterative deepening and a time limit.
export function bestMove(fen, { maxDepth = 3, timeMs = 1500 } = {}) {
  const start = Date.now();
  let result = null;
  for (let d = 1; d <= maxDepth; d++) {
    const scored = scoreMoves(fen, d, { deadline: start + timeMs });
    if (Date.now() > start + timeMs && result) break;
    result = { ...scored[0], depth: d, all: scored };
    if (Math.abs(result.score) > MATE - 100) break;
  }
  return result;
}

export const LEVELS = [
  { id: 1, name: 'Rookie', blurb: 'Brand new to chess. Makes plenty of mistakes and often leaves pieces to be taken.' },
  { id: 2, name: 'Novice', blurb: 'Knows the moves and grabs free pieces, but doesn\'t look far ahead.' },
  { id: 3, name: 'Club player', blurb: 'Looks two moves ahead and punishes loose pieces.' },
  { id: 4, name: 'Expert', blurb: 'Looks three moves ahead and plays solid chess. A real challenge.' },
];

const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// The opponent's choice at each level.
export function opponentMove(fen, level) {
  if (level === 1) {
    const scored = scoreMoves(fen, 1, { quiesce: false });
    if (Math.random() < 0.35) return scored[Math.floor(Math.random() * scored.length)].move;
    return pickNoisy(scored, 220);
  }
  if (level === 2) return pickNoisy(scoreMoves(fen, 1, { quiesce: true }), 60);
  if (level === 3) return pickNoisy(scoreMoves(fen, 2), 15);
  const b = bestMove(fen, { maxDepth: 3, timeMs: 2500 });
  return pickNoisy(b.all, 5);
}

function pickNoisy(scored, sigma) {
  let best = null, bestS = -Infinity;
  for (const s of scored) {
    // never miss a mate in one, whatever the level
    if (s.score > MATE - 10) return s.move;
    const v = s.score + gauss() * sigma;
    if (v > bestS) { bestS = v; best = s.move; }
  }
  return best;
}

export { MATE };
