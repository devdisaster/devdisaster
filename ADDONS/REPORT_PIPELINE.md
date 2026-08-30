# Incident Report Pipeline — Architecture Guide

*Handoff document, part of the `ADDONS/` enhancement set. Companion to `AGENT_API_CHANGELOG_SENTINEL.md` (Agent A) and `AGENT_VENDOR_REPUTATION_SENTINEL.md` (Agent B). Assumes the platform scaffolding from `IMPLEMENTATION_PLAN.md` exists.*

**Tags:** `[HACKATHON]` = build for the demo · `[GENERAL]` = production notes.

---

## 0. What this is

Both agents currently end at a PR. The PR is the *artifact for the repo*; this pipeline produces the *artifact for the human*: a *report* — a simply-written markdown document that explains, end to end and in plain language, what was detected, what evidence was gathered, what was done, and what the reader must do next. It is:

- generated automatically at every informative terminal state of either agent,
- stored in Convex as the canonical markdown (PDF is a *rendering* of it, never the source of truth),
- the single upstream artifact for the two delivery channels built in the sibling guides: **email** (`ADDONS/EMAIL_CONNECTOR.md`) and **voice call** (`ADDONS/VOICE_CALL_COMPONENT.md`). Both consume fields of the report row; neither re-derives anything from the incident graph. One fan-out point, one consistent story on every channel.

Design rule that governs everything below: **facts come from rows, prose comes from the model, and the model is never allowed to introduce a fact.** A report is a rendering of the database, with Claude used only as a plain-language explainer over content we hand it.

---

## 1. Contract with the platform

### 1.1 Schema addition (additive)

```ts
// merge into convex/schema.ts
reports: defineTable({
  productId: v.id("products"),
  agent: v.union(v.literal("docs"), v.literal("reputation"), v.literal("feedback")),
  subjectType: v.union(v.literal("incident"), v.literal("vendorIssue"), v.literal("cluster")),
  subjectId: v.string(),                    // stringified Id — subjects live in different tables
  title: v.string(),                        // "Sentinel Report: Stripe removed `charges` — repair PR #12 open"
  outcome: v.string(),                      // terminal state that triggered it, e.g. "repair_proposed"
  summary: v.string(),                      // 2–3 sentence executive summary (email preview + voice-call brief reuse this)
  markdown: v.string(),                     // the canonical full report
  pdfStorageId: v.optional(v.id("_storage")), // only if a real PDF was generated (§4)
  status: v.union(v.literal("final"), v.literal("failed")),
}).index("by_product", ["productId"]).index("by_subject", ["subjectType", "subjectId"]),
```

Sizing note: Convex documents cap at ~1 MB; these reports are 5–50 KB of markdown — keep the markdown inline in the row (simplest reactive reads). Only binary renderings (PDF) go to Convex File Storage.

### 1.2 New function file: `convex/reports.ts`

- `reports.generate` — internalAction (needs Anthropic fetch): builds and stores the report, then schedules deliveries.
- `reports.get`, `reports.listByProduct` — queries for the dashboard.
- `reports.renderHtml` — helper used by the email connector (markdown → HTML, §4.2).

### 1.3 Trigger points (where generation is scheduled)

One line added at each terminal transition, via the existing state-machine helpers (`advanceIncident` / `advanceIssue`) so no call site can forget it:

| Agent | States that produce a report | Report flavor |
|---|---|---|
| A (docs) | `repair_proposed` | full repair report *(the flagship)* |
| A (docs) | `repair_failed`, `needs_review` | escalation report — "Sentinel needs a human" |
| A (docs) | `not_impacted` | `[GENERAL]` optional one-page advisory ("change seen, you're safe, here's why"); `[HACKATHON]` skip — dashboard card suffices |
| B (reputation) | `pr_proposed` | workaround/migration report incl. ranked-alternatives table |
| B (reputation) | `report_only` | vendor-risk report (this state *exists* to become a report) |
| B (reputation) | `pr_failed`, `needs_review` | escalation report |

