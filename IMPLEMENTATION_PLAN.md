# Implementation Plan — Sentinel

*Every external API shape in this document was verified against live docs/tests on 29 Aug 2026. Nothing here is assumed.*

**How to use this document:** the build is organized as **phases**, not hours. Each phase is a self-contained brief — you can open a Devin/Claude Code session, paste the phase (plus §R references it names), and say "implement this." Phases 1–5 run in parallel after Phase 0. The clock times in §T are a pacing reference, not the structure.

---

## §0. Architecture

```
Context.dev (scrape API + monitors)
   │ cron-pulled scrapes                  │ webhook (change.detected, HMAC-signed)
   ▼                                      ▼
┌─ Convex backend ─────────────────────────────────────────────┐
│ crons.ts      scrape sources every 10 min (+ "Scan now")     │
│ ingest.ts     normalize + dedupe reviews                     │
│ cluster.ts    Claude assigns review → cluster                │
│ threshold.ts  cluster count ≥ N → schedule devin launch      │
│ devin.ts      POST /v1/sessions, poll GET /sessions/{id}     │
│ http.ts       /webhooks/context (docs sentinel)              │
│               /ingest/errors (incident sentinel, stretch)    │
│ schema.ts     products, reviews, clusters, sessions,         │
│               docChanges, incidents, events                  │
└──────────────┬────────────────────────────────────────────────┘
               │ useQuery (reactive websocket)
               ▼
   Vite + React + shadcn dashboard

Devin ──→ GitHub org: acme-invoicing repo → PRs
```

### Two products, one pipeline (the real-data design)

| | **Revolut** (observer mode) | **Acme Invoicing** (full loop) |
|---|---|---|
| Role in demo | Opens the demo: "this is Sentinel on a real business" | The end-to-end story through to Devin's PR |
| Feedback sources | REAL: Trustpilot (`country: "us"` proxy), Play Store, r/Revolut — all verified scrapeable today | REAL: **r/&lt;AcmeName&gt;** (created tonight, teammates post real complaints; live on-stage post possible). Backup: public feedback-board page in acme repo, also genuinely scraped. Final fallback: seed mutation |
| Docs monitored | — | REAL: frankfurter.dev API docs (the currency API Acme genuinely integrates) + our controlled `vendor-docs` page (deterministic on-stage trigger) |
| Devin | Disabled — product row has no `repo` configured. Pipeline stops at clustering/alerting | Enabled — sessions open PRs on `acme-invoicing` |
| Why it exists | Kills "this only works on staged data"; same code path, just a config row | Proves the closed loop |

