// Blackjack Coach: the table, your chips and decisions, and the coach.

import { BJGame } from './game.js';
import { RULES, handValue, isBlackjack, isPair, cardValue, chartAction, bestAction, reasonFor, dealerRuleText, describeTotal, upName, DEALER_BUST } from './rules.js';
import { lookupBJ, searchBJGlossary } from './glossary.js';
import { cardHTML } from '../ui.js';
import { stackComposition, betComposition, chipsHTML, totalOf, breakChip, DENOMS, legendHTML } from '../chips.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NAMES = ['Ava', 'Ben', 'Cleo', 'Dev', 'Esme', 'Finn', 'Gus', 'Hana'];
const LEVEL_NAMES = ['', 'Learn', 'Advise', 'Test'];
const DEFAULTS = { others: 2, stack: 1000, level: 1, surrender: false, speed: 700 };
const ACT_WORD = { hit: 'hits', stand: 'stands', double: 'doubles down', split: 'splits', surrender: 'surrenders' };
const ACT_TERM = { hit: '{{hit|hits}}', stand: '{{stand|stands}}', double: '{{double down|doubles down}}', split: '{{split|splits}}', surrender: '{{surrender|surrenders}}' };
const backHTML = (size = '') => `<span class="card back ${size}"></span>`;

export class BlackjackApp {
  constructor(shared) {
    this.shared = shared;
    this.settings = { ...DEFAULTS, ...load('bj.settings') };
    this.stats = { decisions: 0, correct: 0, ...load('bj.stats') };
    this.unread = 0;
    this.build();
  }
  get level() { return this.settings.level; }

  // ---------- markup ----------
  build() {
    $('bjView').innerHTML = `
      <header class="topbar bj-top">
        <button class="brand brand-btn" id="bjGames" aria-label="Switch game"><img src="icons/blackjack.svg" alt="" width="26" height="26"><span>Blackjack Coach</span><i class="chev">▾</i></button>
        <div class="top-actions">
          <select id="bjLevel" aria-label="Coaching level"><option value="1">Learn</option><option value="2">Advise</option><option value="3">Test</option></select>
          <button class="iconbtn" id="bjMenuBtn" aria-label="Menu">☰</button>
        </div>
      </header>
      <main class="bj-layout">
        <section class="bj-main">
          <div class="bj-table-wrap">
            <div class="bj-table" id="bjTable">
              <svg class="bj-print" viewBox="0 0 400 200" preserveAspectRatio="xMidYMin meet" aria-hidden="true">
                <defs>
                  <path id="bjArc1" d="M 50 20 Q 200 130 350 20" />
                  <path id="bjArc2" d="M 50 44 Q 200 154 350 44" />
                </defs>
                <text class="p1"><textPath href="#bjArc1" startOffset="50%" text-anchor="middle">BLACKJACK PAYS 3 TO 2</textPath></text>
                <text class="p2"><textPath href="#bjArc2" startOffset="50%" text-anchor="middle">DEALER MUST STAND ON ALL 17s · INSURANCE PAYS 2 TO 1</textPath></text>
              </svg>
              <div class="bj-tray" id="bjTray" title="Discard tray"></div>
              <div class="bj-shoe" id="bjShoe" title="Shoe"></div>
              <div class="bj-dealer"><div class="bj-dhand" id="bjDealer"></div><div class="bj-dtotal" id="bjDTotal"></div></div>
              <div id="bjSeats"></div>
            </div>
          </div>
          <button class="c-ticker bj-ticker" id="bjTicker" hidden aria-live="polite"></button>
          <div class="bj-me">
            <div class="bj-prompt" id="bjPrompt">Set up a game to start.</div>
            <div class="bj-hands" id="bjHands"></div>
            <div class="bj-stack-row" id="bjStackRow">
              <div class="stack-label">Your chips <span id="bjTotal" class="total"></span></div>
              <div id="bjStack"></div>
            </div>
            <div class="bj-actions" id="bjActions"></div>
          </div>
        </section>
        <button class="coach-tab bj-tab" id="bjTab" aria-label="Open the coach panel"><span class="tab-label">Coach</span><span class="badge" id="bjBadge" hidden></span></button>
        <section class="coach-panel bj-coach" id="bjCoach">
          <div class="coach-head"><span>Coach</span>
            <div class="coach-tools">
              <button class="small" id="bjChartBtn">Strategy chart</button>
              <button class="small" id="bjWordsBtn">Words</button>
              <button class="small drawer-close" id="bjClose">Close ›</button>
            </div>
          </div>
          <div class="coach-log" id="bjLog" aria-live="polite"></div>
        </section>
      </main>`;
    $('bjGames').onclick = () => this.shared.onSwitch();
    $('bjLevel').value = this.settings.level;
    $('bjLevel').onchange = e => { this.settings.level = +e.target.value; save('bj.settings', this.settings); this.say(`Coaching level changed to <b>${LEVEL_NAMES[this.level]}</b>.`, 'note'); };
    $('bjMenuBtn').onclick = () => this.menu();
    $('bjChartBtn').onclick = () => this.chart();
    $('bjWordsBtn').onclick = () => this.glossary();
    $('bjTab').onclick = () => this.openDrawer();
    $('bjClose').onclick = () => this.closeDrawer();
    $('bjTicker').onclick = e => { if (!e.target.closest('.term')) this.openDrawer(); };
    // chips respond on touch
    document.addEventListener('pointerdown', e => {
      const col = e.target.closest('.chipcol.tap');
      if (!col || $('bjView').hidden) return;
      if (col.closest('#bjStack')) { e.preventDefault(); this.onStackTap(+col.dataset.denom); }
      else if (col.closest('.bj-staged')) { e.preventDefault(); this.onBetTap(+col.dataset.denom); }
    });
    // tap outside the drawer closes it; swipe right closes it
    document.addEventListener('pointerdown', e => {
      const panel = $('bjCoach');
      if ($('bjView').hidden || !panel.classList.contains('open')) return;
      if (panel.contains(e.target) || $('bjTab').contains(e.target) || e.target.closest('.sheet') || e.target.closest('#termPop')) return;
      this.closeDrawer();
      if (e.target.closest('.bj-table-wrap')) this.swallow = true;
    }, true);
    document.addEventListener('click', e => { if (this.swallow) { this.swallow = false; e.stopPropagation(); e.preventDefault(); } }, true);
    let sx = null;
    $('bjCoach').addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    $('bjCoach').addEventListener('touchend', e => { if (sx != null && e.changedTouches[0].clientX - sx > 70) this.closeDrawer(); sx = null; });
  }

