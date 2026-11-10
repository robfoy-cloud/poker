// Wires the engine, coach, bots and screen together.

import { Game } from './engine.js';
import { UI } from './ui.js';
import { Coach } from './coach.js';
import { botDecide, STYLES } from './ai.js';
import { searchGlossary } from './glossary.js';
import { Trainer } from './trainer.js';
import { ShowdownTrainer } from './showdown.js';
import { APP_VERSION } from './version.js';

const $ = id => document.getElementById(id);
const NAMES = ['Ava', 'Ben', 'Cleo', 'Dev', 'Esme', 'Finn', 'Gus', 'Hana'];

const DEFAULTS = { players: 6, stack: 1000, blinds: '5/10', level: 1, speed: 800, showTotals: false, step: false, name: '' };
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('poker.settings') || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveSettings(s) { try { localStorage.setItem('poker.settings', JSON.stringify(s)); } catch {} }

const settings = loadSettings();
const ui = new UI(settings);
const coach = new Coach(ui, settings);
const trainer = new Trainer(ui);
const sdTrainer = new ShowdownTrainer(ui, settings);
let gen = 0;
const never = () => new Promise(() => {});

// ---------- the bridge the engine talks to ----------
function makeIO(myGen) {
  const live = () => myGen === gen;
  return {
    async event(type, d, game) {
      if (!live()) return never();
      if (type === 'newHand') { game.winners = null; ui.highlightTurn = null; }
      if (type === 'turn') ui.highlightTurn = d.seat;
      if (type === 'roundEnd' || type === 'showdown' || type === 'winUncontested') ui.highlightTurn = null;
      ui.render();
      await coach.event(type, d, game);
      if (!live()) return never();
      ui.render();
      if (type === 'dealt' || type === 'collect') await ui.sleep(Math.min(500, settings.speed));
    },
    async botAction(p, ctx, game) {
      if (!live()) return never();
      if (settings.step) {
        const pos = game.positions()[p.seat];
        await ui.waitContinue('Next move', `Next to act: <b>${p.name}</b>${pos ? ` (${pos})` : ''}. Tap <b>Next move</b> to see what they do.`);
        if (!live()) return never();
      } else {
        ui.setPrompt(`${p.name} is thinking…`, true);
        await ui.sleep(settings.speed);
      }
      if (!live()) return never();
      return botDecide(game, p, ctx);
    },
    humanPost(ctx) {
      if (!live()) return never();
      return ui.humanPost(ctx, coach.blindPrompt(ctx.which, ctx.amount));
    },
    humanAction(ctx, game) {
      if (!live()) return never();
      const L = settings.level;
      let prompt;
      if (L === 1) prompt = ctx.canCheck
        ? `<b>Your turn.</b> Check, or push chips forward to bet. My tip is in the ${narrow.matches ? 'Coach tab' : 'coach panel'}.`
        : `<b>Your turn.</b> Push chips forward to call or raise, or fold. My tip is in the ${narrow.matches ? 'Coach tab' : 'coach panel'}.`;
      else if (L === 2) prompt = `<b>Your turn.</b>`;
      else prompt = `Your move.`;
      if (ctx.warnedFold) prompt = `You can check for free. Press <b>Fold</b> again to fold anyway.`;
      const extra = [];
      if (L === 2) extra.push({ label: 'Advice', onClick: () => coach.showAdvice() });
      return ui.humanAction(ctx, prompt, extra);
    },
    dealerStep(ctx) {
      if (!live()) return never();
      return ui.dealerStep(ctx, coach.dealerPrompt(ctx, ctx.game));
    },
  };
}

