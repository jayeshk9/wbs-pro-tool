# WBS Summary Worker

A one-endpoint Cloudflare Worker that turns the WBS report stats into a short
WhatsApp site update using Claude Haiku (the cheapest Claude model, ~$0.001 per
report). It exists only so the Anthropic API key stays server-side — the PDF
itself is shared straight from the browser via the Web Share API.

If this Worker is not deployed (or is unreachable), the app falls back to a
built-in, non-AI digest built from the same data, so the Share button always works.

## Deploy (first time)

1. `cd worker`
2. `npm install`
3. Set the Anthropic key as a secret (prompts for the value, never stored in git):
   ```
   npx wrangler secret put ANTHROPIC_API_KEY
   ```
4. Open `wrangler.jsonc` and set `ALLOWED_ORIGINS` to your app's live origin(s),
   comma-separated, e.g.
   `"https://ajmerestatewbs.web.app,https://ajmerestatewbs.firebaseapp.com"`.
   (During local dev you can leave it `""`.)
5. Deploy:
   ```
   npx wrangler deploy
   ```
   Copy the printed URL (e.g. `https://wbs-summary.<your-subdomain>.workers.dev`).
6. In the app repo, put that URL in `.env.local`:
   ```
   REACT_APP_SUMMARY_API_URL=https://wbs-summary.<your-subdomain>.workers.dev
   ```
   then rebuild/redeploy the app (the value is baked in at build time).

## Local development

- `npm run dev` starts the Worker on `http://localhost:8787`.
- For the key locally, create `worker/.dev.vars` (gitignored):
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  ```
- Point the app at it during dev: `REACT_APP_SUMMARY_API_URL=http://localhost:8787`.

## Cost

Claude Haiku 4.5: $1 / 1M input tokens, $5 / 1M output tokens. A report sends a
few hundred tokens of stats and gets back ~150–250 tokens, so each summary costs
roughly **$0.001** (a tenth of a cent). Cloudflare Workers' free tier (100k
requests/day) covers the hosting.

## Request / response

`POST /` with JSON:
```json
{ "stats": { "project": "...", "date": "09/07/26", "counts": {...}, "completedToday": [...], "stuck": [...] } }
```
Returns:
```json
{ "summary": "*Project — Site Update*\n_09/07/26_\n\n✅ *Completed today (3)* ..." }
```
