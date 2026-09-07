# API Changelog Detection Agent ("Docs Sentinel") — End-to-End Architecture Guide

*Handoff document. Written to be given verbatim to a coding agent (or human) once the Sentinel platform scaffolding from `IMPLEMENTATION_PLAN.md` exists. Every external API shape here was pulled from the live Context.dev and Devin docs on 30 Aug 2026 and cross-checked against the shapes the team verified in `IMPLEMENTATION_PLAN.md` §R. Where the two profiles differ, both are given and tagged.*

**Tags used throughout:**
- `[HACKATHON]` — the exact path for the 30 Aug demo (InvoicePilot + controlled Stripe docs mirror). This is what you build first.
- `[GENERAL]` — the productionized version (e.g. Sentinel deployed for Vapi watching ElevenLabs docs). Same architecture, different configuration. Build only if tagged pieces are explicitly requested.

---

## 0. Mental model

The agent is **not a process that runs in a loop**. It is an event-driven pipeline whose "always-on" detection layer is outsourced to Context.dev's monitor scheduler. Our own compute (Convex) is asleep until a signed webhook arrives, then executes a strict five-stage spine and goes back to sleep:

```
      ALWAYS-ON (Context.dev's infra, not ours)
      ┌────────────────────────────────────────────┐
      │  Monitor: semantic change detection on the │
      │  provider's docs/changelog page, on an     │
      │  interval schedule (min 10 minutes)        │
      └───────────────┬────────────────────────────┘
                      │  change.detected  (HMAC-signed webhook)
                      ▼
      EVENT-DRIVEN (our Convex backend)
      DETECT ──► UNDERSTAND ──► CONTEXTUALIZE ──► VALIDATE ──► REMEDIATE
      (ingest &   (what exactly  (fetch new docs   (impact      (Devin session
       dedupe)     changed?)      + our code that   verdict      → tested PR,
                                  touches it)       gate)        never merged)
```

Agent = **signal source** (provider docs) + **trigger condition** (semantic change) + **fix mandate** (smallest safe integration patch, regression test, PR). The single most important design rule, stated three ways so nobody misses it:

1. **The trigger alone is never enough.** A docs change creates an *incident*, not a repair.
2. **Only a proven-`impacted` incident may launch Devin.** `not_impacted` stops silently; `uncertain` goes to a human (`needs_review`).
3. **Remediation ends at a reviewable PR.** Sentinel never merges, never deploys, never auto-nudges past a human gate.

### Division of intelligence (who reasons about what)

| Concern | Owner | Why |
|---|---|---|
| "Did the docs meaningfully change?" | Context.dev semantic monitor | Purpose-built; runs on their scheduler; we pay ~1–10 credits/run instead of running our own diffing infra |
| "What exactly changed, structurally?" | Context.dev markdown/extract + the webhook's own `diff`/`summary` | The webhook already carries a semantic summary + text diff; extraction turns prose docs into machine-checkable contract facts |
| "Does *our registered integration* read the changed thing?" | Deterministic pre-gate + one Claude call (`claude-haiku-4-5`) over {change, latest docs, integration registration, the actual integration file} | Cheap, fast, auditable, and produces citable evidence for the dashboard |
| "What about code that touches it *indirectly*?" | **Devin, inside the repair session** | Devin has a full clone + dev environment. Repo-wide line-by-line cross-checking belongs there, not in the diagnosis gate. The gate proves the blast radius is non-zero; Devin maps its full extent. (See §6.4.) |
| "Write the fix, prove it with a test, open the PR" | Devin | The hands. |

This split is deliberate: the diagnosis gate must stay cheap and deterministic enough to run on *every* docs change without burning ACUs, while the expensive repo-wide reasoning only happens once impact is proven.

---

## 1. Contract with the platform (what must already exist)

This agent plugs into the scaffolding defined in `IMPLEMENTATION_PLAN.md`. It assumes:

**Schema (R1, `convex/schema.ts`)** — the agent reads/writes these tables:
- `products` — `repo` (absent ⇒ observer mode, Devin never launches), `docsUrls`, `description`.
- `integrations` — the registration record: `provider`, `docsUrl`, `endpoint`, `integrationPath`, `expectedContract`, `activeContractVersion`, `testCommand`, `monitorId`, `enabled`.
- `docChanges` — one row per detected docs change (`monitorId`, `url`, `summary`, `isBreaking`, `affectedEndpoints[]`, `raw`, `incidentId`).
- `triggerEvents` — normalized triggers (`source: "docs" | "runtime"`, `fingerprint`, `summary`, `raw`, `incidentId`).
- `incidents` — the spine record with the R8 state machine and `diagnosisVerdict` / `diagnosisReason` / `diagnosisEvidence[]` / `codeEvidence[]` / `affectedEndpoint`.
- `errors` — sanitized runtime failures (corroboration path).
- `sessions` — Devin runs (`devinSessionId`, `devinUrl`, `status`, `testStatus`, `prUrl`, `structuredOutput`, `prompt`).
- `events` — war-room feed; **every** state transition writes a row here.

