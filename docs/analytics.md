# Analytics read API v2

The `/v1/projects/{project}/analytics/` endpoints share project-scoped read-key and
session membership checks with the existing dashboard. Owner sessions (with origin
checking) may PATCH project settings and PUT `/v1/projects/{project}/alerts`.
The OpenAPI document at `/v1/openapi.json` describes the routes and response models.

Requests accept `range=24h|7d|30d|90d`, defaulting to seven days, or both RFC 3339
`from` and `to`. Windows are half-open, in UTC, and limited to 400 days. `range`
cannot be combined with explicit timestamps. The immediately preceding window has
the same duration. Optional `client`, `tool`, `caller`, and `transport` filters are
exact matches; unknown query keys and malformed ranges return `invalid_filter`.
Invalid project settings (`PATCH /v1/projects/{project}`) and alert rules
(`PUT /v1/projects/{project}/alerts`) return HTTP 400 with
`{"error":"invalid_settings","message":"human-readable reason"}`. Query validation
continues to use `invalid_filter`. Read-only `id`, `tenant_id`, and `slug` fields
are ignored when existing dashboard clients round-trip a project document.
Digest additionally accepts an ISO week (`week=2026-W41`). No matching events is a
valid response. Missing measurements, denominators, and future protocol fields
are null; a measured count of zero is zero.

## Definitions

- Identity precedence: OAuth subject (also a subject without `subject_kind`), then
  caller key, then hashed network address. Kind is part of identity uniqueness;
  equal strings in different kinds do not merge. Raw IPs never become identifiers.
  Spec v1.1 validates `subject_kind`; v1.0 events without it keep their existing
  precedence. Non-OAuth subjects do not become strong identities.
- Calls count only `tool.called`. Success excludes calls with `is_error=true`.
  Session depth counts tool calls; existing dashboard request counts retain their
  original meaning. Session first/last tool and error state come from ordered events.
- A retry is the next occurrence of the same tool in the same session within 30
  seconds of its preceding failed occurrence. The retry is self-corrected when it
  succeeds. Other tool calls may intervene. Events sort by timestamp then UUID.
- Paths are consecutive pairs and triples of calls in the same session. Daily
  storage retains the top 200, attributed to the last event's UTC day, including
  paths across midnight; the read API returns the top 20. Percentages use all
  observed pair/triple occurrences as their denominator.
- SLO class uses a project override, catalogue destructive/read-only annotations,
  then the documented `get_`, `list_`, `search_`, `find_`, `read_`, `fetch_`,
  `describe_`, `lookup_` prefixes. Default success targets are 99.5% read and 98%
  mutate. Burn is observed error fraction divided by the allowed error fraction.
- Estimated tokens use output characters when present, otherwise output bytes,
  divided by the project's positive `token_divisor` (default 4). Estimates are
  summed before rounding to integer tokens. Missing payload measurements stay null.
- The funnel counts new identities at each observed step. Day-seven return means
  an event at least seven days after first seen. The `returned_day_7` step includes
  `eligible`, the number of selected new identities whose first-seen timestamp plus
  seven days is strictly before the half-open window end. Its `count` and adoption
  `dropoff_pct` are null when eligible is zero; otherwise count includes only returns
  among eligible identities. Other steps omit `eligible`.
  Daily retention counts activity on the exact UTC anniversary day. Eligibility
  begins at midnight UTC after that day (`date(first_seen) + offset + 1`), including
  a window ending exactly at that midnight; it does not depend on first-seen clock time.
  Weekly cohorts start on Monday; unfinished weeks are null.
- Catalogue snapshots may be empty. The latest event-time snapshot controls the
  advertised set, while individual tool records preserve first/last seen metadata.
  `tools.listed` and the optional protocol events receive full v1.1 schema validation.
  Failed listings do not replace a successful snapshot. Truncation is retained on
  both tool records and snapshots; incomplete snapshots cannot classify absent
  tool names as hallucinations. The catalogue reflects the latest project snapshot.

## Storage and freshness

Migration 0004 adds identity and catalogue capture, analytics settings, extended
sessions, hourly/daily analytics rollups, alert transitions, and probes. Identity
and catalogue triggers execute only after successful event insertion, so replayed
events do not inflate identity counters. Existing data is backfilled during migration
and the first analytics worker run. Migration 0005 adds statement-level project
revisions used to invalidate process-local read snapshots across collector processes.

