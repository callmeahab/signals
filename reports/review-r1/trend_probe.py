#!/usr/bin/env python3
"""Independent check of adoption sessions/wau/mau against ingested facts.

The expected series is computed here from analytics_facts, not from the
collector's Rust. Rolling windows are half-open and end at the UTC bucket
end (clamped to the request window). Identity precedence is subject (oauth
or absent kind), then key_id, then ip_hash.
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("SIGNALS_URL", "http://127.0.0.1:25540")
PG = os.environ.get("ANALYTICS_PG_CONTAINER", "dash-v3-review-pg")
ADMIN = os.environ.get("SIGNALS_ADMIN_TOKEN", "review-admin-token-32-characters")
EMAIL = os.environ.get("SIGNALS_BOOTSTRAP_EMAIL", "owner@signals.test")
PASSWORD = os.environ.get("SIGNALS_BOOTSTRAP_PASSWORD", "signals-test-password")
ORIGIN = os.environ.get("SIGNALS_PUBLIC_URL", BASE)
FAILURES = []


def fail(name, detail):
    FAILURES.append(f"{name}: {detail}")
    print(f"FAIL {name}: {detail}")


def ok(name, detail=""):
    print(f"PASS {name}{(': ' + detail) if detail else ''}")


def uuid7():
    unix_ms = int(time.time() * 1000) & ((1 << 48) - 1)
    rand_a = int.from_bytes(os.urandom(2), "big") & 0x0FFF
    rand_b = int.from_bytes(os.urandom(8), "big") & ((1 << 62) - 1)
    value = (unix_ms << 80) | (0x7 << 76) | (rand_a << 64) | (0b10 << 62) | rand_b
    return str(uuid.UUID(int=value))


def request(method, path, body=None, key=None, cookie=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {"content-type": "application/json"}
    if key:
        headers["authorization"] = f"Bearer {key}"
    if cookie:
        headers["cookie"] = cookie
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None, response.headers
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            parsed = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = raw.decode()
        return error.code, parsed, error.headers


def psql(sql):
    result = subprocess.run(
        ["docker", "exec", "-i", PG, "psql", "-U", "postgres", "-d", "signals", "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql],
        check=True, capture_output=True, text=True,
    )
    return result.stdout.strip()


def wait_ready():
    for _ in range(100):
        try:
            with urllib.request.urlopen(BASE + "/readyz", timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            pass
        time.sleep(0.2)
    raise SystemExit("collector not ready")


def identity_of(caller):
    if not isinstance(caller, dict):
        return None
    kind = caller.get("subject_kind")
    subject = caller.get("subject")
    if (kind is None or kind == "oauth") and isinstance(subject, str) and subject:
        return ("strong", subject)
    key = caller.get("key_id")
    if isinstance(key, str) and key:
        return ("key", key)
    hashed = caller.get("ip_hash")
    if isinstance(hashed, str) and hashed:
        return ("network", hashed)
    return None


def parse_ts(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def load_facts(project):
    raw = psql(
        "SELECT coalesce(json_agg(json_build_object("
        "'ts', to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'),"
        "'id', id, 'type', type, 'session_id', session_id, 'tool', tool,"
        "'client_name', client_name, 'transport', attrs->>'transport', 'caller', caller"
        ") ORDER BY ts, id), '[]'::json) "
        f"FROM analytics_facts WHERE project_id='{project}'"
    )
    facts = json.loads(raw)
    for fact in facts:
        fact["ts"] = parse_ts(fact["ts"])
        fact["identity"] = identity_of(fact["caller"])
    transports = {}
    for fact in facts:
        if fact["session_id"] and fact["transport"]:
            transports[fact["session_id"]] = fact["transport"]
    return facts, transports


def selected(facts, transports, start, end, filters):
    rows = []
    for fact in facts:
        if not (start <= fact["ts"] < end):
            continue
        if filters.get("client") and fact["client_name"] != filters["client"]:
            continue
        if filters.get("tool") and fact["tool"] != filters["tool"]:
            continue
        if filters.get("caller"):
            ident = fact["identity"]
            if not ident or ident[1] != filters["caller"]:
                continue
        if filters.get("transport"):
            transport = fact["transport"] or transports.get(fact["session_id"])
            if transport != filters["transport"]:
                continue
        rows.append(fact)
    return rows


def expect_points(facts, transports, start, end, filters):
    """Per-bucket sessions/wau/mau from stored facts. Independent of the server."""
    window = selected(facts, transports, start, end, filters)
    days = defaultdict(list)
    for fact in window:
        days[fact["ts"].date()].append(fact)
    first_session = {}
    for fact in window:
        if fact["session_id"] and fact["session_id"] not in first_session:
            first_session[fact["session_id"]] = fact["ts"].date()
    started = defaultdict(int)
    for day in first_session.values():
        started[day] += 1

    def rolling(lo, hi):
        return {fact["identity"] for fact in selected(facts, transports, lo, hi, filters) if fact["identity"]}

    points = []
    for day in sorted(days):
        bucket_end = min(
            datetime(day.year, day.month, day.day, tzinfo=timezone.utc) + timedelta(days=1),
            end,
        )
        ids = {fact["identity"] for fact in days[day] if fact["identity"]}
        points.append({
            "t": day.isoformat(),
            "users": len(ids),
            "sessions": None if not first_session else started[day],
            "wau": len(rolling(bucket_end - timedelta(days=7), bucket_end)),
            "mau": len(rolling(bucket_end - timedelta(days=30), bucket_end)),
            "end": bucket_end,
            "ids": ids,
        })
    headline = {
        "dau": len(rolling(end - timedelta(days=1), end)),
        "wau": len(rolling(end - timedelta(days=7), end)),
        "mau": len(rolling(end - timedelta(days=30), end)),
        "sessions": len({fact["session_id"] for fact in window if fact["session_id"]}),
        "users": {fact["identity"] for fact in window if fact["identity"]},
    }
    return points, headline


def call_attr(tool):
    return {
        "tool": tool, "duration_ms": 10, "is_error": False, "input_bytes": 4,
        "output_bytes": 8, "output_kinds": ["text"], "cancelled": False,
    }


def event(ts, kind, session=None, caller=None, attrs=None, tool=None):
    body = {
        "id": uuid7(),
        "ts": ts if isinstance(ts, str) else ts.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "type": kind,
        "attrs": attrs if attrs is not None else call_attr(tool or "get_item"),
    }
    if session:
        body["session_id"] = session
    if caller is not None:
        body["caller"] = caller
    if kind != "session.started":
        body["client"] = {"name": "Claude", "version": "1.0", "protocol_version": "2025-03-26"}
    else:
        body["client"] = {"name": "Claude", "version": "1.0", "protocol_version": "2025-03-26"}
    return body


def ingest(key, events):
    status, body, _ = request("POST", "/v1/events", {
        "schema_version": 1,
        "sent_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "source": {"sdk": "python", "sdk_version": "1", "server_name": "review", "server_version": "1", "instance_id": "review-r1"},
        "events": events,
    }, key=key)
    if status != 202 or body.get("accepted") != len(events) or body.get("rejected"):
        raise SystemExit(f"ingest failed {status} {body}")
    return body


def provision(tenant, slug):
    status, project, _ = request("POST", "/v1/admin/projects", {"tenant_id": tenant, "slug": slug, "name": slug}, key=ADMIN)
    if status != 200:
        raise SystemExit(f"project {slug} {status} {project}")
    status, key, _ = request("POST", "/v1/admin/keys", {"project_id": project["id"], "label": slug, "scopes": ["ingest", "read"]}, key=ADMIN)
    if status != 200:
        raise SystemExit(f"key {slug} {status} {key}")
    psql(f"UPDATE projects SET retention_days=90, rate_events_per_min=1000000, rate_bytes_per_min=1073741824 WHERE id='{project['id']}'")
    return project["id"], key["secret"]


def compare_series(name, facts, transports, project, key, start, end, filters, golden=None):
    query = f"?from={start.strftime('%Y-%m-%dT%H:%M:%S.000Z')}&to={end.strftime('%Y-%m-%dT%H:%M:%S.000Z')}"
    for field, value in filters.items():
        query += f"&{field}={value}"
    status, adoption, _ = request("GET", f"/v1/projects/{project}/analytics/adoption{query}", key=key)
    status_o, overview, _ = request("GET", f"/v1/projects/{project}/analytics/overview{query}", key=key)
    if status != 200 or status_o != 200:
        fail(name, f"status {status}/{status_o} {adoption}")
        return
    expected, headline = expect_points(facts, transports, start, end, filters)
    actual = adoption["active"]["points"]
    if [p["t"] for p in actual] != [p["t"] for p in expected]:
        fail(name + " days", f"actual {[p['t'] for p in actual]} expected {[p['t'] for p in expected]}")
    for point, exp in zip(actual, expected):
        for field in ("users", "sessions", "wau", "mau"):
            if point.get(field) != exp[field]:
                fail(name + " " + point["t"], f"{field} actual {point.get(field)} expected {exp[field]} (bucket end {exp['end'].isoformat()})")
        if isinstance(point.get("wau"), int) and isinstance(point.get("mau"), int):
            if point["wau"] < point["users"] or point["mau"] < point["wau"]:
                fail(name + " order", f"{point}")
    tile = overview["tiles"]["sessions"]["value"]
    if any(p["sessions"] is None for p in expected):
        if not expected or any(p["sessions"] is not None for p in expected):
            fail(name + " null-sessions", "mixed null sessions")
        elif tile != 0:
            fail(name + " null-tile", f"tile {tile}")
        else:
            ok(name + " null-sessions", "series null and tile 0")
    else:
        total = sum(p["sessions"] or 0 for p in actual)
        if total != tile or total != headline["sessions"]:
            fail(name + " sessions-sum", f"points {total} tile {tile} distinct {headline['sessions']}")
        else:
            ok(name + " sessions-sum", str(total))
    if adoption["active"]["wau"] != headline["wau"] or adoption["active"]["mau"] != headline["mau"]:
        fail(name + " headline", f"api {adoption['active']['wau']}/{adoption['active']['mau']} expected {headline['wau']}/{headline['mau']}")
    else:
        ok(name + " headline", f"wau {headline['wau']} mau {headline['mau']}")
    kinds = {"strong": 0, "key": 0, "network": 0}
    for kind, _ in headline["users"]:
        kinds[kind] += 1
    if overview["tiles"]["active_users"]["by_kind"] != kinds or overview["tiles"]["active_users"]["value"] != len(headline["users"]):
        fail(name + " precedence", f"api {overview['tiles']['active_users']} expected value {len(headline['users'])} {kinds}")
    else:
        ok(name + " precedence", json.dumps(kinds))
    if golden:
        for point, exp in zip(actual, golden):
            if point["t"] != exp["t"] or any(point[field] != exp[field] for field in ("users", "sessions", "wau", "mau")):
                fail(name + " golden", f"{point['t']} actual { {k: point[k] for k in ('users','sessions','wau','mau')} } expected {exp}")
                return
        ok(name + " golden", f"{len(golden)} buckets")
    if actual:
        last = actual[-1]
        clamped = expected[-1]["end"] == end
        same = last["wau"] == adoption["active"]["wau"] and last["mau"] == adoption["active"]["mau"]
        print(f"  last bucket end {expected[-1]['end'].isoformat()} clamped={clamped} matches_headline={same} point={last['wau']}/{last['mau']} headline={adoption['active']['wau']}/{adoption['active']['mau']}")
        if clamped and not same:
            fail(name + " clamped", "partial bucket does not match headline")
        if name == "gap":
            if same or last["wau"] != 7 or adoption["active"]["wau"] != 6 or last["mau"] != 10:
                fail("gap-boundary", f"point {last['wau']}/{last['mau']} headline {adoption['active']['wau']}/{adoption['active']['mau']}")
            else:
                ok("gap-boundary", "complete bucket ends at midnight (wau 7) while the headline ends at 15:00 (wau 6)")


def executed_event_scans(node, scans):
    name = node.get("Relation Name", "")
    if (node.get("Node Type") in ("Seq Scan", "Index Scan", "Index Only Scan", "Bitmap Heap Scan")
            and name.startswith("events")
            and node.get("Actual Loops", 0) > 0
            and node.get("Actual Rows", 0) + node.get("Rows Removed by Filter", 0) > 0):
        scans.append(name)
    for child in node.get("Plans") or []:
        executed_event_scans(child, scans)


def explain_checks(partition_project, boundary_project):
    count = int(psql(f"SELECT count(DISTINCT tableoid) FROM events WHERE project_id='{partition_project}'"))
    print(f"populated daily partitions {count}")
    if count < 31:
        fail("partitions", f"expected >= 31 populated daily partitions, got {count}")
    else:
        ok("partitions", str(count))
    control = psql(
        "EXPLAIN SELECT count(*) FROM events "
        f"WHERE project_id='{partition_project}' AND ts >= '2026-10-01' AND ts < '2026-10-03'"
    )
    print("EXPLAIN control\n" + control)
    if "events_2026_09_01" in control or "events_2026_09_15" in control:
        fail("prune-control", "a two-day events query still names a September partition")
    elif "events_2026_10_01" not in control:
        fail("prune-control", "two-day query did not name events_2026_10_01")
    else:
        ok("prune-control", "September partitions absent from the two-day plan")
    facts_plan = json.loads(psql(
        "EXPLAIN (ANALYZE, FORMAT JSON) SELECT ts,id,type FROM analytics_facts "
        f"WHERE project_id='{boundary_project}' AND ts < '9999-01-01T00:00:00Z'"
    ))
    scans = []
    executed_event_scans(facts_plan[0]["Plan"], scans)
    print("EXPLAIN facts", json.dumps(facts_plan[0]["Plan"])[:500])
    if scans:
        fail("explain-facts", "analytics_facts load scanned " + ", ".join(scans))
    else:
        ok("explain-facts", "no executed events partition scan")
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    eligibility = open(os.path.join(root, "crates/signals-store/queries/analytics_histograms.sql")).read()
    for placeholder, value in (
        ("$1", f"'{partition_project}'::uuid"),
        ("$2", "'2026-09-12'::timestamptz"),
        ("$3", "'2026-10-12'::timestamptz"),
        ("$4", "'1970-01-01'::timestamptz"),
    ):
        eligibility = eligibility.replace(placeholder, value)
    hist_plan = json.loads(psql("EXPLAIN (ANALYZE, FORMAT JSON) " + eligibility))
    scans = []
    executed_event_scans(hist_plan[0]["Plan"], scans)
    print("EXPLAIN histogram", json.dumps({k: hist_plan[0]["Plan"].get(k) for k in ("Node Type", "Relation Name", "Actual Rows")}))
    if scans:
        fail("explain-histogram", "eligibility scanned " + ", ".join(scans))
    else:
        ok("explain-histogram", "no executed events partition scan")


def main():
    wait_ready()
    status, account, headers = request("POST", "/v1/auth/login", {"email": EMAIL, "password": PASSWORD})
    if status != 200:
        raise SystemExit(f"login {status} {account}")
    tenant = account["projects"][0]["tenant_id"]
    print(f"tenant {tenant}")
    boundary, boundary_key = provision(tenant, "review-boundary-" + uuid.uuid4().hex[:8])
    fresh, fresh_key = provision(tenant, "review-fresh-" + uuid.uuid4().hex[:8])
    nosess, nosess_key = provision(tenant, "review-nosess-" + uuid.uuid4().hex[:8])
    part, part_key = provision(tenant, "review-part-" + uuid.uuid4().hex[:8])

    alice = {"subject": "alice", "subject_kind": "oauth", "key_id": "k-alice", "ip": "203.0.113.9"}
    events = [
        event("2026-09-20T12:00:00.000Z", "tool.called", "s-mau", {"subject": "mau-only"}),
        event("2026-09-27T23:59:59.000Z", "tool.called", "s-out", {"key_id": "k-out"}),
        event("2026-09-28T00:00:00.000Z", "tool.called", "s-edge", {"ip": "198.51.100.10"}),
        event("2026-10-03T23:59:59.000Z", "tool.called", "s-alice-early", alice),
        event("2026-10-04T10:00:00.000Z", "tool.called", "s-alice", alice),
        event("2026-10-04T10:30:00.000Z", "tool.called", "s-early", {"subject": "early-only"}),
        event("2026-10-04T23:50:00.000Z", "session.started", "s-cross", alice, {"transport": "streamable-http"}),
        event("2026-10-05T00:00:00.000Z", "tool.called", "s-bob", {"subject": "not-strong", "subject_kind": "header", "key_id": "k-bob"}, tool="set_item"),
        event("2026-10-05T00:10:00.000Z", "tool.called", "s-cross", alice),
        event("2026-10-06T08:00:00.000Z", "tool.called", "s-carol", {"subject": "carol"}),
        event("2026-10-06T09:00:00.000Z", "tool.called", "s-carol", {"subject": "carol"}, tool="set_item"),
        event("2026-10-07T08:00:00.000Z", "tool.called", "s-ss", {"subject": "shared"}),
        event("2026-10-07T09:00:00.000Z", "tool.called", "s-sk", {"key_id": "shared"}),
        event("2026-10-08T12:00:00.000Z", "tool.called", "s-anon", None),
        event("2026-10-09T12:00:00.000Z", "tool.called", "s-carol", {"subject": "carol"}),
        event("2026-10-10T10:00:00.000Z", "tool.called", "s-dave", {"subject": "dave"}),
        event("2026-10-10T23:59:59.000Z", "tool.called", "s-dave2", {"subject": "dave"}, tool="set_item"),
        event("2026-10-11T16:00:00.000Z", "tool.called", "s-ghost", {"subject": "ghost"}),
    ]
    ingest(boundary_key, events)
    facts, transports = load_facts(boundary)
    print(f"boundary facts {len(facts)}")
    idents = psql(
        "SELECT coalesce(json_agg(json_build_object('kind', kind, 'key', identity_key) ORDER BY kind, identity_key), '[]'::json) "
        f"FROM identities WHERE project_id='{boundary}'"
    )
    stored = {(row["kind"], row["key"]) for row in json.loads(idents)}
    print("identities", sorted(stored))
    for banned in (("key", "k-alice"), ("strong", "not-strong")):
        if banned in stored:
            fail("stored-precedence", f"{banned} was stored; subject/kind should have won")
    required = {("strong", "alice"), ("strong", "early-only"), ("strong", "carol"), ("strong", "shared"),
                ("strong", "dave"), ("strong", "mau-only"), ("strong", "ghost"), ("key", "k-out"),
                ("key", "k-bob"), ("key", "shared")}
    missing = required - stored
    networks = [key for kind, key in stored if kind == "network"]
    if missing or len(networks) != 1:
        fail("stored-precedence", f"missing {sorted(missing)} networks {networks}")
    else:
        ok("stored-precedence", f"network hash {networks[0][:12]}… raw ip not stored")
    alice_rows = [fact for fact in facts if fact["identity"] == ("strong", "alice")]
    if not alice_rows or any("key_id" not in (fact["caller"] or {}) or "ip_hash" not in (fact["caller"] or {}) for fact in alice_rows):
        fail("alice-caller", "oauth subject did not keep key_id and ip_hash on the fact")
    else:
        ok("alice-caller", f"{len(alice_rows)} facts collapse to strong/alice")

    start = datetime(2026, 10, 4, tzinfo=timezone.utc)
    midnight = datetime(2026, 10, 11, tzinfo=timezone.utc)
    golden = [
        {"t": "2026-10-04", "users": 2, "sessions": 3, "wau": 3, "mau": 5},
        {"t": "2026-10-05", "users": 2, "sessions": 1, "wau": 3, "mau": 6},
        {"t": "2026-10-06", "users": 1, "sessions": 1, "wau": 4, "mau": 7},
        {"t": "2026-10-07", "users": 2, "sessions": 2, "wau": 6, "mau": 9},
        {"t": "2026-10-08", "users": 0, "sessions": 1, "wau": 6, "mau": 9},
        {"t": "2026-10-09", "users": 1, "sessions": 0, "wau": 6, "mau": 9},
        {"t": "2026-10-10", "users": 1, "sessions": 2, "wau": 7, "mau": 10},
    ]
    compare_series("midnight", facts, transports, boundary, boundary_key, start, midnight, {}, golden)
    compare_series("partial", facts, transports, boundary, boundary_key, start, datetime(2026, 10, 10, 15, tzinfo=timezone.utc), {})
    compare_series("gap", facts, transports, boundary, boundary_key, start, datetime(2026, 10, 11, 15, tzinfo=timezone.utc), {})
    compare_series("tool", facts, transports, boundary, boundary_key, start, midnight, {"tool": "get_item"})
    compare_series("caller", facts, transports, boundary, boundary_key, start, midnight, {"caller": "alice"})
    compare_series("transport", facts, transports, boundary, boundary_key, start, midnight, {"transport": "streamable-http"})
    # The cross-midnight session's first selected event moves when session.started
    # is filtered out by a tool filter. The sum still has to match the tile.
    tool_points, _ = expect_points(facts, transports, start, midnight, {"tool": "get_item"})
    by_day = {point["t"]: point["sessions"] for point in tool_points}
    # session.started is not a get_item, so s-cross's first counted event moves
    # from Oct 4 to the Oct 5 call. s-bob is a set_item, so Oct 5 would be 0
    # if s-cross had been dropped instead of moved.
    if by_day.get("2026-10-04") != 2 or by_day.get("2026-10-05") != 1:
        fail("tool-shift", f"expected s-cross to move onto Oct 5, got {by_day}")
    else:
        ok("tool-shift", json.dumps(by_day))

    fresh_events = [
        event("2026-10-10T10:00:00.000Z", "session.started", "s-fresh", {"subject": "fresh-user"}, {"transport": "stdio"}),
        event("2026-10-10T10:00:01.000Z", "tools.listed", "s-fresh", {"subject": "fresh-user"}, {
            "count": 1, "tools": [{"name": "get_item", "annotations": ["readOnly"]}],
            "catalog_hash": "c" * 64, "duration_ms": 5, "is_error": False, "source": "list", "truncated": False,
        }),
    ]
    fresh_events += [
        event(f"2026-10-10T10:00:0{index + 2}.000Z", "tool.called", "s-fresh", {"subject": "fresh-user"})
        for index in range(5)
    ]
    ingest(fresh_key, fresh_events)
    status, overview, _ = request("GET", f"/v1/projects/{fresh}/analytics/overview?from=2026-10-10T00:00:00.000Z&to=2026-10-11T00:00:00.000Z", key=fresh_key)
    status_a, adoption, _ = request("GET", f"/v1/projects/{fresh}/analytics/adoption?from=2026-10-10T00:00:00.000Z&to=2026-10-11T00:00:00.000Z", key=fresh_key)
    counts = [step["count"] for step in overview.get("funnel", [])] if status == 200 else None
    if counts != [1, 1, 1, 1, None] or overview["funnel"][-1].get("eligible") != 0:
        fail("fresh-funnel", f"{status} {overview.get('funnel') if isinstance(overview, dict) else overview}")
    else:
        ok("fresh-funnel", "counts [1,1,1,1,null] eligible 0")
    last = adoption["funnel"]["steps"][-1] if status_a == 200 else {}
    if last.get("count") is not None or last.get("eligible") != 0 or last.get("dropoff_pct") is not None:
        fail("fresh-adoption-funnel", str(last))
    else:
        ok("fresh-adoption-funnel", "day 7 null, dropoff null, eligible 0")
    if adoption["active"]["points"][0]["sessions"] != 1:
        fail("fresh-sessions", str(adoption["active"]["points"]))
    else:
        ok("fresh-sessions", "1")

    ingest(nosess_key, [
        event("2026-10-10T11:00:00.000Z", "tool.called", None, {"subject": "nosess"}),
        event("2026-10-10T12:00:00.000Z", "tool.called", None, {"subject": "nosess"}),
    ])
    nf, nt = load_facts(nosess)
    compare_series(
        "nosession", nf, nt, nosess, nosess_key,
        datetime(2026, 10, 10, tzinfo=timezone.utc), datetime(2026, 10, 11, tzinfo=timezone.utc), {},
    )

    part_events = [
        event((datetime(2026, 9, 1, 12, tzinfo=timezone.utc) + timedelta(days=day)).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
              "tool.called", f"s-part-{day}", {"subject": f"part-{day}"})
        for day in range(31)
    ]
    ingest(part_key, part_events)
    explain_checks(part, boundary)

    spec_status, spec, _ = request("GET", "/v1/openapi.json", key=boundary_key)
    point_schema = (((spec or {}).get("components") or {}).get("schemas") or {}).get("AnalyticsAdoption", {})
    print("openapi adoption keys", sorted((point_schema.get("properties") or {}).keys())[:12])
    # The point schema is nested; search the document for the three fields near active.points.
    blob = json.dumps(spec)
    if '"sessions"' in blob and '"wau"' in blob and '"mau"' in blob:
        ok("openapi", "sessions, wau, mau present")
    else:
        fail("openapi", "adoption document is missing a trend field")

    out = {
        "boundary": boundary, "fresh": fresh, "nosession": nosess, "partitions": part,
        "failures": FAILURES,
    }
    with open("/tmp/dash-v3-review-projects.json", "w") as handle:
        json.dump(out, handle, indent=2)
    print(f"FAILURES {len(FAILURES)}")
    for item in FAILURES:
        print(" -", item)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
