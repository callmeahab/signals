# Review: analytics read API v2, round 1

VERDICT: changes required. 1 blocker, 2 should-fix.

The collector under test was `vuk88/analytics-v2` at `1ea532d`, Postgres `signals-review-r1-pg` (`postgres:18.6-bookworm`, `127.0.0.1:25447`), and `target/release/signals` on `127.0.0.1:25448`. The synthetic set was 525 accepted events, 23 identities (13 strong, 6 key, 4 network), three clients, both SDK envelopes, and one NDJSON batch. Probe log: `/tmp/review-r1-probe.log` (`EXIT:0`). Follow-up reads used project `0d0980d5-8c50-417f-8b3f-8fbdefe0b5e5`.

## Blockers

### 1. `returned_day_7` is 0 when no identity is old enough

`GET /v1/projects/0d0980d5-8c50-417f-8b3f-8fbdefe0b5e5/analytics/overview?range=24h` returned 200:

```json
[{"count":4,"step":"connected"},{"count":4,"step":"listed_tools"},{"count":4,"step":"first_call"},{"count":4,"step":"five_calls"},{"count":0,"step":"returned_day_7"}]
```

`?range=7d` on the same route returned connected 11, five_calls 10, `returned_day_7` 0. Adoption for that default window returns the same counts with a drop-off:

```json
[{"count":11,"dropoff_pct":0.0,"step":"connected"},{"count":11,"dropoff_pct":0.0,"step":"listed_tools"},{"count":11,"dropoff_pct":0.0,"step":"first_call"},{"count":10,"dropoff_pct":9.1,"step":"five_calls"},{"count":0,"dropoff_pct":100.0,"step":"returned_day_7"}]
```

`?range=30d` returned `returned_day_7` 12, so the step is filled once someone first seen in the window is old enough. A half-open window of 7 days or less cannot contain an event 7 days after a first-seen that is itself inside the window. `crates/signals-store/src/analytics.rs` (`funnel`, the `p.3` flag and the following count array) always emits an integer.

Contract (`analytics-api.md`): "Numbers that cannot be computed yet (no data, or a field the SDKs do not send yet) are `null`, never 0", and "`returned_day_7` = any event 7 days after first seen, only for identities old enough". Expected: `null` when the eligible set is empty. Observed: `0`, and on the default 7d adoption funnel a 100.0 drop-off.

## Should-fix

### 1. D1 omits a finished anniversary day

`GET .../analytics/adoption?from=2026-10-07T12:02:27Z&to=2026-10-11T12:02:27Z` returned `"retention":{"daily":{"d1":100.0,"d7":null,"d30":null}}`.

`user-late-clock` (`identities.first_seen` `2026-10-09 18:00:00+00`) has events only on `2026-10-09` and `2026-10-11T08:30:00Z`. The UTC anniversary day is `2026-10-10`, which ended at `2026-10-11 00:00:00Z`, twelve hours before `range.to`. There is no event that day. Six `key-only-*` identities first seen `2026-10-08 01:00:00+00` are inside the code's cutoff and did return. Counting the finished miss gives 6/7 = 85.7. The API returns 100.0.

`adoption`'s retention closure keeps an identity only when `first + (offset + 1) days <= window.to` (`analytics.rs` around the `Duration::days(offset + 1)` filter). For this identity that cutoff is `2026-10-11 18:00:00Z`, after the window. Activity itself is matched on the anniversary date.

`docs/analytics.md`: "Daily retention counts activity on the exact UTC anniversary day, excluding identities too young to observe it." The anniversary timestamp (`first + 1 day` = `2026-10-10 18:00:00Z`) and the end of that calendar day had both passed. Expected D1 85.7. Observed 100.0.

### 2. Invalid settings return prose in `error`, with no stable code

Owner `PATCH /v1/projects/0d0980d5-8c50-417f-8b3f-8fbdefe0b5e5` with `{"slo_classes":{"get_product":"write"}}` returned 400:

```json
{"error":"slo_classes values must be read or mutate"}
```

`analytics_settings` stayed `token_divisor` 2 and `slo_classes.get_product` `mutate`. The same shape is what the probe recorded for that body during the run. `validate_settings` returns `Error::bad(...)` (`crates/signals-server/src/analytics.rs:266`), and `Error::into_response` writes `{"error": <message>}` (`crates/signals-server/src/lib.rs`).

