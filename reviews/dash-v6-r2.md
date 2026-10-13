# Review round 2: dashboard v6 polish (after fix r1)

Branch `vuk88/dash-v2` at `9629ed2`, against my round-1 review commit `5633b41`. Fix brief
`briefs/v6/fix-dash-v6-r1.md`, author section "Round 1 fixes" in `reports/dash-v6.md`,
round-1 review `reviews/dash-v6-r1.md`.

`git status --porcelain` was empty at `9629ed2`, and the round's new evidence is tracked
(157 files under `web/artifacts/v6-r1/`, four `web/artifacts/v6/static-{1..4}.json`).

VERDICT: changes required

All seven round-1 findings are closed, each reproduced with the round-1 method and with
the fresh variant the brief asked for: a failing supporting route on a *range* change now
clears the previous range's answer and names the failed read, and the reload layout-shift
invariant holds 3/3 at both 900 px and 1000 px viewport heights under the same 16-busy-loop
load, with no footer entry at 390×844, 1280×720 or 1440×900 either. Every gate reproduces:
suites, `test:next`, four fresh byte-identical static capture runs with the full
contrast/clip audit, both performance gates with the script unchanged, and the harness —
now including my round-1 backend status probe — at `FINDINGS 0 MISMATCHES 0`.

The one blocker is the item the coordinator asked me to grade, and it is a test defect
rather than a product one: `scripts/choreography-qa.mjs` still has six assertions that
read sampled frames, and I reproduced two of them failing — one verbatim as the
coordinator saw it. The v6 brief's acceptance says "GitHub CI must stay green, so timing
checks read scheduled values, not sampled frames"; these are the ones that were not
converted.

Probes are committed under `web/test/review-v6-r2/` and run against a demo Vite server on
`127.0.0.1:23336` (`VITE_DEMO=1`).

---

## Blockers

### B1. Six choreography assertions still read sampled frames, and two of them fail under load

The coordinator's report: `the Sessions tile reached 6.5K in 2 step(s), which is not a
climb`, plus eight more tiles and `cost: no tile counted up`.

**Reproduced under the round-1 load: no.** Three runs of `scripts/choreography-qa.mjs`
with 16 busy loops on this 16-core box all passed, with 9–10 sampled steps on the finest
tile — the same margin the author's own loaded run reports:

```text
run1 EXIT=0   cold #overview: 4 tiles climbed from zero, Tool calls over 620 ms in 9 steps
run2 EXIT=0   …
run3 EXIT=0   …
```

**Reproduced deterministically: yes**, with CDP CPU throttling, which is what "machine
under parallel load" amounts to for the renderer. `web/test/review-v6-r2/countup-frames.mjs`
installs the same frame-loop sampler `choreography-qa.mjs` installs and counts the
distinct headline texts each tile renders during its 640 ms climb:

```sh
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
  bun test/review-v6-r2/countup-frames.mjs
```
```text
{"rate":1, "fps":60,"steps":["Tool calls:9","Active users:10","Sessions:9", …],"tilesWithThreeSteps":6}
{"rate":4, "fps":51,"steps":["Tool calls:9","Active users:9", "Sessions:8", …],"tilesWithThreeSteps":6}
{"rate":8, "fps":37,"steps":["Tool calls:7","Active users:8", "Sessions:7", …],"tilesWithThreeSteps":6}
{"rate":12,"fps":23,"steps":["Tool calls:5","Active users:6", "Sessions:6", …],"tilesWithThreeSteps":6}
{"rate":20,"fps":5, "steps":["Tool calls:1","Active users:1", "Sessions:1", …],"tilesWithThreeSteps":0}
```

At 20× throttling with a longer observation window the texts are exactly the
coordinator's:

```text
rate=20 {"Tool calls":["0","48.2K"],"Active users":["0","1,094"],"Sessions":["0","6.5K"],
         "Tool success":["0%","99.1%"],"p95 latency":["0 ms","639.9 ms","640 ms"],
         "Context tokens":["≈ 0","≈ 25.1M","≈ 25.2M"]}