The minute worker uses the `analytics` rollup cursor with a transaction advisory
lock and the existing ingest barrier. It replaces dirty hour/day aggregates rather
than incrementing them. A late event dirties the affected session's buckets, so
retries and paths are recomputed with neighboring events. Cursor updates and writes
commit together. Running again without new events leaves aggregates unchanged.

Migration 0008 gives project totals an explicit scope flag, keeping legal empty
tool names distinct from totals. Hourly project and tool JSON aggregates include call/error counts, error kinds,
cancellation/timeout counts, payload sums, five payload buckets, output characters,
60 latency buckets, retries, corrections, and token estimates. Daily data includes
identity kinds, acquisition, client/version and protocol/transport mixes, sessions,
error sessions, and capabilities. Per-identity daily rows retain calls/errors/tokens.

Migration 0006 retains compact analytics facts for 400 days, independently of raw
payload retention. Each successfully inserted event contributes only its timestamp,
type, session/tool/client identifiers, identity metadata, and an allowlist of metric
attributes. Arguments, arbitrary custom properties, log fields, source and raw IPs
are excluded. This preserves exact filtered counts, funnels, cohorts, paths and
session metadata for 90-day windows and their previous periods after raw events
expire. Timeline argument hashes are computed from raw stored arguments while those
arguments remain available; they become null after raw payload deletion.

Analytics reads use project-revision-validated snapshots of these compact facts.
Up to 32 project snapshots are cached for at most 60 seconds. A revision lookup
detects new ingests, retention deletes and settings updates; this is not a substitute
for durable rollups or facts. The worker warms a snapshot while rebuilding a dirty
project. Large cold snapshots require a database scan and additional memory.

Unfiltered latency reads merge stored complete-hour histograms with fact-derived boundary
and dirty-hour histograms. Filtered reads build the same histogram from matching
retained metric facts. Windows shorter than six hours use exact nearest-rank percentiles.
The 60 log-spaced bucket lower bounds cover 1–600,000 milliseconds with adjacent
ratio about 1.253. Within that domain the rounding/bucket error is below 26%; values
outside it clamp to the endpoints. Empty histograms return null. Responses include
`method: histogram` or `method: exact`. Payload boundaries are 1024, 4096, 16384,
and 65536 bytes, with boundaries included in the larger bucket.

## Alerts, digest, and probing

The worker evaluates five configurable rules each minute: current-hour volume
against the preceding seven-day hourly average, current-hour p95 against the
preceding 24 hours, a one-minute error rate continuously above the threshold for
15 minutes, destructive calls by clients absent from the baseline, and error-budget
burn. A missing sample, a gap over 90 seconds between evaluations, disabling the
rule, or changing its settings resets the pending error breach. Only transitions
are inserted into `alerts_log`; missing evidence yields `no_data`. Digest computes weekly comparisons
on demand. When `digest.enabled` is true, delivery becomes due Monday at 07:00
in `digest.timezone` (IANA name, default `UTC`). A restarted worker catches up within
the same local week. Reporting uses the completed UTC ISO week, exactly as the
`digest?week=YYYY-Www` endpoint does; the timezone changes delivery time only.

Configure `digest.recipient` and `SIGNALS_SMTP_URL` / `SIGNALS_SMTP_FROM` for email,
and/or `digest.webhook_url` for a JSON POST. SMTP URLs support `smtp://` (including
local relays) and `smtps://`, credentials and STARTTLS as supported by lettre.
Emails contain plain-text and HTML alternatives, inline stone/gold styles and a
Krona One heading with Arial fallback. Webhooks include `type`, `project_id`, project
name and either the digest week/range/data or alert rule/state/changed_at/details.
Alert state transitions use the configured channels independently of digest.enabled.

The durable outbox deduplicates each digest week or alert transition per channel.
Failed channels retry after five minutes; successful channels are not repeated.
Multiple workers claim rows with database locks. Delivery is at-least-once: a crash
after a receiver accepts but before the database commit can repeat a notification.
Errors are logged without SMTP credentials, recipient addresses or webhook URLs.

