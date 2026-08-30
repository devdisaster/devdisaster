# PRD — Sentinel (working name)

*Collabute × TheBlock AI Hackathon, Dubai — 30 Aug 2026*
*Team: Shashwat (SWE), Iyad (PM), Moein (Product Designer), Ash (Business Lead)*

---

## One-liner

An autonomous integration engineer for teams that can't afford to stop shipping: Sentinel watches your third-party providers' docs and your production integration errors, proves your code is actually impacted, and has Devin ship the tested fix PR — before your users file the ticket. A feedback agent that turns user complaints into fix PRs rides along as the second act.

## Problem

Every SaaS product is a bundle of third-party integrations — payments, messaging, AI, storage — and every one of them is a liability that someone else can break:

1. **Upstream API contracts change silently.** A provider ships a new API version, renames a response field, or removes an object (Stripe's 2022-11-15 release literally deleted `charges` from PaymentIntent). The docs update quietly; your integration breaks days later when the account version rolls forward.
2. **Production integration errors surface after users are already hurt.** By the time someone triages the error spike, correlates it with the provider change, reads the migration guide, and assigns a fix, hours have passed.
3. **User complaints are honest bug reports that nobody reads.** Reviews and forum posts contain precise, reproducible bug descriptions — but they arrive scattered, buried in noise, and by the time a pattern is visible in churn metrics, it's too late.

The common thread: these are all *external signals* that demand *code changes*, and the loop from signal → diagnosis → fix is entirely manual today.

## Solution

Sentinel closes that loop. Each **agent** is an autonomous workflow defined by a signal source, a trigger condition, and a fix mandate. A trigger first creates an incident, gathers evidence, and determines whether the customer code is actually affected. Only an impacted incident launches a **Devin session** against the repo. Devin makes the smallest safe change, updates or adds tests, and opens a pull request. Humans stay in the loop at PR review; Sentinel never auto-merges or auto-deploys.

### The agents

**1. Integration Engineer Agent** *(core — the product)*
- You register an integration once: provider, docs URL, endpoint, integration path, expected contract, and test command.
- **Proactive trigger:** a Context.dev **monitor** with semantic change detection watches the provider's documentation/changelog. When the docs meaningfully change, Context.dev fires a signed webhook into Convex.
- **Reactive trigger:** your product reports sanitized integration failures to a Sentinel ingest endpoint. A runtime contract failure enters the same incident flow — and if a docs-change incident already exists for the same contract change, the failure attaches as corroborating evidence instead of creating a duplicate.
- Either way, Sentinel creates an incident, retrieves the latest docs, fetches the actual integration file from the repo, and produces an explicit `impacted`, `not_impacted`, or `uncertain` verdict with evidence. The trigger alone is never enough; Sentinel proves the customer code is affected before acting.
- Only `impacted` incidents launch Devin with the repo, integration path, docs, expected behavior, and any failing test or runtime evidence. Devin patches the integration, updates or adds a regression test, runs the named test command, and opens a PR. Convex records the test result and PR metadata, then marks the incident `repair_proposed`.
- The result is self-healing with a human gate: detect → understand → contextualize → validate → remediate, ending in a reviewable PR.

**2. Feedback Agent** *(secondary)*
- Continuously pulls posts about your product from its subreddit and public feedback board via Context.dev's scraping API (Convex cron).
- Every new complaint is classified by Claude into an issue cluster ("CSV export drops header row") — attached to an existing cluster or founding a new one.
- When a cluster crosses the configured threshold (e.g. 5 complaints), the agent compiles the evidence (actual post texts, frequency, severity) into a Devin session prompt. Devin locates the bug in the repo and opens a fix PR.
- Dashboard shows the live complaint feed, clusters with threshold meters, and the Devin session timeline through to the PR link.

**3. Incident grouping & spike detection** *(stretch — polish on top of the reactive trigger)*
- Group repeated runtime failures by integration and fingerprint, show counts and first/last seen, and escalate severity on spikes — without ever bypassing the impact gate or creating duplicate repairs.

### The narrative

One spine, two directions in time:
- **Docs monitor** — leading signal (breakage is coming)
- **Runtime failures** — real-time signal (the integration is failing now)
- **Feedback agent** — lagging signal (users already hurt), proving the same orchestration generalizes beyond APIs

Both integration triggers share one maintenance spine: **detect → understand → contextualize → validate → remediate**. Adding other agents remains a configuration exercise: any signal source + trigger + evidence packet plugs into the same orchestration layer. Obvious next agents are CVE feeds, status pages, SDK deprecation notices, and app-store reviews.

## Target users

- **Primary:** small product teams (2–15 engineers) with a live product built on third-party APIs, no dedicated platform team, drowning in maintenance backlog.
- **Secondary:** agencies and studios maintaining many client apps with the same handful of integrations; solo founders running products on the side.

## What the demo shows (user journey)

The demo runs on one product: **InvoicePilot**, our demo billing SaaS, whose repo we own. It has one registered **Stripe** integration — real Stripe test mode behind a thin demo gateway, so we can replay a breaking change Stripe *actually shipped* (the 2022-11-15 removal of `charges` from PaymentIntent in favor of `latest_charge`) live and deterministically on stage. Context.dev monitors the matching docs/changelog page. InvoicePilot's complaints are real too: a real subreddit (r/&lt;InvoicePilot&gt;) where real posts are made — including live on stage — plus a public in-app feedback board.

The journey:
1. **Onboard a product** — paste your GitHub repo, feedback sources, and one API integration: provider, docs URL, endpoint, integration path, expected contract, and test command.
2. **The vendor upgrades.** The Stripe contract and its docs flip to the new API version → Context.dev's monitor fires a signed webhook → Convex creates an incident → Sentinel retrieves the current docs and the actual adapter file, and shows that InvoicePilot reads the removed `charges` field → verdict: `impacted`, with cited evidence.
3. **Devin repairs.** A Devin session launches automatically with the evidence packet, patches the adapter to use `latest_charge`, adds a regression test, runs the suite, and opens a PR → incident becomes `repair_proposed`, PR linked from the dashboard.
4. **The runtime confirms.** InvoicePilot calls the upgraded endpoint and reports a real integration failure. Sentinel attaches it to the existing incident as corroborating evidence — no duplicate session. (If the proactive trigger hadn't fired, the same failure would initiate the same diagnosis and repair flow.)
5. **The second act:** a complaint posted live on r/&lt;InvoicePilot&gt; → scraped → clustered → threshold crossed → Devin session spawns → a fix PR for the planted UI bug appears, citing the users' own words.

## Scope decisions (explicit non-goals for the hackathon)

- **No auto-merge, no auto-deploy** — Devin opens PRs; humans review. This is a feature, not a limitation (judges will ask about safety). "Self-healing" ends at a green-tested, reviewable PR.
- **One provider, one controlled breaking change** — real Stripe test mode behind a demo gateway that replays the real 2022-11-15 upgrade on demand; we say so openly in the demo. No generic integration marketplace.
- **No observer/multi-company mode** — one seeded product; the onboarding form demonstrates the multi-product model.
- **No auto-posting replies to reviewers** — cut entirely.
- **No voice/call interface** — the war-room is a text feed.
- **No multi-tenant auth** — one team, one seeded product.

## How each partner technology is used (submission-form draft)

**Devin by Cognition** — Devin is the hands of the product. For impacted incidents, Sentinel programmatically creates Devin sessions via the API (`POST /v1/sessions`) with the repository, failure evidence, latest docs, expected behavior, and required test command. Devin inspects the repo, makes the smallest safe integration change, updates or adds a regression test, and opens a pull request. Convex polls session status and surfaces the test result and `pull_request.url` live on the dashboard. Sentinel never asks Devin to merge or deploy. We also used Devin interactively to scaffold the demo target application. Without Devin there is no remediation; without Sentinel's impact gate, it would be only a Devin wrapper.

**Convex** — Convex is the entire backend and nervous system: the database for products, integrations, trigger events, incidents, diagnosis state, reviews, clusters, agent runs, test outcomes, and PR metadata; cron jobs that drive scraping and polling; actions that call Context.dev/Claude/Devin; and HTTP actions that receive signed Context.dev webhooks, sanitized runtime failures, and serve the controlled Stripe demo gateway + docs mirror. The Workflow component (`@convex-dev/workflow`) can durably orchestrate the Devin lifecycle after the plain launch-and-poll path works. The dashboard is fully reactive via Convex `useQuery` subscriptions, so every incident transition streams to the UI with zero refresh.

**Context.dev** — Context.dev is the senses. The Integration Engineer agent uses Context.dev Monitors for semantic docs-change detection, then retrieves the latest provider docs to identify the affected endpoint/schema/version and build the diagnosis and Devin evidence packet; signed webhooks deliver proactive changes into the same Convex incident flow used by reactive integration failures. The Feedback agent uses the scraping API to pull the subreddit and feedback board. These are distinct, load-bearing Context.dev capabilities.

## Judging-criteria mapping

| Criterion | Weight | Our answer |
|---|---|---|
| Product Value | 25% | Real, universal pain (every SaaS is a bundle of breakable integrations); tight ICP (small teams); the demo *is* the value prop |
| Technical Execution | 25% | Working end-to-end pipeline: docs change → signed webhook → evidence-cited impact verdict → real Devin PR with a passing regression test, live on stage — plus the same failure arriving from the runtime |
| Partner Integration | 25% | All three are load-bearing: Context = senses, Convex = nervous system, Devin = hands. Remove any one and the product ceases to exist |
| Innovation | 15% | The closed loop is the novelty: external signals (not tickets) autonomously driving code changes, gated by proof of impact; "agent = source + trigger + mandate" as an extensible primitive |
| Demo & Clarity | 10% | Scripted 3-min arc replaying a breaking change Stripe actually shipped; backup video recorded; deterministic controlled-gateway path |

## Success criteria for the day

1. By 12:30 — one Devin session launched from Convex has opened a PR on the demo repo (hard checkpoint).
2. By 14:00 — the proactive API-maintenance path runs end-to-end (docs change → impact verdict → Devin PR with passing regression test); one reactive integration failure has entered the same incident pipeline; dashboard live.
3. By 15:30 — Feedback agent runs end-to-end from the real subreddit (or the seeded fallback is rehearsed and the cut is made).
4. By 16:30 — submission complete: repo link, demo, partner explanations, backup video.

## Disclosure of pre-existing assets (per rules)

- Prepared before the event (permitted prep): accounts and API keys (including a Stripe test-mode account), GitHub org, the InvoicePilot subreddit (empty community, no code), this PRD/plan, empty repo scaffolding.
- Built during the event: all product code, the demo target app, all integrations.
- Third-party: Convex components (`@convex-dev/workflow`), Vite/React, shadcn/ui registry tooling, and the licensed ReactBits Pro Application UI `dashboard-4` source adapted for Sentinel. ReactBits supplies dashboard chrome only; all product logic, Convex bindings, states, and workflows are built during the event.
