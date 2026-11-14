import { BJGame } from '../public/js/blackjack/game.js';
import { handValue, isPair } from '../public/js/blackjack/rules.js';
let splits = 0, aceSplits = 0, resplits = 0, doubles = 0, dealerBJ = 0, bjs = 0, ins = 0, rounds = 0, shuffles = 0, maxHands = 0;
for (let g = 0; g < 200; g++) {
  const n = 1 + (g % 5);
  const players = Array.from({ length: n }, (_, i) => ({ name: 'P' + i, isHuman: i === Math.floor(n / 2), style: i % 2 ? 'hunch' : 'book' }));
  const stack = 1000;
  let total;
  const io = {
    async event(type, d, game) {
      if (type === 'split') { splits++; if (d.aces) aceSplits++; }
      if (type === 'split' && d.seat.hands.length > 2) resplits++;
      if (type === 'action' && d.act === 'double') doubles++;
      if (type === 'peek' && d.dealerBJ) dealerBJ++;
      if (type === 'blackjack') bjs++;
      if (type === 'insurance' && d.took) ins++;
      if (type === 'shuffle') shuffles++;
      if (type === 'card' && d.hand.cards.length > 2 && d.hand.splitAces) throw new Error('split ace got extra card');
      for (const s of game.seats) maxHands = Math.max(maxHands, s.hands.length);
      if (type === 'roundEnd') {
        const sum = game.seats.reduce((t, s) => t + s.stack, 0) + game.house;
        if (sum !== total) throw new Error(`money not conserved: ${sum} vs ${total}`);
        rounds++;
      }
      if (type === 'dealerDone' && d.live) { const v = handValue(game.dealer.cards); if (v.total < 17) throw new Error('dealer stopped below 17'); if (v.total >= 17 && game.dealer.cards.length > 2) { const prev = handValue(game.dealer.cards.slice(0, -1)); if (prev.total >= 17) throw new Error('dealer drew on 17+'); } }
      if (type === 'card' && d.deal === undefined && d.hand && handValue(d.hand.cards).total > 21 && d.hand.cards.length === 2) throw new Error('two-card bust?');
    },
    async humanBet(s, ctx) { return [10, 20, 25, 50, 15][Math.floor(Math.random() * 5)]; },
    async humanInsurance() { return Math.random() < 0.3; },
    async humanAction(s, ctx) {
      // mostly basic strategy, but split every pair we can to exercise splitting
      if (ctx.allowed.split && Math.random() < 0.8) return 'split';
      return Math.random() < 0.8 ? ctx.best : ['hit', 'stand', 'double', 'split', 'surrender'][Math.floor(Math.random() * 5)];
    },
  };
  const game = new BJGame({ players, stack, surrender: g % 2 === 0 }, io);
  total = n * stack;
  for (let r = 0; r < 150 && !game.over; r++) await game.playRound();
}
console.log({ rounds, splits, aceSplits, resplits, maxHands, doubles, bjs, dealerBJ, ins, shuffles });
