// Connection to an online backgammon game (server: src/bgroom.js).
// Game events arrive in order through next(); the waiting room is shown until the game starts.

import { accessToken } from '../auth.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function clientId() {
  let id = localStorage.getItem('gamecoach.clientId');
  if (!id) { id = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('gamecoach.clientId', id); }
  return id;
}

export async function createGame(cube) {
  const token = await accessToken();
  const r = await fetch('/api/room', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ game: 'bg', settings: { cube }, clientId: clientId() }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j.code;
}

export class BgRemote {
  // hooks: { ui, name, onNotice(text), onFail(text), titleClass }
  constructor(hooks) { Object.assign(this, hooks); this.queue = []; this.waiting = null; this.closed = false; this.started = false; }

  async connect(code) {
    this.code = code;
    const token = await accessToken();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/bgroom/${code}/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    ws.onopen = () => { this.retries = 0; ws.send(JSON.stringify({ t: 'hello', clientId: clientId(), name: this.name || 'Player' })); };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } this.onMessage(m); };
    ws.onclose = () => {
      if (this.ws !== ws || this.closed) return;
      if (!this.welcomed) { this.closed = true; return this.onFail(`Couldn't join game ${esc(code)}. Check the code, and that you're signed in.`); }
      this.retries = (this.retries || 0) + 1;
      this.onNotice('Connection lost — reconnecting…');
      setTimeout(() => { if (!this.closed) this.connect(code); }, Math.min(8000, 1000 * this.retries));
    };
  }
  send(o) { try { this.ws.send(JSON.stringify(o)); } catch {} }
  leave() { this.closed = true; this.send({ t: 'leave' }); try { this.ws.close(); } catch {} }

  onMessage(m) {
    if (m.t === 'welcome') { this.welcomed = true; this.code = m.code; return; }
    if (m.t === 'lobby') { this.lobby = m; if (!m.started && !this.started) this.lobbySheet(); return; }
    if (m.t === 'notice') {
      // during the game, keep notices in step with the moves being shown
      if (this.started && (this.busy || this.queue.length)) return this.push({ type: 'notice', text: esc(m.text) });
      return this.onNotice(esc(m.text));
    }
    if (m.t === 'error') { this.closed = true; return this.onFail(esc(m.message)); }
    if (m.t === 'ev') {
      if (!this.started) { this.started = true; this.ui.close('info'); }
      this.push(m.ev);
    }
  }
  push(ev) { if (this.waiting) { const w = this.waiting; this.waiting = null; w(ev); } else this.queue.push(ev); }
  next() { return this.queue.length ? Promise.resolve(this.queue.shift()) : new Promise(r => { this.waiting = r; }); }

  lobbySheet(status) {
    const L = this.lobby;
    let html = `<h2 class="${this.titleClass || ''}">Play a friend online</h2>`;
    if (!L) html += `<p>${status || 'Connecting…'}</p>`;
    else html += `<p>Game code</p><div class="ol-code bg-code">${esc(L.code)}</div>
      <p class="muted">Ask your friend to open Game Coach, choose Backgammon, then <b>Join a friend's game</b> and enter this code. They need to be on the app's sign-in list. The game starts as soon as they join.</p>
      ${navigator.share ? `<button class="small" id="bgoShare">Share the code</button>` : ''}
      <ul class="people">${L.people.map(p => `<li><span>${esc(p.name)}</span><span class="${p.connected ? 'ol-on' : 'ol-off'}">${p.connected ? 'here' : 'not connected'}</span></li>`).join('')}</ul>
      <p><b>${L.people.length < 2 ? 'Waiting for your friend to join…' : 'Starting…'}</b></p>
      <button class="small" id="bgoLeave">Cancel</button>`;
    $('infoBody').innerHTML = html;
    this.ui.open('info');
    const share = $('bgoShare'); if (share) share.onclick = () => navigator.share({ title: 'Game Coach backgammon', text: `Play backgammon with me in Game Coach — code ${L.code}` }).catch(() => {});
    const lv = $('bgoLeave'); if (lv) lv.onclick = () => { this.ui.close('info'); this.leave(); this.onFail(null); };
  }
}