rate=16 {"Tool calls":["0","48.2K"],"Active users":["0","1,092.4","1,094"], …}
```

`["0","6.5K"]` is `the Sessions tile reached 6.5K in 2 step(s)`, and at a shorter window
every tile collapses to one sample, which is `no tile counted up`. The climb itself is
correct at every rate: it opens at `0`, is monotonic, and lands on the right value — and
`countDelay`/`countDuration`, the scheduled-value assertion v6 added, passes in all nine
of my choreography runs. So the product is right and the assertion is measuring the
renderer.

**Something else in the gate samples frames, and it fails on this box with no throttling
at all.** Three runs with 64 busy loops (the only change from the round-1 method):

```text
run4(64 loops) EXIT=1
  cost: the bars chart in card:1 draws in 116 ms before its own entrance allows, past the 60 ms a frame is worth
  cost: the bars chart in card:1 draws in 92 ms before its own entrance allows, past the 60 ms a frame is worth
  cost: the bars chart in card:1 draws in 61 ms before its own entrance allows, past the 60 ms a frame is worth
run5(64 loops) EXIT=0
run6(64 loops) EXIT=1
  cost: the bars chart in card:1 draws in 83 ms before its own entrance allows, past the 60 ms a frame is worth
```

The count-up assertions passed in those runs; this is `scripts/choreography-qa.mjs:247`,
a different check with the same cause. `FRAME_SLACK = 60` is documented as "a frame of
slack at 30 fps", and once a frame costs more than 60 ms the slack is spent.

**Everything in the gate that reads an observation rather than a schedule:**

| line | assertion | class | status |
| --- | --- | --- | --- |
| 136 | `values[0] === 0` — the first *sampled* text must be `0` | sampled | held to 20× here; same class |
| 137 | monotonic across samples | sampled | robust (order, not count) |
| 140 | `samples.length >= 3` | sampled | **fails from ~5 fps; reproduced verbatim** |
| 144 | `climbing.length > 0` → "no tile counted up" | sampled | **reproduced at 20×** |
| 235 | first card vs first tile, `<= FRAME_SLACK` | two observed `startTime`s | same class as 247 |
| 237 | the tile row is one run, `<= FRAME_SLACK` | two observed `startTime`s | same class as 247 |
| 247 | chart draw-in vs its owner's entrance, `>= … - FRAME_SLACK` | two observed `startTime`s | **fails 2/3 at 64 loops, unthrottled** |

Robust by construction, and unaffected: `countDelay === tile.delay &&
countDuration === COUNT_MS` (141), `owner.drawIn === owner.delay + CHART_AFTER` (254), and
the entrance delay/duration equalities — all read what the page scheduled.

The v6 brief's acceptance sentence — "GitHub CI must stay green, so timing checks read
scheduled values, not sampled frames" — is the one this does not meet, and it is the same
class as the CI failure the previous pass hit. The product needs no change.

The fix the coordinator proposed is the right shape for rows 140 and 144: keep
monotonicity and the terminal value on whatever samples arrive, and require the step count
only when the page achieved a minimum frame rate during the window — the sampler already
has the frame count it needs to say so. Rows 235, 237 and 247 need the same treatment from
the other side: they compare two observed `startTime`s, and the schedules behind them
(`delay`, `--draw-in`) are already asserted exactly on lines 141 and 254, so the observed
comparison can be skipped below that frame rate without losing a claim.

---

## Should-fix

### S1. A failed supporting read blanks headline numbers the primary answer carries

`SupportFrame` (`packages/ui/src/analytics-v3.tsx:41-46`) wraps a tile's whole body, and
`feedFor` maps `overview.tile.tool-calls`, `overview.tile.tool-success` and
`overview.tile.context-tokens` to `['tools']`. But those three headlines are
`d.tiles.tool_calls.value`, `d.tiles.success_rate.value` and
`d.tiles.context_tokens.value` from the **primary** overview answer; only their sparkline
and part of their caption come from `tools`. A failed supporting read therefore throws
away three numbers the page successfully loaded.

```sh
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
  bun test/review-v6-r2/supporting-blanking.mjs
```
```text
ok   the primary 90-day answer painted (Active users reads "14,066")
     before: {"Tool calls":"48.2K","Active users":"1,094","Sessions":"6.5K","Tool success":"99.1%","p95 latency":"640 ms","Context tokens":"≈ 25.2M"}
     after : {"Tool calls":"<support-error>","Active users":"14,066","Sessions":"83.3K","Tool success":"<support-error>","p95 latency":"640 ms","Context tokens":"<support-error>"}

FAIL Tool calls: the headline the primary overview answer carries survives a failed supporting `tools` read; got "<support-error>"
FAIL Tool success: …
FAIL Context tokens: …
```

Active users (`14,066`), Sessions (`83.3K`) and p95 latency (`640 ms`) prove the 90-day
primary answer arrived; the three tiles beside them read "Could not load tools data. No
data available for this view." over "No data available". Fix brief B1 asked for "their
empty/error frame" on the cards a failed supporting read feeds, which is right for a card
like Client mix that is entirely adoption-fed; applied to a tile whose headline is
primary-fed it withholds correct data. The notice and the pending/empty frame belong to
the sparkline and the caption, not to the headline.

(`<div class="support-error">No data available</div>` also has no rule in
`styles.css` or `shell.css`, so it renders as unstyled body text inside the tile.)

### S2. Six hover cards now open with a pronoun that has no antecedent, and one with a bare label

S2 was to "move each sentence to the right field". The derivation did move into "How it's
computed" on all twelve — but seven of them were fixed by swapping the two sentences, so
the **body**, which is the first line a reader sees under the card's own title, is now the
leftover interpretation.

```sh
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium \
  bun test/review-v6-r2/hover-copy.mjs
```
```text
     #reliability "Sessions with errors"
       body     : "It is the closest thing here to \"how many conversations went wrong\"."
       computed : "Sessions in the window with at least one failed call, and their share of all sessions."
     #cost "Per call"
       body     : "It moves when responses get larger or when the token divisor is changed in Settings."
       computed : "Estimated tokens the average call adds to the context, that is total estimated tokens divided by calls."
     #live "Your server, in the moment"
       body     : "Live event stream"
       computed : "Every event as it arrives, newest first, capped at the latest 200."

FAIL every hover card's first line says what the number is; 6 open with a pronoun that has no antecedent: [
 "stdio: These sessions never traverse your network, so availability probes say nothing about them.",
 "Open on this page: Long-lived clients legitimately sit here; so does a client that crashed without closing.",
 "Sessions with errors: It is the closest thing here to \"how many conversations went wrong\".",
 "Authentication failures: These never appear as session or call errors, because there was no session yet.",
 "Per call: It moves when responses get larger or when the token divisor is changed in Settings.",
 "Elicitation: Blank means the SDKs have not reported accept, decline or cancel actions yet."
]
FAIL no hover card's body is a bare label instead of a sentence: ["Your server, in the moment: Live event stream"]
```

"It", "These" and "here" have nothing to refer to: the title row above them is a noun
phrase, and the sentence that named the subject is now two sections further down.
`explanations.ts`'s own header states the contract — "Each entry is two or three short
sentences for a manager: what the number is, how it is computed …, and what a bad value
means or what to do about it" — and for these seven the body is no longer what the number
is. `live.card.stream`'s body is the new string "Live event stream", under a card titled
"Your server, in the moment".

The twelve entries' derivations are now correct under the heading, which was the finding;
these bodies need a subject.

---

## Verified claims

Every command is the author's, re-run by me at `9629ed2`.

| Author claim | My result |
| --- | --- |
| `cd web && bun run check && bun run build` both exit 0 | **holds** — exit 0 and 0; `dist/assets/index-6P4PwXsp.js 397.09 kB │ gzip: 122.56 kB`, the same bundle the report names |
| `PLAYWRIGHT_CHANNEL=chromium bun run test` exits 0 | **holds** — exit 0; visual, live, choreography, reload series, v6 QA and the three demo review probes all green, plus the nine node suites |
| `PLAYWRIGHT_CHANNEL=chromium bun run test:next` exits 0 | **holds** — "Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles." |
| B1 closed — `stale-project.mjs` passes | **holds** — exit 0: project switch takes the headline to `undefined`, the 27-client switch shows `0` old legend rows and 3 notices, the range change clears, and the four new refresh-retention checks (retained, dimmed to 0.7, noticed, then discarded on a later failure) pass for both `overview` and `adoption` |
| B1 fresh variant — a failing supporting route on a *range* change | **holds** — `test/review-v6-r2/supporting-range.mjs` exit 0: `legend 3 -> 0, donuts 0, Active users trend rows 7 -> 0`, three notices all reading "Could not load adoption data. No data available for this view.", none offering a previous answer, and the primary 90-day tiles painting (`Tool calls` `619.9K`) |
| B2 closed — `reload-cls.mjs` passes, footer out of the viewport | **holds** — exit 0: `strip 68px, footer top 1157px in a 1000px viewport`, `reload shifts 0.0020: [{… "sources":["NAV.","DIV.topbar-actions"]}]` |
| B2 — reload-series 3/3 under the 16-busy-loop load | **holds** — 3/3 exit 0, each `Cumulative layout shift: 0.0020 after an ordinary reload, 0.0020 after a hard one`. The hard reload is now 0.0020 too, where round 1 measured 0.0243–0.0739 |
| B2 fresh variant — 900 px and 1000 px viewports under load, 3 runs each | **holds** — 6/6 exit 0 with 16 busy loops live for every run: `1440x900: footer 1057px -> 2420px, shifts 0.0022` ×3 and `1440x1000: footer 1157px -> 2420px, shifts 0.0020` ×3, no shift attributed to the footer in any run. Also checked once each at 390×844 (strip 180px, reserved 712px, footer 1158px, **0.0000**) and 1280×720 (reserved 588px, footer 875px, 0.0032) |
| S1 closed — units no longer change trend readouts or table twins | **holds** — `Tool success` readouts are `["99.2%","99.1%","99.1%","99.2%","98.7%"]` against the `99.1%` headline, and `Context tokens` readouts are `["≈ 4.8M","≈ 6.3M","≈ 6.1M",…]` against `≈ 25.2M`; the chip comes from the new `infoUnit` |
| S2 closed — the twelve entries' sections | **partly** — the derivation is under "How it's computed" in all twelve (verified field by field against `eb9a253`); see S2 above for the bodies |
| S3 closed — unread project is neutral, never gold | **holds** — in the harness: `{"cls":"project-card__status status-unknown","title":"Not checked yet"}` for a project whose overview reports five tool calls but has not been selected; teal once selected, gold for an observed empty window, ember on 503, teal retained while another project is selected, no per-project status request |
| S4 closed — the dragged-off press no longer disables focus-to-open | **holds** — `probe.mjs` case 5 passes: `mouse.down()` on the button, drag to (10,900), `mouse.up()`, click away, focus again → 1 popover |
| S5 closed — Enter is actually pressed; backend QA runs the status probe | **holds** — `visual-qa.mjs:156-157` now presses Enter after Escape and asserts the reopen, and the message on line 146 says "focus did not open an explanation"; `qa:backend` is `backend-qa.mjs && test/review-v6-r1/project-status-backend.mjs`, and the harness log shows `review-v6-r1 project-status backend probe passed` |
| Four fresh static capture runs, no `STATIC_BASELINE` shortcut | **holds** — "Static capture run 1: 116 PNGs." then runs 2, 3 and 4 "byte-identical to run 1"; the four committed manifests are identical to each other and all 116 current `artifacts/v3` PNGs match manifest 1 |
| Contrast/clip 0 failures | **holds** — part of each of the five visual runs (suite + four static) |
| `PERFORMANCE_REPEATS=15 bun scripts/performance-qa.mjs` | **holds** — "15 repeats of adoption: longest task median 37.65 ms, p90 42.04 ms, range 35.56–46.28 ms; 0 over budget (1 tolerated under 70 ms)" |
| `bun scripts/performance-qa.mjs --walk` | **holds** — "Walk, 30 rows: longest task median 35.90 ms, p90 47.91 ms, range 18.43–53.75 ms; 1 over budget (1 tolerated under 70 ms)": `overview → adoption` at 50.95 ms, the one outlier the rule allows, and `protocol → live` at 53.75 ms inside its documented 60 ms exception |
| `git diff --name-only 5633b41 -- web/scripts/performance-qa.mjs` is empty | **holds** — no budget, exception or outlier rule was touched |
| `python3 scripts/ci-conformance.py` exits 0 | **holds** — exit 0 on an isolated Postgres and my own ports: `identity: 52/52` and `54/54`, `gzip: 52/52` and `54/54`, "Backend browser QA passed: …", `review-v6-r1 project-status backend probe passed`, `FINDINGS 0 MISMATCHES 0` |
| Choreography passes under the 16-busy-loop load | **holds** — 3/3 exit 0 here too. It does not survive 64 loops; see B1, which is a new finding, not a failed claim |
| `reload-series.mjs`'s retry does not weaken the gate | **holds** — the retry is scoped to a destroyed execution context, re-reads on the committed document, and re-raises on a second failure. It waits for nothing else, and the layout-shift observer, the 0.01 threshold and every frame assertion are untouched. It makes line 113's shell assertion stricter: it used to run against `{detached:true}` with `content: undefined` |
| The seven v6 items still hold | **holds** — 11/11 cards and tiles on Overview carry an info button (tiles 40×40 with a 20 px icon, cards 40×40 with 24 px, 9/13 px from the host's right edge, icon centre within 1–5 px of the title's first line) at 1440 and 390 in both themes; hover card fields, typography and mobile sheet pass in v6 QA; project dots have no status text; tab, theme and mobile-menu icons are 22 px in 40 px boxes all centred at y 32, sign-out 22 px in a 40 px box on the real collector; no `.updated-ago`/`.signal-dot` and polling observed in the collector's request log; skeleton ≤ 1 per navigation and 0 after content with the switch series holding 11 cards across all 18 frames; the inline style and blocking theme script are in the built `dist/index.html` and the 100 ms reload series shows no white frame |
| Container, temp dir and ports cleaned up; nothing pushed | **holds** — no `dash-v6-r1-pg` container, no `/tmp/dash-v6-r1`, `git status --porcelain` empty at `9629ed2` |
| My round-1 probes were edited by the fix pass | **not a weakening** — `project-status-backend.mjs` went from `!cls.includes('status-warn')` to requiring `status-unknown` *and* the exact tooltip, and `stale-project.mjs` from `after !== before \|\| notice > 0` to `after === 0 && notice === 3` plus four new refresh-retention cases. Both are strictly stronger |

---

## Probes committed

`web/test/review-v6-r2/` (`bun --bun eslint test/review-v6-r2` exits 0):

* `supporting-range.mjs` — B1's fresh variant: a failing supporting route on a range
  change. Passes.
* `reload-cls-viewport.mjs` — B2's fresh variant, `VIEWPORT_WIDTH`/`VIEWPORT_HEIGHT`
  parameterised; asserts the footer is outside the viewport while the screen is empty, that
  no shift is attributed to the footer, and that the ordinary reload stays under the 0.01
  gate. Passes at 1440×900, 1440×1000, 1280×720 and 390×844.
* `countup-frames.mjs` — B1 above: the sampled step count against CDP CPU throttling, with
  the frame rate each run achieved. Fails at 20× (0 tiles reach 3 steps).
* `supporting-blanking.mjs` — S1: the three Overview headlines the primary answer carries
  that a failed `tools` read blanks. Fails.
* `hover-copy.mjs` — S2: the rendered hover-card bodies on nine cards. Fails on 6 dangling
  pronouns and 1 bare label.
