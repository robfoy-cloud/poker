import { Game } from '../public/js/engine.js';
import { botDecide } from '../public/js/ai.js';
import { evaluate } from '../public/js/cards.js';
import { Coach } from '../public/js/coach.js';

// --- evaluator sanity ---
const C = (s) => { const m = s.match(/^(10|[2-9TJQKA])([shdc])$/); const map={T:10,J:11,Q:12,K:13,A:14}; return { r: map[m[1]] || +m[1], s: m[2] }; };
const H = s => s.split(' ').map(C);
const cases = [
  ['As Ks Qs Js Ts 2d 3c', 8], ['5h 4h 3h 2h Ah Kd Kc', 8], ['7s 7h 7d 7c Kd 2c 3d', 7],
  ['Ks Kh Kc 4d 4s 2c 2d', 6], ['Ks Kh Kc Qd Qs Qc 2d', 6], ['Ad Jd 8d 6d 2d Kc Qs', 5],
  ['Ac 2d 3s 4h 5c Kd Kh', 4], ['Tc 9d 8s 7h 6c 5d 2h', 4], ['Qs Qh Qd 9c 3s 2d 7h', 3],
  ['Jh Jc 5s 5d Ah 3c 3d', 2], ['Ts Th Ac 8d 4h 3s 2c', 1], ['As Qd 9h 6c 3d 2s 8h', 0],
];
for (const [h, cat] of cases) { const e = evaluate(H(h)); if (e.cat !== cat) throw new Error(`eval ${h}: got ${e.cat} ${e.name}`); }
if (evaluate(H('Jh Jc 5s 5d Ah 3c 3d')).kickers[2] !== 14) throw new Error('two pair kicker');
if (evaluate(H('Ac 2d 3s 4h 5c Kd Kh')).kickers[0] !== 5) throw new Error('wheel');
console.log('evaluator ok');

// --- full game simulations ---
const silentUI = { coachSay(){}, newHandDivider(){}, waitContinue: async () => {}, sleep: async () => {} };
let mistakes = {}, reasons = {}, hands = 0, sidepots = 0, splits = 0, showdowns = 0;
for (let g = 0; g < 300; g++) {
  const n = 2 + (g % 8);
  const level = 1 + (g % 3);
  const coach = new Coach(silentUI, { level });
  const players = Array.from({ length: n }, (_, i) => ({ name: 'P' + i, isHuman: i === 0, style: ['rock','tag','lag','station','solid'][i % 5] }));
  const stack = [500, 1000, 1500][g % 3];
  let total = n * stack;
  const io = {
    async event(type, d, game) {
      await coach.event(type, d, game);
      if (type === 'mistake') mistakes[d.kind] = (mistakes[d.kind] || 0) + 1;
      if (type === 'roundEnd') reasons[d.reason] = (reasons[d.reason] || 0) + 1;
      if (type === 'showdown') { showdowns++; if (d.results.length > 1) sidepots++; if (d.results.some(r => r.split)) splits++; }
      const sum = game.players.reduce((t, p) => t + p.stack + p.bet, 0) + game.pot;
      if (sum !== total) throw new Error(`chips not conserved after ${type}: ${sum} vs ${total}`);
      for (const p of game.players) if (p.stack < 0) throw new Error('negative stack');
      if (type === 'action') {
        // everyone's bet is <= currentBet
        for (const p of game.players) if (p.bet > game.currentBet) throw new Error('bet above current');
      }
      if (type === 'newHand') { game._firstTurn = true; }
      if (type === 'dealt' || type === 'street') game._firstTurn = true;
      if (type === 'turn' && game._firstTurn) {
        game._firstTurn = false;
        const exp = game.street === 'preflop' ? game.nextSeat(game.bbSeat, p => !p.out && !p.folded && !p.allIn) : game.nextSeat(game.button, p => !p.out && !p.folded && !p.allIn);
        if (game.street === 'preflop') {
          const raw = game.nextSeat(game.bbSeat, p => !p.out);
          if (game.players[raw].allIn === false && d.seat !== raw) throw new Error('preflop first actor wrong');
          if (game.live().length === 2 && !game.players[game.button].allIn && d.seat !== game.button && !game.players[raw].allIn) throw new Error('heads-up preflop');
        } else if (d.seat !== exp) throw new Error('postflop first actor wrong');
        if (game.street !== 'preflop' && game.live().length === 2 && d.seat === game.button && !game.players[game.bbSeat].folded && !game.players[game.bbSeat].allIn) throw new Error('heads-up postflop: BB should act first');
      }
      if (type === 'roundEnd' && (d.reason === 'called' || d.reason === 'checked' || d.reason === 'limped')) {
        for (const p of game.canAct()) if (p.bet !== game.currentBet) throw new Error('round ended unmatched');
      }
      if (type === 'street') {
        const expect = { flop: 3, turn: 4, river: 5 }[d.street];
        if (game.board.length !== expect || game.burned.length !== expect - 2) throw new Error('board/burn count');
      }
    },
    async botAction(p, ctx, game) { return botDecide(game, p, ctx); },
    async humanPost(ctx) { return Math.random() < 0.2 ? ctx.amount + 5 : ctx.amount; },
    async humanAction(ctx, game) {
      const r = Math.random();
      if (r < 0.1) return { type: 'fold' };
      if (r < 0.2) return { type: 'check' };
      if (r < 0.3) return { type: 'chips', amount: Math.max(1, Math.floor(ctx.toCall / 2)) };
      if (r < 0.6) return ctx.toCall === 0 ? { type: 'check' } : { type: 'chips', amount: ctx.toCall };
      if (r < 0.75) return { type: 'chips', amount: Math.min(ctx.stack, ctx.toCall + 1) };
      if (r < 0.9) return { type: 'chips', amount: Math.min(ctx.stack, ctx.minRaiseTo - ctx.myBet) };
      return { type: 'chips', amount: ctx.stack };
    },
    async dealerStep(ctx) {
      const g = ctx.game;
      if (ctx.step === 'firstCard') return Math.random() < 0.2 ? g.button : g.nextSeat(g.button, p => !p.out);
      if (ctx.step.endsWith(':first')) return Math.random() < 0.2 ? 'deal' : 'burn';
      return Math.random() < 0.2 ? 2 : (ctx.street === 'flop' ? 3 : 1);
    },
  };
  const game = new Game({ players, stack, sb: 5, bb: 10 }, io);
  let guard = 0;
  while (!game.over && guard++ < 400) { await game.playHand(); hands++; }
}
console.log({ hands, showdowns, sidepots, splits, mistakes, reasons });
