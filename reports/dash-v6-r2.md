# Dashboard v6 round 2

Base: `ea8abca`. Scope: the choreography sampling blocker and the two supporting-data
and copy findings in the round-2 review. Changes are committed on `vuk88/dash-v2`;
no push or publication is part of this task.

## Changes

- `web/scripts/count-sampling.mjs` supplies the browser sampler and shared assertions
  for choreography and the CDP review probe. Sampling continues through a slow load
  instead of expiring before the first tile arrives. Disconnected previous-screen
  elements do not contaminate a new screen's samples. A final read includes terminal
  DOM text but does not pretend that read was another animation frame.
- `analytics-v3.tsx` publishes each counter's scheduled start and formatted target
  beside the existing delay/duration evidence. Timing code itself is unchanged.
  The sampler checks exact delay/duration, monotonic samples, and the terminal text
  against that scheduled target at every frame rate. It checks zero only if the
  first sample arrived before 100 ms into the scheduled tween, and requires three
  distinct steps only at 20 average fps or higher over the tween.
- `choreography-qa.mjs` checks tile/card delays, duration, tile-row spacing and
  `--draw-in` offsets exactly. Optional observed ordering uses the slowest-frame
  cadence in the measurement window: a long stalled frame must not be hidden by
  averaging it together with later fast frames. The log prints both this cadence
  and average fps; below 20 it prints “ordering observed at N fps, skipped”. The
  screenshot series uses the same observation guard while always checking its
  exact schedules and finished state. The pass line names schedules and conditional
  observations explicitly.
- `count-sampling-qa.mjs` exercises sparse late observations and deliberately wrong
  schedules, decreasing values, missing early zero, wrong terminal values, and
  inadequate step counts with healthy sampling. Low fps only relaxes observations.
  The reviewer's `countup-frames.mjs` uses the same assertions at CDP throttle rates.
- `analytics-v3.tsx` scopes supporting failures to the dependent tile fragment:
  tool-count caption, or the tool-success/token/adoption/latency trend. Primary
  headlines and primary caption fragments stay visible. Cost's primary token total
  gets the same protection. Entirely supporting-fed cards retain their error frame.
  `styles.css` gives the empty supporting frame a border, background and reserved
  height, with a compact caption variant.
- `explanations.ts` rewrites the seven named bodies as complete opening sentences
  identifying the metric, while retaining their computation fields. `test.mjs`
  includes the supporting-blanking, supporting-range and hover-copy probes, plus
  the sampler guards. `DESIGN.md` documents the data ownership and timing rules.

## Verification commands

Commands use `PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$PATH"` and Chromium. Durable
logs and the exact serial verification supervisor are in `web/artifacts/v6-r2/`.
The manual demo server was started with:

```sh
cd web && VITE_DEMO=1 bun node_modules/vite/bin/vite.js --config apps/dashboard/vite.config.ts --host 127.0.0.1 --port 23336
```

```sh
cd web && bun run check && bun run build
cd web && PLAYWRIGHT_CHANNEL=chromium bun run test:next
```

All exited 0 (`check.log`, `build.log`, `next.log`):

```text
$ bun run build:ui && bun --bun tsc --noEmit && bun --bun eslint .
dist/assets/index-BxbYg0p8.js 397.82 kB │ gzip: 122.73 kB
✓ built in 195ms
Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.
```

```sh
cd web && bun scripts/count-sampling-qa.mjs
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium bun test/review-v6-r2/supporting-blanking.mjs
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium bun test/review-v6-r2/hover-copy.mjs
```

All exited 0 (`sampler-guards.log`, `supporting.log`, `copy.log`):

```text
Count sampling guards passed: low fps only relaxes observations, never schedules, monotonicity or terminal values.
review-v6-r2 supporting-blanking probe passed
ok   every hover card's first line says what the number is; 0 open with a pronoun that has no antecedent: []
ok   no hover card's body is a bare label instead of a sentence: []
review-v6-r2 hover-copy probe passed
```

The initial focused choreography and throttle probe also exited 0, including 20×
with just two Tool calls/Sessions samples (`choreography-initial.log` and
`countup-initial.log`). That initial probe used slowest-frame cadence for step density;
the final implementation uses average fps for count steps and reserves slowest-frame
cadence for observed ordering, as documented above. Final repetitions are below.

The isolated harness starts with this worktree's built dashboard and a new database:

```sh
docker run -d --name dash-v6-r2-pg --shm-size=1g -e POSTGRES_PASSWORD=signals -e POSTGRES_DB=signals -p 127.0.0.1:25576:5432 postgres:17
docker exec dash-v6-r2-pg pg_isready -U postgres
PLAYWRIGHT_CHANNEL=chromium DATABASE_URL=postgres://postgres:signals@127.0.0.1:25576/signals ANALYTICS_PG_CONTAINER=dash-v6-r2-pg SIGNALS_URL=http://127.0.0.1:25577 ANALYTICS_REVIEW_URL=http://127.0.0.1:25578 ANALYTICS_REVIEW_PROBE_PORT=25579 SIGNALS_PROBE_LATENCY_BUDGET_MS=900 TMPDIR=/tmp/dash-v6-r2 python3 scripts/ci-conformance.py
```

The first launch raced PostgreSQL readiness and exited with `Connection reset by
peer`, before any browser check (`conformance-startup.log`). After `pg_isready`
reported `/var/run/postgresql:5432 - accepting connections`, the harness was restarted.
The short `/tmp/dash-v6-r2` symlink points to the worktree's owned temporary directory
and avoids Chromium socket-path length limits. Final harness output is recorded below.

The complete harness exited 0 (`conformance-final.exit`); selected final output:

```text
review-v6-r1 project-status backend probe passed
BENCH overview: median 150.62 ms; samples [148.15, 159.67, 150.62]
BENCH adoption: median 257.43 ms; samples [257.43, 256.09, 265.44]
BENCH tools: median 126.74 ms; samples [132.31, 126.74, 123.64]
BENCH reliability: median 118.06 ms; samples [112.08, 120.56, 118.06]
BENCH cost: median 136.39 ms; samples [136.39, 137.66, 135.33]
BENCH protocol: median 79.18 ms; samples [74.84, 79.18, 85.58]
BENCH digest: median 166.3 ms; samples [166.3, 166.61, 156.83]
BENCH alerts: median 1.99 ms; samples [2.02, 1.99, 1.76]
BENCH timeline: median 14.64 ms; samples [10.67, 14.64, 16.23]
FINDINGS 0 MISMATCHES 0
```

The owned PostgreSQL container/volume, short temporary symlink and backing temporary
directory were removed after this successful run.

The serial supervisor is reproducible with:

```sh
python3 -u web/artifacts/v6-r2/run-acceptance.py
```

It records every child command, extra environment and exit code in
`acceptance-results.json`. The first two serial `PLAYWRIGHT_CHANNEL=chromium bun run test`
runs exited 0, each producing 116 PNGs; `static-1.json` and `static-2.json` match
byte-for-byte. Both suites include the complete contrast/clip audit and unmasked drawers.

For load testing it launches **64** copies of:

```sh
timeout 1800 bash -c 'while :; do :; done'
```

The extended timeout keeps the load live for the full suite, rather than allowing
it to expire mid-run. Each of these commands then ran three times serially:

```sh
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium THROTTLE_RATES=1 bun test/review-v6-r2/countup-frames.mjs
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium CHOREOGRAPHY_OUT=artifacts/v6-r2/choreography-load-1 bun scripts/choreography-qa.mjs
```

The choreography output directory increments to `-2` and `-3`. All six exited 0;
`acceptance.log` records `Live busy loops: 64` after every pair. Example observations
from the first run, showing that the low-frame-rate branch was actually exercised:

```text
1x: Tool calls 7 steps, 15.7 fps (slowest-frame cadence 5.1); step count skipped below 20 fps; schedule, monotonicity and terminal checked
cost: ordering observed at 5.9 fps, skipped (average 17.6 fps; threshold uses slowest-frame cadence); exact schedules checked
cost: 6 tile and 4 card schedules checked, 11 chart owners matched; observed margin -79 ms is diagnostic
```

The observed -79 ms margin would have failed the old 60 ms check. The exact scheduled
180 ms chart offset still passed. All three loaded logs end with the revised honest
`Choreography QA passed` line naming scheduled offsets, conditional observations,
monotonicity, terminal values, one-run behavior and reduced-motion rendering.

The third serial suite also exited 0 with all 64 loops still live. Its visual capture
set matches the first two exactly. The supervisor then terminated and reaped every
owned load process; `acceptance.log` records:

```text
{'name': 'suite-3-load', 'command': ['bun', 'run', 'test'], 'environment': {}, 'exit': 0}
Static capture 3: 116 PNGs; identical to run 1.
Suite 3 completed with all 64 busy loops live.
Stopped and reaped all 64 owned busy loops.
```

Thus the requested three serial `bun run test` runs passed, including one complete
run under 64 loops. Each suite's final line was:

```text
review-v6-r2 supporting-range probe passed
```

Earlier lines in all three logs include the visual audit, live polling, choreography,
reload, v6 geometry/theme/skeleton checks, round-1 regressions, and the new round-2
headlines/copy probes. No suite assertion failed or needed a retry.

After stopping the load, the CDP probe ran three more times with all requested rates:

```sh
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium THROTTLE_RATES=1,8,20 bun test/review-v6-r2/countup-frames.mjs
```

All three exited 0; each log ends `review-v6-r2 countup-frames probe passed`.
The following ranges were computed directly from the six per-tile rows in each
log (fps is average delivery during that tile's scheduled tween):

```text
Run 1, 1x: 59.6–60.0 fps, 9–10 steps; passed
Run 1, 8x: 23.4–45.8 fps, 6–9 steps; passed
Run 1, 20x: 2.3–2.8 fps, 2–3 steps; passed
Run 2, 1x: 59.9–60.0 fps, 9–10 steps; passed
Run 2, 8x: 25.9–51.0 fps, 6–9 steps; passed
Run 2, 20x: 2.2–2.7 fps, 2–3 steps; passed
Run 3, 1x: 59.5–60.0 fps, 9–10 steps; passed
Run 3, 8x: 24.6–50.3 fps, 6–8 steps; passed
Run 3, 20x: 3.6–3.8 fps, 3–4 steps; passed
```
The 20× runs actually exercised two-sample counters; they still checked exact
schedules, monotonic samples and the terminal target.

The fourth fresh visual run also exited 0:

```sh
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium bun scripts/visual-qa.mjs
```

`visual-4.log` ends with the complete visual QA pass line (11 screens, both themes,
390/1280/1440 widths, chart/table twins, fonts, dialogs and controls). Every run used
the full contrast/clip audit and unmasked drawer checks. The supervisor confirms:

```text
Static capture 4: 116 PNGs; identical to run 1.
```

The four manifests `web/artifacts/v6-r2/static-{1,2,3,4}.json` are byte-identical;
all current static captures are in `web/artifacts/v3/`. The first three captures
came from the three serial full suites, and the fourth was this separate fresh
visual run. No baseline shortcut or masking was added. Final `bun --bun eslint .`
also exited 0 with no output (`final-lint.log`).

## Performance and final state

The performance script is unchanged: `git diff --name-only ea8abca --
web/scripts/performance-qa.mjs` produced no output. After all 64 busy loops were
stopped, these gates ran serially with no other owned browser test active:

```sh
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium PERFORMANCE_REPEATS=15 bun scripts/performance-qa.mjs
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium bun scripts/performance-qa.mjs --walk
```

Single mode exited 0:

```text
15 repeats of adoption: longest task median 38.04 ms, p90 44.62 ms, range 35.20–46.59 ms; 0 over budget (1 tolerated under 70 ms)
```

The first walk **failed** its unchanged 70 ms ceiling on one 72.056 ms
Adoption → Tools sample. The same transition's next two samples were 47.72 and
40.17 ms; the overall median was 37.31 ms and p90 was 47.72 ms. The failed log and
JSON are preserved as `performance-walk.log` and `performance-walk-failed.json`.
The serial supervisor stopped on this failure, so its original final traceback is
also retained. No timing budget, exception or outlier allowance was changed.

The failure justified a fresh confirmation walk with trace capture enabled for
that transition; no code was changed between walks:

```sh
cd web && BASE_URL=http://127.0.0.1:23336 PLAYWRIGHT_CHANNEL=chromium PERFORMANCE_TRACE_STEP=2 bun scripts/performance-qa.mjs --walk
```

The confirmation exited 0 (`performance-walk-repeat.log`):

```text
Walk, 30 rows: longest task median 33.53 ms, p90 48.31 ms, range 18.79–51.88 ms; 1 over budget (1 tolerated under 70 ms)
```

The earlier 72 ms sample did not recur; its cause is not established. The final
walk passed the original per-row budgets, documented Live exception and one-outlier
rule. `acceptance-results.json` records both the failed walk and successful repeat.
A final hash check printed:

```text
Four byte-identical manifests and all 116 current PNGs verified.
```

Cleanup and scope: the manual Vite process was stopped, and

```sh
ss -ltn '( sport = :23330 or sport = :23331 or sport = :23336 or sport = :25576 or sport = :25577 or sport = :25578 or sport = :25579 )'
```

returned only the header, with no test-port listeners. The database, temporary
symlink/backing directory and all 64 load generators had already been removed.
`git diff --check` passed. All three requested findings are closed; no API contract
or product timing value changed. All requested local checks have passed, with the
startup retry and initial performance outlier explicitly retained above. No remote
CI result is claimed and nothing was pushed.
