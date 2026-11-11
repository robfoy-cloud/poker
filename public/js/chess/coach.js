// What moves mean, in plain words with chess vocabulary.

import { Chess } from '../vendor/chess.js';
import { VALUE } from './engine.js';

export const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const PIECE_PTS = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const other = c => (c === 'w' ? 'b' : 'w');
const SQUARES = []; for (const r of '87654321') for (const f of 'abcdefgh') SQUARES.push(f + r);

export function pts(n) { return n === 1 ? '1 point' : `${n} points`; }

// Pieces of `color` that are attacked and either undefended or attacked by something cheaper.
export function loosePieces(chess, color) {
  const out = [];
  for (const sq of SQUARES) {
    const pc = chess.get(sq);
    if (!pc || pc.color !== color || pc.type === 'k') continue;
    const attackers = chess.attackers(sq, other(color));
    if (!attackers.length) continue;
    const defenders = chess.attackers(sq, color);
    const cheapest = Math.min(...attackers.map(a => VALUE[chess.get(a).type]));
    if (!defenders.length || cheapest < VALUE[pc.type]) out.push({ sq, type: pc.type, defended: defenders.length > 0, by: attackers });
  }
  return out.sort((a, b) => VALUE[b.type] - VALUE[a.type]);
}

// Squares attacked by the piece standing on `from` (works for any piece, any side to move).
function attackedBy(chess, from) {
  const pc = chess.get(from);
  const out = [];
  for (const sq of SQUARES) {
    const t = chess.get(sq);
    if (!t || t.color === pc.color) continue;
    if (chess.attackers(sq, pc.color).includes(from)) out.push(sq);
  }
  return out;
}

const OPENINGS = [
  ['e4 e5 Nf3 Nc6 Bb5', 'the Ruy Lopez (also called the Spanish Game)'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5', 'the Italian Game (Giuoco Piano)'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6', 'the Two Knights Defence'],
  ['e4 e5 Nf3 Nc6 Bc4', 'the Italian Game'],
  ['e4 e5 Nf3 Nc6 d4', 'the Scotch Game'],
  ['e4 e5 Nf3 Nc6 Nc3 Nf6', 'the Four Knights Game'],
  ['e4 e5 Nf3 d6', 'the Philidor Defence'],
  ['e4 e5 Nf3 Nf6', "Petrov's Defence"],
  ['e4 e5 f4', "the King's Gambit"],
  ['e4 e5 Nc3', 'the Vienna Game'],
  ['e4 e5 Bc4', "the Bishop's Opening"],
  ['e4 e5 Qh5', 'an early queen attack (aiming at f7 — watch out for Scholar\'s Mate)'],
  ['e4 e5', "an Open Game (both king's pawns forward)"],
  ['e4 c5', 'the Sicilian Defence'],
  ['e4 e6', 'the French Defence'],
  ['e4 c6', 'the Caro-Kann Defence'],
  ['e4 d5', 'the Scandinavian Defence'],
  ['e4 Nf6', "Alekhine's Defence"],
  ['e4 d6', 'the Pirc Defence'],
  ['e4 g6', 'the Modern Defence'],
  ['e4', "the King's Pawn Opening"],
  ['d4 d5 c4 e6', "the Queen's Gambit Declined"],
  ['d4 d5 c4 dxc4', "the Queen's Gambit Accepted"],
  ['d4 d5 c4 c6', 'the Slav Defence'],
  ['d4 d5 c4', "the Queen's Gambit"],
  ['d4 d5 Bf4', 'the London System'],
  ['d4 Nf6 Bf4', 'the London System'],
  ['d4 d5 Nf3 Nf6 Bf4', 'the London System'],
  ['d4 Nf6 c4 g6', "the King's Indian Defence"],
  ['d4 Nf6 c4 e6 Nc3 Bb4', 'the Nimzo-Indian Defence'],
  ['d4 Nf6 c4 e6', 'an Indian Defence'],
  ['d4 f5', 'the Dutch Defence'],
  ['d4 d5', "a Closed Game (both queen's pawns forward)"],
  ['d4', "the Queen's Pawn Opening"],
  ['c4', 'the English Opening'],
  ['Nf3', 'the Réti Opening'],
];
export function openingName(sans) {
  const line = sans.join(' ');
  for (const [seq, name] of OPENINGS) if (line === seq || line.startsWith(seq + ' ')) return { seq, name };
  return null;
}

