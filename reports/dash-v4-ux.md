# Dashboard UX pass v4 — six user-reported items

Brief: `briefs/v4/dash-v4-ux.md`. Worktree `dash-v2`, branch `vuk88/dash-v2`,
from `1caeb4e`. Design authority: `briefs/v3/dashboard-v3.html`,
`briefs/v3/dashboard-v3-notes.md`, `web/packages/ui/DESIGN.md` (notes 13–18 are new).

## What changed, by file

| File | Change |
| --- | --- |
| `web/packages/ui/src/icons/index.tsx` | `info` registered in `IconName` and the loader map; the no-op `current-color` class dropped with a note on what actually carries the ink. |
| `web/packages/ui/src/styles.css` | `--lord-icon-primary: currentColor`; info button and popover surface; chart pointer-readout layer; `.nt` cancels the *animation* form of each entrance; `[data-stale]` dim and the 240 ms content fade. |
| `web/apps/dashboard/src/shell.css` | `--lord-icon-primary: currentColor`; project card row, wrap/stack/scroll rules, selected state; collector-dot pulse. |
| `web/packages/ui/src/copy/explanations.ts` | **new** — every popover's copy, keyed `<screen>.tile.<slug>` / `<screen>.card.<slug>`. |
| `web/packages/ui/src/info.tsx` | **new** — the info button and its anchored popover (top layer, clamped, focus-managed). |
| `web/packages/ui/src/activity.ts` | **new** — the shared data-activity store the strip and the dashboard read, plus `POLL_INTERVAL_MS` and the skeleton/fade constants. |
| `web/packages/ui/src/analytics-v3.tsx` | `info` on `Card` and on tile items, every id wired; `Count` tweens from the previous value after first paint; sparkline labels/units per tile; chart props (`columns`, `format`, `category`). |
| `web/packages/ui/src/dashboard.tsx` | `info` on `Panel`; `useQuery` gains the delayed skeleton, the keep-previous-value behaviour, the load-kind reporting and `poll`; `QueryState` shows nothing in the quiet window; `SignalsDashboard` writes the dim and the one-time fade straight to the DOM; Sessions resets its cursor on a project change. |
| `web/packages/ui/src/analytics.tsx` | `info` on the two Settings cards and the Callers billing panel; Settings is not polled. |
| `web/packages/ui/src/charts/index.tsx` | keyboard-only inspection, the pointer readout, and meaningful `headers`/`rows` for every chart. |
| `web/packages/ui/src/charts/renderers.js` | `data-row` hit geometry for sparkline, histogram, funnel, donut, sankey, treemap and grouped bars; `axisDate` exported; the grouped-bar x-axis title is the caller's. |
| `web/apps/dashboard/src/main.tsx` | project cards, hash query route, cached-account shell, freshness badge. |
| `web/apps/dashboard/src/client.ts` | the HTTP status travels with the error, so only 401/403 signs the shell out. |
| `web/apps/dashboard/src/demo.ts` | `paddedDemoProjects` for the demo-only `?projects=N` knob. |
| `web/scripts/visual-qa.mjs` | project selection by card; new assertions for items 1, 2, 3, 4 and 5. |
| `web/scripts/live-qa.mjs` | **new** — item 6 and the item 4 motion tokens, measured with a fake clock. |
| `web/scripts/reload-series.mjs` | **new** — the 100 ms reload series and its layout-shift measurement. |
| `web/scripts/backend-qa.mjs` | project cards against the real backend; the polling request log; the skeleton's 200 ms delay and 400 ms minimum under a throttled network. |
| `web/scripts/test.mjs` | runs visual-qa, live-qa and the reload series. |
| `web/packages/ui/DESIGN.md` | notes 13–18, one per item. |

Also, after the coordinator's ruling on the longest-task gate: the Live event list
renders its first six rows with the screen and appends six per animation frame, with the
row memoised (`web/packages/ui/src/dashboard.tsx`).

## Verification

### 1 · Icon ink is invisible in the dark theme

The `<lord-icon>` element in this version (`@lordicon/element` 3.0.2) applies
`currentColor` from a **`current-color` attribute**, not the class the component was
setting:

```
:host([current-color]) svg path[stroke] { stroke: currentColor; }
:host(:not([current-color])) svg path[stroke].primary { stroke: var(--lord-icon-primary, var(--lord-icon-primary-base, #000)); }
```

So the class was a no-op and the primary stroke kept the Lordicon default `#121331`.
Setting the attribute instead would have repainted the gold secondary too, so the fix
is the custom property the element's own palette rules read:
`--lord-icon-primary: currentColor`, in `packages/ui/src/styles.css` and in
`apps/dashboard/src/shell.css`, beside the existing `--lord-icon-secondary`.

Measured in both themes, every rendered primary path against its element's computed
`color`:

```
light icons 11 mismatched 0 {"where":"nav","stroke":"oklch(0.5 0.125 68)","color":"oklch(0.5 0.125 68)","secondary":"oklch(0.800 0.155 80)"}
dark  icons 11 mismatched 0 {"where":"nav","stroke":"oklch(0.852 0.13 76)","color":"oklch(0.852 0.13 76)","secondary":"oklch(0.845 0.152 82)"}
```

