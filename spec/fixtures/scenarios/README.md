# SDK conformance scenarios

A scenario is the exact sequence of events an SDK must produce when a client
drives a fixed example server through a fixed sequence of MCP calls. Each SDK
repository ships an example server that matches the description below, a script
that runs the client steps against it with the mock collector recording, and a CI
job that runs:

```sh
signals-conformance serve --port 8787 --record recorded.ndjson &
SIGNALS_URL=http://127.0.0.1:8787 SIGNALS_KEY=sgk_test_0123456789abcdef node examples/basic/run-scenario.mjs
signals-conformance compare recorded.ndjson fixtures/scenarios/basic.json
```

Two scenarios ship: `basic` (stateful Streamable HTTP sessions) and
`basic-stateless` (fresh server per request, synthetic session). An SDK must pass
both.

`compare` exits 0 when the recording matches, and prints a per-event table plus
every mismatch otherwise.

## Scenario `basic`

**Transport.** Stateful Streamable HTTP: the server hands out a session id in
`initialize` and the client terminates the session with HTTP `DELETE` at the end.
Every event therefore carries the same real `session_id`.

**Settings.** The SDK runs with its defaults: `SIGNALS_SAMPLE_REQUESTS=1` (so
`tools/list` is reported), `SIGNALS_CAPTURE_ARGS=false` (so `args` is absent),
`SIGNALS_TRUST_PROXY=false`.

**Example server** `signals-conformance-example`:

| Primitive | Name | Behaviour |
|---|---|---|
| tool | `echo` | arguments `{ "message": string }`; returns one `text` content `echo: <message>` |
| tool | `fail` | no arguments; returns `isError: true` with one `text` content `boom` |
| tool | `slow` | arguments `{ "ms": integer }`; sleeps `ms` honouring cancellation, then returns one `text` content `done` |
| resource | `demo://hello` | `mimeType: text/plain`, text `hello` |

**Client steps.**

1. Open a session: `initialize` (any protocol version the server supports), then `notifications/initialized`.
2. `tools/list`.
3. `tools/call` `echo` with `{"message":"hello"}`. Success.
4. `tools/call` `fail` with `{}`. Result has `isError: true`.
5. `tools/call` `slow` with `{"ms":10000}`; within 500 ms send `notifications/cancelled` for that request id and do not wait for a response.
6. `resources/read` `demo://hello`.
7. Terminate the session (`DELETE` with the session id) and close the transport.
8. Let the SDK flush (process exit, or `flush()`).

**Expected events, in order** (`fixtures/scenarios/basic.json`):

| # | `type` | What is checked |
|---|---|---|
| 0 | `session.started` | `transport: streamable-http`; `derived`, if present, is `false` |
| 1 | `mcp.initialize` | `client.name` present; `requested_protocol_version` looks like a date; `server_capabilities` contains `tools` and `resources`; `duration_ms` and `is_error`, if present, are a duration and `false`; no `error_kind` |
| 2 | `tools.listed` | **optional** (contract 1.1.0): skipped when the SDK does not emit it. `source: list`, `count: 3`, three entries named `echo` / `fail` / `slow` in any order; `truncated`, `catalog_hash`, `duration_ms` and `is_error`, if present, are `false`, a hash of 1–64 characters, a duration and `false` |
| 3 | `mcp.request` | `method: tools/list`, `is_error: false`, no `error_kind`, no `error_code`; `request_id`, if present, is 1–64 characters |
| 4 | `tool.called` | `tool: echo`, success, `input_bytes` ≈ 19, `output_bytes` ≈ 38, `output_kinds: ["text"]`, no `error_message`, no `error_kind`, no `error_code`, no `args`; `output_chars` 11, `output_items` 1, `input_schema_valid` `true` and `request_id` if present |
| 5 | `tool.called` | `tool: fail`, `is_error: true`, `error_message: boom`, `input_bytes` ≈ 2, `output_bytes` ≈ 31, no `error_code` (an `isError` result carries none); `error_kind` `tool`, `output_chars` 4, `output_items` 1 if present |
| 6 | `tool.called` | `tool: slow`, `cancelled: true`, `is_error: false`, `output_bytes` exactly 0, `output_kinds: []`, `duration_ms` ≤ 5000; `error_kind` `cancelled`, `output_chars` 0, `output_items` 0 if present |
| 7 | `resource.read` | `uri: demo://hello`, success, `output_bytes` ≈ 63, no `error_kind`; `output_chars` 5, `output_items` 1 if present |
| 8 | `session.ended` | `reason: client` |

