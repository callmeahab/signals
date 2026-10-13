# Review round 3: dashboard v6 polish (after fix r2)

Branch `vuk88/dash-v2` at `385e7a5`, against main `ea8abca`. Fix brief
`briefs/v6/fix-dash-v6-r2.md`, author report `reports/dash-v6-r2.md`, round-2 review
`/home/vuk/orca/workspaces/syncup/boxfish/evidence/collector/reviews/dash-v6-r2.md`.

`git status --porcelain` was empty at `385e7a5`. `reviews/` was moved to the syncup
evidence by `ea8abca`, so this round's review recreates it.

VERDICT: changes required

No blockers. The round-2 blocker is closed and I could not reproduce it in any of the 18
runs the brief asks for; the scheduled-value assertions it was traded against are not
merely intact but stronger, and I proved they still bite by serving a mutated module.
S1 is closed, including a fresh variant that changes screen, trigger and failed route at
once. The single should-fix is small and fully specified: S2 fixed the seven bodies the
round-2 review named, and a sweep of all 89 entries — the fresh variant the brief asks
for — found three more entries of the same class that round-2's nine-card sample never
opened. They are untouched since `8d055b6`, so they are missed instances rather than a
regression, and the fix is three sentences.

Probes are committed under `web/test/review-v6-r3/` and run against a demo Vite server on
`127.0.0.1:23336` (`VITE_DEMO=1`).

---

## Blockers

None.

---

## Should-fix

### S1. Three more "How it's computed" sections hold an interpretation, not a derivation

Round 2's S2 was twelve entries whose derivation had been swapped out of "How it's
computed"; the fix rewrote the seven bodies the review named and all seven are right now.
The brief's fresh variant for S2 is a wider net, so
`web/test/review-v6-r3/copy-sweep.mjs` reads all 89 entries out of
`packages/ui/src/copy/explanations.ts` instead of opening nine cards in a browser:

```sh
cd web && bun test/review-v6-r3/copy-sweep.mjs
```
```text
ok   all 89 explanations are present
ok   every entry has title, body and computed: []
ok   no body opens with a pronoun that has no antecedent (0): []
ok   every body is a complete sentence rather than a label (0): []
ok   sessions.tile.stdio body is a complete opening sentence: "Stdio sessions connect clients to a locally launched server, so network availability probes do not cover them."
…all seven named bodies pass…

FAIL adoption.tile.mau: "How it's computed" describes a derivation, not what to make of the number — it reads "It is the denominator for stickiness and the widest honest measure of reach." while the derivation sits in the body ("Distinct identities active in the 30 days ending at the window end, counted the same way as WAU.")
FAIL reliability.tile.silent-failures: … it reads "The model cannot tell these from an empty answer, so they look like your tool had nothing to say." while the derivation sits in the body ("Calls that reported success with no output at all, plus results delivered after the client cancelled.")
FAIL reliability.card.error-codes: … it reads "It stays empty until the SDKs report codes, which is different from having no errors." while the derivation sits in the body ("JSON-RPC error codes behind the failed calls in the window, by count.")
```

Each of the three reads, under the heading "How it's computed", a sentence about what to
make of the number, while the sentence that says how it is computed is the body above it —
the exact shape round 2 found in `cost.tile.per-call` and eleven others. `git log -S` puts
all three at `8d055b6` ("Info popovers on every analytics card and tile"), so round 2's
fix did not create them; round 2's sample of nine cards did not open them.

The remedy is the one the round-2 fix already applied twelve times: move the derivation
sentence from the body into `computed` and the interpretation into `action` (or keep it in
the body after the definition).

Two things the sweep deliberately does **not** report, because they are not defects:
* 16 `computed` and `action` fields open with a bare pronoun ("It is a rolling count…",
  "These are the journeys worth making fast"). Those read correctly: the body directly
  above them supplies the antecedent. Only the body sits under a noun-phrase title with
  nothing before it, which is what the round-2 finding was about, and no body does this
  any more.
* Three bodies open "This tool's …" (`tool.card.calls-errors`, `tool.card.latency`,
  `tool.card.error-split`). That is determiner + noun naming the subject, not a bare
  pronoun.

---

## B1 (round-2 blocker): closed

The round-2 blocker was that six assertions in `scripts/choreography-qa.mjs` read sampled
frames or two observed `startTime`s, and two of them failed — the count-up step count
under CPU throttling and the 60 ms `FRAME_SLACK` draw-in ordering under 64 busy loops.

**Reproduction, the round-2 method, 18 runs, all exit 0.**

`countup-frames.mjs` with `THROTTLE_RATES=1,8,20`, three runs in each load condition:

| condition | runs | result |
| --- | --- | --- |
| no load | 3 | all exit 0 |
| 16 busy loops | 3 | all exit 0, 16 loops verified live before and after each run |
| 64 busy loops | 3 | all exit 0, 64 loops verified live before and after each run |

`scripts/choreography-qa.mjs`, three runs in each condition:

| condition | runs | result |
| --- | --- | --- |
| no load | 3 | all exit 0 |
| 16 busy loops | 3 | all exit 0 |
| 64 busy loops | 3 | all exit 0 |

and one complete `bun run test` with 64 busy loops live throughout, which exits 0 and
includes the choreography gate.

**The low-frame-rate branch is genuinely exercised, not vacuous.** At 20× throttling the
counters render exactly the two steps that used to fail the gate, and the gate now says so
while still checking everything that does not depend on the renderer:

```text
20x: Tool calls 2 steps, 1.9 fps (slowest-frame cadence 1.6); step count skipped below 20 fps; schedule, monotonicity and terminal checked
```

At 8× most rows are above the floor and the step count *is* checked
(`8x: p95 latency 9 steps, 37.1 fps … step count checked`), so the ≥ 3 requirement still
bites at ordinary frame rates. Under load the ordering guard fires as designed:

```text
cost: ordering observed at 6.0 fps, skipped (average 18.0 fps; threshold uses slowest-frame cadence); exact schedules checked
```

**No assertion depends on frame count or frame slack below the floor.** I enumerated all
29 `check(` sites in `scripts/choreography-qa.mjs` plus the four in `checkCounts`:

| gated on ≥ 20 fps | what it is |
| --- | --- |
| 179, 181 | observed first-card lead and tile-row spread, ±`FRAME_SLACK` |
| 192 | observed chart draw-in vs its owner's entrance, ±`FRAME_SLACK` |
| 255, 259 | the screenshot series' "caught ≥ 3 mid-entrance frames" and "no card before its tiles" |
| `count-sampling.mjs:70` | `samples.length >= 3`, on average fps over that tile's tween |
| `count-sampling.mjs:63` | the early-zero check, gated on a sample arriving inside 100 ms |

| unconditional | what it is |
| --- | --- |
| 143, 155, 159, 161, 162, 166, 167, 169 | scheduled delays and durations, exact equalities |
| 175, 176 | first card/tile order and tile-row spacing, now **exact** equalities on `delay` where round 2 had ±60 ms on observed starts |
| 195, 199 | every chart matched to an owner, and `drawIn === delay + CHART_AFTER` exactly |
| 250 | the series' per-row `delay`, `duration` and `drawIn`, exact |
| 208–210, 222, 229, 256, 257, 277–280 | finished-state and no-motion checks, which are not frame-rate dependent |
| `count-sampling.mjs:59, 61, 65, 67` | schedule equality, a sample exists, monotonicity, and the terminal value against `dataset.countTarget` — the last is new, and round 2 had no terminal check at all |

**The scheduled assertions still fail on a real regression.** `count-sampling-qa.mjs`
proves it against synthetic snapshots (and passes for me:
`Count sampling guards passed: low fps only relaxes observations, never schedules,
monotonicity or terminal values.`). I proved it against the real page as well, by serving
a mutated `@mcpramen/signals-ui` build inside one browser context and running the same
assertions on a snapshot of it — nothing in the worktree is modified:

```sh
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
  bun test/review-v6-r3/schedule-mutation.mjs
```
```text
ok   the unmutated page passes every scheduled, monotonic and terminal check: []
ok   every tile publishes its scheduled delay, 640 ms duration and formatted target: [{"l":"Tool calls","d":130,"u":640,"t":"48.2K"},{"l":"Active users","d":185,…}]
ok   count duration 640 -> 500: the gate still fails on it — got ["mutation: Tool calls count schedule 130/500, expected 130/640", …all six tiles…]
ok   tile stagger 55 -> 60: the gate still fails on it — got ["mutation: Active users count schedule 190/640, expected 185/640","mutation: Sessions count schedule 250/640, expected 240/640", …]
ok   terminal value off by one: the gate still fails on it — got ["mutation: Active users terminal value 1,093, expected 1,094", "mutation: Tool success samples are not monotonic: 0%,…,99.1%,98.1%", …]
review-v6-r3 schedule-mutation probe passed
```

One factual note, not a finding. The ordering guard thresholds on the **slowest** frame in
the window, which is stricter than the average the brief names. On this box the `tools`
screen — 70 charts — never reached 20 fps on that measure in any of the nine choreography
runs I made, loaded or idle, so its observed ordering is schedule-only here; `adoption`,
`cost` and the series did reach it on an idle box and were checked. The log prints both
numbers every time, so a reader can always see which half ran.

---

## S1 (round-2 should-fix): closed, with a fresh variant

The round-2 probe passes unchanged — the three Overview headlines the primary answer
carries now survive a failed supporting `tools` read:

```text
     before: {"Tool calls":"48.2K","Active users":"1,094","Sessions":"6.5K","Tool success":"99.1%","p95 latency":"640 ms","Context tokens":"≈ 25.2M"}
     after : {"Tool calls":"619.9K","Active users":"14,066","Sessions":"83.3K","Tool success":"99.1%","p95 latency":"640 ms","Context tokens":"≈ 323.7M"}
review-v6-r2 supporting-blanking probe passed
```

The fresh variant changes all three axes at once — a different screen, a different trigger
and a second failed route — because `support:'trend'` and `support:'caption'` are new
scoping that the round-2 probe never exercised outside Overview:

```sh
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
  bun test/review-v6-r3/support-scope.mjs
```
```text
ok   Cost / Context tokens keeps the primary token total after a failed tools read on a project switch: {"headline":"≈ 25.2M","caption":"estimated from output bytes","errorBeforeHeadline":false,"errorFrames":1,"trend":false,"notices":1}
ok   Cost / Context tokens says which read failed: 1 notices
ok   Cost / Context tokens shows no trend from the failed read: trend=false
ok   Cost / Per call is untouched by a failed tools read: {"headline":"522",…,"notices":0}
…Heaviest tool, Tenants, Largest payload, Billing period the same…
ok   the Cost screen still shows all 6 tiles
ok   Overview / Active users keeps the primary headline after a failed adoption read: {"headline":"1,094","caption":"312 new · 83 network-only","errorBeforeHeadline":false,…}
ok   Overview / Active users keeps its primary caption: "312 new · 83 network-only"
ok   Overview / Active users replaces only its adoption-fed trend
…Sessions the same; Tool calls, Tool success, p95 latency, Context tokens untouched…
review-v6-r3 support-scope probe passed
```

The probe asserts *where* the error frame sits rather than whether one exists: a
`.support-error` that precedes `.tile__value` would mean the headline was replaced, and
one that follows it means only a dependent fragment was. In every case the headline and
the primary caption stay and only the failed read's fragment is replaced.

---

## Verified claims

Every command is the author's, re-run by me at `385e7a5`.

