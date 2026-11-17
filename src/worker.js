// Cloudflare Worker: serves the app (static files in /public) and an optional
// /api/coach endpoint that asks Claude a question about the current hand.
//
// Secrets (set in the Cloudflare dashboard → Worker → Settings → Variables and secrets):
//   ANTHROPIC_API_KEY  – required for "Ask a question" to use Claude
//   COACH_PASSCODE     – optional; if set, the app must send it to use /api/coach

const SYSTEM = `You are a friendly, expert poker coach inside a practice app that teaches a beginner No-Limit Texas Hold'em and, above all, its jargon.
- Use British English. Be concise: normally under 150 words. Plain text, short paragraphs; **bold** is allowed.
- Wrap standard poker terms in double curly braces so the app can make them tappable, e.g. {{flop}}, {{pot odds}}, {{check-raise}}, {{kicker}}. Only wrap genuine poker terms.
- You are given what the player can see at the table. You never know opponents' hidden cards — reason from their actions.
- If asked what to do, give a clear recommendation and the reasoning (hand strength, draws/outs, pot odds, position, opponents' actions).
- If asked about rules or procedure (dealing, burning, blinds, who acts first, when a betting round ends), explain precisely.`;

export { PokerRoom } from './room.js';

// ---------- who's asking? (invite-only, same list as the app's sign-in) ----------
const userCache = new Map(); // token -> { email, until }
async function verifyUser(token, env) {
  if (env.DEV_SKIP_AUTH === '1') return 'dev@local';
  if (!token) return null;
  const hit = userCache.get(token);
  if (hit && hit.until > Date.now()) return hit.email;
  const base = env.SUPABASE_URL, key = env.SUPABASE_KEY;
  try {
    const u = await fetch(`${base}/auth/v1/user`, { headers: { apikey: key, authorization: `Bearer ${token}` } });
    if (!u.ok) return null;
    const user = await u.json();
    const ok = await fetch(`${base}/rest/v1/rpc/gc_is_allowed`, { method: 'POST', headers: { apikey: key, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
    if (!ok.ok || (await ok.json()) !== true) return null;
    const email = (user.email || '').toLowerCase();
    userCache.set(token, { email, until: Date.now() + 5 * 60 * 1000 });
    if (userCache.size > 500) userCache.clear();
    return email;
  } catch { return null; }
}
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L to confuse
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), b => CODE_CHARS[b % CODE_CHARS.length]).join('');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---------- online poker tables ----------
    if (url.pathname === '/api/room' && request.method === 'POST') {
      const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
      const email = await verifyUser(token, env);
      if (!email) return json({ error: 'Please sign in again.' }, 401);
      let body; try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
      const st = body.settings || {};
      const settings = {
        players: Math.max(2, Math.min(9, +st.players || 6)),
        stack: [500, 1000, 1500, 2000].includes(+st.stack) ? +st.stack : 1000,
        sb: [5, 10, 25].includes(+st.sb) ? +st.sb : 5, bb: [10, 20, 50].includes(+st.bb) ? +st.bb : 10,
      };
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const r = await stub.fetch('https://room/init', { method: 'POST', body: JSON.stringify({ code, settings, clientId: body.clientId }) });
        if (r.ok) return json({ code });
      }
      return json({ error: 'Could not make a table, try again.' }, 500);
    }
    const m = url.pathname.match(/^\/api\/room\/([A-Z0-9]{4,6})\/ws$/i);
    if (m) {
      const email = await verifyUser(url.searchParams.get('token') || '', env);
      if (!email) return new Response('Please sign in again.', { status: 401 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1].toUpperCase()));
      const headers = new Headers(request.headers); headers.set('x-email', email);
      return stub.fetch(new Request('https://room/ws', { headers }));
    }

    if (url.pathname === '/api/health') {
      return json({ available: !!env.ANTHROPIC_API_KEY, passcode: !!env.COACH_PASSCODE });
    }

    if (url.pathname === '/api/coach') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      if (!env.ANTHROPIC_API_KEY) return json({ error: 'Claude is not configured on this Worker' }, 503);
      if (env.COACH_PASSCODE && request.headers.get('x-coach-passcode') !== env.COACH_PASSCODE) {
        return json({ error: 'Wrong passcode' }, 401);
      }
      let body;
      try { body = await request.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
      const question = String(body.question || '').slice(0, 1000);
      const state = String(body.state || '').slice(0, 4000);
      if (!question) return json({ error: 'No question' }, 400);

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: env.CLAUDE_MODEL || 'claude-sonnet-5-5',
          max_tokens: 600,
          system: SYSTEM,
          messages: [{ role: 'user', content: `Table state (what I can see):\n${state}\n\nMy question: ${question}` }],
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: data?.error?.message || `Claude API error ${r.status}` }, 502);
      const answer = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      return json({ answer });
    }

    return env.ASSETS.fetch(request);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