The Tools and Cost Lottie files do contain ten and four path colours that stay
`#121331`; every one of them is inside a `<clipPath>` and is never painted:

```
[{"icon":"Tools","hidden":false,"inDefs":true,"w":320,"h":0,...}, ... ten entries, all inDefs:true]
```

`visual-qa.mjs` now asserts this per screen, width and theme, and asserts that the nav,
button, pill and empty-state uses were all covered.

### 2 · Info popovers

All copy is in `web/packages/ui/src/copy/explanations.ts`: 89 entries, keyed
`<screen>.tile.<slug>` and `<screen>.card.<slug>`, two or three sentences each saying
what the number is, how it is computed (window, identity precedence, SLO class,
estimate against exact) and what a bad value means. A cross-check script confirms every
key is used and every `info=` id has copy:

```
keys 89 used 90
used but missing copy: ['protocol.card.']      # the template-literal id, not a real key
copy with no user  : []
```

Behaviour, measured at 1440, 390 and 320, both themes:

```
1440 overview   cards 5 cardInfo 5 tiles 6 tileInfo 6 expanded true esc-closed 0 refocus true labelledby "Tool calls" {"ok":true,"w":340,"focus":true,"pageScroll":true}
 390 settings   cards 6 cardInfo 2 tiles 0 tileInfo 0 expanded true esc-closed 0 refocus true labelledby "Alert rules" {"ok":true,"w":374,"focus":true,"pageScroll":true}
1440 setup      cards 3 cardInfo 0 tiles 0 tileInfo 0 NO INFO BUTTONS
light enter opens 1 focus-in-panel true / one at a time -> 1 / outside click -> 0 / toggle 1 -> 0 / contrast failures [] clipped []
dark  drawer popover 1 {"onTop":true,"inViewport":true}
 320 overview   clipped-labels [] no-h-overflow true pop {"ok":true,"w":304}
```

Settings shows 6 title rows and 2 popovers by design: its key, user, project and
API-key panels are forms with their own inline hints, and `visual-qa` asserts the two
analytics cards (Alert rules, Analytics settings) carry theirs. Setup and the login page
carry none, as the brief requires.

The panel is promoted to the top layer with the Popover API. Without it a tile's
`transform` and `contain: layout` make the tile the containing block for a fixed panel —
measured before the fix as `left: 25px, right: 399px` in a 390-wide viewport — and a
popover opened in the tool drawer would paint under the modal dialog.

### 3 · Project cards, and a choice that survives reloads

```
1440 cards 4 selected demo check-icons 1 pressed 1 border oklch(0.8 0.155 80) rows 1
1440 after click hash #overview?project=demo-fresh ls demo-fresh
1440 after reload selected demo-fresh hash #overview?project=demo-fresh
1440 shared link selected demo-many-clients screen Tools
 390 cards 4 selected demo check-icons 1 pressed 1 border oklch(0.8 0.155 80) rows 4
1440 stale id -> demo hash #overview?project=demo ls demo
1440 wrap wrap hint 0
1440 9 projects cards 9 {"wrap":"nowrap","scrolls":true,"tab":0,"role":"region"} hint 1 overflow 0
 390 9 projects cards 9 {"wrap":"nowrap","scrolls":true,"tab":0,"role":"region"} hint 1 overflow 0
```

`border oklch(0.8 0.155 80)` is `--primary`; `rows 1` at 1440 and 1280 is one wrapped
row, `rows 4` at 390 is the stacked layout. The selected card carries the `healthy`
check and `aria-pressed`. Project names wrap rather than clip, so the contrast/clip scan
stays at zero on a long name.

### 4 · One stable shell on reload

`bun scripts/reload-series.mjs` records 100 ms frames of a hard reload (HTTP cache
disabled over CDP) into `web/artifacts/v4/reload/`, with the DOM facts of each frame.
Observed, demo build:

```
    1ms old  shell=y strip=y(85px) cards=4 headingTop=39  heading="Overview" panels=5 connecting=no reading=no
  112ms new  shell=n strip=n(-1px)  cards=0 headingTop=-1  heading=null      panels=0 connecting=no reading=no
  213ms new  shell=y strip=y(85px) cards=4 headingTop=39  heading="Overview" panels=5 connecting=no reading=no
  313ms new  shell=y strip=y(85px) cards=4 headingTop=185 heading="Overview" panels=5 connecting=no reading=no
  ... frames 4-17 identical to frame 3 ...
Cumulative layout shift: 0.0015 after an ordinary reload, 0.0551 after a hard one
(["NAV.","FOOTER.app-footer"], the webfont swap)
Reload series passed: no Connecting or Reading text screen, no login card, the shell and
heading arrive with the content, the workspace strip holds its height, and an ordinary
reload reports zero layout shift.
```

The series is recorded twice: the hard reload the brief asks for, which the frames come
from, and an ordinary reload, which is what a reader actually does and which the
layout-shift assertion uses. With the HTTP cache off the webfonts are fetched again and
their swap moves the nav and the footer — font delivery, not this pass. Measuring the
sources of each shift is what found the one shift that *was* ours: until the fix below,
an ordinary reload scored 0.052, and the larger entry was the footer alone, moving down
when the first data replaced the quiet window. `.signals-ui:empty` and a loading
`.signals-ui > .loading-state` now reserve 70vh, so the page keeps its height until the
content lands, and the ordinary reload scores 0.0015 — one small nav shift, the font.

