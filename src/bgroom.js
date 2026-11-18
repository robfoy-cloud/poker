// An online backgammon game for two people: a Cloudflare Durable Object that rolls the dice
// and checks every move, so neither phone can cheat. Each player sees the board from their own side.

import * as E from '../public/js/backgammon/engine.js';

const fair = () => { for (;;) { const b = crypto.getRandomValues(new Uint8Array(1))[0]; if (b < 252) return 1 + (b % 6); } };

export class BgRoom {
  constructor(state, env) { this.state = state; this.env = env; this.room = null; this.conns = new Map(); }

  async load() { if (!this.room) this.room = (await this.state.storage.get('room')) || null; return this.room; }
  save() { return this.state.storage.put('room', this.room); }

  async fetch(request) {
    const url = new URL(request.url);
    await this.load();
    if (url.pathname === '/init') {
      if (this.room) return new Response('exists', { status: 409 });
      const body = await request.json();
      this.room = { code: body.code, hostId: body.clientId, people: [], cubeOn: !!body.settings.cube, g: null, score: [0, 0] };
      await this.save();
      return new Response('ok');
    }
    if (url.pathname === '/ws') {
      if (!this.room) return new Response('No such game', { status: 404 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      this.attach(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('Not found', { status: 404 });
  }

  attach(ws) {
    let id = null;
    ws.addEventListener('message', async ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'hello') { id = String(m.clientId || '').slice(0, 64); return this.hello(ws, id, String(m.name || 'Player').trim().slice(0, 14) || 'Player'); }
      if (id == null) return;
      const s = this.room.people.findIndex(p => p.clientId === id);
      if (s < 0) return;
      if (m.t === 'leave') { this.conns.delete(id); this.notice(1 - s, `${this.room.people[s].name} has left the game.`); return; }
      await this.action(s, m);
    });
    const gone = () => { if (id && this.conns.get(id) === ws) { this.conns.delete(id); const s = this.room.people.findIndex(p => p.clientId === id); if (s >= 0) this.notice(1 - s, `${this.room.people[s].name} has lost their connection. The game will carry on when they're back.`); } };
    ws.addEventListener('close', gone); ws.addEventListener('error', gone);
  }

  send(ws, o) { try { ws.send(JSON.stringify(o)); } catch {} }
  wsFor(s) { const p = this.room.people[s]; return p ? this.conns.get(p.clientId) : null; }
  notice(s, text) { const ws = this.wsFor(s); if (ws) this.send(ws, { t: 'notice', text }); }

  async hello(ws, id, name) {
    const r = this.room;
    let s = r.people.findIndex(p => p.clientId === id);
    if (s < 0) {
      if (r.people.length >= 2) { this.send(ws, { t: 'error', message: 'This game already has two players.' }); ws.close(1000); return; }
      if (r.people.length && r.people[0].name.toLowerCase() === name.toLowerCase()) name += ' 2';
      r.people.push({ clientId: id, name });
      s = r.people.length - 1;
      await this.save();
    }
    const old = this.conns.get(id); if (old && old !== ws) { try { old.close(1000); } catch {} }
    this.conns.set(id, ws);
    this.send(ws, { t: 'welcome', side: s, code: r.code, host: id === r.hostId });
    this.lobby();
    if (r.g) { this.send(ws, { t: 'ev', ev: { type: 'resync', state: this.view(s) } }); this.notice(1 - s, `${name} is connected.`); }
    else if (r.people.length === 2) await this.newGame();
  }

  lobby() {
    const r = this.room;
    const info = { t: 'lobby', code: r.code, people: r.people.map(p => ({ name: p.name, connected: this.conns.has(p.clientId) })), started: !!r.g };
    for (const ws of this.conns.values()) this.send(ws, info);
  }

  rel(s, x) { return x === -1 || x == null ? 'none' : x === s ? 'you' : 'them'; }
  view(s) {
    const g = this.room.g, r = this.room;
    return {
      a: s === 0 ? [Array.from(g.a[0]), Array.from(g.a[1])] : [Array.from(g.a[1]), Array.from(g.a[0])],
      cube: g.cube, owner: this.rel(s, g.owner), turn: this.rel(s, g.turn), phase: g.phase, dice: g.dice, doubler: this.rel(s, g.doubler),
      first: g.first, cubeOn: r.cubeOn, gameNo: g.gameNo, score: { me: r.score[s], them: r.score[1 - s] },
      names: { me: r.people[s] ? r.people[s].name : 'You', them: r.people[1 - s] ? r.people[1 - s].name : 'Opponent' },
      ready: { me: !!(g.ready && g.ready[s]), them: !!(g.ready && g.ready[1 - s]) },
    };
  }
  // send each player their own version of what just happened
  emit(evFor) {
    for (const s of [0, 1]) { const ws = this.wsFor(s); if (ws) this.send(ws, { t: 'ev', ev: { ...evFor(s), state: this.view(s) } }); }
  }

  async newGame() {
    const r = this.room;
    const gameNo = r.g ? r.g.gameNo + 1 : 1;
    const p = E.START();
    const rolls = [];
    let a, b;
    do { a = fair(); b = fair(); rolls.push([a, b]); } while (a === b);
    const turn = a > b ? 0 : 1;
    r.g = { a: [Array.from(p.a[0]), Array.from(p.a[1])], cube: 1, owner: -1, turn, phase: 'move', dice: [Math.max(a, b), Math.min(a, b)], doubler: -1, first: true, gameNo, ready: [false, false] };
    await this.save();
    this.emit(s => ({ type: 'opening', rolls: rolls.map(([x, y]) => (s === 0 ? [x, y] : [y, x])), first: this.rel(s, turn) }));
  }

  pos() { const g = this.room.g; return { a: [Int8Array.from(g.a[0]), Int8Array.from(g.a[1])] }; }
  setPos(p) { this.room.g.a = [Array.from(p.a[0]), Array.from(p.a[1])]; }

  async action(s, m) {
    const g = this.room.g;
    if (!g) return;
    const ws = this.wsFor(s);
    const no = message => { if (ws) { this.send(ws, { t: 'notice', text: message }); this.send(ws, { t: 'ev', ev: { type: 'resync', state: this.view(s) } }); } };
    switch (m.t) {
      case 'roll': {
        if (g.phase !== 'roll' || g.turn !== s) return no('It isn\'t your turn to roll.');
        g.dice = [fair(), fair()];
        const moves = E.legalMoves(this.pos(), s, g.dice[0], g.dice[1]);
        if (!moves.length || !moves[0].steps.length) {
          const dice = g.dice;
          g.turn = 1 - s; g.phase = 'roll'; g.dice = null; g.first = false;
          await this.save();
          this.emit(x => ({ type: 'nomove', who: this.rel(x, s), dice }));
        } else {
          g.phase = 'move';
          await this.save();
          this.emit(x => ({ type: 'rolled', who: this.rel(x, s), dice: g.dice }));
        }
        return;
      }
      case 'move': {
        if (g.phase !== 'move' || g.turn !== s) return no('It isn\'t your turn to move.');
        const steps = Array.isArray(m.steps) ? m.steps : [];
        const legal = E.legalMoves(this.pos(), s, g.dice[0], g.dice[1]);
        const same = (x, y) => x.from === y.from && x.to === y.to && x.die === y.die;
        const match = legal.find(L => L.steps.length === steps.length && L.steps.every((st, i) => same(st, steps[i])));
        if (!match) return no('That move isn\'t allowed — please try again.');
        this.setPos(match.pos);
        const w = E.winner(match.pos);
        const played = match.steps;
        if (w >= 0) {
          const kind = E.winKind(match.pos, w);
          this.room.score[w] += g.cube * kind;
          g.phase = 'over'; g.ready = [false, false]; g.dice = null;
          await this.save();
          this.emit(x => ({ type: 'moved', who: this.rel(x, s), steps: played }));
          this.emit(x => ({ type: 'won', who: this.rel(x, w), kind, points: g.cube * kind, how: 'finish' }));
          return;
        }
        g.turn = 1 - s; g.phase = 'roll'; g.dice = null; g.first = false;
        await this.save();
        this.emit(x => ({ type: 'moved', who: this.rel(x, s), steps: played }));
        return;
      }
      case 'double': {
        if (!this.room.cubeOn || g.phase !== 'roll' || g.turn !== s || g.owner === 1 - s || g.cube >= 64) return no('You can\'t double now.');
        g.phase = 'double'; g.doubler = s;
        await this.save();
        this.emit(x => ({ type: 'doubled', who: this.rel(x, s), to: g.cube * 2 }));
        return;
      }
      case 'take': case 'drop': {
        if (g.phase !== 'double' || g.doubler === s) return no('There\'s no double to answer.');
        if (m.t === 'take') {
          g.cube *= 2; g.owner = s; g.phase = 'roll'; g.doubler = -1;
          await this.save();
          this.emit(x => ({ type: 'took', who: this.rel(x, s) }));
        } else {
          const w = g.doubler;
          this.room.score[w] += g.cube;
          g.phase = 'over'; g.ready = [false, false]; g.doubler = -1;
          await this.save();
          this.emit(x => ({ type: 'won', who: this.rel(x, w), kind: 1, points: g.cube, how: 'drop' }));
        }
        return;
      }
      case 'resign': {
        if (g.phase === 'over') return;
        const w = 1 - s;
        this.room.score[w] += g.cube;
        g.phase = 'over'; g.ready = [false, false];
        await this.save();
        this.emit(x => ({ type: 'won', who: this.rel(x, w), kind: 1, points: g.cube, how: 'resign' }));
        return;
      }
      case 'next': {
        if (g.phase !== 'over') return;
        g.ready[s] = true;
        await this.save();
        if (g.ready[0] && g.ready[1]) return this.newGame();
        this.notice(1 - s, `${this.room.people[s].name} is ready for the next game.`);
        return;
      }
    }
  }
}
