# Review: dashboard UX pass v4

VERDICT: changes required

Reviewed `ca43c95` on `vuk88/dash-v2`. No product source was edited. The demo suite, the Next host, and `scripts/ci-conformance.py` are green. Four acceptance items are not.

## Blockers

### 1. Bucket copy describes a granularity the collector does not serve

`docs/analytics.md` says adoption "Buckets are UTC days." The v2 contract's overview example is `"calls_by_client":{"buckets":"day",...}` and adoption is `"active":{"bucket":"day",...}`. Latency is the series that changes with the window: hourly up to 48 hours, daily after that.

The collector matches that. On project `78471e48-4b6b-4289-a01b-842cae94f9f5`, after 25 accepted events:

| range | `calls_by_client.buckets` | points | `adoption.active.bucket` | latency `bucket` | sparkline length |
| --- | --- | --- | --- | --- | --- |
| 24h | `day` | 1 (`2026-10-12`) | `day` | `hour` | 25 |
| 7d | `day` | 2, gap 24h | `day` | `day` | 8 |
| 90d | `day` | 3 (`2026-09-22`, `2026-10-11`, `2026-10-12`), gaps 456h and 24h | `day` | `day` | 91 |

There is no hourly calls series at 24h and no weekly series at 90d. Tool trend timestamps are dates as well (`archive_record` trend is `["2026-10-12"]` on every range).

The dashboard says otherwise. Against that collector, light 1440:

- Calls by client subtitle is `Daily tool calls · UTC` at both 24 hours and 90 days. The popover says "Buckets follow the range: hourly for 24 hours, daily up to 30 days, weekly for 90."
- Active identities subtitle is `New against returning, by day`. The popover says "Buckets are UTC days unless the range is 24 hours or 90 days."
- `tool.card.calls-errors` says "Buckets follow the range, in UTC." The trend does not follow the range.

On the demo build the calls chart does follow `bucketForRange` (24h hour / 24 points, 90d week / 13 points, subtitles Hourly and Weekly), so that popover matches the demo and contradicts the collector, the docs, and the contract. The adoption card subtitle stays `New against returning, by day` on the demo at both 24 hours and 90 days, while the demo series for those ranges is hourly and weekly.

The review brief says a wrong definition against `docs/analytics.md` and the contract is a blocker.

### 2. Saved SLO targets do not move the Tools below-SLO tile, and the settings copy says they do

`settings.card.analytics-settings` says "changing a target moves error budget and the Tools below-SLO count." `tools.tile.below-slo` states the targets as "99.5% for read tools, 98% for mutating ones." The Tools screen computes the count with `const target=(c)=>c==='read'?99.5:98` and prints `read 99.5% · mutate 98%`.

The fixture's read tool `get_customer` is at 91.7% and its mutate tool `archive_record` is at 90.0%. With the default targets the overview caption is `2` tools below SLO. After `analytics_settings.slo_targets` is `{read:80, mutate:80}`:

- `GET .../analytics/overview?range=7d` returns `tools_below_slo: 0` and both attention rows `status: ok`.
- `GET .../analytics/reliability?range=7d` returns targets `80` / `80` and error-budget remaining `58.3` / `50.0`. The budget did move.
- The Tools "Below SLO" tile reads `2` with meta `read 99.5% · mutate 98%`.
- The Overview "Tool success" meta reads `0 tools below SLO`.

Same split on the demo: saving a mutate target of 90 left the Tools tile at `6` while the Overview caption went from `6 tools below SLO` to `0 tools below SLO`.

### 3. The live p95 sparkline still reads out "Bucket"

The brief requires sparkline labels to be the series' own timestamps, and keyboard inspection to show those labels with units. On the live 24h overview the latency sparkline has 25 hourly points and `calls_by_client` has 1 daily point, so `analytics-v3.tsx` drops `labels`. Keyboard ArrowRight on that sparkline, after a pointer click opened nothing, showed:

```
Bucket: 2 p95 latency: No data yet
headers: ["Bucket","p95 latency"]
```

That is the "Bucket / Value" readout this pass was meant to remove. It does not appear on the demo, where the two series always have the same length, so visual-qa does not catch it.