The single blank frame at 112 ms is the reloaded document before React mounts; it
carries no text at all (`text: ""`), which is what the item asked for — the old
behaviour painted a login-style "Connecting to Signals…" page there and a
"Reading your signals…" state after it. The shell, the project cards and the heading
arrive together at 213 ms; `headingTop` differs between 213 ms and 313 ms only because
the heading's entrance transform moves it, which is why the layout-shift measurement,
not `offsetTop`, is the assertion. The frames are deliberately **not** tracked: their
timings cannot be byte-identical between runs, which the screenshot gate requires of
everything under `web/artifacts/v3`.

The 200 ms delay and the 400 ms minimum cannot be shown in the demo build, whose client
answers synchronously. They are asserted in `backend-qa.mjs` against the real routes with
the network throttled: a 60 ms answer must show no skeleton at all, a 900 ms answer must
show one for at least 400 ms.

### 5 · Chart readouts

A pointer click now opens nothing, and a key press opens a readout built from the same
`headers`/`rows` as the hidden table twin:

```
== overview click-opened 0 kb "Date: 10/06 Tool calls: 7,688 calls "
    sparkline     ["Date","Tool calls"]      -> ["10/05","6,442 calls"]
    sparkline     ["Date","p95 latency"]     -> ["10/05","590 ms"]
    sparkline     ["Date","Tool success"]    -> ["10/05","99.2%"]
    stacked-area  ["Date","Cursor","Claude","ChatGPT"] -> ["10/05","2,190 calls","2,964 calls","1,288 calls"]
    donut         ["Client","Tool calls"]    -> ["Claude 0.1.0","22,178 calls"]
    funnel        ["Step","Identities","Drop-off"] -> ["connected","312 identities","0%"]
    heatmap       ["Cohort","Identities","Week 0",...] -> ["Week of 2026-09-07","120 identities","100%",...]
== tools  kb "Path: get_customer → list_orders Occurrences: 621 times Share: 9.6% "
    histogram     ["Latency band","Calls"]   -> ["1 – 1.3 ms","0 calls"]
== live   kb "Date: 17:59:22 Events: 0 events "
    sparkline     ["Date","Events"]          -> ["17:59:21","0 events"]
```

Hover, with the 120 ms delay observed and the readout clamped inside the plot box:

```
overview  donut       row 2 before120ms 0 tip "Client: ChatGPT 1.2026.280 Tool calls: 9,642 calls " cleared true
overview  funnel      row 0 before120ms 0 tip "Step: connected Identities: 312 identities Drop-off: 0% " cleared true
overview  sparkline   row 0 before120ms 0 tip "Date: 10/05 Tool calls: 6,442 calls " cleared true
overview  stacked-area                      crosshair 1   (the existing hover tooltip, kept)
adoption  bars        row 0 before120ms 0 tip "Transport: streamable-http Sessions: 6,200 sessions " cleared true
tools     sankey      row 0 before120ms 0 tip "Path: search_products → get_product → add_to_cart Occurrences: 812 times Share: 12.5% " cleared true
tools     histogram   row 0 before120ms 0 tip "Latency band: 1 – 1.3 ms Calls: 0 calls " cleared true
cost      treemap     row 0 before120ms 0 tip "Tool: get_product Context tokens: ≈ 6,192,480 tokens Share: 24.6% " cleared true
sessions  donut       row 2 before120ms 0 tip "Client: ChatGPT 1.2026.280 Sessions: 1,296 sessions " cleared true
```

The brief says mouse users "keep the crosshair/hover tooltips that already exist on the
stacked area and histogram". Measured: only the stacked area had one. The histogram now
has the generic pointer readout, so both behave as described.

### 6 · Live-updating stats

```
Live QA passed: 60000 ms refresh observed on the active screen, skeleton held 200/400 ms,
nothing while the tab is hidden, an immediate refresh on return and on a range change,
no dim, no replayed entrance, no count-up from zero, a ticking freshness stamp, and no
polling under __SIGNALS_VISUAL_QA__.
```

That run also measures the approved values directly: the dim is `opacity: 0.7`, the
content fade is `v4-content-in 0.24s` and its two keyframes set `opacity` only, a poll
leaves `data-stale` untouched while a project change sets and clears it, and every
chart's entrance marker carries `nt` after a redraw with no animation left running.

Against the real backend, `backend-qa.mjs` asserts the same from the request log: the
Overview burst is exactly `adoption, overview, tools` and nothing else, nothing is
requested before the interval is due or while the tab is hidden, and returning to the tab
requests at once.

### Performance: the Live mount, and what the longest-task gate measures

`performance-qa.mjs --walk` was over the 50 ms longest-task budget on the
`protocol → live` step, so I measured it against the branch point before changing
anything. **The branch point is over budget on this host too**: the same gate on
`1caeb4e`, with the new files removed and `dist` rebuilt, gives

```
Run 1 protocol → live: longest task 58.70 ms (budget < 50 ms)
Run 2 protocol → live: longest task 55.07 ms (budget < 50 ms)
Run 3 protocol → live: longest task 50.88 ms (budget < 50 ms)
```

