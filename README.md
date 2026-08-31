# Kevin (not Devin)

Kevin is an autonomous integration engineer. It watches a third-party API provider's
documentation for breaking changes, **proves** the change actually breaks your code —
citing the changed contract element and the exact lines of your adapter that use it —
and only then launches a [Devin](https://devin.ai) session that patches the adapter,
adds a regression test, runs your test suite, and opens a pull request.

Kevin never merges and never deploys. Self-healing ends at a green-tested, reviewable
PR; a human always makes the call to ship.

Built at the Collabute × TheBlock hackathon (Dubai, Aug 2026) on
[Convex](https://convex.dev), [Context.dev](https://context.dev), and Devin.

## The demo story

The demo replays a breaking change OpenAI actually shipped: with the o-series models
(September 2024), requests sending `max_tokens` to `/v1/chat/completions` started
failing with

```json
{"error":{"message":"Unsupported parameter: 'max_tokens' is not supported with this
model. Use 'max_completion_tokens' instead.","type":"invalid_request_error",
"param":"max_tokens","code":"unsupported_parameter"}}
```

This genuinely broke LangChain, Zed, Ollama, n8n, and dozens of other integrations.

The customer is [InvoicePilot](https://github.com/devdisaster/invoicepilot), a small
billing SaaS that drafts invoices from pasted emails using OpenAI chat completions.
Its adapter (`src/lib/openai.ts`) sends `max_tokens: 256` on every request — the
planted bug Kevin finds and Devin fixes.

The demo's contract versions (`2026-06-12` → `2026-08-28`) are dated to the present
so the dashboard reads naturally; the replayed change itself is OpenAI's real
September-2024 deprecation.

## How a repair happens

1. **Detect** — the watched docs page ships the 2026-08-28 contract: `max_tokens`
   becomes deprecated, `max_completion_tokens` replaces it. A docs scan picks up the
   change and opens an incident.
2. **Gather** — Kevin retrieves the latest docs through the Context.dev scrape API and
   pulls the registered integration file straight from the customer repo. No full-repo
   index — only the file that owns the contract.
3. **Diagnose** — Claude compares the changed contract against the code and must cite
   both sides: the changed element *and* the exact code line (`    max_tokens: 256,`).
   A verdict of `impacted` without citations is downgraded to `uncertain` and routed
   to human review. Only `impacted` proceeds.
4. **Corroborate** — when the runtime failure arrives too (the real 400 from the
   gateway), it attaches to the same incident by fingerprint instead of spawning a
   duplicate repair.
5. **Repair** — a Devin session gets the full evidence packet, patches the adapter on
   a branch, adds a regression test, runs `npm test`, and opens a PR. Kevin polls the
   session and marks the incident `repair_proposed` only when the PR exists **and**
   tests pass.

Every state transition streams live into the dashboard over Convex reactive queries.

## What's real vs. simulated

| Piece | Status |
|---|---|
| Docs retrieval (Context.dev scrape API) | **Real** |
| Claude diagnosis with citation enforcement | **Real** — `claude-haiku-4-5` over live-fetched docs + code |
| Devin sessions and the PRs on InvoicePilot | **Real** — see the repo's closed PRs |
| Incident spine, fingerprint dedupe, durable polling workflow | **Real** |
| Signed `/webhooks/context` endpoint (HMAC, replay protection) | **Real code, dormant** — see below |
| The vendor ("OpenAI") | **Simulated** — a docs mirror + gateway hosted by this app replay the real change; the 400 above is byte-for-byte OpenAI's |
| Change detection | **Scripted scan in demo mode** — a real Context.dev monitor is the intended path; the demo account is at its monitor cap |

To upgrade detection to a real Context.dev monitor: create a monitor on the docs
mirror URL with a webhook to `${CONVEX_SITE_URL}/webhooks/context`, set the returned
signing secret with `npx convex env set CONTEXT_WEBHOOK_SECRET …`, and stamp the id
with `npx convex run seed:registerMonitor '{"monitorId": "mon_…"}'`. The handler
already verifies `X-Context-Signature` (HMAC-SHA256, constant-time compare, 5-minute
replay window).

## Running it

```sh
npm install
npm run dev            # convex dev + vite
```

Server-side keys live in the Convex deployment env, not in a local file:

```sh
npx convex env set ANTHROPIC_API_KEY sk-ant-...   # diagnosis
npx convex env set CONTEXT_API_KEY ctxt_...       # docs scraping
npx convex env set DEVIN_API_KEY apk_...          # repairs
npx convex env set SENTINEL_INGEST_TOKEN $(openssl rand -hex 24)  # runtime ingest
```

Seed the demo product and integration:

```sh
npx convex run seed:setupProducts
```

### Demo run-book

```sh
SITE=https://<your-deployment>.convex.site

# Ship the breaking change (or click the button on the docs mirror page)
curl -X POST $SITE/demo/openai/docs -H 'Content-Type: application/json' \
  -d '{"version":"2026-08-28"}'

# Watch the dashboard: detected → diagnosing → impacted → Devin → PR

# Optional: fire the runtime failure; it attaches to the same incident
npx convex run demo:runIntegration

# Reset everything between runs
npx convex run demo:resetDemo
```

## Repo layout

- `convex/` — the whole backend: `incidents.ts` (state machine + webhook + ingest),
  `docs.ts` (retrieval + diagnosis), `devin.ts` (session lifecycle + durable
  workflow), `vendor.ts` (docs mirror + gateway), `demo.ts`, `seed.ts`, `dashboard.ts`
- `src/components/kevin-dashboard.tsx` — the dashboard SPA (Vite + React + shadcn/ui)
- `docs/` — hackathon planning documents, kept for the archaeology
- [devdisaster/invoicepilot](https://github.com/devdisaster/invoicepilot) — the
  customer app Devin repairs

## Why "Kevin (not Devin)"?

Devin writes the fix. Kevin is the engineer who notices something broke, proves it,
assembles the evidence, and *then* calls Devin — and never pretends the judgment call
at the end isn't yours.
