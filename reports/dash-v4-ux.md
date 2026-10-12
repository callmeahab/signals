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
