// Showdown trainer: a full board and two to four hands face up. You pick the winner,
// then see each player's best five cards and why the winner wins.

import { newDeck, shuffle, bestFive, evaluate, RANK_NAME, RANK_PLURAL, CATEGORY } from './cards.js';
import { cardHTML } from './ui.js';

const $ = id => document.getElementById(id);
const NAMES = ['Ava', 'Ben', 'Cleo', 'Dev', 'Esme', 'Finn', 'Gus', 'Hana'];
const ORD = ['highest', 'second', 'third', 'fourth', 'fifth'];
const lc = s => s.toLowerCase();
const key = c => c.r + c.s;

function catTerm(cat) {
  return ['{{high card}}', '{{one pair|a pair}}', '{{two pair}}', '{{three of a kind}}', 'a {{straight}}', 'a {{flush}}', 'a {{full house}}', '{{four of a kind}}', 'a {{straight flush}}'][cat];
}

// Why does hand A beat hand B (same category)? Uses the kicker lists from evaluate().
function tieBreak(a, b, nameA, nameB) {
  const ka = a.kickers, kb = b.kickers;
  let i = 0;
  while (i < 5 && (ka[i] || 0) === (kb[i] || 0)) i++;
  const A = ka[i], B = kb[i];
  const R = r => RANK_NAME[r].toLowerCase(), P = r => RANK_PLURAL[r].toLowerCase();
  switch (a.cat) {
    case 0: return `Compare one card at a time: the ${ORD[i]} card decides it — ${nameA}'s ${R(A)} beats ${nameB}'s ${R(B)}.`;
    case 1: return i === 0 ? `${nameA}'s pair of ${P(A)} beats ${nameB}'s pair of ${P(B)}.`
      : `Both have a pair of ${P(ka[0])}, so it comes down to the {{kicker|kickers}}. ${i > 1 ? `The first ${i - 1 === 1 ? 'kicker is' : 'kickers are'} the same; ` : ''}${nameA}'s ${R(A)} beats ${nameB}'s ${R(B)}.`;
    case 2: return i === 0 ? `Compare the top pairs first: ${nameA}'s ${P(A)} beat ${nameB}'s ${P(B)}.`
      : i === 1 ? `Both have ${P(ka[0])} as the top pair, so compare the second pair: ${P(A)} beat ${P(B)}.`
      : `Both have ${P(ka[0])} and ${P(ka[1])}, so the fifth card ({{kicker}}) decides: ${R(A)} beats ${R(B)}.`;
    case 3: return i === 0 ? `Three ${P(A)} beat three ${P(B)}.` : `Both have three ${P(ka[0])}, so the {{kicker|kickers}} decide: ${R(A)} beats ${R(B)}.`;
    case 4: return `The higher top card wins: ${R(A)}-high beats ${R(B)}-high${B === 5 ? ' (the {{wheel}}, A-2-3-4-5, is the lowest straight — the ace counts as one)' : ''}.`;
    case 5: return i === 0 ? `Compare the highest cards: ${R(A)}-high beats ${R(B)}-high.` : `Both flushes have the same top card${i > 1 ? 's' : ''}, so compare the ${ORD[i]} card: ${R(A)} beats ${R(B)}.`;
    case 6: return i === 0 ? `With full houses, the three of a kind counts first: ${P(A)} full beats ${P(B)} full.` : `Both are ${P(ka[0])} full, so the pair decides: ${P(A)} beat ${P(B)}.`;
    case 7: return i === 0 ? `Four ${P(A)} beat four ${P(B)}.` : `Same four of a kind, so the fifth card decides: ${R(A)} beats ${R(B)}.`;
    case 8: return `The higher straight flush wins: ${R(A)}-high beats ${R(B)}-high.`;
  }
  return '';
}

export class ShowdownTrainer {
  constructor(ui, settings) {
    this.ui = ui; this.settings = settings;
    this.count = 3;
    this.tricky = true;
    this.tally = { right: 0, total: 0, streak: 0 };
  }

  open() { if (!this.deal) this.newDeal(false); this.render(); this.ui.open('info'); }