Not expected, and a mismatch if present: an `mcp.request` for `initialize`,
`notifications/initialized` or `notifications/cancelled` (own type, and
notifications are never reported), a second `session.started`, or any `log` /
`error` event (the example server must not emit any during the scenario).

## Scenario `basic-stateless`

The same client steps against the **stateless** pattern (a fresh MCP server
instance per HTTP request, `sessionIdGenerator: undefined`, the pattern mcpramen's
generated servers use). There are no session callbacks, so the SDK synthesises one
session from `hash(caller key id or ip, user agent, client name)`:

- event 0 is `session.started` with `transport: synthetic`, emitted before the first
  request's events; its `derived`, if present, is `true` (contract 1.1.0: a
  synthesised session is the `synthetic` transport, and the two must agree);
- events 1–7 are identical to `basic` (same byte counts, same cancellation shape,
  the same optional `tools.listed` snapshot at position 2);
- event 8 is `session.ended` with `reason: shutdown`, emitted when the server process
  exits after the client disconnected (there is no `DELETE`; the client just closes
  the transport). The SDK flushes it within its 3 s exit budget. Its `ts` is the end
  of the session and its `duration_ms` is last activity minus start.
- the cancelled `slow` call may be emitted after `resource.read` (see "Ordering"
  below); its `ts` must still be the start of the call.

Every event carries the same synthesised `session_id` (`<session:1>` after
normalisation).

## Contract 1.1.0: one scenario for two SDK generations

Everything contract 1.1.0 added is optional, so an SDK that implements it and an
SDK that does not must both satisfy these scenarios. Rather than add a
`basic-v11` pair, the scenarios express the difference in place:

- The `tools.listed` snapshot is an expected event with `"optional": true`. An SDK
  that emits it is matched against the expectation; an SDK that does not is
  skipped, and `compare` prints `skipped (optional)` for that row.
- Every optional attribute is expressed as
  `{"$match":"ifPresent","then":<expected>}`: absent is conforming, present is
  held to the value above. An attribute that must **not** appear — an `error_kind`
  on a call that succeeded — stays a plain `{"$match":"absent"}`.
- `compare --require-optional`, or `"require_optional": true` in the scenario,
  makes every optional expectation mandatory. An SDK that has implemented 1.1.0
  should run its conformance job with the flag; the default is off.

Two things are worth stating plainly. First, the snapshot expectation is
**stricter than the wire contract on purpose**: `source`, `count` and `tools` are
all optional in `events.schema.json`, but an SDK that emits a catalogue snapshot
at all must say what triggered it and what the catalogue holds, so the scenario
requires those three. Second, the snapshot's `ts` must be the start of the
`tools/list` request handling — the same instant as the `mcp.request` for that
exchange — because that is what puts it at position 2 under the tie-break below,
which moves a snapshot only onto the `tools/list` request it describes.

## Byte counts

Byte counts are **payload-only**, never frame bytes, always the compact (no
whitespace) UTF-8 JSON serialisation:

- `input_bytes`: `params.arguments` (`0` when absent).
- `output_bytes`: `result.content` for tools, `result.contents` for resources,
  `result.messages` for prompts, or the `error` object for a JSON-RPC error
  response; `0` for a cancelled call that got no response.

Reference values in both scenarios:

