# Review: dashboard v2, round 2 (after fix pass r1)

VERDICT: changes required

Blockers: 1. Should-fix: 2.

Reviewed `09d9576..HEAD` on `vuk88/dash-v2` (`ec5bc8b`, `f5fca36`, `e98150a`), `web/` only.
No product source, config, doc or existing test was edited. The failing probe is
`web/test/review-r2/probe.mjs` (8 assertions fail, all from the three findings below).

All nine round-1 items are fixed and hold up under re-measurement in the browser; the
two findings are new behaviour introduced by the fix pass (blocker 1, should-fix 1) and
one contract divergence in the demo data the fix pass rewrote (should-fix 2).

## Blockers

### 1. The analytics client now sends a `bucket` query parameter the contract rejects

The r1 fix made `client.analytics` append a bucket derived from the range. Every v2
screen (overview, adoption, tools, reliability, cost, protocol, settings) goes through
that one call, so a backend built to `briefs/v2/analytics-api.md` would answer all of
them with 400.

Command (from `web/`):

```sh
PLAYWRIGHT_CHANNEL=chromium bun test/review-r2/probe.mjs
```

Observed (the probe stubs `fetch` and records what `apps/dashboard/src/client.ts`
builds — the real client, not the demo one):

```text
analytics request sends non-contract parameter(s) bucket: /v1/projects/p1/analytics/overview?range=24h&bucket=hour
analytics request sends non-contract parameter(s) bucket: /v1/projects/p1/analytics/overview?range=7d&bucket=day
analytics request sends non-contract parameter(s) bucket: /v1/projects/p1/analytics/overview?range=30d&bucket=day
analytics request sends non-contract parameter(s) bucket: /v1/projects/p1/analytics/overview?range=90d&bucket=week
```

Source: `web/apps/dashboard/src/client.ts:13`
(`query({...filters,bucket:bucketForRange(filters.range)})`).

Contract, `briefs/v2/analytics-api.md`: "Common query parameters: `range=24h|7d|30d|90d`
(default `7d`) or explicit `from`/`to` (RFC 3339); optional filters `client` (client.name),
`tool`, `caller` (caller id), `transport`. … Unknown filters are 400
`{"error":"invalid_filter","message":…}`." `bucket` is a *response* field there
(`calls_by_client.buckets`, `active.bucket`) — the server picks the step and declares it,
which is exactly what the screens now read for their subtitles and axes.

Expected: the client does not send `bucket` on `/analytics/*`, **or** the contract gains a
documented request-side `bucket` parameter for those routes. The fix brief's "the demo and
the client must derive the bucket from the range" is already satisfied without it: the demo
derives the step it emits, and the screens take the label from the response.

Not visible in demo mode — `demoAnalytics` ignores unknown query keys — so the fix pass's
own acceptance run passes with the defect present.

## Should-fix

### 1. `bucket=1w` is sent to the collector routes, which accept only `1h` or `1d`

Same probe, same run:

```text
timeseries request sends bucket=1w, collector accepts only 1h or 1d: /v1/projects/p1/timeseries?range=90d&bucket=1w
timeseries request sends bucket=1w, collector accepts only 1h or 1d: /v1/projects/p1/tool-timeseries?tool=get_product&range=90d&bucket=1w
```

`web/apps/dashboard/src/client.ts:17,20` map a `week` bucket to the literal `1w`. The
collector in this repo rejects it:
`crates/signals-server/src/handlers.rs:312-316` (`"Bucket must be 1h or 1d"`) and
`crates/signals-server/src/handlers.rs:448-450` (same message). Before the fix these two
routes were sent `1h`/`1d` only.