// Describe a move that has just been made. `before` and `after` are Chess objects.
export function describeMove(m, before, after, who) {
  const piece = PIECE[m.piece];
  const parts = [];
  let main;
  const san = `({{algebraic notation|${m.san}}})`;
  if (m.flags.includes('k')) main = `${who} {{castling|castle}} {{kingside}} ${san}: the king tucks into the corner and the rook comes towards the middle`;
  else if (m.flags.includes('q')) main = `${who} {{castling|castle}} {{queenside}} ${san}: the king goes to the c-file and the rook to the d-file`;
  else if (m.flags.includes('e')) main = `${who} capture {{en passant}} with the pawn ${m.from}→${m.to} ${san}`;
  else if (m.captured) main = `${who} take the ${PIECE[m.captured]} on ${m.to} with the ${piece} ${san}`;
  else main = `${who} move the ${piece} from ${m.from} to ${m.to} ${san}`;
  if (m.promotion) main += `, and the pawn {{promotion|promotes}} to a ${PIECE[m.promotion]}`;
  parts.push(main + '.');

  const mover = m.color;
  const theirs = other(mover);
  // check / mate
  if (after.isCheckmate()) { parts.push(`That's {{checkmate}}!`); return { text: parts.join(' '), reasons: ['checkmate'] }; }
  const reasons = [];
  if (after.isCheck()) reasons.push(`It gives {{check}} — the king must deal with it at once.`);
  if (before.isCheck()) reasons.push(`It gets out of {{check}}.`);

  // what the moved piece now attacks
  const targets = after.get(m.to) ? attackedBy(after, m.to).map(sq => ({ sq, type: after.get(sq).type })).filter(t => t.type !== 'k') : [];
  const valuable = targets.filter(t => VALUE[t.type] >= 300);
  if (valuable.length >= 2 || (after.isCheck() && valuable.length >= 1)) {
    const list = valuable.slice(0, 2).map(t => `the ${PIECE[t.type]} on ${t.sq}`);
    if (after.isCheck()) list.unshift('the king');
    reasons.push(`It's a {{fork}}: the ${PIECE[after.get(m.to).type]} attacks ${list.join(' and ')} at the same time.`);
  } else {
    for (const t of targets) {
      const def = after.attackers(t.sq, theirs).length;
      if (!def || VALUE[t.type] > VALUE[after.get(m.to).type]) {
        reasons.push(`It attacks the ${PIECE[t.type]} on ${t.sq}${!def ? ', which has no defender' : ''}.`);
        break;
      }
    }
  }
  // opening ideas
  const moveNo = before.moveNumber();
  if (moveNo <= 12 && !m.captured) {
    if ((m.piece === 'n' || m.piece === 'b') && (m.from[1] === '1' || m.from[1] === '8')) reasons.push(`It {{develop|develops}} a piece — getting knights and bishops out early is a key opening idea.`);
    else if (m.piece === 'p' && ['d4', 'e4', 'd5', 'e5'].includes(m.to)) reasons.push(`It stakes a claim in the {{centre}}.`);
    else if (m.piece === 'p' && ['c4', 'c5', 'f4', 'f5'].includes(m.to)) reasons.push(`It fights for the {{centre}} from the side.`);
    else if (m.piece === 'q' && moveNo <= 6) reasons.push(`Bringing the queen out this early can be risky — she can be chased around, losing {{tempo|time}}.`);
    else if (m.piece === 'k' && !m.flags.includes('k') && !m.flags.includes('q')) reasons.push(`Moving the king (other than castling) gives up the right to {{castling|castle}}.`);
  }
  if (m.flags.includes('k') || m.flags.includes('q')) reasons.push(`Castling improves {{king safety}} and connects the rooks.`);
  if (m.captured && VALUE[m.captured] >= VALUE[m.piece] - 20) {
    const recapture = after.attackers(m.to, theirs).length > 0;
    reasons.push(recapture ? `It can be taken back, so this is a {{trade}}.` : `Nothing can take back — that's {{material}} won (${pts(PIECE_PTS[m.captured])}).`);
  } else if (m.captured) {
    const recapture = after.attackers(m.to, theirs).length > 0;
    reasons.push(recapture ? `Careful — the ${piece} (worth ${PIECE_PTS[m.piece]}) can be taken back after grabbing something worth ${PIECE_PTS[m.captured]}.` : `Nothing can take back, so it wins ${pts(PIECE_PTS[m.captured])}.`);
  }
  // left hanging?
  const loose = loosePieces(after, mover).find(l => l.sq === m.to);
  if (loose && !after.isCheckmate()) reasons.push(`But the ${piece} on ${m.to} is now {{hanging|unprotected}} and under attack.`);
  return { text: [parts[0], ...reasons.slice(0, 3)].join(' '), reasons };
}