```
echo   arguments {"message":"hello"}                                              19 bytes
       content   [{"type":"text","text":"echo: hello"}]                           38 bytes
fail   arguments {}                                                                2 bytes
       content   [{"type":"text","text":"boom"}]                                  31 bytes
slow   arguments {"ms":10000}                                                     12 bytes
read   contents  [{"uri":"demo://hello","mimeType":"text/plain","text":"hello"}]  63 bytes
```

`compare` accepts a nonzero byte count within ±10 % of the expected value, with a
floor of 16 bytes (`tolerances.bytes_percent`, `tolerances.bytes`). An expected `0`
is semantic (no payload was sent: a cancelled call, absent arguments) and matches
only an actual `0`.

## Cancellation

On `notifications/cancelled` for an in-flight `tools/call`, the SDK emits
`tool.called` immediately with `cancelled: true`, `is_error: false`,
`output_bytes: 0`, `output_kinds: []` and `duration_ms` measured to the
cancellation. Nothing further is emitted if the handler later returns.

## Ordering: `ts` order, not emission order

`compare` sorts the recorded events by `ts` (the start of the measured interval;
the end for `session.ended`), then applies the CONTRACT.md §6 tie-breaks (a
`session.started` that shares its `ts` with other events of its session sorts
before them; a `source: list` `tools.listed` that shares its `ts` with the
`mcp.request` of its session whose `method` is `tools/list` sorts immediately
before **that** request, because those two report the same exchange — nothing
else moves, so a `source: list_changed` snapshot and a `source: list` snapshot
with no `tools/list` request in its millisecond stay where they were recorded,
and no snapshot ever jumps ahead of an unrelated `ping` or tool call), then
keeps record order for any remaining tie, and only then
matches them against the scenario's `events`. **Emission order is not part of
conformance; `ts` order is.** In a stateless server a `notifications/cancelled`
POST may reach a different server instance than the in-flight call, so an SDK may
observe the cancellation only at HTTP teardown and emit the cancelled `tool.called`
after `resource.read` was already recorded; because its `ts` is the start of the
call, it still lands at position 5. This applies to both scenarios. This ordering
relies on §6: `session.started.ts` is no later than any event of that session
(and sorts first when equal, so an SDK may enqueue `session.started` and
`mcp.initialize` in either order within one millisecond) and, for synthetic
sessions, equals the start of the request that created the session. The 1.1.0
tie-break does the same job for the `tools/list` pair: the catalogue snapshot and
the `tools/list` request share a `ts`, so the SDK may enqueue them in either
order. It does only that: a snapshot whose `source` is `list_changed`, or one
with no `tools/list` request in its millisecond, is never moved (review round 1).

## Normalisation rules applied by `compare`

Applied to every recorded event (in `ts` order, `session.started` first on a tie
within its session) before matching:

