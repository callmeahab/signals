# Dashboard design notes

## Layout amendment 2026-10-12

1. All screen tile rows use three columns at ≥1024px, two on tablet, and one at
   ≤560px. Tile sparklines use a 108px SVG (98px plot range) across the tile width.
   Tiles have a shared 240px minimum height. Existing tokens, headline values,
   chips, null captions and motion timings remain.
2. Overview calls, client mix and attention each occupy a full row. The bounded
   activation funnel and weekly retention share the next row. Client mix places
   its donut to the left and legend in three columns at ≥1280px, two at ≥1024px,
   and a stacked layout on phones. Name plus version identifies each legend row.
3. Tool health, performance and paths each occupy a full row. Latency pairs with
   Catalogue; Catalogue keeps its fixed five-metric summary and confines the
   variable never-called chips to a 96px scroll well, so it cannot grow unbounded.
4. Cost pairs its fixed-height treemap with payload sizes. Tenant share and billing
   periods each occupy their own full row.
5. Adoption's Clients table remains full-width. Transport/protocol ranked lists
   now occupy a full row because protocol revisions are unbounded; Conversion
   occupies a separate row. Active identities and bounded identity quality stay paired.
6. Reliability audit: SLO classes are bounded, error/auth grouped charts have fixed
   SVG heights, availability already spans a full row. No entity list shares a row
   with a fixed chart. After the Round 1 correction, Sessions' replay, per-session
   table (The story of a connection), and Sessions by client donut each occupy
   their own full-width row. Callers' table and Live's event stream already stand
   alone. Live Event mix
   stays paired as its event-type set is bounded.
7. Protocol's capability lists already span a full row; its other cards contain
   bounded metric sets. Settings' per-tool SLO overrides now span a full row, with
   alert rules in their own row above them.
8. Client share is tool-call share, rounded to one decimal. Donut geometry reads raw
   calls, with no zero-call arcs. The 27-client demo exercises uneven call shares,
   equal session counts, repeated names across versions and a zero-call client.
   Existing null percentages stay unavailable when the call denominator is zero.

## Compact tiles 2026-10-12

9. Only Overview and Adoption keep the large three-by-two tile grid with 108 px
   sparklines: those are the screens whose tiles carry a trend series. Tools,
   Reliability, Sessions, Cost and Protocol render their six tiles compact in one
   row (six columns at ≥1024 px, three on tablet, two on phones) with a 38 px
   sparkline when a tile has one and no trend area otherwise.
10. Tools shows "Top tool paths" directly under the tiles, then Tool health, the
    latency and catalogue pair, and the performance table.
11. Tool names use the mono face everywhere (`.tool-name`): ribbons, tables, chips,
    chart labels and the tool drawer title.

## Icons 2026-10-12

12. Icons are Lordicon "Wired Outline" Lottie files chosen by the user under the
    project's Lordicon PRO subscription, kept in `src/icons/lordicon/*.json` and
    rendered by `<lord-icon>` through the `Icon` component (`src/icons/index.tsx`).
    The element and each icon load lazily; icon data is handed to elements six per
    animation frame so a table of pills never costs one long task. Ink follows the
    text colour (see note 13 for how), the secondary colour is the gold `--chart-1`,
    stroke `light`. Nav tabs, the theme and sign-out buttons, search, pause/play,
    chevrons, keys, add, delete, saved/copied checks, the empty state and every
    status pill use the set; the few controls with no icon in the set (close, menu,
    copy, arrows, terminal, user) are static inline glyphs with the same stroke.
    Hover triggers follow the whole control (`target`). Under reduced motion or in
    visual QA no trigger is set, so icons rest on their first frame. The pulsing
    dot next to the Live tab and its ring keyframes are gone; the Live tab carries
    the broadcast icon like every other tab. lucide-react is removed.

## UX pass 2026-10-12 (v4)

13. **Icon ink.** The `<lord-icon>` element in this version keys its `currentColor`
    rules off a `current-color` *attribute*, not the class the component was
    setting, so the primary stroke kept the Lordicon default `#121331` and went
    invisible on the dark ground. The element's shadow palette rules read
    `--lord-icon-primary`, so both stylesheets now set it to `currentColor` beside
    the gold `--lord-icon-secondary`. Ink follows `color` everywhere -- nav,
    buttons, pills, project cards, empty states -- in both themes, and visual QA
    measures the rendered primary path against its element's computed colour on
    every screen, width and theme.

