# Review round 2: dashboard v3 layout

Reviewed `851b848bec05e03a42f0b8dcf6d77fe85b56a68f` on `vuk88/dash-v2` (commits since review `88ab3ca`). Fix brief `briefs/v3/fix-dash-v3-layout-r1.md`. Author section "Round 1 fix" in `reports/dash-v3-layout.md`.

VERDICT: approve

## Blockers

None.

## Should-fix

None.

## Verified claims

Rust is unchanged since `aa6f890`. `git diff --name-only aa6f890..HEAD -- crates Cargo.toml Cargo.lock .sqlx` printed nothing, so the Rust suites were not re-run.

The Sessions fix matches the brief. `SessionsScreen` now uses `Panel className="s12"` for "The story of a connection" and a default-span Card for "Sessions by client". Replay stays outside that grid. `DESIGN.md` item 6 describes those three full-width rows. `visual-qa.mjs` adds both titles and measures `.grid > .panel`, which matches both `section.panel` and `section.card.panel`.

| Claim | Result |
| --- | --- |
| `bun run --cwd web check` | Exit 0. `build:ui`, tsc, eslint. |
| `bun run --cwd web build` | Exit 0 in 198ms. CSS `index-Dp9XnY0Z.css` 70.27 kB, JS `index-BnNpwzmx.js` 346.53 kB. Same hashes the author reported for this script. |
| Production demo | `VITE_DEMO=1` Vite build to `/tmp/dash-layout-r2/demo` in 187ms. CSS `index-Dp9XnY0Z.css`, JS `index-DXqINaaj.js` 359.38 kB. Same hashes as the author's demo build. Served at `http://127.0.0.1:27690`. |
| Layout probe | Exit 0. `Layout probe passed: 8 viewports, contrast failures 0, clipped 0`. `failures` is `[]`. 80 contrast scans, 0 clipped. |
| Sessions rows | At 1280 and 1440, both themes, the table and the donut are each 1192px wide and full, tops 1123 and 1890, 12 body rows. At 768 and 390, both themes, each card is the grid width (720 and 358) and stacked. A separate measurement at 1440 put Session replay at width 1192, top 787, class `card panel rv s12 card--focal`. |
| Other entity rows | The only shared entity row is Live Event mix with the two fixed live cards (384/384/384). The brief allows that. No orphaned fixed card. Tiles stay 3×2 at 1280 and 1440, 2×3 at 768, and 1×6 at 390 on Overview, Adoption, Tools, Reliability, Sessions, Cost, and Protocol. |
| Motion probe | Exit 0. That asserts tile delays `[130, 185, 240, 295, 350, 405]`, duration 520, 60 histogram bars stepping by 12ms, a scrolled card delay of 640, and reduced motion `[]`. Printed count-up last change was 989ms. |
| Performance gate | 15 separate `BASE_URL=http://127.0.0.1:27690 PLAYWRIGHT_CHANNEL=chromium bun scripts/performance-qa.mjs` processes, all exit 0. Longest task 9.61–16.47ms (max 16.47), aggregate max 120.61ms. One `--walk` (30 steps) exit 0, longest task max 26.23ms, none ≥ 50. Timing artifacts restored. |
| Deterministic screenshots | Two serial `BASE_URL=http://127.0.0.1:27690 PLAYWRIGHT_CHANNEL=chromium bun scripts/visual-qa.mjs` runs, both exit 0. 116 PNGs byte-identical to each other and to the committed `web/artifacts/v3` tree. |
| `PLAYWRIGHT_CHANNEL=chromium bun run --cwd web test` | Exit 0 on `SIGNALS_TEST_UI_PORT=27840`. Includes client-share QA, `review-r1 probe passed`, `review-r2 probe passed`, and visual QA. The dev-server visual QA inside this suite rewrote 26 phone-width PNGs; those were restored. Production hashes above were unchanged. |
| `PLAYWRIGHT_CHANNEL=chromium bun run --cwd web test:next` | Exit 0 on `SIGNALS_NEXT_PORT=27841`. "Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles." |

Replay measurement:

```sh
# against the production preview, viewport 1440
# Session replay 1192 @ 787; The story of a connection 1192 @ 1123; Sessions by client 1192 @ 1890
```

## Probes committed

`reports/review-dash-v3-layout/layout.mjs` now measures light and dark at 768 as well as at 390, 1280, and 1440. Round 1 skipped 768 dark. `layout.json` is the passing 8-viewport capture from this run (`failures: []`). The motion probe was re-run and left unchanged.
