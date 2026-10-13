# Review: dashboard v6 polish (round 1)

Branch `vuk88/dash-v2` at `7212fd2`, against `eb9a253`. Author brief
`briefs/v6/dash-v6-polish.md`, author report `reports/dash-v6.md`.

`git status --porcelain` was empty at `7212fd2`, and every new file the author added is
in `git ls-files` (`web/scripts/v6-qa.mjs`, `web/scripts/v6-static-qa.mjs`,
`web/scripts/v6-status-qa.mjs`, `web/apps/dashboard/src/project-status.ts`,
`reports/dash-v6.md`, 130 files under `web/artifacts/v6/`).

VERDICT: changes required

Every gate the author claims passes when I run it myself — checks, build, both browser
suites, the Next host, four fresh byte-identical static capture runs, both performance
gates with no budget relaxed, and the integrated conformance harness at `FINDINGS 0
MISMATCHES 0`. The two blockers are things no gate currently looks at: a failed read on a
project or range change now paints the *previous* selection's numbers under the new one's
name, and the shorter project cards of item 3 push a sliver of the footer into the
viewport, which costs enough layout shift to break the existing reload gate.

All probes below are committed under `web/test/review-v6-r1/` and were run against a demo
Vite server on `127.0.0.1:23336` (started with `VITE_DEMO=1`), except
`project-status-backend.mjs`, which needs a real collector.

---

## Blockers

### B1. A failed read on a project or range change leaves the previous answer standing in for the new one

`web/packages/ui/src/dashboard.tsx:48-52`. `useQuery`'s error branch dropped the line that
cleared the held value:

```diff
-          if (kind !== 'refresh') held.current = undefined;
-          setState(old => ({ value: kind === 'refresh' ? old.value : undefined, error: …, loading: false, stale: false }));
+          setState(old => ({ value: old.value, error: …, loading: false, stale: old.value !== undefined }));
```