### 4. Two serial visual-qa runs are not byte-identical

`PLAYWRIGHT_CHANNEL=chromium BASE_URL=http://127.0.0.1:23460 bun scripts/visual-qa.mjs` passed twice (exit 0, contrast and clip 0). `sha256sum` of `web/artifacts/v3` `*.png` and `*.json` differs in three screenshots:

| file | run A | run B |
| --- | --- | --- |
| `artifacts/v3/adoption-390-light.png` | `8a37181642506c661afdd184927ca6b5f4325dd026462f27d4262d15d1a0ec0f` | `18fde2d62eec87ac7afe0e6b4db46ebc9c01dfe10e6196fd623cf26dbe21aa73` |
| `artifacts/v3/tool-drawer-1280-light.png` | `ac7b4bd4e69e45947b46d8f4ac8de85e4a318cd976dcc3fe20645bcc134c08ca` | `89d9d23bc0c55c4c430a21428ad6378fa8ff5cdc0a913ed6c5536fe7fa4853aa` |
| `artifacts/v3/tools-390-light.png` | `3b8e8281073ac2fa4369a813f3a11d2214665b9d2c83f6662203c6e5c00402ac` | `e494e85661ca59d90af9a3b08c9eb04ad01758f336b7eaad5639eb926b96458d` |

The acceptance line requires two serial static runs to be byte-identical. These were not. The shots were restored afterward so the tree is clean. `adoption-390-dark.png` and `tools-390-dark.png` matched each other and differed from `HEAD`; that is host drift, and those bytes were restored too.

## Should-fix

### Visual QA does not actually check the stacked-area crosshair

`web/scripts/visual-qa.mjs` asserts `page.locator('.chart-stacked-area .tip').count()>0||true`. The `||true` makes the check pass when the crosshair is absent. On the demo the crosshair is present (one `.tip` on the stacked area). The behaviour is right and the assertion cannot fail.

### Visual QA does not check project-card rows

The same script compares `flexWrap` to `'wrap'` at both 1440 and 390 (`width<=560?'wrap':'wrap'`). It never counts rows. Measured layout is correct on the demo and on the live collector, both themes: 1440 is one row, `flex-direction: row`; 390 is four rows, `flex-direction: column`. Selection, the gold border, `aria-pressed`, the healthy icon, reload, the shared `#tools?project=` link, and a stale id falling back to the first project all held.

### The backend skeleton test cannot see a broken 400 ms hold

`backend-qa.mjs` delays each analytics route by 20 ms (expects no skeleton) and 900 ms (expects the skeleton to last ≥ 400 ms). Overview waits on three sequential analytics calls, so a 900 ms delay keeps the skeleton up for far longer than 400 ms even if the minimum hold is removed. The 20 ms case also does not measure the 200 ms threshold.

The product behaviour is right. Sampling `.loading-state` on the live overview: three routes at 60 ms each (about 180 ms total) never showed "Reading your signals…". Three routes at 90 ms each showed it from performance-time 370 ms to 794 ms, a 424 ms hold, after the data was due about 70 ms in. The suite's pass line still claims a proof it does not perform.

### The error-budget tick stays at 6× when the alert threshold changes

`reliability.card.error-budget` says "the red tick is 6×, the burn the alert rule fires on." `renderers.js` draws that tick with `(burn1 ?? 0) / 6` and a fixed tick at 6. Saving "Error-budget burn threshold" as 3 left every gauge tick line's coordinates and stroke width unchanged (`live gauge ticks unchanged after burn 6→3 true`).

## Verified claims

Author commands, re-run from `web/` unless noted, with `PLAYWRIGHT_CHANNEL=chromium` and `PATH=$HOME/.cargo/bin:$HOME/.bun/bin:$PATH`.