async function newGame() {
  gen++;
  const myGen = gen;
  const [sb, bb] = settings.blinds.split('/').map(Number);
  const styleKeys = Object.keys(STYLES);
  const names = NAMES.filter(n => n.toLowerCase() !== (settings.name || '').toLowerCase()).sort(() => Math.random() - 0.5);
  const players = [{ name: settings.name || 'You', isHuman: true }];
  for (let i = 1; i < settings.players; i++) players.push({ name: names[i - 1], style: styleKeys[Math.floor(Math.random() * styleKeys.length)] });
  const game = new Game({ players, stack: settings.stack, sb, bb }, makeIO(myGen));
  ui.game = game;
  ui.endStaging();
  ui.clearLog();
  ui.setActions([]);
  ui.coachSay(`${settings.name ? `Welcome to the table, ${escapeHTML(settings.name)}. ` : ''}New game: ${settings.players} players, ${settings.stack} chips each, blinds ${sb}/${bb}. Coaching level: <b>${['', 'Learn', 'Advise', 'Test'][settings.level]}</b>. Tap any <button class="term" data-term="pot">underlined word</button> for its meaning. Tap the pot or anyone's chips to practise counting.`, 'note');
  ui.render();
  while (!game.over && myGen === gen) await game.playHand();
  if (myGen === gen) ui.setActions([{ label: 'New game', cls: 'go', onClick: () => openSetup() }]);
}

// ---------- setup sheet ----------
function openSetup() {
  $('playerName').value = settings.name || '';
  $('nPlayers').value = settings.players; $('nPlayersOut').textContent = settings.players;
  $('startStack').value = settings.stack; $('blinds').value = settings.blinds;
  document.querySelector(`input[name=level][value="${settings.level}"]`).checked = true;
  $('speed').value = settings.speed; $('showTotals').checked = settings.showTotals; $('stepMode').checked = settings.step;
  $('setupClose').hidden = !ui.game;
  ui.open('setup');
}
$('nPlayers').oninput = e => { $('nPlayersOut').textContent = e.target.value; };
$('startBtn').onclick = () => {
  settings.name = $('playerName').value.trim().slice(0, 14);
  settings.players = +$('nPlayers').value;
  settings.stack = +$('startStack').value;
  settings.blinds = $('blinds').value;
  settings.level = +document.querySelector('input[name=level]:checked').value;
  settings.speed = +$('speed').value;
  settings.showTotals = $('showTotals').checked;
  settings.step = $('stepMode').checked;
  saveSettings(settings);
  syncStep();
  $('levelSelect').value = settings.level;
  ui.close('setup');
  newGame();
};

// ---------- header + menu ----------
$('levelSelect').value = settings.level;
$('levelSelect').onchange = e => {
  settings.level = +e.target.value; saveSettings(settings);
  ui.coachSay(`Coaching level changed to <b>${['', 'Learn', 'Advise', 'Test'][settings.level]}</b>. It takes effect from the next step.`, 'note');
};
function syncStep() {
  $('stepBtn').textContent = `Step: ${settings.step ? 'on' : 'off'}`;
  $('stepBtn').classList.toggle('on', settings.step);
}
syncStep();
$('stepBtn').onclick = () => {
  settings.step = !settings.step; saveSettings(settings); syncStep();
  ui.coachSay(settings.step ? 'Step mode on: tap <b>Next move</b> to advance each opponent\'s turn.' : 'Step mode off: opponents play at the chosen speed.', 'note');
};
$('oddsBtn').onclick = () => ui.showRanks();
function openTrainers() {
  $('infoBody').innerHTML = `<h2>Trainers</h2>
    <button class="menu-item trainer-pick" id="tChen"><b>Starting hands</b><span class="muted">Score two cards with the Chen formula and see which seats can play them.</span></button>
    <button class="menu-item trainer-pick" id="tShow"><b>Who wins the showdown?</b><span class="muted">Two to four hands and a full board — pick the winner, then see why.</span></button>`;
  ui.open('info');
  $('tChen').onclick = () => trainer.open();
  $('tShow').onclick = () => sdTrainer.open();
}
$('trainBtn').onclick = openTrainers;
$('mTrain').onclick = () => { ui.close('menu'); trainer.open(); };
$('mShow').onclick = () => { ui.close('menu'); sdTrainer.open(); };
$('chipKey').onclick = () => ui.showChips();
$('menuBtn').onclick = () => ui.open('menu');
$('mNew').onclick = () => { ui.close('menu'); openSetup(); };
$('mGloss').onclick = () => { ui.close('menu'); ui.showGlossary(); };
$('mRanks').onclick = () => { ui.close('menu'); ui.showRanks(); };
$('mChips').onclick = () => { ui.close('menu'); ui.showChips(); };
$('mRules').onclick = () => { ui.close('menu'); ui.showRules(); };

