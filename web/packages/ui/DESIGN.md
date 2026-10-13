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

20. **The tab-switch gate reads a sample, not a single switch.** `scripts/performance-qa.mjs`
    scores a transition by its longest main-thread task, which is the stall a reader
    feels, and holds every transition to 50 ms with one documented exception,
    `protocol → live` at 60 ms, for the pre-existing Live mount. In single mode
    (`PERFORMANCE_REPEATS=n` of one transition) the gate asserts the **median** and the
    **90th percentile** of the repeats under the budget. One run may go over its budget
    provided it stays under **70 ms**; it is printed as an outlier and recorded in the
    artifact. A second outlier fails, and so does any run at or above 70 ms. The walk
    keeps its per-row budgets and applies the same one-outlier rule across its 30 rows.
    This box is shared, and a sample of 15 switches put 14 at 32–42 ms and one at
    55.96 ms: the median and the p90 describe what the screen does, where the maximum
    describes what the machine was doing at the time.

21. **A chart's keyboard readout opens on keyboard intent, not on focus.** The figure is
    focusable, so a pointer click focuses it, and the readout must not open then. A
    document-level `keydown`/`pointerdown` pair in `src/charts/index.tsx` records which
    kind of input happened last; a `pointerdown` always lands before the focus it causes,
    so `onFocus` can read that flag rather than depend on the order events arrive in.
    `:focus-visible` is the fallback only while nothing has been typed or clicked yet,
    which is the programmatic focus a screen reader or a test arrives with. The hover
    readout is a separate element (`.chart-key-tooltip--pointer`) with its own 120 ms
    delay, so a check about clicking has to take the pointer off the plot first or it
    races that delay.

## Nav, load and drawers 2026-10-13 (v5)

22. **The tab group is centred on the bar, and the tabs are bigger.** The wordmark and
    the action group are both `flex:1 1 0` with a `max-content` floor, so the free space
    is split equally between them and the two side groups come out the same width --
    which is what puts the tab group's centre on the bar's centre rather than merely
    between the groups. Measured delta at 1920, 1680, 1600, 1440, 1366, 1280 and 1279 px:
    0.0 px. Neither side group may shrink past its own content, so once ten tabs no
    longer fit the tab row is the only thing that gives: it spans the whole gap between
    the groups, an equal gutter from each, and scrolls -- which happens below 1014 px and
    nowhere above it. The icon is 22 px and the tab is the bar's full 64 px at every
    width. Ten tabs cost 699.8 px before any padding at a 15 px label, so the bar sheds
    in a fixed order as it narrows: the app name beside the wordmark (below 1680 px), the
    wordmark's height, the bar's padding, the gap between groups, and last the tab's own
    padding (14 px → 12 px below 1680 px → 8 px below 1440 px). Below 1280 px not even a
    padless row of 15 px tabs fits beside a legible wordmark at 1024 px, so the label
    keeps its previous 13 px there and ten tabs still fit with nothing scrolling. The
    mobile menu keeps its stacked list, now hung off the 64 px bar.

23. **The whole page loads and animates at mount; nothing waits for scrolling.** A card's
    entrance and a chart's SVG were both keyed to an `IntersectionObserver`, so anything
    below the fold sat unbuilt and unanimated until the reader scrolled it into view --
    and then ran its entrance under the pointer, mid-read. Both observers are gone
    (`src/motion.ts`). Every chart is built at mount and the screen runs one choreography
    from the top: context/heading/range at 40/90/140 ms, tiles at 130 + i·55 ms, cards at
    300 + i·85 ms capped at 1.1 s, each chart's draw-in 180 ms behind the card or tile it
    belongs to, count-ups 640 ms. One run per navigation: nothing on scroll, nothing on
    resize, nothing on a poll refresh. The longest-task gate is kept by queuing chart SVG
    construction one card per animation frame in document order, which leaves the visual
    order exactly the document's -- the card is still invisible while its chart is built.
    A chart's entrance takes two forms and so two clocks: the parts a renderer builds are
    marked `on` some frames after the mount and carry `--cd`, what is left of their
    card's entrance at that moment; the boxes that are in the markup from the first
    render -- a tile's sparkline wrapper, the stacked area's and the donut's own box --
    carry `--draw-in`, the same instant measured from the mount. Reduced motion shows the
    finished page at once. `scripts/choreography-qa.mjs` asserts every timing: the
    entrances and draw-ins from the animations themselves, and the count-up by sampling
    each tile's headline on a frame loop -- it opens at zero, never goes backwards, starts
    with its own tile's entrance and is over inside the 640 ms ease, with the end of the
    ease pinned on the tile with the most steps, since a small headline ("3") stops
    changing before the ease ends. It records a 100 ms-step series into `artifacts/v5/`.

24. **The drawer header carries no divider.** Under the drawer's title a border-bottom
    read as a rule drawn across the top of the three tiles; nothing else in this design
    separates a title from its own content with a line. The header keeps its spacing and
    loses the border, in the tool drawer and the session drawer alike -- both share it.

25. **No dialog blurs the page behind it.** The drawer `::backdrop` is a plain
    translucent scrim, the hard ink at 28 % in light and at 40 % in dark, with no filter;
    `.dark` remaps `--ink-hard` to the gold accent it draws focal-card edges with, so the
    dark rule names the same hard ink the light theme resolves `--ink-hard` to rather
    than that accent. The top bar drops its own `backdrop-filter` and paints its
    background opaque while a dialog is open (`html:has(dialog[open])`), so the page
    behind a drawer stays sharp and nothing on it is filtered. That also removes the
    non-deterministic rasterisation the capture scripts used to mask: the drawer captures
    no longer mask the top bar.

26. **The count-up survives React's development double-invoke.** `Count` marked the first
    paint as spent before its timer, so under `StrictMode` -- which runs an effect, tears
    it down and runs it again before anything is painted -- the second run took the final
    value as its own starting point and landed on it with nothing to see. The production
    bundle climbed and the dev server did not, and the gate was not looking. `painted` and
    `shown` now move only once the climb's timer has fired, the cleanup puts them back
    when it has not, and `shown` tracks the number on screen rather than the one being
    climbed towards.

## Dashboard polish 2026-10-13 (v6)

27. Info controls sit in the upper-right corner of each card and tile, with 40 px
    targets and Lordicon artwork at 24 px in cards and 20 px in tiles. Titles reserve
    the corner so labels can wrap without colliding with the control.
28. Explanations have title, body, computation and optional action fields. Hover waits
    120 ms; click and keyboard focus make the panel sticky until Escape, outside click
    or a second click. The top-layer surface resets label typography to Urbanist,
    normal case and wrapping, adds a unit chip when supplied, and points to its trigger.
    Phones use a bottom sheet. Escape returns focus without reopening the panel.
29. Project cards show a dot and 14 px state icon. Existing client reads feed a local
    status observer: any active identity in the overview window means receiving events,
    an observed empty window is gold; an unread window is muted (Not checked yet), transport/auth/server failures are ember, and demo
    is muted. Validation and rate-limit responses do not imply an unreachable collector. No
    project-status request is added; unvisited projects cannot assert observed activity.
30. Theme, sign-out and mobile navigation controls use 22 px artwork and 40 px targets.
31. The workspace freshness badge and collector pulse are removed. The activity store
    still tracks successful loads for polling and the range/project dim; no clock text
    or pulse is rendered.
32. Queries retain painted content through refreshes and dependency changes. Once
    content has painted a query cannot show its initial skeleton again. Primary
    analytics and supporting reads run independently; overview cards can paint before
    client mix, whose frame holds a quiet shimmer until its data arrives. The screen
    fade belongs to navigation, while project/range changes retain the 70% dim.
    An initial-error retry cannot spend a second skeleton episode. Count-ups explicitly
    restore null text after cancelling their old frame, so an empty project cannot
    inherit a percentage from the previous project.
33. The HTML document paints the light/dark ground before external styles or JavaScript
    load. A blocking script reads stored theme safely and falls back to the media query;
    both html and body paint the ground, with color-scheme and theme-color metadata.
    The explicit light class overrides a dark OS preference. The body background also
    covers Safari's initial canvas and overscroll before the React bundle has painted;
    browser measurements here use Chromium.

34. Round 1: a failed dependency change clears the held answer; only a failed refresh
    of the same dependency version keeps it, dimmed and labelled. Supporting reads
    report failures inside every card or tile they feed, with an empty frame when
    no answer belongs to the current selection. The shell reserves the view height
    before its first answer so the footer stays outside the viewport during loading.
35. Hover-card chips have their own `infoUnit`, independent of trend/table formatting.
    Computation sections describe counts, windows or derivations; advice stays in the
    action or context fields. Pointer release, cancellation and blur clear focus suppression.
36. The browser suite checks actual Enter reopening after Escape and includes all three
    demo review probes; backend QA also runs the real collector project-state probe.
37. Round 2: supporting-query failures only replace the tile fragment that depends on
    that query. Overview and Cost headlines remain visible when their primary answer
    succeeded; supporting trends/captions receive the notice and a framed empty state.
38. Choreography QA always checks the scheduled entrance/count/chart delays and
    durations, count monotonicity and terminal text. Count step density requires
    20 average fps over the tween; an early zero requires a sample before 100 ms into
    the scheduled tween. Observed animation ordering requires every sampled frame
    interval in the mount window to sustain 20 fps, since a single stalled frame can
    separate the observed animation clocks. Both average and slowest-frame cadence
    are printed; skipped observations never skip the exact schedule assertions.
