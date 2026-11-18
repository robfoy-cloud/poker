// Backgammon words. Coach text marks them {{term}} or {{term|shown text}}.

export const BG_GLOSSARY = {
  'point': 'One of the 24 long triangles. Points are numbered 1 to 24 from your own side: your 1-point is the last one before you bear off. "Making a point" means putting two or more of your checkers on it.',
  'made point': 'A point with two or more of your checkers. Your opponent can\'t land there, so it blocks them.',
  'blot': 'A single checker alone on a point. If your opponent lands on it, it\'s hit and sent to the bar.',
  'hit': 'Landing on a point with just one enemy checker (a blot). That checker goes to the bar and has to start again. Written with a * in notation, like 13→7*.',
  'bar': 'The ridge down the middle of the board. Hit checkers wait there and must re-enter into the opponent\'s home board before their owner may move anything else.',
  'enter': 'Bringing a checker in from the bar. A roll of 3 enters on the opponent\'s 3-point (your 22-point), and so on — but only onto a point that isn\'t blocked.',
  'dance': 'Failing to enter from the bar because both numbers you rolled land on blocked points. You lose your whole turn.',
  'home board': 'Your points 1 to 6, in the corner where you finish. Once all 15 of your checkers are there, you can start bearing off.',
  'outer board': 'Points 7 to 12 (yours) and 13 to 18 (your opponent\'s).',
  'bear off': 'Taking your checkers off the board once they\'re all in your home board. First to bear off all 15 wins.',
  'pip count': 'How far you have to go in total: add up each checker\'s point number (a checker on the bar counts 25). Lower is better. At the start each side has 167.',
  'pip': 'One step along the board. A roll of 6-4 moves 10 pips.',
  'race': 'A position where the two armies have passed each other and no more hitting is possible. Then only the pip count and the dice matter.',
  'contact': 'When checkers could still hit each other — the armies haven\'t passed yet.',
  'anchor': 'A point you hold (two or more checkers) in your opponent\'s home board. It gives your back checkers a safe landing spot.',
  'prime': 'Several made points in a row. Six in a row is a full prime: nothing behind it can get past.',
  'golden point': 'Your 5-point — the most valuable point to make early. It blocks the opponent and builds your home board.',
  'bar point': 'Your 7-point, just outside your home board. With your 6- and 8-points it starts a strong block.',
  'midpoint': 'Your 13-point, where five of your checkers start.',
  'back checkers': 'Your two checkers that start on your 24-point, deep in the opponent\'s home board.',
  'builder': 'A checker placed within reach of a point you want to make next turn.',
  'slot': 'Putting a single checker on a point you want to make, hoping to cover it (add a second) next turn — risky, since it can be hit.',
  'split': 'Moving your two back checkers apart, usually to different points in the opponent\'s home board.',
  'shots': 'The number of the 36 possible rolls that would hit a blot. "Six shots" means 6 rolls out of 36 hit it.',
  'doubles': 'Rolling the same number on both dice. You move that number four times, not twice.',
  'opening roll': 'To start, each player rolls one die. The higher number goes first, using both dice as their roll.',
  'doubling cube': 'The die marked 2, 4, 8, 16, 32 and 64. A player who thinks they\'re winning can offer to double the stakes before rolling.',
  'double': 'Offering to double the stakes before your roll. The opponent must take or drop.',
  'take': 'Accepting a double: the game continues for twice the stakes, and you now own the cube (only you can double next).',
  'drop': 'Refusing a double (also called "pass"). You give up the game straight away and lose the current stake.',
  'gammon': 'Winning before your opponent has borne off a single checker. It counts double.',
  'backgammon': 'Winning while your opponent still has a checker on the bar or in your home board. It counts triple — and it gave the game its name.',
  'closed board': 'All six home-board points made. A checker on the bar can\'t enter at all.',
  'running game': 'A plan to race home: get your back checkers out and avoid contact.',
  'holding game': 'Keeping an anchor in the opponent\'s home board and waiting for a shot.',
  'notation': 'Moves are written from-point → to-point, counted from the mover\'s side: 13→7 8→7 means one checker from 13 to 7 and one from 8 to 7. "bar→22" enters from the bar; "6→off" bears off; * marks a hit. (Books usually write a slash instead: 13/7.)',
  'tempo': 'Timing. A hit "gains tempo" because your opponent must spend their next roll re-entering.',
};

export function lookupBG(term) {
  const t = term.toLowerCase().trim();
  return BG_GLOSSARY[t] ? { term: t, def: BG_GLOSSARY[t] } : null;
}
export function searchBGGlossary(q) {
  const s = q.toLowerCase().trim();
  return Object.keys(BG_GLOSSARY).sort().filter(k => !s || k.includes(s) || BG_GLOSSARY[k].toLowerCase().includes(s)).map(k => ({ term: k, def: BG_GLOSSARY[k] }));
}