**Functions (stubbed in Phase 0)** — this agent implements or consumes:
- `http.ts` → `POST /webhooks/context` (this agent's ingress; implemented here, §4).
- `incidents.receiveTrigger` (shared with the runtime-error path; §5).
- `docs.gatherAndDiagnose` (§6).
- `devin.launch`, `devin.poll` (Phase 1 owns these; this agent supplies the evidence packet and consumes the results; §7).
- `crons.ts` (20s Devin poll while sessions active; optional monitor-poll fallback, §4.4).

**Env vars (R7):** `CONTEXT_API_KEY`, `CONTEXT_WEBHOOK_SECRET`, `DEVIN_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_ORG`. (Note: Context.dev's official SDKs read `CONTEXT_DEV_API_KEY` only — irrelevant here because we call the REST API directly with an `Authorization` header, but don't get confused if an SDK ignores `CONTEXT_API_KEY`.)

**External accounts:** Devin GitHub App installed org-wide (repo access is handled by the App, Sentinel never holds a GitHub write token); Context.dev account with credits redeemed; Anthropic key.

---

## 2. Pipeline overview (stages S0–S8)

| Stage | Name | Runs | Implemented in | Input → Output |
|---|---|---|---|---|
| S0 | Registration | once per integration | onboarding mutation + monitor-creation action | integration row → Context.dev monitor (+ stored `monitorId`, webhook `secret`) |
| S1 | Detection | always-on (Context.dev) | Context.dev monitor | provider docs URL → `change.detected` webhook |
| S2 | Ingress | per webhook | `http.ts /webhooks/context` | signed payload → verified, deduped `docChanges` + `triggerEvents` rows |
| S3 | Incident open/attach | per trigger | `incidents.receiveTrigger` | trigger event → new incident (`detected`) or evidence attached to existing one |
| S4 | Understand | per incident | `docs.gatherAndDiagnose` (first half) | change record → latest docs (markdown) + structured contract facts (`gathering_context`) |
| S5 | Contextualize | per incident | `docs.gatherAndDiagnose` (second half) | integration registration → current integration file contents from GitHub |
| S6 | Validate (impact gate) | per incident | `docs.gatherAndDiagnose` → diagnosis | {change, docs, registration, code} → `impacted` / `not_impacted` / `uncertain` verdict with cited evidence (`diagnosing` → gate) |
| S7 | Remediate | only `impacted` | `devin.launch` + `devin.poll` | evidence packet → Devin session → tested PR (`repair_queued → repairing → validating → repair_proposed/repair_failed`) |
| S8 | Corroborate | any time | `/ingest/errors` → `incidents.receiveTrigger` | runtime failure → evidence attached to the same incident via shared fingerprint (never a duplicate session) |

Everything below specifies each stage exactly.

---

## 3. S0 — Registration: creating the monitor

### 3.1 What registration captures

A registered integration is the unit the sentinel defends. Fields (already in `integrations`):

| Field | Example `[HACKATHON]` | Example `[GENERAL]` (Vapi × ElevenLabs) |
|---|---|---|
| `provider` | `"stripe"` | `"elevenlabs"` |
| `docsUrl` | `https://{deployment}.convex.site/demo/stripe/docs` (controlled mirror) | `https://elevenlabs.io/docs/changelog` (or the specific API-reference page for the endpoint used) |
| `endpoint` | `/v1/payment_intents` | `/v1/text-to-speech/{voice_id}` |
| `integrationPath` | `src/lib/stripe.ts` | `src/providers/elevenlabs.ts` |
| `expectedContract` | "PaymentIntent responses include `charges.data[0]` with `receipt_url` and `status`" | "TTS endpoint accepts `model_id: eleven_monolingual_v1`, returns audio stream + `x-request-id` header" |
| `testCommand` | `npm test` | whatever the customer registered |

`expectedContract` matters more than it looks: it is the diagnosis prompt's anchor for "what the code assumes today," written in plain language at onboarding time when a human still remembers the intent.

### 3.2 Context.dev monitor — exact API

Base URL `https://api.context.dev/v1`, header `Authorization: Bearer $CONTEXT_API_KEY`, `Content-Type: application/json`.

**Create:** `POST /monitors`

```json
{
  "mode": "web",
  "name": "stripe-api-docs",
  "tags": ["sentinel", "integration:<integrationId>"],
  "target": {
    "type": "page",
    "url": "https://{deployment}.convex.site/demo/stripe/docs",
    "instructions": "Report changes to API endpoints, versions, parameters, or response fields (added, renamed, or removed attributes). Ignore cosmetic or wording-only changes."
  },
  "change_detection": { "type": "semantic", "confidence_threshold": 0.7 },
  "schedule": { "type": "interval", "frequency": 10, "unit": "minutes" },
  "webhook": {
    "url": "https://{deployment}.convex.site/webhooks/context",
    "events": ["change.detected"]
  }
}
```

Rules the API enforces (get these wrong and you eat a 400 mid-hackathon):

- **Valid target × detection combos only:** `page`+`exact`, `page`+`semantic`, `sitemap`+`exact`, `extract`+`semantic`.
- `page`+`semantic` **requires** `target.instructions`; `page`+`exact` **rejects** `instructions`.
- `schedule` unit ∈ `minutes|hours|days`; total interval must be ≥ **10 minutes** (and ≤ 1 year). Default when omitted: daily. ⇒ For the on-stage demo you cannot schedule your way to instant detection; use run-now (§3.4).
- `confidence_threshold` ∈ [0,1], default 0.75. We set 0.7 per the plan.
- Creating a monitor queues an immediate **baseline run** (no `change.detected` fires for the baseline — nothing to diff against yet). Create the monitor while the docs mirror is in its v2022-08-01 state so the baseline is the *old* contract.

**Response handling:** persist `id` (→ `integrations.monitorId`, indexed `by_monitor`) and `webhook.secret` (`whsec_…`) → set as `CONTEXT_WEBHOOK_SECRET` in the Convex deployment env. The secret is generated server-side and read-only; if leaked, rotate with `POST /monitors/{monitor_id}/webhook/rotate-secret`.

**Other lifecycle endpoints:** `GET /monitors` (list, cursor-paginated), `GET/PATCH/DELETE /monitors/{id}`.

Implement creation as a one-shot script or admin-only Convex action (`docs.createMonitor(integrationId)`), *not* something that runs on every deploy — monitor creation is free (0 credits) but each run costs 1–10 credits and duplicate monitors mean duplicate webhooks.

### 3.3 `[GENERAL]` Monitor topology for real providers

For a real deployment (Vapi watching ElevenLabs et al.), one integration may want up to three monitors, all funneling into the same webhook route:

1. **Changelog page monitor** (`page`+`semantic`) on the provider's changelog — the primary signal; changelogs are written to be diffed.
2. **Endpoint reference page monitor** (`page`+`semantic`) on the exact API-reference page for the registered endpoint, with `instructions` scoped to that endpoint's params/response fields — catches silent doc edits that never make the changelog.
3. **Sitemap monitor** (`sitemap`+`exact`) on the docs sitemap — catches *new/removed doc pages* (e.g., a new API version's section appearing, or a deprecated endpoint's page vanishing). Payload carries `added_urls`/`removed_urls` instead of a text diff.

Many docs sites (Mintlify/Fern-based ones like ElevenLabs') serve any page as markdown by appending `.md` or via an `Accept: text/markdown`-style route, and publish an `llms.txt` index. Registration can probe for this (`GET {docsUrl}.md`, `GET {origin}/llms.txt`) and, when available, point the monitor at the markdown URL — smaller pages, cleaner diffs, fewer cosmetic false positives. `[HACKATHON]` skip this; the mirror is already clean HTML.

`[GENERAL]` stretch, explicitly optional: a **discovery** step at onboarding that scans the repo's dependency manifest (`package.json` / imports) for known third-party SDKs and *proposes* monitors for their docs. Do not build for the demo.

### 3.4 Demo lever: run-now

`POST /monitors/{monitor_id}/run` → `202` + `run_id`. This is the "Run monitor now" dashboard button. Sequence on stage: flip mirror to 2022-11-15 (`vendor.upgradeV2`) → run-now → Context.dev diffs against baseline → `change.detected` webhook lands in seconds-to-a-minute. Rehearse the latency; §9 has the fallback if it's slow live.

---

## 4. S1/S2 — Detection & ingress: the webhook

### 4.1 What Context.dev sends

Delivery: `POST https://{deployment}.convex.site/webhooks/context` with headers:

- `X-Context-Event`: `change.detected` (or `run.completed` if subscribed)
- `X-Context-Signature`: `t=<unix seconds>,v1=<hex hmac>`
- `X-Context-Id`: equals the payload's top-level `id`

`change.detected` payload (exact shape from docs):

```json
{
  "event": "change.detected",
  "id": "evt_123",
  "created_at": "2026-08-30T14:00:12Z",
  "data": {
    "change": {
      "mode": "web",
      "id": "chg_123",
      "monitor_id": "mon_123",
      "run_id": "run_123",
      "tags": ["sentinel"],
      "target_type": "page",
      "change_detection_type": "semantic",
      "title": "Stripe API docs changed",
      "summary": "The changelog adds the 2022-11-15 entry: the charges attribute was removed from the PaymentIntent object; use latest_charge instead.",
      "detected_at": "2026-08-30T14:00:10Z",
      "url": "https://{deployment}.convex.site/demo/stripe/docs",
      "importance": "…",
      "confidence": 0.93,
      "diff": "- charges (object) List of charges…\n+ latest_charge (string) ID of the latest charge…",
      "before_text_excerpt": "charges — object — Charges that were created by this PaymentIntent…",
      "after_text_excerpt": "latest_charge — string — The latest charge created by this PaymentIntent…"
    }
  }
}
```

The webhook **already contains** a semantic `summary`, a text `diff`, and before/after excerpts — this is most of the "understand" stage delivered for free. Sitemap monitors carry `added_urls[]`/`removed_urls[]` instead of `diff`.

### 4.2 Signature verification (do not skip; it's a judging point)

HMAC-SHA256, key = webhook `secret`, message = `"{t}.{rawBody}"` where `rawBody` is the exact raw request bytes. Convex HTTP actions run in the Convex JS runtime — use **Web Crypto**, not Node `crypto`:

```ts
// convex/http.ts (inside httpAction)
const raw = await request.text();                       // raw body FIRST, before any JSON.parse
const sig = request.headers.get("X-Context-Signature") ?? "";
const parts = Object.fromEntries(sig.split(",").map(p => p.split("=") as [string, string]));
const t = Number(parts["t"]);
if (!parts["v1"] || !Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300)
  return new Response("stale or malformed signature", { status: 401 });

const key = await crypto.subtle.importKey(
  "raw", new TextEncoder().encode(process.env.CONTEXT_WEBHOOK_SECRET!),
  { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`));
