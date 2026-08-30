# Implementation Plan — Sentinel

*Every external API shape in this document was verified against live docs/tests on 29 Aug 2026. Nothing here is assumed.*

**How to use this document:** the build is organized as **phases**, not hours. Each phase is a self-contained brief — you can open a Devin/Claude Code session, paste the phase (plus §R references it names), and say "implement this." Phases 1–5 run in parallel after Phase 0. The clock times in §T are a pacing reference, not the structure.

---

## §0. Architecture

```
Context.dev (scrape API + monitors)
   │ cron-pulled scrapes                  │ webhook (change.detected, HMAC-signed)
   ▼                                      ▼
┌─ Convex backend ─────────────────────────────────────────────────────┐
│ crons.ts      scrape sources every 10 min (+ "Scan now")             │
│ ingest.ts     normalize + dedupe reviews                             │
│ cluster.ts    Claude assigns review → cluster                        │
│ threshold.ts  cluster count ≥ N → schedule devin launch              │
│ http.ts       /webhooks/context + /ingest/errors                     │
│ incidents.ts  normalize triggers, dedupe, enforce state transitions  │
│ docs.ts       retrieve latest docs + run impact diagnosis            │
│ devin.ts      launch only impacted repairs; poll status/tests/PR     │
│ schema.ts     products, integrations, reviews, clusters,             │
│               triggerEvents, incidents, sessions, events             │
└──────────────┬────────────────────────────────────────────────────────┘
               │ useQuery (reactive websocket)
               ▼
   Vite + React + ReactBits Application UI dashboard

Acme integration failure ──→ Convex shared incident pipeline
Devin ──→ GitHub org: acme-invoicing repo → tested PRs (never merge/deploy)
```

### Two products, one pipeline (the real-data design)

| | **Revolut** (observer mode) | **Acme Invoicing** (full loop) |
|---|---|---|
| Role in demo | Opens the demo: "this is Sentinel on a real business" | The end-to-end story through to Devin's PR |
| Feedback sources | REAL: Trustpilot (`country: "us"` proxy), Play Store, r/Revolut — all verified scrapeable today | REAL: **r/&lt;AcmeName&gt;** (created tonight, teammates post real complaints; live on-stage post possible). Backup: public feedback-board page in acme repo, also genuinely scraped. Final fallback: seed mutation |
| API maintenance | — | One controlled PayFlow rates contract backed by real Frankfurter data; Context.dev monitors its docs, and Acme reports runtime contract failures into the same incident flow |
| Devin | Disabled — product row has no `repo` configured. Pipeline stops at clustering/alerting | Enabled — sessions open PRs on `acme-invoicing` |
| Why it exists | Kills "this only works on staged data"; same code path, just a config row | Proves the closed loop |