against the 12.9–23.5 ms recorded in the committed `performance-walk.json` by the
earlier icon pass. The host, not this change, is what moved: a reference transition
(`overview → adoption`) measures 28–32 ms today and 32–39 ms in this pass's own gate
run, and the same ~50 ms reproduces on both chromium-1243 and chromium-1248.

The longest task is two React passes mounting the Live screen. From the step-7 trace:

```
longest task 62.7 ms
   62.36 ms  x20    FunctionCall        <- 34.6 ms and 27.3 ms into the react-dom scheduler
    2.59 ms  x1     UpdateLayoutTree
    1.57 ms  x1     Layout
```

and the CPU profile over the same window is 99 ms `(program)` and 25 ms `dispatchEvent`
with no JS frame above 4 ms: React commit and browser work, not application code.

The first remedy tried — building each event row's JSON payload only when the row is
opened — **made it worse**, measured twice, each A/B against its own control in the same
minute on an idle box:

| variant | protocol → live, longest task |
| --- | --- |
| control, payload always rendered | 47.8–52.3 ms, and 46.4–58.7 ms |
| payload built only for an open row | 67.6–84.2 ms |
| control plus one render pass removed on mount | 68.8–80.8 ms |
| per-row animated chevron replaced by a static glyph | 45.7–60.3 ms (no change) |

The gate measures the **longest single task**, not total work. Making the first pass
cheaper, or removing a pass, lets the remaining work merge into one task: aggregate
main-thread time falls from ~152 ms to ~136 ms while the longest task rises by 20 ms.

What actually helps is the opposite — splitting the mount so no pass is large. The event
list now renders its first six rows with the screen and appends six per animation frame,
and the row is memoised so a stream append renders the new row and leaves the rest alone.

#### Pre-existing: Live mount

After the split, `performance-qa.mjs --walk`, two consecutive runs of three:

```
run A  protocol → live  41.3  51.8  38.8 ms      (1 of 30 rows over budget)
run B  protocol → live  46.4  47.1  58.1 ms      (1 of 30 rows over budget)
every other transition, both runs: 16.2 – 44.9 ms
```

against, on the same host:

```
this pass, before the split   protocol → live  52.3  58.0  49.5 ms
branch point 1caeb4e          protocol → live  58.7  55.1  50.9 ms
```

`performance-qa.mjs` single, 15 repeats of `overview → adoption`, is green with room:
32.0 – 39.2 ms, and 24.4 – 37.3 ms in the walk runs above.

So the split removes roughly 10 ms from the step and leaves it marginal rather than
consistently over: one run in three still crosses 50 ms on this host, where the branch
point crossed it in three runs of three. The coordinator ruled that this pre-existing
failure is accepted rather than the budget raised. The remaining cost is React committing
the Live screen's cards and charts, which no item in this brief touches.

## Divergences and judgement calls

- **The card status line.** The brief asked for `Collector connected` / `Demo workspace`
  / `Catalogue unknown` "as today's badge logic". Today's badge has two outcomes and the
  workspace strip holds no catalogue data: the catalogue lives in the per-screen
  `analytics/tools` route and the project document from `/v1/auth/me` carries no
  catalogue field. Escalated; the coordinator dropped `Catalogue unknown`, so the cards
  carry today's two states.
- **The selected card's tool-call count** was offered as optional in the same answer,
  on condition of no per-project fetch. Not taken: the overview route is loaded only on
  the screens that read it (Overview, Tools, Sessions), so the line would appear and
  vanish as the reader moves between screens. Said so rather than shipping a number that
  blinks.
- **The reload series is not tracked.** `web/artifacts/v4/reload/` holds 18 frames and
  `series.json`; their timings cannot be byte-identical between runs, which is what the
  screenshot gate requires of everything tracked under `web/artifacts/v3`. The series
  table is in this report and `bun scripts/reload-series.mjs` regenerates the frames.
- **The histogram had no hover tooltip** before this pass, although the brief describes
  the stacked area and the histogram as both having one. Only the stacked area did; the
  histogram now has the generic pointer readout.
- **Two contract labels were wrong** and are corrected here, because item 5 is about
  headers meaning something: the tool-paths chart called its `count` column "Sessions"
  when `docs/analytics.md` defines it as occurrences of a pair or triple, and the
  grouped-bar renderer printed "payload size" under every chart that used it, including
  Error codes and Authentication failures.
- **Settings is not polled.** It is a form whose fields are initialised from the query,
  so a 60-second refresh would overwrite a half-typed threshold.
- **`#overview?projects=9`** pads the demo workspace so the more-than-six-projects scroll
  path can be exercised without a backend. Demo mode only.
- **`ci-conformance.py` tests whatever is in `web/dist`.** The collector serves the
  built dashboard, and the script does not rebuild it, so a conformance run after a
  source change silently exercises the previous bundle. Two runs of it failed here on a
  `data-event-id` added after the last build. `bun run build` immediately before
  `python3 scripts/ci-conformance.py` is the order the acceptance list already gives;
  flagged rather than changed, because the build step belongs to whoever owns CI.
- **The cached account** in `localStorage['signals-account']` holds what
  `/v1/auth/me` returns: the user's email and role and the project documents, which the
  page already renders. It carries no secret (`probe_key` is never returned by the API),
  it is replaced on every successful verification, and it is cleared on sign-out and on a
  401 or 403.

