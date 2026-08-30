# Dashboard History Panels ("Changelog Updates" + "Reviews Updates") — Architecture Guide

*Handoff document, part of the `ADDONS/` enhancement set. Extends Phase 4 of `IMPLEMENTATION_PLAN.md` (ReactBits Dashboard 4 shell, everything reactive via Convex `useQuery`). Assumes Agents A (`AGENT_API_CHANGELOG_SENTINEL.md`) and B (`AGENT_VENDOR_REPUTATION_SENTINEL.md`) write their tables as specified.*

---

## 0. What this is

An **Agents subpage** with two side-by-side history panels — the permanent record of everything the two sentinels have ever done, one row per completed piece of work:

- **Changelog Updates** — Agent A's history: every provider docs change ever processed, with its verdict and outcome. Docs change all the time; over months this becomes rows and rows of "seen it, judged it, fixed it / skipped it."
- **Reviews Updates** — Agent B's history: every vendor-complaint issue that crossed the radar, with the path taken (workaround / migration / report-only / not relevant) and outcome.

This is a different lens from the existing Phase-4 incident view. That view answers *"what is happening right now?"* (live states, one incident's drawer). These panels answer *"what has this thing been doing for us?"* — the accumulation view that makes the product feel like an employee with a track record rather than a demo that fires once. Rows are terse; every row deep-links to the existing incident/issue drawer and to its report (`ADDONS/REPORT_PIPELINE.md`). No new detail UI is built here.

---

## 1. Information design

### 1.1 Changelog Updates panel — one row per processed docs change

| Column | Source | Render |
|---|---|---|
| When | `docChanges._creationTime` | relative ("2h ago") + exact on hover |
| Provider | `integrations.provider` via `docChanges.integrationId` | logo/initial chip + name |
| Change | `docChanges.summary` | single line, truncated ~90 chars, full text in tooltip |
| Verdict | `incidents.diagnosisVerdict` (via `docChanges.incidentId`) | badge: `impacted` red · `not_impacted` gray · `uncertain` amber · "—" if still pre-verdict |
| Outcome | `incidents.status` + `sessions` (via `by_incident`) | see badge map §1.3; PR link (`#12 ↗`) when present |
| Report | `reports.by_subject("incident", incidentId)` | doc icon → report route; hidden if none |

Row click → the existing incident detail drawer. Rows where a docs change produced **no incident** (future: monitor fired for an unregistered page) still render with Verdict "—" — the panel's promise is *every* update, not every fix.

### 1.2 Reviews Updates panel — one row per vendor issue

| Column | Source | Render |
|---|---|---|
| When | `vendorIssues.firstSeenAt` (+ `lastSeenAt` on hover) | relative |
| Provider / Feature | `vendorIssues.provider`, `.feature` | chip + slug ("elevenlabs · tts-websocket-streaming") |
| Signal | `.complaintCount`, `.distinctAuthors` | "7 complaints · 4 users" |
| Path | derived from status history (§1.3) | badge: Workaround · Migration · Report-only · Not relevant · Outage advisory · Watching |
| Outcome | `vendorIssues.status` + session | badge + PR link when present |
| Report | `reports.by_subject("vendorIssue", issueId)` | doc icon |

Row click → the vendor-issue drawer (Agent B's card).

### 1.3 Status → badge map (single shared module, `src/lib/statusBadges.ts`)

One exported map used by both panels *and* the existing incident views, so colors never drift:

| Bucket | Statuses | Treatment |
|---|---|---|
| In flight | `detected`, `gathering_context`, `diagnosing`, `on_radar`, `assessing_relevance`, `researching_*`, `repairing`, `validating`, `*_queued` | blue, pulsing dot |
| Shipped | `repair_proposed`, `pr_proposed` | green, "PR open" (+ "merged" variant when `prState` known) |
| Human needed | `needs_review`, `replacement_proposed` (approval gate) | amber |
| Failed | `repair_failed`, `pr_failed` | red |
| Consciously skipped | `not_impacted`, `not_relevant`, `vendor_outage`, `report_only` | gray — **render these proudly; "it chose not to act" is a headline feature, not an empty state** |

---

## 2. Data layer (Convex)

### 2.1 Server-side join queries — the panels never join client-side

Two paginated queries in a new `convex/history.ts`, each returning fully denormalized row DTOs. Convex queries are reactive, so both panels live-update as agents work — an incident visibly walks through states during the demo without a refresh.

```ts
// convex/history.ts
export const changelogRows = query({
  args: { productId: v.id("products"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { productId, paginationOpts }) => {
    const page = await ctx.db.query("docChanges")
      .withIndex("by_product", q => q.eq("productId", productId))
      .order("desc")
      .paginate(paginationOpts);
    return { ...page, page: await Promise.all(page.page.map(async dc => {
      const incident = dc.incidentId ? await ctx.db.get(dc.incidentId) : null;
      const session  = incident?.sessionId ? await ctx.db.get(incident.sessionId) : null;
      const report   = incident ? await ctx.db.query("reports")
        .withIndex("by_subject", q => q.eq("subjectType", "incident").eq("subjectId", incident._id))
        .first() : null;
      return {                       // the row DTO — everything the panel renders, nothing more
        id: dc._id, at: dc._creationTime,
        provider: dc.raw?.provider ?? "", summary: dc.summary,
        verdict: incident?.diagnosisVerdict ?? null,
        status: incident?.status ?? null,
        prUrl: session?.prUrl ?? null, prNumber: session?.prNumber ?? null,
        incidentId: incident?._id ?? null, reportId: report?._id ?? null,
      };
    }))};
  },
});

export const reviewsRows = query({ /* same shape over vendorIssues via by_product,
  joining sessions + reports("vendorIssue", issueId); adds complaintCount,
  distinctAuthors, feature, and a derived `path` field */ });
```

Notes for the implementer:
- `order("desc")` on the index gives newest-first by `_creationTime` — no new schema fields needed for ordering.
- Provider on the changelog row: either denormalize `provider` onto `docChanges` at insert (one-word schema addition, recommended) or fetch the integration row in the join — pick one, don't do both.
- `path` derivation for reviews rows: from the terminal/current status (`workaround_queued|…→ "workaround"`, `researching_alternatives|replacement_proposed|migration_queued → "migration"`, etc.) — pure function next to the badge map.
- Keep DTOs flat and serializable; the panel components must not need `ctx.db` knowledge.

### 2.2 Pagination

`usePaginatedQuery(api.history.changelogRows, { productId }, { initialNumItems: 25 })` with a "Load more" row. History is unbounded by design ("past X years") — never fetch it all.

### 2.3 PR merge status `[GENERAL]`

Rows gain a "merged" state via a low-frequency cron (`history.refreshPrStates`, hourly, only rows with `prUrl` and unknown/open state) hitting the public GitHub REST API (`GET /repos/{org}/{repo}/pulls/{n}` — unauthenticated works for public repos, 60 req/h/IP) and stamping `sessions.prState: "open" | "merged" | "closed"`. `[HACKATHON]`: skip the cron; add a "Mark merged" admin action if the demo script merges a PR live.

---

## 3. UI composition (Phase-4 rules apply)

- **Placement:** a new route/tab "Agents" in the Dashboard-4 shell. Desktop: two panels in a responsive 2-col grid (changelog left — it's the primary story). Mobile: stacked, changelog first. Reuse the template's card + table/list primitives; build no new design system pieces.
- **Panel header:** title, all-time count (`N processed` — a tiny separate count query or just "…" until loaded), and a status filter chip row (All · Shipped · Skipped · Failed · Human needed) that maps to a server-side filter arg on the query (add an optional `bucket` arg; filter in the handler before pagination).
- **Loading/empty:** `useQuery === undefined` ⇒ skeleton rows (template's skeleton primitive). Empty ⇒ purposeful copy, not a blank: *"No docs changes processed yet — the monitor checks every 10 minutes."* / *"No vendor issues on the radar."*
- **Live-row affordance:** rows whose status is in the "in flight" bucket get the pulsing dot; when a row transitions (reactive update), a brief highlight animation — this is the free "it's alive" moment during the demo.
- **Deep links:** row → drawer (existing), report icon → `/reports/{id}` (print-CSS route from `ADDONS/REPORT_PIPELINE.md`), PR chip → GitHub in new tab.

## 4. Demo seeding (the panels must not look newborn)

A `seed.demoHistory` mutation inserts ~8–12 plausible historical rows per panel (older `_creationTime` cannot be forged — set an explicit `at`/`firstSeenAt` field where the schema has one, or simply accept "earlier today" timestamps and write summaries as past work). Every seeded row is a *complete* row: verdict, outcome badge, and (for 2–3 of them) a seeded report so the doc icon works. Mix the buckets deliberately — a history that is 100% green reads as fake; include `not_impacted` and `report_only` rows because the "chose not to act" story is a differentiator. Keep the seed idempotent (check-before-insert) and clearly named so it's disclosed as synthetic data per hackathon rules.

## 5. Failure modes

| Failure | Handling |
|---|---|
| Join target missing (incident deleted, report not yet generated) | DTO fields null → panel renders "—"; never throws |
| Huge history | pagination only; count query capped or approximated |
| Query latency from N+1 joins on a page | page size 25 keeps it trivial; if it ever matters, denormalize outcome fields onto `docChanges`/`vendorIssues` at transition time (the state-machine helpers are the single write point, so this is a 5-line change later) |
| Badge drift between views | single `statusBadges.ts` module, imported everywhere |

## 6. Build order

1. `history.changelogRows` + seeded data → verify DTOs in the Convex dashboard before any UI.
2. Changelog panel with skeleton/empty states + badges + pagination.
3. `history.reviewsRows` + Reviews panel (clone, don't abstract prematurely — two honest copies beat one wrong abstraction under hackathon time).
4. Filter chips (server-side `bucket` arg).
5. `seed.demoHistory` + a rehearsal pass confirming live transitions animate during an end-to-end agent run.
6. `[GENERAL]` PR-state cron last.