  // ---------- coach text ----------
  termify(html) {
    return html.replace(/\{\{([^}|]+)(?:\|([^}]+))?\}\}/g, (m, term, shown) => {
      const hit = lookupBJ(term);
      return hit ? `<button class="term" data-ns="bj" data-term="${esc(hit.term)}">${shown || term}</button>` : (shown || term);
    });
  }
  say(html, kind = 'info') {
    const log = $('bjLog');
    const div = document.createElement('div');
    div.className = 'msg ' + kind;
    div.innerHTML = this.termify(html);
    log.appendChild(div);
    while (log.children.length > 300) log.removeChild(log.firstChild);
    if (div.offsetHeight > log.clientHeight - 10) log.scrollTop = div.offsetTop - 6; else log.scrollTop = log.scrollHeight;
    const t = $('bjTicker');
    t.innerHTML = `<span class="tk-text">${div.innerHTML.replace(/<br\s*\/?>/g, ' ')}</span>`;
    t.className = 'c-ticker bj-ticker k-' + kind; t.hidden = false;
    if (!$('bjCoach').classList.contains('open') && kind !== 'note') {
      this.unread++;
      const b = $('bjBadge'); b.hidden = false; b.textContent = this.unread > 9 ? '9+' : this.unread;
      if (kind === 'mistake' || kind === 'advice') $('bjTab').classList.add('alert');
    }
  }
  divider(text) { const d = document.createElement('div'); d.className = 'divider'; d.textContent = text; $('bjLog').appendChild(d); }
  openDrawer() {
    const top = document.querySelector('#bjView .topbar').getBoundingClientRect().bottom;
    const me = document.querySelector('.bj-me').getBoundingClientRect().top;
    document.documentElement.style.setProperty('--drawer-top', Math.round(top) + 'px');
    document.documentElement.style.setProperty('--drawer-bottom', Math.round(window.innerHeight - me) + 'px');
    $('bjCoach').classList.add('open'); $('bjTab').classList.add('hidden');
    this.unread = 0; $('bjBadge').hidden = true; $('bjTab').classList.remove('alert');
    const log = $('bjLog'), last = log.lastElementChild;
    if (last && last.offsetHeight > log.clientHeight - 10) log.scrollTop = last.offsetTop - 6; else log.scrollTop = log.scrollHeight;
  }
  closeDrawer() { $('bjCoach').classList.remove('open'); $('bjTab').classList.remove('hidden'); }
  prompt(html, wait = false) { const p = $('bjPrompt'); p.innerHTML = this.termify(html); p.classList.toggle('wait', wait); }
  actions(list) {
    const box = $('bjActions'); box.innerHTML = '';
    for (const a of list) {
      const b = document.createElement('button');
      b.textContent = a.label;
      b.className = (a.cls || '') + (a.off ? ' off' : '');
      if (a.off) b.setAttribute('aria-disabled', 'true');
      b.onclick = a.onClick;
      box.appendChild(b);
    }
  }
  waitContinue(label = 'Continue') {
    return new Promise(res => this.actions([{ label: label + ' ▸', cls: 'go', onClick: () => { this.actions([]); res(); } }]));
  }

  // ---------- lifecycle ----------
  show() {
    if (this.game) return;
    const saved = load('bj.game');
    if (saved && saved.stack >= RULES.minBet && saved.players) this.start(saved.players, saved.stacks, true);
    else this.setup();
  }

  setup() {
    const s = this.settings, ui = this.shared.ui;
    $('infoBody').innerHTML = `<h2 class="bj-h">New blackjack game</h2>
      <label class="field">Your name<input type="text" id="bjName" maxlength="14" placeholder="You" value="${esc(this.shared.settings.name || '')}"></label>
      <label class="field">Other players at the table: <b id="bjOthersOut">${s.others}</b><input type="range" id="bjOthers" min="0" max="4" value="${s.others}"></label>
      <label class="field">Starting chips<select id="bjStackSel">${[500, 1000, 2000].map(v => `<option value="${v}" ${s.stack === v ? 'selected' : ''}>${v.toLocaleString()}</option>`).join('')}</select></label>
      <fieldset class="field levels"><legend>Coaching</legend>
        <label><input type="radio" name="bjLvl" value="1" ${s.level === 1 ? 'checked' : ''}><span><b>Learn</b> — I explain every step: dealing, the dealer's rules, payouts, and the right play for each hand and why.</span></label>
        <label><input type="radio" name="bjLvl" value="2" ${s.level === 2 ? 'checked' : ''}><span><b>Advise</b> — I describe what happens; tap Hint when you want the right play.</span></label>
        <label><input type="radio" name="bjLvl" value="3" ${s.level === 3 ? 'checked' : ''}><span><b>Test</b> — I say nothing unless you go against {{basic strategy}}.</span></label>
      </fieldset>
      <label class="check"><input type="checkbox" id="bjSurr" ${s.surrender ? 'checked' : ''}><span>Table allows {{surrender}} (not every casino does)</span></label>
      <label class="field">Dealing speed<select id="bjSpeed"><option value="1100" ${s.speed === 1100 ? 'selected' : ''}>Slow</option><option value="700" ${s.speed === 700 ? 'selected' : ''}>Normal</option><option value="350" ${s.speed === 350 ? 'selected' : ''}>Fast</option></select></label>
      <p class="muted">House rules: 6 decks · dealer stands on all 17s · blackjack pays 3 to 2 · double on any two cards, also after splitting · split up to four hands · split aces get one card each · bets 10 to 500.</p>
      <button class="primary wide bj-primary" id="bjStart">Take a seat</button>`;
    $('infoBody').innerHTML = this.termify($('infoBody').innerHTML);
    ui.open('info');
    $('bjOthers').oninput = e => { $('bjOthersOut').textContent = e.target.value; };
    $('bjStart').onclick = () => {
      s.others = +$('bjOthers').value; s.stack = +$('bjStackSel').value;
      s.level = +document.querySelector('input[name=bjLvl]:checked').value;
      s.surrender = $('bjSurr').checked; s.speed = +$('bjSpeed').value;
      this.shared.settings.name = $('bjName').value.trim().slice(0, 14);
      this.shared.saveSettings();
      save('bj.settings', s); $('bjLevel').value = s.level;
      ui.close('info');
      const names = NAMES.filter(n => n.toLowerCase() !== (this.shared.settings.name || '').toLowerCase()).sort(() => Math.random() - 0.5);
      const others = names.slice(0, s.others).map((n, i) => ({ name: n, style: i % 2 ? 'hunch' : 'book' }));
      // you sit in the middle; first base (the dealer's left, your right) plays first
      const mid = Math.floor(others.length / 2);
      const players = [...others.slice(0, mid), { name: this.shared.settings.name || 'You', isHuman: true }, ...others.slice(mid)];
      this.start(players, null, false);
    };
  }

  start(players, stacks, resumed) {
    this.gen = (this.gen || 0) + 1;
    const myGen = this.gen;
    const game = new BJGame({ players, stack: this.settings.stack, surrender: this.settings.surrender }, this.makeIO(myGen));
    if (stacks) game.seats.forEach((s, i) => { if (stacks[i] != null) s.stack = stacks[i]; });
    this.game = game; this.staged = null;
    $('bjLog').innerHTML = '';
    const L = this.level;
    let intro = resumed ? `Welcome back — you've got your chips from last time. A fresh {{shoe}} is ready.` : `Welcome to the table. ${game.seats.length > 1 ? `You're sitting with ${game.seats.filter(s => !s.isHuman).map(s => s.name).join(' and ')}. ` : ''}The goal: beat the dealer by getting closer to 21 without going over.`;
    if (L === 1 && !resumed) intro += ` Number cards count their value, jacks, queens and kings count 10, and an ace counts 1 or 11 — whichever helps. Everyone plays against the dealer, not each other.`;
    this.say(intro, 'note');
    this.render();
    (async () => {
      while (!game.over && myGen === this.gen) await game.playRound();
      if (myGen === this.gen && game.over) {
        this.say(`You're out of chips — that's the {{house edge}} at work, plus a little luck. Start a new game from the menu.`, 'result');
        save('bj.game', null);
        this.actions([{ label: 'New game', cls: 'go', onClick: () => this.setup() }]);
      }
    })();
  }

  persist() {
    const g = this.game; if (!g) return;
    save('bj.game', { players: g.seats.map(s => ({ name: s.name, isHuman: s.isHuman, style: s.style })), stacks: g.seats.map(s => s.stack), stack: g.human.stack });
    save('bj.stats', this.stats);
  }

  // ---------- drawing the table ----------
  seatXY(i, n) {
    // first base (index 0) sits on the dealer's left — your right as you look at the table
    const t = n === 1 ? 0.5 : i / (n - 1);
    const ang = (22 + t * 136) * Math.PI / 180;
    return { x: 50 + 41 * Math.cos(ang), y: 30 + 52 * Math.sin(ang) };
  }

  render() {
    const g = this.game; if (!g) return;
    const show = this.shared.settings.showTotals;
    // dealer
    const d = g.dealer;
    $('bjDealer').innerHTML = d.cards.map((c, i) => (i === 1 && d.hidden) ? backHTML('bj-c') : cardHTML(c, 'bj-c')).join('');
    const dv = d.hidden ? (d.cards[0] ? cardValue(d.cards[0]) : null) : (d.cards.length ? handValue(d.cards) : null);
    $('bjDTotal').innerHTML = !d.cards.length ? 'Dealer' : d.hidden ? `Dealer shows ${upName(cardValue(d.cards[0]))}` : `Dealer: ${esc(describeTotal(d.cards))}`;
    // shoe and tray
    const left = g.shoe.cards.length, used = g.discards;
    $('bjShoe').innerHTML = `<span style="height:${Math.max(6, Math.round(34 * left / (RULES.decks * 52)))}px"></span>`;
    $('bjTray').innerHTML = `<span style="height:${Math.min(34, Math.round(34 * used / (RULES.decks * 52)))}px"></span>`;
    // seats (shown first base on the right)
    const n = g.seats.length;
    let html = '';
    g.seats.forEach((s, i) => {
      const { x, y } = this.seatXY(i, n);
      const turn = this.turnSeat === s && this.turnHand != null;
      let hands = '';
      s.hands.forEach((h, hi) => {
        const active = turn && this.turnHand === hi;
        const res = h.result ? `<span class="bj-res r-${h.result}">${{ win: 'Win', lose: 'Lose', push: 'Push', bust: 'Bust', blackjack: 'Blackjack!', surrender: 'Surrender' }[h.result]}</span>` : '';
        hands += `<div class="bj-hand${active ? ' active' : ''}">
          <div class="bj-cards">${h.cards.map(c => cardHTML(c, 'sm')).join('')}</div>
          ${h.cards.length ? `<span class="bj-badge">${esc(describeTotal(h.cards, h.fromSplit))}</span>` : ''}${res}
          <div class="bj-circle">${chipsHTML(betComposition(h.bet), { size: 'sm' })}${h.doubled ? '<i>×2</i>' : ''}</div>
        </div>`;
      });
      let staged = '';
      if (s.isHuman && this.staged) {
        const tot = totalOf(this.staged);
        staged = `<div class="bj-hand"><div class="bj-circle bj-staged ${tot ? '' : 'empty'}">${tot ? chipsHTML(this.staged, { size: 'md', interactive: true, attr: 'class="chips chips-md bj-staged-chips"' }) : '<span>Bet here</span>'}</div></div>`;
      }
      const ins = s.insurance ? `<span class="bj-ins">Insured</span>` : '';
      html += `<div class="bj-seat${s.isHuman ? ' me' : ''}${s.out ? ' out' : ''}${turn ? ' turn' : ''}" style="left:${x}%;top:${y}%">
        <div class="bj-hands-row">${hands}${staged}</div>${ins}
        <div class="bj-name">${esc(s.name)}${s.isHuman ? '' : `<button class="bj-stack-btn" data-bj-count="${i}" aria-label="Count ${esc(s.name)}'s chips">${chipsHTML(stackComposition(s.stack, 6), { size: 'sm', maxPerColumn: 8 })}</button>`}${show ? `<span class="total">${s.stack}</span>` : ''}</div>
      </div>`;
    });
    $('bjSeats').innerHTML = html;
    document.querySelectorAll('[data-bj-count]').forEach(b => b.onclick = () => this.count(+b.dataset.bjCount));
    this.renderMe();
  }

  renderMe() {
    const g = this.game; if (!g) return;
    const me = g.human;
    const show = this.shared.settings.showTotals;
    // your hands, large
    let html = '';
    if (me.hands.length && me.hands[0].cards.length) {
      me.hands.forEach((h, hi) => {
        const active = this.turnSeat === me && this.turnHand === hi;
        html += `<div class="bj-myhand${active ? ' active' : ''}${me.hands.length > 1 ? ' multi' : ''}">
          ${me.hands.length > 1 ? `<span class="bj-hlabel">Hand ${hi + 1}</span>` : ''}
          <div class="bj-cards">${h.cards.map(c => cardHTML(c, me.hands.length > 1 ? '' : 'lg')).join('')}</div>
          <span class="bj-badge big">${esc(describeTotal(h.cards, h.fromSplit))}</span>
        </div>`;
      });
    }
    $('bjHands').innerHTML = html;
    $('bjHands').hidden = !html;
    const counts = this.myCounts || stackComposition(me.stack);
    $('bjStack').innerHTML = chipsHTML(counts, { size: 'lg', interactive: !!this.myCounts, maxPerColumn: 10 });
    $('bjStackRow').classList.toggle('change-mode', !!this.changeMode);
    $('bjTotal').textContent = show ? (this.myCounts ? totalOf(this.myCounts) : me.stack) : '';
    $('bjStackRow').hidden = !!html && !this.myCounts;
  }

  flash(sel, i) {
    const col = document.querySelector(`${sel} .chipcol[data-denom="${i}"]`);
    if (!col) return;
    col.classList.remove('flash'); void col.offsetWidth; col.classList.add('flash');
  }
  onStackTap(i) {
    if (!this.myCounts) return;
    if (this.changeMode) { if (i > 0 && breakChip(this.myCounts, i)) { this.render(); this.flash('#bjStack', i - 1); } return; }
    if (this.myCounts[i] <= 0) return;
    this.myCounts[i]--; this.staged[i]++;
    this.render(); this.flash('.bj-staged', i);
  }
  onBetTap(i) {
    if (!this.staged || this.staged[i] <= 0) return;
    this.staged[i]--; this.myCounts[i]++;
    this.render(); this.flash('#bjStack', i);
  }

  // ---------- the bridge the game talks to ----------
  makeIO(myGen) {
    const live = () => myGen === this.gen;
    const never = () => new Promise(() => {});
    const app = this;
    return {
      async event(type, d, g) {
        if (!live()) return never();
        app.render();
        await app.narrate(type, d, g);
        if (!live()) return never();
        app.render();
        const sp = app.settings.speed;
        if (type === 'card' || type === 'dealerCard') await sleep(d.deal ? sp * 0.45 : sp * 0.7);
        if (type === 'action' && !d.seat.isHuman) await sleep(sp * 0.3);
      },
      humanBet(s, ctx) { if (!live()) return never(); return app.askBet(s, ctx); },
      humanInsurance(s, ctx) { if (!live()) return never(); return app.askInsurance(s, ctx); },
      humanAction(s, ctx) { if (!live()) return never(); return app.askAction(s, ctx); },
    };
  }

  askBet(s, ctx) {
    const L = this.level;
    this.myCounts = stackComposition(s.stack);
    this.staged = DENOMS.map(() => 0);
    this.changeMode = false;
    this.render();
    this.prompt(L === 1 ? `<b>Place your bet.</b> Tap your chips to push them into your betting circle — at least ${ctx.min}, at most ${ctx.max}. Then press <b>Deal</b>.` : L === 2 ? `<b>Place your bet</b>, then press Deal.` : `Your bet.`);
    return new Promise(res => {
      const deal = () => {
        const bet = totalOf(this.staged);
        if (bet < ctx.min) { this.say(`<b>Not enough:</b> the {{table minimum}} is ${ctx.min}.${L < 3 ? ` You have ${bet} in the circle.` : ''}`, 'mistake'); return; }
        if (bet > ctx.max) { this.say(`<b>Too much:</b> the table maximum is ${RULES.maxBet}.`, 'mistake'); return; }
        this.myCounts = null; this.staged = null; this.changeMode = false;
        this.actions([]); this.prompt('Dealing…', true);
        res(bet);
      };
      const same = () => {
        // put out the same amount as last time (or everything, if you have less now)
        const amt = Math.min(ctx.last, s.stack);
        this.staged = betComposition(amt);
        this.myCounts = stackComposition(s.stack - amt);
        this.render();
      };
      this.actions([
        { label: 'Deal', cls: 'go', onClick: deal },
        { label: 'Same bet', onClick: same },
        { label: 'Clear', onClick: () => { this.myCounts = stackComposition(s.stack); this.staged = DENOMS.map(() => 0); this.render(); } },
        { label: 'Change', cls: 'toggle', onClick: e => { this.changeMode = !this.changeMode; e.target.classList.toggle('on', this.changeMode); this.render(); if (this.changeMode) this.say('Change mode: tap a colour in your stack to swap one chip for smaller ones. Tap Change again when done.', 'note'); } },
      ]);
    });
  }

  askInsurance(s, ctx) {
    const L = this.level;
    this.prompt(ctx.blackjack ? `You have blackjack and the dealer shows an ace. Take {{even money}}?` : `The dealer shows an ace. Take {{insurance}} for ${ctx.amount}?`);
    if (L === 1) this.say(ctx.blackjack ? `<b>What I'd do: no.</b> {{even money}} is really insurance in disguise. Over time you win more by keeping your 3-to-2 blackjack and accepting the occasional {{push}}.` : `<b>What I'd do: no insurance.</b> Insurance is a side bet that the dealer's hidden card is a 10. Only about 4 in 13 cards are 10s, so it pays 2 to 1 on something that's less than a 1-in-3 chance — a losing bet over time. {{basic strategy|Basic strategy}} never takes it.`, 'advice');
    return new Promise(res => this.actions([
      { label: ctx.blackjack ? 'Even money' : 'Insurance', onClick: () => { this.review('insurance', 'no insurance'); this.actions([]); res(true); } },
      { label: ctx.blackjack ? 'No, play on' : 'No thanks', cls: 'go', onClick: () => { this.review('no insurance', 'no insurance'); this.actions([]); res(false); } },
    ]));
  }

  askAction(s, ctx) {
    const L = this.level;
    const h = ctx.hand;
    const v = handValue(h.cards);
    const up = upName(ctx.upv);
    const label = describeTotal(h.cards, h.fromSplit);
    this.prompt(`${ctx.hands > 1 ? `<b>Hand ${ctx.handIndex + 1}:</b> ` : '<b>Your turn:</b> '}${label} against the dealer's ${up}.`);
    if (L === 1) this.advise(ctx);
    const why = {
      double: !h.cards.length || h.cards.length > 2 ? `You can only {{double down}} on your first two cards.` : h.splitAces ? `Split aces get one card each — no doubling.` : `You don't have enough chips left to double your bet of ${h.bet}.`,
      split: !isPair(h.cards) ? `You can only {{split}} two cards of the same value, like 8-8 or K-10.` : h.cards.length > 2 ? `You can only split your first two cards.` : s.hands.length >= RULES.maxHands ? `This table allows up to four hands from splitting.` : h.splitAces ? `Split aces can't be split again here.` : `You don't have enough chips left for a second bet of ${h.bet}.`,
      surrender: !this.settings.surrender ? `This table doesn't offer {{surrender}}. You can switch it on when you start a new game.` : `You can only surrender your first two cards, before doing anything else.`,
    };
    return new Promise(res => {
      const go = act => () => {
        if (act !== 'hit' && act !== 'stand' && !ctx.allowed[act]) { this.say(`<b>Not allowed:</b> ${why[act]}`, 'mistake'); return; }
        this.actions([]);
        this.review(act, ctx.best, ctx);
        res(act);
      };
      const list = [
        { label: 'Hit', cls: 'go', onClick: go('hit') },
        { label: 'Stand', cls: 'go', onClick: go('stand') },
        { label: 'Double', onClick: go('double'), off: !ctx.allowed.double },
        { label: 'Split', onClick: go('split'), off: !ctx.allowed.split },
      ];
      if (this.settings.surrender) list.push({ label: 'Surrender', onClick: go('surrender'), off: !ctx.allowed.surrender });
      if (L === 2) list.push({ label: 'Hint', cls: 'hint', onClick: () => { this.advise(ctx); if (innerWidth < 900) this.openDrawer(); } });
      this.actions(list);
    });
  }

  advise(ctx) {
    const best = ctx.best;
    const h = ctx.hand;
    const word = { hit: 'hit', stand: 'stand', double: 'double down', split: 'split', surrender: 'surrender' }[best];
    this.say(`<b>What I'd do: ${word}.</b> ${reasonFor(best, h.cards, ctx.upv, ctx.allowed)}`, 'advice');
  }

  // Compare your decision with basic strategy.
  review(act, best, ctx) {
    this.stats.decisions++;
    const right = act === best;
    if (right) { this.stats.correct++; this.persist(); return; }
    this.persist();
    if (act === 'insurance') { this.say(`<b>Mistake:</b> {{insurance}} loses money over time — it pays 2 to 1 on something that happens less than a third of the time.`, 'mistake'); return; }
    if (!ctx) return;
    const word = { hit: 'hit', stand: 'stand', double: 'double down', split: 'split', surrender: 'surrender' };
    this.say(`<b>Mistake:</b> {{basic strategy}} says <b>${word[best]}</b>, not ${word[act]}. ${reasonFor(best, ctx.hand.cards, ctx.upv, ctx.allowed)}`, 'mistake');
  }

  // ---------- narration ----------
  async narrate(type, d, g) {
    const L = this.level;
    const nm = s => (s.isHuman ? 'You' : s.name);
    const up = g.up ? upName(cardValue(g.up)) : '';
    switch (type) {
      case 'shuffle':
        if (L <= 2) this.say(`The {{cut card}} came out last round, so the dealer shuffles all six decks and puts the {{cut card}} back about three-quarters of the way in.`, 'note');
        break;
      case 'burn':
        if (L === 1) this.say(`New {{shoe}}: the dealer takes the first card off and puts it in the {{discard tray}} unseen — the {{burn card}}.`);
        break;
      case 'roundStart':
        this.turnSeat = null; this.turnHand = null;
        this.divider(`Round ${d.round}`);
        break;
      case 'bet':
        if (!d.seat.isHuman && L === 1 && g.round <= 2) this.say(`${d.seat.name} puts ${d.bet} in the betting circle.`, 'action');
        this.persist();
        break;
      case 'dealStart':
        if (L === 1 && g.round <= 3) this.say(`The dealer deals one card face up to each player, starting at {{first base}} (on the dealer's left — your right) and going round to {{third base}}, then one to the dealer. Then a second card each — and the dealer's second card goes face down: the {{hole card}}.`);
        break;
      case 'dealerCard':
        if (d.deal && d.hole) {
          const hv = handValue(g.human.hands[0].cards);
          if (L <= 2) this.say(`The dealer's {{upcard}} is a${/^[8A]|ace/.test(up) ? 'n' : ''} <b>${up}</b>. ${L === 1 ? (cardValue(g.up) <= 6 ? `That's a weak upcard — a {{bust card}}: the dealer busts about ${DEALER_BUST[cardValue(g.up)]}% of the time.` : `That's a strong upcard: the dealer will often make 17 or better.`) : ''}`, 'street');
        } else if (!d.deal && L <= 2) {
          const v = handValue(g.dealer.cards);
          this.say(`The dealer draws ${cardName(g.dealer.cards[g.dealer.cards.length - 1])} and ${dealerRuleText(g.dealer.cards)}.`, v.total > 21 ? 'result' : 'action');
        }
        break;
      case 'insuranceOffer':
        if (L <= 2) this.say(`With an ace showing, the dealer offers {{insurance}}: a side bet of up to half your stake that the {{hole card}} makes blackjack.`);
        break;
      case 'insurance':
        if (!d.seat.isHuman && d.took && L <= 2) this.say(`${d.seat.name} takes insurance.${L === 1 ? ' (Basic strategy would say no.)' : ''}`, 'action');
        break;
      case 'peek':
        if (L === 1) this.say(`The dealer {{peek|peeks}} at the hole card for blackjack${d.dealerBJ ? '…' : ' — no blackjack, so play goes on.'}`);
        break;
      case 'insuranceLost':
        if (d.seat.isHuman && L <= 2) this.say(`No dealer blackjack, so your insurance bet of ${d.amount} is lost.`, 'result');
        break;
      case 'reveal':
        if (d.dealerBJ) this.say(`The dealer has <b>blackjack</b>! Every hand loses except another blackjack, which {{push|pushes}}. Insurance bets pay 2 to 1.`, 'result');
        else if (L <= 2 && g.dealer.cards[1]) this.say(`The dealer turns over the hole card: ${cardName(g.dealer.cards[1])}, making ${lc(describeTotal(g.dealer.cards))}.${d.live ? (L === 1 ? ` The dealer has no choices: draw on 16 or less, stand on any 17 or more.` : '') : ' Every hand is already settled, so the dealer stops there.'}`, 'street');
        break;
      case 'blackjack':
        this.say(`${nm(d.seat)} ${d.seat.isHuman ? 'have' : 'has'} <b>blackjack</b>! ${L <= 2 ? `It {{pays 3 to 2}}: the ${d.hand.bet} bet wins ${d.win}.` : ''}${d.hand.bet % 2 && L === 1 ? ' (With an odd bet the half chip is rounded down — bet even amounts to avoid that.)' : ''}`, 'result');
        break;
      case 'turn':
        this.turnSeat = d.seat; this.turnHand = d.handIndex;
        if (!d.seat.isHuman && L === 1 && d.hands === 1 && d.hand.cards.length === 2) { /* narrated on action */ }
        break;
      case 'action': {
        const s = d.seat;
        if (s.isHuman) {
          if (L === 1) this.say(`You ${{ hit: '{{hit}}', stand: '{{stand}}', double: '{{double down}}', split: '{{split}}', surrender: '{{surrender}}' }[d.act]}.`, 'you');
          break;
        }
        if (L === 3) break;
        const label = describeTotal(d.hand.cards, d.hand.fromSplit);
        let t = `${s.name} ${ACT_TERM[d.act]} on ${label.toLowerCase().startsWith('soft') ? label.toLowerCase() : label}.`;
        if (L === 1 && d.act !== d.ctx.best) t += ` Basic strategy says ${d.ctx.best} — ${s.name} is playing a hunch.`;
        this.say(t, 'action');
        break;
      }
      case 'card':
        if (d.seat.isHuman && !d.deal && L === 1) {
          const v = handValue(d.hand.cards);
          if (v.total > 21) break;
          this.say(`You get ${cardName(d.hand.cards[d.hand.cards.length - 1])}: now ${describeTotal(d.hand.cards, d.hand.fromSplit).toLowerCase()}.${d.doubled ? ' Doubling gives exactly one card, so that hand is finished.' : ''}`, 'you');
        }
        break;
      case 'split':
        if (L <= 2) this.say(`${nm(d.seat)} {{split}} the ${d.aces ? 'aces' : 'pair'}: a second bet of ${d.other.bet} goes out and each card starts its own hand.${d.aces && L === 1 ? ' Split aces get just one card each.' : L === 1 ? ' Each hand is played in turn, and you can double after splitting.' : ''}`, d.seat.isHuman ? 'you' : 'action');
        break;
      case 'splitAcesDone':
        break;
      case 'bust':
        if (L <= 2 || d.seat.isHuman) this.say(`${nm(d.seat)} ${d.seat.isHuman ? '{{bust}}' : '{{bust|busts}}'} with ${handValue(d.hand.cards).total}${d.seat.isHuman && L === 1 ? ` — over 21 loses straight away, even if the dealer busts later. That's where the casino's edge comes from: the player has to act first` : ''}.`, d.seat.isHuman ? 'result' : 'action');
        break;
      case 'surrendered':
        if (L <= 2) this.say(`${nm(d.seat)} {{surrender}}${d.seat.isHuman ? '' : 's'} and get${d.seat.isHuman ? '' : 's'} ${d.back} back.`, 'action');
        break;
      case 'dealerDone':
        this.turnSeat = null; this.turnHand = null;
        break;
      case 'settle': {
        const me = g.human;
        const mine = d.results.filter(r => r.seat === me);
        const lines = [];
        for (const r of mine) {
          if (r.insurance) { lines.push(`Insurance pays ${r.insurance}.`); continue; }
          const h = r.hand;
          const lbl = me.hands.length > 1 ? `Hand ${me.hands.indexOf(h) + 1}` : 'Your hand';
          const tot = lc(describeTotal(h.cards, h.fromSplit));
          const dt = lc(describeTotal(g.dealer.cards));
          const amt = L <= 2 ? ` — ${h.result === 'win' ? `you win ${h.bet}` : h.result === 'push' ? `your ${h.bet} comes back` : h.result === 'blackjack' ? `paid ${h.won}` : h.result === 'surrender' ? `half back` : `you lose ${h.bet}`}` : '';
          const what = { win: d.dealer.total > 21 ? `wins — the dealer busted` : `wins: ${tot} beats ${dt}`, lose: d.dealerBJ ? `loses to the dealer's blackjack` : `loses: ${dt} beats ${tot}`, push: `is a {{push}}: ${tot} each`, bust: `went {{bust}}`, blackjack: `was a blackjack`, surrender: `was surrendered` }[h.result];
          lines.push(`${lbl} ${what}${amt}.`);
        }
        if (lines.length) this.say(lines.join('<br>'), 'result');
        this.persist();
        break;
      }
      case 'out':
        if (!d.seat.isHuman) this.say(`${d.seat.name} is out of chips and leaves the table.`, 'note');
        break;
      case 'roundEnd':
        if (d.shuffleNext && L <= 2) this.say(`The {{cut card}} came out this round, so the dealer will shuffle before the next one.`, 'note');
        if (!d.over) {
          if (this.stats.decisions >= 10 && g.round % 10 === 0 && L <= 2) this.say(`Your {{basic strategy}} score so far: ${this.stats.correct} of ${this.stats.decisions} decisions right (${Math.round(100 * this.stats.correct / this.stats.decisions)}%).`, 'note');
          this.prompt('Round over.', true);
          await this.waitContinue('Next round');
        }
        break;
    }
  }

  // ---------- sheets ----------
  count(i) {
    const s = this.game.seats[i];
    $('infoBody').innerHTML = `<h2 class="bj-h">Count the chips</h2>${legendHTML()}<p>How much has ${esc(s.name)} got?</p>
      <div class="row"><input type="number" inputmode="numeric" id="bjCountIn" placeholder="Your count"><button class="primary" id="bjCountGo">Check</button></div>
      <div id="bjCountRes" class="count-result"></div>`;
    this.shared.ui.open('info');
    const check = () => { const v = parseInt($('bjCountIn').value, 10); const r = $('bjCountRes'); r.className = 'count-result ' + (v === s.stack ? 'ok' : 'bad'); r.textContent = v === s.stack ? `Correct — ${s.stack}.` : isNaN(v) ? 'Enter a number.' : `Not quite — ${v > s.stack ? 'too high' : 'too low'}.`; };
    $('bjCountGo').onclick = check;
  }

  menu() {
    const ui = this.shared.ui;
    const st = this.stats;
    $('infoBody').innerHTML = `<h2 class="bj-h">Menu</h2>
      ${st.decisions ? `<p class="muted">Your basic strategy score: ${st.correct} of ${st.decisions} decisions right (${Math.round(100 * st.correct / st.decisions)}%).</p>` : ''}
      <button class="menu-item" id="bmNew">New game / settings</button>
      <button class="menu-item" id="bmChart">Basic strategy chart</button>
      <button class="menu-item" id="bmRules">How to play</button>
      <button class="menu-item" id="bmWords">Glossary of blackjack words</button>
      <button class="menu-item" id="bmChips">Chip values</button>
      <button class="menu-item" id="bmSwitch">Switch game</button>
      <button class="menu-item" id="bmAccount">Account and who can use the app</button>`;
    ui.open('info');
    $('bmNew').onclick = () => this.setup();
    $('bmChart').onclick = () => this.chart();
    $('bmRules').onclick = () => this.rules();
    $('bmWords').onclick = () => this.glossary();
    $('bmChips').onclick = () => { $('infoBody').innerHTML = `<h2 class="bj-h">Chip values</h2>${legendHTML()}<p>Tap a colour in your stack to push one chip into your betting circle; tap a chip in the circle to take it back. <b>Change</b> swaps a chip for smaller ones.</p>`; };
    $('bmSwitch').onclick = () => { ui.close('info'); this.shared.onSwitch(); };
    $('bmAccount').onclick = () => this.shared.openAccount();
  }

  chart() {
    const ups = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const C = r => ({ r, s: 'x' });
    const cell = a => `<td class="sc-${a}">${{ H: 'H', S: 'S', D: 'D', Ds: 'Ds', P: 'P', R: 'R', Rs: 'R' }[a]}</td>`;
    const surr = this.settings.surrender;
    const fix = a => (!surr && a === 'R') ? 'H' : a;
    let html = `<h2 class="bj-h">Basic strategy</h2>
      <p class="muted">For this table: 6 decks, dealer stands on soft 17, double after split allowed${surr ? ', surrender allowed' : ''}. Find your hand on the left and the dealer's upcard along the top.</p>
      <div class="sc-key"><span class="sc-H">H hit</span><span class="sc-S">S stand</span><span class="sc-D">D double (else hit)</span><span class="sc-Ds">Ds double (else stand)</span><span class="sc-P">P split</span>${surr ? '<span class="sc-R">R surrender (else hit)</span>' : ''}</div>`;
    const table = (title, rows) => `<h3>${title}</h3><div class="sc-wrap"><table class="sc"><thead><tr><th></th>${ups.map(u => `<th>${u === 11 ? 'A' : u}</th>`).join('')}</tr></thead><tbody>${rows.map(([lbl, cards]) => `<tr><th>${lbl}</th>${ups.map(u => cell(fix(chartAction(cards, u, { noPair: !lbl.includes(',') })))).join('')}</tr>`).join('')}</tbody></table></div>`;
    const hard = [];
    for (let t = 17; t >= 8; t--) hard.push([t === 17 ? '17+' : t === 8 ? '5–8' : String(t), t >= 12 ? [C(10), C(t - 10)] : t >= 10 ? [C(t - 4), C(4)] : [C(t - 3), C(3)]]);
    const soft = [];
    for (let t = 9; t >= 2; t--) soft.push([`A–${t} (soft ${11 + t})`, [C(14), C(t)]]);
    const pairs = [[14, 'A,A'], [10, '10,10'], [9, '9,9'], [8, '8,8'], [7, '7,7'], [6, '6,6'], [5, '5,5'], [4, '4,4'], [3, '3,3'], [2, '2,2']].map(([r, l]) => [l, [C(r), C(r)]]);
    html += table('Hard totals', hard) + table('Soft totals (with an ace counted as 11)', soft) + table('Pairs', pairs);
    html += `<p class="muted">Never take insurance or even money. Following this chart every time brings the casino's edge down to about half a percent.</p>`;
    $('infoBody').innerHTML = this.termify(html);
    this.shared.ui.open('info');
  }

  rules() {
    $('infoBody').innerHTML = this.termify(`<h2 class="bj-h">How to play</h2>
      <h3>The aim</h3><p>Beat the dealer: finish closer to 21 than the dealer without going over. Cards 2–10 count their number, J, Q and K count 10, and an ace counts 1 or 11.</p>
      <h3>A round</h3><ol>
        <li>Everyone bets by putting chips in their circle.</li>
        <li>Two cards each, face up; the dealer gets one face up (the {{upcard}}) and one face down (the {{hole card}}).</li>
        <li>If the dealer shows an ace, {{insurance}} is offered. If the dealer shows an ace or a 10, the dealer {{peek|peeks}} for blackjack.</li>
        <li>Each player in turn, from {{first base}}, chooses: {{hit}}, {{stand}}, {{double down}}, {{split}}${this.settings.surrender ? ' or {{surrender}}' : ''}.</li>
        <li>The dealer turns over the hole card and must draw to 16 and stand on 17 or more.</li>
        <li>Win: paid 1 to 1. Tie: a {{push}}. {{blackjack|Blackjack}} pays 3 to 2.</li></ol>
      <h3>Splitting</h3><p>With two cards of the same value you can {{split}} them into two hands, putting out a second bet equal to the first. Each hand gets a second card and is played on its own; you can double after splitting and split again up to four hands. Split aces get one card each, and an ace plus a 10 after splitting counts as 21, not blackjack.</p>
      <h3>Why the casino wins</h3><p>If you {{bust}}, you lose even if the dealer busts afterwards. Playing {{basic strategy}} cuts the {{house edge}} to about 0.5%.</p>`);
    this.shared.ui.open('info');
  }

  glossary(q = '') {
    const render = query => { $('bjGlossList').innerHTML = searchBJGlossary(query).map(i => `<dt>${esc(i.term)}</dt><dd>${esc(i.def)}</dd>`).join('') || '<p class="muted">No matches.</p>'; };
    $('infoBody').innerHTML = `<h2 class="bj-h">Blackjack words</h2><input type="text" id="bjGlossQ" placeholder="Search, e.g. soft" value="${esc(q)}"><dl class="gloss-list" id="bjGlossList"></dl>`;
    this.shared.ui.open('info');
    render(q);
    $('bjGlossQ').oninput = e => render(e.target.value);
  }
}

const lc = t => (t === 'Blackjack' ? 'blackjack' : t.replace(/^Soft/, 'soft').replace(/^Bust/, 'bust'));
function cardName(c) {
  const n = { 11: 'a jack', 12: 'a queen', 13: 'a king', 14: 'an ace', 8: 'an 8' }[c.r] || `a ${c.r}`;
  return n;
}
function load(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function save(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }
