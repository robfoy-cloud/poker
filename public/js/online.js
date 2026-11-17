// Playing poker online with friends: each person on their own device, plus computer players.
// The table itself runs on the server (a Cloudflare Durable Object); this file connects to it,
// shows the waiting room, and replays what happens at the table through the normal screen
// and coach — so coaching works exactly as in a practice game, from what you can see.

import { Game } from './engine.js';
import { accessToken } from './auth.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function clientId() {
  let id = localStorage.getItem('gamecoach.clientId');
  if (!id) { id = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('gamecoach.clientId', id); }
  return id;
}

export class OnlineTable {
  // hooks: { ui, coach, settings, io (prompts from app.js), onStop }
  constructor(hooks) {
    Object.assign(this, hooks);
    this.queue = []; this.busy = false; this.log = [];
    this.ws = null; this.code = null; this.closed = false; this.started = false; this.mySeat = null;
  }

  // ---------- making and joining tables ----------
  async host(settings) {
    if (!navigator.onLine) return this.fail('You need an internet connection to play online.');
    this.lobbySheet('Making a table…');
    try {
      const token = await accessToken();
      const r = await fetch('/api/room', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ settings, clientId: clientId() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      this.connect(j.code);
    } catch (e) { this.fail(`Couldn't make a table: ${e.message}`); }
  }
  join(code) {
    code = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) return this.fail('Enter the table code your friend gave you (5 letters and numbers).');
    if (!navigator.onLine) return this.fail('You need an internet connection to play online.');
    this.lobbySheet('Joining…');
    this.connect(code);
  }

  async connect(code) {
    this.code = code;
    const token = await accessToken();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/room/${code}/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    ws.onopen = () => { this.retries = 0; ws.send(JSON.stringify({ t: 'hello', clientId: clientId(), name: this.settings.name || 'Player' })); };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } this.onMessage(m); };
    ws.onclose = () => {
      if (this.ws !== ws || this.closed) return;
      if (!this.welcomed) return this.fail(`Couldn't join table ${esc(code)}. Check the code, and that you're signed in.`);
      // try to get back in
      this.retries = (this.retries || 0) + 1;
      this.ui.setPrompt(`Connection lost — reconnecting…`, true);
      setTimeout(() => { if (!this.closed) this.connect(code); }, Math.min(8000, 1000 * this.retries));
    };
  }

  send(obj) { try { this.ws.send(JSON.stringify(obj)); } catch {} }

  leave() {
    this.closed = true;
    this.send({ t: 'leave' });
    try { this.ws.close(); } catch {}
    this.onStop && this.onStop();
  }

  fail(text) {
    $('infoBody').innerHTML = `<h2>Play online</h2><p class="count-result bad">${text}</p><button class="primary wide" id="olBack">OK</button>`;
    this.ui.open('info');
    $('olBack').onclick = () => { this.ui.close('info'); this.closed = true; this.onStop && this.onStop(); };
  }

  // ---------- messages from the table ----------
  onMessage(m) {
    switch (m.t) {
      case 'welcome':
        this.welcomed = true; this.mySeat = m.seat; this.isHost = m.host; this.code = m.code;
        return;
      case 'lobby':
        this.lobby = m;
        if (m.phase === 'lobby') this.lobbySheet();
        return;
      case 'started':
        this.started = true; this.ui.close('info');
        this.ui.clearLog();
        this.ui.coachSay(`The online game has started at table <b>${esc(this.code)}</b>. Everyone gets their own coach — yours is set to <b>${['', 'Learn', 'Advise', 'Test'][this.settings.level]}</b>. Players marked “online” are real people.`, 'note');
        return;
      case 'error':
        this.closed = true; this.fail(esc(m.message)); return;
      case 'notice':
        this.ui.coachSay(esc(m.text), 'note'); return;
      case 'resync':
        this.started = true; this.ui.close('info');
        this.log = m.log || [];
        this.mirror(m.state); this.ui.render();
        this.ui.setPrompt('Reconnected.', true);
        return;
      case 'over':
        this.enqueue(async () => {
          this.closed = true;
          this.ui.setPrompt('The online game is over.', true);
          this.ui.setActions([{ label: 'Back to practice', cls: 'go', onClick: () => this.onStop && this.onStop() }]);
        });
        return;
      case 'ev': case 'ask':
        this.enqueue(() => (m.t === 'ev' ? this.event(m) : this.answer(m)));
        return;
    }
  }

  // Events are handled strictly in order. The coach may pause (Learn mode "Continue"),
  // and later messages simply wait their turn.
  enqueue(fn) { this.queue.push(fn); if (!this.busy) this.drain(); }
  async drain() {
    this.busy = true;
    while (this.queue.length) { const fn = this.queue.shift(); try { await fn(); } catch (e) { console.error(e); } }
    this.busy = false;
  }

  mirror(state) {
    const g = Object.create(Game.prototype);
    Object.assign(g, state);
    g.log = this.log;
    g.online = true;
    this.game = g; this.ui.game = g;
    return g;
  }

  async event(m) {
    this.log.push({ type: m.type, ...m.data });
    const g = this.mirror(m.state);
    const d = m.data;
    if (m.type === 'newHand') this.ui.highlightTurn = null;
    if (m.type === 'turn') this.ui.highlightTurn = d.seat;
    if (m.type === 'roundEnd' || m.type === 'showdown' || m.type === 'winUncontested') this.ui.highlightTurn = null;
    if (m.type === 'turn' && !g.players[d.seat].isHuman) this.ui.setPrompt(`${esc(g.players[d.seat].name)} is thinking…`, true);
    this.ui.render();
    await this.coach.event(m.type, d, g);
    this.ui.render();
  }

  async answer(m) {
    const g = this.game;
    let value;
    if (m.kind === 'action') value = await this.io.humanAction(m.payload, g);
    else if (m.kind === 'post') value = await this.io.humanPost(m.payload);
    else if (m.kind === 'dealer') value = await this.io.dealerStep({ ...m.payload, game: g });
    else if (m.kind === 'next') { value = true; this.ui.setPrompt('Waiting for the others to be ready for the next hand…', true); }
    this.send({ t: 'answer', id: m.id, value });
  }

  // ---------- the waiting room ----------
  lobbySheet(status) {
    const L = this.lobby;
    let html = `<h2>Play online</h2>`;
    if (!L) html += `<p>${status || 'Connecting…'}</p>`;
    else {
      const s = L.settings;
      html += `<p>Table code</p><div class="ol-code" aria-label="Table code">${esc(L.code)}</div>
        <p class="muted">Ask your friends to open Game Coach, choose Texas Hold'em, then <b>Join a table</b> and enter this code. They need to be on the app's sign-in list.</p>
        ${navigator.share ? `<button class="small" id="olShare">Share the code</button>` : ''}
        <h3>At the table (${L.people.length} ${L.people.length === 1 ? 'person' : 'people'})</h3>
        <ul class="people">${L.people.map(p => `<li><span>${esc(p.name)}${p.host ? ' <em>host</em>' : ''}</span><span class="${p.connected ? 'ol-on' : 'ol-off'}">${p.connected ? 'here' : 'not connected'}</span></li>`).join('')}</ul>
        <p class="muted">${s.players} seats: the empty ones go to computer players. ${s.stack} chips each, blinds ${s.sb}/${s.bb}. Each person chooses their own coaching level.</p>
        ${this.isHost ? `<button class="primary wide" id="olStart" ${L.people.length < 2 ? 'disabled' : ''}>${L.people.length < 2 ? 'Waiting for a friend to join…' : 'Start the game'}</button>` : `<p><b>Waiting for the host to start…</b></p>`}
        <button class="small" id="olLeave" style="margin-top:10px">Leave</button>`;
    }
    $('infoBody').innerHTML = html;
    this.ui.open('info');
    const on = (id, f) => { const el = $(id); if (el) el.onclick = f; };
    on('olStart', () => this.send({ t: 'start' }));
    on('olLeave', () => { this.ui.close('info'); this.leave(); });
    on('olShare', () => navigator.share({ title: 'Game Coach poker', text: `Join my poker table in Game Coach — code ${L.code}` }).catch(() => {}));
  }
}