Reachability, stated plainly: this is latent today, not a live break. `/timeseries` and
`/tool-timeseries` are only called by the legacy screens
(`packages/ui/src/dashboard.tsx:71,128`), which render only when the host client has no
`analytics` member (`packages/ui/src/dashboard.tsx:55-59`) — the v2 dashboard always has
one. And on those routes `range(&q)?` runs before the bucket check, so `range=90d` already
returns 400 "Range must be 24h, 7d, or 30d" whatever the bucket is. Expected: emit a bucket
value those routes accept (or no bucket), so the mapping is not wrong-by-construction.

### 2. Overview "tools needing attention" is not sorted by calls inside the status group

The fix pass rewrote this array to add every dead tool (round-1 should-fix 2, correctly
fixed). The resulting order is catalogue order inside the `error` group, so the panel's
first row is not the biggest offender.

Playwright on `#overview` at 1440 light, rows read from `.panel` "Tools needing attention":

```text
book_flight      1,204   94.1%
send_email         388   96.9%
add_to_cart      2,700     97%
create_ticket    1,800     97%
update_customer  1,619     97%
submit_order     1,900     97%
cancel_booking       0    dead
refund               0    dead
archive_order        0    dead
```

Probe output:

```text
attention: error rows not sorted by calls (send_email 388 before add_to_cart 2700)
attention: error rows not sorted by calls (update_customer 1619 before submit_order 1900)
```

Source: `web/apps/dashboard/src/demo-analytics.ts:51` (`attention:[...tools.filter(...)…,
...dead.map(…)]`, no sort).

Contract, `briefs/v2/analytics-api.md`, `overview`: "`error` below SLO target, `warn`
within 1 point above target, `dead` advertised but never called in the window … **Sorted
error, warn, dead, then by calls.**" The status grouping is right; the within-group order
is not. Expected: sort by calls descending inside each status band.

## Verified claims

Every author claim in `reports/dash-v2.md` section "Fix pass r1" was re-run from `web/`
with `PATH=$HOME/.bun/bin:$PATH` and `BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache`.

| Claim | Result |
| --- | --- |
| `bun install --frozen-lockfile` | exit 0. `Checked 171 installs across 193 packages (no changes)` |
| `bun run check` | exit 0 (`tsc -p packages/ui/tsconfig.build.json`, `tsc --noEmit`, `eslint .`, no output) |
| `bun run build` | exit 0. `dist/assets/index-Db3vLRZa.js 301.08 kB │ gzip: 92.33 kB`, `✓ built in 166ms` — same bundle hash and size the author reported |
| `PLAYWRIGHT_CHANNEL=chromium bun run test` | exit 0, twice. `review-r1 probe passed` then `Visual QA passed: 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.` |
| `PLAYWRIGHT_CHANNEL=chromium bun run test:next` | exit 0. `Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.` |
| `bun test/review-r1/probe.mjs` standalone | exit 0. `review-r1 probe passed` |
| review probe runs inside `bun run test` | confirmed: `scripts/test.mjs:6` imports it, and its line appears in both test runs |
| `grep -R -n -E '\?\? ?0' web/packages/ui/src --include='*.tsx'` → no matches | reproduced, grep exit 1. Three `?? 0` remain in `demo-analytics.ts` only, on `errors.tool` and `output_tokens_est`, which the contract types as non-null; no screen renders a false zero (measured below) |
| Clean status after a full test run | reproduced twice. `git status --porcelain` empty after run 1 and after run 2; `git diff --check` empty; `git ls-files web/artifacts/v2` is 22 paths. All 44 PNGs on disk (both widths, both themes) were rewritten by my run — identical mtimes — and the 22 tracked ones stayed byte-identical |
| "Viewed the regenerated 390px Sessions screenshot … divided list and the `8 s` duration" | reproduced by opening `artifacts/v2/sessions-390-light.png`: every row is a bordered card with labelled fields (Caller, Started, Duration, Depth, Errors, Outcome, Transport, Reason) and `8 s` durations, nothing clipped |

The nine round-1 items, each re-measured in the browser (Playwright computed styles and box
measurements), not read from source:

