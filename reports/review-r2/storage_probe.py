#!/usr/bin/env python3
"""Review round 2, check 3: storage, read API, idempotency and the rollup worker.

Posts one event of every one of the ten spec types (built from the official
`spec/fixtures/valid` events, re-stamped to now and given a shared session), then:

1. read API: `GET /v1/projects/{id}/events` must return `source`, `client` and a
   64-hex `caller.ip_hash` for every type, and never the raw `caller.ip`;
2. idempotency: a replay of the identical batch, a replay whose `ts` string
   spells the same instant differently (`Z` vs `+00:00`), and a replay at a
   genuinely different instant;
3. the rollup worker over all ten types: once the hourly worker has advanced
   past these rows, `rollup_project_hourly`, `rollup_tool_hourly`, `rollup_caller_daily`
   and `sessions` are compared against a brute-force recomputation over
   `events`, and the read API's overview / tools / sessions / callers routes are
   checked against the same numbers.

    SIGNALS_API_KEY=... SIGNALS_READ_KEY=... \
    python3 reports/review-r2/storage_probe.py --url http://127.0.0.1:PORT \
        --project <uuid> --pg-container <name> [--pg-db signals] [--rollup-wait 90]

The collector must have a 30-day retention window. Timestamps are rewritten to
now, so `SIGNALS_CONFORMANCE_CLOCK` may be unset or `sent_at`. Exits non-zero on
the first failed expectation; every check prints PASS/FAIL with its numbers.
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TYPES = {
    "session.started": "session-started",
    "session.ended": "session-ended",
    "mcp.initialize": "mcp-initialize",
    "tool.called": "tool-called",
    "resource.read": "resource-read",
    "prompt.get": "prompt-get",
    "mcp.request": "mcp-request",
    "log": "log",
    "error": "error",
    "custom": "custom",
}
IP = "198.51.100.77"
HEX64 = re.compile(r"^[0-9a-f]{64}$")

failures = []


def check(name, ok, detail=None):
    print(("PASS " if ok else "FAIL ") + name + ("" if detail is None else f": {detail}"))
    if not ok:
        failures.append(name)
    return ok


def now_stamp(offset_ms=0):
    stamp = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(milliseconds=offset_ms)
    return stamp.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def fixture(name):
    return json.loads((ROOT / "spec" / "fixtures" / "valid" / f"{name}.json").read_text())


def request(url, key, path, data=None, content_type="application/json"):
    headers = {"Authorization": "Bearer " + key}
    if data is not None:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url.rstrip("/") + path, data=data, headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        payload = response.read()
    try:
        return response.status, json.loads(payload)
    except ValueError:
        return response.status, {"non_json": payload.decode(errors="replace")}


def psql(container, db, sql):
    out = subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-U", "signals", "-d", db,
         "-v", "ON_ERROR_STOP=1", "-At", "-F", "\x1f", "-c", sql],
        capture_output=True, check=False,
    )
    if out.returncode != 0:
        sys.stderr.write(out.stderr.decode())
        raise SystemExit(f"psql failed: {sql[:120]}")
    return [line.split("\x1f") for line in out.stdout.decode().splitlines() if line != ""]


def build_batch(now, suffix, session):
    """A ten-type batch; `suffix` and `session` keep each run independent."""
    base = fixture("custom")
    batch = {k: v for k, v in base.items() if k != "events"}
    batch["sent_at"] = now
    batch["source"] = dict(base["source"], server_name="review-r2-all-types")
    events = []
    for i, (kind, name) in enumerate(TYPES.items()):
        event = json.loads(json.dumps(fixture(name)["events"][0]))
        event["type"] = kind
        event["ts"] = now
        event["id"] = "018f4c2a-7c3e-7a11-8b2d-%s%04x" % (suffix, i)
        event["session_id"] = session
        event["client"] = {"name": "review-r2-client", "version": "9.9.9", "protocol_version": "2025-06-18"}
        event["caller"] = {"key_id": "k_review_r2", "subject": None, "ip": IP, "user_agent": "review-r2/1.0"}
        events.append(event)
    batch["events"] = events
    return batch


def post_batch(url, key, batch):
    body = json.dumps(batch, separators=(",", ":")).encode()
    return request(url, key, "/v1/events", body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--project", required=True)
    parser.add_argument("--pg-container", required=True)
    parser.add_argument("--pg-db", default="signals")
    parser.add_argument("--rollup-wait", type=int, default=180)
    parser.add_argument("--nonce", default=None, help="8 hex digits; defaults to the clock")
    args = parser.parse_args()
    nonce = args.nonce or "%08x" % (int(time.time()) & 0xFFFFFFFF)
    session = "s_review_r2_" + nonce
    key = os.environ["SIGNALS_API_KEY"]
    read_key = os.environ.get("SIGNALS_READ_KEY", key)
    pid = args.project
    db = (args.pg_container, args.pg_db)

    now = now_stamp()
    batch = build_batch(now, nonce, session)
    status, data = post_batch(args.url, key, batch)
    check("ten-type batch accepted", (status, data.get("accepted"), data.get("rejected")) == (202, 10, []),
          f"{status} {data}")

    # --- 1. read API --------------------------------------------------------
    since = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=10)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    status, page = request(args.url, read_key, f"/v1/projects/{pid}/events?since={since}")
    rows = page.get("items", page if isinstance(page, list) else [])
    check("read API events route answers 200", status == 200, status)
    mine = [r for r in rows if r.get("session_id") == session]
    seen = {r["type"] for r in mine}
    check("read API returns all ten spec types", seen == set(TYPES), sorted(seen))
    missing_source = [r["type"] for r in mine if not isinstance(r.get("source"), dict) or not r["source"].get("server_name")]
    check("read API returns source for every type", not missing_source, missing_source)
    bad_server = sorted({r["type"] for r in mine if (r.get("source") or {}).get("server_name") != "review-r2-all-types"})
    check("source.server_name is the batch's", not bad_server, bad_server)
    missing_client = [r["type"] for r in mine if (r.get("client") or {}).get("name") != "review-r2-client"]
    check("read API returns client for every type", not missing_client, missing_client)
    bad_hash = [r["type"] for r in mine if not HEX64.match(((r.get("caller") or {}).get("ip_hash") or ""))]
    check("read API returns a 64-hex caller.ip_hash for every type", not bad_hash, bad_hash)
    raw_ip = [r["type"] for r in mine if "ip" in (r.get("caller") or {})]
    check("read API never returns the raw caller.ip", not raw_ip, raw_ip)
    leaked = psql(*db, f"SELECT count(*) FROM events WHERE project_id='{pid}' AND events::text LIKE '%{IP}%'")
    check("raw caller.ip is absent from the events row", leaked[0][0] == "0", leaked[0][0])

    # --- 2. idempotency ----------------------------------------------------
    rows_sql = (
        f"SELECT count(*) FROM events WHERE project_id='{pid}' AND session_id='{session}'"
    )
    before = psql(*db, rows_sql)[0][0]
    check("ten rows stored", before == "10", before)
    status, data = post_batch(args.url, key, batch)
    after = psql(*db, rows_sql)[0][0]
    check("identical replay is accepted and not stored twice",
          (status, data.get("accepted"), after) == (202, 10, "10"), f"{status} {data} rows={after}")

    # same instant, different RFC 3339 spelling
    respelled = json.loads(json.dumps(batch))
    respelled["events"] = [respelled["events"][0]]
    respelled["events"][0]["ts"] = now.replace("Z", "+00:00")
    status, data = post_batch(args.url, key, respelled)
    one_id = respelled["events"][0]["id"]
    rows = psql(*db, f"SELECT count(*),count(DISTINCT ts) FROM events WHERE project_id='{pid}' AND id='{one_id}'")[0]
    check("replay with a respelled ts stays one row",
          (status, data.get("accepted"), rows) == (202, 1, ["1", "1"]), f"{status} {data} {rows}")

    # genuinely different instant, same id
    moved = json.loads(json.dumps(respelled))
    moved["events"][0]["ts"] = now_stamp(1000)
    status, data = post_batch(args.url, key, moved)
    rows = psql(*db, f"SELECT count(*) FROM events WHERE project_id='{pid}' AND id='{one_id}'")[0][0]
    check("a different instant for the same id stores a second row",
          (status, data.get("accepted"), rows) == (202, 1, "2"), f"{status} {data} rows={rows}")

    # --- 3. rollup worker over all ten types -------------------------------
    hour = psql(*db, f"SELECT to_char(date_trunc('hour',min(ts)),'YYYY-MM-DD HH24:MI:SS+00') FROM events WHERE project_id='{pid}' AND session_id='{session}'")[0][0]
    deadline = time.time() + args.rollup_wait
    expected = None
    actual = None
    while time.time() < deadline:
        expected = psql(*db, f"""
            SELECT count(*) FILTER(WHERE type NOT LIKE 'session.%'),
                   count(*) FILTER(WHERE type NOT LIKE 'session.%' AND is_error),
                   count(*) FILTER(WHERE type='tool.called')
              FROM events WHERE project_id='{pid}' AND ts>='{hour}' AND ts<'{hour}'::timestamptz+interval '1 hour'
               AND received_at <= (SELECT received_at_watermark FROM rollup_cursor WHERE name='hourly')
        """)[0]
        actual = psql(*db, f"SELECT requests,errors,tool_calls FROM rollup_project_hourly WHERE project_id='{pid}' AND hour='{hour}'")
        if actual and actual[0] == expected:
            break
        time.sleep(5)
    check("rollup_project_hourly matches a brute-force recount over all ten types",
          bool(actual) and actual[0] == expected, f"rollup={actual} events={expected}")

    tool_rollup = psql(*db, f"SELECT sum(calls)::text FROM rollup_tool_hourly WHERE project_id='{pid}' AND hour='{hour}'")
    tool_events = psql(*db, f"SELECT count(*)::text FROM events WHERE project_id='{pid}' AND type='tool.called' AND tool IS NOT NULL AND ts>='{hour}' AND ts<'{hour}'::timestamptz+interval '1 hour' AND received_at <= (SELECT received_at_watermark FROM rollup_cursor WHERE name='hourly')")
    check("rollup_tool_hourly counts only tool.called", tool_rollup[0] == tool_events[0],
          f"rollup={tool_rollup[0]} events={tool_events[0]}")

    deadline = time.time() + args.rollup_wait
    while time.time() < deadline:
        session_row = psql(*db, f"SELECT calls,errors,(ended_at IS NOT NULL)::text FROM sessions WHERE project_id='{pid}' AND session_id='{session}'")
        session_expected = psql(*db, f"SELECT count(*) FILTER(WHERE type NOT LIKE 'session.%'),count(*) FILTER(WHERE is_error) FROM events WHERE project_id='{pid}' AND session_id='{session}'")[0]
        if session_row and session_row[0][:2] == session_expected:
            break
        time.sleep(5)
    check("sessions row counts non-session events and sees session.ended",
          bool(session_row) and session_row[0][:2] == session_expected and session_row[0][2] == "true",
          f"sessions={session_row} events={session_expected}")

    caller = psql(*db, f"SELECT DISTINCT caller_id FROM events WHERE project_id='{pid}' AND session_id='{session}' AND caller_id IS NOT NULL")
    check("the probe events carry one caller_id", len(caller) == 1, caller)
    caller_id = caller[0][0]
    day = psql(*db, f"SELECT min(ts)::date::text FROM events WHERE project_id='{pid}' AND session_id='{session}'")[0][0]
    # The worker only owns rows up to its watermark, so recount the same slice.
    deadline = time.time() + args.rollup_wait
    while time.time() < deadline:
        caller_expected = psql(*db, f"""
            SELECT count(*) FILTER(WHERE type NOT LIKE 'session.%'),
                   count(*) FILTER(WHERE type NOT LIKE 'session.%' AND is_error)
              FROM events WHERE project_id='{pid}' AND caller_id={caller_id} AND ts::date='{day}'
               AND received_at <= (SELECT received_at_watermark FROM rollup_cursor WHERE name='hourly')
        """)[0]
        caller_rollup = psql(*db, f"SELECT calls::text,errors::text FROM rollup_caller_daily WHERE project_id='{pid}' AND caller_id={caller_id} AND day='{day}'")
        if caller_rollup and caller_rollup[0] == caller_expected:
            break
        time.sleep(5)
    check("rollup_caller_daily matches a brute-force recount up to the watermark",
          bool(caller_rollup) and caller_rollup[0] == caller_expected,
          f"rollup={caller_rollup} events={caller_expected} caller_id={caller_id} day={day}")

    # read API routes that are fed by the rollups
    status, overview = request(args.url, read_key, f"/v1/projects/{pid}/overview?range=24h")
    check("overview answers 200 with the rolled-up request count",
          status == 200 and overview.get("requests", 0) >= int(expected[0]), f"{status} {json.dumps(overview)[:300]}")
    status, tools = request(args.url, read_key, f"/v1/projects/{pid}/tools?range=24h")
    tool_names = sorted({t.get("tool") for t in (tools if isinstance(tools, list) else tools.get("items", []))})
    check("tools route lists the tool.called tool", status == 200 and tool_names, f"{status} {tool_names}")
    deadline = time.time() + 60
    while time.time() < deadline:
        status, sessions = request(args.url, read_key, f"/v1/projects/{pid}/sessions?range=24h")
        listed = [s for s in (sessions.get("items") if isinstance(sessions, dict) else sessions or []) if s.get("session_id") == session]
        if listed:
            break
        time.sleep(5)
    check("sessions route lists the probe session", status == 200 and listed, f"{status} {len(listed)}")
    status, callers = request(args.url, read_key, f"/v1/projects/{pid}/callers?range=24h")
    check("callers route answers 200", status == 200, status)
    status, per_session = request(args.url, read_key, f"/v1/projects/{pid}/sessions/{session}/events")
    kinds = {e["type"] for e in (per_session.get("items") if isinstance(per_session, dict) else per_session or [])}
    check("session events route returns all ten types", status == 200 and kinds == set(TYPES), f"{status} {sorted(kinds)}")

    print(f"{'FAILED' if failures else 'OK'}: {len(failures)} failed")
    for name in failures:
        print(" - " + name)
    return int(bool(failures))


if __name__ == "__main__":
    raise SystemExit(main())
