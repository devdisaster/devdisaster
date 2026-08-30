# PRD — Sentinel (working name)

*Collabute × TheBlock AI Hackathon, Dubai — 30 Aug 2026*
*Team: Shashwat (SWE), Iyad (PM), Moein (Product Designer), Ash (Business Lead)*

---

## One-liner

An autonomous maintenance team for dev teams that can't afford to stop shipping: AI sentinels watch your users' complaints, your upstream dependencies, and your production errors — and when something crosses a threshold, Devin ships the fix PR before you've even read the reviews.

## Problem

Small and mid-size product teams face a brutal trade-off: every hour spent on maintenance is an hour not spent shipping. Three signals that should drive fixes go systematically unused:

1. **User complaints are honest bug reports that nobody reads.** Reviews on Google Play, Trustpilot, and Reddit contain precise, reproducible bug descriptions — but they arrive scattered across platforms, buried in noise, and by the time a pattern is visible in churn metrics, it's too late.
2. **Upstream API docs change silently.** A provider renames an endpoint or deprecates a field, the docs update quietly, and your integration breaks days later in production.
3. **Production errors surface after users are already hurt.** By the time someone triages the error spike, correlates it with a change, and assigns a fix, hours have passed.

The common thread: these are all *external signals* that demand *code changes*, and the loop from signal → diagnosis → fix is entirely manual today.

## Solution

Sentinel closes that loop. Each **sentinel** is an autonomous workflow defined by a signal source, a trigger condition, and a fix mandate. A trigger first creates an incident, gathers evidence, and determines whether the customer code is actually affected. Only an impacted incident launches a **Devin session** against the repo. Devin makes the smallest safe change, updates or adds tests, and opens a pull request. Humans stay in the loop at PR review; Sentinel never auto-merges or auto-deploys.

### The sentinels

**1. Feedback Sentinel** *(core)*
- Continuously pulls reviews and posts about your product from Google Play, Trustpilot, and Reddit via Context.dev's scraping API (Convex cron).
- Every new complaint is classified by Claude into an issue cluster ("login crash on Android 15", "CSV export broken") — attached to an existing cluster or founding a new one.
- When a cluster crosses the configured threshold (e.g. 5 complaints), the sentinel compiles the evidence (actual review texts, frequency, severity) into a Devin session prompt. Devin locates the bug in the repo and opens a fix PR.
- Dashboard shows the live complaint feed, clusters with threshold meters, and the Devin session timeline through to the PR link.

**2. Docs Sentinel / API Integration Maintainer** *(core proactive path)*
- A Context.dev **monitor** with semantic change detection watches the documentation or changelog for a registered third-party API integration.
- When the docs meaningfully change, Context.dev fires a signed webhook into Convex. Sentinel creates an incident, retrieves the latest docs, identifies the changed endpoint/schema/version, and compares it with the registered endpoint and integration usage.
- The diagnosis produces an explicit `impacted`, `not_impacted`, or `uncertain` verdict with evidence. Only `impacted` incidents launch Devin with the repo, integration path, docs, expected behavior, and any failing test or runtime evidence.
- Devin patches the integration, updates or adds tests, and opens a PR. Convex records the test result and PR metadata, then marks the incident `repair_proposed`.

**3. Incident Sentinel** *(reactive trigger; thin core, demo polish is stretch)*
- The product sends sanitized integration failures to a Sentinel ingest endpoint. The runtime trigger enters the same API-maintenance incident and diagnosis flow as a docs change rather than launching a separate blind hotfix.
- If a proactive incident already exists for the same integration and contract change, the runtime failure is attached as new evidence instead of creating a duplicate Devin run.
- The core is one real failure event flowing through diagnosis; the stretch demo adds error-spike detection, a red incident banner, and a live "break integration" control.

### The narrative

Three time-horizons of the same problem:
- **Feedback Sentinel** — lagging signal (users already hurt)
- **Docs Sentinel** — leading signal (breakage may be coming)
- **Incident Sentinel** — real-time signal (the integration is failing now)

The Docs and Incident Sentinels share one API-maintenance spine: **detect → understand → contextualize → validate → remediate**. The trigger alone is not enough; Sentinel must show why the customer code is impacted before Devin acts. Adding other sentinels remains a configuration exercise: any signal source + trigger + evidence packet plugs into the same orchestration layer. Obvious next sentinels are CVE feeds, status pages, log anomaly detection, and App Store reviews.

## Target users

- **Primary:** small product teams (2–15 engineers) with a live consumer or B2B product, no dedicated support-engineering or platform team, drowning in maintenance backlog.
- **Secondary:** agencies and studios maintaining many client apps; solo founders running products on the side.

## What the demo shows (user journey)

The demo runs on **real data throughout** — two products configured side by side on the dashboard:

- **Revolut (observer mode)** — the demo opens here: Sentinel scraping Revolut's *real* Trustpilot reviews, Play Store reviews, and r/Revolut posts, with Claude clustering hundreds of genuine complaints live. This is "what Sentinel looks like pointed at a real business." No Devin step (we don't own their repo) — which itself demonstrates the permission model.
- **Acme Invoicing (full loop)** — our demo SaaS, whose repo we own. Its complaints are *real too*: a real subreddit (r/AcmeName) where real posts are made — including live on stage. Acme has one registered currency-rates integration backed by a controlled vendor contract, while Context.dev monitors the matching docs page. The controlled contract can change once so both proactive and reactive triggers have a deterministic, realistic target.

