# Kevin — 30–36s demo video storyboard

Target ~35s, no voiceover (text overlays carry the story). For the landing-page hero
slot and LinkedIn. Assembled in Remotion from retina stills + one live screen
recording.

## The cut

| # | Time | On screen | Overlay text |
|---|------|-----------|--------------|
| 1 | 0–5s | **Real OpenAI docs** (developers.openai.com → API reference → Create chat completion), `max_tokens` with its red **Deprecated** tag and the "deprecated in favor of max_completion_tokens" sentence | "Your API provider ships a breaking change." |
| 2 | 5–13s | **Live dashboard recording**: incident card pops in, status walks detected → gathering context → diagnosing; corroboration line appears in the feed | "Kevin was watching. Now it proves it matters." |
| 3 | 13–22s | Expanded incident: verdict **IMPACTED**, cited adapter line `max_tokens: 256,`, docs-evidence bullets | "Diagnosis with receipts — your code, their docs, cited." |
| 4 | 22–29s | GitHub PR #16 diff: `- max_tokens: 256,` / `+ max_completion_tokens: 256,` plus the regression-test changes | "Devin opens a tested fix PR." |
| 5 | 29–35s | Dashboard at **Repair PR proposed** (stat card "Repair PRs 1 · never auto-merged") + end card | "Review. Merge. Move on. — **Kevin (not Devin)** · Never auto-merges." |

Shot 2 (the old "docs mirror" shot) was deliberately cut: it was redundant with shot 1,
and the incident card in the live shot carries the docs-change summary itself.

## Sources

- Shots 1, 3, 4, 5: **retina stills** (`screencapture -x`, full display, fullscreen
  Chrome at 100% zoom). Remotion does all pans/zooms — record wide, punch in per beat.
- Shot 2: the **only real video** — the dashboard animates itself via Convex
  reactivity. Zero browser interaction during the take (no debug banner, no cursor
  artifacts). Trigger and cut from the terminal.

## The live-take script (one self-contained foreground command)

Pre-conditions: dev stack running (`npm run dev`, note the vite port), Chrome
fullscreen on the dashboard, debug banner dismissed, `DEVIN_API_KEY` **unset** on the
deployment (`npx convex env remove DEVIN_API_KEY`) so the take can't launch a
duplicate Devin session — the recording is cut at "launching Devin", before the
missing key shows. `npx convex run demo:resetDemo` first for a clean slate.

```sh
SITE=https://savory-minnow-617.convex.site
OUT=media/footage/shot2-live-run.mov
osascript -e 'tell application "Google Chrome" to activate'
sleep 2
screencapture -v -V 120 $OUT &
SC=$!
sleep 4
curl -s -X POST $SITE/demo/openai/docs -H 'Content-Type: application/json' \
  -d '{"version":"2026-08-28"}' > /dev/null
sleep 14
npx convex run demo:runIntegration > /dev/null 2>&1   # corroboration beat on camera
n=0
until npx convex run dashboard:overview 2>/dev/null | grep -q "launching Devin"; do
  n=$((n+1)); [ $n -gt 30 ] && break; sleep 2
done
kill -INT $SC; wait $SC
```

Afterwards: `npx convex env set DEVIN_API_KEY …` to restore, `demo:resetDemo`.

Gotcha that burned a take: launching `screencapture` from a shell that exits kills the
recording silently — keep the recorder inside one long-lived foreground script (as
above) and `wait` on it.

## Still recapture recipe (if stills are missing)

1. Shot 1: developers.openai.com/api/reference → Chat → Create chat completion, light
   theme, scroll `max_tokens` (Deprecated) into view → `screencapture -x`.
2. Shots 3/5: with `DEVIN_API_KEY` set, run one full demo (flip → wait ~10 min for
   `repair_proposed`). Shot 5 = dashboard top. Shot 3 = click the incident open,
   capture verdict framing, scroll, capture timeline framing. (This launches a real
   Devin session and opens a PR — close the extra PR after.) Cheaper variant if PR #16
   is still open: skip the run and reuse it for shot 4 only.
3. Shot 4: github.com/devdisaster/invoicepilot/pull/16/files, scroll the
   `src/lib/openai.ts` diff into frame.

## Honesty rule

OpenAI's real site appears only for the real deprecation fact (shot 1). The demo's
docs mirror (clearly footered as a replay) stays off camera entirely.
