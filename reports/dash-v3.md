# Dashboard v3 implementation report

Status: **acceptance incomplete**. Functional web, Next.js, and integrated collector checks pass; the performance budget and exact mock fidelity remain unresolved. Work is on `vuk88/dash-v2`; nothing was pushed. The coordinator requested this report here and will move reports out of the public repository at merge time.

## Changes

- Merged `main` first after preserving inherited dirty v2 screenshots/report in a stash. Merge commit: `c22e4cc`; inherited screenshot preservation: `c3ddee7`. The inherited report is preserved in ignored `web/artifacts/inherited-dash-v2.md` and the original stash remains.
- `web/packages/ui/src/charts/renderers.js` adapts the approved mock's SVG renderers without a chart library. `charts/index.tsx` adds responsive React wrappers, keyboard tooltips, hidden data tables, waiting states, histograms, band charts, rings, ranked bars, and all requested chart families. `index.ts` exports the primitives.
- `analytics-v3.tsx` implements Overview, Adoption, Tools and its drawer, Reliability, Cost, and Protocol against the analytics client. `dashboard.tsx` and `analytics.tsx` connect Sessions, its timeline drawer, Live, and the editable Settings cards while retaining existing account/key/setup behavior.
- `styles.css`, dashboard `shell.css`, and `main.tsx` add the v3 tokens, surfaces, navigation thumb, responsive grid, chart motion, count-ups, mobile table scrolling, and reduced-motion handling. Callers remains available by direct route.
- `analytics-types.ts`, `apps/dashboard/src/demo-analytics.ts`, analytics shape and QA scripts support the coordinator's amended histogram and percentile contract. Histogram edges contain 60 lower bounds plus a final null, with 60 counts; reliability method is a sibling of bucket and points. New fields are optional for collectors not yet shipping the parallel amendment.
- TypeScript configurations enable the mock-derived renderer module; ESLint has a narrow renderer exception. Browser, Next.js, regression, backend, visual, and performance probes exercise the new implementation.
- `backend-qa.mjs` verifies complete catalogue filtering, an advertised dead tool, a hallucinated call, and a separate no-catalogue project with called names visible. The scenario existed after the main merge; selectors and chart assertions now support v3.

## Side-by-side captures

[Open the full comparison gallery](dash-v3-comparison.html). It places approved reference and implementation captures next to one another, including both themes and widths. Missing reference drawer/mobile or Callers images are identified rather than invented.

