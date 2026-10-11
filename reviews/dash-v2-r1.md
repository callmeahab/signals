# Review: dashboard v2, round 1

VERDICT: changes required

Blockers: 2. Should-fix: 7.

Reviewed `main..HEAD` on `vuk88/dash-v2` (`25f6307`, `cb85d52`), `web/` only. No product source was edited. The failing probe is `web/test/review-r1/probe.mjs`.

## Blockers

### 1. Calls-by-client and adoption series are labelled daily, but only the 7-day range is daily

The overview subtitle is hardcoded to "Daily tool calls · UTC" and the adoption panel is "Daily, weekly and monthly active identities". The demo always emits seven points and sets `buckets` / `bucket` to `"day"`. Point spacing is the whole range divided by 7.

Command (from `web/`):

```sh
bun test/review-r1/probe.mjs
```

Observed (exit 1), among other failures:

```text
24h calls_by_client buckets=day gaps=3.43,3.43,3.43,3.43,3.43,3.43h (expected ~24h when buckets is day)
24h adoption bucket=day gaps=3.43,3.43,3.43,3.43,3.43,3.43h
30d calls_by_client buckets=day gaps=102.86,102.86,102.86,102.86,102.86,102.86h
30d adoption bucket=day gaps=102.86,...h
90d calls_by_client buckets=day gaps=308.57,308.57,308.57,308.57,308.57,308.57h
90d adoption bucket=day gaps=308.57,...h
```

7-day spacing is 24h and was not reported. In the demo UI at `http://127.0.0.1:23441/#overview` (Playwright, 1440px, light), clicking **90 days** left the subtitle `Daily tool calls · UTC` and the x labels were `07-14`, `08-21`, `09-29`.

Expected: a `day` bucket is one day, and the chart copy follows `calls_by_client.buckets` / `active.bucket`. The range control is part of the shell in `briefs/v2/dash-restyle.md`, and the read contract says counts are real measurements for the selected window, with `buckets` naming the step.

### 2. A null error budget is drawn as progress value 0

`ReliabilityScreen` renders `<progress value={s.error_budget_pct ?? 0}>`. Contract and author brief: null is "no data", never 0. The same render with a present handshake rate still appends the waiting sentence (that part is Should-fix 3).

Same probe, observed:

```text
null error_budget_pct rendered as <progress max="100" value="0" aria-label="read error budget">
```

Expected: no numeric zero when `error_budget_pct` is null. The default demo does not hit this path (read budget 39.4, mutate budget clamped to 0 because 96.6% is past a 98% target). The component does it for any null the API is required to send when a class has no calls.

## Should-fix

### 1. Ended sessions of 8.4s are shown as "1 min"

`SessionsScreen` uses `Math.max(1, Math.round(durationMs / 60000))`. Demo sessions 2 and 3 last 8400ms.

Probe:

```text
session demo-session-2 lasts 8400ms but the sessions screen formula shows 1 min
```

Playwright on `#sessions` (1440px) showed the third and fourth rows as `1 min` / `ENDED`. Expected: the duration matches the start and end timestamps (about 8 seconds), not a one-minute floor. `briefs/v2/dash-restyle.md` requires duration on the sessions list.

### 2. Two catalogued dead tools never appear in overview attention

Demo catalog dead list is `cancel_booking`, `refund`, `archive_order` (15 advertised = 12 used + 3 dead). Overview attention includes only `cancel_booking` as `dead`.

Probe:

```text
catalog dead tool refund missing from overview attention
catalog dead tool archive_order missing from overview attention
```

The tools screen does list all three. The contract says `dead` is an advertised tool never called in the window, and attention is sorted error, warn, dead. Expected: every `catalog.dead` name is an attention row when `catalog.known` is true.

### 3. Handshake "waiting for init outcomes" is not conditional

With `handshake.success_rate` 99.2 and `p95` 40, the probe rendered:

```text
handshake detail still says waiting for init outcomes when success_rate and p95 are present
```

The detail string is always `` `${attempts} attempts · p95 ${p95} · waiting for init outcomes` ``. Timeouts and hallucinated tools already switch the reason on null. Expected: the waiting reason appears only while the rate or p95 is null. The default demo is null, so the current screen happens to be right.

### 4. Required table columns are cut off at 1440px and 390px