| Field | Rule |
|---|---|
| `id` | must be a UUIDv7 and unique across the recording; then replaced by `<id>` |
| `ts` | must be the canonical SDK form `YYYY-MM-DDTHH:MM:SS.sssZ` (CONTRACT.md §3; `2026-10-01T12:00:00Z` or a `+02:00` offset is a mismatch); then replaced by `<ts>` |
| record `sent_at` | when present, must be the canonical SDK form `YYYY-MM-DDTHH:MM:SS.sssZ`; bare events are unaffected |
| record `dropped` | must be numeric `0`; omission defaults to `0`; bare events are unaffected |
| `source` | on every wrapped record, the whole object must satisfy `batch.schema.json` `$defs/source` (a blank, oversized or non-string `hostname` fails even though its value is ignored); then `sdk` is `node` or `python`, `sdk_version` and `server_version` are non-empty strings, and `server_name` is exactly `signals-conformance-example`; bare events cannot verify source |
| `session_id` | replaced by `<session:N>`, numbering sessions in order of first appearance; scenarios use the same tokens |
| `caller.ip`, `caller.ip_hash` | a recording must never contain a raw `caller.ip`: the collector stores `caller.ip_hash` (64 lower-case hex characters) when the SDK sent an `ip`. `ip_hash` is checked and removed before the closed wire schema is applied |
| `client`, `caller` | otherwise ignored unless the expected event mentions them |
| `duration_ms` | must be an integer ≥ 0; only compared when the expected event gives a value or matcher |
| `*_bytes` | must be an integer ≥ 0; a plain nonzero expected number matches within ±`tolerances.bytes_percent` (default 10 %) with a floor of `tolerances.bytes` (default 16); an expected `0` matches only `0` |
| `source.instance_id`, `source.hostname` | values never compared (shape is validated, see `source`) |
| byte caps | the stored event must be ≤ 16 KB serialised and `args` / `fields` / `props` within 2 / 4 / 8 KB, measured before any placeholder replaces a value; the 16 KB cap is applied to a lower bound on the wire event because the stored `caller.ip_hash` is longer than the wire `caller.ip` it replaced (see `conformance/README.md`) |
| other `attrs` keys | extra keys in the recording are allowed unless the scenario sets `strict_attrs: true` or `compare --strict-attrs`; every key the scenario lists must match. Every key outside the set `events.schema.json` defines for the event type is SDK-added and must be ≤ 1 KB serialised as a one-member JSON object (CONTRACT.md §4; round 6 S1): a larger extra fails with the key, its size and the event named, even though the collector preserved it |
| `tools.listed` consistency | `tools` is never longer than `count` (which is the advertised total and is never reduced by truncation), and a snapshot that kept fewer entries than `count` must carry `truncated: true` (CONTRACT.md §4; contract 1.1.0). JSON Schema cannot compare an array's length with a sibling number, so the mock accepts such an event and only `compare` names it |
| count-like attrs | `output_chars`, `output_items`, `count`, `poll_count`, `progress_events`, `first_progress_ms` and `max_tokens` must be integers ≥ 0 wherever they appear, including on an event type that does not define them |
| Unicode | no string value or object key anywhere in a wrapped record's `source` or in the event (including the otherwise ignored `client`, `caller` and `hostname`, and nested extra attrs) may contain a lone surrogate (invalid UTF-16): the SDK must have replaced it with U+FFFD before serialisation (CONTRACT.md §6 "Unicode repair"; round 6 S2). The recording is never repaired by `compare`; at most eight hits are reported per source or event |

Every recorded event is also validated against `events.schema.json`; a schema
failure is a mismatch.

## Matchers

Any value in a scenario may be replaced by a matcher object:

```
{"$match":"any"}                                   anything, including null
{"$match":"present"} / {"$match":"absent"}         key must / must not exist
{"$match":"string","pattern":"^x","minLength":1,"maxLength":10}
{"$match":"integer","min":0,"max":100}             {"$match":"number",...}
{"$match":"boolean"}
{"$match":"uuid"}                                  a UUIDv7
{"$match":"timestamp"}                             an RFC 3339 date-time (the normalisation above already requires the canonical form for `ts`)
{"$match":"approx","value":49,"tolerance":16}
{"$match":"oneOf","values":["a","b"]}
{"$match":"array","minItems":1,"maxItems":5,"contains":["text"],"items":{...}}
{"$match":"ifPresent","then":<expected>}           absent is fine; present must match `then`
```

Arrays without a matcher must have the same length and matching items in order.
Objects without a matcher must contain every expected key (extra keys allowed,
see `strict_attrs`). Primitives must be strictly equal.

An expected **event** may also carry two keys that describe the expectation
rather than the event: `note` (free text) and `optional` (see the 1.1.0 section
above). Neither is matched against the recording, and neither appears in the
sample `validate` builds from the expectation.

## Writing a new scenario

Copy `basic.json`, change `name`, `steps` and `events`, and run
`signals-conformance validate fixtures` which checks that every expected event,
with matchers replaced by sample values, is a valid event under the schema.
The same check applies to `source` against the batch schema, with a sample
`instance_id` supplied because that field is ignored during comparison.