Idempotency: before generating, check `reports.by_subject` for an existing `final` report with the same `outcome` — regenerate only on explicit admin request (`reports.regenerate` mutation for the dashboard), never automatically twice.

---

## 2. Generation: deterministic skeleton, model-written prose

`reports.generate({ subjectType, subjectId, outcome })`:

**Step 1 — load the full subject graph** (all reads, one query helper per subject type):
- incident: incident row + linked `docChanges`, `triggerEvents`, `errors`, `sessions` (via `by_incident` indexes) + `events` timeline (via `by_incident`) + product + integration rows.
- vendorIssue: issue row + linked `vendorComplaints`, `replacementCandidates`, session, events, product, integration.

**Step 2 — build the fact sheet** (pure code, no model): a JSON object containing exactly the fields the template needs — timestamps, provider, endpoint, verdict + evidence arrays, PR url/number, test status/summary, structured output, complaint quotes with permalinks, ranked candidate table, ACU/credit counts if recorded. Anything missing renders as "not recorded", never invented.

**Step 3 — Claude writes the prose sections only.** One call, `claude-haiku-4-5`, temperature 0, JSON out:

```
System: You write the plain-language sections of an engineering incident report
for a developer who has 90 seconds. You will be given a FACT SHEET. You may only
restate facts from it — never add, infer, or embellish. Audience: a developer at
the affected company who has not seen this incident before. Style: short
sentences, no hype, no filler.
User: <fact_sheet>{json}</fact_sheet>
Return JSON:
{ "tldr": ["≤3 bullets: what happened / what Sentinel did / what you must do"],
  "what_happened": "1–2 short paragraphs",
  "why_it_matters": "1 short paragraph tied to the product's actual usage",
  "what_we_did": "1–2 short paragraphs walking the pipeline stages taken",
  "what_you_should_do": ["ordered checklist, concrete, e.g. 'Review PR #12', 'Provision PLAYHT_API_KEY before enabling the flag'"],
  "summary": "2–3 sentences for the email preview and phone briefing" }
```

