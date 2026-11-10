// Everything on screen: table, chips, your controls, the coach log and the side sheets.

import { RANK_CHAR, SUIT_SYMBOL, SUIT_NAME, RANK_NAME, evaluate } from './cards.js';
import { stackComposition, betComposition, chipsHTML, totalOf, breakChip, DENOMS, legendHTML } from './chips.js';
import { lookup, searchGlossary, GLOSSARY } from './glossary.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function cardHTML(c, size = '') {
  if (!c) return `<span class="card slot ${size}"></span>`;
  const red = c.s === 'h' || c.s === 'd';
  const sym = SUIT_SYMBOL[c.s] + '\uFE0E'; // text-style suit, never emoji
  return `<span class="card ${size} ${red ? 'red' : ''}" aria-label="${RANK_NAME[c.r]} of ${SUIT_NAME[c.s]}"><span class="ix">${RANK_CHAR[c.r]}<i>${sym}</i></span><span class="pip">${sym}</span></span>`;
}
const backHTML = (size = '') => `<span class="card back ${size}"></span>`;

export class UI {
  constructor(settings) {
    this.settings = settings;
    this.game = null;
    this.mode = null;            // what we're waiting for from you
    this.myCounts = null;        // chips in your stack while you're choosing
    this.betCounts = null;       // chips you've pushed forward
    this.changeMode = false;
    this.pickSeat = null;
    this.highlightTurn = null;
    this.claude = { available: false, passcode: false };
    this.bindStatic();
    document.getElementById('chipKey').innerHTML = `<span class="key-label">Chip key</span>` + legendHTML(true);
  }

