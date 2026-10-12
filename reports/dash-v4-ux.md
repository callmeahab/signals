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

## Verification

(filled in below from the runs)