## Commands run

Every command below was run from `web/` unless stated, with
`PLAYWRIGHT_CHANNEL=chromium` and `PATH=$HOME/.cargo/bin:$HOME/.bun/bin:$PATH`.

```sh
bun run check            # build:ui + tsc --noEmit + eslint, clean
bun run build            # vite build, clean
bun run test             # snippet-id, spec, analytics, client-share and the two review
                         # probes, then visual-qa (11 screens × light/dark × 390/1280/1440
                         # plus a 320 pass), live-qa and the reload series
bun run test:next        # packs the UI package, installs it into examples/next-host,
                         # builds and drives the host
PERFORMANCE_REPEATS=15 bun scripts/performance-qa.mjs          # single, 15 repeats
bun scripts/performance-qa.mjs --walk                          # ten transitions × 3
python3 scripts/ci-conformance.py                              # from the repo root
```

### Observed output

```
$ bun run check
(no output; build:ui, tsc --noEmit and eslint all clean)

$ bun run build
dist/assets/index-D3BG_8Te.js   385.85 kB │ gzip: 119.39 kB
✓ built in 206ms

$ bun run test
Snippet UUID QA passed: randomUUID deleted, UUIDv7 timestamp/version/variant, missing and throwing crypto fallbacks.
Spec fixture QA passed: all 10 event types, UUIDv7, attrs, client/source, search and error/tool filters.
Demo contract shapes passed: 8 analytics routes × 4 ranges × 3 demo projects (complete, truncated catalogue, fresh window), all session timelines, missing/extra keys and type-drift guards.
Truncated catalogue QA passed: nullable dead, required completeness, retained calls and safe Tools/Overview rendering.
Analytics QA passed: 8 routes × 4 ranges, coherent totals, nulls, filters, ordered timeline, token divisor and alert persistence.
Client share QA passed: 27 clients, repeated versions, coherent calls/sessions and null shares without calls.
review-r1 probe passed
review-r2 probe passed
Visual QA passed: v3 chart SVG/table twins, painted funnel with a null day-7 step and a conversion
curve that ends at the last counted step, both drawer captures; 11 screens, light/dark, 390/1280/1440
widths, three-column tiles, 108px sparklines, full-row entity lists, 27-client legend, zero-call arcs,
fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
Live QA passed: 60000 ms refresh observed on the active screen, skeleton held 200/400 ms, nothing
while the tab is hidden, an immediate refresh on return and on a range change, no dim, no replayed
entrance, no count-up from zero, a ticking freshness stamp, and no polling under __SIGNALS_VISUAL_QA__.
Reload series passed: no Connecting or Reading text screen, no login card, the shell and heading
arrive with the content, the workspace strip holds its height, and an ordinary reload reports zero
layout shift.

$ bun run test:next
Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.

$ PERFORMANCE_REPEATS=15 bun scripts/performance-qa.mjs
Run 1..15 overview → adoption: longest task 32.00 – 39.20 ms (budget < 50 ms)

$ bun scripts/performance-qa.mjs --walk          # see "Pre-existing: Live mount" above
30 transitions, 29 under budget; protocol → live 41.3 / 51.8 / 38.8 ms (and 46.4 / 47.1 / 58.1 ms
in a second run), against 58.7 / 55.1 / 50.9 ms at the branch point.

$ python3 scripts/ci-conformance.py              # DATABASE_URL + ANALYTICS_PG_CONTAINER=dash-v4-ux-pg
                                                 # SIGNALS_URL=http://127.0.0.1:25450
                                                 # SIGNALS_PROBE_LATENCY_BUDGET_MS=900, TMPDIR on /var/tmp
Login style QA passed: theme tokens, loaded fonts, card/button/form styles, light/dark and 320/390/1440px.
Backend browser QA passed: real v3 analytics, project cards that survive a reload, a 60-second refresh
of the active screen alone that stops while the tab is hidden, a skeleton held back 200 ms and kept
400 ms, painted funnel with a null day-7 step, adoption session/WAU/MAU trend series, latency histogram
count sums and window-aligned band/sparkline, complete catalogue/dead/hallucinated tool filtering,
no-catalogue called names, empty/null states, batch/replay-derived tiles/tools/timeline/callers/cost,
project switch, login, keys, Live, persisted settings, 400 message, CSRF, logout.
identity: 52/52 valid fixtures matched, 54/54 invalid fixtures matched
gzip: 52/52 valid fixtures matched, 54/54 invalid fixtures matched
PASS auth-before-body, media/encoding, gzip/decoded limits, UTF-8, Bearer whitespace/case, replay,
whoami scopes, NUL repair, source/client persistence, caller IP hashing
FINDINGS 0 MISMATCHES 0
ci exit 0
```

Contrast and clip scans are part of visual QA and reported zero failures on every screen,
width and theme, including one scan per screen with an explanation open.

Two serial static runs of `bun scripts/visual-qa.mjs`, with the first committed in
between, left every file under `web/artifacts/v3` byte-identical:

```
run A exit 0
run B exit 0
=== files changed between serial runs ===
(nothing)
```

## What is not done