const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
// constant-time compare
const given = parts["v1"];
let diff = expected.length ^ given.length;
for (let i = 0; i < Math.min(expected.length, given.length); i++)
  diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
if (diff !== 0) return new Response("bad signature", { status: 401 });
```

Rules: reject stale timestamps (±5 min window shown above), constant-time compare, return **2xx fast** on success — do the heavy work async via `ctx.scheduler.runAfter(0, …)` so Context.dev never sees a timeout. (Their side: 429s are retried with capped `Retry-After`; after 3 consecutive delivery failures they email the whole org — you want neither.)

### 4.3 Ingress normalization (still in the webhook handler / a mutation it schedules)

1. **Idempotency:** delivery is at-least-once. Before inserting anything, check whether a `docChanges` row already exists with this `change.id` (store it in `raw`; or index on it). Duplicate delivery ⇒ 200 and stop.
2. **Route:** look up the integration by `monitor_id` via the `integrations.by_monitor` index. Unknown monitor ⇒ log an `events` row (`level: "warn"`) and 200 (never 4xx a valid signature — it triggers their failure machinery).
3. **Persist** a `docChanges` row: `{ productId, integrationId, monitorId, url: change.url, summary: change.summary, isBreaking: false /* set by diagnosis later */, affectedEndpoints: [] /* filled by S4 */, raw: <entire change object> }`.
4. **Persist** a `triggerEvents` row: `{ source: "docs", fingerprint: <see §5>, summary: change.summary, raw: { eventId, changeId, runId } }`.
5. **Call** `incidents.receiveTrigger` with the trigger event.
6. If `X-Context-Event` is `run.completed` (only if you subscribed): update a `lastCheckedAt` field for the dashboard's "monitor healthy, last check 14:02" display, and stop. No incident logic.

### 4.4 Polling fallback (venue-wifi insurance)

Webhooks can be undeliverable (deployment URL changed, Context.dev hiccup). Cheap insurance: a cron (e.g. every 5 min, `[HACKATHON]` optional) that calls `GET /monitors/{monitorId}/changes` for each enabled integration and feeds any change `id` not already in `docChanges` through the exact same normalization path as §4.3. Same idempotency key ⇒ webhook and poll can race safely. Also usable as the manual "check now" recovery button.

---

## 5. S3 — Incident open/attach: `incidents.receiveTrigger`

One mutation, shared verbatim with the runtime-error path (this is the "one spine" claim in the demo — do not fork it).

**Fingerprint** = `integrationId + affectedEndpoint + observedContractVersion`.
- Docs trigger `[HACKATHON]`: the mirror names the version on the page and the gateway stamps `Stripe-Version` on responses, so both trigger sources deterministically produce `…+/v1/payment_intents+2022-11-15`.
- Docs trigger `[GENERAL]`: version extracted in S4 (changelog entries are dated/versioned); when genuinely unversioned, fall back to `integrationId + docChange.url + detected_at date`.
- Runtime trigger: endpoint + observed contract version from the sanitized error report.

**Logic:**

```
match = incidents.by_fingerprint(fingerprint) where status ∉ {not_impacted}
if match exists:
    link triggerEvent.incidentId = match._id
    append to the incident's evidence (docs excerpt or error rows)
    events += "Corroborating {source} evidence attached to incident {title}"
    if match.status ∈ {repair_queued, repairing, validating, repair_proposed}:
        DO NOT launch anything; the repair already exists   ← duplicate-session guard
    stop