// Explain why a move isn't allowed.
export function whyIllegal(chess, from, to) {
  const pc = chess.get(from);
  if (!pc) return '';
  const f = c => 'abcdefgh'.indexOf(c[0]), r = c => +c[1];
  const df = f(to) - f(from), dr = r(to) - r(from);
  const ix = sq => (8 - r(sq)) * 16 + f(sq);
  const pseudo = chess._moves({ legal: false }).some(m => m.from === ix(from) && m.to === ix(to));
  const name = PIECE[pc.type];
  if (pseudo) {
    if (chess.isCheck()) return `You're in {{check}}, and that move doesn't get your king out of it. You must move the king, block the attack, or capture the attacker.`;
    if (pc.type === 'k') return `The king can't move to ${to} — that square is attacked, so it would be walking into {{check}}.`;
    return `That would leave your king in {{check}}: the ${name} is {{pin|pinned}} — it's shielding the king from an attack.`;
  }
  const target = chess.get(to);
  const blocked = () => {
    const sf = Math.sign(df), sr = Math.sign(dr);
    let c = f(from) + sf, rr = r(from) + sr;
    while (c !== f(to) || rr !== r(to)) {
      if (chess.get('abcdefgh'[c] + rr)) return true;
      c += sf; rr += sr;
    }
    return false;
  };
  switch (pc.type) {
    case 'p': {
      const fwd = pc.color === 'w' ? 1 : -1;
      if (df === 0 && target) return `Pawns can't capture straight ahead — the square in front is blocked. They capture one square diagonally forward.`;
      if (Math.abs(df) === 1 && dr === fwd && !target) return `Pawns only move diagonally when they're capturing something (or capturing {{en passant}}).`;
      if (dr * fwd < 0) return `Pawns can never move backwards.`;
      if (df === 0 && dr === 2 * fwd) return `A pawn can only move two squares from its starting square, and only if both squares are empty.`;
      return `A {{pawn}} moves one square straight forward (two on its first move) and captures one square diagonally forward.`;
    }
    case 'n': return `{{knight|Knights}} move in an L-shape: two squares one way, then one square to the side.`;
    case 'b': return Math.abs(df) === Math.abs(dr) ? `Bishops can't jump over pieces — something is in the way.` : `{{bishop|Bishops}} only move diagonally.`;
    case 'r': return (df === 0 || dr === 0) ? `Rooks can't jump over pieces — something is in the way.` : `{{rook|Rooks}} only move in straight lines, along a rank or a file.`;
    case 'q': return (df === 0 || dr === 0 || Math.abs(df) === Math.abs(dr)) && blocked() ? `The queen can't jump over pieces — something is in the way.` : `The {{queen}} moves in straight lines or diagonals, not like a knight.`;
    case 'k':
      if (Math.abs(df) === 2 && dr === 0) {
        if (chess.isCheck()) return `You can't {{castling|castle}} while you're in check.`;
        return `You can't {{castling|castle}} there right now: the king and that rook must not have moved, the squares between them must be empty, and the king can't pass through or land on an attacked square.`;
      }
      return `The {{king}} moves only one square at a time (except when castling).`;
  }
  return '';
}

export function pieceIntro(type) {
  return {
    p: `<b>Pawn.</b> Moves one square straight forward — two on its very first move. It captures one square diagonally forward. Reach the far side and it {{promotion|promotes}}, usually to a queen. Worth 1.`,
    n: `<b>Knight.</b> Moves in an L: two squares one way and one to the side. It's the only piece that can jump over others. Worth 3.`,
    b: `<b>Bishop.</b> Moves any distance diagonally, so it stays on one colour all game. Worth 3.`,
    r: `<b>Rook.</b> Moves any distance along a rank or file. Strongest on {{open file|open files}}. Worth 5.`,
    q: `<b>Queen.</b> Moves any distance in any straight line or diagonal — the most powerful piece. Worth 9, so don't lose her cheaply.`,
    k: `<b>King.</b> Moves one square in any direction and must never be left in {{check}}. It can also {{castling|castle}} once per game.`,
  }[type];
}

export function endText(chess, userColor) {
  if (chess.isCheckmate()) {
    const loser = chess.turn();
    return { result: loser === userColor ? 'loss' : 'win', text: loser === userColor ? `{{checkmate|Checkmate}} — your king is in check with no escape. Have a look back at the last few moves to see how the attack came together.` : `{{checkmate|Checkmate}}! Their king is attacked and has no way out. You win!` };
  }
  if (chess.isStalemate()) return { result: 'draw', text: `{{stalemate|Stalemate}}: it's ${chess.turn() === userColor ? 'your' : 'their'} move, the king is not in check, but there are no legal moves. That's a draw. When you're winning, always leave the enemy king a square to move to!` };
  if (chess.isThreefoldRepetition()) return { result: 'draw', text: `Draw by {{threefold repetition}}: the same position has appeared three times.` };
  if (chess.isInsufficientMaterial()) return { result: 'draw', text: `Draw by {{insufficient material}}: neither side has enough pieces left to deliver checkmate.` };
  if (chess.isDrawByFiftyMoves()) return { result: 'draw', text: `Draw by the {{fifty-move rule}}: 50 moves each with no capture and no pawn move.` };
  return null;
}

export function materialBalance(chess) {
  let w = 0, b = 0;
  const taken = { w: [], b: [] };
  const start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const have = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const row of chess.board()) for (const pc of row) if (pc && pc.type !== 'k') {
    have[pc.color][pc.type]++;
    if (pc.color === 'w') w += PIECE_PTS[pc.type]; else b += PIECE_PTS[pc.type];
  }
  for (const c of ['w', 'b']) for (const t of ['q', 'r', 'b', 'n', 'p']) for (let i = have[c][t]; i < start[t]; i++) taken[c].push(t);
  return { w, b, taken };
}

export { other, cap, PIECE_PTS };
