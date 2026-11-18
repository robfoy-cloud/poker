// Backgammon Coach: the board, your moves, the opponent, the doubling cube and the coach.

import * as E from './engine.js';
import { lookupBG, searchBGGlossary } from './glossary.js';
import { openAsk } from '../ask.js';
import { BgRemote, createGame } from './online.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// moves are shown with arrows (13→7) rather than the slash notation (13/7)
const arrows = t => String(t).replace(/\//g, '→');
const N = steps => arrows(E.notation(steps));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const roll1 = () => 1 + Math.floor(Math.random() * 6);
const LEVEL_NAMES = ['', 'Learn', 'Advise', 'Test'];
const DEFAULTS = { opp: 1, level: 1, cube: true, speed: 550, light: true };
const POINT_NAMES = { 5: 'your 5-point (the {{golden point}})', 7: 'your {{bar point}} (7-point)', 4: 'your 4-point', 6: 'your 6-point', 13: 'your {{midpoint}}' };

// ---------- board geometry (SVG units) ----------
const G = { W: 470, H: 360, F: 10, PW: 30, BAR: 30, PH: 140, TRAY: 40 };
G.L0 = G.F; G.L1 = G.L0 + 6 * G.PW; G.R0 = G.L1 + G.BAR; G.R1 = G.R0 + 6 * G.PW; G.T0 = G.R1 + G.F; G.T1 = G.T0 + G.TRAY;
G.W = G.T1 + G.F;
// x of the left edge of the column for MY point i (1..24), and whether it's on the top half
function col(i) {
  if (i <= 6) return { x: G.R1 - i * G.PW, top: false };
  if (i <= 12) return { x: G.L1 - (i - 6) * G.PW, top: false };
  if (i <= 18) return { x: G.L0 + (i - 13) * G.PW, top: true };
  return { x: G.R0 + (i - 19) * G.PW, top: true };
}

export class BackgammonApp {
  constructor(shared) {
    this.shared = shared;
    this.settings = { ...DEFAULTS, ...(load('bg.settings') || {}) };
    this.score = load('bg.score') || { me: 0, them: 0 };
    this.unread = 0;
    this.build();
  }
  get level() { return this.settings.level; }
  get oppName() { return this.remote ? ((this.online && this.online.names.them) || 'Your friend') : E.LEVELS[this.settings.opp - 1].name; }

  // ---------- markup ----------
  build() {
    $('bgView').innerHTML = `
      <header class="topbar bg-top">
        <button class="brand brand-btn" id="bgGames" aria-label="Switch game"><img src="icons/backgammon.svg" alt="" width="26" height="26"><span>Backgammon Coach</span><i class="chev">▾</i></button>
        <div class="top-actions">
          <select id="bgLevel" aria-label="Coaching level"><option value="1">Learn</option><option value="2">Advise</option><option value="3">Test</option></select>
          <button class="iconbtn" id="bgMenuBtn" aria-label="Menu">☰</button>
        </div>
      </header>
      <main class="bg-layout">
        <section class="bg-main">
          <div class="bg-player" id="bgOpp"></div>
          <div class="bg-board-frame"><svg id="bgBoard" class="bg-board" viewBox="0 0 ${G.W} ${G.H}" role="img" aria-label="Backgammon board"></svg></div>
          <div class="bg-player" id="bgMe"></div>
          <div class="bg-status" id="bgStatus"></div>
          <button class="c-ticker bg-ticker" id="bgTicker" hidden aria-live="polite"></button>
          <div class="bg-actions" id="bgActions"></div>
        </section>
        <button class="coach-tab bg-tab" id="bgTab" aria-label="Open the coach panel"><span class="tab-label">Coach</span><span class="badge" id="bgBadge" hidden></span></button>
        <section class="coach-panel bg-coach" id="bgCoach">
          <div class="coach-head"><span>Coach</span>
            <div class="coach-tools">
              <button class="small" id="bgAskBtn">Ask</button>
              <button class="small" id="bgRulesBtn">Rules</button>
              <button class="small" id="bgWordsBtn">Words</button>
              <button class="small drawer-close" id="bgClose">Close ›</button>
            </div>
          </div>
          <div class="coach-log" id="bgLog" aria-live="polite"></div>
        </section>
      </main>`;
    $('bgGames').onclick = () => this.shared.onSwitch();
    $('bgLevel').value = this.settings.level;
    $('bgLevel').onchange = e => { this.settings.level = +e.target.value; save('bg.settings', this.settings); this.say(`Coaching level changed to <b>${LEVEL_NAMES[this.level]}</b>.`, 'note'); };
    $('bgMenuBtn').onclick = () => this.menu();
    $('bgRulesBtn').onclick = () => this.rules();
    $('bgAskBtn').onclick = () => this.ask();
    $('bgWordsBtn').onclick = () => this.glossary();
    $('bgTab').onclick = () => this.openDrawer();
    $('bgClose').onclick = () => this.closeDrawer();
    $('bgTicker').onclick = e => { if (!e.target.closest('.term')) this.openDrawer(); };
    $('bgBoard').addEventListener('click', e => {
      const t = e.target.closest('[data-pt]');
      if (t) this.onPoint(+t.dataset.pt);
    });
    document.addEventListener('pointerdown', e => {
      const panel = $('bgCoach');
      if ($('bgView').hidden || !panel.classList.contains('open')) return;
      if (panel.contains(e.target) || $('bgTab').contains(e.target) || e.target.closest('.sheet') || e.target.closest('#termPop')) return;
      this.closeDrawer();
      if (e.target.closest('.bg-board-frame')) this.swallow = true;
    }, true);
    document.addEventListener('click', e => { if (this.swallow) { this.swallow = false; e.stopPropagation(); e.preventDefault(); } }, true);
    let sx = null;
    $('bgCoach').addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    $('bgCoach').addEventListener('touchend', e => { if (sx != null && e.changedTouches[0].clientX - sx > 70) this.closeDrawer(); sx = null; });
  }

  // ---------- coach text ----------
  termify(html) {
    return html.replace(/\{\{([^}|]+)(?:\|([^}]+))?\}\}/g, (m, term, shown) => {
      const hit = lookupBG(term);
      return hit ? `<button class="term" data-ns="bg" data-term="${esc(hit.term)}">${shown || term}</button>` : (shown || term);
    });
  }
  say(html, kind = 'info') {
    const log = $('bgLog');
    const div = document.createElement('div');
    div.className = 'msg ' + kind;
    div.innerHTML = this.termify(html);
    log.appendChild(div);
    while (log.children.length > 300) log.removeChild(log.firstChild);
    if (div.offsetHeight > log.clientHeight - 10) log.scrollTop = div.offsetTop - 6; else log.scrollTop = log.scrollHeight;
    const t = $('bgTicker');
    t.innerHTML = `<span class="tk-text">${div.innerHTML.replace(/<br\s*\/?>/g, ' ')}</span>`;
    t.className = 'c-ticker bg-ticker k-' + kind; t.hidden = false;
    if (!$('bgCoach').classList.contains('open') && kind !== 'note') {
      this.unread++;
      const b = $('bgBadge'); b.hidden = false; b.textContent = this.unread > 9 ? '9+' : this.unread;
      if (kind === 'mistake' || kind === 'advice') $('bgTab').classList.add('alert');
    }
  }
  divider(text) { const d = document.createElement('div'); d.className = 'divider'; d.textContent = text; $('bgLog').appendChild(d); }
  openDrawer() {
    const top = document.querySelector('#bgView .topbar').getBoundingClientRect().bottom;
    const st = $('bgStatus').getBoundingClientRect().top;
    document.documentElement.style.setProperty('--drawer-top', Math.round(top) + 'px');
    document.documentElement.style.setProperty('--drawer-bottom', Math.round(window.innerHeight - st) + 'px');
    $('bgCoach').classList.add('open'); $('bgTab').classList.add('hidden');
    this.unread = 0; $('bgBadge').hidden = true; $('bgTab').classList.remove('alert');
    const log = $('bgLog'), last = log.lastElementChild;
    if (last && last.offsetHeight > log.clientHeight - 10) log.scrollTop = last.offsetTop - 6; else log.scrollTop = log.scrollHeight;
  }
  closeDrawer() { $('bgCoach').classList.remove('open'); $('bgTab').classList.remove('hidden'); }
  status(html, wait = false) { const s = $('bgStatus'); s.innerHTML = this.termify(html); s.classList.toggle('wait', wait); }
  actions(list) {
    const box = $('bgActions'); box.innerHTML = '';
    for (const a of list) {
      const b = document.createElement('button');
      b.textContent = a.label; b.className = a.cls || '';
      b.onclick = a.onClick; box.appendChild(b);
    }
  }
  choose(list) { return new Promise(res => this.actions(list.map(([label, value, cls]) => ({ label, cls, onClick: () => { this.actions([]); res(value); } })))); }

  // ---------- lifecycle ----------
  show() {
    if (this.started || this.remote) return;
    const saved = load('bg.game');
    if (saved && saved.a && !saved.over) this.resume(saved);
    else this.setup();
  }

  setup() {
    const s = this.settings, ui = this.shared.ui;
    $('infoBody').innerHTML = this.termify(`<h2 class="bg-h">New backgammon game</h2>
      <label class="field">Your name<input type="text" id="bgName" maxlength="14" placeholder="You" value="${esc(this.shared.settings.name || '')}"></label>
      <fieldset class="field levels"><legend>Opponent</legend>
        ${E.LEVELS.map(l => `<label><input type="radio" name="bgOpp" value="${l.id}" ${s.opp === l.id ? 'checked' : ''}><span><b>${l.name}</b> — ${l.blurb}</span></label>`).join('')}
      </fieldset>
      <fieldset class="field levels"><legend>Coaching</legend>
        <label><input type="radio" name="bgLvl" value="1" ${s.level === 1 ? 'checked' : ''}><span><b>Learn</b> — I explain every move, the rules as they come up, and what I'd play and why.</span></label>
        <label><input type="radio" name="bgLvl" value="2" ${s.level === 2 ? 'checked' : ''}><span><b>Advise</b> — I describe the moves; tap Hint when you want my move.</span></label>
        <label><input type="radio" name="bgLvl" value="3" ${s.level === 3 ? 'checked' : ''}><span><b>Test</b> — I say nothing unless you make a clear mistake.</span></label>
      </fieldset>
      <div class="field"><div>Your checkers</div><div class="seg-row">${[[true, 'Light'], [false, 'Dark']].map(([v, l]) => `<button class="seg ${s.light === v ? 'on' : ''}" data-light="${v}">${l}</button>`).join('')}</div></div>
      <label class="check"><input type="checkbox" id="bgCube" ${s.cube ? 'checked' : ''}><span>Play with the {{doubling cube}}</span></label>
      <label class="field">Speed<select id="bgSpeed"><option value="900" ${s.speed === 900 ? 'selected' : ''}>Slow</option><option value="550" ${s.speed === 550 ? 'selected' : ''}>Normal</option><option value="250" ${s.speed === 250 ? 'selected' : ''}>Fast</option></select></label>
      <button class="primary wide bg-primary" id="bgStart">Start the game</button>
      <div class="online-box">
        <h3>Play a friend online</h3>
        <p class="muted">Each of you plays on your own phone, with your own coach. The server rolls the dice for both of you.</p>
        ${localStorage.getItem('bg.onlineCode') ? `<p><button class="primary bg-primary" id="bgRejoin">Rejoin game ${esc(localStorage.getItem('bg.onlineCode'))}</button></p>` : ''}
        <div class="row"><button class="small" id="bgHost">Start a game for a friend</button><button class="small" id="bgJoin">Join a friend's game</button></div>
      </div>`);
    ui.open('info');
    let light = s.light;
    document.querySelectorAll('[data-light]').forEach(b => b.onclick = () => { light = b.dataset.light === 'true'; document.querySelectorAll('[data-light]').forEach(x => x.classList.toggle('on', x === b)); });
    const readCommon = () => {
      s.level = +document.querySelector('input[name=bgLvl]:checked').value;
      s.cube = $('bgCube').checked; s.speed = +$('bgSpeed').value; s.light = light;
      this.shared.settings.name = $('bgName').value.trim().slice(0, 14);
      this.shared.saveSettings(); save('bg.settings', s); $('bgLevel').value = s.level;
      if (!this.shared.settings.name) { $('bgName').focus(); $('bgName').placeholder = 'Add your name to play online'; return false; }
      return true;
    };
    $('bgHost').onclick = async () => {
      if (!readCommon()) return;
      if (!navigator.onLine) return this.onlineFail('You need an internet connection to play online.');
      $('infoBody').innerHTML = `<h2 class="bg-h">Play a friend online</h2><p>Setting up a game…</p>`;
      try { this.startOnline(await createGame(s.cube)); } catch (e) { this.onlineFail(`Couldn't start a game: ${esc(e.message)}`); }
    };
    if ($('bgRejoin')) $('bgRejoin').onclick = () => { if (readCommon()) this.startOnline(localStorage.getItem('bg.onlineCode')); };
    $('bgJoin').onclick = () => {
      if (!readCommon()) return;
      $('infoBody').innerHTML = `<h2 class="bg-h">Join a friend's game</h2><p>Enter the code on your friend's screen.</p>
        <div class="row"><input type="text" id="bgCode" maxlength="6" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="e.g. K7QPM" style="text-transform:uppercase;font-size:22px;letter-spacing:4px"><button class="primary bg-primary" id="bgCodeGo">Join</button></div>`;
      $('bgCode').focus();
      const go = () => { const c = $('bgCode').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); if (c.length >= 4) this.startOnline(c); };
      $('bgCodeGo').onclick = go; $('bgCode').onkeydown = e => { if (e.key === 'Enter') go(); };
    };
    $('bgStart').onclick = () => {
      this.leaveOnline();
      const changedOpp = +document.querySelector('input[name=bgOpp]:checked').value !== s.opp;
      s.opp = +document.querySelector('input[name=bgOpp]:checked').value;
      s.level = +document.querySelector('input[name=bgLvl]:checked').value;
      s.cube = $('bgCube').checked; s.speed = +$('bgSpeed').value; s.light = light;
      this.shared.settings.name = $('bgName').value.trim().slice(0, 14);
      this.shared.saveSettings();
      if (changedOpp) { this.score = { me: 0, them: 0 }; save('bg.score', this.score); }
      save('bg.settings', s); $('bgLevel').value = s.level;
      ui.close('info');
      this.newGame();
    };
  }

  newGame() {
    this.gen = (this.gen || 0) + 1;
    this.pos = E.START(); this.cube = 1; this.owner = -1; this.over = false; this.started = true;
    this.dice = null; this.oppDice = null; this.first = true; this.selected = null; this.hint = null;
    $('bgLog').innerHTML = '';
    const L = this.level;
    let intro = `New game against <b>${this.oppName}</b>. You play the ${this.settings.light ? 'light' : 'dark'} checkers and move them anticlockwise round to your {{home board}} at the bottom right, then {{bear off}}. First to bear off all 15 wins.`;
    if (L === 1) intro += ` The numbers round the edge are your point numbers: your checkers travel from 24 down to 1. Your opponent goes the other way. Each die moves one checker that many points, and you can't land where your opponent has two or more checkers.`;
    this.say(intro, 'note');
    this.render();
    this.run(this.gen);
  }

  resume(saved) {
    this.gen = (this.gen || 0) + 1;
    this.pos = { a: [Int8Array.from(saved.a[0]), Int8Array.from(saved.a[1])] };
    this.cube = saved.cube; this.owner = saved.owner; this.over = false; this.started = true; this.first = false;
    this.turn = saved.turn; this.dice = null; this.oppDice = null;
    $('bgLog').innerHTML = '';
    this.say(`Welcome back — your game against ${this.oppName} is where you left it.`, 'note');
    this.render();
    this.run(this.gen, saved.turn);
  }

  persist() { save('bg.game', { a: [Array.from(this.pos.a[0]), Array.from(this.pos.a[1])], cube: this.cube, owner: this.owner, turn: this.turn, over: this.over }); }

  // ---------- the game loop ----------
  async run(gen, startTurn) {
    const live = () => gen === this.gen;
    let turn = startTurn;
    if (turn == null) {
      // opening roll: one die each, higher goes first and plays both numbers
      for (;;) {
        this.status('Opening roll…', true);
        const mine = roll1(), theirs = roll1();
        this.dice = [mine]; this.oppDice = [theirs]; this.render();
        await sleep(this.settings.speed + 200);
        if (!live()) return;
        if (mine === theirs) { if (this.level <= 2) this.say(`Opening roll: you both rolled ${mine}, so you roll again.`, 'note'); continue; }
        turn = mine > theirs ? 0 : 1;
        if (this.level <= 2) this.say(`{{opening roll|Opening roll}}: you rolled ${mine}, ${this.oppName} rolled ${theirs}. ${turn === 0 ? `You go first, and your first move uses both numbers: ${Math.max(mine, theirs)}-${Math.min(mine, theirs)}.` : `${this.oppName} goes first, playing ${Math.max(mine, theirs)}-${Math.min(mine, theirs)}.`}`, 'street');
        this.firstRoll = [Math.max(mine, theirs), Math.min(mine, theirs)];
        break;
      }
    }
    while (live() && !this.over) {
      this.turn = turn; this.persist();
      if (turn === 0) await this.myTurn(live); else await this.theirTurn(live);
      if (!live()) return;
      if (this.over) break;
      this.first = false; this.firstRoll = null;
      turn = 1 - turn;
    }
  }

  // ---------- your turn ----------
  async myTurn(live) {
    const L = this.level;
    let d1, d2;
    if (this.firstRoll) [d1, d2] = this.firstRoll;
    else {
      this.dice = null; this.oppDice = null; this.render();
      const canDouble = this.settings.cube && this.owner !== 1 && this.cube < 64;
      const w = E.winChance(this.pos, 0);
      if (canDouble && L === 1 && w >= 0.62) this.say(`You're doing well — I'd put your chances at roughly ${Math.round(w * 100)}%. ${w >= 0.68 ? `That's enough to {{double}}: offering the cube now makes your opponent decide whether to play on for ${this.cube * 2} points or give up ${this.cube}.` : 'Doubling is usually right from about 68%; not quite yet.'}`, 'advice');
      this.status(`<b>Your turn.</b> ${canDouble ? 'Roll the dice, or offer a double first.' : 'Roll the dice.'}`);
      const choice = await this.choose([['Roll', 'roll', 'go'], ...(canDouble ? [[`Double to ${this.cube * 2}`, 'double']] : [])]);
      if (!live()) return;
      if (choice === 'double') {
        const ended = await this.offerDouble(0, live);
        if (ended || !live()) return;
      }
      d1 = roll1(); d2 = roll1();
    }
    const played = await this.chooseMove(d1, d2, live);
    if (!live() || !played) return;
    this.checkWin(0);
  }

  // Let you pick your move for a roll, with advice and a check afterwards. Returns the steps played.
  async chooseMove(d1, d2, live) {
    const L = this.level;
    this.dice = [d1, d2]; this.used = []; this.render();
    const before = E.clone(this.pos);
    const all = E.legalMoves(this.pos, 0, d1, d2);
    if (!all.length || !all[0].steps.length) {
      const onBar = this.pos.a[0][25] > 0;
      this.say(onBar ? `You rolled ${d1}-${d2} and can't enter from the bar — both points are blocked. You {{dance}}: no move this turn.` : `You rolled ${d1}-${d2} and have no legal move. Your turn passes.`, 'mistake');
      this.status(`No legal move with ${d1}-${d2}.`, true);
      await this.choose([['OK', 'ok', 'go']]);
      return [];
    }
    // think about the best move (for hints and mistake-checking)
    await nextFrame();
    const ranked = E.rankMoves(this.pos, 0, d1, d2, 2);
    const book = this.first && E.OPENINGS[`${Math.max(d1, d2)}-${Math.min(d1, d2)}`];
    let best = ranked[0];
    if (book) { const bm = ranked.find(m => sameNotation(E.notation(m.steps), book[0])); if (bm) best = bm; }
    this.best = best; this.ranked = ranked;
    if (L === 1) this.advise(d1, d2, before);
    this.status(`<b>You rolled ${d1}-${d2}${d1 === d2 ? ' — {{doubles}}! You move ' + d1 + ' four times.' : '.'}</b>${L === 1 ? ' Tap a checker, then where it should go.' : ''}`);

    // pick the steps
    this.all = all; this.done = []; this.selected = null;
    const finished = await new Promise(res => { this.finish = res; this.myActions(); this.render(); });
    if (!live()) return null;
    this.finish = null; this.hint = null;
    const played = this.done.slice();
    const after = this.pos;
    this.review(before, played, after, d1, d2, book);
    if (L === 1) {
      const same = this.best && E.key(this.best.pos) === E.key(after);
      this.say(same ? `You played ${N(played)} — the move I suggested.` : this.describe(played, before, after, 0), 'you');
    }
    return played;
  }

  myActions() {
    const L = this.level;
    const maxLen = this.all[0].steps.length;
    const complete = this.done.length === maxLen;
    const list = [];
    if (complete) list.push({ label: 'Done', cls: 'go', onClick: () => this.finish && this.finish(true) });
    if (this.done.length) list.push({ label: 'Undo', onClick: () => this.undo() });
    if (!complete && L === 2) list.push({ label: 'Hint', cls: 'hint', onClick: () => { this.advise(this.dice[0], this.dice[1], this.turnStart()); if (innerWidth < 900) this.openDrawer(); } });
    list.push({ label: 'Resign', cls: 'danger', onClick: e => this.resign(e.target) });
    this.actions(list);
    if (complete) this.status(`Move complete: <b>${N(this.done)}</b>. Tap <b>Done</b>, or <b>Undo</b> to change it.`);
  }
  turnStart() { let p = this.pos; for (let k = this.done.length - 1; k >= 0; k--) p = this.unstep(p, this.done[k]); return p; }
  unstep(p, st) {
    const q = E.clone(p);
    q.a[0][st.to]--; q.a[0][st.from]++;
    if (st.hit) { q.a[1][25]--; q.a[1][25 - st.to]++; }
    return q;
  }

  // the next single steps allowed, given what's been played so far
  nextSteps() {
    const n = this.done.length;
    const same = (a, b) => a.from === b.from && a.to === b.to && a.die === b.die;
    const out = [];
    for (const m of this.all) {
      if (m.steps.length <= n) continue;
      let ok = true;
      for (let k = 0; k < n; k++) if (!same(m.steps[k], this.done[k])) { ok = false; break; }
      if (ok && !out.some(x => same(x, m.steps[n]))) out.push(m.steps[n]);
    }
    return out;
  }
  // where can the checker on `from` get to (using one or more dice in a row)?
  reach(from) {
    const res = new Map();
    const same = (a, b) => a.from === b.from && a.to === b.to && a.die === b.die;
    for (const m of this.all) {
      const n = this.done.length;
      let ok = m.steps.length > n;
      for (let k = 0; ok && k < n; k++) if (!same(m.steps[k], this.done[k])) ok = false;
      if (!ok || m.steps[n].from !== from) continue;
      let path = [m.steps[n]];
      if (!res.has(path[0].to) || res.get(path[0].to).length > 1) res.set(path[0].to, path.slice());
      for (let k = n + 1; k < m.steps.length && m.steps[k].from === path[path.length - 1].to && path[path.length - 1].to !== 0; k++) {
        path = path.concat(m.steps[k]);
        const to = path[path.length - 1].to;
        if (!res.has(to) || res.get(to).length > path.length) res.set(to, path.slice());
      }
    }
    return res;
  }

  onPoint(pt) {
    if (!this.finish) return;
    const L = this.level;
    const me = this.pos.a[0];
    if (this.selected != null) {
      const targets = this.reach(this.selected);
      if (targets.has(pt)) {
        for (const st of targets.get(pt)) { this.pos = E.applyStep(this.pos, 0, st); this.done.push(st); }
        this.selected = null;
        const last = this.done[this.done.length - 1];
        if (last.hit && L === 1) this.say(`You {{hit}} their {{blot}}! It goes to the {{bar}}, and they must bring it back in before they can move anything else.`, 'good');
        if (last.to === 0 && L === 1 && this.pos.a[0][0] === 1) this.say(`Your first checker {{bear off|borne off}}. Keep going — first to get all 15 off wins.`, 'good');
        this.render(); this.myActions(); return;
      }
      if (pt === this.selected) { this.selected = null; this.render(); return; }
      if (me[pt] && this.canStartFrom(pt)) { this.selected = pt; this.render(); return; }
      this.say(`<b>Not allowed:</b> ${this.whyNot(this.selected, pt)}`, 'mistake');
      return;
    }
    if (this.canStartFrom(pt)) { this.selected = pt; this.render(); return; }
    if (pt === 0) return;
    if (me[pt] || pt === 25) this.say(`<b>That checker can't move:</b> ${this.whyStuck(pt)}`, 'mistake');
    else if (L <= 2 && this.pos.a[1][25 - pt]) this.say(`Those are ${this.oppName}'s checkers — tap one of yours.`, 'note');
  }
  canStartFrom(pt) { return this.nextSteps().some(s => s.from === pt); }

  whyStuck(pt) {
    const me = this.pos.a[0];
    if (me[25] && pt !== 25) return `you have a checker on the {{bar}}. It must {{enter}} before you can move any other checker.`;
    if (this.done.length === this.all[0].steps.length) return `you've used all your dice — tap Done.`;
    const left = this.remainingDice();
    const blocked = left.map(d => {
      const to = pt - d;
      if (to <= 0) return `bearing off with a ${d} isn't allowed yet${!this.allHome() ? ' — all 15 checkers must be in your home board first' : ''}`;
      return this.pos.a[1][25 - to] >= 2 ? `${to} is blocked (${this.oppName} has ${this.pos.a[1][25 - to]} there)` : `moving ${d} to ${to} wouldn't leave you a legal way to play your other ${left.length > 2 ? 'dice' : 'die'} — the rules say you must use both dice if you can`;
    });
    return [...new Set(blocked)].join('; ') + '.';
  }
  whyNot(from, to) {
    const left = this.remainingDice();
    if (to === 0) return this.allHome() ? `you can only bear off with the exact number, or a higher number when no checkers are on higher points.` : `you can only {{bear off}} once all 15 of your checkers are in your {{home board}} (points 1 to 6).`;
    if (to > from && from !== 25) return `you move towards your home board — from higher numbers to lower ones.`;
    if (this.pos.a[1][25 - to] >= 2) return `point ${to} is a {{made point}}: ${this.oppName} has ${this.pos.a[1][25 - to]} checkers there, so you can't land on it.`;
    const dist = (from === 25 ? 25 : from) - to;
    return `that's ${dist} pips away, and your dice left are ${left.join(' and ')}${left.length > 1 ? ` (together ${left.reduce((a, b) => a + b, 0)})` : ''}. Each move must match a die, or dice added together with a safe stop on the way.`;
  }
  remainingDice() {
    const [d1, d2] = this.dice;
    const all = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
    for (const s of this.done) { const i = all.indexOf(s.die); if (i >= 0) all.splice(i, 1); }
    return all;
  }
  allHome() { for (let i = 7; i <= 25; i++) if (this.pos.a[0][i]) return false; return true; }
  undo() {
    const st = this.done.pop(); if (!st) return;
    this.pos = this.unstep(this.pos, st);
    this.selected = null; this.render(); this.myActions();
    this.status(`<b>Undone.</b> Dice left: ${this.remainingDice().join(' and ')}.`);
  }

  advise(d1, d2, start) {
    const best = this.best; if (!best) return;
    const text = this.describe(best.steps, start, best.pos, 0, true);
    const book = this.first && E.OPENINGS[`${Math.max(d1, d2)}-${Math.min(d1, d2)}`];
    const why = book && sameNotation(E.notation(best.steps), book[0]) ? ` It's the standard opening move${text.includes(book[1]) ? '' : `: it ${book[1]}`}.` : '';
    this.hint = best.steps;
    this.render();
    this.say(`<b>What I'd do: ${N(best.steps)}</b> (highlighted on the board).${why} ${text}`, 'advice');
  }

  // Compare your move with the best one.
  review(before, played, after, d1, d2, book) {
    const L = this.level;
    const ranked = this.ranked;
    if (!ranked || ranked.length < 2) return;
    const bestScore = ranked[0].score;
    let mine = ranked.find(m => E.key(m.pos) === E.key(after));
    const myScore = mine && mine.deep ? mine.score : E.deepScore(after, 0);
    const loss = bestScore - myScore;
    const threshold = L === 3 ? 14 : 10;
    if (loss < threshold) return;
    const best = this.best;
    const myBlots = []; for (let i = 1; i <= 24; i++) if (after.a[0][i] === 1) myBlots.push(i);
    const risky = myBlots.filter(b => b <= 18).map(b => ({ b, sh: E.shotsAt(after, 1, 25 - b) })).filter(x => x.sh >= 8).sort((a, b) => b.sh - a.sh);
    let why = risky.length ? `It leaves a {{blot}} on your ${risky[0].b}-point that can be hit with ${risky[0].sh} of 36 rolls ({{shots}}).` : '';
    const bestDesc = this.describe(best.steps, before, best.pos, 0, true);
    this.say(`<b>Mistake:</b> ${N(played)} is weaker than <b>${N(best.steps)}</b>. ${why}${L <= 2 && bestDesc ? ` Why ${N(best.steps)}: ${bestDesc}` : ''}`, 'mistake');
  }

  // ---------- describing moves ----------
  // s = who moved. Point numbers are always given from YOUR side of the board.
  describe(steps, before, after, s, forAdvice = false) {
    const mine = s === 0;
    const pt = i => (mine ? i : 25 - i);
    const parts = [];
    const hits = steps.filter(x => x.hit);
    const entered = steps.filter(x => x.from === 25).length;
    const off = steps.filter(x => x.to === 0).length;
    if (!mine) parts.push(`${this.oppName} plays ${steps.map(x => `${x.from === 25 ? 'bar' : pt(x.from)}→${x.to === 0 ? 'off' : pt(x.to)}`).join(', ')}${this.level === 1 ? ' (your point numbers)' : ''}.`);
    if (entered) parts.push(`${mine ? (forAdvice ? 'It enters' : 'You enter') : 'They enter'} from the {{bar}}.`);
    if (hits.length) parts.push(mine ? `It {{hit|hits}} ${hits.length > 1 ? `${hits.length} blots` : `the {{blot}} on your ${pt(hits[0].to)}-point`}, sending ${hits.length > 1 ? 'them' : 'it'} to the {{bar}}.` : `They {{hit}} your {{blot}} on your ${pt(hits[0].to)}-point — it goes to the {{bar}} and must come back in first.`);
    // points made
    const madeNow = [];
    for (let i = 1; i <= 24; i++) if (after.a[s][i] >= 2 && before.a[s][i] < 2) madeNow.push(i);
    for (const i of madeNow) {
      const p = pt(i);
      if (mine) parts.push(`It makes ${POINT_NAMES[i] || `your ${i}-point`}${i >= 19 ? ' — an {{anchor}} in their home board' : ''}.`);
      else parts.push(i >= 19 ? `They make an {{anchor}} on your ${p}-point.` : `They make ${i <= 6 ? 'a point in their home board' : 'a point'} (your ${p}).`);
    }
    // primes
    const run = longestRun(after.a[s]);
    if (run >= 4 && run > longestRun(before.a[s])) parts.push(`${mine ? 'That gives you' : 'They now have'} ${run} {{made point|made points}} in a row — a ${run === 6 ? 'full ' : ''}{{prime}}${run === 6 ? ': nothing behind it can get past' : ''}.`);
    if (off) parts.push(`${mine ? 'It bears' : 'They bear'} off ${off} checker${off > 1 ? 's' : ''}.`);
    // escaping
    const escaped = steps.filter(x => x.from >= 19 && x.from !== 25 && x.to <= 18 && x.to > 0).length;
    if (escaped && !hits.length && E.contact(after)) parts.push(`${mine ? 'It brings' : 'They bring'} a {{back checkers|back checker}} out of the home board ahead.`);
    // safety
    const blots = []; for (let i = 1; i <= 18; i++) if (after.a[s][i] === 1) blots.push(i); // blots deep in the other home board cost little
    const exposed = blots.map(b => ({ b, sh: E.shotsAt(after, 1 - s, 25 - b) })).filter(x => x.sh > 0).sort((a, b) => b.sh - a.sh);
    if (!E.contact(after)) parts.push(`The armies have passed each other: it's now a {{race}} — pip count ${E.pips(after, 0)} (you) against ${E.pips(after, 1)}.`);
    else if (!exposed.length && mine) parts.push(`It leaves no {{blot|blots}} that can be hit.`);
    else if (exposed.length) {
      const x = exposed[0];
      parts.push(mine ? `It leaves a {{blot}} on your ${x.b}-point that can be hit with ${x.sh} of 36 rolls (${x.sh} {{shots|${x.sh === 1 ? "shot" : "shots"}}}).` : `Their {{blot}} on your ${pt(x.b)}-point can be hit with ${x.sh} of your 36 rolls.`);
    }
    return parts.join(' ');
  }

  // ---------- their turn ----------
  async theirTurn(live) {
    const L = this.level, sp = this.settings.speed;
    let d1, d2;
    if (this.firstRoll) [d1, d2] = this.firstRoll;
    else {
      this.dice = null; this.oppDice = null; this.render();
      if (this.settings.cube && this.owner !== 0 && this.cube < 64 && E.shouldDouble(this.pos, 1, this.settings.opp)) {
        const ended = await this.offerDouble(1, live);
        if (ended || !live()) return;
      }
      this.status(`${this.oppName} is rolling…`, true);
      await sleep(sp);
      d1 = roll1(); d2 = roll1();
    }
    this.oppDice = [d1, d2]; this.render();
    await sleep(sp * 0.6);
    if (!live()) return;
    const before = E.clone(this.pos);
    const m = E.computerMove(this.pos, 1, d1, d2, this.settings.opp, this.first);
    if (!m || !m.steps.length) {
      if (L <= 2) this.say(this.pos.a[1][25] ? `${this.oppName} rolled ${d1}-${d2} and can't enter from the bar — they {{dance}}!` : `${this.oppName} rolled ${d1}-${d2} and has no legal move.`, 'action');
      await sleep(sp);
      return;
    }
    // play the steps one at a time so you can follow them
    for (const st of m.steps) {
      this.pos = E.applyStep(this.pos, 1, st);
      this.lastOpp = st; this.render();
      await sleep(sp * 0.7);
      if (!live()) return;
    }
    this.lastOpp = null;
    if (L <= 2) {
      let t = `${this.oppName} rolled <b>${Math.max(d1, d2)}-${Math.min(d1, d2)}</b>. ${this.describe(m.steps, before, this.pos, 1)}`;
      if (L === 2) t = t.split('. ').slice(0, 3).join('. ');
      this.say(t, 'action');
    } else if (m.steps.some(x => x.hit)) this.status('You were hit.', true);
    if (L === 1 && this.pos.a[0][25]) this.say(`You have ${this.pos.a[0][25] > 1 ? 'checkers' : 'a checker'} on the {{bar}}. On your turn you must {{enter}} ${this.pos.a[0][25] > 1 ? 'them' : 'it'} first: a roll of 3 enters on point 22, a 5 on point 20, and so on — onto any point that isn't blocked.`, 'note');
    this.checkWin(1);
  }

  // ---------- the doubling cube ----------
  async offerDouble(by, live) {
    const L = this.level;
    if (by === 0) {
      const take = E.shouldTake(this.pos, 1, this.settings.opp);
      if (take) {
        this.cube *= 2; this.owner = 1; this.render();
        this.say(`You {{double}} to ${this.cube}. ${this.oppName} {{take|takes}}: the game is now worth ${this.cube} points, and ${this.oppName} owns the cube.`, 'street');
        return false;
      }
      this.say(`You {{double}}, and ${this.oppName} {{drop|drops}}! You win ${this.cube} point${this.cube > 1 ? 's' : ''} without finishing the game.`, 'result');
      return this.endGame(0, this.cube, 'drop');
    }
    const answer = await this.askTake(live);
    if (answer == null) return true;
    if (answer === 'take') {
      this.cube *= 2; this.owner = 0; this.render();
      this.say(`You {{take}}. The game is now worth ${this.cube}, and you own the cube — only you can double next.`, 'you');
      return false;
    }
    this.say(`You {{drop}}. ${this.oppName} wins ${this.cube} point${this.cube > 1 ? 's' : ''}.`, 'result');
    return this.endGame(1, this.cube, 'drop');
  }

  // Your opponent has doubled: take or drop? (with advice). Returns 'take', 'drop' or null if the game moved on.
  async askTake(live) {
    const L = this.level;
    const w = E.winChance(this.pos, 0);
    this.status(`<b>${this.oppName} doubles to ${this.cube * 2}.</b> Take, or drop and lose ${this.cube}?`);
    if (L === 1) this.say(`${this.oppName} offers the {{doubling cube}}. I'd put your chances at roughly ${Math.round(w * 100)}%. <b>What I'd do: ${w >= 0.25 ? 'take' : 'drop'}.</b> The rule of thumb: {{take}} if you'll win at least 1 game in 4 (25%) — dropping costs ${this.cube} for sure, taking risks ${this.cube * 2} but you can still win.`, 'advice');
    for (;;) {
      const answer = await this.choose([['Take', 'take', 'go'], ['Drop', 'drop', 'danger'], ...(L === 2 ? [['Hint', 'hint', 'hint']] : [])]);
      if (!live()) return null;
      if (answer === 'hint') { this.say(`I'd put your chances at roughly ${Math.round(w * 100)}%. ${w >= 0.25 ? 'Take' : 'Drop'} — take whenever you'll win at least a quarter of the time.`, 'advice'); continue; }
      if ((answer === 'take') !== (w >= 0.25) && Math.abs(w - 0.25) > 0.07) this.say(`<b>Mistake:</b> with roughly ${Math.round(w * 100)}% chances you should ${w >= 0.25 ? 'take' : 'drop'}.`, 'mistake');
      return answer;
    }
  }

  checkWin(s) {
    const w = E.winner(this.pos);
    if (w < 0) return;
    const kind = E.winKind(this.pos, w);
    const pts = this.cube * kind;
    const name = { 1: 'a single game', 2: 'a {{gammon}} (double)', 3: 'a {{backgammon}} (triple)' }[kind];
    this.say(w === 0 ? `You've borne off all 15 — <b>you win</b> ${name}! ${pts} point${pts > 1 ? 's' : ''}.` : `${this.oppName} has borne off all 15 and wins ${name}: ${pts} point${pts > 1 ? 's' : ''}.${kind > 1 && this.level <= 2 ? ` ${kind === 3 ? 'You still had a checker on the bar or in their home board.' : "You hadn't borne off any checkers yet."}` : ''}`, 'result');
    this.endGame(w, pts, 'finish');
  }

  endGame(w, pts) {
    this.over = true;
    if (w === 0) this.score.me += pts; else this.score.them += pts;
    save('bg.score', this.score); save('bg.game', null);
    this.dice = null; this.oppDice = null; this.hint = null; this.render();
    this.status(`Score: you ${this.score.me} — ${this.oppName} ${this.score.them}.`, true);
    this.actions([{ label: 'Next game', cls: 'go', onClick: () => this.newGame() }, { label: 'Settings', onClick: () => this.setup() }]);
    return true;
  }

  resign(btn) {
    if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Tap again'; setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Resign'; }, 3000); return; }
    if (this.remote) { this.remote.send({ t: 'resign' }); if (this.finish) { const f = this.finish; this.finish = null; this.resigned = true; f(false); } return; }
    this.gen++; this.finish = null;
    this.say(`You resign. ${this.oppName} wins ${this.cube} point${this.cube > 1 ? 's' : ''}.`, 'result');
    this.endGame(1, this.cube);
  }

  // ---------- asking questions ----------
  ask() {
    openAsk({
      ui: this.shared.ui, game: 'backgammon', titleClass: 'bg-h', buttonClass: 'bg-primary', example: 'pip count',
      placeholder: "e.g. What are pips? What's a prime? Why move 13→7?",
      say: (h, k) => this.say(h, k), search: q => searchBGGlossary(q), state: () => this.stateText(),
    });
  }
  stateText() {
    const p = this.pos; if (!p) return '(no game in progress)';
    const mine = [], theirs = [];
    for (let i = 24; i >= 1; i--) { if (p.a[0][i]) mine.push(`${i}-point ×${p.a[0][i]}`); if (p.a[1][25 - i]) theirs.push(`${i}-point ×${p.a[1][25 - i]}`); }
    const lines = [
      `Backgammon, against ${this.oppName}. Point numbers are from my side: I move from 24 down to 1 and bear off from points 1-6.`,
      `My checkers: ${mine.join(', ') || 'none on the board'}${p.a[0][25] ? `; ${p.a[0][25]} on the bar` : ''}${p.a[0][0] ? `; ${p.a[0][0]} borne off` : ''}. My pip count: ${E.pips(p, 0)}.`,
      `Opponent's checkers (in my numbering): ${theirs.join(', ') || 'none on the board'}${p.a[1][25] ? `; ${p.a[1][25]} on the bar` : ''}${p.a[1][0] ? `; ${p.a[1][0]} borne off` : ''}. Their pip count: ${E.pips(p, 1)}.`,
      `Cube: ${this.settings.cube ? `${this.cube}${this.owner === 0 ? ', I own it' : this.owner === 1 ? ', they own it' : ', in the middle'}` : 'not used'}. Score: me ${this.score.me}, them ${this.score.them}.`,
    ];
    if (this.dice && this.finish) lines.push(`I've rolled ${this.dice.join('-')}${this.done && this.done.length ? ` and played ${N(this.done)} so far` : ''}.`);
    if (this.best && this.finish) lines.push(`The app's suggested move: ${N(this.best.steps)}.`);
    return lines.join('\n');
  }

  // ---------- playing a friend online ----------
  onlineFail(text) {
    this.leaveOnline();
    if (!text) { this.setup(); return; }
    $('infoBody').innerHTML = `<h2 class="bg-h">Play a friend online</h2><p class="count-result bad">${text}</p><button class="primary wide bg-primary" id="bgoOk">OK</button>`;
    this.shared.ui.open('info');
    $('bgoOk').onclick = () => this.setup();
  }
  leaveOnline() { localStorage.removeItem('bg.onlineCode'); if (this.remote) { this.remote.leave(); this.remote = null; this.online = null; } }

  startOnline(code) {
    this.leaveOnline();
    this.gen = (this.gen || 0) + 1;
    const gen = this.gen;
    this.finish = null; this.dice = null; this.oppDice = null; this.hint = null; this.selected = null;
    this.started = true; this.gameNo = null;
    this.remote = new BgRemote({ ui: this.shared.ui, name: this.shared.settings.name, titleClass: 'bg-h', onNotice: t => this.say(t, 'note'), onFail: t => this.onlineFail(t) });
    localStorage.setItem('bg.onlineCode', code);
    this.remote.lobbySheet('Connecting…');
    this.remote.connect(code);
    this.onlineLoop(gen);
  }

  applyOnline(st) {
    this.online = st;
    this.pos = { a: [Int8Array.from(st.a[0]), Int8Array.from(st.a[1])] };
    this.cube = st.cube; this.owner = st.owner === 'you' ? 0 : st.owner === 'them' ? 1 : -1;
    this.score = st.score; this.first = st.first; this.over = st.phase === 'over';
    this.cubeOnline = st.cubeOn;
  }

  async onlineLoop(gen) {
    const live = () => gen === this.gen && this.remote;
    for (;;) {
      const ev = await this.remote.next();
      if (!live()) return;
      if (ev.type === 'notice') { this.say(ev.text, 'note'); continue; }
      if (ev.state.gameNo !== this.gameNo) {
        // a new game (or the first one)
        if (this.gameNo == null) { $('bgLog').innerHTML = ''; this.say(`You're playing <b>${esc(ev.state.names.them)}</b> online. You play the ${this.settings.light ? 'light' : 'dark'} checkers, moving from 24 down to 1 and bearing off at the bottom right. Your coach is set to <b>${LEVEL_NAMES[this.level]}</b>.`, 'note'); }
        else this.divider(`Game ${ev.state.gameNo}`);
        this.gameNo = ev.state.gameNo;
        if (ev.type !== 'resync') { this.pos = E.START(); this.dice = null; this.oppDice = null; }
      }
      if (!this.pos) this.applyOnline(ev.state);
      this.online = ev.state;
      this.remote.busy = true;
      await this.onlineEvent(ev, live);
      if (!live()) return;
      this.applyOnline(ev.state);
      this.render();
      this.remote.busy = false;
      await this.onlinePrompt(ev.state, live);
      if (!live()) return;
    }
  }

  async onlineEvent(ev, live) {
    const L = this.level, sp = this.settings.speed, them = ev.state.names.them;
    switch (ev.type) {
      case 'opening': {
        for (const [mine, theirs] of ev.rolls) {
          this.dice = [mine]; this.oppDice = [theirs]; this.render();
          await sleep(sp + 200);
          if (mine === theirs && L <= 2) this.say(`Opening roll: you both rolled ${mine}, so you roll again.`, 'note');
        }
        const [mine, theirs] = ev.rolls[ev.rolls.length - 1];
        if (L <= 2) this.say(`{{opening roll|Opening roll}}: you rolled ${mine}, ${esc(them)} rolled ${theirs}. ${ev.first === 'you' ? `You go first, and your first move uses both numbers: ${Math.max(mine, theirs)}-${Math.min(mine, theirs)}.` : `${esc(them)} goes first, playing ${Math.max(mine, theirs)}-${Math.min(mine, theirs)}.`}`, 'street');
        this.oppDice = ev.first === 'them' ? ev.state.dice : null;
        this.dice = null;
        break;
      }
      case 'rolled':
        if (ev.who === 'them') { this.oppDice = ev.dice; this.dice = null; this.render(); this.status(`${esc(them)} rolled ${Math.max(...ev.dice)}-${Math.min(...ev.dice)} and is choosing a move…`, true); }
        break;
      case 'nomove':
        if (ev.who === 'you') { this.dice = ev.dice; this.render(); this.say(this.pos.a[0][25] ? `You rolled ${ev.dice.join('-')} and can't enter from the bar — you {{dance}}. No move this turn.` : `You rolled ${ev.dice.join('-')} and have no legal move.`, 'mistake'); await sleep(sp * 2); }
        else { this.oppDice = ev.dice; this.render(); if (L <= 2) this.say(`${esc(them)} rolled ${ev.dice.join('-')} and can't move${this.pos.a[1][25] ? ' — they {{dance}} on the bar' : ''}.`, 'action'); await sleep(sp); }
        break;
      case 'moved':
        if (ev.who === 'them') {
          const before = E.clone(this.pos);
          const d = this.oppDice || [];
          for (const st of ev.steps) { this.pos = E.applyStep(this.pos, 1, st); this.lastOpp = st; this.render(); await sleep(sp * 0.7); if (!live()) return; }
          this.lastOpp = null;
          if (L <= 2) {
            let t = `${esc(them)} rolled <b>${d.length ? `${Math.max(...d)}-${Math.min(...d)}` : ''}</b>. ${this.describe(ev.steps, before, this.pos, 1)}`;
            if (L === 2) t = t.split('. ').slice(0, 3).join('. ');
            this.say(t, 'action');
          } else if (ev.steps.some(x => x.hit)) this.status('You were hit.', true);
          if (L === 1 && this.pos.a[0][25]) this.say(`You have ${this.pos.a[0][25] > 1 ? 'checkers' : 'a checker'} on the {{bar}}. On your turn you must {{enter}} ${this.pos.a[0][25] > 1 ? 'them' : 'it'} first: a roll of 3 enters on point 22, a 5 on point 20, and so on.`, 'note');
        }
        this.dice = null;
        break;
      case 'doubled':
        if (ev.who === 'you') this.status(`You've doubled to ${ev.to}. Waiting for ${esc(them)} to take or drop…`, true);
        break;
      case 'took':
        if (ev.who === 'them') this.say(`${esc(them)} {{take|takes}}: the game is now worth ${ev.state.cube}, and ${esc(them)} owns the cube.`, 'street');
        else this.say(`You {{take}}. The game is now worth ${ev.state.cube}, and you own the cube — only you can double next.`, 'you');
        break;
      case 'won': {
        const pts = ev.points;
        const who = ev.who === 'you' ? 'You win' : `${esc(them)} wins`;
        const name = { 1: 'a single game', 2: 'a {{gammon}} (double)', 3: 'a {{backgammon}} (triple)' }[ev.kind];
        const how = ev.how === 'drop' ? (ev.who === 'you' ? `${esc(them)} {{drop|dropped}} your double.` : 'You dropped the double.') : ev.how === 'resign' ? (ev.who === 'you' ? `${esc(them)} resigned.` : 'You resigned.') : '';
        this.say(`${how} ${who} ${ev.how === 'finish' ? name : ''} — ${pts} point${pts > 1 ? 's' : ''}. Score: you ${ev.state.score.me}, ${esc(them)} ${ev.state.score.them}.`, 'result');
        this.dice = null; this.oppDice = null; this.hint = null;
        break;
      }
      case 'resync':
        break;
    }
  }

  async onlinePrompt(st, live) {
    const L = this.level, them = esc(st.names.them);
    if (st.phase === 'over') {
      if (st.ready.me) { this.status(`Waiting for ${them} to start the next game…`, true); this.actions([]); return; }
      this.status(`Score: you ${st.score.me} — ${them} ${st.score.them}.`, true);
      await this.choose([['Next game', 'next', 'go']]);
      if (!live()) return;
      this.remote.send({ t: 'next' });
      this.status(`Waiting for ${them}…`, true);
      return;
    }
    if (st.turn === 'you' && st.phase === 'roll') {
      this.dice = null; this.render();
      const canDouble = st.cubeOn && st.owner !== 'them' && st.cube < 64 && !st.first;
      const w = E.winChance(this.pos, 0);
      if (canDouble && L === 1 && w >= 0.62) this.say(`I'd put your chances at roughly ${Math.round(w * 100)}%. ${w >= 0.68 ? `That's enough to {{double}}.` : 'Doubling is usually right from about 68%; not quite yet.'}`, 'advice');
      this.status(`<b>Your turn.</b> ${canDouble ? 'Roll the dice, or offer a double first.' : 'Roll the dice.'}`);
      const c = await this.choose([['Roll', 'roll', 'go'], ...(canDouble ? [[`Double to ${st.cube * 2}`, 'double']] : []), ['Resign', 'resign', 'danger']]);
      if (!live()) return;
      if (c === 'resign') { this.remote.send({ t: 'resign' }); return; }
      this.remote.send({ t: c });
      if (c === 'roll') this.status('Rolling…', true);
      return;
    }
    if (st.turn === 'you' && st.phase === 'move') {
      const [d1, d2] = st.dice;
      this.oppDice = null; this.resigned = false;
      const played = await this.chooseMove(d1, d2, live);
      if (!live() || this.resigned) return;
      this.remote.send({ t: 'move', steps: (played || []).map(x => ({ from: x.from, to: x.to, die: x.die })) });
      this.status(`Waiting for ${them}…`, true); this.actions([]);
      return;
    }
    if (st.phase === 'double' && st.doubler === 'them') {
      this.say(`${them} offers the {{doubling cube}} at ${st.cube * 2}.`, 'street');
      const a = await this.askTake(live);
      if (!live() || !a) return;
      this.remote.send({ t: a });
      return;
    }
    if (st.turn === 'them' && st.phase !== 'double') { this.status(`${them}'s turn…`, true); this.actions([]); }
  }

  // ---------- drawing ----------
  render() {
    const p = this.pos; if (!p) return;
    const light = this.settings.light;
    const myFill = light ? 'url(#bgLight)' : 'url(#bgDark)', theirFill = light ? 'url(#bgDark)' : 'url(#bgLight)';
    const myStroke = light ? '#8a7350' : '#000', theirStroke = light ? '#000' : '#8a7350';
    const targets = this.selected != null ? this.reach(this.selected) : new Map();
    const sources = this.finish && this.selected == null ? new Set(this.nextSteps().map(s => s.from)) : new Set();
    const hintFrom = new Set((this.hint || []).map(s => s.from)), hintTo = new Set((this.hint || []).map(s => s.to));
    const r = G.PW / 2 - 1.2;
    let svg = `<defs>
      <radialGradient id="bgLight" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fffaf0"/><stop offset=".7" stop-color="#eadfc6"/><stop offset="1" stop-color="#cdbb94"/></radialGradient>
      <radialGradient id="bgDark" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#5a4a40"/><stop offset=".7" stop-color="#2a201b"/><stop offset="1" stop-color="#120d0a"/></radialGradient>
      <linearGradient id="bgWood" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a5a34"/><stop offset=".5" stop-color="#6c4123"/><stop offset="1" stop-color="#4e2d17"/></linearGradient>
    </defs>`;
    svg += `<rect x="0" y="0" width="${G.W}" height="${G.H}" rx="10" fill="url(#bgWood)"/>`;
    svg += `<rect x="${G.L0}" y="${G.F}" width="${6 * G.PW}" height="${G.H - 2 * G.F}" class="field"/>`;
    svg += `<rect x="${G.R0}" y="${G.F}" width="${6 * G.PW}" height="${G.H - 2 * G.F}" class="field"/>`;
    svg += `<rect x="${G.T0}" y="${G.F}" width="${G.TRAY}" height="${G.H - 2 * G.F}" class="tray"/>`;
    // points
    for (let i = 1; i <= 24; i++) {
      const { x, top } = col(i);
      const y0 = top ? G.F : G.H - G.F, y1 = top ? G.F + G.PH : G.H - G.F - G.PH;
      const dark = i % 2 === 0;
      const cls = ['pt', dark ? 'pt-a' : 'pt-b'];
      if (targets.has(i)) cls.push('target');
      svg += `<polygon class="${cls.join(' ')}" points="${x + 1},${y0} ${x + G.PW - 1},${y0} ${x + G.PW / 2},${y1}"/>`;
      // point numbers (your side)
      svg += `<text class="pnum" x="${x + G.PW / 2}" y="${top ? G.F - 2.5 : G.H - 2.5}" text-anchor="middle">${i}</text>`;
    }
    // checkers on points
    const stack = (i, n, fill, stroke, mineSide) => {
      const { x, top } = col(i);
      const cx = x + G.PW / 2;
      const gap = n > 5 ? (G.PH - 2 * r) / (n - 1) : 2 * r;
      for (let k = 0; k < n; k++) {
        const cy = top ? G.F + r + k * gap : G.H - G.F - r - k * gap;
        svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/><circle cx="${cx}" cy="${cy}" r="${r * 0.62}" fill="none" stroke="${stroke}" stroke-opacity=".35"/>`;
      }
      if (n > 5) { const cy = top ? G.F + r + (n - 1) * gap : G.H - G.F - r - (n - 1) * gap; svg += `<text class="cnt ${fill === 'url(#bgLight)' ? 'on-light' : 'on-dark'}" x="${cx}" y="${cy + 4}" text-anchor="middle">${n}</text>`; }
    };
    for (let i = 1; i <= 24; i++) {
      if (p.a[0][i]) stack(i, p.a[0][i], myFill, myStroke);
      if (p.a[1][25 - i]) stack(i, p.a[1][25 - i], theirFill, theirStroke);
    }
    // the bar
    const bx = G.L1 + G.BAR / 2;
    const barStack = (n, fill, stroke, upper) => { for (let k = 0; k < n; k++) { const cy = upper ? G.H / 2 - 22 - k * (r * 1.4) : G.H / 2 + 22 + k * (r * 1.4); svg += `<circle cx="${bx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`; } };
    barStack(p.a[1][25], theirFill, theirStroke, true);
    barStack(p.a[0][25], myFill, myStroke, false);
    // borne off: edge-on stacks in the tray (yours at the bottom)
    const tx = G.T0 + 5, tw = G.TRAY - 10;
    for (let k = 0; k < p.a[0][0]; k++) svg += `<rect x="${tx}" y="${G.H - G.F - 6 - k * 7}" width="${tw}" height="6" rx="2" fill="${myFill}" stroke="${myStroke}" stroke-width=".8"/>`;
    for (let k = 0; k < p.a[1][0]; k++) svg += `<rect x="${tx}" y="${G.F + k * 7}" width="${tw}" height="6" rx="2" fill="${theirFill}" stroke="${theirStroke}" stroke-width=".8"/>`;
    // the cube
    if (this.remote ? this.cubeOnline : this.settings.cube) {
      const cy = this.owner === -1 ? G.H / 2 : this.owner === 0 ? G.H - G.F - 140 : G.F + 120;
      const cx = this.owner === -1 ? bx : G.T0 + G.TRAY / 2;
      svg += `<g class="cube"><rect x="${cx - 12}" y="${cy - 12}" width="24" height="24" rx="4"/><text x="${cx}" y="${cy + 5}" text-anchor="middle">${this.owner === -1 && this.cube === 1 ? 64 : this.cube}</text></g>`;
    }
    // dice
    const drawDie = (cx, cy, v, used, mineDie) => {
      svg += `<g class="die ${mineDie ? 'mine' : 'theirs'}${used ? ' used' : ''}"><rect x="${cx - 13}" y="${cy - 13}" width="26" height="26" rx="5"/>`;
      const pipsAt = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] }[v];
      for (const [dx, dy] of pipsAt) svg += `<circle cx="${cx + dx * 6.5}" cy="${cy + dy * 6.5}" r="2.4"/>`;
      svg += `</g>`;
    };
    if (this.dice) {
      const left = this.finish ? this.remainingDice() : this.dice.slice();
      const cx = G.R0 + 3 * G.PW;
      if (this.dice.length === 1) drawDie(cx, G.H / 2, this.dice[0], false, true);
      else {
        const dbl = this.dice[0] === this.dice[1];
        const used = k => !dbl && this.finish && !left.includes(this.dice[k]);
        drawDie(cx - 17, G.H / 2, this.dice[0], used(0), true);
        drawDie(cx + 17, G.H / 2, this.dice[1], used(1), true);
        if (dbl && this.finish) svg += `<text class="dleft" x="${cx}" y="${G.H / 2 + 28}" text-anchor="middle">${left.length} move${left.length === 1 ? '' : 's'} left</text>`;
      }
    }
    if (this.oppDice) {
      const cx = G.L0 + 3 * G.PW;
      if (this.oppDice.length === 1) drawDie(cx, G.H / 2, this.oppDice[0], false, false);
      else { drawDie(cx - 17, G.H / 2, this.oppDice[0], false, false); drawDie(cx + 17, G.H / 2, this.oppDice[1], false, false); }
    }
    // highlights and tap areas
    const ring = (i, cls) => {
      if (i === 25) { svg += `<rect class="${cls}" x="${G.L1 + 2}" y="${G.H / 2 + 6}" width="${G.BAR - 4}" height="${G.PH - 10}" rx="6"/>`; return; }
      if (i === 0) { svg += `<rect class="${cls}" x="${G.T0 + 2}" y="${G.H / 2}" width="${G.TRAY - 4}" height="${G.H / 2 - G.F - 2}" rx="6"/>`; return; }
      const { x, top } = col(i);
      svg += `<rect class="${cls}" x="${x + 1}" y="${top ? G.F : G.H - G.F - G.PH}" width="${G.PW - 2}" height="${G.PH}" rx="6"/>`;
    };
    for (const i of hintFrom) ring(i, 'hl-hint-from');
    for (const i of hintTo) ring(i, 'hl-hint-to');
    for (const i of sources) ring(i, 'hl-source');
    if (this.selected != null) ring(this.selected, 'hl-selected');
    for (const i of targets.keys()) ring(i, 'hl-target');
    if (this.lastOpp) { ring(this.lastOpp.to === 0 ? 0 : 25 - this.lastOpp.to, 'hl-opp'); }
    for (let i = 1; i <= 24; i++) { const { x, top } = col(i); svg += `<rect class="hit-area" data-pt="${i}" x="${x}" y="${top ? 0 : G.H / 2}" width="${G.PW}" height="${G.H / 2}"/>`; }
    svg += `<rect class="hit-area" data-pt="25" x="${G.L1}" y="${G.H / 2}" width="${G.BAR}" height="${G.H / 2}"/>`;
    svg += `<rect class="hit-area" data-pt="0" x="${G.T0}" y="${G.H / 2}" width="${G.TRAY}" height="${G.H / 2}"/>`;
    $('bgBoard').innerHTML = svg;
    this.renderPlayers();
  }

  renderPlayers() {
    const p = this.pos;
    const row = (s, name, sub) => {
      const off = p.a[s][0], bar = p.a[s][25];
      return `<span class="c-dot ${(s === 0) === this.settings.light ? 'white' : 'black'}" aria-hidden="true"></span>
        <span class="c-name">${esc(name)}<small>${sub}</small></span>
        <span class="bg-stats"><span title="Pip count"><b>${E.pips(p, s)}</b> pips</span>${off ? `<span>${off} off</span>` : ''}${bar ? `<span class="on-bar">${bar} on bar</span>` : ''}</span>`;
    };
    $('bgOpp').innerHTML = row(1, this.oppName, this.remote ? `Playing online, score ${this.score.them}` : `Level ${this.settings.opp} of 4, score ${this.score.them}`);
    $('bgMe').innerHTML = row(0, this.shared.settings.name || 'You', `Score ${this.score.me}${this.cube > 1 ? `, cube at ${this.cube}` : ''}`);
  }

  // ---------- sheets ----------
  menu() {
    const ui = this.shared.ui;
    $('infoBody').innerHTML = `<h2 class="bg-h">Menu</h2>
      <p class="muted">Score ${this.remote ? 'in this online game' : 'against ' + esc(this.oppName)}: you ${this.score.me}, ${esc(this.oppName)} ${this.score.them}.</p>
      ${this.remote ? `<button class="menu-item" id="gmLeave">Leave the online game</button>` : ''}
      <button class="menu-item" id="gmNew">New game / settings</button>
      <button class="menu-item" id="gmRules">How to play</button>
      <button class="menu-item" id="gmOpen">The best opening moves</button>
      <button class="menu-item" id="gmWords">Glossary of backgammon words</button>
      <button class="menu-item" id="gmReset">Reset the score</button>
      <button class="menu-item" id="gmSwitch">Switch game</button>
      <button class="menu-item" id="gmAccount">Account and who can use the app</button>`;
    ui.open('info');
    $('gmNew').onclick = () => this.setup();
    if ($('gmLeave')) $('gmLeave').onclick = () => { ui.close('info'); this.leaveOnline(); this.started = false; this.setup(); };
    $('gmRules').onclick = () => this.rules();
    $('gmOpen').onclick = () => this.openings();
    $('gmWords').onclick = () => this.glossary();
    $('gmReset').onclick = () => { this.score = { me: 0, them: 0 }; save('bg.score', this.score); this.renderPlayers(); ui.close('info'); };
    $('gmSwitch').onclick = () => { ui.close('info'); this.shared.onSwitch(); };
    $('gmAccount').onclick = () => this.shared.openAccount();
  }

  rules() {
    $('infoBody').innerHTML = this.termify(`<h2 class="bg-h">How to play</h2>
      <h3>The aim</h3><p>Move all 15 of your checkers round the board into your {{home board}} (points 1–6, bottom right), then {{bear off}}. First to bear them all off wins.</p>
      <h3>Moving</h3><p>Roll two dice. Each die moves one checker that many points — you can move one checker twice or two different checkers. {{doubles|Doubles}} are played four times. You must use both dice if you can; if only one can be used, use the larger if possible.</p>
      <p>You can land on any point except one your opponent holds with two or more checkers (a {{made point}}).</p>
      <h3>Hitting</h3><p>Landing on a single enemy checker (a {{blot}}) {{hit|hits}} it: it goes to the {{bar}}. A player with a checker on the bar must {{enter}} it into the opponent's home board before moving anything else. If both numbers are blocked, they {{dance}} and lose the turn.</p>
      <h3>Bearing off</h3><p>Once all 15 checkers are home, a die removes a checker from the matching point. A higher number can bear off from your highest point when nothing is further back.</p>
      <h3>Scoring</h3><p>A normal win scores 1 point, a {{gammon}} 2 and a {{backgammon}} 3 — all multiplied by the {{doubling cube}}. Before rolling you may offer to {{double}}; your opponent must {{take}} (play on at double stakes) or {{drop}} (lose now).</p>`);
    this.shared.ui.open('info');
  }

  openings() {
    $('infoBody').innerHTML = this.termify(`<h2 class="bg-h">The best opening moves</h2><p class="muted">The first roll is never a double. Point numbers are from your side.</p>
      <table class="odds-table"><tbody>${Object.entries(E.OPENINGS).map(([k, [m, why]]) => `<tr><td><b>${k}</b></td><td><b>${arrows(m)}</b><div class="muted">${why}</div></td></tr>`).join('')}</tbody></table>`);
    this.shared.ui.open('info');
  }

  glossary(q = '') {
    const render = query => { $('bgGlossList').innerHTML = searchBGGlossary(query).map(i => `<dt>${esc(i.term)}</dt><dd>${esc(i.def)}</dd>`).join('') || '<p class="muted">No matches.</p>'; };
    $('infoBody').innerHTML = `<h2 class="bg-h">Backgammon words</h2><input type="text" id="bgGlossQ" placeholder="Search, e.g. prime" value="${esc(q)}"><dl class="gloss-list" id="bgGlossList"></dl>`;
    this.shared.ui.open('info');
    render(q);
    $('bgGlossQ').oninput = e => render(e.target.value);
  }
}

function longestRun(arr) { let run = 0, best = 0; for (let i = 1; i <= 24; i++) { if (arr[i] >= 2) { run++; best = Math.max(best, run); } else run = 0; } return best; }
function sameNotation(a, b) { const n = t => t.split(' ').sort().join(' '); return n(a) === n(b); }
function load(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function save(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }
