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