Probing is disabled until both `probe_url` and `probe_key` are configured. The worker
performs initialize, initialized notification, and paginated tools/list over
streamable HTTP, accepting JSON or SSE responses and retaining the MCP session and
negotiated protocol headers. It bounds response size, total runtime and pagination,
disables redirects, and attempts session cleanup. Keys are omitted from settings
responses and errors. Availability is the fraction of successful probes in the
window; `healthy_tools` remains null because discovery does not execute tools.

## Regression checks

`cargo test --workspace` covers the UTC anniversary boundaries for D1/D7/D30,
including the review's `user-late-clock` miss (6 of 7 returns = 85.7%), and day-seven
funnel eligibility. The ignored `analytics` database test covers both route funnel
shapes and stable PATCH/PUT settings errors.

`scripts/ci-conformance.py` also builds the release collector and runs
`scripts/analytics-review-probe.py`, the independent round-one review dataset and
all-route checks updated for these contract corrections. The probe requires a
migrated isolated `DATABASE_URL`, starts/stops only its own collector, fails on any
finding or comparison mismatch, and writes evidence under `target/analytics-review/`.
Set `ANALYTICS_PG_CONTAINER` to use `docker exec psql` instead of host psql; defaults
are collector port 25448 and mock MCP port 25449, configurable with
`ANALYTICS_REVIEW_URL` and `ANALYTICS_REVIEW_PROBE_PORT`.

On hosts where `/tmp` is a crowded tmpfs, run browser QA with a short, disk-backed
`TMPDIR` to avoid Chromium renderer crashes. Keep the path short enough for Unix
sockets. With the database/toolchain environment above configured and Chromium
installed, the complete conformance command is:

```sh
PLAYWRIGHT_CHANNEL=chromium python3 - <<'PY'
import os, subprocess, tempfile
with tempfile.TemporaryDirectory(prefix="signals-qa-", dir="/var/tmp") as temporary:
    subprocess.run(["python3", "scripts/ci-conformance.py"],
                   env={**os.environ, "TMPDIR": temporary}, check=True)
PY
```

The temporary directory is removed automatically. The CI script also runs the
analytics probe; all findings or expected-value mismatches fail the command.

## Reading project settings

`GET /v1/projects/{project}` requires a dashboard session and membership in the
project's tenant; owners and viewers may read it. API keys alone do not authorize
this route. Missing or deleted projects return 404 and another tenant's project
returns 403 for an authenticated session.

GET, owner PATCH, and each project in `/v1/auth/me` return the same document:
project ID, tenant ID, slug, name, retention and rate limits, plus `slo_classes`,
`slo_targets`, `token_divisor`, `digest`, `alerts`, `probe_url` and `probe_key_set`.
The probe credential is never returned. `probe_key_set` is false before a key is
configured or after an owner clears it with `{"probe_key":null}`. It is a derived,
read-only field ignored by PATCH, so round-tripping the document preserves the key.
Authentication/login account responses use the same safe project serializer.

## Spec v1.1 metric coverage

Migration 0009 preserves request IDs, output item counts, derived-session markers,
progress, sampling, elicitation, task and discovery metadata in compact facts, alongside
error kinds/codes, output characters, schema validation flags, initialize timing/error,
and auth failure reasons. Raw event attrs retain all schema-valid fields. Hourly
rollups include measured error splits/timeouts and character-based token estimates;
daily rollups include the protocol summary. Missing measurements remain null.

Protocol sampling counts observed requests, p95 duration, rejection percentage among
requests reporting `rejected`, and counts by returned model. Elicitation percentages
use events with a reported action. Task `created` counts distinct session/task IDs
observed in the window (creation itself is not a distinct spec event); status counts
count observed transitions, including completed/failed/cancelled. Progress calls are
long at 1,000 ms or more; the percentage uses long calls reporting `progress_events`.
`protocol.discovery` adds request count, p95 and total measured discovery duration.
Explicit tools.listed and legacy tools/list requests both contribute observed events.
Unknown fields or no observed optional protocol events produce null measurements.

`cargo test -p signals-server --test v11 -- --ignored` checks the v1.1 fixture through
storage, retained facts, protocol/reliability metrics, and real local SMTP/webhook
receivers, including digest deduplication and alert transition delivery. Set an isolated
`TEST_DATABASE_URL` first. Scheduler unit tests cover both US DST transitions.