| Round-1 item | Result |
| --- | --- |
| 1. Bucket honesty | Fixed. Per range, measured on the rendered chart after clicking the range control: 24h → "Hourly tool calls · UTC" / "Hourly observations · active identities", axis `00:00 12:00 23:00`, 24 points 1 h apart; 7d → "Daily …", `10-05 10-08 10-11`, 7 points 24 h apart; 30d → "Daily …", `09-12 09-27 10-11`, 30 points 24 h apart; 90d → "Weekly …", `Week of 07-14 / 08-25 / 10-06`, 13 points 168 h apart. The probe hard-codes this mapping rather than importing `bucketForRange`, so it cannot inherit an error from the implementation |
| 2. Null error budget / every `?? 0` | Fixed. Reached through the UI: Settings → set every tool's SLO class to Read → Save empties the mutate class. The mutate panel then renders `No data yet \| No data yet error budget remaining \| … \| No data yet · No calls for this class` with **zero** `<progress>` elements. Server-rendered cross-check: null budget emits no `<progress>` in all four handshake permutations. No tile on reliability, protocol, cost, callers or sessions shows a `0`-family value for a null; nullable fields read "No data yet" (tiles, drawers) or `—` (tools error-split columns, legend documented in the panel subtitle) |
| 3. Session durations | Fixed. `#sessions` Duration column: `In progress, In progress, 8 s × 10`; each ended row matches its own start/end timestamps recomputed from the demo data. Formatter boundaries `2 min 10 s` and `1 h 4 min` hold (r1 probe) |
| 4. Dead tools in attention | Fixed. All three of `catalog.dead` (`cancel_booking`, `refund`, `archive_order`) are rendered attention rows with status `dead`, after the six error rows (ordering caveat: should-fix 2) |
| 5. Handshake copy | Fixed. Demo (rate and p95 null) still shows `6,480 attempts · p95 No data yet · waiting for init outcomes`; server-rendered, the waiting clause appears for null-rate, null-p95 and both-null, and is **absent** for rate 99.2 / p95 40 |
| 6. Table visibility at 1440 and 390 | Fixed. Across 11 screens × 2 themes × 2 widths: no `th`/`td` whose content overflows its own box. At 1440 every overflowing `.table-scroll` carries the visible hint "Scroll horizontally to see all columns ↔" and is keyboard focusable (`tabIndex 0`, `role=region`). At 390 every table collapses to the divided list — `tbody tr` computed `display:flex`, `thead` clipped out, every field carrying a rendered `::before` label from `data-label`; verified visually on the Sessions and Tools shots |
| 7. Krona weight and 10.5 px labels | Fixed. In all 44 screen/theme/width combinations, every element computing to `Krona One` has `font-weight: 400` and `font-synthesis: none` (`.client-avatar` inside `.row-button` included), and every `.eyebrow` / `.status-pill` computes to exactly `10.5px` at both 390 and 1440 |
| 8. `theme-color` meta | Fixed. `#FBC118` |
| 9. Deterministic screenshots | Fixed. `bun run test` run twice back to back; `git status --porcelain` empty after each |

Blast radius (check 2) and the three screens round 1 did not open (check 3):

