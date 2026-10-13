# Dashboard v5 follow-up: the count-up survives StrictMode, and the gate asserts it

Branch `vuk88/dash-v2`, worktree `dash-v2`. Branch point: `ce332b3` ("Move dashboard v5
report and review out of the public repo"). Brief: `briefs/v5/fix-dash-v5-countup.md`.
Review should-fix: `reviews/dash-v5-r1.md` in the syncup evidence, "Count-up is part of the
approved choreography and is not what the gate measures, and the Vite dev server skips it".

Commits:

| sha | what |
|---|---|
| `7bd6f95` | `Count` survives React's development double-invoke; `choreography-qa.mjs` asserts the climb |
| `4f57835` | the poll check in `live-qa.mjs` reads the charts that had painted, not every marked element |
| `de821d2` | this report |
| `04f0c01` | the gate separates what was scheduled from what was observed, after the GitHub CI failure |
| `6752de3` | the gate prints how close the earliest draw-in came to its own window |

## 1 · Why the dev server showed no climb

`Count` in `web/packages/ui/src/analytics-v3.tsx` set `painted.current = true` and
`shown.current = value` — the *final* value — before its timer was scheduled, and the
cleanup only cleared the timer. React's `StrictMode` runs an effect, tears it down and
runs it again, all before anything is painted. The second run therefore saw a tile that
had already been painted: it took `first = false`, `from = shown.current` (the final
number), a 300 ms duration and a 0 ms wait, so it tweened from the answer to the answer.
The production bundle, which invokes the effect once, climbed correctly — which is why
this was invisible to the acceptance run and visible to a reader on the dev server.

The fix is to make the refs describe what has actually happened rather than what is about
to:

- `painted` and `shown` move inside the timer, when the climb actually starts.
- The cleanup puts both back when the timer never fired. A climb torn down before it
  started never happened, so the next run is a first run again — which is exactly the
  double-invoke's second pass.
- `shown` now tracks the number on screen as the climb runs, instead of jumping to the
  target up front. A value that changes mid-climb then tweens from where the reader can
  see it, which is what the 300 ms branch was always meant to do.

Production behaviour is unchanged: one invoke, the timer fires at the tile's stagger,
`painted`/`shown` are set, the climb runs for 640 ms.

Measured on the dev server (`VITE_DEMO=1`, StrictMode, `PLAYWRIGHT_CHANNEL=chromium`),
the headline of the first tile, sampled on an animation-frame loop:

```
cold #overview, "Tool calls"
  303 ms "0"   484 "2.4K"  567 "18.3K"  651 "30K"  734 "38.2K"
  817 "43.5K"  900 "46.5K"  984 "47.8K"  1068 "48.2K"

navigation overview → tools, "Advertised"
  3089 ms "0"  3256 "1.1"  3334 "5.9"  3417 "9.5"  3501 "12"
  3584 "13.6"  3667 "14.5"  3751 "14.9"  3834 "15"
```

That is the review's own measurement of the production bundle, now produced by the server
`bun run test` drives.

## 2 · The gate asserts the climb

`web/scripts/choreography-qa.mjs` defined `COUNT_MS = 640`, wrote it into `series.json`
and never read it. It now samples every tile's headline on an animation-frame loop — a
`recordCounts` init script, installed before the document runs so a cold load is covered
from its first frame, and restarted with `__countsFrom(ms)` before each navigation — and
holds every tile to:

- it opens at zero;
- it never goes backwards;
- it takes more than one step;
- it starts climbing with its own tile's entrance (the tile's recorded entrance start,
  not the mount), within −48/+180 ms;
- it is over inside the 640 ms ease, +190 ms of frame and sampling slack.

The *end* of the ease is pinned on one tile per screen: the one with the most steps. What
a reader sees stops changing once the eased number rounds to the final one, which for a
small headline happens well before the ease ends — `Never called` (value 3) lands its last
visible step at about 510 ms and is climbing perfectly correctly. The tile with the most
steps is the one with the resolution to show the whole ease, and that is where 640 ms is
asserted. Headlines that are not numbers are skipped: the billing period's `2026-10` and
any `No data yet`. The match is anchored at both ends so `2026-10` cannot read as 2026.

Measured, all four screens the gate walks:

```
cold #overview: 4 tiles climbed from zero, Active users over 666 ms in 10 steps
tools:   5 tiles climbed from zero (Retries   over 660 ms in 10 steps)
adoption: 6 tiles climbed from zero (DAU      over 657 ms in 10 steps)
cost:    4 tiles climbed from zero (Per call  over 666 ms in 10 steps)
```

### The assertion has teeth

With the `Count` change reverted and nothing else touched, the same gate fails on the same
server:

```
cost: the Heaviest tool tile opened at "24.6%", expected zero
cost: the Heaviest tool tile reached 24.6% in 1 step(s), which is not a climb
cost: the Heaviest tool tile started climbing 245 ms before its own entrance
cost: the Tenants tile opened at "3", expected zero
cost: the Largest payload tile reached 1.4K in 1 step(s), which is not a climb
cost: the Per call tile, the finest climb on the screen with 1 steps, settled -190 ms
      after its entrance, expected 640 ms
```

One step per tile, the final value from the start, a negative span: the review's finding,
reproduced by the gate.

## 3 · One consequence in `live-qa.mjs`

The poll check tagged every `.plot/.stroke-draw/.growx/.growy/.popin` element before the
poll and required everything untagged afterwards to carry `nt`. Since v5 every chart on a
screen is built, one card per animation frame, and live QA runs on `page.clock`'s fake
clock — so a chart whose turn in that queue has not come is still waiting to be built when
the poll fires, and its first paint legitimately draws in. The run that caught this had
`{"total":19,"redrawn":19,"instant":10}`.

The claim is about charts that have *already painted*: a refresh must redraw those
finished. The figures that have an SVG are now tagged before the poll — React keeps the
`<figure>` and the refresh replaces its contents — and only what the refresh puts back
inside them is read. The script prints the counts, so the check cannot pass vacuously:

```
poll: 19 charts had painted, 19 of them still on screen, 19 redrawn parts, all 19 finished
poll:  9 charts had painted,  9 of them still on screen, 19 redrawn parts, all 19 finished
```

Two runs, different points in the build queue, the same claim held.

## 4 · The same gate on GitHub CI

Remote CI (`main` at `ce332b3`, job `check`, step `bun run test`) failed inside
`choreography-qa.mjs` with

```
adoption: the donut chart in card:1 draws in 17 ms before its own entrance allows
```

after every tile, card and chart count on that screen was already complete. The check it
failed compared two clocks that are only aligned to a rendering update: an animation's
`startTime` is the frame it was created in, and `performance.now()` inside an effect is
some way into that frame's work. A chart's `--cd` is computed on the second clock and
asserted on the first. On a shared runner that gap is a frame or more, and the check
allowed two milliseconds.

The gate now keeps the two apart.

**What was scheduled is exact, on any host.** Delays and durations are read off the
animation objects and compared for equality, as before — and a new check covers the same
draw-in claim from the schedule rather than from a clock. Every tile and card publishes
`--draw-in`, the instant its charts may begin, and it must equal that owner's own entrance
delay plus 180 ms:

```
tiles --draw-in  310 365 420 475 530 585 ms   (130 + 55i, + 180)
cards --draw-in  480 565 650 735 820 ms       (300 + 85i, + 180)
```

**What was observed carries one frame at 30 fps.** Comparisons between two animations'
absolute starts — a chart against its card, the first card against the first tile, the
tile row against itself — now allow 60 ms. The sampled count-up bounds are loosened to
match: the climb may start up to 60 ms before its tile's recorded entrance and must be
over inside the ease plus 300 ms, and the finest climb on the screen has to span at least
0.6 of the 640 ms, which a 300 ms tween or a jump cannot reach.

**The margin is printed**, so the tolerance is evidence rather than a guess. Three runs of
the gate with sixteen busy cores alongside it (`nproc` is 16, one spinner each):

```
=== loaded choreography run 1: exit 0
tools:    earliest -34 ms into its own window, 60 ms of slack
adoption: earliest   0 ms into its own window
cost:     earliest  -3 ms into its own window
=== loaded choreography run 2: exit 0
tools:    earliest -38 ms    adoption: 0 ms    cost: -19 ms
=== loaded choreography run 3: exit 0
tools:    earliest -34 ms    adoption: 0 ms    cost: -36 ms
```

The worst case measured is −38 ms, which is the clock gap CI reported as −17 ms; the old
±2 ms was never going to hold on a shared runner, and 60 ms leaves about 22 ms of headroom
at the worst observed point. The exact `--draw-in` half passed in every one of those runs.

And three runs of the whole suite under the same load:

```
loaded run 1: bun run test exit 0 (load: 16 spinners)
  poll: 19 charts had painted, 19 of them still on screen, 19 redrawn parts, all 19 finished
  cold #overview: 4 tiles climbed from zero, Active users over 617 ms in 10 steps
  Choreography QA passed: …
loaded run 2: bun run test exit 0 (load: 16 spinners)
  cold #overview: 4 tiles climbed from zero, Active users over 616 ms in 10 steps
loaded run 3: bun run test exit 0 (load: 16 spinners)
  cold #overview: 4 tiles climbed from zero, Active users over 666 ms in 10 steps
```

Count-up spans across the loaded runs: 553–672 ms, every one inside the window, and still
far above the 384 ms a 300 ms tween would have to clear.

With the box quiet the same margin is positive — `tools` +15 ms, `adoption` 0 ms, `cost`
0 ms — which is why nothing caught this locally and CI did.

## Files changed