14. **Info popovers.** Every analytics card and tile that is not self-explanatory
    carries a small info button at the right of its title or label (16 px in cards,
    13 px in tiles, the Lordicon `info` icon, hover trigger on the button). It opens
    an anchored `role="dialog"` on the design notes' popover surface (`--popover`,
    `--shadow-pop`, 14 px, max 340 px wide) labelled by the card title; outside
    click, Esc or a second click closes it, focus moves in and back, `aria-expanded`
    tracks state and only one is open at a time. The panel lives in the top layer
    through the Popover API: a tile carries a transform and `contain: layout`, which
    would otherwise become the containing block for a fixed panel, and a popover
    opened inside the tool drawer has to paint above a modal dialog. Coordinates are
    clamped to the viewport, so nothing clips at 1440, 390 or 320. All of the copy
    lives in `src/copy/explanations.ts`, keyed `<screen>.tile.<slug>` and
    `<screen>.card.<slug>`, so it can be read and checked against `docs/analytics.md`
    in one place. Setup and the login page carry none; Settings' key and user panels
    keep their inline hints, its two analytics cards carry popovers.

15. **Project cards.** The workspace `<select>` is a row of cards: name, the badge's
    status line, and the selected one marked with the gold border, the `healthy`
    check and `aria-pressed`. Names wrap rather than clip. Cards wrap while they fit
    and stack at 390; past six projects the row scrolls horizontally with the same
    hint and focusable region the wide tables use. The selection is written to
    `localStorage['signals-project']` and to the hash query (`#tools?project=<id>`);
    on load the URL wins, then storage, then the first project, and a stored id that
    no longer exists falls back silently. Nav links stay plain `#screen`, so the
    project is written back by the route effect rather than duplicated into every
    anchor. In demo mode `#overview?projects=9` pads the workspace so the
    more-than-six path can be exercised without a backend.

16. **One stable shell.** The top bar, the workspace strip and the page heading paint
    from the last account this browser saw (`localStorage['signals-account']`) while
    the session is verified behind them; only a 401 or 403 signs the shell out, so a
    network blip leaves it in place, and the full-page "Connecting to Signals" screen
    is left for a browser with no cached account. A skeleton waits 200 ms before
    appearing and stays 400 ms once it has; content fades in once over 240 ms by
    opacity alone; a range or project change holds the previous screen at 70 % until
    the new data lands. While a screen has nothing to show -- the quiet window, or the
    skeleton -- the dashboard reserves 70vh, so the footer does not jump down when the
    first data arrives. `scripts/reload-series.mjs` records a 100 ms-step series of a
    hard reload into `web/artifacts/v4/reload/` and asserts the browser's own
    layout-shift measurement on an ordinary reload, where the webfont swap does not
    confound it.

17. **Chart readouts.** Keyboard inspection opens on `:focus-visible` or after a key
    press, never on a pointer click, and every chart's `headers`/`rows` carry a real
    x label, the series name and the value with its unit -- "Date: 10/06",
    "Tool calls: 3,731 calls", "p95: 640 ms", "Success: 99.1%". Tile sparklines take
    the series' own bucket timestamps and the tile's unit. The hidden table twins
    read the same headers and rows. Mouse users keep the stacked area's crosshair and
    get the same readout at the pointer, after 120 ms with no animation, on
    sparklines, bars, donut, funnel, treemap, sankey and the latency histogram: the
    renderers mark their geometry with `data-row` and the component clamps the
    readout inside the plot box. Two definitions were corrected here: tool paths
    count occurrences of a pair or triple, not sessions, and the grouped-bar x-axis
    title is the caller's, so Error codes and Authentication failures no longer claim
    to show "payload size".

18. **Live stats.** The active screen's analytics routes refresh every
    `POLL_INTERVAL_MS` (60 s), one burst for that screen alone, stopped while the tab
    is hidden and refreshed the moment it returns or the range or project changes.
    Settings is not polled: it is a form, and a refresh would fight the editor. A
    refresh re-animates nothing -- count-ups run on first paint and later tween
    300 ms from the value on screen, charts redraw finished (`nt`), and the dim
    belongs to changes rather than polls. The workspace strip shows "updated 12 s
    ago", ticking, and pulses the collector dot when a refresh lands; both are
    written straight to the DOM through `src/activity.ts`, so the clock never costs a
    re-render of the screen. The badge shows the connection status until the first
    refresh lands, since each card already carries it. Polling is off under
    `__SIGNALS_VISUAL_QA__`.

19. **The Live event list** renders its first six rows with the screen and appends six
    per animation frame, with the row memoised. The longest-task gate measures the
    longest single task, so reducing work there can make the score worse by letting the
    remaining work merge into one task -- measured both ways; `reports/dash-v4-ux.md`
    carries the numbers. Each row's summary carries its event id, so a row is
    addressable without expanding it.