| Screen | 1440 light | 1440 dark | 390 light | 390 dark |
|---|---|---|---|---|
| overview | [Compare](dash-v3-comparison.html#overview-1440-light) | [Compare](dash-v3-comparison.html#overview-1440-dark) | [Compare](dash-v3-comparison.html#overview-390-light) | [Compare](dash-v3-comparison.html#overview-390-dark) |
| adoption | [Compare](dash-v3-comparison.html#adoption-1440-light) | [Compare](dash-v3-comparison.html#adoption-1440-dark) | [Compare](dash-v3-comparison.html#adoption-390-light) | [Compare](dash-v3-comparison.html#adoption-390-dark) |
| tools | [Compare](dash-v3-comparison.html#tools-1440-light) | [Compare](dash-v3-comparison.html#tools-1440-dark) | [Compare](dash-v3-comparison.html#tools-390-light) | [Compare](dash-v3-comparison.html#tools-390-dark) |
| tool-drawer | [Compare](dash-v3-comparison.html#tool-drawer-1440-light) | [Compare](dash-v3-comparison.html#tool-drawer-1440-dark) | [Compare](dash-v3-comparison.html#tool-drawer-390-light) | [Compare](dash-v3-comparison.html#tool-drawer-390-dark) |
| reliability | [Compare](dash-v3-comparison.html#reliability-1440-light) | [Compare](dash-v3-comparison.html#reliability-1440-dark) | [Compare](dash-v3-comparison.html#reliability-390-light) | [Compare](dash-v3-comparison.html#reliability-390-dark) |
| sessions | [Compare](dash-v3-comparison.html#sessions-1440-light) | [Compare](dash-v3-comparison.html#sessions-1440-dark) | [Compare](dash-v3-comparison.html#sessions-390-light) | [Compare](dash-v3-comparison.html#sessions-390-dark) |
| session-drawer | [Compare](dash-v3-comparison.html#session-drawer-1440-light) | [Compare](dash-v3-comparison.html#session-drawer-1440-dark) | [Compare](dash-v3-comparison.html#session-drawer-390-light) | [Compare](dash-v3-comparison.html#session-drawer-390-dark) |
| cost | [Compare](dash-v3-comparison.html#cost-1440-light) | [Compare](dash-v3-comparison.html#cost-1440-dark) | [Compare](dash-v3-comparison.html#cost-390-light) | [Compare](dash-v3-comparison.html#cost-390-dark) |
| protocol | [Compare](dash-v3-comparison.html#protocol-1440-light) | [Compare](dash-v3-comparison.html#protocol-1440-dark) | [Compare](dash-v3-comparison.html#protocol-390-light) | [Compare](dash-v3-comparison.html#protocol-390-dark) |
| live | [Compare](dash-v3-comparison.html#live-1440-light) | [Compare](dash-v3-comparison.html#live-1440-dark) | [Compare](dash-v3-comparison.html#live-390-light) | [Compare](dash-v3-comparison.html#live-390-dark) |
| setup | [Compare](dash-v3-comparison.html#setup-1440-light) | [Compare](dash-v3-comparison.html#setup-1440-dark) | [Compare](dash-v3-comparison.html#setup-390-light) | [Compare](dash-v3-comparison.html#setup-390-dark) |
| settings | [Compare](dash-v3-comparison.html#settings-1440-light) | [Compare](dash-v3-comparison.html#settings-1440-dark) | [Compare](dash-v3-comparison.html#settings-390-light) | [Compare](dash-v3-comparison.html#settings-390-dark) |
| callers | [Compare](dash-v3-comparison.html#callers-1440-light) | [Compare](dash-v3-comparison.html#callers-1440-dark) | [Compare](dash-v3-comparison.html#callers-390-light) | [Compare](dash-v3-comparison.html#callers-390-dark) |

## Contract and design differences

- Coordinator explicitly approved retaining the shipping Python/Node/cURL Setup snippets: the mock's `withSignals(server)` API does not exist.
- Client stack colors/order follow the design notes (teal, gold, flame), which conflict with the mock's sample order. Axis ceilings are rounded upward to keep data within bounds; the mock's sample peak can exceed its top tick.
- The tool drawer uses a single-scale calls/errors stacked area rather than the sample's dual-axis composition, following the brief's one-scale rule. Session counts are honestly labeled “Open on this page”; no fabricated global count is shown. Sessions use retained real timeline events.
- Demo histograms use the amended 60-bin contract, with counts summing to calls, rather than the mock's 30 sample bins. Production latency charts wait when the optional fields are absent; the parallel collector amendment is needed to populate them.
- Exact visual parity is unfinished: some spacing, tile badges/number formatting, attention-row metadata, administrative controls, and content density differ. Adoption also retains its contract-derived funnel/cohort presentation. The gallery exposes these differences; they are not all approved deviations.
- The Chromium measurement over the full animation window remains above the required 100 ms. The final trace measured 136.069 ms. No threshold was relaxed, motion disabled, or passing result claimed. Further rendering/style work and a repeatable quiet benchmark are needed.

## Verification

Commands were run in this worktree, with Bun/Cargo on PATH. Selected final output is included below. Final web tests followed the UI refinements; the integrated harness preceded those final presentation-only refinements, so the real-backend browser suite was rerun against the final embedded build.

```sh
cd web && bun run check
```
```text
$ bun run build:ui && bun --bun tsc --noEmit && bun --bun eslint .
$ bun --bun tsc -p packages/ui/tsconfig.build.json && bun scripts/copy-ui.mjs
```

```sh
cd web && bun run build
```
```text
dist/assets/urbanist-latin-ext-wght-normal-Bdxck5Au.woff2          16.60 kB
dist/assets/urbanist-latin-wght-normal-D69JTELx.woff2              27.75 kB
dist/assets/index-CsDbzMu9.css                                     65.93 kB │ gzip:  13.17 kB
dist/assets/index-D1tOBpZj.js                                     338.70 kB │ gzip: 103.57 kB

✓ built in 315ms
```

```sh
cd web && SIGNALS_NEXT_PORT=23332 PLAYWRIGHT_CHANNEL=chromium bun run test:next
```
```text
▲ Next.js 16.3.8
- Local:         http://127.0.0.1:23332
- Network:       http://127.0.0.1:23332
✓ Ready in 63ms
✓ Running next.config.mjs took 8ms
Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.
```

```sh
cd web && PLAYWRIGHT_CHANNEL=chromium SIGNALS_TEST_UI_PORT=23334 SIGNALS_R2_PORT=23335 bun run test
```
```text
review-r2 probe passed

  VITE v8.3.2  ready in 94 ms

  ➜  Local:   http://127.0.0.1:23334/
Visual QA passed: v3 chart SVG/table twins and both drawer captures; 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
```

```sh
cargo build --locked --bin signals
```
```text
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.18s
```

```sh
cd web && SIGNALS_URL=http://127.0.0.1:25472 PLAYWRIGHT_CHANNEL=chromium TMPDIR=/home/vuk/orca/workspaces/signals-collector/dash-v2/t bun run qa:backend
```
```text
$ bun scripts/backend-qa.mjs
Login style QA passed: theme tokens, loaded fonts, card/button/form styles, light/dark and 320/390/1440px.
Backend browser QA passed: real v3 analytics, complete catalogue/dead/hallucinated tool filtering, no-catalogue called names, empty/null states, batch/replay-derived tiles/tools/timeline/callers/cost, project switch, login, keys, Live, persisted settings, 400 message, CSRF, logout.
```

```sh
cd web && BASE_URL=http://127.0.0.1:23333 bun scripts/performance-qa.mjs
```
```text
       diff: "simple",
       code: "ERR_ASSERTION"

      at /home/vuk/orca/workspaces/signals-collector/dash-v2/web/scripts/performance-qa.mjs:33:2

Bun v1.4.2 (Linux x64)
```

Integrated run (exit 0): ports were checked with `ss -ltn`; Postgres was a dedicated `dash-v3-qa-pg` container running `postgres:18.6-bookworm` with `--shm-size=1g` and host port 25471. A local executable psql shim stripped DATABASE_URL and invoked `docker exec -i dash-v3-qa-pg psql -U postgres -d signals`. TMPDIR used a short on-disk path to fit Chromium's Unix socket limit.

```sh
PATH="$PWD/target/v3-bin:$HOME/.bun/bin:$HOME/.cargo/bin:$PATH" \
TMPDIR="$PWD/t" DATABASE_URL=postgres://postgres:signals@127.0.0.1:25471/signals \
ANALYTICS_PG_CONTAINER=dash-v3-qa-pg SIGNALS_URL=http://127.0.0.1:25472 \
ANALYTICS_REVIEW_URL=http://127.0.0.1:25473 ANALYTICS_REVIEW_PROBE_PORT=25474 \
SIGNALS_PROBE_LATENCY_BUDGET_MS=900 PLAYWRIGHT_CHANNEL=chromium \
python3 scripts/ci-conformance.py
```
```text
  }
]
subject_kind breakdown {'key': 1, 'network': 1, 'strong': 0} status 200
FINDINGS 0 MISMATCHES 0
```

The trace and measured result are committed at [tab-switch-trace.json](../web/artifacts/v3/tab-switch-trace.json) and [performance.json](../web/artifacts/v3/performance.json). Screenshot rerun verification and final cleanup are recorded below.

A later visual-only run against the Vite development server timed out while a simultaneous UI-package check rebuilt its watched files. The completed full suite above predates that isolated rerun. Final screenshot determinism is tested serially against the built demo served at port 23333, avoiding development-server reloads.

```sh
cd web
bun run check
# exit 0; build:ui, tsc --noEmit, eslint
BASE_URL=http://127.0.0.1:23333 PLAYWRIGHT_CHANNEL=chromium bun scripts/visual-qa.mjs
# run twice serially; compare SHA-256 for all 64 PNGs
```

Comparison HTML link validation found 92 image references and zero missing files. Temporary collector/Vite processes and the dedicated `dash-v3-qa-pg` container were stopped, the container removed, and `target/` deleted. The static screenshot server is retained only until the final rerun finishes.

Final static visual result (both serial runs exited 0):

```text
Visual QA passed: v3 chart SVG/table twins and both drawer captures; 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.
Changed []
```

All **64/64 screenshots were byte-identical** on the final rerun; [determinism.json](../web/artifacts/v3/determinism.json) records the result. Both themes, both widths, every screen and both drawers are committed. The static screenshot server was then stopped and the on-disk temporary directory removed.

Implementation commits: `988d5d7` and `38a595d` after the main merge and inherited-artifact preservation. Remaining acceptance work is the sub-100 ms performance target and the exact design differences listed above; this dispatch reports **failed**, despite the passing functional and integrated suites.
