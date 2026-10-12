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

## Tile details 2026-10-12

9. A tile without a per-bucket series no longer stays empty. `TilesV3` accepts a
   `detail` node rendered under the meta line and bottom-aligned like a sparkline.
   Tools uses four detail kinds: a dot strip (one dot per catalogue tool, teal when
   called, hollow when never called), a mini ranked list (top retried tools; tools
   under their SLO with their success bar), a chip list (dead or hallucinated names,
   "+N more" after the cap), and a note with a check mark for the healthy empty
   state. The Used tile draws a derived sparkline: distinct tools called per bucket,
   computed from `tools[].trend`. Null stays null ("Waiting for …"); a healthy zero
   says what was checked.
