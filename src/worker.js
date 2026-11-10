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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