// ---------- asking questions (Claude via the Worker, or the built-in glossary) ----------
async function checkClaude() {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    if (r.ok) Object.assign(ui.claude, await r.json());
  } catch {}
}

$('askBtn').onclick = () => {
  const claude = ui.claude.available;
  $('infoBody').innerHTML = `<h2>Ask a question</h2>
    <p class="muted">${claude ? 'Claude will answer using what you can see at the table (never the other players\' hidden cards).' : 'Claude isn\'t connected yet (the Cloudflare Worker needs an API key), so I\'ll search the built-in glossary.'}</p>
    <textarea id="askQ" rows="3" placeholder="e.g. What's a check-raise? Should I call here?"></textarea>
    ${claude && ui.claude.passcode ? `<input type="password" id="askPass" placeholder="Passcode" value="${localStorage.getItem('poker.pass') || ''}" style="margin-top:6px">` : ''}
    <button class="primary wide" id="askGo">Ask</button>`;
  ui.open('info');
  $('askQ').focus();
  $('askGo').onclick = async () => {
    const q = $('askQ').value.trim();
    if (!q) return;
    ui.close('info');
    ui.coachSay(escapeHTML(q), 'q');
    if (!claude) return glossaryAnswer(q);
    const pass = $('askPass') ? $('askPass').value : '';
    if (pass) localStorage.setItem('poker.pass', pass);
    ui.coachSay('Thinking…', 'note');
    try {
      const r = await fetch('/api/coach', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-coach-passcode': pass },
        body: JSON.stringify({ question: q, state: ui.game ? coach.stateSummary(ui.game) : '(no game in progress)', level: settings.level }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      ui.coachSay(formatClaude(j.answer), 'claude');
    } catch (err) {
      ui.coachSay(`Couldn't reach Claude (${escapeHTML(String(err.message || err))}). Here's what the glossary says:`, 'note');
      glossaryAnswer(q);
    }
  };
};

function glossaryAnswer(q) {
  const words = q.toLowerCase().replace(/[?.!,]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !['what', 'whats', "what's", 'the', 'does', 'mean', 'and', 'how', 'when', 'should', 'is', 'a'].includes(w));
  const seen = new Set(); const hits = [];
  for (const phrase of [q.toLowerCase().replace(/[?.!]/g, '').replace(/^what('s| is| does)? (a |an |the )?/, '').replace(/ mean$/, '').trim(), ...words]) {
    for (const h of searchGlossary(phrase).slice(0, 2)) if (!seen.has(h.term)) { seen.add(h.term); hits.push(h); }
    if (hits.length >= 3) break;
  }
  if (!hits.length) ui.coachSay(`I couldn't find that in the glossary. Try a single word, like "kicker" or "flop".`, 'note');
  else ui.coachSay(hits.slice(0, 3).map(h => `<b style="text-transform:capitalize">${escapeHTML(h.term)}</b> — ${escapeHTML(h.def)}`).join('<br>'), 'advice');
}

function escapeHTML(s) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function formatClaude(t) {
  return escapeHTML(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
}

// ---------- start ----------
checkClaude();

// ---------- phone layout: the coach slides out from the right ----------
const narrow = window.matchMedia('(max-width: 899px)');
const panel = $('coachPanel');
const tab = $('coachTab');
function drawerBounds() {
  // The drawer covers the table only, so your cards and buttons stay usable.
  const top = document.querySelector('.topbar').getBoundingClientRect().bottom + ($('updateBar').hidden ? 0 : $('updateBar').offsetHeight);
  const me = document.querySelector('.me-panel').getBoundingClientRect();
  document.documentElement.style.setProperty('--drawer-top', Math.round(top) + 'px');
  document.documentElement.style.setProperty('--drawer-bottom', Math.round(window.innerHeight - me.top) + 'px');
}
function openDrawer() {
  drawerBounds();
  panel.classList.add('open'); tab.classList.add('hidden');
  ui.unread = 0; ui.alert = false; updateBadge();
  const log = $('coachLog');
  // land on the newest message, from its start
  const last = log.lastElementChild;
  if (last && last.offsetHeight > log.clientHeight - 10) log.scrollTop = last.offsetTop - 6; else log.scrollTop = log.scrollHeight;
}
function closeDrawer() { panel.classList.remove('open'); tab.classList.remove('hidden'); }
function updateBadge() {
  const b = $('coachBadge');
  b.hidden = !ui.unread;
  b.textContent = ui.unread > 9 ? '9+' : ui.unread;
  tab.classList.toggle('alert', !!ui.alert);
}
ui.unread = 0;
ui.onCoachMessage = (kind) => {
  if (!narrow.matches || panel.classList.contains('open')) return;
  if (kind === 'note' || kind === 'q') return;
  ui.unread++;
  if (kind === 'mistake' || kind === 'advice') {
    ui.alert = true;
    tab.classList.remove('nudge'); void tab.offsetWidth; tab.classList.add('nudge');
  }
  updateBadge();
};
tab.onclick = openDrawer;
$('drawerClose').onclick = closeDrawer;
// swipe the drawer to the right to close it, or swipe the tab to the left to open it
let sx = null, sy = null;
const touchStart = e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; };
panel.addEventListener('touchstart', touchStart, { passive: true });
panel.addEventListener('touchend', e => {
  if (sx == null) return;
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
  if (dx > 70 && Math.abs(dy) < 50) closeDrawer();
  sx = null;
});
tab.addEventListener('touchstart', touchStart, { passive: true });
tab.addEventListener('touchend', e => { if (sx != null && e.changedTouches[0].clientX - sx < -30) openDrawer(); sx = null; });
window.addEventListener('resize', () => { if (panel.classList.contains('open')) drawerBounds(); });
narrow.addEventListener('change', () => { if (!narrow.matches) closeDrawer(); });

// ---------- updates ----------
// The app knows its own version; version.json on the server says what's newest.
async function latestVersion() {
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) return (await r.json()).version;
  } catch {}
  return null;
}
async function checkForUpdate(manual = false) {
  const v = await latestVersion();
  if (v && v !== APP_VERSION) {
    $('updateBar').hidden = false;
    if (manual) ui.close('menu');
  } else if (manual) {
    $('versionLabel').textContent = v ? `You're on the latest version (${APP_VERSION}).` : `Couldn't check — are you offline? Version ${APP_VERSION}.`;
  }
}
async function applyUpdate() {
  $('updateBtn').disabled = true; $('updateBtn').textContent = 'Updating…';
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.update();
    for (const k of await caches.keys()) await caches.delete(k);
  } catch {}
  location.reload();
}
$('updateBtn').onclick = () => {
  if (ui.game && !ui.game.over && !confirmUpdate()) return;
  applyUpdate();
};
function confirmUpdate() {
  // Updating restarts the app, so a game in progress would end.
  if ($('updateBtn').dataset.armed) return true;
  $('updateBtn').dataset.armed = '1';
  $('updateBtn').textContent = 'Tap again to end game & update';
  return false;
}
$('updateLater').onclick = () => { $('updateBar').hidden = true; };
$('mUpdate').onclick = () => checkForUpdate(true);
$('versionLabel').textContent = `Version ${APP_VERSION}`;
checkForUpdate();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
setInterval(checkForUpdate, 30 * 60 * 1000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
ui.coachSay(`Welcome! I'll teach you Texas Hold'em and its jargon at a real-feeling table. Words like {{flop}} and {{kicker}} are tappable. Press <b>Deal me in</b> to choose your table.`, 'note');
openSetup();
