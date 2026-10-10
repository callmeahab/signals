# Storage normalization

The ingest contract is signals-spec v1.0.15. Each event retains its complete `attrs`,
`source`, and `client` as queryable JSONB; `caller.ip` is replaced with a tenant-salted
HMAC-SHA256 `caller.ip_hash` before storage. The HTTP peer IP is an identity fallback
only when an SDK caller IP is absent. Raw caller IPs are never stored.

Known deviations from literal wire preservation:

- PostgreSQL stores `ts` as `timestamptz`, normalizing equivalent RFC 3339 strings to
  one instant (and microsecond precision). Idempotency uses `(project, ts, id)` with
  normalized timestamps, whereas the spec defines timestamp identity by its literal
  string. Canonical millisecond SDK timestamps are unaffected.
- PostgreSQL cannot store NUL in text/JSONB. NUL characters in strings and property
  names become U+FFFD after validation and size checks; this can collapse two keys
  that differ only by NUL versus U+FFFD.
- The indexed `duration_ms` projection saturates at `i32::MAX` for the existing
  rollup schema. The original duration integer is preserved in `attrs.duration_ms`.

`SIGNALS_CONFORMANCE_CLOCK=sent_at` opts into fixture-relative validation only.
It is never enabled by default; the production clock is UTC wall time. Database
`received_at` always records actual receipt time so retention/rollup workers retain
correct operational watermarks.
