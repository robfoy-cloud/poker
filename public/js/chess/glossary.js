// Chess words. Coach text marks them {{term}} or {{term|shown text}}.

export const CHESS_GLOSSARY = {
  'check': 'An attack on the king. The player in check must get out of it at once — move the king, block the attack, or capture the attacking piece.',
  'checkmate': 'Check with no way out. The game ends and the side that delivered it wins. Often just "mate".',
  'stalemate': 'The player to move is not in check but has no legal move. The game is a draw — a classic way to throw away a won game.',
  'draw': 'A game nobody wins: stalemate, agreement, the same position three times, 50 moves with no capture or pawn move, or too few pieces left to checkmate.',
  'castling': 'A special move of king and rook together: the king moves two squares towards a rook, which jumps to the square the king crossed. Allowed only if neither piece has moved, the squares between are empty, and the king is not in check, does not pass through check, and does not land in check.',
  'kingside': 'The half of the board where the kings start (files e–h). Castling kingside is "short castling", written O-O.',
  'queenside': 'The half of the board where the queens start (files a–d). Castling queenside is "long castling", written O-O-O.',
  'en passant': '"In passing": if a pawn moves two squares and lands beside an enemy pawn, that pawn may capture it as if it had moved only one — but only on the very next move.',
  'promotion': 'When a pawn reaches the far side of the board it becomes a queen, rook, bishop or knight. Almost always a queen.',
  'algebraic notation': 'How chess moves are written. Files are a–h, ranks 1–8. Pieces are K, Q, R, B, N (knight); pawns have no letter. "x" is a capture, "+" check, "#" checkmate. Nf3 means knight to f3; exd5 means the e-pawn captures on d5.',
  'file': 'A column of squares, a to h, running between the players.',
  'rank': 'A row of squares, 1 to 8. White starts on ranks 1 and 2, Black on 7 and 8.',
  'diagonal': 'A slanting line of squares of one colour. Bishops (and the queen) move along them.',
  'centre': 'The four middle squares, d4, e4, d5 and e5. Pieces in or aimed at the centre control more of the board.',
  'develop': 'To bring a piece off its starting square into play, especially knights and bishops in the opening.',
  'development': 'Getting your pieces out into play. Good opening play develops quickly, knights and bishops first.',
  'opening': 'The first stage of the game: control the centre, develop your pieces and get your king safe (usually by castling).',
  'middlegame': 'The stage after the opening, when the pieces are out and plans and attacks happen.',
  'endgame': 'The final stage, with few pieces left. The king becomes a fighting piece and pawns race to promote.',
  'material': 'The pieces you have, counted by value: pawn 1, knight 3, bishop 3, rook 5, queen 9.',
  'piece values': 'A rough guide: pawn 1, knight 3, bishop 3, rook 5, queen 9. The king is priceless.',
  'hanging': 'A piece that is attacked and not defended — it can simply be taken for free.',
  'defended': 'Protected by one of your own pieces, so if it is captured you can capture back.',
  'trade': 'Exchanging pieces of about the same value. Also called an exchange.',
  'exchange': 'Swapping pieces. "Winning the exchange" means winning a rook for a bishop or knight.',
  'fork': 'One piece attacking two or more enemy pieces at once. Knights are famous for it.',
  'pin': 'An attack on a piece that cannot move without exposing something more valuable behind it.',
  'skewer': 'Like a pin in reverse: a valuable piece is attacked and when it moves, the piece behind it is taken.',
  'discovered attack': 'Moving one piece out of the way to reveal an attack by another piece behind it.',
  'tempo': 'A move\'s worth of time. Gaining a tempo means making progress while forcing your opponent to respond.',
  'gambit': 'An opening that offers a pawn (or more) in return for quick development or attack.',
  'fianchetto': 'Developing a bishop to b2/g2 (or b7/g7) behind a pawn moved one square — the bishop watches the long diagonal.',
  'king safety': 'Keeping your king away from attack — usually by castling and keeping the pawns in front of it.',
  'blunder': 'A serious mistake, usually losing material or allowing checkmate.',
  'threat': 'Something your opponent will do next move if you don\'t stop it, like capturing a piece.',
  'capture': 'Taking an enemy piece by moving onto its square. Only pawns capture differently from how they move.',
  'back rank': 'Your first rank. A "back-rank mate" happens when the king is trapped there by its own pawns.',
  'open file': 'A file with no pawns on it. Rooks love open files.',
  'passed pawn': 'A pawn with no enemy pawns able to stop it on its way to promotion.',
  'threefold repetition': 'If the same position happens three times with the same player to move, the game is a draw.',
  'fifty-move rule': 'If 50 moves each go by with no capture and no pawn move, the game is a draw.',
  'insufficient material': 'When neither side has enough pieces left to checkmate (for example king against king), the game is drawn.',
  'resign': 'To give up the game. Common among strong players when the position is hopeless.',
  'pawn': 'Moves one square straight forward (two from its starting square) and captures one square diagonally forward. Worth 1.',
  'knight': 'Moves in an L: two squares one way and one to the side. The only piece that jumps over others. Worth 3.',
  'bishop': 'Moves any distance diagonally, staying on one colour all game. Worth 3.',
  'rook': 'Moves any distance in straight lines along ranks and files. Worth 5.',
  'queen': 'Moves any distance in any straight line or diagonal — the most powerful piece. Worth 9.',
  'king': 'Moves one square in any direction. Must never be left in check. Losing it means losing the game.',
};

export function lookupChess(term) {
  const t = term.toLowerCase().trim();
  return CHESS_GLOSSARY[t] ? { term: t, def: CHESS_GLOSSARY[t] } : null;
}

export function searchChessGlossary(q) {
  const s = q.toLowerCase().trim();
  const keys = Object.keys(CHESS_GLOSSARY).sort();
  if (!s) return keys.map(k => ({ term: k, def: CHESS_GLOSSARY[k] }));
  return keys.filter(k => k.includes(s) || CHESS_GLOSSARY[k].toLowerCase().includes(s)).map(k => ({ term: k, def: CHESS_GLOSSARY[k] }));
}