| Check | Result |
| --- | --- |
| 11 screens × light/dark × 390/1440 render | Pass. No page error on any of the 44 loads; `documentElement.scrollWidth - innerWidth` ≤ 0 everywhere; no leaf element whose text overflows its box (scroll containers, `pre` and the table scrollports excluded) |
| Demo numbers internally consistent | Pass, for all four ranges. `calls_by_client` points and the tools table both sum to the `tool_calls` tile; each tool's trend sums to its own calls; client-mix calls and sessions sum to the call and session tiles and the shares to 100%; protocol versions, transports and protocol capability sessions equal the sessions tile; cost `by_tool` and `by_tenant` sum to `total_tokens_est`, which equals the overview token tile (and `per_call` matches); both payload histograms sum to the call count; identity kinds sum to active users on both screens; the funnel is monotonic; the catalogue is 15 = 12 used + 3 dead |
| Tools drawer | Pass. Opens on `book_flight`; trend sparkline present; the error-split table matches the data cell for cell (`tool 71`, the four unpopulated kinds "No data yet"); payload and recovery match (`Input average 282 B`, `Output average 2,320 B`, `Output tokens ≈ 580`, `Retries within 30s 50`, `Self-corrected 72.5%`, both schema-failure rows "No data yet"); no null rendered as `0 ms` |
| Sessions timeline drawer | Pass. Running session: header `Claude · Production app · streamable-http`, six timeline rows, no `session.ended`, null duration shown as "No data yet" (not `0 ms`). Ended session: header `8,400 ms · client`, seven rows ending in `SESSION.ENDED` at `+8,400 ms`, offsets ordered `0, 30, 90, 250, 960, 1500, 8400` |
| Settings — SLO classes | Pass. Changing a tool's class moves its calls between classes: with every tool set to Read, the mutate panel goes to the null-budget state and the read panel recomputes |
| Settings — SLO targets | Pass. `read SLO target (%)` 99.9 → reliability subtitle "Target 99.9%" and the overview success tile recomputes to "12 tools below SLO" |
| Settings — alert rules | Pass. The five contract defaults render with the right thresholds and windows (volume 3×/60, p95 2×/60, error rate 5%/15, destructive 1/1, burn 6×/60) and the firing state on the error-rate rule. Editing threshold → 9, window → 25 and unticking the volume rule survives Save and a round trip to another screen and back |
| Settings — digest | Pass. The weekly-digest checkbox and recipient `r2@example.com` persist across Save and navigation |
| Settings — token divisor | Pass. Divisor 8 halves the cost screen's per-call estimate, `≈ 522` → `≈ 261` |
| `bun run check && bun run build && test && test:next`, clean status | Pass, all four green, `git status --porcelain` empty (see the table above) |

## Probes committed

`web/test/review-r2/probe.mjs` — starts its own demo Vite server on port 23461, drives
Chromium, and runs every measurement above.

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium bun test/review-r2/probe.mjs
```

Last lines:

```text
review-r2 probe failures (8):
attention: error rows not sorted by calls (send_email 388 before add_to_cart 2700)
attention: error rows not sorted by calls (update_customer 1619 before submit_order 1900)
analytics request sends non-contract parameter(s) bucket: /v1/projects/p1/analytics/overview?range=24h&bucket=hour
analytics request sends non-contract parameter(s) bucket: /v1/projects/p1/analytics/overview?range=7d&bucket=day
analytics request sends non-contract parameter(s) bucket: /v1/projects/p1/analytics/overview?range=30d&bucket=day
analytics request sends non-contract parameter(s) bucket: /v1/projects/p1/analytics/overview?range=90d&bucket=week
timeseries request sends bucket=1w, collector accepts only 1h or 1d: /v1/projects/p1/timeseries?range=90d&bucket=1w
timeseries request sends bucket=1w, collector accepts only 1h or 1d: /v1/projects/p1/tool-timeseries?tool=get_product&range=90d&bucket=1w
```

Set `R2_NOTES=1` to also print the measurements (request URLs, duration column, SLO
panels, drawer contents, settings round trip) rather than only the failures. The probe is
not wired into `bun run test`; the fix pass should add it the way `review-r1/probe.mjs`
was added to `scripts/test.mjs`.

One note on the round-1 probe, not a finding: the fix pass rewrote
`web/test/review-r1/probe.mjs` to assert against `bucketForRange` and `sessionDuration`
imported from the implementation it is testing, so those two assertions would still pass if
the mapping or the formatter were wrong. `review-r2/probe.mjs` hard-codes both expectations
and measures the rendered screen instead; both agree with the fix brief today.
