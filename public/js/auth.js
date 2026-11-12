// Sign-in: invite-only, 6-digit code by email, no passwords (as in Learn Spanish and Flightroute).
// Shares the Learn Spanish Supabase project; Game Coach's access list is the gc_ tables in it.
// Both values below are public by design; the database rules do the protecting.
// Once signed in, the app opens offline too; the list is re-checked whenever it's online.

const CFG = {
  supabaseUrl: 'https://veoxasldburbztzucyrn.supabase.co',
  supabaseKey: 'sb_publishable_Gwnaqzgzz-Abvn5hiQvhsw_32P5goIo',
};
const AUTH_KEY = 'gamecoach.auth';
const ACCESS_KEY = 'gamecoach.access';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const authOn = !!(CFG.supabaseUrl && CFG.supabaseKey && window.supabase);
const SB = authOn ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_KEY } }) : null;
let access = lsGet(ACCESS_KEY, null);
let gateEmail = '';
let onEnter = null;
let people = null, pendingRemove = null, confirmSignOut = false;

// Never let a slow or missing connection hold the screen up.
const withTimeout = (promise, ms, fallback) => Promise.race([promise, new Promise(r => setTimeout(() => r(fallback), ms))]);
const hasStoredSession = () => { try { return !!localStorage.getItem(AUTH_KEY); } catch { return false; } };
export const signedIn = () => !authOn || !!(access && hasStoredSession());
export const currentAccess = () => access;

function authError(e) {
  const m = String((e && e.message) || e || '');
  if (/rate|too many|security purposes/i.test(m)) return 'Too many codes asked for. Wait a minute, then try again.';
  if (/expired|invalid|token/i.test(m)) return "That code didn't work. Check it, or send a new one.";
  if (/fetch|network|load failed/i.test(m)) return 'No connection. You need the internet to sign in.';
  if (/gc_can_sign_in|function|PGRST202/i.test(m)) return "Sign-in isn't fully set up yet (the access list is missing).";
  return m || 'Something went wrong. Try again.';
}

function buildGate() {
  if ($('gate')) return;
  const g = document.createElement('section');
  g.id = 'gate'; g.className = 'gate'; g.hidden = true;
  g.setAttribute('aria-labelledby', 'gTitle');
  g.innerHTML = `<div class="g-card">
      <div class="g-icons"><img src="icons/icon.svg" alt="" width="52" height="52"><img src="icons/chess.svg" alt="" width="52" height="52"></div>
      <h2 id="gTitle">Sign in to Game Coach</h2>
      <form id="gSend">
        <p>Game Coach is invite-only. Enter your email and we'll send you a 6-digit code. There's no password.</p>
        <label for="gEmail">Email</label>
        <input id="gEmail" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="you@example.com">
        <button class="primary wide" type="submit" id="gSendBtn">Send me a code</button>
      </form>
      <form id="gVerify" hidden>
        <p>We sent a code to <b id="gTo"></b>. It can take a minute, so check your spam folder too.</p>
        <label for="gCode">Code</label>
        <input id="gCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456">
        <button class="primary wide" type="submit" id="gVerifyBtn">Sign in</button>
        <div class="g-row"><button type="button" class="small" id="gResend">Send a new code</button><button type="button" class="small" id="gBack">Use a different email</button></div>
      </form>
      <p class="g-msg" id="gMsg" hidden></p>
    </div>`;
  document.body.appendChild(g);
  $('gSend').addEventListener('submit', e => { e.preventDefault(); sendCode(false); });
  $('gVerify').addEventListener('submit', e => { e.preventDefault(); verifyCode(); });
  $('gResend').onclick = () => sendCode(true);
  $('gBack').onclick = () => { gateMsg(''); showGate('email'); };
}

function gateMsg(t, good) { const m = $('gMsg'); m.hidden = !t; m.textContent = t || ''; m.classList.toggle('good', !!good); }
function showGate(step) {
  buildGate();
  $('gate').hidden = false;
  $('gSend').hidden = step === 'code'; $('gVerify').hidden = step !== 'code';
  if (step === 'code') { $('gTo').textContent = gateEmail; $('gCode').value = ''; setTimeout(() => $('gCode').focus(), 100); }
  else setTimeout(() => $('gEmail').focus(), 100);
}

async function sendCode(again) {
  const email = ($('gEmail').value.trim().toLowerCase()) || gateEmail;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { gateMsg('Enter your full email address.'); return; }
  if (!navigator.onLine) { gateMsg('No connection. You need the internet to sign in.'); return; }
  $('gSendBtn').disabled = true; gateMsg('');
  try {
    const { data: ok, error: e1 } = await SB.rpc('gc_can_sign_in', { p_email: email });
    if (e1) throw e1;
    if (!ok) { gateMsg("This email doesn't have access yet. Ask whoever invited you to add it."); return; }
    const { error } = await SB.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) throw error;
    gateEmail = email; showGate('code'); gateMsg(again ? 'A new code is on its way.' : '', true);
  } catch (e) { gateMsg(authError(e)); }
  finally { $('gSendBtn').disabled = false; }
}

async function verifyCode() {
  const code = $('gCode').value.replace(/\D/g, '');
  if (code.length < 6) { gateMsg('Enter the code from the email.'); return; }
  $('gVerifyBtn').disabled = true; gateMsg('');
  try {
    const { error } = await SB.auth.verifyOtp({ email: gateEmail, token: code, type: 'email' });
    if (error) throw error;
    if (await checkAccess(true)) { $('gate').hidden = true; enter(); }
  } catch (e) { gateMsg(authError(e)); }
  finally { $('gVerifyBtn').disabled = false; }
}

