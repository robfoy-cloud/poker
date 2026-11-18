// "Ask a question" for any game: Claude answers (through the Worker) when it's set up and you're
// online; otherwise the game's built-in glossary does its best.

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STOP = new Set(['what', 'whats', "what's", 'is', 'are', 'a', 'an', 'the', 'does', 'do', 'mean', 'means', 'meaning', 'by', 'of', 'and', 'how', 'when', 'why', 'should', 'i', 'me', 'my', 'you', 'it', 'this', 'that', 'in', 'on', 'to', 'can', 'please', 'explain', 'word', 'term', 'tell', 'about', 'with', 'for']);

// hooks: { ui, game, title, say(html, kind), search(q) -> [{term, def}], state() -> text }
export function openAsk(h) {
  const claude = h.ui.claude && h.ui.claude.available && navigator.onLine;
  $('infoBody').innerHTML = `<h2 class="${h.titleClass || ''}">Ask a question</h2>
    <p class="muted">${claude ? 'Claude answers using what you can see in the game right now.' : 'I\'ll answer from the built-in glossary. (Claude can answer anything once the Worker has an API key and you\'re online.)'}</p>
    <textarea id="askQ" rows="3" placeholder="${esc(h.placeholder || "e.g. What does 'pips' mean?")}"></textarea>
    ${claude && h.ui.claude.passcode ? `<input type="password" id="askPass" placeholder="Passcode" value="${esc(localStorage.getItem('poker.pass') || '')}" style="margin-top:6px">` : ''}
    <button class="primary wide ${h.buttonClass || ''}" id="askGo">Ask</button>`;
  h.ui.open('info');
  setTimeout(() => $('askQ').focus(), 50);
  $('askGo').onclick = async () => {
    const q = $('askQ').value.trim();
    if (!q) return;
    const pass = $('askPass') ? $('askPass').value : '';
    h.ui.close('info');
    h.say(esc(q), 'q');
    if (!claude) return glossaryAnswer(h, q);
    if (pass) localStorage.setItem('poker.pass', pass);
    h.say('Thinking…', 'note');
    try {
      const r = await fetch('/api/coach', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-coach-passcode': pass },
        body: JSON.stringify({ game: h.game, question: q, state: h.state ? h.state() : '' }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.status);
      h.say(esc(j.answer).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/&#123;|\{\{/g, '{{').replace(/\n/g, '<br>'), 'claude');
    } catch (e) {
      h.say(`Couldn't reach Claude (${esc(String(e.message || e))}). Here's what the glossary says:`, 'note');
      glossaryAnswer(h, q);
    }
  };
}

// Find the glossary entries the question is most likely about.
export function glossaryAnswer(h, q) {
  const clean = q.toLowerCase().replace(/[?!.,"'“”‘’]/g, ' ');
  const words = clean.split(/\s+/).filter(w => w && !STOP.has(w));
  const tries = [words.join(' ')];
  for (let n = Math.min(3, words.length); n >= 1; n--) for (let i = 0; i + n <= words.length; i++) tries.push(words.slice(i, i + n).join(' '));
  const seen = new Set(), hits = [];
  for (const t of tries) {
    if (!t) continue;
    const variants = [t, t.replace(/s$/, ''), t.replace(/ing$/, ''), t.replace(/ed$/, '')];
    for (const v of variants) {
      const res = h.search(v);
      const exact = res.filter(r => r.term === v);
      for (const r of [...exact, ...res.filter(r => r.term.includes(v))].slice(0, 2)) if (!seen.has(r.term)) { seen.add(r.term); hits.push(r); }
    }
    if (hits.length >= 3) break;
  }
  if (!hits.length) for (const r of h.search(words[0] || '').slice(0, 2)) hits.push(r);
  if (!hits.length) return h.say(`I couldn't find that in the glossary. Try a single word, like "${h.example || 'blot'}".`, 'note');
  h.say(hits.slice(0, 3).map(x => `<b style="text-transform:capitalize">${esc(x.term)}</b> — ${esc(x.def)}`).join('<br><br>'), 'advice');
}