The journey:
1. **Onboard a product** — paste your GitHub repo, feedback sources, and one API integration: provider, docs URL, endpoint, integration path, expected contract, and test command.
2. Dashboard fills with live complaints scraped from real sources (Revolut at scale; Acme from its subreddit).
3. A complaint posted on Reddit → scraped → clustered → threshold crossed → Devin session spawns automatically → minutes later a PR appears with the fix, linked from the dashboard.
4. The controlled vendor contract and docs change → Context.dev fires a webhook → Convex creates an incident → Sentinel retrieves current docs and shows that Acme uses the changed response field → Devin opens a tested repair PR → incident becomes `repair_proposed`.
5. Acme calls the changed endpoint and reports a real integration failure. Sentinel attaches it to the existing incident as corroborating evidence; if the proactive trigger has not fired, the same failure can initiate the same diagnosis and repair flow.

## Scope decisions (explicit non-goals for the hackathon)

- **No auto-posting replies to reviewers** — requires owning the business profiles; cut entirely.
- **No auto-merge** — Devin opens PRs; humans review. This is a feature, not a limitation (judges will ask about safety).
- **No voice/call interface** — the war-room is a text feed. Voice is demo theater with real integration risk.
- **No multi-tenant auth** — one team, seeded products; the onboarding form demonstrates the multi-product model.
- **One API integration and one controlled breaking change** — prove both proactive and reactive triggers against the same repair pipeline; do not build a generic integration marketplace or auto-deployment system.

## How each partner technology is used (submission-form draft)

**Devin by Cognition** — Devin is the hands of the product. For impacted incidents, Sentinels programmatically create Devin sessions via the API (`POST /v1/sessions`) with the repository, failure evidence, latest docs, expected behavior, and required test command. Devin inspects the repo, makes the smallest safe integration change, updates or adds tests, and opens a pull request. Convex polls session status and surfaces the test result and `pull_request.url` live on the dashboard. Sentinel never asks Devin to merge or deploy. We also used Devin interactively to scaffold the demo target application. Without Devin there is no remediation; without Sentinel's impact gate, it would be only a Devin wrapper.

**Convex** — Convex is the entire backend and nervous system: the database for products, integrations, reviews, clusters, trigger events, incidents, diagnosis state, agent runs, test outcomes, and PR metadata; cron jobs that drive scraping; actions that call Context.dev/Claude/Devin; and HTTP actions that receive signed Context.dev webhooks and sanitized runtime failures. The Workflow component (`@convex-dev/workflow`) can durably orchestrate the Devin lifecycle after the plain launch-and-poll path works. The dashboard is fully reactive via Convex `useQuery` subscriptions, so every incident transition streams to the UI with zero refresh.

**Context.dev** — Context.dev is the senses. The Feedback Sentinel uses the scraping API to retrieve review pages. The API Integration Maintainer uses Context.dev Monitors for semantic docs-change detection, then retrieves the latest provider docs to identify the affected endpoint/schema/version and build the diagnosis and Devin evidence packet. Signed webhooks deliver proactive changes into the same Convex incident flow used by reactive integration failures. These are distinct, load-bearing Context.dev capabilities.

## Judging-criteria mapping

| Criterion | Weight | Our answer |
|---|---|---|
| Product Value | 25% | Real, universal pain (maintenance vs. shipping); tight ICP (small teams); the demo *is* the value prop |
| Technical Execution | 25% | Working end-to-end pipeline: live scrape → LLM clustering → threshold → real Devin PR on a real repo, live on stage |
| Partner Integration | 25% | All three are load-bearing: Context = senses, Convex = nervous system, Devin = hands. Remove any one and the product ceases to exist |
| Innovation | 15% | The closed loop is the novelty: external signals (not tickets) autonomously driving code changes; "sentinel = source + trigger + mandate" as an extensible primitive |
| Demo & Clarity | 10% | Scripted 3-min arc with a live PR opening; backup video recorded; deterministic seeded-data path |

## Success criteria for the day

1. By 12:30 — one Devin session launched from Convex has opened a PR on the demo repo (hard checkpoint).
2. By 15:00 — Feedback Sentinel and the proactive API-maintenance path run end-to-end; one reactive integration failure has entered the same incident pipeline; dashboard live.
3. By 16:30 — submission complete: repo link, demo, partner explanations, backup video.

## Disclosure of pre-existing assets (per rules)

- Prepared before the event (permitted prep): accounts, API keys, GitHub org, the Acme subreddit (empty community, no code), this PRD/plan, empty repo scaffolding.
- Built during the event: all product code, the demo target app, all integrations.
- Third-party: Convex components (`@convex-dev/workflow`), Vite/React, shadcn/ui registry tooling, and the licensed ReactBits Pro Application UI `dashboard-4` source adapted for Sentinel. ReactBits supplies dashboard chrome only; all product logic, Convex bindings, states, and workflows are built during the event.