**Repos** (create at the event; org decided tonight): `sentinel` (product) and `acme-invoicing` (demo SaaS, Devin's target, Devin GitHub App installed, GitHub Pages enabled for the vendor-docs page).

**Component decisions:** core pipeline = plain actions + crons + `ctx.scheduler`. `@convex-dev/workflow` wraps only the Devin session lifecycle, added after the plain version works. No `@convex-dev/agent`.

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

  sessions: defineTable({              // Devin sessions
    productId: v.id("products"),
    trigger: v.union(v.literal("feedback"), v.literal("docs"), v.literal("incident")),
    clusterId: v.optional(v.id("clusters")),
    devinSessionId: v.string(),
    devinUrl: v.string(),
    status: v.string(),                // mirror of status_enum
    prUrl: v.optional(v.string()),
    prompt: v.string(),
    structuredOutput: v.optional(v.any()),
  }).index("by_devin_id", ["devinSessionId"]).index("by_product", ["productId"]),

  docChanges: defineTable({
    productId: v.id("products"),
    monitorId: v.string(),
    url: v.string(),
    summary: v.string(),
    isBreaking: v.boolean(),
    raw: v.any(),
    sessionId: v.optional(v.id("sessions")),
  }).index("by_product", ["productId"]),

  incidents: defineTable({             // Phase 7 (stretch)
    productId: v.id("products"),
    title: v.string(),
    errorCount: v.number(),
    status: v.union(v.literal("detected"), v.literal("fixing"), v.literal("pr_open"), v.literal("resolved")),
    sessionId: v.optional(v.id("sessions")),
  }).index("by_product", ["productId"]),

  errors: defineTable({                // Phase 7 (stretch)
    productId: v.id("products"),
    message: v.string(),
    stack: v.optional(v.string()),
  }).index("by_product", ["productId"]),

  events: defineTable({                // war-room feed — EVERY state change posts here
    productId: v.id("products"),
    sentinel: v.string(),              // "feedback" | "docs" | "incident" | "system"
    message: v.string(),
    level: v.union(v.literal("info"), v.literal("warn"), v.literal("critical")),
  }).index("by_product", ["productId"]),
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
    "properties": { "pr_url": {"type": "string"}, "summary": {"type": "string"}, "root_cause": {"type": "string"} }
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

Docs-sentinel variant: replace Evidence with the docs-change summary + name the integration file (`src/lib/frankfurter.ts` or wherever Phase 5 puts it).

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
  "name": "frankfurter-api-docs",
  "mode": "web",
  "target": { "type": "page", "url": "https://frankfurter.dev/",
    "instructions": "Report changes to API endpoints, parameters, response fields, base URLs, or deprecations. Ignore cosmetic or wording-only changes." },
  "change_detection": { "type": "semantic", "confidence_threshold": 0.7 },
  "schedule": { "type": "interval", "frequency": 10, "unit": "minutes" },
  "webhook": { "url": "https://{deployment}.convex.site/webhooks/context", "events": ["change.detected"] }
}
```

Second monitor: same shape targeting the controlled vendor-docs page (Phase 5). Min interval 10 min → **use run-monitor-now for on-demand demo triggering**. Webhook signature: header `X-Context-Signature: t=<unix>,v1=<hmac>`, HMAC-SHA256 over `"{t}.{rawBody}"` keyed by the `secret` returned at creation; verify with constant-time compare, reject stale timestamps.

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

**Docs-change analysis** (Phase 3): webhook payload diff → `{isBreaking: bool, summary, affectedEndpoints[]}`.

### R7. Env vars (per Convex deployment, set via dashboard)

`DEVIN_API_KEY` · `ANTHROPIC_API_KEY` · `CONTEXT_API_KEY` · `CONTEXT_WEBHOOK_SECRET` (after Phase 3 creates monitors) · `GITHUB_ORG` (name only, no token needed — Devin's GitHub App handles repo access). Frankfurter needs **no key**.

---

## §P. Phases

Dependency graph: **P0 → (P1 ∥ P2 ∥ P3 ∥ P4 ∥ P5) → P6 → P7(stretch)**. P3 needs P5's vendor-docs page URL to finish (stub it until then); P1's live test needs P5's repo to exist (use a README-only repo created in P0).

---

### Phase 0 — Foundation *(all together, one laptop drives; ref ~10:30–11:15)*

**Objective:** one repo, four laptops building in parallel with a shared contract.

**Deliverables**
1. GitHub org repos created: `sentinel`, `acme-invoicing` (README-only for now). Devin GitHub App covers both (installed org-wide tonight).
2. `npm create convex@latest sentinel` (Vite + React) → pushed. Everyone clones; each runs `npx convex dev` (personal dev deployment); hot reload verified on all 3 laptops.
3. **`convex/schema.ts` exactly as R1** + stub files with exported, typed, `throw new Error("todo")` function signatures: `ingest.ts`, `cluster.ts`, `threshold.ts`, `devin.ts`, `http.ts`, `crons.ts`, `seed.ts`. Committed and pushed before anyone splits off.
4. Env vars (R7) set in every dev deployment + prod.
5. `npx shadcn@latest init` in the frontend.
6. Two product rows inserted (via a `seed.setupProducts` mutation): Revolut (observer — playStoreId `com.revolut.revolut`, trustpilotDomain `revolut.com`, subreddit `Revolut`, **no repo**) and Acme Invoicing (repo `org/acme-invoicing`, subreddit `<AcmeName>`, docsUrls `[frankfurter.dev, <vendor-docs URL when live>]`, threshold 5).

**Acceptance:** all 3 laptops render the scaffold with their own deployment; `schema.ts` + stubs on main; both product rows visible in Convex dashboard data browser.

---

### Phase 1 — Devin engine *(Iyad; ref 11:15–14:00)*

**Objective:** a Convex-triggered Devin session that ends with a PR URL in the `sessions` table. This is the highest-risk phase — validate the loop with a trivial session FIRST.

**Prereqs:** P0. Uses R2, R3.

**Deliverables**
1. `devin.launch` internalAction: builds prompt (R3) from cluster/docChange evidence, POSTs R2 launch, writes `sessions` row + `events` row. Guard: skip + log event if product has no `repo` (observer mode).
2. `devin.poll` internalAction on a 20s cron (only while any session `status ∈ {working, blocked, resumed}`): GET status, update row, capture `pull_request.url` → also update the linked cluster/docChange to `pr_open` + post event. Auto-nudge on `blocked` (R2).
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

### Phase 3 — Docs Sentinel *(Iyad after P1 core lands — it reuses `devin.launch`; or split with Shashwat; ref 13:30–15:00)*

**Objective:** a docs change on a monitored page becomes a Devin PR with no human in the loop.

**Prereqs:** P0; P1 `devin.launch`; P5.3 vendor-docs page URL (use frankfurter.dev-only until it exists). Uses R5, R6.

**Deliverables**
1. `http.ts` route `POST /webhooks/context`: verify `X-Context-Signature` HMAC (R5), parse payload, store `docChanges` row, post event.
2. Claude breaking-change analysis (R6) on the payload → set `isBreaking`, `summary`.
3. If `isBreaking` → `ctx.scheduler.runAfter(0, internal.devin.launch, {trigger: "docs", ...})` with the R3 docs variant prompt.
4. Create two monitors (R5): real frankfurter.dev docs + the controlled vendor-docs page. Store monitor ids + webhook secret (`CONTEXT_WEBHOOK_SECRET` env var).
5. Demo trigger procedure documented in-repo: edit vendor-docs page → push → call run-monitor-now → webhook within ~seconds.

**Files:** `convex/http.ts`, `convex/docs.ts`, monitor-creation script or dashboard notes.

**Acceptance:** editing the vendor-docs page and running the monitor produces: webhook received + verified → docChange row with breaking summary → Devin session launched → event feed shows the chain.

---

### Phase 4 — Dashboard *(Moein; ref 11:15–15:00)*

**Objective:** the demo surface — everything above, live and legible.

**Prereqs:** P0 (schema + stubs). Build against hand-inserted rows first; every panel is a `useQuery` so real data appears as P1–P3 land. No blocking dependencies.

**Deliverables**
1. Product switcher (Revolut / Acme) — observer products show a "monitoring only" badge where Devin panels would be.
2. Panels: **war-room feed** (events; sentinel avatars, severity colors — the "agents talking" surface) · **clusters** with threshold meters + status pills · cluster detail drawer (evidence = actual review texts w/ source badges + link out) · **Devin sessions timeline** (status → PR link button) · **docs monitors** panel (watched URLs, last change, breaking badge).
3. Onboarding form ("Connect your product": name, description, repo, sources, docs URLs, threshold) → products insert. This is what makes it read as a product, not a demo.
4. Demo controls (tasteful): Scan now · Seed complaints · Force threshold.
5. Empty/loading states (`useQuery` returns `undefined` first — handle it everywhere).

**Files:** `src/` (components, routes), no backend files.

**Acceptance:** with both products populated, a stranger can follow complaint → cluster → threshold → Devin → PR without narration; observer vs full-loop distinction is visually obvious.

---

### Phase 5 — Demo assets: Acme repo + docs pages *(Ash, driven through Devin chat; ref 11:15–14:30)*

**Objective:** everything Devin fixes and Context watches for the Acme story. Built by prompting Devin interactively — which is itself demo-able "meaningful Devin usage."

**Prereqs:** P0 (repo exists). Coordinate bug list wording with Phase 2.6's real subreddit posts.

**Deliverables**
1. Devin scaffolds `acme-invoicing`: small Vite/Next invoicing app — invoice list, create invoice, **multi-currency amounts converted via the real Frankfurter API** (`https://api.frankfurter.dev/v1/latest?base=USD&symbols=...`, no key), CSV export. Strong `README.md` + `AGENTS.md` (what it is, stack, how to run/test).
2. **Planted bugs (2–3, small, greppable, visibly fixable):**
   - CSV export drops the header row (or writes semicolons as delimiters).
   - Currency conversion inverts the rate for one direction (EUR→USD shows USD→EUR).
   - Login/email field rejects addresses containing `+`.