- `performance-qa.mjs --walk` still crosses the 50 ms longest-task budget on
  `protocol → live` in one run of three on this host. It crossed it in three of three at
  the branch point; the coordinator ruled this pre-existing failure accepted rather than
  the budget raised. Numbers and the longest-task breakdown are under "Pre-existing:
  Live mount".
- The optional secondary line on the selected project card (its tool-call count) is not
  shipped, for the reason given under "Divergences".

## Round 1 fixes

Review `reviews/dash-v4-ux-r1.md` filed four blockers and four should-fixes against
`ca43c95`. All eight are closed. The collector and `docs/analytics.md` are treated as the
source of truth for copy throughout.

### Blocker 1 · Bucket copy described a granularity the collector does not serve

I checked the contract in the collector rather than in the dashboard's own helper.
`crates/signals-store/src/analytics.rs` writes `"buckets":"day"` and `"bucket":"day"` as
literals, and a tool's trend is keyed by `date_naive()`, so calls by client, adoption
actives and tool trends sit on the UTC-day grid at every range. Latency is the one series
that follows the window: `latency_over_time.bucket` is `hour` while the window is 48 hours
or less and `day` after that.

- `web/packages/ui/src/time.ts` — `bucketForRange` (hour / day / week by range) is gone.
  In its place `SERIES_BUCKET = 'day'`, `latencyBucket(range)` and `bucketMilliseconds`,
  with the contract written out in a comment above them.
- `web/apps/dashboard/src/demo-analytics.ts` — the demo now puts calls by client,
  adoption actives and every tool trend on the UTC-day grid on all four ranges, and only
  the latency series switches: 24 hourly points at 24 hours, daily otherwise, with
  `latency_over_time.bucket` set to match. Round 2 corrected the rest of this sentence,
  which claimed a 24-hour window is one column and a 90-day window ninety: the collector
  emits a point only for a date that has calls. See "Round 2 fixes".
- `web/packages/ui/src/copy/explanations.ts` — the four popovers that stated the old rule
  now state the collector's: `overview.card.calls-by-client`, `adoption.card.active-identities`,
  `tool.card.calls-errors` and `overview.tile.p95-latency` (which is where the window-following
  behaviour belongs, "hourly up to 48 hours, daily after"). Card subtitles follow the same
  wording, so the 24-hour Calls-by-client subtitle reads `Daily tool calls · UTC`.
- Demo QA — `scripts/analytics-shapes.mjs` validates shapes and types only (`bucket` is
  checked as a string), so the bucket contract is asserted where it can be: both review
  probes. `web/test/review-r2/probe.mjs` now carries the collector's table — day buckets
  with 1 / 7 / 30 / 90 points, latency `hour` with 24 points at 24 hours and `day`
  elsewhere — plus the grid-gap, sparkline-equals-p95 and per-tool trend checks.
  `web/test/review-r1/probe.mjs` carried the same stale mapping and now carries this one.

Against the live collector, `backend-qa.mjs` asserts `latency_over_time.bucket` is `hour`
on `?range=24h` and `day` on the default seven days, so the one window-following series is
pinned from the API side too.

### Blocker 2 · Saved SLO targets now move every number that quotes them

`web/packages/ui/src/analytics-v3.tsx` reads the targets the collector serves
(`reliability.slo[].target`) through one `sloTargets()` helper, and one `targetsText()`
renders them. The Tools "Below SLO" tile, its meta line, the ribbon markers, the Overview
attention statuses, the Tool-health subtitle and the Tools-needing-attention subtitle all
read that single source, so the tile can no longer disagree with the error budget.

On the demo, saving 80 / 80 takes the Tools tile from `6` to `0`, its meta to
`read 80% · mutate 80%`, and the Overview caption to `0 tools below SLO`.

Against the live collector, `backend-qa.mjs` now saves 80 / 80 in Settings, waits for the
`PATCH`, and asserts `slo_targets` in the response, then the tile reading `0`, the meta
reading `read 80% · mutate 80%`, the Tool-health and Tools-needing-attention subtitles,
the Overview caption `0 tools below SLO`, and `tools_below_slo === 0` from
`analytics/overview`. `visual-qa.mjs` carries the demo-side equivalent.

### Blocker 3 · Every sparkline carries its own series' timestamps

`Sparkline` in `web/packages/ui/src/charts/index.tsx` no longer takes `values` with
optional `labels`. It takes `points: SparkPoint[]`, where `SparkPoint` is `{t, value}`.
The brief asked for labels required and the same length as the values; TypeScript cannot
express "these two arrays are the same length", so one array of pairs is the guarantee that
actually holds at the type level — a point cannot exist without its timestamp. Each tile
passes its own series, and the p95 tile passes
`reliability.latency_over_time.points[].t`, which is why the 24-hour readout is an hour
with a unit:

```
p95 readout: "Date: 01:00 p95 latency: 612 ms"
```

Fixing the plumbing surfaced a real bug in the Overview derived series: tool success and
context tokens were summed as `t.trend[i]` across tools, by index. The collector's
per-tool trends are sparse — a day with no calls is simply absent — so index `i` was a
different day for different tools. Those series are now keyed by date (`trendDays` and
`dayTotal`), which is also what makes the timestamps meaningful.

