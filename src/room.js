// An online poker table: a Cloudflare Durable Object that runs the real game for everyone.
// Each person connects by WebSocket and only ever receives their own hole cards
// (and anyone's that are turned face up at the showdown). Computer players fill empty seats.
// Coaching happens on each person's own device, from what that person can see.

import { Game } from '../public/js/engine.js';
import { botDecide, STYLES } from '../public/js/ai.js';

const NAMES = ['Ava', 'Ben', 'Cleo', 'Dev', 'Esme', 'Finn', 'Gus', 'Hana'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AWAY_MS = 60000;      // a disconnected player's turns are played for them after this
const NEXT_HAND_MS = 120000; // longest wait for everyone to be ready for the next hand

export class PokerRoom {
  constructor(state, env) {
    this.state = state; this.env = env;
    this.room = null;           // { code, settings, people: [{clientId, name, email}], hostId, phase }
    this.conns = new Map();     // clientId -> WebSocket
    this.asks = new Map();      // id -> { seat, kind, payload, resolve }
    this.askId = 0;
    this.away = new Map();      // seat -> timer
    this.awaySeats = new Set();
    this.game = null;
  }

  async load() {
    if (!this.room) this.room = (await this.state.storage.get('room')) || null;
    return this.room;
  }
  save() { return this.state.storage.put('room', this.room); }

  async fetch(request) {
    const url = new URL(request.url);
    await this.load();
    if (url.pathname === '/init') {
      if (this.room && this.room.phase !== 'closed') return new Response('exists', { status: 409 });
      const body = await request.json();
      this.room = { code: body.code, settings: body.settings, people: [], hostId: body.clientId, phase: 'lobby', created: Date.now() };
      await this.save();
      return new Response('ok');
    }
    if (url.pathname === '/ws') {
      if (!this.room) return new Response('No such table', { status: 404 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      this.attach(server, request.headers.get('x-email') || '');
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('Not found', { status: 404 });
  }

  // ---------- connections ----------
  attach(ws, email) {
    let clientId = null;
    ws.addEventListener('message', async ev => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'hello') {
        clientId = String(msg.clientId || '').slice(0, 64);
        const name = String(msg.name || 'Player').trim().slice(0, 14) || 'Player';
        return this.hello(ws, clientId, name, email);
      }
      if (!clientId) return;
      if (msg.t === 'start' && clientId === this.room.hostId) return this.start();
      if (msg.t === 'answer') {
        const a = this.asks.get(msg.id);
        const seat = this.seatOf(clientId);
        if (a && a.seat === seat) { this.asks.delete(msg.id); a.resolve(msg.value); }
        return;
      }
      if (msg.t === 'leave') { this.leave(clientId); try { ws.close(1000, 'left'); } catch {} return; }
      if (msg.t === 'ping') this.send(ws, { t: 'pong' });
    });
    const gone = () => { if (clientId && this.conns.get(clientId) === ws) { this.conns.delete(clientId); this.disconnected(clientId); } };
    ws.addEventListener('close', gone);
    ws.addEventListener('error', gone);
  }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
  seatOf(clientId) { return this.room.people.findIndex(p => p.clientId === clientId); }
  wsForSeat(seat) { const p = this.room.people[seat]; return p ? this.conns.get(p.clientId) : null; }

  async hello(ws, clientId, name, email) {
    const room = this.room;
    let seat = this.seatOf(clientId);
    if (seat < 0) {
      if (room.phase !== 'lobby') { this.send(ws, { t: 'error', message: 'This game has already started. Ask the host to start a new table.' }); ws.close(1000); return; }
      if (room.people.length >= room.settings.players) { this.send(ws, { t: 'error', message: 'This table is full.' }); ws.close(1000); return; }
      if (room.people.length >= 6) { this.send(ws, { t: 'error', message: 'At most six people can play at one table.' }); ws.close(1000); return; }
      room.people.push({ clientId, name: this.uniqueName(name), email });
      seat = room.people.length - 1;
      await this.save();
    }
    const old = this.conns.get(clientId);
    if (old && old !== ws) { try { old.close(1000, 'replaced'); } catch {} }
    this.conns.set(clientId, ws);
    this.back(seat);
    this.send(ws, { t: 'welcome', seat, host: clientId === room.hostId, code: room.code });
    this.broadcastLobby();
    if (room.phase === 'playing' && this.game) {
      this.send(ws, { t: 'resync', state: this.snapshot(this.game, seat), log: this.publicLog(seat) });
      for (const [id, a] of this.asks) if (a.seat === seat) this.send(ws, { t: 'ask', id, kind: a.kind, payload: a.payload });
    }
  }

  uniqueName(name) {
    const taken = new Set(this.room.people.map(p => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`.toLowerCase())) return `${name} ${i}`;
  }

  lobbyInfo() {
    const r = this.room;
    return { t: 'lobby', code: r.code, phase: r.phase, settings: r.settings, people: r.people.map(p => ({ name: p.name, connected: this.conns.has(p.clientId), host: p.clientId === r.hostId })) };
  }
  broadcastLobby() { const info = this.lobbyInfo(); for (const ws of this.conns.values()) this.send(ws, info); }

  leave(clientId) {
    const seat = this.seatOf(clientId);
    if (seat < 0) return;
    if (this.room.phase === 'lobby') {
      this.room.people.splice(seat, 1);
      if (clientId === this.room.hostId && this.room.people.length) this.room.hostId = this.room.people[0].clientId;
      this.save(); this.conns.delete(clientId); this.broadcastLobby();
    } else { this.conns.delete(clientId); this.markAway(seat); }
  }

  disconnected(clientId) {
    const seat = this.seatOf(clientId);
    this.broadcastLobby();
    if (seat < 0 || this.room.phase !== 'playing') return;
    clearTimeout(this.away.get(seat));
    this.away.set(seat, setTimeout(() => this.markAway(seat), AWAY_MS));
  }
  markAway(seat) {
    this.awaySeats.add(seat);
    this.notice(`${this.room.people[seat].name} has lost their connection — their turns are being played for them (check or fold) until they come back.`);
    for (const [id, a] of this.asks) if (a.seat === seat) { this.asks.delete(id); a.resolve(this.defaultAnswer(a)); }
  }
  back(seat) {
    clearTimeout(this.away.get(seat)); this.away.delete(seat);
    if (this.awaySeats.delete(seat) && this.room.phase === 'playing') this.notice(`${this.room.people[seat].name} is back.`);
  }
  notice(text) { for (const ws of this.conns.values()) this.send(ws, { t: 'notice', text }); }

  // ---------- asking a person to act ----------
  ask(seat, kind, payload) {
    if (this.awaySeats.has(seat)) return Promise.resolve(this.defaultAnswer({ kind, payload }));
    return new Promise(resolve => {
      const id = ++this.askId;
      this.asks.set(id, { seat, kind, payload, resolve });
      const ws = this.wsForSeat(seat);
      if (ws) this.send(ws, { t: 'ask', id, kind, payload });
    });
  }
  defaultAnswer(a) {
    const p = a.payload || {};
    if (a.kind === 'action') return p.canCheck ? { type: 'check' } : { type: 'fold' };
    if (a.kind === 'post') return p.amount;
    if (a.kind === 'dealer') return p.step === 'firstCard' ? p.correct : p.step.endsWith(':first') ? 'burn' : (p.street === 'flop' ? 3 : 1);
    return true;
  }

  // ---------- the game ----------
  async start() {
    const r = this.room;
    if (r.phase !== 'lobby' || r.people.length < 1) return;
    r.phase = 'playing'; await this.save();
    const s = r.settings;
    const styleKeys = Object.keys(STYLES);
    const taken = new Set(r.people.map(p => p.name.toLowerCase()));
    const botNames = NAMES.filter(n => !taken.has(n.toLowerCase())).sort(() => Math.random() - 0.5);
    const players = r.people.map(p => ({ name: p.name, isHuman: true }));
    while (players.length < s.players) players.push({ name: botNames.shift() || `Bot ${players.length}`, style: styleKeys[Math.floor(Math.random() * styleKeys.length)] });
    this.broadcastLobby();
    for (const ws of this.conns.values()) this.send(ws, { t: 'started' });
    const game = new Game({ players, stack: s.stack, sb: s.sb, bb: s.bb }, this.io());
    this.game = game;
    try {
      while (!game.over) {
        await game.playHand();
        if (game.over) break;
        // wait until everyone still connected has tapped "Next hand"
        const waits = game.players.filter(p => p.isHuman && !this.awaySeats.has(p.seat)).map(p => this.ask(p.seat, 'next', {}));
        await Promise.race([Promise.all(waits), sleep(NEXT_HAND_MS)]);
        for (const [id, a] of this.asks) if (a.kind === 'next') { this.asks.delete(id); a.resolve(true); }
        if (!this.conns.size) break; // everyone has gone
      }
    } catch (e) {
      this.notice('Something went wrong at the table: ' + (e && e.message));
    }
    r.phase = 'over'; await this.save();
    for (const ws of this.conns.values()) this.send(ws, { t: 'over' });
  }

  io() {
    const room = this;
    return {
      async event(type, data, game) {
        // a few messages are private to one player
        const privateTo = (type === 'mistake' || type === 'dealerOk') ? data.seat : null;
        game.players.forEach((p, seat) => {
          if (!p.isHuman) return;
          if (privateTo != null && privateTo !== seat) return;
          const ws = room.wsForSeat(seat);
          if (ws) room.send(ws, { t: 'ev', type, data: room.clean(type, data), state: room.snapshot(game, seat) });
        });
        // a natural pace, so people can follow
        const pause = { dealt: 700, street: 900, showdown: 1600, winUncontested: 900, collect: 350, newHand: 400 }[type];
        if (pause) await sleep(pause);
      },
      async botAction(p, ctx, game) {
        await sleep(800 + Math.random() * 600);
        return botDecide(game, p, ctx);
      },
      humanAction(ctx) { return room.ask(ctx.seat, 'action', ctx); },
      humanPost(ctx) { return room.ask(ctx.player.seat, 'post', { which: ctx.which, amount: ctx.amount }); },
      dealerStep(ctx) {
        const g = ctx.game;
        return room.ask(ctx.seat, 'dealer', { step: ctx.step, street: ctx.street, correct: g.nextSeat(g.button, p => !p.out) });
      },
    };
  }

  // event data is already free of hidden cards, but make sure nothing odd slips through
  clean(type, data) { return JSON.parse(JSON.stringify(data, (k, v) => (k === 'game' || k === 'player' ? undefined : v))); }

  // What one player can see.
  snapshot(g, seat) {
    return {
      players: g.players.map(p => ({
        seat: p.seat, name: p.name, isHuman: p.seat === seat, remote: p.isHuman, away: this.awaySeats.has(p.seat) || (p.isHuman && !this.conns.has((this.room.people[p.seat] || {}).clientId)),
        stack: p.stack, folded: p.folded, allIn: p.allIn, out: p.out, bet: p.bet, totalIn: p.totalIn, lastAction: p.lastAction,
        shown: p.shown, best: p.shown ? p.best : null, stats: p.stats, vpipThisHand: p.vpipThisHand,
        hole: (p.seat === seat || p.shown) ? p.hole : p.hole.map(() => null),
      })),
      sb: g.sb, bb: g.bb, button: g.button, handNo: g.handNo, board: g.board, burned: g.burned.map(() => null), pot: g.pot,
      street: g.street, currentBet: g.currentBet, lastFullRaise: g.lastFullRaise, preflopRaiser: g.preflopRaiser,
      raisesThisStreet: g.raisesThisStreet, sbSeat: g.sbSeat, bbSeat: g.bbSeat, streetAggressor: g.streetAggressor,
      winners: g.winners, over: g.over,
    };
  }
  publicLog(seat) {
    return (this.game ? this.game.log : []).filter(e => !((e.type === 'mistake' || e.type === 'dealerOk') && e.seat !== seat)).slice(-200).map(e => this.clean(e.type, e));
  }
}