Review check 6: invalid settings are 400 with `invalid_filter` or a documented code. `docs/analytics.md` documents `invalid_filter` for unknown query keys. The settings 400 description in OpenAPI is "Invalid settings" and does not name this string. Query validation on the same service does return `{"error":"invalid_filter",...}` (the probe's invalid `range`, `week`, and unknown keys produced no finding). Expected a stable code. Observed a sentence that varies per check.

## Verified claims

Coordinator re-ran fmt, clippy, unit tests, the ignored DB tests, sqlx check, xtask, the spec sweep, and dashboard backend QA; this review did not repeat that suite. What this review ran:

- Ingest diff against `85a73a2`: `handlers.rs` changes only `update_project` / `Settings`. `signals-core` `validate_batch` adds `tools.listed` by checking the envelope as `custom` with `attrs.name = tools.listed` and requiring `attrs` to be an object. Live batch on the wire project path: `rejection probe 202 ['unknown_type', 'schema']` (`tools.listed` with `future_optional` accepted; `sampling.created` and `caller.subject_kind` rejected).
- Rollup, from the probe log: `rollup idempotence ok`; `restart aggregates stable`; cursor `2026-10-11 11:51:29.089717+00 -> 2026-10-11 11:51:30.844511+00` (forward only); late hour `2026-10-01 00:00:00+00:00 62 -> 63`. Nothing was deleted.
- Route JSON for overview, adoption, tools, reliability, cost, protocol, and digest, across `24h|7d|30d|90d`, a 5h `from`/`to`, and filters `client`, `tool`, `caller`, `transport`. The independent engine matched except four adoption mismatches on `30d` and `90d`: an extra day and a null-name client. Those rows are the wire-acceptance `tools.listed` at `2026-09-21 11:49:40+00` with no `client`, which the engine did not include. The committed probe sends that batch to a separate project. Cost, protocol, reliability, tools, overview, and the shorter adoption windows matched, including retries, paths, tokens, funnel counts other than the null-vs-zero issue above, cohorts, and histogram percentiles (no percentile exceeded the 26% bound). Sub-6h overview latency method was `exact` on a 5h span. A 6h window did not use `exact`. Empty `2026-08-01`..`2026-08-02`: `success_rate` null, tokens null, calls 0, p95 null.
- Identity: dataset resolved strong 13, key 6, network 4, and subject-plus-`key_id` stayed strong. Direct insert of `subject_kind=header` plus `key_id`, and of `ip_hash` alone, returned `{"key":1,"network":1,"strong":0}`.
- SLO: after `PATCH` `get_product=mutate`, targets read 99.0 / mutate 97.5, and `token_divisor` 2, classes were `mutate mutate mutate read mutate` (`get_product` override, destructive `get_admin`, case-sensitive `Get_Thing`, `lookup_sku` read prefix, `book_flight` mutate). Cost tokens with divisor 2 matched. Read-key and viewer `PATCH` did not return a finding (both 403 in the probe). `client=Zed` changed `tools.used`. Tools with zero calls in that filtered set are listed dead (`list_orders`, `lookup_sku`, `search_products`, `set_status`, plus never-called names). That matches "advertised but never called in the window" on the filtered set. The latest snapshot is global: the August window reports `known: true`, `catalog_hash` `cat-review-1`, `updated_at` `2026-10-01T00:30:02Z`, and all 10 tools dead, which matches `docs/analytics.md` ("The latest event-time snapshot controls the advertised set").
- Alerts project `30d1e464-452e-43f8-95c3-71ae7c0a762d`: one `firing` row each for volume, latency, destructive, and burn at `2026-10-11 11:53:30.896597+00`. After `PUT`, volume became `ok` and the other four rules `disabled` at `11:55:30.852967+00`. The probe's error-rule failure was the one-minute sample ageing out before the next tick (`errors` stayed `no_data`, then the rule was disabled). Follow-up: re-enabled `errors` at threshold 5, kept fresh `tool.called` errors in the last minute, and set `analytics_alert_pending.since` to 20 minutes earlier with `evaluated_at` at arm time. The next tick wrote a single `firing` row at `2026-10-11 12:03:31.223975+00`. The following tick, with that minute empty, wrote `no_data` at `12:04:30.875592+00` and did not insert a second firing row.
- Prober: before `probe_url` was set the probe recorded no default probes and null availability. After the local MCP server on `127.0.0.1:25449`, `probes` has `2026-10-11 11:56:30.876124+00 ok latency_ms=2 advertised_tools=2`. Later rows fail because the mock was shut down. The success-path check did not file a finding (`healthy_tools` stayed null, `uptime_pct` 100, `advertised_tools` 2 on that first row).
- Performance on 100000 direct `tool.called` inserts (`perf facts 100000`), warmed max of 3: overview 185.69 ms, adoption 241.38, tools 138.56, reliability 139.72, cost 207.19, protocol 76.11, digest 237.24, alerts 0.95, timeline 10.04. All under 300 ms. `EXPLAIN` of the histogram `NOT EXISTS` against `events` is an index scan or index-only scan per partition, including when the probe pinned the watermark at `1970-01-01`. No `Seq Scan on events`.
- OpenAPI `GET /v1/openapi.json` contains `/v1/projects/{project}/analytics/{overview,adoption,tools,reliability,cost,protocol,digest,alerts}`, `/v1/projects/{project}/analytics/sessions/{session}/timeline`, and `PUT /v1/projects/{project}/alerts`, plus schemas `AnalyticsOverview`, `AnalyticsAdoption`, `AnalyticsTools`, `AnalyticsReliability`, `AnalyticsCost`, `AnalyticsProtocol`, `AnalyticsDigest`, `AnalyticsAlerts`, and `AnalyticsTimeline`. The probe's `{name}` path check was wrong; the document registers one path per route.
- Replay did not change `analytics_facts` counts. Timeline offset, identity kind, and `args_hash` produced no finding. Digest `week=` matched the engine, and `2026-W99` was `invalid_filter`.

## Probes committed

`reports/review-r1/probe.py`

The run above is the evidence. After that run the probe was adjusted so a later execution does not treat the wire-acceptance event as catalogue data, does not flag a global latest snapshot or filter-scoped dead tools, checks the concrete OpenAPI paths, and keeps the error-rule sample inside the last minute until a worker tick. Those adjustments were not a second full run.