Page `scrollWidth` equals the viewport on every screen in both themes (the author's visual QA checks that, and it passed). Inside `.table-scroll`, headers are clipped at the scrollport.

Playwright at 1440px light, `#tools`: scrollport `clientWidth` 1138, `scrollWidth` 1538. Header edges versus the port's right edge at 1289:

| Header | left | right | fully visible |
| --- | ---: | ---: | --- |
| Errors: tool / protocol / timeout / cancelled / unknown | 1054 | 1371 | no |
| Retries / corrected | 1371 | 1503 | no |
| Schema: input / output | 1503 | 1689 | no |

At 390px light and dark, the same measurement cut overview `p95` and retention `W2`–`W4`; adoption calls/share/capabilities and `W2`–`W4`; sessions from Started through Reason; callers from Sessions through Favourite tools. `briefs/v2/review-dash-v2-r1.md` check 7: no clipped text at 390 and 1440. The tools screen is required to show the error split, retries, and schema failures without leaving them past the edge of the desktop frame.

### 5. Krona avatars are weight 600, and eyebrows are 10px

Playwright computed styles on the demo app:

- `#sessions` `.client-avatar`: `font-family` `"Krona One", sans-serif`, `font-weight` `600`, `font-synthesis` `weight style small-caps`. The avatar sits inside `.row-button` (`font-weight: 600`). Krona is a single 400 face, so this synthesizes a bold. Check 3: no weight above 400 on Krona, and `font-synthesis: none` on those headings. `h1` and `.tile > strong` are weight 400; `h1` does set `font-synthesis: none`.
- `.eyebrow` (tile labels and the page kicker): IBM Plex Mono, weight 500, **10px** at both 1440 and 390. Check 3 asks for 10.5px mono uppercase. Status pills are 10.5px at 1440 and **10px** at 390 (the `max-width: 760px` override).

### 6. Theme color is a hard-coded gold that is not the bowl yellow

`web/apps/dashboard/index.html` has `<meta name="theme-color" content="#f1b12b" />`. Check 2: any colour literal in `web/` other than the bowl yellow is a should-fix. The bowl yellow `#FBC118` is the mark and the wordmark bowl, and it matches the mcpramen SVG. The copied wordmark file is byte-identical to `services/web/public/mcpramen-wordmark.svg` (including that file's `color="#141413"`); the shell inlines the mark with `currentColor` and does not use `#141413`.

### 7. The worktree was not clean, and screenshot bytes still differ from HEAD

On arrival, `git status --porcelain` listed 25 modified tracked PNGs (the 22 `web/artifacts/v2/*-1440-{light,dark}.png` files plus the three tracked setup language shots). `git diff --stat` showed binary size changes of tens to a few hundred bytes. After re-running the author's visual QA, 24 of those files were still modified. `git ls-files web/artifacts/v2` is 22 paths, so the desktop light/dark set is committed; the 390px shots are on disk and ignored by `artifacts/` in `.gitignore`. The author brief only requires desktop shots. Check 9 still asks for a clean status. These PNGs were not part of this review and were not committed.

## Verified claims

Author report commands, re-run from `web/` with `PATH=$HOME/.bun/bin:$PATH` and `BUN_INSTALL_CACHE_DIR=$PWD/artifacts/install-cache`. Final line of the combined run: `REVIEW_VERIFY_EXIT:0`.

| Claim | Result |
| --- | --- |
| `bun install --frozen-lockfile` | exit 0. `Checked 171 installs across 193 packages (no changes)` |
| `bun run check` | exit 0. `tsc -p packages/ui/tsconfig.build.json`, `tsc --noEmit`, `eslint .` produced no errors |
| `bun run build` | exit 0. `✓ built in 749ms`, `dist/assets/index-B8fNLMYM.js` 299.58 kB |
| `PLAYWRIGHT_CHANNEL=chromium bun run test` | exit 0. `Analytics QA passed: 8 routes × 4 ranges...` then `Visual QA passed: 11 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.` |
| `PLAYWRIGHT_CHANNEL=chromium bun run test:next` | exit 0. `Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.` |
| Palette matches mcpramen `globals.css` value for value | `:root` 35 tokens and `.dark` 34 tokens, no missing or differing declarations. `admin-viz.css` is an exact substring of `web/packages/ui/src/styles.css`, including `--viz-build/chat/prototype/ink/grid/track` and the forced-colors block. `--primary-ink`, `--ink-faint`, `--warn-foreground`, `--chart-1`..`--chart-5` are present |
| No flame/orange primary | Computed `--primary` is `oklch(0.800 0.155 80)` (light) and `oklch(0.845 0.152 82)` (dark), the gold source values. Active nav text is `--primary-ink`. The underline is a 2px `--primary` bar with a glow. `git grep -E 'Unbounded\|Manrope\|ff5a36' -- web` printed `no old brand fonts/accent` |
| Shell | Computed top bar 60px, wordmark 18px at 1440 (15px at 390), `#main` max-width 1180px, gutter 20px. Range thumb background is the card token. No sidebar and no "signals." wordmark in the loaded demo shell. Loaded screens do not show the lucide Activity brand tile |
| Demo routes | `demoAnalytics` returns overview, adoption, tools, reliability, cost, protocol, alerts, and digest. `demoTimeline` serves `sessions/{id}/timeline`. `saveAlerts` PUTs the five default rules (volume 3×, p95 2×, error rate 5% / 15 min, destructive unrecognised client, burn 6×). Settings shows SLO targets, per-tool class, digest toggle, recipient, and token divisor |
| Null copy on the default reliability screen | Handshake, timeouts, hallucinated tools, error codes, auth failures, and availability render "No data yet" plus a reason. Availability is `null` in the demo |
| Package export and Next host | `packages/ui/src/index.ts` `export *` from `analytics.tsx` (the v2 screens). `bun run test:next` renders the legacy seven-screen fixture, which has no `analytics` client, so its overview is still "A little pulse". The Vite demo with `VITE_DEMO=1` renders the eleven v2 screens |
| Reduced motion | With `reducedMotion: 'reduce'`, `.signal-dot` and the nav underline `animation-name` were `none`, and no element still had an animation |
| Setup mark contrast | A later `.setup-mark{color:var(--primary-ink)}` wins. Canvas contrast of that ink on the accent fill was 4.37:1 |
| Both themes, page scroll | For all 11 screens at 390 and 1440, light and dark, `documentElement.scrollWidth - innerWidth` was 0 |

Screens opened in demo mode: Overview, Adoption, Tools (drawer is what `visual-qa.mjs` opens; the run passed), Reliability, Sessions (timeline rows present in the author's QA), Callers, Cost, Protocol, Live, Setup, Settings. Overview 7-day tiles in the committed light screenshot follow the demo fields (tool calls, active users with new, sessions with calls/session, success with tools-below-SLO, p95 with p50/p99, context tokens with per-call and an ≈ note).

## Probes committed

`web/test/review-r1/probe.mjs`

```sh
cd web && bun test/review-r1/probe.mjs
```

Last line: `PROBE_EXIT:1`. It fails on blockers 1 and 2 and should-fixes 1, 2, and 3. Layout, type, and git checks were measured with Playwright and git, not this script.