- `bun run check` — clean, exit 0, earlier in this review.
- `bun run build` — earlier in this review. The tree still has `web/dist/assets/index-D3BG_8Te.js` at 385,855 bytes, the author's artifact. `ci-conformance.py` serves that bundle.
- `bun run test` — exit 0. Last lines: review-r1 and review-r2 passed; Visual QA passed; Live QA passed (60000 ms, hidden tab, return, range change, no count-up from zero, no polling under `__SIGNALS_VISUAL_QA__`); Reload series passed (no Connecting or Reading screen, ordinary reload reports zero layout shift).
- `bun run test:next` — exit 0. `Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.`
- `PERFORMANCE_REPEATS=15 bun scripts/performance-qa.mjs` against a demo Vite on `127.0.0.1:23460` — exit 0. Longest task 32.03–42.95 ms, all under 50.
- `bun scripts/performance-qa.mjs --walk` — exit 1. The only row over 50 ms is run 3 `protocol → live` at 63.88 ms. Runs 1 and 2 of that step were 40.76 and 45.49. Every other transition was under 50 (highest 46.78, `adoption → tools`). This is the pre-existing Live-mount miss the author disclosed and the coordinator accepted. It is not a new blocker. Any other step over 50 would have been.
- Two serial `bun scripts/visual-qa.mjs` runs — each exit 0, contrast and clip failures empty. Byte-identity failed. See blocker 4.
- `python3 scripts/ci-conformance.py` from the repo root — exit 0. `DATABASE_URL=postgres://postgres:signals@127.0.0.1:25481/signals`, `ANALYTICS_PG_CONTAINER=dash-v4-ux-r1-pg`, `SIGNALS_URL=http://127.0.0.1:25483`, `ANALYTICS_REVIEW_URL=http://127.0.0.1:25484`, `ANALYTICS_REVIEW_PROBE_PORT=25485`, `SIGNALS_PROBE_LATENCY_BUDGET_MS=900`, `TMPDIR=/var/tmp/v4-ux-r1`. Spec/transport passed, backend browser QA passed, release build finished, analytics review probe ended `FINDINGS 0 MISMATCHES 0`.
- `web/packages/ui/DESIGN.md` notes 13–18 are present under "UX pass 2026-10-12 (v4)". Not edited.

The six items, besides the blockers above:

- Ink. Painted `path.primary` strokes match the `lord-icon` computed `color` on the live UI for nav, buttons, and project cards, light and dark, 1440 and 390 (mismatch list empty). One Cost-nav `path.primary` has `stroke: none` and `fill: rgb(0, 0, 0)`; `getBBox` is 0×0, so it is not painted. Not a product defect.
- Popovers. On the demo and on the live UI, opening, Esc, focus into `.info-pop` and back to the button, and the panel box inside the viewport all held at 1440 and 390, both themes. Contrast/clip on an open Calls-by-client popover was `{failures:[], clipped:[], overflow:[1440,1440]}`. Copy accuracy is blocker 1.
- Project cards. See the should-fix above for the measurements. Live status text is `Collector connected`. A reload with a session showed no `.login-page` or `.loading-state`.
- Reload and skeleton. The author's reload series passed. The 200 ms delay and 400 ms hold were measured separately; see the should-fix.
- Chart tooltips. On the demo, pointer click opened nothing and keyboard ArrowRight matched the table twin with units on every `.v3-chart` walked (overview, adoption, tools, reliability, sessions, cost, protocol, live), at 1440 light, 390 light, and 1440 dark. Hover readouts landed on sparkline, funnel, stacked-area crosshair, sankey, treemap, and live bars. The live p95 sparkline is blocker 3.
- Polling. Live request log, fake clock: first burst `adoption,overview,tools`; nothing 55 s early; the same burst when the interval was due; nothing across 180 s while hidden; an immediate burst on return and on a range change. A page with `__SIGNALS_VISUAL_QA__` added no further analytics requests across 180 s. The demo activity store showed the same interval, no hidden-tab poll, no count-up through `0`, and `nt` on the draw classes.

Not filed, on purpose: Settings is not polled (it is a form); the coordinator already dropped "Catalogue unknown"; the optional tool-call count on a selected card was not shipped; `web/artifacts/v4/reload/` stays untracked.

## Probes committed

None. Reproduction scripts lived under `/tmp` (`v4-ux-probe.mjs`, `v4-ink.mjs`, `v4-live-api2.py`, `v4-dump.py`, `v4-live-ui.mjs`, `v4-follow.mjs`, `v4-skel.mjs`).