  newDeal(render = true) {
    // "Close" deals make you think: the top two hands share a category, or the pot is split,
    // or the board itself is strong. Otherwise any random deal.
    let tries = 0, d;
    do {
      d = this.randomDeal();
      tries++;
    } while (this.tricky && tries < 400 && !this.isClose(d));
    this.deal = d; this.picked = new Set(); this.phase = 'pick';
    if (render) this.render();
  }

  randomDeal() {
    const deck = shuffle(newDeck());
    const myName = (this.settings.name || '').toLowerCase();
    const names = shuffle(NAMES.filter(n => n.toLowerCase() !== myName)).slice(0, this.count);
    const players = names.map(name => ({ name, hole: [deck.pop(), deck.pop()] }));
    const board = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
    for (const p of players) p.best = bestFive([...p.hole, ...board]);
    const top = Math.max(...players.map(p => p.best.score));
    const winners = players.filter(p => p.best.score === top);
    return { players, board, winners: new Set(winners.map(p => p.name)), top };
  }

  isClose(d) {
    const sorted = d.players.map(p => p.best).sort((a, b) => b.score - a.score);
    const boardEv = evaluate(d.board);
    return d.winners.size > 1 || sorted[0].cat === sorted[1].cat || (boardEv.cat >= 2 && Math.random() < 0.6);
  }

  toggle(name) {
    if (this.phase !== 'pick') return;
    if (this.picked.has(name)) this.picked.delete(name); else this.picked.add(name);
    this.render();
  }

  submit() {
    if (!this.picked.size) return;
    const ok = this.picked.size === this.deal.winners.size && [...this.picked].every(n => this.deal.winners.has(n));
    this.lastOk = ok;
    this.tally.total++; if (ok) { this.tally.right++; this.tally.streak++; } else this.tally.streak = 0;
    this.phase = 'reveal';
    this.render();
  }

  explain() {
    const d = this.deal;
    const ranked = d.players.slice().sort((a, b) => b.best.score - a.best.score);
    const winners = ranked.filter(p => d.winners.has(p.name));
    const lines = [];
    const boardEv = evaluate(d.board);
    const usesHole = p => p.best.cards.filter(c => p.hole.some(h => key(h) === key(c))).length;

    // What each player has
    for (const p of ranked) {
      const n = usesHole(p);
      const use = n === 2 ? 'using both hole cards' : n === 1 ? 'using one hole card' : 'using no hole cards — the {{board plays}}';
      lines.push(`<b>${p.name}</b>: ${p.best.name} (${use}).`);
    }

    let why;
    if (winners.length > 1) {
      const boardPlays = winners.every(w => usesHole(w) === 0) || (boardEv.score === winners[0].best.score);
      why = `${winners.map(w => w.name).join(' and ')} tie with exactly the same five-card value, ${lc(winners[0].best.name)}, so they {{split pot|split the pot}}.` +
        (boardPlays ? ` The best hand is on the board itself, so anyone still in can use it.` : ` Only the best five cards count — any other cards don't matter.`);
    } else {
      const w = winners[0];
      const runner = ranked.find(p => !d.winners.has(p.name));
      if (w.best.cat > runner.best.cat) {
        why = `${w.name} wins: ${catTerm(w.best.cat)} beats ${catTerm(runner.best.cat)}${runner.best.cat === w.best.cat - 1 ? ', the next hand down the rankings' : ''}.`;
      } else {
        why = `${w.name} and ${runner.name} both have ${catTerm(w.best.cat)}. ` + tieBreak(w.best, runner.best, w.name, runner.name);
      }
      // a note for hands the board makes for everyone
      if (boardEv.cat >= 1 && boardEv.cat === w.best.cat && w.best.cat <= 2) why += ` Remember the board's pair belongs to everyone — what separates the hands is what you add to it.`;
    }
    return { lines, why, ranked };
  }