**Repos** (create at the event; org decided tonight): `sentinel` (product + controlled PayFlow routes) and `acme-invoicing` (demo SaaS, Devin's target, Devin GitHub App installed).

**Component decisions:** core pipeline = plain actions + crons + `ctx.scheduler`. The API-maintenance flow uses three logical roles—detection, diagnosis, and repair—but implements them as ordinary Convex functions rather than an agent framework. `@convex-dev/workflow` wraps only the Devin session lifecycle, added after the plain version works. No `@convex-dev/agent`. The dashboard starts from ReactBits Pro Application UI's operations-dashboard pattern rather than a custom layout; it is installed through the required shadcn registry tooling, then wired directly to Convex data.

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
    repo: v.optional(v.string()),      // "org/acme-invoicing" — ABSENT = observer mode (no Devin)
    playStoreId: v.optional(v.string()),
    trustpilotDomain: v.optional(v.string()),
    subreddit: v.optional(v.string()),
    feedbackUrl: v.optional(v.string()), // backup feedback-board page (Acme)
    docsUrls: v.array(v.string()),
    threshold: v.number(),
  }),

  integrations: defineTable({          // one Acme integration for the hackathon
    productId: v.id("products"),
    name: v.string(),                  // "PayFlow Currency Rates"
    provider: v.string(),
    docsUrl: v.string(),
    endpoint: v.string(),
    integrationPath: v.string(),       // expected customer-code location
    expectedContract: v.string(),      // concise customer-expected response contract
    activeContractVersion: v.union(v.literal("v1"), v.literal("v2")),
    cachedEurRate: v.optional(v.number()),
    testCommand: v.string(),
    monitorId: v.optional(v.string()),
    enabled: v.boolean(),
  }).index("by_product", ["productId"]).index("by_monitor", ["monitorId"]),

  reviews: defineTable({
    productId: v.id("products"),
    source: v.union(v.literal("play"), v.literal("trustpilot"), v.literal("reddit"),
                    v.literal("board"), v.literal("seed")),
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
    sentinel: v.string(),              // "feedback" | "docs" | "incident" | "system"
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
  "title": "Sentinel: <cluster title>",
  "structured_output_schema": {
    "type": "object",
    "properties": { "pr_url": {"type": "string"}, "summary": {"type": "string"}, "root_cause": {"type": "string"}, "tests_passed": {"type": "boolean"}, "test_summary": {"type": "string"} }
  }
}
```
→ `{ "session_id": "devin-xxx", "url": "https://app.devin.ai/sessions/xxx", "is_new_session": true }`

Poll — `GET https://api.devin.ai/v1/sessions/{id}` → `status_enum` (`working|blocked|finished|expired|...`), `pull_request?.url`, `structured_output`. Poll every 15–30s while sessions active. No outbound webhook — polling is the documented pattern.

Nudge when `blocked` — `POST /v1/sessions/{id}/message` `{"message": "Proceed with your best judgment."}`.

### R3. Devin prompt template

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

API-maintenance variant: launch only when the linked incident has `diagnosisVerdict: "impacted"`. Replace Evidence with the incident packet: trigger source(s), sanitized runtime error if present, Context.dev change summary, latest docs excerpt/URL, affected endpoint/schema/version, registered integration path and expected contract, diagnosis reason, expected behavior, and test command. Instruct Devin to inspect the repository, make the smallest integration-only change, update or add a regression test, run the named test command, and open a PR. Explicitly prohibit merge and deployment. If the evidence is insufficient or the code is not affected, report that instead of forcing a patch.

### R4. Context.dev scraping API (verified)

`GET https://api.context.dev/v1/web/scrape/markdown?url=...` — header `Authorization: Bearer $CONTEXT_API_KEY`. Params: `country` (proxy), `waitForMs`, `maxAgeMs` (0 = fresh), `useMainContentOnly`. Docs: https://docs.context.dev/api-reference

Verified per-source recipes:
- **Trustpilot** (Revolut): `url=https://www.trustpilot.com/review/revolut.com`, **`country=us` required** (Cloudflare otherwise), `waitForMs=5000`. **Parse `metadata.jsonLd`** — contains ~20 structured reviews (`reviewBody`, `reviewRating.ratingValue`, `datePublished`, `author.name`). Do not parse the markdown.
- **Play Store** (Revolut): `url=https://play.google.com/store/apps/details?id=com.revolut.revolut&hl=en`, `waitForMs=3000` → markdown contains recent reviews + dev replies. Extract via Claude (R6).
- **Reddit** (both products): `url=https://www.reddit.com/r/{subreddit}/search/?q=bug&restrict_sr=1&sort=new` (for Acme's fresh subreddit use `/r/{sub}/new/` instead — no search term needed) → Context auto-routes to old.reddit, full post bodies. Extract via Claude (R6).
- **Feedback board** (Acme backup): plain scrape of the board page URL.
- Demo scrapes: `maxAgeMs=0`. Background cron: default caching fine.

### R5. Context.dev monitors (verified via MCP contract; REST under same base — see docs "Monitors")

Create once per docs URL (Phase 3):

```json
{
  "name": "payflow-api-docs",
  "mode": "web",
  "target": { "type": "page", "url": "https://{deployment}.convex.site/demo/vendor/docs",
    "instructions": "Report changes to API endpoints, versions, parameters, or response fields. Ignore cosmetic or wording-only changes." },
  "change_detection": { "type": "semantic", "confidence_threshold": 0.7 },
  "schedule": { "type": "interval", "frequency": 10, "unit": "minutes" },
  "webhook": { "url": "https://{deployment}.convex.site/webhooks/context", "events": ["change.detected"] }
}
```

Use one monitor for the controlled PayFlow docs. The minimum interval is 10 minutes, so use **run-monitor-now** for the on-demand demo. Webhook signature: header `X-Context-Signature: t=<unix>,v1=<hmac>`, HMAC-SHA256 over `"{t}.{rawBody}"` keyed by the `secret` returned at creation; verify with constant-time compare and reject stale timestamps.

### R6. Claude calls (Anthropic API, model `claude-haiku-4-5`)

**Extraction** (Play/Reddit markdown → reviews): "Extract user complaints/reviews from this page content as JSON: `[{author, rating?, text, url?, publishedAt?}]`. Only actual user feedback, not marketing copy."

**Clustering** (per new review):
```
System: You triage user complaints for {product.name}: {product.description}.
User: Existing clusters: {[{id, title, summary}] or "none"}
New complaint: "{review.text}" ({source}, rating {rating})
Return JSON: {"action": "attach"|"create"|"ignore", "clusterId": "...",
"title": "...", "summary": "...", "kind": "bug"|"feature_request"|"other"}
"ignore" = praise/noise/not actionable.
```
Apply result in one mutation: attach/create, increment count, threshold check → schedule `devin.launch` (only if product has `repo`), flip status, post `events` row.

**API impact diagnosis** (Phase 3): combine the proactive docs diff or reactive error with the `integrations` row, the latest docs retrieved through Context.dev, and the current contents of the configured integration file from Acme's public GitHub repo. Return `{verdict: "impacted"|"not_impacted"|"uncertain", confidence, summary, affectedEndpoints[], contractChange, codeEvidence[], evidence[]}`. Before the model call, deterministically check whether the changed endpoint/version overlaps the registered endpoint; after the call, require evidence naming both the changed contract element and matching code usage. If the configured file cannot be retrieved, return `uncertain` instead of guessing. `not_impacted` stops without Devin, `uncertain` becomes `needs_review`, and only `impacted` schedules a repair.

### R7. Env vars (per Convex deployment, set via dashboard)

`DEVIN_API_KEY` · `ANTHROPIC_API_KEY` · `CONTEXT_API_KEY` · `CONTEXT_WEBHOOK_SECRET` (after Phase 3 creates monitors) · `SENTINEL_INGEST_TOKEN` (shared only with Acme) · `GITHUB_ORG` (name only, no token needed—Devin's GitHub App handles repo access). Frankfurter needs **no key**.

### R8. Shared API-maintenance incident flow

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
2. Find or create an incident using `integrationId + affected endpoint + observed contract version` as the fingerprint. Both PayFlow responses include a version, so docs and runtime triggers for v2 converge deterministically. If the other trigger already opened the incident, attach evidence rather than launching a second repair.
3. Load the integration registration, retrieve the latest docs via Context.dev, and fetch only the configured integration file from Acme's public GitHub repo. Store the evidence needed for the incident, not an unnecessary second knowledge system or full repo index.
4. Run R6 diagnosis against the changed contract and actual code usage. `not_impacted` stops, `uncertain` requires human review, and `impacted` schedules Devin.
5. Build the R3 evidence packet and launch Devin. Poll status into `sessions`; record test outcome and PR metadata.
6. A finished run with a PR becomes `repair_proposed`, not `resolved`. Human review/merge is the default, and Sentinel never auto-deploys.
7. Write an `events` row for every transition so the dashboard can render one auditable incident timeline.

---

## §P. Phases

Dependency graph: **P0 → (P1 ∥ P2 ∥ P3 ∥ P4 ∥ P5) → P6 → P7(stretch)**. P3 and P5 share the PayFlow contract from R1/R8: P3 owns the controlled API/docs and incident spine; P5 owns Acme's adapter/error reporting/tests. Stub their typed boundary in P0 so both proceed in parallel. P1's live test needs P5's repo to exist (use a README-only repo created in P0).

---

### Phase 0 — Foundation *(all together, one laptop drives; ref ~10:30–11:15)*

**Objective:** one repo, four laptops building in parallel with a shared contract.

**Deliverables**
1. GitHub org repos created: `sentinel`, `acme-invoicing` (README-only for now). Devin GitHub App covers both (installed org-wide tonight).
2. `npm create convex@latest sentinel` (Vite + React) → pushed. Everyone clones; each runs `npx convex dev` (personal dev deployment); hot reload verified on all 3 laptops.
3. **`convex/schema.ts` exactly as R1** + stub files with exported, typed, `throw new Error("todo")` function signatures: `ingest.ts`, `cluster.ts`, `threshold.ts`, `incidents.ts`, `docs.ts`, `devin.ts`, `http.ts`, `crons.ts`, `seed.ts`. Committed and pushed before anyone splits off.
4. Env vars (R7) set in every dev deployment + prod.
5. Confirm the team has a ReactBits Pro or Ultimate license. Run `npx shadcn@latest init` because ReactBits Application UI uses the shadcn registry protocol, register `@reactbits-pro` in `components.json` per the official installation guide, then install the operations dashboard with `npx shadcn@latest add @reactbits-pro/dashboard-4`. Keep the license key only in local `.env.local`; never commit it. Do not install extra templates until Dashboard 4 is wired.
6. Two product rows inserted (via a `seed.setupProducts` mutation): Revolut (observer — playStoreId `com.revolut.revolut`, trustpilotDomain `revolut.com`, subreddit `Revolut`, **no repo**) and Acme Invoicing (repo `org/acme-invoicing`, subreddit `<AcmeName>`, threshold 5). Insert one Acme `integrations` row with the controlled rates endpoint, docs URL placeholder, expected response contract, integration path, and test command.

**Acceptance:** all 3 laptops render the ReactBits Dashboard 4 scaffold against their own deployment; `schema.ts` + stubs are on main; both product rows and the single Acme integration row are visible in the Convex data browser; no license key is tracked by Git.

---

### Phase 1 — Devin engine *(Iyad; ref 11:15–14:00)*

**Objective:** a Convex-triggered Devin session that ends with a PR URL in the `sessions` table. This is the highest-risk phase — validate the loop with a trivial session FIRST.

**Prereqs:** P0. Uses R2, R3.

**Deliverables**
1. `devin.launch` internalAction: builds an R3 prompt from cluster evidence or an already-impacted API incident, POSTs R2 launch, writes `sessions` + `events`. Guard: skip and log if the product has no repo; for API maintenance, also reject any incident not in `repair_queued` with `diagnosisVerdict: "impacted"`.
2. `devin.poll` internalAction on a 20s cron (only while any session `status ∈ {working, blocked, resumed}`): GET status, update the run, and capture structured test outcome plus `pull_request.url`. Feedback runs update the linked cluster; API runs advance `repairing → validating → repair_proposed` only when a PR exists and tests pass. A missing PR or failed test becomes `repair_failed`. Auto-nudge on `blocked` (R2).
3. `threshold.check` mutation: on cluster count increment, if `count >= product.threshold && status === "open"` → set `triggered`, post event, `ctx.scheduler.runAfter(0, internal.devin.launch, ...)`.
4. **Smoke test (do this before building 2–3):** manually run `devin.launch` with prompt "Add a LICENSE file to {org}/acme-invoicing and open a PR" → confirm PR URL lands in the table. **This is the 12:00 hard checkpoint.**
5. After 1–4 work: wrap launch→poll→record in `@convex-dev/workflow` (durable retries; the "Convex Workflow orchestrates Devin" judging point).
6. Admin mutation `forceThreshold(clusterId)` for demo control.

**Files:** `convex/devin.ts`, `convex/threshold.ts`, `convex/crons.ts`, `convex/convex.config.ts` (workflow component).

**Acceptance:** inserting 5 fake reviews into one Acme cluster fires a real Devin session with zero manual steps; PR URL appears in the dashboard data; Revolut clusters crossing threshold post an event but never launch Devin.

---

### Phase 2 — Feedback ingestion + clustering *(Shashwat; ref 11:15–14:30)*

**Objective:** real complaints from real sources for both products, clustered by Claude, feeding Phase 1's threshold check.

**Prereqs:** P0. Uses R4, R6. Acme's subreddit exists (tonight).

**Deliverables**
1. `ingest.scrapeSource` action per source recipe in R4 (trustpilot | play | reddit | board), storing raw results.
2. Extraction: Trustpilot via JSON-LD parse (no LLM); Play/Reddit/board via Claude extraction (R6). Normalize to `reviews` rows; dedupe on `hash` (skip existing before clustering — protects against re-scrapes).
3. `cluster.assign` action per new review (R6 clustering prompt) + `cluster.apply` mutation (atomic attach/create/increment → calls `threshold.check` from P1; until P1 lands, stub logs only).
4. `crons.interval("scrape-all", {minutes: 10}, ...)` over all products' configured sources + public `scanNow(productId)` mutation for the dashboard button.
5. **Real-data pass for Revolut:** run scrapes against all three Revolut sources; confirm real complaints cluster sensibly. Cache results in DB in the morning so the demo opens with data even if venue wifi dies.
6. **Real-data pass for Acme:** teammates post 5–8 real complaint posts on r/&lt;AcmeName&gt; describing the planted bugs (coordinate wording with Phase 5's bug list); confirm scrape → extract → cluster works. If Reddit auto-filters the new subreddit, switch Acme's source to the feedback board (P5.4) — same pipeline, different URL.
7. `seed.demoComplaints` mutation (~25 synthetic complaints matching planted bugs) — final fallback only.

**Files:** `convex/ingest.ts`, `convex/cluster.ts`, `convex/crons.ts`, `convex/seed.ts`.

**Acceptance:** "Scan now" on Revolut pulls & clusters real reviews end-to-end; "Scan now" on Acme pulls the real subreddit posts and clusters them into the planted-bug clusters; re-running scrapes creates zero duplicates.

---

### Phase 3 — API Integration Maintainer *(Docs Sentinel + shared incident spine; Iyad after P1 core lands, ref 13:30–15:00)*

**Objective:** proactive docs changes and reactive integration failures enter one incident flow that proves customer-code impact before Devin opens a tested repair PR.

**Prereqs:** P0; P1 `devin.launch`; P5 controlled vendor endpoint, docs URL, Acme integration path, and regression test. Uses R5, R6, R8.

**Deliverables**
1. `POST /webhooks/context`: verify `X-Context-Signature` HMAC (R5), resolve the integration by `monitorId`, persist `docChanges` + a `docs` trigger event, then call `incidents.receiveTrigger`.
2. `POST /ingest/errors`: require `Authorization: Bearer $SENTINEL_INGEST_TOKEN`; accept `productId`, `integrationId`, endpoint, observed contract version, message, optional stack/status code; strip headers, request bodies, and query values, enforce a small payload limit, then persist `errors` + a `runtime` trigger event and call the same `incidents.receiveTrigger`. No general log pipeline or spike detector in core.
3. `incidents.receiveTrigger`: dedupe using the R8 fingerprint, create or attach to an incident, and emit every state transition to `events`. A second trigger adds evidence and never launches a duplicate repair.
4. `docs.gatherAndDiagnose`: retrieve the latest docs through Context.dev and the configured integration file from Acme's public GitHub repo; combine those with the trigger, registered endpoint/contract/path, and existing evidence, then run R6 impact diagnosis. Do not crawl or index the repository.
5. Apply the impact gate: `not_impacted` stops; `uncertain` becomes `needs_review`; `impacted` becomes `repair_queued` and schedules `devin.launch` with the R3 API-maintenance packet.
6. Extend `devin.poll` to save test results and PR metadata and advance the incident through `repairing → validating → repair_proposed`. Never merge or deploy.
7. Build public PayFlow demo routes: `GET /demo/vendor/rates` proxies or reads cached Frankfurter rates and shapes them according to a Convex-stored `v1|v2` flag; `GET /demo/vendor/docs` renders the matching contract. Add reset-to-v1 and activate-v2 mutations. Keep a cached rate fallback so vendor availability does not control the demo.
8. Create one Context.dev monitor for the controlled docs, store its ID on the `integrations` row, and store its webhook secret in the environment. Dashboard controls may reset v1, activate the single v2 break, run the monitor now, and call the Acme integration, but must exercise real handlers rather than directly editing incident state.

**Files:** `convex/http.ts`, `convex/incidents.ts`, `convex/docs.ts`, `convex/devin.ts`, monitor-creation script or dashboard notes.

**Acceptance:** the controlled docs change produces `detected → gathering_context → diagnosing → repair_queued → repairing → validating → repair_proposed`, with diagnosis evidence, a passing regression test, and a real Devin PR. Running the broken integration independently enters the same flow; running it during the proactive incident attaches evidence without creating a second session.

---

### Phase 4 — Dashboard *(Moein; ref 11:15–15:00)*

**Objective:** adapt ReactBits Application UI into the live demo surface instead of designing dashboard chrome from scratch.

**Prereqs:** P0 has installed ReactBits Pro `dashboard-4`, the operations-dashboard template with a service status board and incident list. Build against hand-inserted rows first; every data region becomes a Convex `useQuery` so P1–P3 results appear without refresh.

**Deliverables**
1. Preserve the ReactBits app shell, responsive layout, spacing, typography, status treatments, and card/list primitives. Remove example branding and static demo metrics; do not build a second design system or add charts without useful data.
2. Adapt the template's service selector/status board into the Revolut/Acme product switcher and integration-health summary. Observer products show a clear "monitoring only" badge where repair actions would appear.
3. Adapt the incident list into two concise views: **Feedback clusters** with threshold/status and **API incidents** with trigger source, impact verdict, repair state, and PR status.
4. Add one detail drawer using the installed primitives for the auditable timeline: trigger received → context gathered → impact evidence → Devin state → test result → PR link. The same drawer shows complaint evidence or API code/docs evidence without adding another route.
5. Add the onboarding form for product/repo/feedback fields and one optional API integration. Use the installed ReactBits/shadcn primitives; install another Application UI block only if the form cannot be assembled quickly from what Dashboard 4 already provides.
6. Add restrained demo controls: Scan now · Seed complaints · Force threshold · Reset vendor · Activate v2 break · Run integration. Keep them visually separated from normal product actions.
7. Replace every template array/placeholder with Convex data or an explicit empty/loading state. Treat `useQuery === undefined` as loading and preserve the template's responsive behavior.

**Files:** installed ReactBits source under `src/` plus the dashboard page and small data-mapping components; no backend files.

**Acceptance:** Dashboard 4's original sample data is gone; both products render from Convex; a stranger can follow complaint → cluster → Devin → PR and API trigger → impact verdict → tests → repair PR; mobile/desktop layouts remain usable; no ReactBits license credential is bundled or committed.

---

### Phase 5 — Demo assets: Acme repo + controlled vendor *(Ash, driven through Devin chat; ref 11:15–14:30)*

**Objective:** everything Devin fixes and Context watches for the Acme story. Built by prompting Devin interactively—which is itself demo-able meaningful Devin usage.

**Prereqs:** P0 (repo exists). Coordinate feedback bug wording with Phase 2.6 and the API contract with Phase 3.

**Deliverables**
1. Devin scaffolds `acme-invoicing`: small Vite/Next invoicing app—invoices, CSV export, and multi-currency totals through one isolated `src/lib/payflow.ts` adapter. PayFlow is a controlled rates API backed by real Frankfurter data, so the upstream values are realistic while the response contract is deterministic. Include a strong `README.md` + `AGENTS.md` with run/test commands.
2. Keep the existing small feedback bugs for Feedback Sentinel (CSV header and one optional form/rate bug); do not add more. The API-maintenance story uses one separate controlled contract break.
3. **Controlled PayFlow contract:** Sentinel's Convex HTTP routes expose a public rates endpoint and matching docs page. v1 returns `{version: "v1", base, rates: {EUR: 0.86}}`; one demo mutation switches both endpoint and docs to v2 returning `{version: "v2", base, data: [{currency: "EUR", rate: 0.86}]}`. Acme can report the observed version but continues expecting `rates`, producing a genuine adapter failure.
4. Wrap the PayFlow adapter with runtime validation/error handling. On contract failure, send a sanitized event to Sentinel's `/ingest/errors`; show a stable user-facing error rather than crashing the app.
5. Add adapter tests with a v1 fixture and clear test command. The Devin incident packet supplies the v2 docs/response evidence and requires a v2 regression test in the repair PR.
6. Keep the **feedback board** as Acme's backup Feedback Sentinel source, publicly reachable through the deployed app.
7. Deploy Acme and the Sentinel Convex HTTP routes so the app, controlled API, docs, and feedback board have stable public URLs.
8. Draft submission answers, the 3-minute script (§D), disclosure list, and backup-video shot list.

**Acceptance:** Acme builds and deploys; feedback bugs reproduce; v1 currency conversion works; activating v2 causes a real, captured adapter failure; the docs page reflects v2; and a cold Devin session given the incident packet can patch the adapter, add the regression test, pass the suite, and open a PR without touching the vendor.

---

### Phase 6 — Integration + demo hardening *(everyone; ref 15:15–16:30)*

**Objective:** the demo cannot fail twice in a row.

**Prereqs:** P1–P5.

**Deliverables**
1. Pick ONE deployment as demo-prod (`npx convex deploy` or a designated dev deployment); env vars + monitors pointed at it.
2. Two full end-to-end rehearsals: Revolut observer view → Acme feedback trigger → Devin PR → reset PayFlow v1 → activate the v2 contract/docs → run Context monitor → impact verdict → Devin session → passing test + repair PR. Separately verify that the Acme runtime failure enters or attaches to the same incident.
3. Pre-warm strategy: launch a real API-repair session about 30 minutes before judging so a **finished tested PR** exists to show; the live-triggered one runs during the talk. Keep the best rehearsal PR as backup evidence.
4. Record backup video (rules allow it).
5. Morning-cached Revolut data verified present.
6. **16:30: submit.** Deadline 17:00 is strict.

**Acceptance:** rehearsal #2 runs without touching code; submission form complete.

---

### Phase 7 — Reactive incident hardening *(STRETCH — only if P1–P5 green at the 15:00 checkpoint)*

**Objective:** add production-style grouping and presentation on top of Phase 3's already-working single runtime-failure trigger.

**Prereqs:** P3 shared incident flow, P4 dashboard, P5 Acme deployed.

**Deliverables**
1. Group repeated runtime events by integration and fingerprint; show count and first/last seen without creating additional incidents or Devin sessions.
2. Add an optional spike policy (for example, 10 matching failures in 2 minutes) as a severity escalation only. It must not bypass diagnosis or the impact gate.
3. Add a red incident banner and clearer live feed treatment for confirmed runtime impact.
4. Add a safe demo control that calls the changed PayFlow integration and surfaces its genuine failure; do not add a generic flag that makes unrelated application code throw.

**Acceptance:** repeated calls to the broken PayFlow integration update one incident in real time, preserve the docs evidence and diagnosis, and produce at most one repair session.

---

## §T. Reference timeline (pacing, not structure)

| Clock | What |
|---|---|
| 10:00–10:30 | Registration. Ash: submission link, credit redemption, ask Context rep about `country`-proxy plan tier |
| 10:30–11:15 | **Phase 0** (all together) |
| 11:15–15:00 | **P1→P3 (Iyad) ∥ P2 (Shashwat) ∥ P4 (Moein) ∥ P5 (Ash + Devin chat)** |
| 12:00 | **Hard checkpoint: P1.4 smoke test** — Devin PR from a Convex action. Broken = lunch-table topic #1 |
| 12:30–13:00 | Lunch + status sync |
| 15:00 | **Checkpoint: all green → Phase 7; anything red → all hands on it, P7 cut** |
| 15:15–16:30 | **Phase 6** |
| 16:30 | **SUBMIT** (17:00 strict) |

## §D. Demo script (3 min)

1. **(0:00)** "Every team has three streams of bug reports they ignore: reviews, upstream docs, production errors. We built the team that reads them — and fixes them." **Open on Revolut**: real Trustpilot/Play/Reddit complaints, clustered live. "This is Sentinel watching a real business, today. Now here's what happens when Sentinel also has your repo."
2. **(0:45)** **Switch to Acme.** Post a real complaint on r/&lt;AcmeName&gt; (or show this morning's real posts) → Scan now → clustering live → "CSV export broken" hits 5/5 → Devin session card appears.
3. **(1:30)** Cut to the pre-warmed session's **open PR on GitHub**: diff fixing the exact bug, PR body citing the user complaints. "Complaint to reviewable fix, zero humans."
4. **(2:00)** API Integration Maintainer: activate PayFlow v2 and run the Context.dev monitor → signed webhook creates an incident → latest docs arrive → timeline names the changed response field and proves Acme uses it → Devin session launches. Cut to the pre-warmed API PR with the adapter diff and passing regression test. "It does not patch every docs change; it proves impact first."
5. **(2:35)** Run Acme's now-broken integration → the genuine runtime failure appears as a second trigger on the same incident, not a duplicate repair. If time is tight, show this event already attached from rehearsal.
6. **(2:50)** "Context.dev is the senses, Convex is the control plane, and Devin is the hands: detect, understand, contextualize, validate, remediate. The output is a reviewable PR—not an automatic deployment."

## §K. Risks

| Risk | Mitigation |
|---|---|
| Devin slow/stuck during judging | Pre-warmed finished PR; live session runs in background; backup video; rehearsal PR as exhibit |
| Devin key/plan issue | Verified tonight via SETUP.md curl |
| New subreddit auto-filtered | Aged account creates it tonight + test post tonight; backup = feedback board (P5.4, same pipeline); final fallback = seeds |
| Venue wifi kills live scraping | Morning-cached Revolut data; Acme reddit posts made in the morning; seeds |
| Trustpilot proxy needs paid Context tier | Reddit + Play still real for Revolut; ask rep at opening |
| ReactBits Pro registry/license unavailable | Verify Pro/Ultimate access before Phase 0; install Dashboard 4 immediately; never commit the local license key |
| Threshold doesn't fire on stage | `forceThreshold` admin button |
| Devin fixes the wrong thing | Isolated `payflow.ts` adapter, explicit v1/v2 evidence, required regression test, minimal-diff prompt, two rehearsals |
| Docs change is irrelevant | Deterministic endpoint overlap + structured impact verdict; `not_impacted` stops before Devin |
| Proactive and reactive triggers duplicate work | Shared fingerprint and one incident/session guard; second trigger only appends evidence |
| Context monitor is slow during judging | Pre-run a real monitor event; keep Run Monitor Now control, persisted incident timeline, and backup video |
| Devin `blocked` mid-session | Auto-nudge (P1.2) |
| Merge conflicts | Schema+stubs first; phases own disjoint files; frequent small pushes |
| Time overrun | Cut P7 grouping/polish; retain Phase 3's proactive path and single reactive event through the shared spine |

## §C. Cost guards

`max_acu_limit: 5` per session, ~4–8 sessions all day — within credits. `claude-haiku-4-5` for extraction/clustering (~fractions of a cent). Context: `maxAgeMs=0` only for demo moments; monitors at 10-min interval; 15k event credits ample. Convex free tier: poll cron runs only while sessions active.