| file | change |
|---|---|
| `web/packages/ui/src/analytics-v3.tsx` | `Count` marks `painted`/`shown` when the climb starts; the cleanup reverts them when it never did; `shown` tracks the number on screen |
| `web/scripts/choreography-qa.mjs` | samples every tile headline and asserts the climb on a cold load and on each navigation; tile entrances carry their label; schedules asserted exactly and orderings given one frame at 30 fps, with the margin printed |
| `web/scripts/live-qa.mjs` | the poll check is scoped to the figures that had painted, and prints its counts |
| `web/packages/ui/DESIGN.md` | note 23 corrected (the gate does assert the count-up, and how); new note 26 for the double-invoke |

## Verification

From `web/`, `PLAYWRIGHT_CHANNEL=chromium` exported (there is no Google Chrome channel on
this box), with a demo Vite server on port 23500 for the scripts that take `BASE_URL`.

```
$ bun run check
$ bun run build:ui && bun --bun tsc --noEmit && bun --bun eslint .
(no further output; tsc and eslint clean)
check exit 0

$ bun run build
dist/assets/index-5Td7uw7u.js   387.91 kB │ gzip: 120.30 kB
✓ built in 212ms
build exit 0

$ bun run test
Snippet UUID QA passed …
Spec fixture QA passed …
Demo contract shapes passed …
Truncated catalogue QA passed …
Analytics QA passed …
Client share QA passed …
review-r1 probe passed
review-r2 probe passed
Visual QA passed: v3 chart SVG/table twins on every screen with nothing scrolled, no unpainted
card in any capture, unmasked drawer captures …
poll: 9 charts had painted, 9 of them still on screen, 19 redrawn parts, all 19 finished
Live QA passed: 60000 ms refresh observed on the active screen … no replayed entrance, no
count-up from zero …
cold #overview: 4 tiles climbed from zero, Active users over 649 ms in 10 steps
tools:    … 5 tiles climbed from zero (Retries over 639 ms in 10 steps)
adoption: … 6 tiles climbed from zero (DAU over 654 ms in 10 steps)
cost:     … 4 tiles climbed from zero (Per call over 652 ms in 10 steps)
Choreography QA passed: tiles at 130+55i ms, cards at 300+85i ms capped at 1100 ms, every
chart's draw-in 180 ms behind its own card or tile, every tile headline climbing from zero
over 640 ms from its own entrance on a cold load and on every navigation, one run per
navigation with nothing on scroll or resize, a 18-frame 100 ms series in artifacts/v5/
choreography/, and the finished page at once under reduced motion.
Reload series passed: no Connecting or Reading text screen, no login card …
test exit 0

$ bun run test:next
Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.
next exit 0

$ PERFORMANCE_REPEATS=15 bun scripts/performance-qa.mjs
15 repeats of adoption: longest task median 34.36 ms, p90 38.57 ms, range 32.42–40.00 ms;
0 over budget (1 tolerated under 70 ms)
single exit 0

$ bun scripts/performance-qa.mjs --walk
Run 3 protocol → live: longest task 50.77 ms (budget < 60 ms, documented exception …)
Walk, 30 rows: longest task median 33.28 ms, p90 45.69 ms, range 13.92–50.77 ms;
0 over budget (1 tolerated under 70 ms)
walk exit 0
```

Contrast and clip are part of visual QA, which reported no `Contrast` or `Clip` line, so
both counts are zero on every screen, width and theme.

### Four byte-identical static capture runs

`scripts/visual-qa.mjs` four times serially against the same server, hashing every PNG
under `web/artifacts/v3` after each run:

```
run 1 exit 0   160 files
run 2 exit 0   160 files
run 3 exit 0   160 files
run 4 exit 0   160 files
=== diffs against run 1 ===
run 2: identical to run 1
run 3: identical to run 1
run 4: identical to run 1
```

`git status --porcelain web/artifacts/v3` reports **0** changed PNGs after those runs, so
the captures committed in the v5 pass are a fifth identical set: nothing in this follow-up
moves a pixel in a static capture, which is expected — those runs use
`reducedMotion: 'reduce'`, where `Count` renders its final value directly and never climbs.
The manifest at `web/artifacts/v5/static-capture-sha256.txt` is byte-identical to the
one these runs produced; its digest is
`e89a9772eb4a4946d1780ba02912ea52e823a90f3d5acf49843472df62f3e967`, the same digest the
round-1 review recorded.

## What is not done

Nothing from the brief or the coordinator's CI follow-up is outstanding. Three notes for
the record:

- **The `live-qa.mjs` change was not asked for.** It is a consequence of the v5 pass that
  this run surfaced: the old assertion read every marked element on the page, which under
  the fake clock includes charts the build queue had not reached. It is reported here
  rather than left as an intermittent failure in the harness the acceptance list runs.
- **`artifacts/v5/choreography/` stays outside the byte-identity gate**, as the v5 report
  already recorded: a 100 ms screenshot series of a running animation cannot be identical
  between runs. `series.json` now also carries the cold load's count-up samples.
- **The four byte-identical capture runs were taken before the CI-robustness commits**
  (`04f0c01`, `6752de3`), which touch only `scripts/choreography-qa.mjs` and print a
  number. `git status --porcelain web/artifacts/v3` is still clean at `HEAD`, so those
  commits moved no pixel; `visual-qa.mjs` is untouched by them.
