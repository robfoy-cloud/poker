// Chess Coach: the board, your moves, the opponent and the coach.

import { Chess } from '../vendor/chess.js';
import { opponentMove, bestMove, scoreMoves, LEVELS, MATE } from './engine.js';
import { describeMove, whyIllegal, pieceIntro, endText, openingName, loosePieces, materialBalance, PIECE, PIECE_PTS, other, cap, pts } from './coach.js';
import { lookupChess, searchChessGlossary } from './glossary.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const LEVEL_NAMES = ['', 'Learn', 'Advise', 'Test'];
const DEFAULTS = { color: 'w', opp: 1, level: 1, showMoves: true };

export class ChessApp {
  constructor(shared) {
    this.shared = shared; // { settings (name), ui (for sheets), onSwitch }
    this.settings = { ...DEFAULTS, ...load('chess.settings') };
    this.chess = new Chess();
    this.selected = null;
    this.busy = false;
    this.introduced = new Set();
    this.analysis = null;
    this.unread = 0;
    this.build();
  }

  // ---------- markup ----------
  build() {
    const v = $('chessView');
    v.innerHTML = `
      <header class="topbar chess-top">
        <button class="brand brand-btn" id="cGames" aria-label="Switch game"><img src="icons/chess.svg" alt="" width="26" height="26"><span>Chess Coach</span><i class="chev">▾</i></button>
        <div class="top-actions">
          <select id="cLevel" aria-label="Coaching level"><option value="1">Learn</option><option value="2">Advise</option><option value="3">Test</option></select>
          <button class="iconbtn" id="cMenuBtn" aria-label="Menu">☰</button>
        </div>
      </header>
      <main class="chess-layout">
        <section class="c-main">
          <div class="c-player" id="cOpp"></div>
          <div class="c-board-frame"><div class="c-board" id="cBoard" role="grid" aria-label="Chess board"></div></div>
          <div class="c-player" id="cMe"></div>
          <div class="c-status" id="cStatus"></div>
          <button class="c-ticker" id="cTicker" hidden aria-live="polite"></button>
          <div class="c-actions" id="cActions"></div>
        </section>
        <button class="coach-tab c-tab" id="cTab" aria-label="Open the coach panel"><span class="tab-label">Coach</span><span class="badge" id="cBadge" hidden></span></button>
        <section class="coach-panel c-coach" id="cCoach">
          <div class="coach-head"><span>Coach</span>
            <div class="coach-tools">
              <button class="small" id="cPiecesBtn">Pieces</button>
              <button class="small" id="cGlossBtn">Words</button>
              <button class="small drawer-close" id="cClose">Close ›</button>
            </div>
          </div>
          <div class="coach-log" id="cLog" aria-live="polite"></div>
        </section>
        <div class="c-promo" id="cPromo" hidden></div>
      </main>`;
    $('cGames').onclick = () => this.shared.onSwitch();
    $('cLevel').value = this.settings.level;
    $('cLevel').onchange = e => { this.settings.level = +e.target.value; save('chess.settings', this.settings); this.say(`Coaching level changed to <b>${LEVEL_NAMES[this.settings.level]}</b>.`, 'note'); this.renderActions(); if (this.isUserTurn()) this.userTurn(); };
    $('cMenuBtn').onclick = () => this.menu();
    $('cPiecesBtn').onclick = () => this.piecesGuide();
    $('cGlossBtn').onclick = () => this.glossary();
    $('cTab').onclick = () => this.openDrawer();
    $('cClose').onclick = () => this.closeDrawer();
    $('cTicker').onclick = e => { if (!e.target.closest('.term')) this.openDrawer(); };
    $('cBoard').addEventListener('click', e => { const sq = e.target.closest('.sq'); if (sq) this.onSquare(sq.dataset.sq); });
    // tap outside the drawer to close it; swipe right to close
    document.addEventListener('pointerdown', e => {
      const panel = $('cCoach');
      if (!panel.classList.contains('open') || $('chessView').hidden) return;
      if (panel.contains(e.target) || $('cTab').contains(e.target) || e.target.closest('.sheet') || e.target.closest('#termPop')) return;
      this.closeDrawer();
      if (e.target.closest('.c-board-frame')) this.swallow = true;
    }, true);
    document.addEventListener('click', e => { if (this.swallow) { this.swallow = false; e.stopPropagation(); e.preventDefault(); } }, true);
    let sx = null;
    $('cCoach').addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    $('cCoach').addEventListener('touchend', e => { if (sx != null && e.changedTouches[0].clientX - sx > 70) this.closeDrawer(); sx = null; });
  }