else:
    create incident { status: "detected", title, fingerprint, … }
    link triggerEvent + docChange to it
    events += "Incident detected from {source} trigger"
    ctx.scheduler.runAfter(0, internal.docs.gatherAndDiagnose, { incidentId })
```

State machine (R8) — the only legal transitions; enforce them in one place (a `advanceIncident(incidentId, to)` helper that throws on illegal moves and writes the `events` row):

```
detected → gathering_context → diagnosing → ┬ not_impacted        (terminal, quiet)
                                            ├ needs_review        (terminal until human)
                                            └ repair_queued → repairing → validating → ┬ repair_proposed
                                                                                       └ repair_failed
```

---

## 6. S4/S5/S6 — Understand, contextualize, validate: `docs.gatherAndDiagnose`

One internalAction. Sets `gathering_context` on entry, `diagnosing` before the model call, then applies the gate. Every step that fails degrades to `uncertain`/`needs_review` — this function must never throw its way into a stuck incident.

### 6.1 S4a — Retrieve the latest docs (Context.dev Markdown)

`GET https://api.context.dev/v1/web/scrape/markdown` — 1 credit. Params to use:

| Param | Value | Why |
|---|---|---|
| `url` | `docChange.url` (the changed page itself, from the webhook) | |
| `maxAgeMs` | `0` | Force a fresh fetch — we are here *because* the page changed; a 24h-default cache hit would hand us the pre-change page and poison the diagnosis |
| `useMainContentOnly` | `true` | Strip nav/footer noise from the excerpt that goes into the prompt |
| `waitForMs` | omit `[HACKATHON]` (mirror is static) / `2000–5000` `[GENERAL]` for JS-heavy docs sites | max 30000 |

Response: `{ "success": true, "url": "...", "markdown": "..." }`. Failure modes (`WEBSITE_ACCESS_ERROR`, `REQUEST_TIMEOUT`, …): retry once, then proceed with **webhook evidence only** (`diff` + excerpts) and note "live docs unavailable" in the evidence — the webhook diff alone is often sufficient, and `uncertain` remains the honest floor.

### 6.2 S4b — Extract structured contract facts (Context.dev Extract) `[GENERAL — optional for HACKATHON]`

The markdown is for humans and for the Devin prompt; the *gate* wants machine-checkable facts. `POST https://api.context.dev/v1/web/extract` — 10 credits, synchronous:

```json
{
  "url": "<docChange.url>",
  "instructions": "Extract API contract changes from this changelog/documentation page: endpoints, fields, or parameters that were added, renamed, removed, or deprecated, with the API version each change belongs to.",
  "schema": {
    "type": "object",
    "properties": {
      "changes": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "apiVersion":  { "type": "string" },
            "endpoint":    { "type": "string", "description": "path like /v1/payment_intents, empty if page-wide" },
            "object":      { "type": "string", "description": "e.g. PaymentIntent" },
            "field":       { "type": "string" },
            "changeType":  { "type": "string", "enum": ["added", "renamed", "removed", "deprecated", "behavior_changed"] },
            "replacement": { "type": "string" },
            "description": { "type": "string" }
          }
        }
      }
    }
  },
  "factCheck": true,
  "maxPages": 1
}
```