The comment that line carried said why: *"a failed range or project change must not leave
the previous answer standing in for the new one."* Brief item 6 asks for content
continuity through the *loading* of a refresh or dependency change ("never show a skeleton
or unmount content"); it does not ask for another project's numbers to be presented as
this project's after the read has failed.

```sh
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
  bun test/review-v6-r1/stale-project.mjs
```
```text
ok   the first project's client mix has 3 legend rows
     selected="Northwind MCP · first week" eyebrow="SIGNALS / northwind-fresh" tool calls 48.2K -> 48.2K
     range="90 days" tool calls 48.2K -> 48.2K

FAIL Northwind MCP · 27 clients: its client mix is not the previous project's 3 rows (got 3) or the screen says so (0 notices) — a failed adoption read keeps the old project's donut and legend silently
FAIL Northwind MCP · first week: the Tool calls tile does not still read the previous project's 48.2K while the page says "SIGNALS / northwind-fresh"
FAIL range 90 days: the Tool calls tile does not still read the 7-day answer 48.2K
```

Three distinct failures, all with a single injected error on one analytics route:

* **Supporting reads say nothing at all.** `AnalyticsV3` now runs `tq`/`aq`/`rq`/`oq` as
  their own queries (`analytics-v3.tsx:129-132`) and only `q.error` renders a notice. With
  `adoption` failing for the 27-client project, its Client mix donut, legend and the
  Active users / Sessions sparklines keep the previous project's three clients, and the
  screen carries **zero** notices. `pending` is false because `aq.value` is the old
  project's answer, so not even the shimmer appears.
* **The primary read gets one low-contrast line.** Expected `48.2K` to be replaced;
  instead every tile holds the previous project's figures at full opacity under
  `SIGNALS / NORTHWIND-FRESH`, with one `role=alert` notice reading *"Could not refresh
  this view. Showing the previous answer."* "Previous answer" reads as the previous
  refresh, not the previous project.
* **Range changes are the same.** `90 days` is pressed, the 90-day read fails, the 7-day
  numbers stay.

Observed state for the project case (`/tmp` capture reproduced by the probe):
`.project-card.is-selected` = "Northwind MCP · first week", `.eyebrow` = "SIGNALS /
NORTHWIND-FRESH", `Tool calls` = `48.2K`, `Active users` = `1,094`, `Sessions` = `6.5K` —
all of them the previously selected project's.

Expected: a dependency change whose read fails must not present the previous dependency's
answer as the new one's; either clear it as before, or label the content with the project
and range it actually belongs to. The supporting queries need the same treatment, since
they have no notice at all today.

### B2. v6 breaks the ordinary-reload layout-shift gate

`scripts/reload-series.mjs:118` asserts `warm.cls < 0.01` and its summary line claims
*"an ordinary reload reports zero layout shift"*. On this branch that is false, and it is
a v6 regression, not a flaky measurement.

Item 3 replaced the project cards' status line with a dot, so the cards are one row
instead of two and `.workspace-strip` is **68 px** where it was **85 px**. The empty shell
therefore sits 17 px higher, and the top **11 px** of `.app-footer` is inside a 1000 px
viewport while the screen still has no content. When the content arrives the footer leaves
the viewport, and Chromium records it:

```json
{"value":0.00904726261091821,"at":257,"sources":["FOOTER.app-footer"],
 "rects":[{"prev":{"y":989,"h":11},"cur":{"y":0,"h":0}}]}
```

Added to the pre-existing webfont shift of the nav (`0.0019933412905092595`, sources
`NAV.` + `DIV.topbar-actions`, both rects identical in y and height — a horizontal move),
the total is `0.0110`, over the gate.

Reproduced three times with 16 busy loops on a 16-core box (`for i in $(seq 1 16); do
timeout 420 bash -c 'while :; do :; done' & done`):

```sh
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
  RELOAD_OUT=…/run$run bun scripts/reload-series.mjs
```
```text
run1 EXIT=0  Cumulative layout shift: 0.0020 after an ordinary reload, 0.0110 after a hard one
run2 EXIT=1  Cumulative layout shift: 0.0110 after an ordinary reload, 0.0739 after a hard one
run3 EXIT=1  Cumulative layout shift: 0.0110 after an ordinary reload, 0.0243 after a hard one
```

`eb9a253`, built and served the same way on 23337 under the same load, passes 3/3:

```text
BASE run1 EXIT=0  Cumulative layout shift: 0.0020 after an ordinary reload, 0.0089 after a hard one
BASE run2 EXIT=0  Cumulative layout shift: 0.0020 after an ordinary reload, 0.0599 after a hard one
BASE run3 EXIT=0  Cumulative layout shift: 0.0020 after an ordinary reload, 0.0102 after a hard one
```

Base ordinary shifts are the nav alone: `[{"value":0.0019662932219328706,"at":179,
"sources":["NAV.","DIV.topbar-actions"]}]`.

A verification run reported `0.0591` with `NAV`, `FOOTER.app-footer` and
`DIV.topbar-actions` merged into one entry at 111 ms. That is the same two shifts plus the
webfont swap landing on the ordinary reload as well (under load the font is not served
from cache in time), so the nav's horizontal move and the footer's exit coalesce into a
single entry and the footer's share is larger because it moves while still fully in view.
The part that is new in v6 is the footer being in the viewport at all; `eb9a253` under the
same load never records a `FOOTER.app-footer` entry on an ordinary reload.

The load is only what makes the content arrive after the shell; the shift itself is
geometric and reproduces with no load at all once the screen's data is deliberately slow.
`web/test/review-v6-r1/reload-cls.mjs` asserts the invariant underneath the number, so it
is load-independent:

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium BASE_URL=http://127.0.0.1:23336 \
  bun test/review-v6-r1/reload-cls.mjs      # 7212fd2
```
```text
ok   the screen's content is still pending while this is measured (0 cards/tiles)
     reload shifts 0.0110: [{"value":0.0019933412905092595,…,"sources":["NAV.","DIV.topbar-actions"]},{"value":0.00904726261091821,…,"sources":["FOOTER.app-footer"]}]
FAIL the footer is out of the viewport while the screen has no content: strip 68px, footer top 989px in a 1000px viewport — the 11px of it that are visible become a layout shift the moment the content arrives
FAIL cumulative layout shift after an ordinary reload is under the 0.01 gate scripts/reload-series.mjs keeps: 0.0110
```
```text
# the same probe against eb9a253 on 23337
ok   the footer is out of the viewport while the screen has no content: strip 83px, footer top 1002px in a 1000px viewport
     reload shifts 0.0020: [{"value":0.0019662932219328706,…,"sources":["NAV.","DIV.topbar-actions"]},{"value":0.0000045…,"sources":["SPAN.demo-badge"]}]
ok   cumulative layout shift after an ordinary reload is under the 0.01 gate scripts/reload-series.mjs keeps: 0.0020
review-v6-r1 reload-cls probe passed
```

So: a **real shift**, caused by this change, costing 0.009 of a 0.01 budget that previously
had 0.008 of headroom. The brief's acceptance says GitHub CI must stay green, and CI is
slower than this box.

The deterministic fix is to stop the footer being in the viewport while the screen is
empty — reserve the screen's height from the first paint rather than rendering nothing for
`SKELETON_DELAY_MS`. Item 6 already asks for exactly that shape ("a card whose data is
pending renders its frame with a quiet shimmer inside, never a page-level loader"); the
same reasoning applied to the screen as a whole (a `min-height` on `.signals-ui` until the
first content paint, or the pending card frames rendered from the first paint) removes the
shift at its source. Reserved icon boxes and `font-display`/`size-adjust` would address
the remaining `0.00199` nav shift, which is pre-existing and not what fails the gate.
Changing `reload-series.mjs` to wait for fonts or custom elements before measuring would
only hide a shift the browser is correctly reporting.

---

## Should-fix

### S1. The new tile `unit` fields re-format the trend readouts and the hidden table twins

Item 2 asks for "the metric's unit chip if it has one" on the hover card. `unit` was
already the sparkline readout's formatter selector, and `analytics-v3.tsx:30-32`
documents the rule:

> `unit` the unit the sparkline readout should carry; without a unit the readout reuses
> the headline formatter, whose own text already names the unit ("≈ 3.4M" context tokens).

Adding `unit:'%'`, `unit:'tokens'` and `unit:'ms'` to three Overview tiles for the chip's
sake therefore switched their readouts to `unitFormat()`:

```sh
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
  bun test/review-v6-r1/probe.mjs
```
```text
ok   Tool success: the trend readout has rows ({"headline":"99.1%","readouts":["99.2 %","99.1 %","99.1 %","99.2 %","98.7 %"]})
ok   Context tokens: the trend readout has rows ({"headline":"≈ 25.2M","readouts":["4,849,020 tokens","6,283,360 tokens",…]})

FAIL Tool success: the trend readout reads like its own headline "99.1%"; got ["99.2 %","99.1 %","99.1 %"] — unitFormat('%') inserts a space the pct() headline never has
FAIL Context tokens: the trend readout keeps the estimate marker of its headline "≈ 25.2M"; got ["4,849,020 tokens",…] — docs/analytics.md calls every token figure an estimate, never a provider invoice
```

The tile headline reads `99.1%` and its own trend readout now reads `99.2 %`; the context
tokens headline reads `≈ 25.2M` and its readout reads `4,849,020 tokens`, having lost the
`≈` that marks it as an estimate everywhere else on the product. The same strings are the
keyboard readout and the hidden table twin, so this is what a screen-reader user hears.
`unit:'ms'` is harmless (`format(n)+' ms'` and `unitFormat('ms')` agree), but
`scripts/backend-qa.mjs:294` asserts `([\d,]+ ms|No data yet)` against it and
`unitFormat` rounds to one decimal, so a non-integer p95 would now fail that assertion.
The chip wants a separate field from the readout formatter.

### S2. Twelve hover cards print advice under "How it's computed"

Item 2 asks for `{ title, body, computed, action? }` and a "How it's computed" section.
All 89 entries were preserved word for word — I reconstructed `body + computed + action`
for each one against `eb9a253` and only `overview.tile.sessions` gained new text ("Counts
session starts in the selected window; calls per session divides their calls by their
session count"), which matches `docs/analytics.md:304-306` and
`crates/signals-store/src/analytics.rs:696`. But the two-sentence entries had no
computation sentence to put under the heading, and the second sentence went there anyway:

| id | rendered under "How it's computed" |
| --- | --- |
| `live.card.stream` | "Expand one for its full payload; pause to hold the view still while you read." |
| `sessions.tile.open` | "Long-lived clients legitimately sit here; so does a client that crashed without closing." |
| `sessions.tile.with-errors` | "One failing tool can appear in most sessions, so compare it with Tool health before blaming the transport." |
| `sessions.tile.stdio` | "These sessions never traverse your network, so availability probes say nothing about them." |
| `sessions.tile.cancelled` | "Cancellations are the client's decision, usually about how long it was prepared to wait." |
| `reliability.tile.sessions-with-errors` | "One bad tool can put an error in most sessions, so read it next to Tool health." |
| `reliability.card.auth-failures` | "These never appear as session or call errors, because there was no session yet." |
| `adoption.tile.new-users` | "They are the input to the activation funnel, so compare this with how many reached a first call." |
| `protocol.tile.server-capabilities` | "Advertising something no client uses is harmless; advertising something you do not implement is not." |
| `protocol.tile.elicitation` | "Blank means the SDKs have not reported accept, decline or cancel actions yet." |
| `cost.tile.per-call` | "It moves when responses get larger or when the token divisor is changed in Settings." |
| `overview.tile.tool-calls` | "The chip compares the same length of time immediately before." (about the chip, not the tile) |

Five of these also carry a definition under "What to do"
(`reliability.tile.sessions-with-errors`: "It is the closest thing here to 'how many
conversations went wrong'."; also `tools.tile.below-slo`, `sessions.card.replay`,
`cost.tile.heaviest-tool`, `live.card.events-per-second`). `cost.tile.per-call` is the
clearest case: its actual computation ("total estimated tokens divided by calls") is in
the body while the "How it's computed" section says when the number moves. Either move
the computation sentence into `computed`, or drop the heading when there is nothing
computational to put under it. Method: the entries were resolved with
`sloTargets:{read:99.5,mutate:98}` and compared field by field against `eb9a253`; the list
above is every entry whose `computed` carries no window, derivation or measurement.

### S3. A project that is receiving events shows gold until it is selected

Item 3 defines gold as "connected but no events in the window", and the tooltip hedges it
to "no events **observed** in this window", but the dot does not. Proven against a real
collector with two provisioned projects, one of them ingesting five `tool.called` events:

```sh
cd web && SIGNALS_URL=http://127.0.0.1:25691 PLAYWRIGHT_CHANNEL=chromium \
  bun test/review-v6-r1/project-status-backend.mjs
```
```text
FAIL a project with five tool calls in the window is not shown as gold before it is selected:
 {"cls":"project-card__status status-warn","title":"Connected · no events observed in this window",…}
 — gold means "connected but no events in the window", which is not what is known here
```

`/v1/projects/<id>/analytics/overview?range=7d` for that project reports
`tiles.tool_calls.value === 5` at the moment the card says gold. The author declared this
("projects without an observed active window stay gold", DESIGN note 29) and the brief's
own "no extra requests per project" leaves no way to know, but a strip where every
unselected project is gold reads as "those projects are idle". A fourth, neutral
appearance for "not looked at yet" would say what is true. Everything else about item 3
holds: see "Verified claims" below.

### S4. A press dragged off the info button disables its focus-to-open for good

`web/packages/ui/src/info.tsx:100`: `pointerFocus` is set on `pointerdown` and cleared
only in `onClick`. A press that leaves the button produces no click, so the flag stays set
and that button never opens on focus again.

```text
ok   focusing the info button opens its hover card
FAIL the info button still opens on focus after a press that was dragged off it (pointerFocus is never cleared without a click)
```
(`web/test/review-v6-r1/probe.mjs`, case 5: focus → 1 popover; `mouse.down()` on the
button, `mouse.move(10,900)`, `mouse.up()`, click elsewhere, focus again → 0 popovers.)
Clicking still works, because `onClick` clears the flag. Clearing it on `pointerup` or
`blur` as well is enough.

### S5. Two verification gaps

* `scripts/visual-qa.mjs:144` dropped `await page.keyboard.press('Enter')` but kept the
  message `${screen}: Enter did not open an explanation`. The assertion now passes on the
  focus handler alone, and no test presses a key on the button at all. Measured: focusing
  the button opens the card and moves focus *into the panel*, so a subsequent Enter is
  delivered to the panel and does nothing (1 popover before and after two Enter presses) —
  which is fine behaviour, but the suite claims to cover a path it no longer exercises.
* Nothing in the integrated harness asserted the project-state mapping: `backend-qa.mjs`
  has no `project-card__status` assertion, `v6-qa.mjs` proves it by importing
  `project-status.ts` into the page and handing it a literal overview body, and
  `v6-status-qa.mjs` proves it with a stubbed `fetch`. The wiring from a real collector
  answer to the card was untested. `web/test/review-v6-r1/project-status-backend.mjs`
  closes that; it passes on this branch apart from S4.

---

## Verified claims

Every command below is the author's, re-run by me. Unless noted, the output matched the
report.

| Author claim | My result |
| --- | --- |
| `cd web && bun run check` | **holds** — exit 0, no output beyond the two build lines |
| `cd web && bun run build` | **holds** — `✓ built in 1.10s`, `dist/assets/index-DoXFxP3v.js 395.10 kB` |
| Inline style + blocking theme script in the built `index.html` (item 7) | **holds** — `dist/index.html` carries `html,body{…background:oklch(93% .012 72)…}`, the `prefers-color-scheme:dark` and `html.dark` rules, both `theme-color` metas and the `localStorage['signals-theme']` script before the deferred module bundle. The inline colours equal `--background` in `styles.css:3` and `:42` exactly |
| `PLAYWRIGHT_CHANNEL=chromium bun run test` | **holds** — all 14 suites green: project status, snippet UUID, spec fixtures, demo contract shapes, truncated catalogue, analytics, client share, review-r1, review-r2, visual, live, choreography, reload series, v6 |
| `PLAYWRIGHT_CHANNEL=chromium bun run test:next` | **holds** — "Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles." |
| Four byte-identical static capture runs | **holds, and stronger** — I ran all four fresh (no `STATIC_BASELINE=1`): "Static capture run 1: 116 PNGs." then runs 2, 3, 4 "byte-identical to run 1", "Four serial static capture runs passed, including the full contrast/clip and unmasked drawer gates." Nothing under `artifacts/v3` changed across five visual runs |
| Contrast/clip 0 failures at 390/1280/1440, light and dark, with info surfaces open | **holds** — part of each of the five visual runs |
| `PERFORMANCE_REPEATS=15 bun scripts/performance-qa.mjs` | **holds** — "15 repeats of adoption: longest task median 36.05 ms, p90 40.02 ms, range 34.88–43.69 ms; 0 over budget (1 tolerated under 70 ms)" |
| `bun scripts/performance-qa.mjs --walk` | **holds** — "Walk, 30 rows: longest task median 35.48 ms, p90 44.12 ms, range 20.05–55.04 ms; 0 over budget (1 tolerated under 70 ms)"; the only transition near its budget is `protocol → live` at 51.78 ms under the documented 60 ms exception |
| No budget or outlier rule relaxed | **holds** — `performance-qa.mjs` is unchanged in the diff |
| `python3 scripts/ci-conformance.py` (isolated Postgres, own ports) | **holds** — exit 0; `identity: 52/52` and `54/54`, `gzip: 52/52` and `54/54`, "Backend browser QA passed: …", `FINDINGS 0 MISMATCHES 0` |
| Skeleton ≤ 1 per navigation, 0 after first content; project switch never unmounts content | **holds** — `v6-qa.mjs` passes, and `artifacts/v6/evidence.json` shows the switch series holding 11 cards across all 18 frames in both themes, `appearances ≤ 1`, `afterContent 0` |
| Info button geometry (item 1) | **holds** — every card and tile on Overview carries one; tiles `40×40` box with a `20 px` icon, cards `40×40` with a `24 px` icon, 9 px / 13 px from the host's right edge, icon centre within 1–5 px of the title's first line, at 1440 and 390 |
| Hover card fields, typography, never clipped (item 2) | **holds** — Urbanist, `text-transform:none`, `white-space:normal`, `letter-spacing:normal`; title row with unit chip, body, "How it's computed", "What to do"; 0 px of overflow for every card on Settings at 1440×620, 1440×1000 and 390×844, where the tallest copy is 363 px; mobile bottom sheet pinned 8 px off the bottom |
| Project states from loaded data, no extra request (item 3) | **holds** — against a real collector: a project with five ingested calls is `status-healthy` / "Connected · receiving events in this window", one with none is `status-warn`, a project whose reads answer 503 is `status-error`, demo is `status-dead` on all four cards, and selecting a project issues no per-project status request. See S3 for the unvisited case |
| Theme and sign-out icons 22 px, aligned with the tabs (item 4) | **holds** — tab icon 22×22 centre y 32, theme button 40×40 with a 22×22 icon centre y 32, mobile menu 40×40 / 22×22 centre y 32, sign-out 40×40 with a 22×22 icon (real backend) |
| Freshness badge and pulse removed, polling unchanged (item 5) | **holds** — `.updated-ago, .signal-dot` count 0 on demo and on the real backend; polling observed in the collector's own request log: 4 analytics requests before the interval, 8 after one `POLL_INTERVAL_MS` on a fake clock |
| "timing checks read scheduled values, not sampled frames" | **holds, and it is CI-safe** — the removed assertions were the wall-clock ones (`first.at` vs `tile.start`, the `COUNT_MS + 300` ceiling, the `finest` span). What is left is frame-count based (opens at zero, monotonic, ≥ 3 steps) plus `countDelay === tile.delay && countDuration === 640` read off `dataset`. `finest` is still computed for the artifact but no longer asserted |
| Container and temp dir removed, nothing pushed | **holds** — no `dash-v6-qa-pg` container, no `/tmp/dash-v6-qa`, `git status --porcelain` empty at `7212fd2` |
| "an ordinary reload reports zero layout shift" (`reload-series.mjs` summary) | **does not hold** — see B2: `0.0110` on this branch, `0.0020` at `eb9a253` |

---

## Probes committed

`web/test/review-v6-r1/` (all four pass their `ok` lines and fail only on the findings
above; `bun --bun eslint test/review-v6-r1` is clean):

* `probe.mjs` — navigation reachability at nine widths (passes, kept as a guard over the
  `.topbar nav` / `.mobile-menu` rule ordering), the Overview trend-readout formatting
  (S1), polling after one interval, focus-to-open and the `pointerFocus` latch (S4), and
  hover-card clipping on Settings at 1440×620, 1440×1000 and 390×844.
* `stale-project.mjs` — B1, three cases: a failing supporting read on a project change, a
  failing primary read on a project change, and a failing read on a range change.
* `reload-cls.mjs` — B2, deterministic: with the screen's data deliberately slow, asserts
  the footer is out of the viewport while the screen is empty and that the ordinary reload
  stays under the 0.01 gate.
* `project-status-backend.mjs` — item 3 against a real collector (S3 and S5): teal, gold,
  ember, state retention while another project is selected, no per-project status request,
  badge absence and polling in the collector's request log. Needs a collector; the header
  comment carries the exact commands.