| Author claim | My result |
| --- | --- |
| `cd web && bun run check && bun run build` exit 0 | **holds** — exit 0 and 0; `dist/assets/index-BxbYg0p8.js 397.82 kB │ gzip: 122.73 kB`, the bundle the report names |
| `PLAYWRIGHT_CHANNEL=chromium bun run test:next` exits 0 | **holds** — "Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles." |
| `bun scripts/count-sampling-qa.mjs` exits 0 | **holds** — and the guards are real: a 2-step climb at 20 fps fails, a non-zero early sample fails, a 300 ms duration fails at 2 frames, a decreasing series fails at 2 frames, and a wrong terminal text fails at 2 frames |
| Suites: three serial `bun run test`, one under 64 busy loops | **holds** — I ran two, one unloaded and one with 64 loops live throughout, both exit 0. Every suite line is green, including visual/contrast-clip, live, choreography, reload series, v6 QA, the three round-1 probes and the three round-2 probes |
| `countup-frames.mjs` at 1×, 8×, 20× with 64 busy loops, three runs | **holds, and extended** — 3 runs in each of three load conditions (none, 16, 64), 9 runs, all exit 0 |
| The gate's pass line is honest about what it checked | **holds** — it now names scheduled offsets and says "early zero, step counts and observed ordering checked only when sampling permits"; the per-screen lines print both fps measures and whether the observation ran |
| S1 closed | **holds** — round-2 probe passes, and the fresh variant above |
| S2 closed for the seven named bodies | **holds for those seven**; see the should-fix for three the round-2 sample never opened |
| Four byte-identical capture runs | **holds** — I ran four fresh: "Static capture run 1: 116 PNGs." then runs 2, 3, 4 "byte-identical to run 1", with the full contrast/clip audit and unmasked drawers in each |
| `PERFORMANCE_REPEATS=15 bun scripts/performance-qa.mjs` | **holds** — "15 repeats of adoption: longest task median 38.05 ms, p90 42.03 ms, range 34.69–43.02 ms; 0 over budget (1 tolerated under 70 ms)" |
| `bun scripts/performance-qa.mjs --walk` | **holds** — "Walk, 30 rows: longest task median 34.69 ms, p90 47.07 ms, range 19.64–57.88 ms; 1 over budget (1 tolerated under 70 ms)": `adoption → tools` at 57.88 ms, the one outlier the rule allows and well under the 70 ms ceiling, with `protocol → live` at 52.72 ms inside its documented 60 ms exception. The author's first walk failed on a 72.056 ms sample and they kept the failing log rather than hiding it; that sample did not recur for me either |
| `git diff --name-only ea8abca -- web/scripts/performance-qa.mjs` is empty | **holds** — no budget, exception or outlier rule was touched |
| `python3 scripts/ci-conformance.py` exits 0 | **holds** — exit 0 on an isolated Postgres and my own ports: `identity: 52/52` and `54/54`, `gzip: 52/52` and `54/54`, `review-v6-r1 project-status backend probe passed`, `FINDINGS 0 MISMATCHES 0` |
| The round-1 closures still hold | **holds** — in the suite: `review-v6-r1 stale-project probe passed` (B1), `review-v6-r1 reload-cls probe passed` (B2), `review-v6-r1 probe passed` (units, polling, focus latch, clipping), and the harness's backend status probe (the neutral "Not checked yet" state) |
| The seven v6 items still hold | **holds** — 11/11 cards and tiles on Overview carry an info button (tiles 40×40 with a 20 px icon, cards 40×40 with 24 px, 9/13 px from the host's right edge, icon centre within 1–5 px of the title's first line) at 1440 and 390 in both themes; hover card fields and mobile sheet in v6 QA; project dots with no status text; tab, theme and mobile-menu icons 22 px in 40 px boxes centred at y 32; no freshness badge with polling still observed; skeleton ≤ 1 per navigation; the inline style and theme script in the built `index.html` with no white frame |
| My round-2 probe `countup-frames.mjs` was rewritten by the fix pass | **not a weakening** — it now calls the shared `checkCounts`, and derives the expected schedule itself as `130 + 55 * i` rather than trusting the page, so it asserts the exact delay, the 640 ms duration, monotonicity and the terminal value on every tile at every rate. What it dropped is the one assertion the brief made illegitimate: that the sampled step count never falls below 3 |
| Container, temp dir and ports cleaned up; nothing pushed | **holds** — no `dash-v6-r2-pg` container, no `/tmp/dash-v6-r2`, `git status --porcelain` empty at `385e7a5` |

---

## Probes committed

`web/test/review-v6-r3/` (`bun --bun eslint test/review-v6-r3` exits 0):

* `schedule-mutation.mjs` — serves three one-line mutations of the UI build inside a
  browser context (count duration, tile stagger, terminal value) and asserts the gate
  still fails on each while the unmutated page passes. Passes.
* `support-scope.mjs` — S1's fresh variant: Cost with a failed `tools` read on a project
  switch, and Overview with a failed `adoption` read, asserting where the error frame sits
  relative to the headline. Passes.
* `copy-sweep.mjs` — S2's fresh variant: all 89 explanations, bodies checked for a bare
  opening pronoun and for being a sentence, the seven round-2 bodies by name, and the
  three mislabelled `computed` sections above. Fails on those three.