`visual-qa.mjs` walks every `.v3-chart` on the 24-hour overview and asserts no table twin
has a `Bucket` or `Value` column, and that the p95 readout matches
`/^Date: \d\d:\d\d p95 latency: [\d,]+ ms$/`. `backend-qa.mjs` asserts the same against the
live collector, where the review found the defect.

### Blocker 4 · Captures are byte-identical across four serial runs

The freshness badge was one source of variance: `apps/dashboard/src/main.tsx` now returns
a frozen `updated just now` and skips both the one-second repaint and the dot pulse under
`__SIGNALS_VISUAL_QA__`. It was not the cause of the three drawer captures the review
caught.

I measured before assuming. Across five runs the drawer's DOM, computed styles and
sub-pixel geometry were identical (`909.000, 93.531, 158.328, 124.594` every time,
`transform: none`, zero running animations, same `scrollHeight`), yet the captures flipped
between three states, and an image diff put all 70–79 differing pixels on the tiles'
rounded corners, with a maximum channel delta of 2. That is antialiasing, not layout.
Isolating it by launch flag over six and then ten runs:

```
--disable-partial-raster                     1 variant
--disable-lcd-text                           3 variants
--deterministic-mode                         2 variants
--disable-gpu                                3 variants
```

The cause is Chromium's partial raster: it reuses previously rastered tiles, and whether a
tile was reused decides how a corner on a fractional pixel boundary is resolved.
`visual-qa.mjs` now launches with `--disable-partial-raster`, so a capture depends only on
what is on the page.

The rest of the wall-clock audit: `sinceText` in `activity.ts` is the only clock-derived
text in the shell and now frozen; `activity.ts`'s `updatedAt` and the two skeleton timers
in `dashboard.tsx` are state, not text; the Setup screen's sample timestamp and snippet id
(`dashboard.tsx:300`, `snippet-id.ts`) come from `Date.now()`, which `visual-qa` already
pins with `page.clock.setFixedTime('2026-10-12T00:00:00Z')`.

Four serial runs against one demo server, hashing every `artifacts/v3/*.png` after each:

```
run 1 exit 0
run 2 exit 0
run 3 exit 0
run 4 exit 0
=== files hashed ===
116
run 1 vs run 2: identical
run 1 vs run 3: identical
run 1 vs run 4: identical
```

The four manifests of 116 files hash to one digest, `62ab6c8112bd636c…`. The three files
the review listed, and the two drawer captures that moved during the investigation:

```
59f87fc12721cdb75197ff274d8815ced2c73846d7dd6a030eae14a1423a07e2  adoption-390-light.png
e665bbb6b4c828e2794de2a60e47597102b09e072ef19d14ee8097f3c0c7ac1e  tool-drawer-1280-light.png
0d690fd89a60216cac6c472dc10ffce09ac57b18b71040058d0cf256d566164c  tools-390-light.png
6b5663ddfd40a09481c0ebea638f5a172616968973b2de0ecce9534596cd89d4  tool-drawer-1440-dark.png
b4315fd20b59a61c20a11f372dbabffc5409bd66e1de5a7bf542f02d17694f7a  tool-drawer-390-dark.png
```

### Should-fix · The stacked-area crosshair is now really checked

The `||true` is gone. The check scopes to the first `.chart-stacked-area`, scrolls it into
view (its painting is gated on an IntersectionObserver, which is why an unscrolled
`waitFor` on the svg timed out when I first tightened this), hovers the plot and asserts
exactly one `.tip` and one `.xh` inside that chart.

### Should-fix · Project-card rows are measured

`visual-qa.mjs` now measures `flex-direction` and counts rows by distinct `offsetTop`:
one row with `row` at 1280 and 1440, one row per card with `column` at 390.

### Should-fix · The skeleton test measures the 200 ms gate and the 400 ms hold

The old test delayed every analytics route, which is why a broken hold was invisible. Only
`analytics/overview` is delayed now, `.loading-state` is sampled every 20 ms from the
navigation, and the answer's real arrival time is measured rather than assumed. Observed on
the live collector:

```
delay   first content   skeleton on   skeleton off
0 ms        175 ms          never          never
150 ms      727 ms          320 ms        727 ms      (407 ms hold)
300 ms      721 ms          303 ms        721 ms      (418 ms hold)
```

The committed test uses the unthrottled run for the no-skeleton case and 300 ms for the
hold. The brief asked for 150 ms as the fast case; the measurements above are why it is
not: the 200 ms gate is counted from when the query starts, about 100 ms into the load, and
the two routes behind the delayed one still have to run, so 150 ms sits on the boundary —
it showed the skeleton in one run and not in the next. The unthrottled answer lands at
175 ms with no `.loading-state` sample at all, which is the same claim with margin. The
asserted properties are: nothing appears when the answer beats the gate; the skeleton never
appears before 200 ms; it lasts at least 400 ms; and the content and the skeleton swap in
one paint.

### Should-fix · The error-budget tick follows the saved burn threshold

`renderers.js` scales the gauge by the `burn` alert rule's threshold instead of a fixed 6,
and prints that threshold next to the red tick, so the change is visible and measurable.
`Gauge` takes `alert`, `Reliability` reads `project.alerts.find(r => r.id === 'burn').threshold`,
and `reliability.card.error-budget` says the tick is the burn the alert rule fires on, as
saved in Settings. Rescaling alone would not have shown up in the review's measurement —
the tick *angles* mark 0, ⅙, ½ and 1 of the threshold either way — which is why the label
is there: saving 3 takes `6×` to `3×`, and `visual-qa.mjs` asserts it.

