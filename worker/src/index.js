// Cloudflare Worker — turns a small WBS report-stats JSON into a short WhatsApp
// site update via Claude Haiku (the cheapest Claude model). This is the ONLY
// backend piece: it holds the Anthropic API key as a secret so it never ships
// in the browser bundle. Delivery of the PDF stays fully client-side (Web Share).
//
// Setup:
//   1. cd worker && npm install
//   2. npx wrangler secret put ANTHROPIC_API_KEY      (paste your key)
//   3. set ALLOWED_ORIGINS in wrangler.jsonc to your app's origin(s)
//   4. (optional) npx wrangler secret put WBS_SHARE_KEY  — a shared token; if set,
//      the app must send it as the x-wbs-key header (set REACT_APP_SUMMARY_KEY to match)
//   5. npx wrangler deploy                            (copy the printed URL)
//   6. put that URL in the app's .env.local as REACT_APP_SUMMARY_API_URL
//
// Cost is bounded per request: the body is size-capped and the task lists are
// trimmed before they reach the model, and output is capped at 400 tokens.
// CORS is NOT a security control (non-browser clients ignore it) — for a
// public-facing key add a Cloudflare Rate Limiting rule / WAF in the dashboard.

const MODEL = 'claude-haiku-4-5';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MAX_BODY_CHARS = 16000; // reject oversized payloads up front
const MAX_ITEMS = 80;         // cap each task list so prompt tokens stay bounded

const SYSTEM_PROMPT = `You write short daily WhatsApp status updates for construction site supervisors, from structured project data (JSON).

Hard rules:
- Use ONLY the data provided. NEVER invent tasks, names, numbers, dates, deviations, or reasons. If a field is missing, say so plainly.
- Output plain text formatted for WhatsApp: *bold* for headings, "•" for bullets. No markdown headings (#), no code fences, no tables.

Structure exactly:
Line 1: *<project> — Site Update*
Line 2: _<date>_
(blank line)
✅ *Completed today (N)*
 • one bullet per completed task: "<path › task name> — <deviation> [<assignees>]". Use the deviation string exactly as given (e.g. "+2d late", "on time", "1d early"). If there are none, a single bullet "• None".
(blank line)
⛔ *Stuck (N)*
 • one bullet per stuck task: "<path › task name> — <reason from remarks> [<assignees>]". If a task has no remark, write "no remark added". If there are none, a single bullet "• None".
(blank line)
One final line: the single most important thing to watch (the worst slip or the longest-stuck task). One sentence.

Keep the whole message under ~900 characters. Be terse. Do not add anything not present in the data.`;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);

    // Optional shared-token gate (defense-in-depth against random scanners).
    if (env.WBS_SHARE_KEY && request.headers.get('x-wbs-key') !== env.WBS_SHARE_KEY) {
      return json({ error: 'unauthorized' }, 401, cors);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return json({ error: 'payload too large' }, 413, cors);

    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'invalid json' }, 400, cors); }
    const stats = body && body.stats;
    if (!stats || typeof stats !== 'object') return json({ error: 'missing stats' }, 400, cors);
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'server not configured (no ANTHROPIC_API_KEY)' }, 500, cors);

    // Bound the prompt regardless of what the client sent.
    const trim = (arr) => (Array.isArray(arr) ? arr.slice(0, MAX_ITEMS) : []);
    const safeStats = {
      project: String(stats.project || '').slice(0, 200),
      date: String(stats.date || '').slice(0, 40),
      counts: stats.counts && typeof stats.counts === 'object' ? stats.counts : {},
      completedToday: trim(stats.completedToday),
      stuck: trim(stats.stuck),
    };

    try {
      const r = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 400,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: 'Project report data (JSON):\n' + JSON.stringify(safeStats) }],
        }),
      });

      if (!r.ok) {
        const detail = await r.text();
        return json({ error: 'anthropic error', status: r.status, detail }, 502, cors);
      }

      const data = await r.json();
      const summary = (data.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();

      return json({ summary }, 200, cors);
    } catch (err) {
      return json({ error: 'request failed', detail: String(err) }, 502, cors);
    }
  },
};

// CORS: allow the configured app origin(s). With ALLOWED_ORIGINS unset (local dev),
// fall back to "*" so wrangler dev / localhost work without extra config. Note CORS
// only affects browsers — it is not an access control for scripted clients.
function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-wbs-key',
    'Vary': 'Origin',
  };
  if (allowed.length === 0) h['Access-Control-Allow-Origin'] = '*';
  else if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
