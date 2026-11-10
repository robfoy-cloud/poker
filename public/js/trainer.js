// Starting-hand trainer: draw two cards, work out the Chen score, then see the working.

import { newDeck, shuffle, chenSteps, startingHandName } from './cards.js';
import { HAND_RANKS } from './handranks.js';
import { cardHTML } from './ui.js';

const $ = id => document.getElementById(id);
const fmt = v => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmt(Math.abs(v));

// Same thresholds the coach uses for raising first in.
const BANDS = [
  { min: -99, max: 5, label: 'Fold', text: 'Too weak to play first in from any seat. Fold — or check if you are the big blind and nobody raised.' },
  { min: 6, max: 7, label: 'Late', text: 'Playable only from late position: the {{cutoff}} or the {{button}} (7 is also fine from the {{small blind}}).' },
  { min: 8, max: 8, label: 'Middle', text: 'Good enough to raise first in from {{middle position}} onwards.' },
  { min: 9, max: 9, label: 'Early', text: 'Strong enough to raise even from {{early position}} ({{under the gun}}).' },
  { min: 10, max: 99, label: 'Any seat', text: 'Raise from any seat. 12 or more is a premium hand — happy to re-raise ({{3-bet}}) too.' },
];

export class Trainer {
  constructor(ui) {
    this.ui = ui;
    this.tally = { right: 0, total: 0, streak: 0 };
    this.deck = [];
  }

  open() {
    if (!this.hand) this.draw(false);
    this.render();
    this.ui.open('info');
  }

  draw(render = true) {
    if (this.deck.length < 2) this.deck = shuffle(newDeck());
    this.hand = [this.deck.pop(), this.deck.pop()];
    this.guess = 6; this.phase = 'guess';
    if (render) this.render();
  }

  useTableHand() {
    const me = this.ui.game && this.ui.game.human();
    if (!me || me.hole.length !== 2) return;
    this.hand = me.hole.slice(); this.guess = 6; this.phase = 'guess';
    this.render();
  }

  render() {
    const h = this.hand;
    const name = startingHandName(h);
    const me = this.ui.game && this.ui.game.human();
    const tableHand = me && me.hole.length === 2;
    const t = this.tally;
    let html = `<h2>Starting-hand trainer</h2>
      <p class="muted">The Chen formula turns any two cards into a score from −1 to 20. Work it out, then check your answer.</p>
      <div class="trainer-hand">${h.map(c => cardHTML(c, 'xl')).join('')}</div>
      <p class="trainer-name"><b>${name.code}</b> — ${name.desc}${name.nick ? `, “${name.nick}”` : ''}</p>`;

    if (this.phase === 'guess') {
      html += `<div class="guess" role="group" aria-label="Your Chen score">
          <button class="step" id="gMinus" aria-label="Lower">−</button>
          <span class="num" id="gNum" aria-live="polite">${this.guess}</span>
          <button class="step" id="gPlus" aria-label="Higher">+</button>
        </div>
        <div class="trainer-actions"><button class="primary" id="gCheck">Check my score</button><button class="small" id="gNew">New hand</button></div>
        <details style="margin-top:14px"><summary class="muted">How the Chen formula works</summary>
          <ol class="muted" style="margin-top:6px">
            <li>Score your highest card: ace 10, king 8, queen 7, jack 6; anything else is half its value.</li>
            <li>A pair doubles the score (minimum 5).</li>
            <li>Same suit: add 2.</li>
            <li>Gap between the cards: none 0, one −1, two −2, three −4, four or more −5.</li>
            <li>Add 1 if the gap is 0 or 1 and both cards are below a queen.</li>
            <li>Round any half point up.</li>
          </ol></details>`;
    } else {
      const res = chenSteps(h);
      const ok = this.guess === res.total;
      html += `<p class="verdict ${ok ? 'ok' : 'bad'}">${ok ? `Spot on — it's ${res.total}.` : `You said ${this.guess}; the Chen score is ${res.total}.`}</p>
        <table class="chen-steps"><tbody>`;
      let running = 0;
      res.steps.forEach((st, i) => {
        if (st.kind === 'set') running = st.value; else running += st.value;
        const val = st.kind === 'set' ? fmt(st.value) : st.kind === 'skip' ? '—' : signed(st.value);
        html += `<tr class="${st.kind === 'skip' ? 'skip' : ''}" style="animation-delay:${i * 90}ms"><td><b>${st.label}</b><div class="muted">${st.detail}</div></td><td>${val}</td></tr>`;
      });
      if (res.rounded) html += `<tr style="animation-delay:${res.steps.length * 90}ms"><td><b>Round up</b><div class="muted">${fmt(res.raw)} becomes ${res.total}</div></td><td>${res.total}</td></tr>`;
      html += `<tr class="total" style="animation-delay:${(res.steps.length + 1) * 90}ms"><td><b>Chen score</b></td><td>${res.total}</td></tr></tbody></table>`;

      const band = BANDS.find(b => res.total >= b.min && res.total <= b.max);
      const rank = HAND_RANKS.find(r => r[0] === name.code);
      const top = rank ? Math.max(1, Math.round(rank[1] * 100)) : null;
      html += `<div class="scale" aria-label="Where this hand can be played">${BANDS.map(b => `<span class="${b === band ? 'on' : ''}">${b.label}</span>`).join('')}</div>
        <div class="band">${band.text}${top ? `<br><span class="muted">For comparison: ${name.code} is in the top ${top}% of starting hands.</span>` : ''}</div>
        <div class="trainer-actions"><button class="primary" id="gNext">Draw the next hand</button>${tableHand ? `<button class="small" id="gTable">Use my table hand</button>` : ''}</div>`;
    }
    html += `<p class="tally">${t.total ? `${t.right} of ${t.total} right${t.streak > 1 ? `, ${t.streak} in a row` : ''}` : 'Your score will appear here.'}</p>`;
    if (this.phase === 'guess' && tableHand) html += `<p style="text-align:center"><button class="small" id="gTable">Score my table hand instead</button></p>`;

    $('infoBody').innerHTML = this.ui.termify(html);
    const on = (id, f) => { const el = $(id); if (el) el.onclick = f; };
    on('gMinus', () => { this.guess = Math.max(-1, this.guess - 1); $('gNum').textContent = this.guess; });
    on('gPlus', () => { this.guess = Math.min(20, this.guess + 1); $('gNum').textContent = this.guess; });
    on('gCheck', () => {
      const ok = this.guess === chenSteps(this.hand).total;
      this.tally.total++; if (ok) { this.tally.right++; this.tally.streak++; } else this.tally.streak = 0;
      this.phase = 'reveal'; this.render();
    });
    on('gNew', () => this.draw());
    on('gNext', () => this.draw());
    on('gTable', () => this.useTableHand());
  }
}
