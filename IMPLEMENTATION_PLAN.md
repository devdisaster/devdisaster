# Implementation Plan — Sentinel

*Every external API shape in this document was verified against live docs/tests on 29–30 Aug 2026 (Stripe changelog/object shapes re-verified 30 Aug). Nothing here is assumed.*

**How to use this document:** the build is organized as **phases**, not hours. Each phase is a self-contained brief — you can open a Devin/Claude Code session, paste the phase (plus §R references it names), and say "implement this." Phases 1–4 run in parallel after Phase 0; Phase 5 (feedback agent, secondary) starts once the Phase 2 spine lands. The clock times in §T are a pacing reference, not the structure.

---

## §0. Architecture

```
Context.dev (monitors + scrape API)
   │ webhook (change.detected, HMAC-signed)   │ cron-pulled scrapes (feedback, secondary)
   ▼                                          ▼
┌─ Convex backend ─────────────────────────────────────────────────────┐
│ http.ts       /webhooks/context + /ingest/errors + /demo/stripe/*    │
│ incidents.ts  normalize triggers, dedupe, enforce state transitions  │
│ docs.ts       retrieve latest docs + run impact diagnosis            │
│ devin.ts      launch only impacted repairs; poll status/tests/PR     │
│ vendor.ts     controlled Stripe gateway + docs mirror (v-flag)       │
│ ingest.ts     scrape + normalize + dedupe feedback posts (secondary) │
│ cluster.ts    Claude assigns post → cluster (secondary)              │
│ threshold.ts  cluster count ≥ N → schedule devin launch (secondary)  │
│ crons.ts      scrape every 10 min + devin poll while active          │
│ schema.ts     products, integrations, reviews, clusters,             │
│               triggerEvents, docChanges, incidents, sessions, events │
└──────────────┬────────────────────────────────────────────────────────┘
               │ useQuery (reactive websocket)
               ▼
   Vite + React + ReactBits Application UI dashboard

InvoicePilot integration failure ──→ Convex shared incident pipeline
Devin ──→ GitHub org: invoicepilot repo → tested PRs (never merge/deploy)
```

### One product, one spine (the design)

| | **InvoicePilot** (full loop) |
|---|---|
| Role in demo | The whole story: a demo billing SaaS whose repo we own, with one registered Stripe integration |
| Primary agent | **Integration Engineer**: Context.dev monitors the controlled Stripe docs mirror; InvoicePilot reports runtime contract failures; both triggers converge on one incident, one impact verdict, one Devin repair PR |
| The breaking change | Replay of Stripe's **real 2022-11-15** upgrade: `charges` removed from PaymentIntent → `latest_charge` (docs.stripe.com/changelog/2022-11-15). Real Stripe test-mode data flows through a thin demo gateway that flips the shape on demand — we say so openly in the demo |
| Secondary agent | **Feedback**: REAL posts on **r/&lt;InvoicePilot&gt;** (created tonight; teammates post real complaints; live on-stage post possible). Backup: public feedback-board page in the invoicepilot app, also genuinely scraped. Final fallback: seed mutation |
| Devin | Enabled — sessions open PRs on `invoicepilot`. Products without a `repo` configured would stop at clustering/alerting (the permission model exists; no observer product in this demo) |