`factCheck: true` forbids inferred values — exactly right for evidence that ends up cited on a dashboard. Response `data` matches the schema; write `changes[].endpoint` into `docChanges.affectedEndpoints` and `changeType ∈ {removed, renamed, deprecated}` into `isBreaking`.

`[HACKATHON]` decision: skippable. The mirror's change is a single known entry and the webhook `summary`+`diff` already names `charges`→`latest_charge`; the Claude diagnosis call (§6.5) can populate `affectedEndpoints`/`contractChange` itself. Build S4b only if time allows — it is, however, the single best "Context.dev structured extraction is load-bearing" talking point for the Partner Integration criterion, and it's ~30 minutes of work. Recommended: build it behind a flag, demo it if stable.

### 6.3 S5 — Fetch the customer's actual integration code

`[HACKATHON]` — InvoicePilot is public; fetch exactly one file, no tokens:

```
GET https://raw.githubusercontent.com/{GITHUB_ORG}/invoicepilot/HEAD/{integration.integrationPath}
```

Cache the last-good copy on the incident (or a small table) so a GitHub blip doesn't kill the demo. If the file cannot be retrieved at all: **verdict = `uncertain`, never guess** (plan R6 requirement).

`[GENERAL]` — private repos: `GET https://api.github.com/repos/{org}/{repo}/contents/{path}` with a **read-only** fine-grained PAT held by Sentinel (Devin's write access continues to come from its own GitHub App; keep the credentials separate on principle).

**Explicit non-goal:** do not crawl, index, or embed the repository. One registered file is the diagnosis input. The repo-wide search is Devin's job (§6.4). This is both the plan's constraint and the right latency/cost call.

### 6.4 The "indirectly related lines of code" question — resolved

The product vision says the agent cross-checks "line by line … and any other LoC that are related even indirectly." That work is **split across two tiers by design**:

- **Tier 1 (diagnosis gate, here):** prove non-zero blast radius from the *registered* integration file only. Fast, deterministic, cited. Its output is a verdict + the exact lines in the adapter that read the changed contract element.
- **Tier 2 (Devin, §7):** the repair session's prompt explicitly instructs Devin to search the whole repo for direct *and indirect* usages (re-exports, helpers that destructure the field, tests, fixtures, types) before patching. Devin has the full clone, an editor, grep, and a runtime — it is strictly better at this than any pre-flight static pass we could build in a day, and it only runs after impact is proven.
- `[GENERAL]` middle tier, optional: between gate and launch, one GitHub code-search call (`GET /search/code?q=repo:{org}/{repo}+"charges"` etc.) to enumerate candidate files and pass them to Devin as "also check these." Cheap breadth hint, never a gate input. Skip for the hackathon.

### 6.5 S6 — The impact gate (deterministic pre-gate → Claude → post-validation)

**Deterministic pre-gate (before spending a model call):** does the changed endpoint/object overlap the registration? Compare `docChanges.affectedEndpoints` (or the webhook diff text) against `integration.endpoint` and `expectedContract`. No overlap at all ⇒ short-circuit `not_impacted` with reason "changed endpoints {X} do not include registered endpoint {Y}". This is the "docs change is irrelevant" risk mitigation and it costs zero.

**Claude call** — Anthropic API, model `claude-haiku-4-5`, temperature 0, JSON-only response. Inputs, all of which already exist by this point:

1. The change: webhook `summary`, `diff`, `before/after_text_excerpt`, S4b structured facts if present.
2. The latest docs markdown (S4a), truncated to the relevant section (grep the markdown for the changed field/endpoint names; take ±80 lines; hard cap ~8k tokens).
3. The registration: `provider`, `endpoint`, `expectedContract`, `activeContractVersion`, `integrationPath`.
4. The actual file contents (S5), with line numbers prepended (`1: import …`) so citations are checkable.

Required output shape (R6 — exact):

```json
{
  "verdict": "impacted" | "not_impacted" | "uncertain",
  "confidence": 0.0,
  "summary": "one paragraph, dashboard-ready",
  "affectedEndpoints": ["/v1/payment_intents"],
  "contractChange": "charges removed from PaymentIntent (2022-11-15); use latest_charge",
  "codeEvidence": ["src/lib/stripe.ts:47 reads pi.charges.data[0].receipt_url", "src/lib/stripe.ts:52 reads pi.charges.data[0].status"],
  "evidence": ["Changelog 2022-11-15: 'Removes the charges attribute from the PaymentIntent object — use latest_charge instead'"]
}
```

System-prompt essentials: *you are gating an automated code-repair pipeline; a false `impacted` wastes an expensive repair, a false `not_impacted` ships an outage — when evidence is incomplete say `uncertain`; every `impacted` verdict MUST cite (a) the changed contract element from the docs and (b) the file:line in the provided code that uses it; cite only lines that actually appear in the provided file.*

**Post-validation (code, not vibes) — an `impacted` verdict is accepted only if:**
- `codeEvidence` is non-empty and every cited `file:line` actually exists in the fetched file AND the cited line contains the referenced symbol (string-check it);
- `evidence` names the changed contract element;
- `affectedEndpoints` overlaps the registered endpoint.

Any check fails ⇒ downgrade to `uncertain`. Then apply the gate:

| Verdict | Incident status | Side effects |
|---|---|---|
| `not_impacted` | `not_impacted` (terminal) | `events` row; dashboard shows the change was seen and consciously skipped — **demo this state too if possible; "it doesn't panic-fix" is a selling point** |
| `uncertain` | `needs_review` | `events` row `level: "warn"`; human decides; a dashboard button may manually promote to `repair_queued` |
| `impacted` | `repair_queued` | persist verdict fields onto the incident; `ctx.scheduler.runAfter(0, internal.devin.launch, { incidentId })` |

Also backfill `docChanges.isBreaking = true` and `docChanges.affectedEndpoints` from the diagnosis if S4b didn't run.

---

## 7. S7 — Remediate: the Devin session

### 7.1 Launch preconditions (guards inside `devin.launch`)

- product has `repo` (absent ⇒ observer mode: log event, stop);
- incident `status === "repair_queued"` and `diagnosisVerdict === "impacted"`;
- no existing session for this incident (`sessions.by_incident`) in a non-terminal state.

### 7.2 The evidence packet → prompt

Assemble from the incident graph (incident + docChange + triggerEvents + errors + diagnosis). R3 template, final form:

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
{docChange.summary}
{webhook diff block}
Latest docs excerpt: {relevant markdown section}
Docs URL: {docChange.url}
Affected element: {diagnosis.contractChange}

## Runtime evidence (if present)
{for each error: sanitized message, endpoint, status code, observed contract version}
New-contract response fixture: {captured 2022-11-15-shaped response, if available}

## Diagnosis
{diagnosis.summary}
Code evidence: {diagnosis.codeEvidence lines}

## Task
1. Inspect {integration.integrationPath} and confirm the diagnosis.
2. Search the rest of the repository for any other code that depends on the old
   contract, directly or indirectly (imports of this module, helpers, types,
   tests, fixtures that reference the changed field). List what you find in the
   PR body; fix what is genuinely affected.
3. Make the smallest integration-only change so the code works with the new
   contract. Do not refactor unrelated code. Do not touch the vendor or its docs.
4. Update or add a regression test covering the NEW contract shape (fixture provided above).
5. Run: {integration.testCommand}
6. Open a PR titled "fix: {incident.title}" citing this incident's evidence in the body.
7. Report pr_url, summary, root_cause, tests_passed, test_summary in your structured output.

If the evidence is insufficient or the code is not actually affected, report that
in your structured output instead of forcing a patch.
```

(Step 2 is the deliberate Tier-2 home of "indirectly related LoC" — see §6.4. It is the only change vs. the plan's R3 template and is purely additive.)

### 7.3 Devin API — launch `[HACKATHON: v1, as verified in the plan]`

`POST https://api.devin.ai/v1/sessions`, `Authorization: Bearer $DEVIN_API_KEY`:

```json
{
  "prompt": "<evidence packet above>",
  "idempotent": true,
  "max_acu_limit": 5,
  "title": "Sentinel: {incident.title}",
  "tags": ["sentinel", "docs-sentinel"],
  "structured_output_schema": {
    "type": "object",
    "properties": {
      "pr_url":       { "type": "string" },
      "summary":      { "type": "string" },
      "root_cause":   { "type": "string" },
      "tests_passed": { "type": "boolean" },
      "test_summary": { "type": "string" }
    }
  }
}
```

→ `{ "session_id": "devin-xxx", "url": "https://app.devin.ai/sessions/xxx", "is_new_session": true }`

Notes that matter:
- `idempotent: true` dedupes by identical prompt — an accidental double-launch with the same packet returns the same session (`is_new_session: false`). Keep the launch guard anyway; a *re-diagnosed* incident produces a different timestamp in the prompt and would not dedupe.
- `max_acu_limit: 5` is the cost guard (§C of the plan). If a session dies at the cap, that surfaces as a failure in polling → `repair_failed`, human takes over. Don't silently raise the cap in code.
- `structured_output_schema`: JSON Schema Draft 7, ≤64KB, no external `$ref`.
- Repo access comes from the Devin GitHub App installation; the repo is named in the prompt. No repo field exists in v1.
- On launch: insert `sessions` row (`trigger: "docs"`, `incidentId`, `devinSessionId`, `devinUrl`, `status: "working"`, `prompt`), advance incident → `repairing`, `events` row.

### 7.4 Poll loop — `devin.poll`

No outbound webhooks exist in the Devin API; polling is the documented pattern. Cron every 20s **only while** any session is non-terminal (cost guard):

`GET https://api.devin.ai/v1/sessions/{session_id}` → read `status_enum`, `structured_output`, `pull_request`.

| Observation | Action |
|---|---|
| `status_enum: "working"` | update `sessions.status`; no transition |
| `status_enum: "blocked"` | auto-nudge once: `POST /v1/sessions/{id}/message` `{"message": "Proceed with your best judgment."}`; if blocked again after a nudge, leave it — do not nudge-loop; surface on dashboard |
| `structured_output` appears/updates | persist to `sessions.structuredOutput`; copy `tests_passed`/`test_summary` → `testStatus`/`testSummary` |
| `pull_request.url` appears | persist `prUrl` (+ parse `prNumber`); incident → `validating` |
| `status_enum: "finished"` | **PR exists AND `tests_passed === true`** ⇒ incident → `repair_proposed` (final; a human merges). PR missing OR tests failed/unknown ⇒ `repair_failed` |
| `status_enum: "expired"` (or any terminal without PR) | `repair_failed`, `events` row `level: "critical"` |

Every transition writes `events` — the dashboard's incident drawer is literally a render of this feed.

**"Validating" semantics, stated honestly:** the test run happens *inside* the Devin session (step 5 of the prompt); `validating` is the platform waiting for the structured confirmation that the named `testCommand` passed, not a second CI system. Cutting CI re-verification is a deliberate hackathon scope decision; PR review is the human gate either way.

### 7.5 `[GENERAL]` Devin v3 API migration notes (read before building on v1 long-term)

Devin's current docs recommend the org-scoped v3 API for new integrations. v1 works and is what the team verified — ship the hackathon on v1 — but whoever productionizes should know the deltas:

| Concern | v1 (used here) | v3 (`/v3/organizations/{org_id}/sessions`) |
|---|---|---|
| Auth | same `Authorization: Bearer` | Service-User API key (`cog_…`) + org id; RBAC permissions (`UseDevinSessions`, `ViewOrgSessions`, `ManageOrgSessions`) |
| Repo scoping | prompt text only | first-class `repos: ["org/repo"]` array |
| Idempotency | `idempotent: true` | **no such field** — dedupe yourself (by `tags`/`title` lookup before create) |
| Status | `status_enum` (`working/blocked/finished/expired/…`) | `status` (`new/claimed/running/exit/error/suspended/resuming`) + `status_detail` (`working/waiting_for_user/finished/…`) |
| PR field | `pull_request.url` | `pull_requests[]` array — read `[0].url` |
| Extras | — | `devin_mode` (`fast`/`lite`/…), `resumable: false` for disposable runs, `structured_output_required` (default true), `playbook_id`, `session_secrets` |
| Follow-up msg | `POST /v1/sessions/{id}/message` | `POST /v3/…/sessions/{id}/messages` (note plural) |

v3 also supports **playbooks** properly: long-term, the entire §7.2 Task section becomes an org playbook (`!api-contract-repair`) with a `structured_output_schema` attached, and each launch passes only the per-incident evidence — cleaner, versioned, and reviewable. `[HACKATHON]`: inline prompt, no playbook; one less moving part.

---

## 8. S8 — Corroboration: the runtime trigger meets the docs trigger

Owned by the reactive path (`POST /ingest/errors`, bearer `SENTINEL_INGEST_TOKEN`), but its convergence behavior is part of *this* agent's story:

- Runtime failure arrives → sanitized → `errors` row + `triggerEvents` row (`source: "runtime"`) → same `incidents.receiveTrigger`.
- Its fingerprint (`integrationId + endpoint + observed Stripe-Version`) matches the docs incident's fingerprint ⇒ **attach, never duplicate**: error linked to the incident, `events` row "runtime failure corroborates docs-change incident", zero new sessions.
- Ordering symmetry (worth one demo sentence): if runtime had fired *first*, the same incident would exist with `source: runtime`, the same `gatherAndDiagnose` runs (docs fetched via monitor's URL even without a webhook), and a later docs webhook would attach to it. The spine is direction-agnostic.
- Bonus evidence: the captured failing response (2022-11-15 shape) gets added to the Devin packet as the regression-test fixture if the repair hasn't launched yet.

---

## 9. Failure modes & fallbacks (rehearse these, not just the happy path)

| Failure | Detection | Fallback |
|---|---|---|
| Webhook never arrives on stage | no incident within ~60s of run-now | §4.4 poll fallback button (`GET /monitors/{id}/changes` → same ingestion path); persisted incident timeline from the pre-run (§T pre-warm) as exhibit |
| Webhook arrives twice | duplicate `change.id` | idempotent ingress (§4.3.1) — second delivery is a 200 no-op |
| Signature fails (secret mismatch after redeploy) | 401s in log + Context.dev failure emails | `CONTEXT_WEBHOOK_SECRET` is per-monitor: re-check after any monitor re-creation; rotate-secret endpoint if needed |
| Fresh docs fetch fails | markdown call error | proceed on webhook `diff`/excerpts; verdict floor `uncertain` |
| Integration file fetch fails | GitHub error | cached last-good copy; else verdict = `uncertain` (never guess) |
| Claude returns malformed JSON | parse error | one retry with "return only valid JSON"; then `uncertain` |
| Claude hallucinates line citations | post-validation string-check (§6.5) | auto-downgrade to `uncertain` |
| Devin `blocked` | poll | single auto-nudge, then human |
| Devin finishes with no PR / failing tests | poll terminal check | `repair_failed` + critical event; humans see full session URL |
| Devin hits ACU cap | terminal without PR | same as above; do not auto-relaunch (cost guard) |
| Double trigger (docs + runtime racing) | shared fingerprint | attach-not-duplicate in `receiveTrigger`; launch guard in `devin.launch`; `idempotent: true` as the third net |
| Context.dev monitor paused (`MONITOR_PAUSED` after repeated scrape failures — 3-strike baseline / 10-strike established) | run-now returns error | dashboard warn; for the mirror this can't realistically happen (own infra) |

---

## 10. Observability: the war-room feed is part of the product

Every stage writes `events` rows (`sentinel: "integration"`). Minimum set, in demo order:

1. `Docs change detected on {provider} docs — "{change.summary}"` (info)
2. `Gathering context: fetched latest docs ({n} chars) + {integrationPath}@{sha|HEAD}` (info)
3. `Diagnosing impact…` (info)
4. `Verdict: IMPACTED — {contractChange}. Code evidence: {codeEvidence[0]}` (critical) — *this is the money row; it must name both the removed field and the adapter line*
5. `Repair queued → Devin session {devinUrl}` (info)
6. `Devin opened PR #{n}: {prUrl}` (info)
7. `Tests passed ({testSummary}) — repair proposed, awaiting human review` (info)
8. (corroboration) `Runtime failure attached as corroborating evidence — no duplicate repair` (warn)

The dashboard's incident drawer renders exactly this feed; if the feed reads like the demo script, the demo narrates itself.

---

## 11. Cost & rate budget (fits comfortably in credits)

| Item | Cost | Day's worst case |
|---|---|---|
| Monitor runs (10-min interval + run-nows) | 1–10 credits/run | ~100 runs ≈ ≤1000 credits |
| Markdown fetches (per incident + rehearsals) | 1 credit | ~20 |
| Extract calls (if S4b built) | 10 credits | ~10 rehearsal + demo ≈ 100 |
| Claude `claude-haiku-4-5` diagnosis | fractions of a cent | negligible |
| Devin sessions | ≤5 ACUs each, ~4–8 sessions | within vending-machine credits |
| Rate limits | Monitors: own 1000 req/min bucket; data API: plan RPM (dev plan 60/min) — nothing here approaches either | — |

Convex cron discipline: Devin poll runs only while a session is active; monitor-poll fallback (if built) every 5 min is 1 request per integration, no credits (list endpoints are reads).

---

## 12. Build order for this agent (assumes Phase 0 scaffolding done)

1. **Ingress first, with a fake:** implement `/webhooks/context` verification + normalization; unit-drive it by curling a hand-built signed payload (compute the HMAC in a scratch script with the same secret). No Context.dev dependency yet.
2. **Spine:** `incidents.receiveTrigger` with fingerprint dedupe + state machine helper + `events` writes. Drive with the fake webhook.
3. **Gather & diagnose:** S4a markdown fetch → S5 file fetch → §6.5 pre-gate + Claude call + post-validation → gate. Test all three verdicts: run it against the v2022-08-01 mirror (expect `not_impacted` on a cosmetic edit), the v2022-11-15 flip (expect `impacted` with both citations), and with the GitHub fetch stubbed to fail (expect `uncertain`).
4. **Wire the real monitor** (§3.2) against the mirror; baseline on v1 docs; flip + run-now; watch the real webhook traverse steps 1–3.
5. **Connect `devin.launch`** (Phase 1 built it; you supply the packet builder §7.2) + extend `devin.poll` transitions (§7.4).
6. **Corroboration:** fire InvoicePilot's broken payment flow; verify attach-not-duplicate.
7. **(flagged, optional) S4b extract** + `[GENERAL]` touches only if everything above is green.

Acceptance = Phase 2's: flip → run-now → `detected → gathering_context → diagnosing → repair_queued → repairing → validating → repair_proposed`, diagnosis citing both the removed `charges` field and the adapter line reading it, passing regression test, real PR; second trigger attaches evidence without a second session.

---

## Appendix A — Context.dev quick reference (only what this agent uses)

Base `https://api.context.dev/v1` · `Authorization: Bearer $CONTEXT_API_KEY` · errors: `{message, error_code, key_metadata:{credits_consumed, credits_remaining}}` · rate headers `X-RateLimit-{Limit,Remaining,Reset}`.

| Call | Purpose here | Cost |
|---|---|---|
| `POST /monitors` | S0 create (page+semantic; schedule ≥10 min; webhook `change.detected`; **save `id` + `webhook.secret`**) | 0 (runs 1–10) |
| `POST /monitors/{id}/run` | demo run-now → 202 + `run_id` | run cost |
| `GET /monitors/{id}/changes`, `GET /monitors/changes/{change_id}` | poll fallback / full change record | read |
| `POST /monitors/{id}/webhook/rotate-secret` | secret rotation | 0 |
| `GET /web/scrape/markdown?url&maxAgeMs=0&useMainContentOnly=true` | S4a fresh docs | 1 |
| `POST /web/extract` (`schema`, `instructions`, `factCheck:true`, `maxPages:1`) | S4b structured contract facts | 10 |
| `GET /web/scrape/sitemap?url` | `[GENERAL]` docs-surface discovery | 1 |

Webhook: headers `X-Context-Event` / `X-Context-Signature: t=<unix>,v1=<hmac>` / `X-Context-Id`; HMAC-SHA256 over `"{t}.{rawBody}"` keyed by `whsec_…`; constant-time compare; reject stale `t`; reply 2xx fast. Payload: `{event, id, created_at, data.change{id, monitor_id, run_id, target_type, change_detection_type, title, summary, detected_at, url, importance, confidence, diff, before_text_excerpt, after_text_excerpt, added_urls?, removed_urls?}}`.

## Appendix B — Devin quick reference (v1, as used)

Base `https://api.devin.ai/v1` · `Authorization: Bearer $DEVIN_API_KEY`.

| Call | Purpose | Key fields |
|---|---|---|
| `POST /sessions` | launch repair | `prompt`, `idempotent: true`, `max_acu_limit: 5`, `title`, `tags`, `structured_output_schema` (Draft-7, ≤64KB, no external $ref) → `{session_id, url, is_new_session}` |
| `GET /sessions/{id}` | poll (20s cron while active) | `status_enum` ∈ `working\|blocked\|finished\|expired\|…`, `pull_request.url`, `structured_output` |
| `POST /sessions/{id}/message` | unblock nudge (once) | `{"message": "Proceed with your best judgment."}` |

No outbound webhooks — polling is the pattern. Repo access via the Devin GitHub App (installed org-wide); the repo is named in the prompt. Structured output contract used platform-wide: `{pr_url, summary, root_cause, tests_passed, test_summary}`. v3 deltas in §7.5.

## Appendix C — The Vapi × ElevenLabs framing (for the pitch, not the build)

Deployed on a company like Vapi, this exact pipeline reads: Sentinel holds a registration for every third-party provider Vapi's product depends on (ElevenLabs TTS, Deepgram STT, Twilio telephony, OpenAI…). Context.dev monitors each provider's changelog and the reference pages for the specific endpoints Vapi calls. When ElevenLabs deprecates a model id or renames a response field, the monitor fires within one schedule interval; Sentinel proves whether `src/providers/elevenlabs.ts` (and, via Devin's in-session sweep, anything that depends on it) actually reads the changed contract; and if so, a tested PR migrating to the replacement is waiting for review — typically before the deprecation window closes and before a single call fails in production. Nothing in the architecture changes between the demo and this deployment except rows in `integrations` and the monitors' target URLs — which is precisely the claim: **agent = source + trigger + mandate, and adding one is configuration, not code.**