3. **Vendor-docs page (the controlled trigger):** `docs/vendor-api.html` on GitHub Pages, styled as "PayFlow Partner API docs", documenting an endpoint/config the app actually reads (e.g. the exchange-rate endpoint path or a fee table baked into `src/lib/vendor.ts`). Demo = rename the endpoint on the page + push.
4. **Feedback board (Acme's backup source):** `/feedback` page in the deployed Acme app (or a GitHub Pages page) listing user-submitted complaints, publicly reachable so Context can scrape it. Simple client-side form + serialized list is fine.
5. Deploy Acme (Vercel) so the app + board + docs pages are live URLs.
6. Submission-form answers drafted (PRD has partner-usage texts), 3-min script (§D), disclosure list, backup-video shot list.

**Acceptance:** repo builds & deploys; all three bugs reproduce; vendor-docs + feedback pages publicly reachable; a cold Devin session given only the repo can locate bug #1 (that's exactly what P1's smoke test evolves into).

---

### Phase 6 — Integration + demo hardening *(everyone; ref 15:15–16:30)*

**Objective:** the demo cannot fail twice in a row.

**Prereqs:** P1–P5.

**Deliverables**
1. Pick ONE deployment as demo-prod (`npx convex deploy` or a designated dev deployment); env vars + monitors pointed at it.
2. Two full end-to-end rehearsals: Revolut observer view → Acme reddit post → scan → cluster → threshold → Devin PR → vendor-docs edit → run-monitor-now → second session.
3. Pre-warm strategy: launch a real session ~30 min before judging so a **finished PR** exists to show; the live-triggered one runs during the talk. Keep the best rehearsal PR as backup exhibit.
4. Record backup video (rules allow it).
5. Morning-cached Revolut data verified present.
6. **16:30: submit.** Deadline 17:00 is strict.

**Acceptance:** rehearsal #2 runs without touching code; submission form complete.

---

### Phase 7 — Incident Sentinel *(STRETCH — only if P1–P5 green at the 15:00 checkpoint)*

**Objective:** "break production" live on stage; the third time-horizon (real-time).

**Prereqs:** P1 (Devin engine), P4 (dashboard), P5 (Acme deployed).

**Deliverables**
1. `http.ts` route `POST /ingest/errors` (productId, message, stack) → `errors` rows.
2. Spike rule (mutation on insert): ≥10 errors/2 min → create `incidents` row, post critical event, launch Devin (`trigger: "incident"`, prompt includes error messages + stack).
3. Acme "break production" button: sets a flag making a core action throw; errors stream to the endpoint.
4. Dashboard incident banner (red) + incident feed with live status updates.

**Acceptance:** pressing the button on deployed Acme produces a declared incident + Devin hotfix session within ~30s.

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
4. **(2:00)** Docs Sentinel: Acme really integrates the Frankfurter currency API — monitor on their real docs. Edit our vendor's docs page (rename endpoint) → run monitor → webhook lights the feed → second Devin session spawns. "It catches breakage *before* production does."
5. **(2:30, if P7 built)** Press **Break production** → red banner, incident declared, hotfix session live.
6. **(2:45)** "Context.dev is the senses, Convex is the nervous system, Devin is the hands. A sentinel is a signal + a trigger + a mandate — CVEs, status pages, logs are next."

## §K. Risks

| Risk | Mitigation |
|---|---|
| Devin slow/stuck during judging | Pre-warmed finished PR; live session runs in background; backup video; rehearsal PR as exhibit |
| Devin key/plan issue | Verified tonight via SETUP.md curl |
| New subreddit auto-filtered | Aged account creates it tonight + test post tonight; backup = feedback board (P5.4, same pipeline); final fallback = seeds |
| Venue wifi kills live scraping | Morning-cached Revolut data; Acme reddit posts made in the morning; seeds |
| Trustpilot proxy needs paid Context tier | Reddit + Play still real for Revolut; ask rep at opening |
| Threshold doesn't fire on stage | `forceThreshold` admin button |
| Devin fixes the wrong thing | Small greppable bugs; "minimal diff" prompt; two rehearsals |
| Devin `blocked` mid-session | Auto-nudge (P1.2) |
| Merge conflicts | Schema+stubs first; phases own disjoint files; frequent small pushes |
| Time overrun | 15:00 cut line for P7; demo survives on Feedback Sentinel alone if P3 dies |

## §C. Cost guards

`max_acu_limit: 5` per session, ~4–8 sessions all day — within credits. `claude-haiku-4-5` for extraction/clustering (~fractions of a cent). Context: `maxAgeMs=0` only for demo moments; monitors at 10-min interval; 15k event credits ample. Convex free tier: poll cron runs only while sessions active.