**Repos** (DONE 30 Aug — org is `devdisaster`): Sentinel product code lives in **`devdisaster/devdisaster`** (this repo, alongside the docs — the separate `sentinel` repo was cut); **`devdisaster/invoicepilot`** (public; demo SaaS, Devin's target) exists with smoke-test PRs #1–2 proving the Devin loop.

**Component decisions:** core pipeline = plain actions + crons + `ctx.scheduler`. The Integration Engineer flow uses three logical roles—detection, diagnosis, and repair—but implements them as ordinary Convex functions rather than an agent framework. `@convex-dev/workflow` wraps only the Devin session lifecycle, added after the plain version works. No `@convex-dev/agent`. The dashboard starts from ReactBits Pro Application UI's operations-dashboard pattern rather than a custom layout; it is installed through the required shadcn registry tooling, then wired directly to Convex data.

---

## §R. Shared reference (phases point here)

### R1. Convex schema — commit in Phase 0, this is the parallel-work contract

```ts
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  products: defineTable({
    name: v.string(),
    description: v.string(),           // fed into clustering + Devin prompts
    repo: v.optional(v.string()),      // "org/invoicepilot" — ABSENT = observer mode (no Devin)
    subreddit: v.optional(v.string()),
    feedbackUrl: v.optional(v.string()), // public feedback-board page
    docsUrls: v.array(v.string()),
    threshold: v.number(),
  }),

  integrations: defineTable({          // one InvoicePilot integration for the hackathon
    productId: v.id("products"),
    name: v.string(),                  // "Stripe Payments"
    provider: v.string(),              // "stripe"
    docsUrl: v.string(),               // the controlled docs mirror URL
    endpoint: v.string(),              // "/v1/payment_intents"
    integrationPath: v.string(),       // "src/lib/stripe.ts"
    expectedContract: v.string(),      // concise customer-expected response contract
    activeContractVersion: v.union(v.literal("2022-08-01"), v.literal("2022-11-15")),
    cachedResponse: v.optional(v.any()), // last-good upstream response (wifi fallback)
    testCommand: v.string(),           // "npm test"
    monitorId: v.optional(v.string()),
    enabled: v.boolean(),
  }).index("by_product", ["productId"]).index("by_monitor", ["monitorId"]),

  reviews: defineTable({
    productId: v.id("products"),
    source: v.union(v.literal("reddit"), v.literal("board"), v.literal("seed")),
    author: v.string(),
    rating: v.optional(v.number()),
    text: v.string(),
    url: v.optional(v.string()),
    publishedAt: v.optional(v.string()),
    hash: v.string(),                  // sha256(source+author+text) for dedupe
    clusterId: v.optional(v.id("clusters")),
  }).index("by_hash", ["hash"]).index("by_product", ["productId"]).index("by_cluster", ["clusterId"]),

  clusters: defineTable({
    productId: v.id("products"),
    title: v.string(),                 // "CSV export drops header row"
    summary: v.string(),
    kind: v.union(v.literal("bug"), v.literal("feature_request"), v.literal("other")),
    count: v.number(),
    status: v.union(v.literal("open"), v.literal("triggered"), v.literal("pr_open"), v.literal("dismissed")),
    sessionId: v.optional(v.id("sessions")),
  }).index("by_product", ["productId"]),

  sessions: defineTable({              // Devin agent runs
    productId: v.id("products"),
    trigger: v.union(v.literal("feedback"), v.literal("docs"), v.literal("incident")),
    clusterId: v.optional(v.id("clusters")),
    incidentId: v.optional(v.id("incidents")),
    devinSessionId: v.string(),
    devinUrl: v.string(),
    status: v.string(),                // mirror of status_enum
    testStatus: v.optional(v.union(v.literal("passed"), v.literal("failed"), v.literal("unknown"))),
    testSummary: v.optional(v.string()),
    prUrl: v.optional(v.string()),
    prNumber: v.optional(v.number()),
    prompt: v.string(),
    structuredOutput: v.optional(v.any()),
  }).index("by_devin_id", ["devinSessionId"]).index("by_product", ["productId"]).index("by_incident", ["incidentId"]),

  triggerEvents: defineTable({
    productId: v.id("products"),
    integrationId: v.id("integrations"),
    source: v.union(v.literal("docs"), v.literal("runtime")),
    fingerprint: v.string(),           // integration + endpoint + observed contract version
    summary: v.string(),
    raw: v.any(),
    incidentId: v.optional(v.id("incidents")),
  }).index("by_fingerprint", ["fingerprint"]).index("by_incident", ["incidentId"]),

  docChanges: defineTable({
    productId: v.id("products"),
    integrationId: v.id("integrations"),
    monitorId: v.string(),
    url: v.string(),
    summary: v.string(),
    isBreaking: v.boolean(),
    affectedEndpoints: v.array(v.string()),
    raw: v.any(),
    incidentId: v.optional(v.id("incidents")),
  }).index("by_product", ["productId"]).index("by_incident", ["incidentId"]),

  incidents: defineTable({
    productId: v.id("products"),
    integrationId: v.id("integrations"),
    fingerprint: v.string(),
    title: v.string(),
    status: v.union(
      v.literal("detected"), v.literal("gathering_context"), v.literal("diagnosing"),
      v.literal("not_impacted"), v.literal("needs_review"), v.literal("repair_queued"),
      v.literal("repairing"), v.literal("validating"), v.literal("repair_proposed"),
      v.literal("repair_failed"),
    ),
    diagnosisVerdict: v.optional(v.union(v.literal("impacted"), v.literal("not_impacted"), v.literal("uncertain"))),
    diagnosisReason: v.optional(v.string()),
    affectedEndpoint: v.optional(v.string()),
    diagnosisEvidence: v.optional(v.array(v.string())),
    codeEvidence: v.optional(v.array(v.string())),
    sessionId: v.optional(v.id("sessions")),
  }).index("by_product", ["productId"]).index("by_fingerprint", ["fingerprint"]),

  errors: defineTable({
    productId: v.id("products"),
    integrationId: v.id("integrations"),
    message: v.string(),
    stack: v.optional(v.string()),
    endpoint: v.optional(v.string()),
    statusCode: v.optional(v.number()),
    contractVersion: v.optional(v.string()),
    fingerprint: v.string(),
    incidentId: v.optional(v.id("incidents")),
  }).index("by_product", ["productId"]).index("by_incident", ["incidentId"]),

  events: defineTable({                // war-room feed — EVERY state change posts here
    productId: v.id("products"),
    incidentId: v.optional(v.id("incidents")),
    sentinel: v.string(),              // "integration" | "feedback" | "system"
    message: v.string(),
    level: v.union(v.literal("info"), v.literal("warn"), v.literal("critical")),
  }).index("by_product", ["productId"]).index("by_incident", ["incidentId"]),
});
```

### R2. Devin API (verified)

Launch — `POST https://api.devin.ai/v1/sessions`, header `Authorization: Bearer $DEVIN_API_KEY`:

```json
{
  "prompt": "<see R3>",
  "idempotent": true,
  "max_acu_limit": 5,
  "title": "Sentinel: <incident/cluster title>",
  "structured_output_schema": {
    "type": "object",
    "properties": { "pr_url": {"type": "string"}, "summary": {"type": "string"}, "root_cause": {"type": "string"}, "tests_passed": {"type": "boolean"}, "test_summary": {"type": "string"} }
  }
}
```
→ `{ "session_id": "devin-xxx", "url": "https://app.devin.ai/sessions/xxx", "is_new_session": true }`

Poll — `GET https://api.devin.ai/v1/sessions/{id}` → `status_enum` (`working|blocked|finished|expired|...`), `pull_request?.url`, `structured_output`. Poll every 15–30s while sessions active. No outbound webhook — polling is the documented pattern.

Nudge when `blocked` — `POST /v1/session/{id}/message` (**singular `session` — verified live 30 Aug**; the plural path 405s) `{"message": "Proceed with your best judgment."}`.

### R3. Devin prompt templates

**API-maintenance repair (primary).** Launch only when the linked incident has `diagnosisVerdict: "impacted"`:

```
You are repairing a broken third-party API integration in the repository {org}/{repo}.
Work on a new branch and open a pull request. Never merge or deploy.

## Product context
{product.description}

## Incident: {incident.title}
Trigger source(s): {docs change | runtime failure | both}
Provider: {integration.provider} — endpoint {integration.endpoint}
Registered integration path: {integration.integrationPath}
Expected contract (what the code assumes today): {integration.expectedContract}

## What changed (from the provider's docs, retrieved {timestamp})
{Context.dev change summary + latest docs excerpt + docs URL}
Affected element: {affectedEndpoint / field / version}

## Runtime evidence (if present)
{sanitized error message, endpoint, status code, observed contract version}

## Diagnosis
{diagnosisReason + codeEvidence lines citing the adapter's usage of the changed field}

## Task
1. Inspect {integration.integrationPath} and confirm the diagnosis.
2. Make the smallest integration-only change so the code works with the new contract.
   Do not refactor unrelated code. Do not touch the vendor or its docs.
3. Update or add a regression test covering the NEW contract shape (fixture provided in evidence).
4. Run: {integration.testCommand}
5. Open a PR titled "fix: {incident.title}" citing this incident's evidence in the body.
6. Report pr_url, summary, root_cause, tests_passed, test_summary in your structured output.

If the evidence is insufficient or the code is not actually affected, report that instead of forcing a patch.
```

**Feedback fix (secondary):**

```
You are fixing a bug in the repository {org}/{repo}. Work on a new branch and open a pull request.

## Product context
{product.description}

## Evidence: {count} user complaints, clustered as "{cluster.title}"
{for each review: "- [{source}, {rating}★] {text}"}

## Task
1. Reproduce/locate the issue described above in the codebase.
2. Implement a minimal, safe fix. Do not refactor unrelated code.
3. Run the test suite if present (see README/AGENTS.md for commands).
4. Open a PR titled "fix: {cluster.title}" with a body that cites the user complaints.
5. Report pr_url, summary, and root_cause in your structured output.

Keep the diff small. If you cannot find the bug, open a draft PR documenting your investigation instead.
```

### R4. Context.dev scraping API (verified) — feedback agent only

`GET https://api.context.dev/v1/web/scrape/markdown?url=...` — header `Authorization: Bearer $CONTEXT_API_KEY`. Params: `country` (proxy), `waitForMs`, `maxAgeMs` (0 = fresh), `useMainContentOnly`. Docs: https://docs.context.dev/api-reference

Verified per-source recipes:
- **Reddit** (InvoicePilot): `url=https://www.reddit.com/r/{subreddit}/new/` (fresh subreddit — no search term needed) → Context auto-routes to old.reddit, full post bodies. Extract via Claude (R6).
- **Feedback board** (backup source): plain scrape of the board page URL in the deployed invoicepilot app.
- Demo scrapes: `maxAgeMs=0`. Background cron: default caching fine.

### R5. Context.dev monitors (verified via MCP contract; REST under same base — see docs "Monitors")

Create once for the controlled Stripe docs mirror (Phase 2):

```json
{
  "name": "stripe-api-docs",
  "mode": "web",
  "target": { "type": "page", "url": "https://{deployment}.convex.site/demo/stripe/docs",
    "instructions": "Report changes to API endpoints, versions, parameters, or response fields (added, renamed, or removed attributes). Ignore cosmetic or wording-only changes." },
  "change_detection": { "type": "semantic", "confidence_threshold": 0.7 },
  "schedule": { "type": "interval", "frequency": 10, "unit": "minutes" },
  "webhook": { "url": "https://{deployment}.convex.site/webhooks/context", "events": ["change.detected"] }
}
```

The minimum interval is 10 minutes, so use **run-monitor-now** for the on-demand demo. Webhook signature: header `X-Context-Signature: t=<unix>,v1=<hmac>`, HMAC-SHA256 over `"{t}.{rawBody}"` keyed by the `secret` returned at creation; verify with constant-time compare and reject stale timestamps.

### R6. Claude calls (Anthropic API, model `claude-haiku-4-5`)

**API impact diagnosis** (primary, Phase 2): combine the proactive docs diff or reactive error with the `integrations` row, the latest docs retrieved through Context.dev, and the current contents of the configured integration file from InvoicePilot's public GitHub repo. Return `{verdict: "impacted"|"not_impacted"|"uncertain", confidence, summary, affectedEndpoints[], contractChange, codeEvidence[], evidence[]}`. Before the model call, deterministically check whether the changed endpoint/version overlaps the registered endpoint; after the call, require evidence naming both the changed contract element (e.g. `charges` removed from PaymentIntent) and matching code usage (e.g. `pi.charges.data[0]` in `src/lib/stripe.ts`). If the configured file cannot be retrieved, return `uncertain` instead of guessing. `not_impacted` stops without Devin, `uncertain` becomes `needs_review`, and only `impacted` schedules a repair.

**Extraction** (secondary; Reddit/board markdown → posts): "Extract user complaints/reviews from this page content as JSON: `[{author, rating?, text, url?, publishedAt?}]`. Only actual user feedback, not marketing copy."

**Clustering** (secondary; per new post):
```
System: You triage user complaints for {product.name}: {product.description}.
User: Existing clusters: {[{id, title, summary}] or "none"}
New complaint: "{review.text}" ({source}, rating {rating})
Return JSON: {"action": "attach"|"create"|"ignore", "clusterId": "...",
"title": "...", "summary": "...", "kind": "bug"|"feature_request"|"other"}
"ignore" = praise/noise/not actionable.
```
Apply result in one mutation: attach/create, increment count, threshold check → schedule `devin.launch` (only if product has `repo`), flip status, post `events` row.

### R7. Env vars (per Convex deployment, set via dashboard)

`DEVIN_API_KEY` · `ANTHROPIC_API_KEY` · `CONTEXT_API_KEY` · `CONTEXT_WEBHOOK_SECRET` (after Phase 2 creates the monitor) · `STRIPE_SECRET_KEY` (test-mode `sk_test_...`, server-side in the gateway only — never in the invoicepilot repo) · `SENTINEL_INGEST_TOKEN` (shared only with InvoicePilot) · `GITHUB_ORG` (name only, no token needed—Devin's GitHub App handles repo access).

### R8. Shared incident flow (Integration Engineer spine)

Both ingress paths call the same `incidents.receiveTrigger` mutation:

```
Context docs webhook ─┐
                      ├─→ detected → gathering_context → diagnosing
Runtime failure ──────┘                                  │
                         ┌────────────────────────────────┼──────────────────────┐
                         ▼                                ▼                      ▼
                    not_impacted                    needs_review          repair_queued
                                                                               │
                                                                               ▼
                                                                          repairing
                                                                               │
                                                                               ▼
                                                                          validating
                                                                    ┌──────────┴──────────┐
                                                                    ▼                     ▼
                                                              repair_failed        repair_proposed
```

1. Normalize the input into `triggerEvents`; sanitize runtime payloads before storage.
2. Find or create an incident using `integrationId + affected endpoint + observed contract version` as the fingerprint. The gateway stamps every response with a `Stripe-Version` header and the docs mirror names the version, so docs and runtime triggers for 2022-11-15 converge deterministically. If the other trigger already opened the incident, attach evidence rather than launching a second repair.
3. Load the integration registration, retrieve the latest docs via Context.dev, and fetch only the configured integration file from InvoicePilot's public GitHub repo. Store the evidence needed for the incident, not an unnecessary second knowledge system or full repo index.
4. Run R6 diagnosis against the changed contract and actual code usage. `not_impacted` stops, `uncertain` requires human review, and `impacted` schedules Devin.
5. Build the R3 evidence packet and launch Devin. Poll status into `sessions`; record test outcome and PR metadata.
6. A finished run with a PR becomes `repair_proposed`, not `resolved`. Human review/merge is the default, and Sentinel never auto-deploys.
7. Write an `events` row for every transition so the dashboard can render one auditable incident timeline.

### R9. Controlled Stripe gateway + docs mirror (the vendor we can break on demand)

The demo replays a breaking change Stripe **actually shipped** — API version **2022-11-15** removed the `charges` attribute from PaymentIntent; integrations must use `latest_charge` instead (docs.stripe.com/changelog/2022-11-15). Real Stripe test-mode data flows through; only the response *shape* is pinned by our flag. Framing for judges: "Stripe test mode behind a demo gateway so we can replay the real 2022-11-15 upgrade on stage."

**Routes (Convex HTTP actions, public):**
- `POST /demo/stripe/v1/payment_intents` and `GET /demo/stripe/v1/payment_intents/{id}` — forward to `https://api.stripe.com` with `$STRIPE_SECRET_KEY` and `expand[]=latest_charge`, then shape per the integration row's `activeContractVersion`:
  - **`2022-08-01`** (old shape): embed the expanded charge as `"charges": {"object": "list", "data": [<charge>], "has_more": false}`; omit `latest_charge`.
  - **`2022-11-15`** (new shape): omit `charges`; include `"latest_charge": "<charge id>"` (string id, not expanded) — exactly how the real upgrade landed.
  - Stamp the response header `Stripe-Version: <active version>` (Stripe sets this header on real responses; the adapter reports it as the observed contract version).
  - On upstream failure, serve `cachedResponse` (shaped per flag) so vendor/wifi availability never controls the demo; refresh `cachedResponse` on every good call.
- `GET /demo/stripe/docs` — renders the PaymentIntent object reference section + changelog for the active version. The 2022-11-15 render adds the changelog entry "Removes the `charges` attribute from the PaymentIntent object — use `latest_charge` instead" and drops `charges` from the attribute list. Keep the page content faithful to the real Stripe docs wording.

**Demo mutations (exercise real handlers, never edit incident state directly):** `vendor.resetV1` (back to `2022-08-01`), `vendor.upgradeV2` (flip to `2022-11-15`) — one flag flips endpoint and docs together.

**What breaks in InvoicePilot:** `src/lib/stripe.ts` reads `pi.charges.data[0].receipt_url` and `.status` to mark invoices paid and link receipts. Under `2022-11-15` that path is `undefined` → the adapter's runtime validation throws a contract error → sanitized report to `/ingest/errors` with endpoint + observed `Stripe-Version`. **The fix Devin ships:** read `latest_charge`, fetch the charge (`GET /v1/charges/{id}` through the gateway) or use the expanded form, plus a regression test against a 2022-11-15 fixture.

---

## §P. Phases

Dependency graph: **P0 → (P1 ∥ P2 ∥ P3 ∥ P4) → P5(secondary) → P6 → P7(stretch)**. P2 and P3 share the Stripe contract from R1/R9: P2 owns the gateway/docs mirror and incident spine; P3 owns InvoicePilot's adapter/error reporting/tests. Stub their typed boundary in P0 so both proceed in parallel. P1's live test needs P3's repo to exist (use a README-only repo created in P0). P2's repair step needs P1's `devin.launch`.

---

### Phase 0 — Foundation *(all together, one laptop drives; ref ~10:30–11:15)*

**Objective:** one repo, four laptops building in parallel with a shared contract.

**Pre-work status (completed 30 Aug):**
- ✅ Org `devdisaster`; repos `devdisaster` (Sentinel code + docs, `sentinel` repo cut), `invoicepilot` (public), `landing`
- ✅ All 4 API keys verified live via `./setup/verify-keys.sh` (keys in local `.env`, gitignored; template in `.env.example`)
- ✅ Devin GitHub App installed org-wide **and** `@devdisaster` connected in Devin Settings → Connections → GitHub (BOTH are required — see §K)
- ✅ Devin loop proven end-to-end: smoke-test PRs invoicepilot#1 (LICENSE) and #2 (README) opened by real API-launched sessions
- ⏳ r/InvoicePilot subreddit + test post; ReactBits Pro license confirmation

**Deliverables**
1. ~~GitHub org repos~~ DONE (see pre-work). Product name locked: **InvoicePilot**.
2. Scaffold Convex (Vite + React) **inside `devdisaster/devdisaster`** → pushed. Everyone clones; each runs `npx convex dev` (personal dev deployment); hot reload verified on all 3 laptops.
3. **`convex/schema.ts` exactly as R1** + stub files with exported, typed, `throw new Error("todo")` function signatures: `incidents.ts`, `docs.ts`, `devin.ts`, `vendor.ts`, `http.ts`, `ingest.ts`, `cluster.ts`, `threshold.ts`, `crons.ts`, `seed.ts`. Committed and pushed before anyone splits off.
4. Env vars (R7) set in every dev deployment + prod (values are in local `.env`; verify anytime with `./setup/verify-keys.sh` — already passed 30 Aug including the raw Stripe PaymentIntent call).
5. Confirm the team has a ReactBits Pro or Ultimate license. Run `npx shadcn@latest init` because ReactBits Application UI uses the shadcn registry protocol, register `@reactbits-pro` in `components.json` per the official installation guide, then install the operations dashboard with `npx shadcn@latest add @reactbits-pro/dashboard-4`. Keep the license key only in local `.env.local`; never commit it. Do not install extra templates until Dashboard 4 is wired.
6. One product row inserted (via a `seed.setupProducts` mutation): InvoicePilot (repo `devdisaster/invoicepilot`, subreddit `InvoicePilot`, feedbackUrl placeholder, threshold 5). Insert one `integrations` row: provider `stripe`, endpoint `/v1/payment_intents`, docs URL = the mirror route, integrationPath `src/lib/stripe.ts`, expectedContract (the 2022-08-01 shape summary), `activeContractVersion: "2022-08-01"`, testCommand `npm test`.

**Acceptance:** all 3 laptops render the ReactBits Dashboard 4 scaffold against their own deployment; `schema.ts` + stubs are on main; the product row and the single Stripe integration row are visible in the Convex data browser; the raw Stripe test call succeeded; no license key is tracked by Git.

---

### Phase 1 — Devin engine *(COMPLETE 30 Aug 2026; Iyad)*

**Objective:** a Convex-triggered Devin session that ends with a PR URL in the `sessions` table. This is the highest-risk phase — validate the loop with a trivial session FIRST.

**Prereqs:** P0. Uses R2, R3.

**Deliverables**
1. `devin.launch` internalAction: builds an R3 prompt from an already-impacted API incident or cluster evidence, POSTs R2 launch, writes `sessions` + `events`. Guard: skip and log if the product has no repo; for API maintenance, also reject any incident not in `repair_queued` with `diagnosisVerdict: "impacted"`.
2. `devin.poll` internalAction on a 20s cron (only while any session `status ∈ {working, blocked, resumed}`): GET status, update the run, and capture structured test outcome plus `pull_request.url`. API runs advance `repairing → validating → repair_proposed` only when a PR exists and tests pass; a missing PR or failed test becomes `repair_failed`. Feedback runs update the linked cluster. Auto-nudge on `blocked` (R2).
3. `threshold.check` mutation (consumed by P5): on cluster count increment, if `count >= product.threshold && status === "open"` → set `triggered`, post event, `ctx.scheduler.runAfter(0, internal.devin.launch, ...)`.
4. **Smoke test (do this before building 2–3):** manually run `devin.launch` with prompt "Add a LICENSE file to {org}/invoicepilot and open a PR" → confirm PR URL lands in the table. **This is the 12:00 hard checkpoint.**
5. After 1–4 work: wrap launch→poll→record in `@convex-dev/workflow` (durable retries; the "Convex Workflow orchestrates Devin" judging point).
6. Admin mutation `forceThreshold(clusterId)` for demo control.

**Files:** `convex/devin.ts`, `convex/threshold.ts`, `convex/crons.ts`, `convex/convex.config.ts` (workflow component).

**Acceptance:** an incident hand-set to `repair_queued`/`impacted` (or 5 fake reviews in one cluster) fires a real Devin session with zero manual steps; PR URL appears in the dashboard data; a product without a repo never launches Devin.

**Verified 30 Aug 2026:** complete. Convex launched and persisted smoke session `devin-f2529143497b45168444b3406f740c28` ([session](https://app.devin.ai/sessions/f2529143497b45168444b3406f740c28)), which opened unmerged documentation-only [invoicepilot PR #3](https://github.com/devdisaster/invoicepilot/pull/3). The real `forceThreshold → threshold.check → devin.launch → workflow` path opened unmerged [invoicepilot PR #4](https://github.com/devdisaster/invoicepilot/pull/4); a repeated force call created no duplicate session. Polling persisted PR metadata, structured output, and test evidence; observer-mode and ineligible-incident launch guards were verified; a passing incident fixture advanced through `validating` to `repair_proposed`. `npm run lint`, `npm run build`, and `npx convex dev --once` passed against the personal development deployment. Neither repair PR was merged or deployed.

---

### Phase 2 — Integration Engineer spine *(PRIMARY; Shashwat owns gateway/ingest, Iyad owns incidents/diagnosis after P1 core lands; ref 11:15–14:00)*

**Objective:** proactive docs changes and reactive integration failures enter one incident flow that proves customer-code impact before Devin opens a tested repair PR. **This is the product.**

**Prereqs:** P0; P1 `devin.launch` for the repair step (build up to the gate in parallel before it lands); P3 adapter path + regression test (stubbed boundary from P0). Uses R5, R6, R8, R9.

**Deliverables**
1. Build the R9 controlled Stripe gateway routes: `POST/GET /demo/stripe/v1/payment_intents[...]` forwarding to real Stripe test mode and shaping per `activeContractVersion`, with `Stripe-Version` response header and `cachedResponse` fallback; `GET /demo/stripe/docs` rendering the matching contract; `vendor.resetV1` / `vendor.upgradeV2` mutations.
2. `POST /webhooks/context`: verify `X-Context-Signature` HMAC (R5), resolve the integration by `monitorId`, persist `docChanges` + a `docs` trigger event, then call `incidents.receiveTrigger`.
3. `POST /ingest/errors`: require `Authorization: Bearer $SENTINEL_INGEST_TOKEN`; accept `productId`, `integrationId`, endpoint, observed contract version, message, optional stack/status code; strip headers, request bodies, and query values, enforce a small payload limit, then persist `errors` + a `runtime` trigger event and call the same `incidents.receiveTrigger`. No general log pipeline or spike detector in core.
4. `incidents.receiveTrigger`: dedupe using the R8 fingerprint, create or attach to an incident, and emit every state transition to `events`. A second trigger adds evidence and never launches a duplicate repair.
5. `docs.gatherAndDiagnose`: retrieve the latest docs through Context.dev and the configured integration file from InvoicePilot's public GitHub repo; combine those with the trigger, registered endpoint/contract/path, and existing evidence, then run R6 impact diagnosis. Do not crawl or index the repository.
6. Apply the impact gate: `not_impacted` stops; `uncertain` becomes `needs_review`; `impacted` becomes `repair_queued` and schedules `devin.launch` with the R3 API-maintenance packet.
7. Extend `devin.poll` to save test results and PR metadata and advance the incident through `repairing → validating → repair_proposed`. Never merge or deploy.
8. Create one Context.dev monitor for the controlled docs mirror (R5), store its ID on the `integrations` row, and store its webhook secret in the environment. Dashboard controls may reset v1, activate the 2022-11-15 upgrade, run the monitor now, and call the InvoicePilot integration, but must exercise real handlers rather than directly editing incident state.

**Files:** `convex/http.ts`, `convex/vendor.ts`, `convex/incidents.ts`, `convex/docs.ts`, `convex/devin.ts`, monitor-creation script or dashboard notes.

**Acceptance (the 14:00 primary checkpoint):** flipping to 2022-11-15 and running the monitor produces `detected → gathering_context → diagnosing → repair_queued → repairing → validating → repair_proposed`, with diagnosis evidence citing both the removed `charges` field and the adapter line that reads it, a passing regression test, and a real Devin PR. Running the broken integration independently enters the same flow; running it during the proactive incident attaches evidence without creating a second session.

---

### Phase 3 — Demo assets: InvoicePilot repo *(Ash, driven through Devin chat; ref 11:15–14:30)*

**Objective:** everything Devin fixes and the gateway serves for the InvoicePilot story. Built by prompting Devin interactively—which is itself demo-able meaningful Devin usage.

**Prereqs:** P0 (repo exists). Coordinate feedback bug wording with Phase 5 and the Stripe contract with Phase 2 (R9).

**Deliverables**
1. Devin scaffolds `invoicepilot`: small Vite/Next billing app—invoices, CSV export, and "collect payment" through one isolated `src/lib/stripe.ts` adapter that calls the R9 gateway (base URL from env). The adapter creates/retrieves PaymentIntents and reads `charges.data[0]` for receipt URL + paid status (the 2022-08-01 shape). Include a strong `README.md` + `AGENTS.md` with run/test commands. The Stripe secret key lives only in Sentinel's gateway — InvoicePilot never holds it.
2. Plant two small feedback bugs for the Feedback agent (CSV header row dropped, and one optional form bug); do not add more. The API-maintenance story uses the separate contract break — never mix the two.
3. Wrap the adapter with runtime validation/error handling. On contract failure (missing `charges`), send a sanitized event to Sentinel's `/ingest/errors` (endpoint, observed `Stripe-Version`, message); show a stable user-facing error rather than crashing the app.
4. Add adapter tests with a 2022-08-01 fixture and clear test command (`npm test`). The Devin incident packet supplies the 2022-11-15 docs/response evidence and requires a 2022-11-15 regression test in the repair PR.
5. Keep the **feedback board** as a backup Feedback-agent source, publicly reachable through the deployed app.
6. Deploy InvoicePilot (and confirm Sentinel's Convex HTTP routes are public) so the app, controlled gateway, docs mirror, and feedback board have stable public URLs.
7. Draft submission answers, the 3-minute script (§D), disclosure list, and backup-video shot list.

**Acceptance:** InvoicePilot builds and deploys; feedback bugs reproduce; payment collection works under 2022-08-01; activating 2022-11-15 causes a real, captured adapter failure; the docs mirror reflects the upgrade; and a cold Devin session given the incident packet can patch the adapter, add the regression test, pass the suite, and open a PR without touching the vendor.

---

### Phase 4 — Dashboard *(Moein; ref 11:15–15:00)*

**Objective:** adapt ReactBits Application UI into the live demo surface — integration-first, instead of designing dashboard chrome from scratch.

**Prereqs:** P0 has installed ReactBits Pro `dashboard-4`, the operations-dashboard template with a service status board and incident list. Build against hand-inserted rows first; every data region becomes a Convex `useQuery` so P1–P3 results appear without refresh.

**Deliverables**
1. Preserve the ReactBits app shell, responsive layout, spacing, typography, status treatments, and card/list primitives. Remove example branding and static demo metrics; do not build a second design system or add charts without useful data.
2. **Hero = integration health.** Adapt the template's service status board into the integration summary: provider, endpoint, active contract version, monitor status, last check, current incident state.
3. **Primary view = API incidents** with trigger source(s), impact verdict, repair state, and PR status. **Secondary tab = Feedback clusters** with threshold/status.
4. Add one detail drawer using the installed primitives for the auditable incident timeline: trigger received → context gathered → impact evidence (docs excerpt + cited adapter lines) → Devin state → test result → PR link. The same drawer shows complaint evidence for feedback clusters without adding another route.
5. Add the onboarding form for product/repo/feedback fields and one optional API integration. Use the installed ReactBits/shadcn primitives; install another Application UI block only if the form cannot be assembled quickly from what Dashboard 4 already provides.
6. Add restrained demo controls: Reset vendor (v2022-08-01) · Upgrade vendor (v2022-11-15) · Run monitor now · Run integration · Scan now · Seed complaints · Force threshold. Keep them visually separated from normal product actions.
7. Replace every template array/placeholder with Convex data or an explicit empty/loading state. Treat `useQuery === undefined` as loading and preserve the template's responsive behavior.

**Files:** installed ReactBits source under `src/` plus the dashboard page and small data-mapping components; no backend files.

**Acceptance:** Dashboard 4's original sample data is gone; everything renders from Convex; a stranger can follow docs change → impact verdict → tests → repair PR (and complaint → cluster → Devin → PR in the secondary tab); mobile/desktop layouts remain usable; no ReactBits license credential is bundled or committed.

---

### Phase 5 — Feedback agent *(SECONDARY; Shashwat after the P2 spine lands; ref 14:00–15:30)*

**Objective:** real complaints from InvoicePilot's real sources, clustered by Claude, feeding Phase 1's threshold check. **Explicit cut line: if this is behind at 15:00, ship `seed.demoComplaints` + `forceThreshold` and rehearse that path instead — the primary story must never be starved.**

**Prereqs:** P0; P1 `threshold.check`; P3 subreddit + feedback board exist. Uses R4, R6.

**Deliverables**
1. `ingest.scrapeSource` action per source recipe in R4 (reddit | board), storing raw results.
2. Extraction via Claude (R6). Normalize to `reviews` rows; dedupe on `hash` (skip existing before clustering — protects against re-scrapes).
3. `cluster.assign` action per new review (R6 clustering prompt) + `cluster.apply` mutation (atomic attach/create/increment → calls `threshold.check` from P1).
4. `crons.interval("scrape-all", {minutes: 10}, ...)` over the product's configured sources + public `scanNow(productId)` mutation for the dashboard button.
5. **Real-data pass:** teammates post 5–8 real complaint posts on r/&lt;InvoicePilot&gt; describing the planted bugs (coordinate wording with Phase 3's bug list); confirm scrape → extract → cluster works. If Reddit auto-filters the new subreddit, switch to the feedback board (P3.5) — same pipeline, different URL.
6. `seed.demoComplaints` mutation (~25 synthetic complaints matching planted bugs) — final fallback only.

**Files:** `convex/ingest.ts`, `convex/cluster.ts`, `convex/crons.ts`, `convex/seed.ts`.

**Acceptance:** "Scan now" pulls the real subreddit posts and clusters them into the planted-bug clusters; the CSV cluster crossing 5/5 launches a real Devin fix PR; re-running scrapes creates zero duplicates.

---

### Phase 6 — Integration + demo hardening *(everyone; ref 15:15–16:30)*

**Objective:** the demo cannot fail twice in a row.

**Prereqs:** P1–P4 (P5 or its seeded fallback).

**Deliverables**
1. Pick ONE deployment as demo-prod (`npx convex deploy` or a designated dev deployment); env vars + monitor pointed at it.
2. Two full end-to-end rehearsals: reset vendor → upgrade to 2022-11-15 → run monitor → signed webhook → impact verdict with cited evidence → Devin session → passing regression test + repair PR → run InvoicePilot's payment flow and verify the genuine runtime failure attaches to the same incident. Then the feedback beat: post (or seed) → cluster → threshold → Devin PR.
3. Pre-warm strategy: launch a real API-repair session about 30 minutes before judging so a **finished tested PR** exists to show; the live-triggered one runs during the talk. Keep the best rehearsal PR as backup evidence.
4. Record backup video (rules allow it).
5. Verify `cachedResponse` fallback works with wifi off (airplane-mode test on the gateway path).
6. **16:30: submit.** Deadline 17:00 is strict.

**Acceptance:** rehearsal #2 runs without touching code; submission form complete.

---

### Phase 7 — Reactive incident hardening *(STRETCH — only if P1–P5 green at the 15:00 checkpoint)*

**Objective:** add production-style grouping and presentation on top of Phase 2's already-working runtime-failure trigger.

**Prereqs:** P2 shared incident flow, P3 InvoicePilot deployed, P4 dashboard.

**Deliverables**
1. Group repeated runtime events by integration and fingerprint; show count and first/last seen without creating additional incidents or Devin sessions.
2. Add an optional spike policy (for example, 10 matching failures in 2 minutes) as a severity escalation only. It must not bypass diagnosis or the impact gate.
3. Add a red incident banner and clearer live feed treatment for confirmed runtime impact.
4. Add a safe demo control that calls the changed Stripe integration and surfaces its genuine failure; do not add a generic flag that makes unrelated application code throw.

**Acceptance:** repeated calls to the broken integration update one incident in real time, preserve the docs evidence and diagnosis, and produce at most one repair session.

---

## §T. Reference timeline (pacing, not structure)

| Clock | What |
|---|---|
| 10:00–10:30 | Registration. Ash: submission link, credit redemption, verify Stripe test keys work from venue network |
| 10:30–11:15 | **Phase 0** (all together) |
| 11:15–14:00 | **P1→P2 (Iyad) ∥ P2 gateway/ingest (Shashwat) ∥ P4 (Moein) ∥ P3 (Ash + Devin chat)** |
| 12:00 | **Hard checkpoint: P1.4 smoke test** — Devin PR from a Convex action. Broken = lunch-table topic #1 |
| 12:30–13:00 | Lunch + status sync |
| 14:00 | **Primary checkpoint: P2 acceptance** — docs change → impact verdict → Devin repair PR, end to end. Broken = all hands on it, P5 stays seeded |
| 14:00–15:30 | **P5 feedback agent (Shashwat)** ∥ others polish P2–P4 |
| 15:00 | **Checkpoint: all green → Phase 7; P5 behind → cut to seeds + forceThreshold** |
| 15:15–16:30 | **Phase 6** |
| 16:30 | **SUBMIT** (17:00 strict) |

## §D. Demo script (3 min)

1. **(0:00)** "Your product is a bundle of other people's APIs — and any of them can break you with a docs page. In 2022 Stripe removed `charges` from PaymentIntent. Thousands of integrations broke. We built the engineer that catches that — and ships the fix." **Open on InvoicePilot working**: invoices, payments collecting, dashboard green, integration health showing Stripe on 2022-08-01.
2. **(0:30)** **The vendor upgrades.** Click Upgrade vendor → the docs mirror now shows the 2022-11-15 changelog → Run monitor now → Context.dev's signed webhook lands → incident appears: `detected → gathering_context → diagnosing`. The timeline names the removed `charges` field **and cites the exact adapter line in the repo that reads it**. Verdict: `impacted`. "It doesn't patch every docs change — it proves impact first."
3. **(1:15)** Devin session card appears automatically. Cut to the pre-warmed session's **open PR on GitHub**: adapter diff (`charges.data[0]` → `latest_charge`), new regression test, suite green, PR body citing the docs evidence. Incident: `repair_proposed`. "Docs change to reviewable, tested fix — zero humans. And it never merges; that's ours."
4. **(2:00)** **The runtime confirms.** Collect a payment in InvoicePilot → the genuine adapter failure appears as a second trigger on the same incident — corroborating evidence, not a duplicate repair. "Proactive and reactive, one spine."
5. **(2:25)** **Second act:** post a real complaint on r/&lt;InvoicePilot&gt; (or show this morning's real posts) → Scan now → clustering live → "CSV export broken" hits 5/5 → Devin session card → cut to the feedback fix PR citing the users' own words. "Same orchestration, different signal."
6. **(2:50)** "Context.dev is the senses, Convex is the control plane, and Devin is the hands: detect, understand, contextualize, validate, remediate. The output is a reviewable PR—not an automatic deployment."

## §K. Risks

| Risk | Mitigation |
|---|---|
| Devin slow/stuck during judging | Pre-warmed finished PR; live session runs in background; backup video; rehearsal PR as exhibit |
| Devin key/plan issue | Verified 30 Aug via `setup/verify-keys.sh` (all 4 keys, live calls) |
| Devin GitHub App uninstall/reinstall | Reinstalling on GitHub alone is NOT enough — Devin reports `push:false` until the org is re-added under Devin Settings → Connections → GitHub. Hit + fixed 30 Aug; re-verify with a smoke PR after any integration change |
| Stripe test key blocked / venue network kills upstream calls | `cachedResponse` fallback in the gateway (verified in P6 airplane-mode test); raw-curl verification at registration |
| Gateway shaping drifts from real Stripe shapes | R9 shapes copied from the real 2022-11-15 changelog + object reference; sanity-check against docs.stripe.com during P2 |
| New subreddit auto-filtered | Aged account creates it tonight + test post tonight; backup = feedback board (P3.5, same pipeline); final fallback = seeds — affects the secondary agent only |
| Venue wifi kills live scraping | InvoicePilot reddit posts made in the morning; board reachable; seeds |
| ReactBits Pro registry/license unavailable | Verify Pro/Ultimate access before Phase 0; install Dashboard 4 immediately; never commit the local license key |
| Threshold doesn't fire on stage | `forceThreshold` admin button |
| Devin fixes the wrong thing | Isolated `stripe.ts` adapter, explicit before/after contract evidence, required regression test, minimal-diff prompt, two rehearsals |
| Docs change is irrelevant | Deterministic endpoint overlap + structured impact verdict; `not_impacted` stops before Devin |
| Proactive and reactive triggers duplicate work | Shared fingerprint and one incident/session guard; second trigger only appends evidence |
| Context monitor is slow during judging | Pre-run a real monitor event; keep Run Monitor Now control, persisted incident timeline, and backup video |
| Devin `blocked` mid-session | Auto-nudge (P1.2) |
| Merge conflicts | Schema+stubs first; phases own disjoint files; frequent small pushes |
| Time overrun | Cut P7 entirely; cut P5 to seeds + forceThreshold; the P2 spine is never cut |

## §C. Cost guards

`max_acu_limit: 5` per session, ~4–8 sessions all day — within credits. `claude-haiku-4-5` for extraction/clustering/diagnosis (~fractions of a cent). Context: `maxAgeMs=0` only for demo moments; one monitor at 10-min interval; 15k event credits ample. Stripe test mode is free. Convex free tier: poll cron runs only while sessions active.