### Three defects in the new assertions, found by running them

The new backend assertions failed the first four times I ran `ci-conformance.py`, each time
for a real reason in the test rather than in the product:

1. `visit()` navigated with `page.goto(base + '#screen')`. A goto that only changes the
   fragment never leaves the document, so re-entering the screen the page already showed
   fetched nothing and the helper waited 30 s for a request that was never made. It now
   reloads in that case, comparing only the screen in front of the fragment's query
   (`#settings?project=…`), so every visit really does exercise the route it names.
2. The 24-hour assertion called `analytics/reliability` with no range. The route defaults
   to seven days, so it was asserting `bucket === 'hour'` against a daily answer. It now
   names the window, and also asserts the seven-day default is `day`.
3. The SLO block drove whatever project the page was left on — the suite ends its project
   switch on the bootstrap project — so it saved targets on one project and asserted them
   on another. It selects the test project first.

The helper also reports the project and the screen it entered from when a route is never
requested, instead of a bare Playwright timeout.

### Round 1 commands, and what they printed

Run from `web/` unless noted, with `PATH=$HOME/.cargo/bin:$HOME/.bun/bin:$PATH` and
`PLAYWRIGHT_CHANNEL=chromium`. Google Chrome is not installed on this host and three of
these scripts default to `channel: 'chrome'`, so the channel has to be named; that is the
host, not a change in this pass.

```
bun run check                                                  # exit 0
bun run test                                                   # exit 0
bun run test:next                                              # exit 0
BASE_URL=http://127.0.0.1:23460 PERFORMANCE_REPEATS=15 \
  bun scripts/performance-qa.mjs                               # exit 0
BASE_URL=http://127.0.0.1:23460 bun scripts/performance-qa.mjs --walk   # exit 0
bun /tmp/.../info2.mjs                                         # contrast and clip
four serial BASE_URL=http://127.0.0.1:23340 bun scripts/visual-qa.mjs   # byte identity
python3 scripts/ci-conformance.py                              # from the repo root, exit 0
```

`bun run test`, the demo suite:

```
Snippet UUID QA passed      Spec fixture QA passed      Demo contract shapes passed
Truncated catalogue QA passed    Analytics QA passed    Client share QA passed
review-r1 probe passed      review-r2 probe passed
Visual QA passed: v3 chart SVG/table twins, painted funnel with a null day-7 step …
Live QA passed: 60000 ms refresh observed on the active screen, skeleton held 200/400 ms …
Reload series passed: no Connecting or Reading text screen, no login card …
```

`bun run test:next`:

```
Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.
```

Performance, single, 15 repeats of `overview → adoption`: every run under the 50 ms
longest-task budget, 31.44–40.67 ms. The walk, ten transitions × 3 runs: 30 of 30 rows
under budget, 14.97–47.19 ms, with the pre-existing Live mount at

```
Run 1 protocol → live: longest task 45.02 ms (budget < 50 ms)
Run 2 protocol → live: longest task 47.19 ms (budget < 50 ms)
Run 3 protocol → live: longest task 42.03 ms (budget < 50 ms)
```

which is the same marginal step recorded under "Pre-existing: Live mount" — accepted by
the coordinator, 45–47 ms here against 50.9–58.7 ms at the branch point, and under budget
in all three runs this time. Nothing else crossed either: the highest non-Live transition
was 46.77 ms (`reliability → sessions`, run 3), against the 44.9 ms high recorded before the
review on this host. Both are inside the budget and the spread between runs of the same
step is larger than that difference.

Contrast and clip, 1440 × 900, both themes, with an explanation open and inside the tool
drawer:

```
light contrast failures [] clipped []    light drawer popover 1 {"onTop":true,"inViewport":true}
dark  contrast failures [] clipped []    dark  drawer popover 1 {"onTop":true,"inViewport":true}
```

`python3 scripts/ci-conformance.py`, with `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:25480/signals`,
`ANALYTICS_PG_CONTAINER=dash-v4-ux-pg`, `SIGNALS_URL=http://127.0.0.1:25450`,
`ANALYTICS_REVIEW_URL=http://127.0.0.1:25448`, `ANALYTICS_REVIEW_PROBE_PORT=25449`,
`SIGNALS_PROBE_LATENCY_BUDGET_MS=900` and `TMPDIR` on a temporary directory under
`/var/tmp`, after `bun run build` (it serves whatever is in `web/dist` and never rebuilds
it):

```
identity: 52/52 valid fixtures matched, 54/54 invalid fixtures matched
gzip: 52/52 valid fixtures matched, 54/54 invalid fixtures matched
PASS auth-before-body, media/encoding, gzip/decoded limits, UTF-8, Bearer whitespace/case,
replay, whoami scopes, NUL repair, source/client persistence, caller IP hashing
Backend browser QA passed: … persisted settings that carry saved SLO targets into the
Tools tile and the overview caption, hour-stamped sparkline readouts on a 24-hour window …
FINDINGS 0 MISMATCHES 0
CI EXIT 0
```