  render() {
    const d = this.deal;
    const reveal = this.phase === 'reveal';
    let html = `<h2>Who wins the showdown?</h2>
      <div class="sd-opts">
        <span class="muted">Players</span>
        ${[2, 3, 4].map(n => `<button class="seg ${n === this.count ? 'on' : ''}" data-count="${n}">${n}</button>`).join('')}
        <label class="check sd-tricky"><input type="checkbox" id="sdTricky" ${this.tricky ? 'checked' : ''}><span>Close calls</span></label>
      </div>
      <div class="sd-board"><div class="sd-board-label">The board</div><div class="sd-cards">${d.board.map(c => this.cardWithMark(c, reveal ? this.winnerCards() : null)).join('')}</div></div>
      ${reveal ? '' : `<p class="muted sd-help">Each player makes the best five-card hand from their two cards plus the five on the board. Tap the winner — tap more than one if you think the pot is split.</p>`}
      ${reveal ? this.verdictHTML() : ''}
      <div class="sd-players">`;
    const ranked = reveal ? this.explain().ranked : null;
    for (const p of d.players) {
      const picked = this.picked.has(p.name);
      const won = d.winners.has(p.name);
      const cls = ['sd-player'];
      if (picked) cls.push('picked');
      if (reveal) cls.push(won ? 'won' : 'lost');
      const place = reveal ? ranked.findIndex(r => r.best.score === p.best.score) + 1 : 0;
      html += `<button class="${cls.join(' ')}" data-name="${p.name}" ${reveal ? 'disabled' : ''} aria-pressed="${picked}">
        <span class="sd-name">${p.name}${reveal ? `<span class="sd-place">${(won ? (d.winners.size > 1 ? 'Splits the pot' : 'Wins') : place === 2 ? '2nd' : place === 3 ? '3rd' : '4th') + (picked ? ' — your pick' : '')}</span>` : picked ? '<span class="sd-place">Your pick</span>' : ''}</span>
        <span class="sd-hole">${p.hole.map(c => cardHTML(c, 'lg')).join('')}</span>
        ${reveal ? `<span class="sd-best"><span class="sd-hand">${p.best.name}</span><span class="sd-five">${p.best.cards.map(c => this.cardWithMark(c, null, p.hole)).join('')}</span></span>` : ''}
      </button>`;
    }
    html += `</div>`;
    if (!reveal) {
      html += `<div class="trainer-actions"><button class="primary" id="sdGo" ${this.picked.size ? '' : 'disabled'}>That's my answer</button><button class="small" id="sdNew">New deal</button></div>`;
    } else {
      html += `<div class="trainer-actions"><button class="primary" id="sdNext">Deal another</button></div>`;
    }
    const t = this.tally;
    html += `<p class="tally">${t.total ? `${t.right} of ${t.total} right${t.streak > 1 ? `, ${t.streak} in a row` : ''}` : ''}</p>`;

    $('infoBody').innerHTML = this.ui.termify(html);
    document.querySelectorAll('.sd-player').forEach(b => { b.onclick = () => this.toggle(b.dataset.name); });
    document.querySelectorAll('.seg[data-count]').forEach(b => { b.onclick = () => { this.count = +b.dataset.count; this.newDeal(); }; });
    $('sdTricky').onchange = e => { this.tricky = e.target.checked; this.newDeal(); };
    const on = (id, f) => { const el = $(id); if (el) el.onclick = f; };
    on('sdGo', () => this.submit());
    on('sdNew', () => this.newDeal());
    on('sdNext', () => this.newDeal());
  }

  verdictHTML() {
    const ex = this.explain();
    return `<p class="verdict ${this.lastOk ? 'ok' : 'bad'}">${this.lastOk ? 'Correct!' : `Not this time — you picked ${[...this.picked].join(' and ')}.`}</p>
      <div class="band" style="margin-bottom:10px"><p style="margin:0 0 8px">${ex.why}</p>${ex.lines.join('<br>')}
      <p class="muted" style="margin:8px 0 0">Below, cards from each player's own hand have a brass edge.</p></div>`;
  }

  winnerCards() {
    const set = new Set();
    for (const p of this.deal.players) if (this.deal.winners.has(p.name)) p.best.cards.forEach(c => set.add(key(c)));
    return set;
  }

  // On the board after the reveal, dim cards no winner uses; in a best-five row, mark the player's own cards.
  cardWithMark(c, usedSet, hole) {
    let html = cardHTML(c, 'lg');
    if (usedSet && !usedSet.has(key(c))) html = html.replace('class="card', 'class="card dim');
    if (hole && hole.some(h => key(h) === key(c))) html = html.replace('class="card', 'class="card own');
    return html;
  }
}