Guardrail (same philosophy as both agents' post-validation): scan the returned prose for URLs, file paths, and numbers not present in the fact sheet — any hit ⇒ one retry with the violation named, then fall back to template-only prose (headings + raw fact-sheet fields, no model text) and mark the report `final` anyway. A blander report always beats a wrong one, and generation must never block the pipeline.

**Step 4 — assemble markdown from the fixed template** (§3), insert the row, then fan out:

```ts
const reportId = await ctx.runMutation(internal.reports.insert, {...});
await ctx.scheduler.runAfter(0, internal.email.sendReport, { reportId });      // ADDONS/EMAIL_CONNECTOR.md
await ctx.scheduler.runAfter(0, internal.voice.callAboutReport, { reportId }); // ADDONS/VOICE_CALL_COMPONENT.md (gated, see that doc)
```

---

## 3. The report template (fixed section order — do not let the model reorder it)

```markdown
# {title}

| | |
|---|---|
| Product | {product.name} |
| Agent | {Docs Sentinel | Reputation Sentinel} |
| Provider | {integration.provider} — {integration.endpoint} |
| Status | {outcome badge} |
| Date | {ISO timestamp} |
| Pull request | {prUrl or "—"} |

## TL;DR
{tldr bullets}

## What happened
{what_happened}

## Why it matters to {product.name}
{why_it_matters}
> Code evidence: {codeEvidence / relevanceEvidence lines, verbatim from the row}

## The evidence
{Agent A: docs diff block + before/after excerpts + docs URL + runtime errors if attached}
{Agent B: complaint quotes with permalinks + distinct-author count + window}

## What Sentinel did
{what_we_did}
{Agent B replacement reports also render the ranked-alternatives table here:
| Rank | Provider | Score | Feature verified | Notes |}

## The fix
- PR: {prUrl} ({prState if known})
- Tests: {testStatus} — {testSummary}
- Approach: {structuredOutput.approach / summary}
- Rollback: {flag flip instructions for migrations; revert for patches}

## What you should do now
{what_you_should_do as a checklist}
{followups_required from Devin's structured output appended verbatim}

## Full timeline
{events rows for this subject, chronological: "14:02:11 — Docs change detected …"}

## Appendix
- Devin session: {devinUrl}
- Sources cited: {docs URLs, permalinks}
- Generated by Sentinel {version/commit} at {timestamp}. Facts above are drawn
  directly from recorded pipeline state; prose sections are auto-written summaries of those facts.
```

The timeline section costs nothing (it's the `events` feed verbatim) and is the section reviewers trust most — never cut it.

---

## 4. PDF strategy (decided: markdown canonical, PDF is a view)

The user-facing requirement is "markdown that can be compiled to PDF, or PDF directly." Direct server-side PDF is the trap here: **Convex Node actions cannot run Puppeteer/Chromium** (bundle size + no system browser), so honest options are ranked:

| Option | How | Verdict |
|---|---|---|
| **Print-CSS route** | Dashboard route `/reports/{id}/print` renders the markdown (`react-markdown`, already-installed typography) with an `@media print` stylesheet; "Download PDF" button calls `window.print()` → the browser's native Save-as-PDF | ✅ `[HACKATHON]` default. Zero new deps, zero backend work, output looks exactly like the dashboard |
| Client-side PDF file | same route + `html2pdf.js`/`react-to-print`, then upload the blob to Convex File Storage via an upload URL → `pdfStorageId` | `[GENERAL]` only if a *stored* PDF artifact is required (e.g. for email attachment §4.2) |
| External HTML→PDF API (Doppio, PDFShift, Browserless) | Node action posts the rendered HTML, stores returned PDF via `ctx.storage.store` | `[GENERAL]` clean, but a new vendor + key for a rendering nicety — skip for the event |
| Server-side md-to-pdf npm | — | ❌ requires headless Chrome; does not run in Convex actions |

Email consequence (decided with the email guide): **emails send the report as a rendered HTML body, not a PDF attachment** — `marked` converts the stored markdown to HTML inside the Node action, inline-styled for mail clients. No PDF needed anywhere in the demo loop; the print route satisfies "give me a PDF" on demand.

---

## 5. Failure modes

| Failure | Handling |
|---|---|
| Claude call fails / malformed JSON | one retry → template-only fallback prose; report still `final` |
| Model invents a fact | URL/path/number guardrail scan → retry → fallback (§2 step 3) |
| Subject graph incomplete (e.g. session missing) | render "not recorded" placeholders; never block |
| Duplicate generation (state machine retriggers) | `by_subject` + `outcome` idempotency check |
| Report too large (pathological complaint volume) | cap quoted complaints at 10 (highest severity first, note the count of the rest) |
| Delivery scheduling fails | report row is already stored — deliveries are retried by their own guides' machinery; a report with failed delivery is still visible on the dashboard |

## 6. Observability

`events` rows (`sentinel: "system"`): `Report generated: "{title}"` (info) → link rendered on the incident/issue drawer and in both history panels (`ADDONS/DASHBOARD_HISTORY_PANELS.md`). Failed generation after fallback: `level: "warn"`.

## 7. Build order

1. Schema + `reports.insert`/`get`/`listByProduct` + a `seed.demoReport` for dashboard work in parallel.
2. Fact-sheet builders for both subject types (pure functions — unit-testable with seeded rows).
3. Template assembly with fallback prose only (no Claude yet) — verify a full report renders from a rehearsal incident.
4. Add the Claude prose call + guardrail scan.
5. Hook the trigger points into both agents' state-machine helpers.
6. Print-CSS route + Download PDF button.
7. Wire the two delivery schedulers (no-ops until the sibling guides land).