  // ---------- coach text ----------
  termify(html) {
    return html.replace(/\{\{([^}|]+)(?:\|([^}]+))?\}\}/g, (m, term, shown) => {
      const hit = lookupChess(term);
      return hit ? `<button class="term" data-ns="chess" data-term="${esc(hit.term)}">${shown || term}</button>` : (shown || term);
    });
  }
  say(html, kind = 'info') {
    const log = $('cLog');
    const div = document.createElement('div');
    div.className = 'msg ' + kind;
    div.innerHTML = this.termify(html);
    log.appendChild(div);
    if (div.offsetHeight > log.clientHeight - 10) log.scrollTop = div.offsetTop - 6; else log.scrollTop = log.scrollHeight;
    if (kind !== 'q') this.ticker(kind, div.innerHTML);
    if (!$('cCoach').classList.contains('open') && kind !== 'note') { this.unread++; this.badge(kind === 'mistake' || kind === 'advice'); }
  }
  ticker(kind, html) {
    const t = $('cTicker');
    t.innerHTML = `<span class="tk-text">${html.replace(/<br\s*\/?>/g, ' ')}</span>`;
    t.className = 'c-ticker k-' + kind; t.hidden = false;
  }
  badge(alert) {
    const b = $('cBadge');
    b.hidden = !this.unread; b.textContent = this.unread > 9 ? '9+' : this.unread;
    if (alert) $('cTab').classList.add('alert');
  }
  openDrawer() {
    const top = document.querySelector('#chessView .topbar').getBoundingClientRect().bottom;
    const st = $('cStatus').getBoundingClientRect().top;
    document.documentElement.style.setProperty('--drawer-top', Math.round(top) + 'px');
    document.documentElement.style.setProperty('--drawer-bottom', Math.round(window.innerHeight - st) + 'px');
    $('cCoach').classList.add('open'); $('cTab').classList.add('hidden');
    this.unread = 0; $('cTab').classList.remove('alert'); this.badge(false);
    const log = $('cLog'), last = log.lastElementChild;
    if (last && last.offsetHeight > log.clientHeight - 10) log.scrollTop = last.offsetTop - 6; else log.scrollTop = log.scrollHeight;
  }
  closeDrawer() { $('cCoach').classList.remove('open'); $('cTab').classList.remove('hidden'); }
  status(html, wait = false) { const s = $('cStatus'); s.innerHTML = this.termify(html); s.classList.toggle('wait', wait); }

  // ---------- lifecycle ----------
  show() {
    const saved = load('chess.game');
    if (!this.started && saved && saved.pgn !== undefined && !saved.over) {
      this.resume(saved);
    } else if (!this.started) this.setup();
  }

  resume(saved) {
    try {
      this.chess = new Chess();
      if (saved.pgn) this.chess.loadPgn(saved.pgn);
      this.userColor = saved.color; this.opp = saved.opp; this.started = true; this.over = false;
      $('cLog').innerHTML = '';
      this.say(`Welcome back — your game against ${LEVELS[this.opp - 1].name} is where you left it.`, 'note');
      this.render(); this.renderActions();
      if (this.isUserTurn()) this.userTurn(); else this.opponentTurn();
    } catch { this.setup(); }
  }

  setup() {
    const s = this.settings;
    const ui = this.shared.ui;
    $('infoBody').innerHTML = `<h2 class="chess-h">New chess game</h2>
      <label class="field">Your name<input type="text" id="cName" maxlength="14" placeholder="You" value="${esc(this.shared.settings.name || '')}"></label>
      <div class="field"><div>Play as</div>
        <div class="seg-row">${[['w', 'White'], ['b', 'Black'], ['r', 'Random']].map(([v, l]) => `<button class="seg ${s.color === v ? 'on' : ''}" data-color="${v}">${l}</button>`).join('')}</div>
        <p class="muted" style="margin:4px 0 0">White always moves first.</p></div>
      <fieldset class="field levels"><legend>Opponent</legend>
        ${LEVELS.map(l => `<label><input type="radio" name="cOpp" value="${l.id}" ${s.opp === l.id ? 'checked' : ''}><span><b>${l.name}</b> — ${l.blurb}</span></label>`).join('')}
      </fieldset>
      <fieldset class="field levels"><legend>Coaching</legend>
        <label><input type="radio" name="cLvl" value="1" ${s.level === 1 ? 'checked' : ''}><span><b>Learn</b> — I explain every move, how the pieces move, and what I'd play and why.</span></label>
        <label><input type="radio" name="cLvl" value="2" ${s.level === 2 ? 'checked' : ''}><span><b>Advise</b> — I describe the moves; ask for a hint when you want one.</span></label>
        <label><input type="radio" name="cLvl" value="3" ${s.level === 3 ? 'checked' : ''}><span><b>Test</b> — I say nothing unless you make a mistake.</span></label>
      </fieldset>
      <label class="check"><input type="checkbox" id="cShowMoves" ${s.showMoves ? 'checked' : ''}><span>Show where the selected piece can move</span></label>
      <button class="primary wide chess-primary" id="cStart">Start the game</button>`;
    ui.open('info');
    let color = s.color;
    document.querySelectorAll('[data-color]').forEach(b => b.onclick = () => {
      color = b.dataset.color;
      document.querySelectorAll('[data-color]').forEach(x => x.classList.toggle('on', x === b));
    });
    $('cStart').onclick = () => {
      s.color = color;
      s.opp = +document.querySelector('input[name=cOpp]:checked').value;
      s.level = +document.querySelector('input[name=cLvl]:checked').value;
      s.showMoves = $('cShowMoves').checked;
      this.shared.settings.name = $('cName').value.trim().slice(0, 14);
      this.shared.saveSettings();
      save('chess.settings', s);
      $('cLevel').value = s.level;
      ui.close('info');
      this.newGame();
    };
  }

  newGame() {
    const s = this.settings;
    this.chess = new Chess();
    this.userColor = s.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : s.color;
    this.opp = s.opp;
    this.started = true; this.over = false; this.selected = null; this.lastOpening = null; this.analysis = null;
    this.introduced = new Set();
    $('cLog').innerHTML = '';
    const opp = LEVELS[this.opp - 1];
    const you = this.userColor === 'w' ? 'White' : 'Black';
    let intro = `New game against <b>${opp.name}</b>. You're playing <b>${you}</b>${this.userColor === 'w' ? ', so you move first' : ` — White moves first, so ${opp.name} starts`}.`;
    if (s.level === 1) intro += ` The aim is {{checkmate}}: attack the enemy {{king}} so it can't escape. Tap one of your pieces to see where it can go, then tap the square to move there. Good first goals: control the {{centre}}, {{develop}} your knights and bishops, and {{castling|castle}} to keep your king safe.`;
    this.say(intro, 'note');
    this.save();
    this.render(); this.renderActions();
    if (this.isUserTurn()) this.userTurn(); else this.opponentTurn();
  }

  save() { save('chess.game', { pgn: this.chess.pgn(), color: this.userColor, opp: this.opp, over: this.over }); }
  isUserTurn() { return !this.over && this.chess.turn() === this.userColor; }
  get level() { return this.settings.level; }
  get name() { return this.shared.settings.name || 'You'; }

  // ---------- board ----------
  render(anim) {
    const c = this.chess;
    const flip = this.userColor === 'b';
    const files = 'abcdefgh', ranks = '87654321';
    const last = c.history({ verbose: true }).slice(-1)[0];
    const legal = this.selected && this.settings.showMoves ? c.moves({ square: this.selected, verbose: true }) : [];
    const targets = new Map(legal.map(m => [m.to, m]));
    const kingSq = c.isCheck() ? findKing(c, c.turn()) : null;
    let html = '';
    for (let ri = 0; ri < 8; ri++) for (let fi = 0; fi < 8; fi++) {
      const f = flip ? files[7 - fi] : files[fi];
      const r = flip ? ranks[7 - ri] : ranks[ri];
      const sq = f + r;
      const light = (files.indexOf(f) + +r) % 2 === 1;
      const pc = c.get(sq);
      const cls = ['sq', light ? 'light' : 'dark'];
      if (last && (sq === last.from || sq === last.to)) cls.push('last');
      if (sq === this.selected) cls.push('sel');
      if (sq === kingSq) cls.push('incheck');
      if (targets.has(sq)) cls.push(pc || targets.get(sq).flags.includes('e') ? 'cap' : 'dot');
      let inner = '';
      if (fi === 0) inner += `<span class="coord rank">${r}</span>`;
      if (ri === 7) inner += `<span class="coord file">${f}</span>`;
      if (pc) inner += `<img class="pc" src="pieces/${pc.color}${pc.type.toUpperCase()}.svg" alt="${pc.color === 'w' ? 'white' : 'black'} ${PIECE[pc.type]}" draggable="false">`;
      html += `<div class="${cls.join(' ')}" data-sq="${sq}" role="gridcell" aria-label="${sq}${pc ? ' ' + (pc.color === 'w' ? 'white ' : 'black ') + PIECE[pc.type] : ''}">${inner}</div>`;
    }
    $('cBoard').innerHTML = html;
    if (anim) this.animate(anim);
    this.renderPlayers();
  }

  animate(m) {
    const board = $('cBoard');
    const from = board.querySelector(`[data-sq="${m.from}"]`), to = board.querySelector(`[data-sq="${m.to}"]`);
    const img = to && to.querySelector('.pc');
    if (!from || !img || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    img.style.transition = 'none';
    img.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px)`;
    img.style.zIndex = 5;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      img.style.transition = 'transform .28s cubic-bezier(.2,.8,.2,1)';
      img.style.transform = '';
    }));
  }

  renderPlayers() {
    const bal = materialBalance(this.chess);
    const me = this.userColor, them = other(me);
    const opp = LEVELS[this.opp - 1];
    const diff = (me === 'w' ? bal.w - bal.b : bal.b - bal.w);
    const row = (color, name, sub, isMe) => {
      // pieces this player has captured = the other side's missing pieces
      const caps = bal.taken[other(color)].map(t => `<img src="pieces/${other(color)}${t.toUpperCase()}.svg" alt="${PIECE[t]}">`).join('');
      const adv = isMe ? diff : -diff;
      const turn = !this.over && this.chess.turn() === color;
      return `<span class="c-dot ${color === 'w' ? 'white' : 'black'}${turn ? ' turn' : ''}" aria-hidden="true"></span>
        <span class="c-name">${esc(name)}<small>${sub}</small></span>
        <span class="c-caps">${caps}${adv > 0 ? `<b>+${adv}</b>` : ''}</span>`;
    };
    $('cOpp').innerHTML = row(them, opp.name, `${them === 'w' ? 'White' : 'Black'}, level ${opp.id} of 4`, false);
    $('cMe').innerHTML = row(me, this.name, me === 'w' ? 'White' : 'Black', true);
  }

  renderActions() {
    const L = this.level;
    const btns = [];
    if (!this.over) {
      if (L <= 2) btns.push(`<button id="cHint">Hint</button>`);
      if (L <= 2) btns.push(`<button id="cUndo">Take back</button>`);
      btns.push(`<button id="cResign" class="danger">Resign</button>`);
    }
    btns.push(`<button id="cNew" class="${this.over ? 'go' : ''}">New game</button>`);
    $('cActions').innerHTML = btns.join('');
    const on = (id, f) => { const el = $(id); if (el) el.onclick = f; };
    on('cHint', () => this.hint());
    on('cUndo', () => this.takeBack());
    on('cResign', e => this.resign(e.target));
    on('cNew', () => this.setup());
  }

  // ---------- your move ----------
  onSquare(sq) {
    if (!this.isUserTurn() || this.busy) return;
    const c = this.chess;
    const pc = c.get(sq);
    if (this.selected) {
      if (sq === this.selected) { this.selected = null; this.render(); return; }
      if (pc && pc.color === this.userColor) { this.select(sq); return; }
      const moves = c.moves({ square: this.selected, verbose: true }).filter(m => m.to === sq);
      if (!moves.length) {
        this.say(`<b>Not allowed:</b> ${whyIllegal(c, this.selected, sq)}`, 'mistake');
        return;
      }
      if (moves.length > 1 && moves[0].promotion) return this.choosePromotion(moves[0]);
      return this.play(moves[0]);
    }
    if (pc && pc.color === this.userColor) this.select(sq);
    else if (pc && this.level === 1) this.say(`That's one of ${LEVELS[this.opp - 1].name}'s pieces — tap one of yours to move it.`, 'note');
  }

  select(sq) {
    const c = this.chess;
    this.selected = sq;
    const pc = c.get(sq);
    this.render();
    if (this.level === 1 && !this.introduced.has(pc.type)) {
      this.introduced.add(pc.type);
      this.say(pieceIntro(pc.type), 'info');
    }
    if (!c.moves({ square: sq }).length) {
      const why = c.isCheck() ? `You're in {{check}}, and this piece can't help — look for a move that protects the king.` : `This ${PIECE[pc.type]} has no legal moves right now — it's blocked${pc.type === 'k' ? ' or every square around it is attacked' : ''}.`;
      if (this.level <= 2) this.say(why, 'note');
    }
  }

  choosePromotion(m) {
    const box = $('cPromo');
    box.innerHTML = `<div class="c-promo-card"><p>Promote your pawn to:</p><div>${['q', 'r', 'b', 'n'].map(p => `<button data-p="${p}"><img src="pieces/${this.userColor}${p.toUpperCase()}.svg" alt="${PIECE[p]}"><span>${cap(PIECE[p])}</span></button>`).join('')}</div></div>`;
    box.hidden = false;
    box.querySelectorAll('button').forEach(b => b.onclick = () => {
      box.hidden = true;
      const mv = this.chess.moves({ square: m.from, verbose: true }).find(x => x.to === m.to && x.promotion === b.dataset.p);
      this.play(mv);
    });
  }

  async play(m) {
    const c = this.chess;
    const before = new Chess(c.fen());
    const analysis = this.analysis;
    const done = c.move({ from: m.from, to: m.to, promotion: m.promotion });
    this.selected = null;
    this.render(done);
    this.save();
    const L = this.level;
    // was it a mistake?
    let flagged = false;
    if (analysis && analysis.fen === before.fen()) flagged = this.review(done, analysis, before);
    const d = describeMove(done, before, c, 'You');
    if (L === 1 && !flagged) this.say(d.text, 'you');
    this.announceOpening();
    if (this.checkEnd()) return;
    await sleep(250);
    this.opponentTurn();
  }

  // Compare your move with the best one found when your turn started.
  review(m, analysis, before) {
    const L = this.level;
    const all = analysis.all;
    const best = all[0];
    const mine = all.find(s => s.move.from === m.from && s.move.to === m.to && (s.move.promotion || null) === (m.promotion || null));
    if (!mine || !best) return false;
    const loss = best.score - mine.score;
    const threshold = L === 3 ? 250 : 150;
    if (best.score > MATE - 50 && mine.score < MATE - 50) {
      if (L <= 2) this.say(`You had a {{checkmate}} available: <b>${best.move.san}</b>! Look for checks first — they're the most forcing moves.`, 'mistake');
      return L <= 2;
    }
    if (loss < threshold) return false;
    // what can they do now?
    const after = new Chess(before.fen()); after.move(m.san);
    const reply = scoreMoves(after.fen(), 1)[0];
    let why = '';
    if (reply) {
      const rm = reply.move;
      if (reply.score > MATE - 50) why = `It lets them play <b>${rm.san}</b>, which leads to {{checkmate}}.`;
      else if (rm.captured) why = `It lets them take your ${PIECE[rm.captured]} on ${rm.to} with <b>${rm.san}</b>.`;
      else why = `Their best reply is <b>${rm.san}</b>.`;
    }
    const lostPts = Math.max(1, Math.round(loss / 100));
    const msg = `<b>Mistake:</b> ${m.san} gives away about ${pts(lostPts)} of {{material}}. ${why}${L <= 2 ? ` Better was <b>${best.move.san}</b>.${L <= 2 ? ' Tap <b>Take back</b> to try again.' : ''}` : ''}`;
    this.say(msg, 'mistake');
    return true;
  }

  announceOpening() {
    if (this.level === 3) return;
    const sans = this.chess.history();
    if (sans.length > 14) return;
    const o = openingName(sans);
    if (o && o.name !== this.lastOpening) {
      this.lastOpening = o.name;
      if (sans.length >= 2) this.say(`This opening is ${o.name}.`, 'street');
    }
  }

  async userTurn() {
    if (this.over) return;
    const c = this.chess;
    const L = this.level;
    this.status(c.isCheck() ? `<b>Check!</b> Your move — get your king to safety.` : `<b>Your move.</b>${L === 1 ? ' Tap a piece, then where it should go.' : ''}`);
    // think about the position (for hints and mistake-checking)
    const fen = c.fen();
    this.analysis = null;
    await nextFrame();
    const res = bestMove(fen, { maxDepth: 3, timeMs: 1200 });
    if (c.fen() !== fen) return;
    this.analysis = { fen, all: res.all, best: res.all[0] };
    if (L === 1) this.advice();
  }

  advice() {
    const a = this.analysis;
    if (!a) return;
    const c = this.chess;
    const lines = [];
    const loose = loosePieces(c, this.userColor);
    if (c.isCheck()) lines.push(`You're in {{check}}. You must get out of it: move the king, put something in the way, or capture the attacker.`);
    else if (loose.length) lines.push(`Watch out: your ${PIECE[loose[0].type]} on ${loose[0].sq} is under attack${loose[0].defended ? ' by a cheaper piece' : ' and not {{defended}}'}.`);
    const theirLoose = loosePieces(c, other(this.userColor)).filter(l => !l.defended);
    if (theirLoose.length) lines.push(`Their ${PIECE[theirLoose[0].type]} on ${theirLoose[0].sq} is {{hanging}} — nothing defends it.`);
    const best = a.best.move;
    const before = new Chess(c.fen()); const after = new Chess(c.fen()); after.move(best.san);
    const d = describeMove(best, before, after, 'I would');
    const why = d.reasons.length ? d.reasons.slice(0, 2).join(' ') : 'It keeps your position solid and your pieces safe.';
    this.say(`<b>What I'd do: ${best.san}</b> — ${PIECE[best.piece]} ${best.from} to ${best.to}.${lines.length ? '<br>' + lines.join(' ') : ''}<br>${why}`, 'advice');
  }

  async hint() {
    if (!this.isUserTurn()) return;
    if (!this.analysis) { this.status('Thinking…', true); await sleep(50); const fen = this.chess.fen(); const r = bestMove(fen, { maxDepth: 3, timeMs: 1200 }); this.analysis = { fen, all: r.all, best: r.all[0] }; this.status('<b>Your move.</b>'); }
    this.advice();
    if (innerWidth < 900) this.openDrawer();
  }

  takeBack() {
    if (this.busy) return;
    const c = this.chess;
    if (!c.history().length) return;
    c.undo();
    if (c.turn() !== this.userColor && c.history().length) c.undo();
    if (c.turn() !== this.userColor) { this.render(); this.opponentTurn(); return; }
    this.over = false; this.selected = null;
    this.save(); this.render(); this.renderActions();
    this.say('Move taken back. Your turn again.', 'note');
    this.userTurn();
  }

  resign(btn) {
    if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Tap again to resign'; setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Resign'; }, 3000); return; }
    this.over = true; this.save();
    this.say(`You {{resign|resigned}}. ${LEVELS[this.opp - 1].name} wins this one — start a new game whenever you're ready.`, 'result');
    this.status('Game over.', true); this.render(); this.renderActions();
  }

  // ---------- their move ----------
  async opponentTurn() {
    if (this.over) return;
    const c = this.chess;
    const opp = LEVELS[this.opp - 1];
    this.busy = true;
    this.status(`${opp.name} is thinking…`, true);
    await sleep(450);
    await nextFrame();
    const fen = c.fen();
    const mv = opponentMove(fen, this.opp);
    if (c.fen() !== fen) { this.busy = false; return; }
    const before = new Chess(fen);
    const done = c.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    this.render(done);
    this.save();
    this.busy = false;
    const L = this.level;
    if (L <= 2) {
      const d = describeMove(done, before, c, 'They');
      let text = L === 1 ? d.text : `${opp.name} plays <b>${done.san}</b>. ${d.reasons[0] || ''}`;
      if (L === 1 && !c.isCheckmate()) {
        const loose = loosePieces(c, this.userColor);
        if (loose.length && !d.text.includes(loose[0].sq)) text += ` Your ${PIECE[loose[0].type]} on ${loose[0].sq} is now under attack.`;
      }
      this.say(text, 'action');
    }
    this.announceOpening();
    if (this.checkEnd()) return;
    this.userTurn();
  }

  checkEnd() {
    const e = endText(this.chess, this.userColor);
    if (!e) return false;
    this.over = true; this.save();
    this.say(e.text, 'result');
    this.status(e.result === 'win' ? '<b>You win!</b>' : e.result === 'loss' ? 'Game over.' : '<b>Draw.</b>', e.result !== 'win');
    this.renderActions(); this.renderPlayers();
    return true;
  }

  // ---------- sheets ----------
  menu() {
    const ui = this.shared.ui;
    $('infoBody').innerHTML = `<h2 class="chess-h">Menu</h2>
      <button class="menu-item" id="cmNew">New game / settings</button>
      <button class="menu-item" id="cmPieces">How the pieces move</button>
      <button class="menu-item" id="cmRules">Special rules: castling, en passant, promotion</button>
      <button class="menu-item" id="cmGloss">Glossary of chess words</button>
      <button class="menu-item" id="cmSwitch">Switch game</button>`;
    ui.open('info');
    $('cmNew').onclick = () => this.setup();
    $('cmPieces').onclick = () => this.piecesGuide();
    $('cmRules').onclick = () => this.rules();
    $('cmGloss').onclick = () => this.glossary();
    $('cmSwitch').onclick = () => { ui.close('info'); this.shared.onSwitch(); };
  }

  piecesGuide() {
    const color = this.userColor || 'w';
    $('infoBody').innerHTML = `<h2 class="chess-h">How the pieces move</h2>
      <div class="piece-guide">${['k', 'q', 'r', 'b', 'n', 'p'].map(t => `<div class="pg-row"><img src="pieces/${color}${t.toUpperCase()}.svg" alt=""><div>${this.termify(pieceIntro(t))}</div></div>`).join('')}</div>
      <p class="muted">Values help you judge trades: pawn 1, knight 3, bishop 3, rook 5, queen 9.</p>`;
    this.shared.ui.open('info');
  }

  rules() {
    $('infoBody').innerHTML = this.termify(`<h2 class="chess-h">Special rules</h2>
      <h3>Castling</h3><p>Once per game the king can move two squares towards a rook, and that rook jumps over to the other side of the king. Neither piece may have moved, the squares between must be empty, and the king can't be in check, pass through an attacked square or land in check. Tap your king, then the square two to the side.</p>
      <h3>En passant</h3><p>If an enemy pawn moves two squares and lands right beside your pawn, you may capture it as if it had moved one square — but only on your very next move.</p>
      <h3>Promotion</h3><p>A pawn reaching the far side becomes a queen, rook, bishop or knight. You'll be asked which.</p>
      <h3>Check and checkmate</h3><p>You may never leave your own king in {{check}}. If you're in check you must get out: move the king, block, or capture the attacker. If you can't, it's {{checkmate}} and the game is over.</p>
      <h3>Draws</h3><p>{{stalemate|Stalemate}} (no legal move but not in check), {{threefold repetition}}, the {{fifty-move rule}} and {{insufficient material}} are all draws.</p>`);
    this.shared.ui.open('info');
  }

  glossary(q = '') {
    const render = query => {
      $('cGlossList').innerHTML = searchChessGlossary(query).map(i => `<dt>${esc(i.term)}</dt><dd>${esc(i.def)}</dd>`).join('') || '<p class="muted">No matches.</p>';
    };
    $('infoBody').innerHTML = `<h2 class="chess-h">Chess words</h2><input type="text" id="cGlossQ" placeholder="Search, e.g. fork" value="${esc(q)}"><dl class="gloss-list" id="cGlossList"></dl>`;
    this.shared.ui.open('info');
    render(q);
    $('cGlossQ').oninput = e => render(e.target.value);
  }
}

function findKing(c, color) {
  for (const row of c.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  return null;
}
function load(k) { try { return JSON.parse(localStorage.getItem(k) || 'null') || {}; } catch { return {}; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