// Is this account on the list? Offline, the last answer stands.
async function checkAccess(fromSignIn) {
  if (!authOn || !hasStoredSession() || !navigator.onLine) return !!access;
  try {
    const [{ data: ok, error: e1 }, { data: admin }] = await Promise.all([SB.rpc('gc_is_allowed'), SB.rpc('gc_is_admin')]);
    if (e1) throw e1;
    if (!ok) {
      access = null; lsSet(ACCESS_KEY, null);
      try { await SB.auth.signOut({ scope: 'local' }); } catch {}
      showGate('email');
      gateMsg(fromSignIn ? "This email doesn't have access." : "Your access to Game Coach has been removed. Ask whoever invited you if that's a mistake.");
      return false;
    }
    const { data: u } = await SB.auth.getUser();
    access = { email: ((u && u.user && u.user.email) || '').toLowerCase(), admin: !!admin };
    lsSet(ACCESS_KEY, access);
    return true;
  } catch (e) {
    if (/JWT|jwt|session|401/.test(String(e && (e.message || e.code)))) { access = null; lsSet(ACCESS_KEY, null); showGate('email'); return false; }
    return !!access; // network trouble: keep the last answer
  }
}

let entered = false;
function enter() { if (entered) return; entered = true; if (onEnter) onEnter(); }

// Call once at start-up: runs `start` straight away if signed in (even offline), otherwise after sign-in.
export function requireSignIn(start) {
  onEnter = start;
  if (!authOn) { enter(); return; }
  if (signedIn()) { enter(); checkAccess(false); }
  else showGate('email');
  SB.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && access) { access = null; lsSet(ACCESS_KEY, null); showGate('email'); } });
  addEventListener('online', () => checkAccess(false));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && access) checkAccess(false); });
}

async function signOut() {
  confirmSignOut = false; access = null; lsSet(ACCESS_KEY, null); people = null;
  try { await SB.auth.signOut({ scope: 'local' }); } catch {}
  try { localStorage.removeItem(AUTH_KEY); } catch {}
  document.querySelectorAll('.sheet').forEach(s => { s.hidden = true; });
  showGate('email'); gateMsg('Signed out.', true);
}

// The account sheet: who you are, sign out, and (for admins) who can use the app.
export async function openAccount(ui) {
  const body = $('infoBody');
  ui.open('info');
  let loading = false;
  const render = (note, bad) => {
    if (!authOn) { body.innerHTML = `<h2>Account</h2><p>Sign-in is switched off, so anyone with the link can use Game Coach.</p>`; return; }
    let html = `<h2>Account</h2><p>Signed in as <b>${esc(access ? access.email : '')}</b>${access && access.admin ? ' (admin)' : ''}.</p>
      <button class="small ${confirmSignOut ? 'danger-btn' : ''}" id="acSignOut">${confirmSignOut ? 'Yes, sign out' : 'Sign out'}</button>`;
    if (access && access.admin) {
      html += `<h3>People who can use Game Coach</h3>`;
      if (!navigator.onLine) html += `<p class="muted">Connect to the internet to see and change the list.</p>`;
      else {
        if (people === null) {
          html += `<p class="muted">Loading the list…</p>`;
          if (!loading) {
            loading = true;
            withTimeout(SB.from('gc_allowed_emails').select('email,is_admin,added_at').order('email'), 10000, { data: null, error: { message: 'network' } })
              .then(({ data, error }) => { loading = false; people = error ? false : data; if (!$('info').hidden) render(error ? authError(error) : '', !!error); });
          }
        } else if (people === false) {
          html += `<p class="muted">Couldn't load the list just now. Close this and try again when you have a better connection.</p>`;
          people = null;
        } else
        html += `<ul class="people">` + people.map(p => `<li><span>${esc(p.email)}${p.is_admin ? ' <em>admin</em>' : ''}${access && p.email === access.email ? ' <em>you</em>' : ''}</span>${access && p.email !== access.email ? `<button class="small ${pendingRemove === p.email ? 'danger-btn' : ''}" data-rm="${esc(p.email)}">${pendingRemove === p.email ? 'Tap again to remove' : 'Remove'}</button>` : ''}</li>`).join('') + `</ul>
          <form class="row" id="acAdd"><input type="email" id="acEmail" placeholder="friend@example.com" autocapitalize="none" spellcheck="false" aria-label="Email to add"><button class="primary" type="submit">Add</button></form>
          <p class="muted">They sign in with a code sent to that email. Removing someone locks them out the next time their app goes online.</p>`;
      }
    }
    if (note) html += `<p class="count-result ${bad ? 'bad' : 'ok'}">${esc(note)}</p>`;
    body.innerHTML = html;
    $('acSignOut').onclick = () => {
      if (!confirmSignOut) { confirmSignOut = true; render(); setTimeout(() => { if (confirmSignOut) { confirmSignOut = false; if (!$('info').hidden) render(); } }, 4000); }
      else signOut();
    };
    body.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
      const email = b.dataset.rm;
      if (pendingRemove !== email) { pendingRemove = email; render(); return; }
      pendingRemove = null;
      const { error } = await SB.from('gc_allowed_emails').delete().eq('email', email);
      people = null; render(error ? authError(error) : `Removed ${email}.`, !!error);
    });
    const f = $('acAdd');
    if (f) f.onsubmit = async e => {
      e.preventDefault();
      const email = $('acEmail').value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { render('Enter a full email address.', true); return; }
      const { error } = await SB.from('gc_allowed_emails').insert({ email, added_by: access.email });
      people = null;
      render(error ? (error.code === '23505' ? `${email} is already on the list.` : authError(error)) : `Added ${email}. They can sign in now.`, !!error);
    };
  };
  render();
  if (navigator.onLine) { await withTimeout(checkAccess(false), 8000); if (!$('info').hidden) render(); }
}