  // ---------- text helpers ----------
  termify(html) {
    return html.replace(/\{\{([^}|]+)(?:\|([^}]+))?\}\}/g, (m, term, shown) => {
      const hit = lookup(term);
      const text = shown || term;
      return hit ? `<button class="term" data-term="${esc(hit.term)}">${text}</button>` : text;
    });
  }

  coachSay(html, kind = 'info') {
    const log = $('coachLog');
    const div = document.createElement('div');
    div.className = 'msg ' + kind;
    div.innerHTML = this.termify(html);
    log.appendChild(div);
    // keep the log from growing forever
    while (log.children.length > 400) log.removeChild(log.firstChild);
    // Long messages (like advice) are shown from their start; short ones just scroll into view.
    if (div.offsetHeight > log.clientHeight - 10) log.scrollTop = div.offsetTop - 6;
    else log.scrollTop = log.scrollHeight;
    if (kind === 'mistake' && window.innerWidth < 900) div.scrollIntoView({ block: 'nearest' });
  }
  newHandDivider(n) {
    const d = document.createElement('div');
    d.className = 'divider'; d.textContent = `Hand ${n}`;
    $('coachLog').appendChild(d);
  }
  clearLog() { $('coachLog').innerHTML = ''; }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  setPrompt(html, wait = false) {
    const p = $('prompt');
    p.innerHTML = this.termify(html);
    p.classList.toggle('wait', wait);
  }

  setActions(list) {
    const box = $('actions');
    box.innerHTML = '';
    for (const a of list) {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.cls) b.className = a.cls;
      if (a.disabled) b.disabled = true;
      b.onclick = a.onClick;
      box.appendChild(b);
    }
  }

  waitContinue(label = 'Continue', prompt) {
    this.setPrompt(prompt || (label === 'Continue' ? 'Read the coach, then tap <b>Continue</b>.' : 'Hand over. Tap <b>Next hand</b> when you\'re ready.'), true);
    return new Promise(res => {
      this.setActions([{ label: label + ' ▸', cls: 'go', onClick: () => { this.setActions([]); res(); } }]);
    });
  }

  // ---------- table ----------
  seatXY(i, n, rFactor = 1) {
    // you sit at the bottom; the next seat clockwise is to your left (screen left), and so on.
    const ang = (Math.PI / 2) + i * (2 * Math.PI / n);
    const rx = 40 * rFactor, ry = 40 * rFactor;
    return { x: 50 + rx * Math.cos(ang), y: 50 + ry * Math.sin(ang) };
  }

  render() {
    const g = this.game;
    if (!g) return;
    const n = g.n;
    const show = this.settings.showTotals;
    const pos = g.button >= 0 ? g.positions() : {};
    const winners = new Set((g.winners || []).map(w => w.seat));
    let seatsHTML = '';
    g.players.forEach((p, i) => {
      const { x, y } = this.seatXY(i, n);
      const cls = ['seat'];
      if (p.isHuman) cls.push('me');
      if (p.out) cls.push('out'); else if (p.folded) cls.push('folded');
      if (this.highlightTurn === i) cls.push('turn');
      if (winners.has(i) && !p.out) cls.push('winner');
      if (this.pickSeat && !p.out) cls.push('pickable');
      if (p.shown && !p.folded && !p.out && !p.isHuman) cls.push('shown');
      let cards = '';
      if (!p.isHuman && !p.out && !p.folded && p.hole.length) {
        cards = p.shown ? p.hole.map(c => cardHTML(c, 'sm')).join('') : p.hole.map(() => backHTML('sm')).join('');
      }
      const stack = p.isHuman ? '' : `<button class="stack-btn" data-count-seat="${i}" aria-label="Count ${esc(p.name)}'s chips">${chipsHTML(stackComposition(p.stack, 6), { size: 'sm', maxPerColumn: 8 })}</button>`;
      const total = show ? `<span class="total">${p.stack}</span>` : '';
      const act = p.out ? 'Out' : (p.lastAction && p.lastAction !== pos[i] && !(pos[i] || '').endsWith(p.lastAction) ? p.lastAction : '');
      const handName = p.shown && p.best ? `<div class="act">${esc(p.best.name)}</div>` : '';
      seatsHTML += `<div class="${cls.join(' ')}" data-seat="${i}" style="left:${x}%;top:${y}%">
        <div class="cards">${cards}</div>
        <div class="plate"><div class="nm">${esc(p.name)}</div><div class="pos">${pos[i] || ''}${act ? ` <span class="act-inline">${esc(act)}</span>` : ''}</div>${stack}${total}${handName}</div>
      </div>`;
      if (p.isHuman) {
        const b = this.seatXY(i, n, 0.58);
        seatsHTML += `<div class="bet-spot my-spot" id="myTableBet" style="left:${b.x}%;top:${b.y}%"></div>`;
      } else if (p.bet > 0) {
        const b = this.seatXY(i, n, 0.58);
        seatsHTML += `<div class="bet-spot" style="left:${b.x}%;top:${b.y}%">${chipsHTML(betComposition(p.bet), { size: 'md' })}${show ? `<span class="total">${p.bet}</span>` : ''}</div>`;
      }
    });
    $('seats').innerHTML = seatsHTML;
    $('table').classList.toggle('crowded', n >= 7);

    const db = $('dealerBtn');
    if (g.button >= 0) {
      const d = this.seatXY(g.button + 0.42, n, 0.76);
      db.style.left = d.x + '%'; db.style.top = d.y + '%'; db.hidden = false;
    } else db.hidden = true;

    const slots = [];
    for (let k = 0; k < 5; k++) slots.push(cardHTML(g.board[k]));
    $('board').innerHTML = slots.join('');
    $('burn').innerHTML = g.burned.map(() => backHTML()).join('');
    $('potChips').innerHTML = chipsHTML(stackComposition(g.pot, 6), { size: 'sm', maxPerColumn: 12 });
    $('potTotal').textContent = show && g.pot ? g.pot : '';

    this.renderMe();
  }

  renderMe() {
    const g = this.game;
    const me = g && g.human();
    if (!me) return;
    $('myCards').innerHTML = me.hole.length && !me.folded ? me.hole.map(c => cardHTML(c, 'lg')).join('')
      : me.folded && me.hole.length ? `<span class="muted">Folded</span>` : cardHTML(null, 'lg') + cardHTML(null, 'lg');
    const counts = this.myCounts || stackComposition(me.stack);
    const interactive = !!this.myCounts;
    $('myStack').innerHTML = chipsHTML(counts, { size: 'lg', interactive, maxPerColumn: 10, attr: 'id="myChips"' });
    $('myStack').classList.toggle('change-mode', this.changeMode);
    $('myTotal').textContent = this.settings.showTotals ? (this.myCounts ? totalOf(this.myCounts) : me.stack) : '';
    // Your bet sits on the table in front of your seat: chips already in, plus any you're pushing now.
    const spot = $('myTableBet');
    if (spot) {
      const bc = this.betCounts;
      const staged = bc ? totalOf(bc) : 0;
      let h = '';
      if (me.bet > 0) h += chipsHTML(betComposition(me.bet), { size: 'md' });
      if (staged > 0) h += chipsHTML(bc, { size: 'md', interactive: true, attr: 'class="chips chips-md my-bet"' });
      else if (bc) h += `<span class="bet-hint">Your bet</span>`;
      const show = this.settings.showTotals;
      spot.innerHTML = `<div class="my-bet-row">${h}</div>` + (show && (me.bet + staged) > 0 ? `<span class="total">${me.bet + staged}</span>` : '');
      spot.classList.toggle('staging', !!bc);
    }
  }

  // ---------- your chips ----------
  startStaging() {
    const me = this.game.human();
    this.myCounts = stackComposition(me.stack);
    this.betCounts = DENOMS.map(() => 0);
    this.changeMode = false;
    this.renderMe();
  }
  endStaging() { this.myCounts = null; this.betCounts = null; this.changeMode = false; }
  pushed() { return this.betCounts ? totalOf(this.betCounts) : 0; }

  onStackTap(i) {
    if (!this.myCounts) return;
    if (this.changeMode) {
      if (i === 0) this.coachSay('White chips are the smallest — they can\'t be broken down.', 'note');
      else breakChip(this.myCounts, i);
    } else if (this.myCounts[i] > 0) {
      this.myCounts[i]--; this.betCounts[i]++;
    }
    this.renderMe();
  }
  onBetTap(i) {
    if (!this.betCounts || this.betCounts[i] <= 0) return;
    this.betCounts[i]--; this.myCounts[i]++;
    this.renderMe();
  }
  pushAll() {
    for (let i = 0; i < DENOMS.length; i++) { this.betCounts[i] += this.myCounts[i]; this.myCounts[i] = 0; }
    this.renderMe();
  }
  clearBet() { this.startStaging(); }

  stagingButtons(extra = [], confirmLabel = 'Put in') {
    return [
      ...extra,
      { label: confirmLabel, cls: 'go', onClick: () => this._confirm && this._confirm() },
      { label: 'Clear', onClick: () => this.clearBet() },
      { label: 'All-in', onClick: () => this.pushAll() },
      { label: 'Change', cls: 'toggle' + (this.changeMode ? ' on' : ''), onClick: (e) => { this.changeMode = !this.changeMode; e.target.classList.toggle('on', this.changeMode); this.renderMe(); if (this.changeMode) this.coachSay('Change mode: tap a chip column in your stack to swap one chip for the same value in smaller chips ({{make change}}). Tap the button again when done.', 'note'); } },
    ];
  }

  // ---------- engine hooks: you ----------
  humanPost({ which, amount }, prompt) {
    this.highlightTurn = this.game.human().seat; this.render();
    return new Promise(res => {
      this.startStaging();
      this.setPrompt(prompt);
      this._confirm = () => { const v = this.pushed(); this._confirm = null; this.endStaging(); this.setActions([]); res(v); };
      this.setActions(this.stagingButtons([], 'Post'));
    });
  }

  humanAction(ctx, prompt, extraButtons) {
    this.highlightTurn = ctx.seat; this.render();
    return new Promise(res => {
      this.startStaging();
      this.setPrompt(prompt);
      const done = (r) => { this._confirm = null; this.endStaging(); this.setActions([]); this.highlightTurn = null; res(r); };
      this._confirm = () => { const v = this.pushed(); done(v === 0 ? { type: 'check' } : { type: 'chips', amount: v }); };
      this.setActions([
        { label: 'Fold', cls: 'danger', onClick: () => done({ type: 'fold' }) },
        { label: 'Check', onClick: () => { if (this.pushed() > 0) this.clearBet(); done({ type: 'check' }); } },
        ...this.stagingButtons(extraButtons || []),
      ]);
      this.renderMe();
    });
  }

  dealerStep(ctx, prompt) {
    this.setPrompt(prompt);
    return new Promise(res => {
      if (ctx.step === 'firstCard') {
        this.pickSeat = (seat) => { this.pickSeat = null; this.render(); res(seat); };
        this.setActions([{ label: 'Hint', onClick: () => this.coachSay('Dealing always starts with the player on the dealer\'s <b>left</b> — the next seat clockwise.', 'advice'), hide: this.settings.level === 3 }].filter(a => !a.hide));
        this.render();
        return;
      }
      const st = ctx.street;
      if (ctx.step.endsWith(':first')) {
        this.setActions([
          { label: 'Burn a card', cls: 'go', onClick: () => { this.setActions([]); res('burn'); } },
          { label: `Deal the ${st}`, onClick: () => { this.setActions([]); res('deal'); } },
        ]);
      } else {
        this.setActions([1, 2, 3].map(k => ({ label: `${k} card${k > 1 ? 's' : ''}`, onClick: () => { this.setActions([]); res(k); } })));
      }
    });
  }

  // ---------- sheets ----------
  open(id) { $(id).hidden = false; }
  close(id) { $(id).hidden = true; }
  info(html) { $('infoBody').innerHTML = this.termify(html); this.open('info'); }

  showTerm(term) {
    const hit = lookup(term);
    if (!hit) return;
    const pop = $('termPop');
    pop.innerHTML = `<b>${esc(hit.term)}</b> — ${esc(hit.def)}`;
    pop.hidden = false;
    clearTimeout(this._popT);
    this._popT = setTimeout(() => { pop.hidden = true; }, 9000);
  }

  showGlossary(q = '') {
    const render = (query) => {
      const items = searchGlossary(query);
      $('glossList').innerHTML = items.map(i => `<dt>${esc(i.term)}</dt><dd>${esc(i.def)}</dd>`).join('') || '<p class="muted">No matches.</p>';
    };
    $('infoBody').innerHTML = `<h2>Poker jargon</h2><input type="text" id="glossQ" placeholder="Search, e.g. gutshot" value="${esc(q)}"><dl class="gloss-list" id="glossList"></dl>`;
    this.open('info');
    render(q);
    $('glossQ').oninput = e => render(e.target.value);
  }

  showRanks() {
    const C = (r, s) => ({ r, s });
    // cat index matches evaluate(): 9 = royal flush
    const ex = [
      [9, 'Royal Flush', 'A-K-Q-J-10, all one suit.', [C(14, 's'), C(13, 's'), C(12, 's'), C(11, 's'), C(10, 's')], '0.003%', '1 in 30,940'],
      [8, 'Straight Flush', 'Five in a row, all one suit.', [C(9, 'h'), C(8, 'h'), C(7, 'h'), C(6, 'h'), C(5, 'h')], '0.03%', '1 in 3,590'],
      [7, 'Four of a Kind', 'Also called {{quads}}.', [C(7, 's'), C(7, 'h'), C(7, 'd'), C(7, 'c'), C(13, 'd')], '0.17%', '1 in 595'],
      [6, 'Full House', 'Three of a kind plus a pair: "kings full of fours".', [C(13, 's'), C(13, 'h'), C(13, 'c'), C(4, 'd'), C(4, 's')], '2.6%', '1 in 38'],
      [5, 'Flush', 'Five of one suit, not in a row.', [C(14, 'd'), C(11, 'd'), C(8, 'd'), C(6, 'd'), C(2, 'd')], '3.0%', '1 in 33'],
      [4, 'Straight', 'Five in a row, mixed suits. A-2-3-4-5 is the {{wheel}}.', [C(10, 'c'), C(9, 'd'), C(8, 's'), C(7, 'h'), C(6, 'c')], '4.6%', '1 in 22'],
      [3, 'Three of a Kind', 'A {{set}} with a pocket pair, {{trips}} with a pair on the board.', [C(12, 's'), C(12, 'h'), C(12, 'd'), C(9, 'c'), C(3, 's')], '4.8%', '1 in 21'],
      [2, 'Two Pair', 'Two different pairs.', [C(11, 'h'), C(11, 'c'), C(5, 's'), C(5, 'd'), C(14, 'h')], '23.5%', '1 in 4.3'],
      [1, 'One Pair', 'Ties are broken by the {{kicker}}.', [C(10, 's'), C(10, 'h'), C(14, 'c'), C(8, 'd'), C(4, 'h')], '43.8%', '1 in 2.3'],
      [0, 'High Card', 'Nothing else — highest card wins.', [C(14, 's'), C(12, 'd'), C(9, 'h'), C(6, 'c'), C(3, 'd')], '17.4%', '1 in 5.7'],
    ];
    let mine = -1;
    const me = this.game && this.game.human();
    if (me && me.hole.length && !me.folded && this.game.board.length >= 3) {
      const e = evaluate([...me.hole, ...this.game.board]);
      mine = e.cat === 8 && e.kickers[0] === 14 ? 9 : e.cat;
    }
    this.info(`<h2>Hand rankings &amp; odds</h2>
      <p class="muted">Best first. "Odds" is how often you end up with that hand using all seven cards (your two plus the five on the board) if you stay to the river.</p>
      <table class="ranks-table"><thead><tr><th>Hand</th><th>Odds</th></tr></thead><tbody>` +
      ex.map(([cat, n, d, cs, pct, one]) => `<tr class="${cat === mine ? 'mine' : ''}"><td><b>${n}</b>${cat === mine ? ' <span class="you-tag">your hand now</span>' : ''}<div class="muted">${d}</div><div class="ex">${cs.map(c => cardHTML(c, 'sm')).join('')}</div></td><td class="odds"><b>${pct}</b><div class="muted">${one}</div></td></tr>`).join('') +
      `</tbody></table>
      <h3>Handy odds</h3>
      <table class="odds-table"><tbody>
        <tr><td>Dealt a {{pocket pair}}</td><td>1 in 17 (5.9%)</td></tr>
        <tr><td>Dealt {{pocket rockets}} (A-A)</td><td>1 in 221</td></tr>
        <tr><td>Dealt {{suited}} cards</td><td>1 in 4 (24%)</td></tr>
        <tr><td>Pocket pair makes a {{set}} on the flop</td><td>1 in 8.5 (12%)</td></tr>
        <tr><td>{{flush draw|Flush draw}} on the flop hits by the river (9 {{outs}})</td><td>35%</td></tr>
        <tr><td>{{open-ended straight draw|Open-ended straight draw}} hits by the river (8 outs)</td><td>32%</td></tr>
        <tr><td>{{gutshot|Gutshot}} hits by the river (4 outs)</td><td>17%</td></tr>
        <tr><td>Any draw, one card to come</td><td>outs × 2 %</td></tr>
        <tr><td>Any draw, two cards to come</td><td>outs × 4 % ({{rule of 2 and 4}})</td></tr>
      </tbody></table>`);
  }

  showChips() {
    this.info(`<h2>Chip values</h2>${legendHTML()}<p>Chips are shown <b>edge-on</b>, as you'd see stacks across a real table. Count each colour and multiply by its value.</p>
      <p><b>Betting:</b> tap a colour in your stack to push one chip forward; tap a chip in front of you to take it back; then press <b>Put in</b>. Pushing exactly the amount you face is a {{call}}; more is a {{raise}}; nothing is a {{check}}.</p>
      <p><b>{{make change|Making change}}:</b> turn on <b>Make change</b> and tap a colour to break one chip into smaller ones (purple → 5 black, black → 4 green, green → 5 red, red → 5 white).</p>
      <p><b>Counting practice:</b> tap the pot or any opponent's stack to test your count.</p>`);
  }

  showRules() {
    this.info(`<h2>How a hand of Hold'em works</h2>
      <ol>
        <li>The {{button}} marks the {{dealer}}. It moves one seat clockwise each hand.</li>
        <li>The player on the button's left posts the {{small blind}}; the next posts the {{big blind}}.</li>
        <li>Cards are dealt clockwise from the dealer's left, one at a time, until everyone has two {{hole cards}}.</li>
        <li>{{pre-flop|Pre-flop}} betting starts {{under the gun}} (left of the big blind). The big blind acts last and has the {{option}}.</li>
        <li>The dealer {{burn|burns}} a card and deals the {{flop}} (three cards). Betting now starts with the first player still in to the button's left.</li>
        <li>Burn, then the {{turn}} (one card). Betting round.</li>
        <li>Burn, then the {{river}} (one card). Last betting round.</li>
        <li>{{showdown|Showdown}}: best five-card hand wins the {{pot}}.</li>
      </ol>
      <p><b>When does a betting round stop?</b> When everyone still in has put in the same amount and has had a chance to act — or when everyone has checked. If everyone but one folds, the hand ends at once. If players are {{all-in}}, the remaining cards are dealt without more betting.</p>
      <p><b>{{heads-up|Heads-up}} rule:</b> with two players, the button is the small blind and acts first pre-flop, last afterwards.</p>`);
  }

  openCount(kind, seat) {
    const g = this.game; if (!g) return;
    let actual, what;
    if (kind === 'pot') { actual = g.pot; what = 'the pot (the chips in the middle — not counting bets still in front of players)'; }
    else { actual = g.players[seat].stack; what = `${esc(g.players[seat].name)}'s stack`; }
    $('infoBody').innerHTML = `<h2>Count the chips</h2>${legendHTML()}<p>How much is in ${what}?</p>
      <div class="row"><input type="number" inputmode="numeric" id="countIn" placeholder="Your count"><button class="primary" id="countGo">Check</button></div>
      <div id="countRes" class="count-result"></div><button class="small" id="countShow" style="margin-top:10px">Just tell me</button>`;
    this.open('info');
    $('countIn').focus();
    const check = () => {
      const v = parseInt($('countIn').value, 10);
      const r = $('countRes');
      if (v === actual) { r.className = 'count-result ok'; r.textContent = `Correct — ${actual}.`; }
      else { r.className = 'count-result bad'; r.textContent = isNaN(v) ? 'Enter a number.' : `Not quite — ${v > actual ? 'too high' : 'too low'}. Count each colour separately.`; }
    };
    $('countGo').onclick = check;
    $('countIn').onkeydown = e => { if (e.key === 'Enter') check(); };
    $('countShow').onclick = () => { $('countRes').className = 'count-result'; $('countRes').textContent = `It's ${actual}.`; };
  }

  // ---------- wiring ----------
  bindStatic() {
    document.addEventListener('click', e => {
      const t = e.target.closest('.term');
      if (t) { e.preventDefault(); this.showTerm(t.dataset.term); return; }
      if (!e.target.closest('#termPop')) $('termPop').hidden = true;
      const close = e.target.closest('[data-close]');
      if (close) { close.closest('.sheet').hidden = true; return; }
      if (e.target.classList.contains('sheet')) { e.target.hidden = true; return; }
      const col = e.target.closest('.chipcol.tap');
      if (col) {
        const i = +col.dataset.denom;
        if (col.closest('#myChips')) this.onStackTap(i);
        else if (col.closest('.my-bet')) this.onBetTap(i);
        return;
      }
      const cs = e.target.closest('[data-count-seat]');
      if (cs && !this.pickSeat) { this.openCount('stack', +cs.dataset.countSeat); return; }
      const seat = e.target.closest('.seat');
      if (seat && this.pickSeat) { this.pickSeat(+seat.dataset.seat); return; }
      if (e.target.closest('#pot')) { this.openCount('pot'); return; }
    });
  }
}
