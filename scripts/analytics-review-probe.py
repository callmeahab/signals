#!/usr/bin/env python3
"""Independent analytics v2 review probe.

Generates a synthetic dataset, ingests it through the collector, and compares
every analytics route with numbers computed from the raw events. Adapted from reports/review-r1/probe.py for CI, including the round-one
contract amendments. Requires a migrated isolated database; starts and stops its
own collector. Run after cargo build --release --bin signals.
"""
import hashlib
import json
import math
import os
import re
import subprocess
import statistics
import socket
import threading
import time
import urllib.error
import urllib.request
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = os.getenv("ANALYTICS_REVIEW_URL", "http://127.0.0.1:25448")
from urllib.parse import urlparse
ADDRESS = urlparse(BASE)
assert ADDRESS.hostname in ("127.0.0.1", "localhost"), "Requires isolated localhost collector"
PROBE_PORT = int(os.getenv("ANALYTICS_REVIEW_PROBE_PORT", "25449"))
PROBE_URL = f"http://127.0.0.1:{PROBE_PORT}/mcp"
SERVER = None
PG = os.getenv("ANALYTICS_PG_CONTAINER")
ADMIN = "review-analytics-admin-token-32chars"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BIN = os.path.join(ROOT, "target", "release", "signals")
ARTIFACTS = os.path.join(ROOT, "target", "analytics-review")
os.makedirs(ARTIFACTS, exist_ok=True)
FINDINGS = []
MISMATCHES = []
LATENCY_BUDGET_MS = float(os.getenv("SIGNALS_PROBE_LATENCY_BUDGET_MS", "300"))
if not math.isfinite(LATENCY_BUDGET_MS) or LATENCY_BUDGET_MS <= 0:
    raise ValueError("SIGNALS_PROBE_LATENCY_BUDGET_MS must be finite and positive")
TIMING_SAMPLES = {}


def half_away(x):
    if x >= 0:
        return math.floor(x + 0.5)
    return math.ceil(x - 0.5)


def one_decimal(x):
    return half_away(x * 10) / 10.0


def rate(n, d):
    if d <= 0:
        return None
    return one_decimal(n / d * 100.0)


def fmt(dt):
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def parse_ts(value):
    if value is None:
        return None
    text = value.replace("Z", "+00:00")
    return datetime.fromisoformat(text).astimezone(timezone.utc)


def uuid7():
    ts_ms = int(time.time() * 1000)
    rand = int.from_bytes(os.urandom(10), "big")
    value = (ts_ms & ((1 << 48) - 1)) << 80
    value |= 0x7 << 76
    value |= ((rand >> 62) & ((1 << 12) - 1)) << 64
    value |= 0b10 << 62
    value |= rand & ((1 << 62) - 1)
    h = f"{value:032x}"
    return f"{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:]}"


def finding(severity, ident, detail):
    FINDINGS.append({"severity": severity, "id": ident, "detail": detail})
    print(f"[{severity}] {ident}: {detail}")


def psql(sql):
    command = (["docker", "exec", "-i", PG, "psql", "-U", "postgres", "-d", "signals"]
               if PG else ["psql", os.environ["DATABASE_URL"]])
    result = subprocess.run(
        command + ["-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql],
        check=True, capture_output=True, text=True,
    )
    return result.stdout.strip()


class Client:
    def __init__(self):
        self.cookie = None

    def request(self, method, path, body=None, key=None, ndjson=None, timeout=60):
        data = None
        headers = {}
        if ndjson is not None:
            data = ndjson.encode()
            headers["content-type"] = "application/x-ndjson"
        elif body is not None:
            data = json.dumps(body).encode()
            headers["content-type"] = "application/json"
        if key:
            headers["authorization"] = "Bearer " + key
        if self.cookie:
            headers["cookie"] = self.cookie
        req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                raw = response.read()
                payload = json.loads(raw) if raw else None
                return response.status, payload, dict(response.headers)
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                payload = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                payload = raw.decode()
            return error.code, payload, dict(error.headers)

    def admin(self, route, body):
        status, payload, _ = self.request("POST", "/v1/admin/" + route, body, ADMIN)
        if status != 200:
            raise SystemExit(f"admin {route} failed {status} {payload}")
        return payload


def wait_ready():
    for _ in range(80):
        if SERVER is not None and SERVER.poll() is not None:
            raise RuntimeError("Probe collector exited; inspect target/analytics-review/server.log")
        try:
            with urllib.request.urlopen(BASE + "/readyz", timeout=1) as response:
                if response.status == 200:
                    if SERVER is not None and SERVER.poll() is not None:
                        raise RuntimeError("Probe collector exited during readiness check")
                    return
        except OSError:
            pass
        time.sleep(0.25)
    raise SystemExit("collector not ready")


def stop_server():
    global SERVER
    if SERVER is not None:
        SERVER.terminate()
        try:
            SERVER.wait(timeout=15)
        except subprocess.TimeoutExpired:
            SERVER.kill()
            SERVER.wait()
        SERVER = None


def require_unused_port(port):
    # Fail before issuing fixture requests to an unrelated collector on this port.
    with socket.socket() as check:
        check.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        check.bind(("127.0.0.1", port))


def restart_server():
    global SERVER
    stop_server()
    require_unused_port(ADDRESS.port)
    env = os.environ.copy()
    env.pop("SIGNALS_CONFORMANCE_CLOCK", None)
    env.update({
        "DATABASE_URL": os.environ["DATABASE_URL"],
        "SIGNALS_BIND": f"127.0.0.1:{ADDRESS.port}",
        "SIGNALS_PUBLIC_URL": BASE,
        "SIGNALS_ADMIN_TOKEN": ADMIN,
        "SIGNALS_SESSION_SECRET": "review-analytics-session-secret-32ch",
        "SIGNALS_BOOTSTRAP_EMAIL": "owner@review.test",
        "SIGNALS_BOOTSTRAP_PASSWORD": "review-test-password",
    })
    with open(os.path.join(ARTIFACTS, "server.log"), "a") as log:
        SERVER = subprocess.Popen([BIN, "serve"], env=env, stdout=log, stderr=log, cwd=ROOT)
    wait_ready()


# --- dataset -----------------------------------------------------------------

CATALOG = [
    ("get_product", ["readOnly"]),
    ("list_orders", ["readOnly"]),
    ("search_products", ["readOnly"]),
    ("book_flight", ["destructive"]),
    ("get_admin", ["destructive"]),
    ("set_status", []),
    ("lookup_sku", []),
    ("Get_Thing", []),
    ("cancel_booking", ["destructive"]),
    ("refund", []),
]


def identity_of(caller):
    if not caller:
        return None
    kind = caller.get("subject_kind", None)
    subject = caller.get("subject") or None
    if (kind is None or kind == "oauth") and subject:
        return ("strong", subject)
    if caller.get("key_id"):
        return ("key", caller["key_id"])
    if caller.get("ip_hash"):
        return ("network", caller["ip_hash"])
    return None


class Builder:
    def __init__(self, now):
        self.now = now
        self.events = []

    def add(self, ident, ts, kind, attrs, transport=None, listing=False):
        caller = dict(ident["caller"])
        client_name, client_version, protocol = ident["client"]
        event = {
            "id": uuid7(),
            "ts": ts,
            "type": kind,
            "session_id": ident.get("session"),
            "client_name": client_name,
            "client_version": client_version,
            "protocol": protocol,
            "caller": caller,
            "identity": identity_of(caller),
            "tool": attrs.get("tool"),
            "duration_ms": attrs.get("duration_ms"),
            "is_error": bool(attrs.get("is_error")) or kind == "error",
            "transport": transport or attrs.get("transport"),
            "attrs": attrs,
            "listing": listing,
        }
        self.events.append(event)
        return event

    def session(self, ident, start, transport, calls, listed=True, init_error=False, init_dur=40):
        ident = dict(ident)
        ident["session"] = f"s-{ident['label']}-{start.strftime('%m%d%H%M%S')}"
        self.add(ident, start, "session.started", {"transport": transport}, transport)
        self.add(ident, start + timedelta(seconds=1), "mcp.initialize", {
            "requested_protocol_version": ident["client"][2],
            "client_capabilities": ident["caps"],
            "server_capabilities": ["tools", "prompts"],
            "duration_ms": init_dur,
            "is_error": init_error,
        })
        cursor = start + timedelta(seconds=2)
        if listed == "request":
            self.add(ident, cursor, "mcp.request", {"method": "tools/list", "duration_ms": 5, "is_error": False})
            cursor += timedelta(seconds=1)
        elif listed:
            self.add(ident, cursor, "tools.listed", {
                "count": len(CATALOG),
                "tools": [{"name": name, "annotations": ann, "schema_hash": hashlib.sha256(name.encode()).hexdigest()} for name, ann in CATALOG],
                "catalog_hash": "c" * 64,
                "future_optional": True,
            }, listing=True)
            cursor += timedelta(seconds=1)
        for offset, call in enumerate(calls):
            when = call.get("at", cursor + timedelta(seconds=offset))
            attrs = {
                "tool": call["tool"],
                "duration_ms": call.get("dur", 100),
                "is_error": call.get("error", False),
                "input_bytes": call.get("inp", 100),
                "output_bytes": call.get("out", 400),
                "output_kinds": call.get("kinds", [] if call.get("out", 400) == 0 or call.get("cancelled") else ["text"]),
                "cancelled": call.get("cancelled", False),
            }
            if "chars" in call:
                attrs["output_chars"] = call["chars"]
            if call.get("kind"):
                attrs["error_kind"] = call["kind"]
            if call.get("code") is not None:
                attrs["error_code"] = call["code"]
            if call.get("args") is not None:
                attrs["args"] = call["args"]
            if "schema_in" in call:
                attrs["input_schema_valid"] = call["schema_in"]
            if "schema_out" in call:
                attrs["output_schema_valid"] = call["schema_out"]
            if call.get("note"):
                attrs["private_note"] = call["note"]
            self.add(ident, when, "tool.called", attrs)
        end = start + timedelta(seconds=80)
        self.add(ident, end, "session.ended", {"duration_ms": int((end - start).total_seconds() * 1000), "reason": "client"})
        return ident["session"]


def build(now):
    old = (now - timedelta(days=10)).replace(hour=0, minute=30, second=0, microsecond=0)
    early = (now - timedelta(days=3)).replace(hour=1, minute=0, second=0, microsecond=0)
    late = (now - timedelta(days=2)).replace(hour=18, minute=0, second=0, microsecond=0)
    heavy_a = (now - timedelta(days=2)).replace(hour=4, minute=0, second=0, microsecond=0)
    heavy_b = (now - timedelta(days=1)).replace(hour=4, minute=0, second=0, microsecond=0)
    heavy_c = (now - timedelta(hours=3)).replace(minute=10, second=0, microsecond=0)
    idents = []
    for i in range(8):
        idents.append({"label": f"strong-{i:02d}", "caller": {"subject": f"user-strong-{i:02d}"}, "client": ("Claude", "1.2.0", "2025-11-25"), "caps": ["sampling", "roots"], "group": "old"})
    for i in range(4):
        idents.append({"label": f"both-{i:02d}", "caller": {"subject": f"user-both-{i:02d}", "key_id": f"key-both-{i:02d}"}, "client": ("Claude", "1.2.0", "2025-11-25"), "caps": ["sampling", "roots"], "group": "old"})
    for i in range(6):
        idents.append({"label": f"key-{i:02d}", "caller": {"key_id": f"key-only-{i:02d}", "subject": None}, "client": ("Cursor", "0.48.0", "2025-06-18"), "caps": ["roots"], "group": "early"})
    for i in range(4):
        idents.append({"label": f"net-{i:02d}", "caller": {"ip": f"203.0.113.{20 + i}", "subject": None}, "client": ("Zed", "0.9.1", "2025-06-18"), "caps": ["elicitation"], "group": "recent"})
    idents.append({"label": "late-clock", "caller": {"subject": "user-late-clock"}, "client": ("Claude", "1.2.0", "2025-11-25"), "caps": ["sampling"], "group": "late"})
    b = Builder(now)
    standard = [
        {"tool": "get_product", "dur": 80, "chars": 200, "inp": 100, "out": 400, "args": {"id": 1}, "schema_in": True, "schema_out": True},
        {"tool": "list_orders", "dur": 120, "chars": 80, "inp": 2000, "out": 1800},
        {"tool": "search_products", "dur": 240, "chars": 400, "inp": 8000, "out": 9000},
        {"tool": "set_status", "dur": 50, "chars": 20, "inp": 30000, "out": 100},
        {"tool": "lookup_sku", "dur": 15, "inp": 50, "out": 90},
    ]
    for ident in idents:
        transport = "stdio" if ident["client"][0] == "Zed" else "streamable-http"
        if ident["group"] == "old":
            calls = list(standard)
            if ident["label"] == "strong-00":
                calls = [
                    {"tool": "get_product", "error": True, "kind": "tool", "dur": 100, "chars": 0, "out": 40, "at_off": 0, "args": {"id": 7}, "schema_in": False, "note": "keep"},
                    {"tool": "list_orders", "dur": 90, "chars": 40, "at_off": 10},
                    {"tool": "get_product", "dur": 110, "chars": 180, "at_off": 20, "schema_out": False},
                    {"tool": "get_product", "error": True, "kind": "tool", "dur": 130, "chars": 10, "at_off": 40},
                    {"tool": "get_product", "dur": 150, "chars": 180, "at_off": 71},
                    {"tool": "get_product", "error": True, "kind": "tool", "dur": 160, "chars": 10, "at_off": 80},
                    {"tool": "get_product", "dur": 170, "chars": 180, "at_off": 110},
                ]
            b.session(ident, old, transport, _at(old + timedelta(seconds=5), calls), listed=(ident["label"] == "strong-00"), init_dur=30)
            b.session(ident, old + timedelta(days=1, hours=2), transport, _at(old + timedelta(days=1, hours=2, seconds=5), standard[:1]), listed="request", init_dur=45)
            b.session(ident, old + timedelta(days=7, hours=1), transport, _at(old + timedelta(days=7, hours=1, seconds=5), standard[:1]), listed="request", init_dur=80, init_error=(ident["label"] == "strong-01"))
            b.session(ident, heavy_c, transport, _at(heavy_c + timedelta(seconds=5), standard), listed="request")
        elif ident["group"] == "early":
            b.session(ident, early, transport, _at(early + timedelta(seconds=5), standard), listed="request", init_dur=55)
            b.session(ident, early + timedelta(days=1), transport, _at(early + timedelta(days=1, seconds=5), standard[:2]), listed="request")
            b.session(ident, heavy_b, transport, _at(heavy_b + timedelta(seconds=5), standard[:3]), listed="request")
        elif ident["group"] == "late":
            # Anniversary day is the next UTC date. No events that day.
            b.session(ident, late, transport, _at(late + timedelta(seconds=5), standard[:2]), listed="request")
            b.session(ident, heavy_c + timedelta(minutes=20), transport, _at(heavy_c + timedelta(minutes=20, seconds=5), standard[:1]), listed="request")
        else:
            b.session(ident, heavy_c + timedelta(minutes=30), transport, _at(heavy_c + timedelta(minutes=30, seconds=5), [
                {"tool": "book_flight", "error": True, "kind": "protocol", "code": -32602, "dur": 900, "chars": 30, "out": 70},
                {"tool": "book_flight", "error": True, "kind": "timeout", "dur": 5000, "chars": 0, "out": 0, "kinds": []},
                {"tool": "book_flight", "cancelled": True, "kind": "cancelled", "dur": 20, "out": 0, "chars": 0, "kinds": []},
                {"tool": "get_product", "dur": 33, "out": 0, "chars": 0, "kinds": []},
                {"tool": "not_a_tool", "error": True, "kind": "unknown_tool", "dur": 12, "chars": 4, "out": 8},
                {"tool": "book_flight", "error": True, "kind": "internal", "dur": 70, "chars": 8, "out": 16},
                {"tool": "get_admin", "dur": 64, "chars": 48, "inp": 70000, "out": 80000},
                {"tool": "Get_Thing", "dur": 42, "chars": 16, "inp": 1500, "out": 5000},
            ]), listed="request", init_dur=100)
    # One auth failure and one cross-midnight path on a strong identity.
    host = idents[2]
    host = dict(host)
    midnight = heavy_b.replace(hour=0, minute=0, second=0, microsecond=0)
    host["session"] = "s-cross-midnight"
    b.add(host, midnight - timedelta(minutes=10), "session.started", {"transport": "streamable-http"}, "streamable-http")
    b.add(host, midnight - timedelta(minutes=9), "tool.called", {"tool": "set_status", "duration_ms": 25, "is_error": False, "input_bytes": 10, "output_bytes": 20, "output_kinds": ["text"], "cancelled": False, "output_chars": 8})
    b.add(host, midnight + timedelta(minutes=1), "tool.called", {"tool": "lookup_sku", "duration_ms": 18, "is_error": False, "input_bytes": 11, "output_bytes": 22, "output_kinds": ["text"], "cancelled": False})
    b.add(host, midnight + timedelta(minutes=2), "session.ended", {"duration_ms": 720000, "reason": "idle"})
    b.add(host, heavy_a, "error", {"message": "nope", "where": "auth", "reason": "invalid"})
    # A session that only connects: funnel drop.
    quiet = dict(idents[3])
    quiet["session"] = "s-connect-only"
    b.add(quiet, heavy_b + timedelta(hours=2), "session.started", {"transport": "streamable-http"}, "streamable-http")
    b.add(quiet, heavy_b + timedelta(hours=2, seconds=30), "session.ended", {"duration_ms": 30000, "reason": "client"})
    b.events.sort(key=lambda e: (e["ts"], e["id"]))
    return b.events, {"old": old, "early": early, "late": late, "heavy_c": heavy_c, "midnight": midnight}


def _at(start, calls):
    out = []
    for index, call in enumerate(calls):
        item = dict(call)
        item["at"] = start + timedelta(seconds=item.pop("at_off", index))
        out.append(item)
    return out


def wire_event(event):
    body = {
        "id": event["id"],
        "ts": fmt(event["ts"]),
        "type": event["type"],
        "attrs": event["attrs"],
    }
    if event["session_id"]:
        body["session_id"] = event["session_id"]
    body["client"] = {"name": event["client_name"], "version": event["client_version"], "protocol_version": event["protocol"]}
    caller = {k: v for k, v in event["caller"].items() if v is not None or k in ("subject",)}
    # Preserve explicit null subject when key_id is the identity; omit ip-only extras.
    if "ip" in event["caller"] and not event["caller"].get("subject") and not event["caller"].get("key_id"):
        caller = {"ip": event["caller"]["ip"]}
    elif event["caller"].get("key_id") and not event["caller"].get("subject"):
        caller = {"key_id": event["caller"]["key_id"], "subject": None}
    body["caller"] = caller
    return body


def ingest(client, key, events):
    rejected = []
    accepted = 0
    batch_index = 0
    chunk = []
    def flush(force_ndjson=False):
        nonlocal accepted, batch_index
        if not chunk:
            return
        sdk = "node" if batch_index % 2 == 0 else "python"
        envelope = {
            "schema_version": 1,
            "sent_at": fmt(datetime.now(timezone.utc)),
            "source": {"sdk": sdk, "sdk_version": "1.0.0", "server_name": "review-probe", "server_version": "1", "instance_id": "review-r1"},
            "events": chunk,
        }
        if force_ndjson or batch_index == 3:
            lines = [json.dumps({k: v for k, v in envelope.items() if k != "events"})]
            lines.extend(json.dumps(event) for event in chunk)
            status, payload, _ = client.request("POST", "/v1/events", key=key, ndjson="\n".join(lines) + "\n")
        else:
            status, payload, _ = client.request("POST", "/v1/events", envelope, key)
        if status != 202 or payload.get("rejected"):
            rejected.append(payload)
        else:
            accepted += payload.get("accepted", 0)
        batch_index += 1
        chunk.clear()
    for event in events:
        chunk.append(wire_event(event))
        if len(chunk) == 40:
            flush()
    flush()
    return accepted, rejected


def attach_hashes(project, events):
    rows = psql(f"SELECT id::text || ' ' || coalesce(caller->>'ip_hash','') FROM events WHERE project_id='{project}' AND caller ? 'ip_hash'")
    hashes = {}
    for line in rows.splitlines():
        if not line.strip():
            continue
        event_id, ip_hash = line.split(" ", 1)
        if ip_hash:
            hashes[event_id] = ip_hash
    for event in events:
        if event["id"] in hashes:
            event["caller"]["ip_hash"] = hashes[event["id"]]
            event["caller"].pop("ip", None)
            event["identity"] = identity_of(event["caller"])
    missing = [e for e in events if e["caller"].get("ip") and not e["identity"]]
    if missing:
        finding("blocker", "network-identity", f"{len(missing)} ip-only events did not become network identities")


# --- expectations ------------------------------------------------------------

READ_PREFIXES = ("get_", "list_", "search_", "find_", "read_", "fetch_", "describe_", "lookup_")


def slo_class(tool, settings, annotations):
    override = (settings.get("slo_classes") or {}).get(tool)
    if override in ("read", "mutate"):
        return override
    flags = set(annotations or [])
    if "destructive" in flags or "destructiveHint" in flags:
        return "mutate"
    if "readOnly" in flags or "readOnlyHint" in flags:
        return "read"
    if tool.startswith(READ_PREFIXES):
        return "read"
    return "mutate"


def target_of(settings, kind):
    return float((settings.get("slo_targets") or {}).get(kind, 99.5 if kind == "read" else 98.0))


def divisor_of(settings):
    return float(settings.get("token_divisor") or 4)


def hist_bucket(value):
    value = max(int(value), 1)
    return min(int(math.floor(math.log(value) / math.log(600000) * 59)), 59)


def histogram(values):
    bins = [0] * 60
    for value in values:
        bins[hist_bucket(value)] += 1
    return bins


def percentile(bins, q):
    total = sum(bins)
    if total == 0:
        return None
    rank = max(1, math.ceil(total * q))
    seen = 0
    for index, count in enumerate(bins):
        seen += count
        if seen >= rank:
            return half_away(600000 ** (index / 59))
    return None


def exact_percentile(values, q):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * q) - 1)]


def calls_of(events):
    return [e for e in events if e["type"] == "tool.called"]


def token_values(calls, divisor):
    values = []
    for event in calls:
        chars = event["attrs"].get("output_chars")
        if isinstance(chars, int) and chars >= 0:
            values.append(chars / divisor)
            continue
        out = event["attrs"].get("output_bytes")
        if isinstance(out, int) and out >= 0:
            values.append(out / divisor)
    return values


def token_total(calls, divisor):
    values = token_values(calls, divisor)
    if not values:
        return None
    return half_away(sum(values))


def average(calls, key):
    values = [e["attrs"][key] for e in calls if isinstance(e["attrs"].get(key), int) and e["attrs"][key] >= 0]
    if not values:
        return None
    return half_away(sum(values) / len(values))


def error_kinds(calls):
    known = any(isinstance(e["attrs"].get("error_kind"), str) for e in calls)
    def count(kind):
        return sum(1 for e in calls if e["attrs"].get("error_kind") == kind)
    unknown = sum(1 for e in calls if e["is_error"] and isinstance(e["attrs"].get("error_kind"), str) and e["attrs"]["error_kind"] not in ("tool", "protocol", "timeout", "cancelled"))
    return {
        "tool": sum(1 for e in calls if e["is_error"] and (e["attrs"].get("error_kind") is None or e["attrs"].get("error_kind") == "tool")),
        "protocol": count("protocol") if known else None,
        "timeout": count("timeout") if known else None,
        "cancelled": count("cancelled") if known else None,
        "unknown": unknown if known else None,
    }


def retries(calls):
    previous = {}
    count = corrected = 0
    for event in sorted(calls, key=lambda e: (e["ts"], e["id"])):
        if event["type"] != "tool.called" or not event["session_id"] or not event["tool"]:
            continue
        prev = previous.get((event["session_id"], event["tool"]))
        previous[(event["session_id"], event["tool"])] = event
        if prev and prev["is_error"] and event["ts"] - prev["ts"] <= timedelta(seconds=30):
            count += 1
            corrected += int(not event["is_error"])
    return count, corrected


def paths(events):
    sessions = defaultdict(list)
    found = defaultdict(int)
    for event in sorted(calls_of(events), key=lambda e: (e["ts"], e["id"])):
        if not event["session_id"] or not event["tool"]:
            continue
        seq = sessions[event["session_id"]]
        seq.append(event["tool"])
        for length in (2, 3):
            if len(seq) >= length:
                found[tuple(seq[-length:])] += 1
        if len(seq) > 3:
            del seq[0]
    return found


def latency_value(calls, exact):
    durations = [e["duration_ms"] for e in calls if isinstance(e["duration_ms"], int)]
    if exact:
        point = lambda q: exact_percentile(durations, q)
        method = "exact"
    else:
        bins = histogram(durations)
        point = lambda q: percentile(bins, q)
        method = "histogram"
    return {"p50": point(0.5), "p95": point(0.95), "p99": point(0.99), "method": method, "buckets": {"edges": [600000 ** (b / 59) for b in range(60)] + [None], "counts": histogram(durations)} if durations else None}


def latency_series_value(calls, window):
    if not any(isinstance(e["duration_ms"], int) for e in calls):
        return None
    hourly = window[1] - window[0] <= timedelta(hours=48)
    floor = lambda t: t.replace(minute=0, second=0, microsecond=0) if hourly else t.replace(hour=0, minute=0, second=0, microsecond=0)
    grouped = defaultdict(list)
    for event in calls:
        grouped[floor(event["ts"])].append(event)
    points = []
    t = floor(window[0])
    exact = window[1] - window[0] < timedelta(hours=6)
    while t < window[1]:
        value = latency_value(grouped[t], exact)
        points.append({"t": fmt(t), **{k: value[k] for k in ("p50", "p95", "p99")}})
        t += timedelta(hours=1) if hourly else timedelta(days=1)
    return {"bucket": "hour" if hourly else "day", "method": "exact" if exact else "histogram", "points": points}


def payload_hist(calls, key):
    values = [e["attrs"][key] for e in calls if isinstance(e["attrs"].get(key), int) and e["attrs"][key] >= 0]
    if not values:
        return None
    bins = [0, 0, 0, 0, 0]
    for value in values:
        if value < 1024:
            bins[0] += 1
        elif value < 4096:
            bins[1] += 1
        elif value < 16384:
            bins[2] += 1
        elif value < 65536:
            bins[3] += 1
        else:
            bins[4] += 1
    return bins


def session_transport(all_events):
    found = {}
    for event in all_events:
        if event["session_id"] and event["transport"]:
            found[event["session_id"]] = event["transport"]
    return found


def selected(all_events, window, filters):
    transports = session_transport(all_events) if filters.get("transport") else {}
    start, end = window
    out = []
    for event in all_events:
        if not (start <= event["ts"] < end):
            continue
        if filters.get("client") and event["client_name"] != filters["client"]:
            continue
        if filters.get("tool") and event["tool"] != filters["tool"]:
            continue
        if filters.get("caller") and (not event["identity"] or event["identity"][1] != filters["caller"]):
            continue
        if filters.get("transport"):
            transport = event["transport"] or transports.get(event["session_id"])
            if transport != filters["transport"]:
                continue
        out.append(event)
    return out


def first_seen_map(events):
    found = {}
    for event in events:
        if event["identity"] and event["identity"] not in found:
            found[event["identity"]] = event["ts"]
    return found


def by_kind(events):
    ids = {e["identity"] for e in events if e["identity"]}
    return {kind: sum(1 for item in ids if item[0] == kind) for kind in ("strong", "key", "network")}


def catalog_of(events):
    listed = [e for e in events if e["type"] == "tools.listed"]
    if not listed:
        return {"known": False, "tools": {}, "hash": None, "at": None}
    latest = max(listed, key=lambda e: (e["ts"], e["id"]))
    tools = {}
    for tool in latest["attrs"].get("tools") or []:
        if isinstance(tool.get("name"), str):
            tools[tool["name"]] = tool.get("annotations") or []
    return {"known": True, "tools": tools, "hash": latest["attrs"].get("catalog_hash"), "at": latest["ts"]}


def funnel(events, window, first):
    people = {}
    for event in events:
        ident = event["identity"]
        if not ident or ident not in first or not (window[0] <= first[ident] < window[1]):
            continue
        row = people.setdefault(ident, [False, False, 0, False])
        row[0] |= event["type"] == "session.started"
        row[1] |= event["type"] == "tools.listed" or (event["type"] == "mcp.request" and event["attrs"].get("method") == "tools/list")
        row[2] += int(event["type"] == "tool.called")
        row[3] |= event["ts"] >= first[ident] + timedelta(days=7)
    counts = [
        sum(1 for row in people.values() if row[0]),
        sum(1 for row in people.values() if row[1]),
        sum(1 for row in people.values() if row[2] >= 1),
        sum(1 for row in people.values() if row[2] >= 5),
        sum(1 for row in people.values() if row[3]),
    ]
    steps = ["connected", "listed_tools", "first_call", "five_calls", "returned_day_7"]
    result = [{"step": step, "count": count} for step, count in zip(steps, counts)]
    eligible = sum(first[ident] + timedelta(days=7) < window[1] for ident in people)
    result[-1]["eligible"] = eligible
    if not eligible:
        result[-1]["count"] = None
    return result, people


def monday(value):
    day = value.date() if isinstance(value, datetime) else value
    return day - timedelta(days=day.weekday())


def cohorts(all_events, window, filters, first):
    start = datetime.combine(monday(window[0]), datetime.min.time(), timezone.utc)
    events = selected(all_events, (start, window[1]), filters)
    ids = {e["identity"] for e in events if e["identity"]}
    groups = defaultdict(list)
    for ident in ids:
        if ident in first:
            groups[monday(first[ident])].append(ident)
    rows = []
    for day, members in sorted(groups.items()):
        if day < window[0].date() - timedelta(days=6):
            continue
        retention = []
        week = 0
        while day + timedelta(weeks=week) < window[1].date():
            frm = day + timedelta(weeks=week)
            to = frm + timedelta(weeks=1)
            if to > window[1].date():
                retention.append(None)
            else:
                active = {e["identity"] for e in events if e["identity"] and frm <= e["ts"].date() < to}
                retention.append(rate(sum(1 for ident in members if ident in active), len(members)))
            week += 1
        rows.append({"cohort_start": day.isoformat(), "size": len(members), "retained_pct": retention})
    return rows


def retention(all_events, window, events, first, offset):
    eligible = [ident for ident, seen in first.items() if window[0] <= seen < window[1] and datetime.combine(seen.date() + timedelta(days=offset + 1), datetime.min.time(), timezone.utc) <= window[1]]
    active = set()
    for event in events:
        ident = event["identity"]
        if not ident or ident not in first:
            continue
        if event["ts"].date() == (first[ident] + timedelta(days=offset)).date():
            active.add(ident)
    return rate(sum(1 for ident in eligible if ident in active), len(eligible))


def calendar_retention(window, events, first, offset):
    """Anniversary day is observable once that UTC date has ended."""
    eligible = []
    for ident, seen in first.items():
        if not (window[0] <= seen < window[1]):
            continue
        anniversary = seen.date() + timedelta(days=offset)
        if datetime.combine(anniversary + timedelta(days=1), datetime.min.time(), timezone.utc) <= window[1]:
            eligible.append(ident)
    active = set()
    for event in events:
        ident = event["identity"]
        if ident in first and event["ts"].date() == (first[ident] + timedelta(days=offset)).date():
            active.add(ident)
    return rate(sum(1 for ident in eligible if ident in active), len(eligible)), len(eligible)


def status_of(call_count, errors, target, in_catalog):
    if call_count == 0:
        return "dead" if in_catalog else None
    success = 100.0 * (1 - errors / call_count)
    if success < target:
        return "error"
    if success <= target + 1:
        return "warn"
    return "ok"


def expect_tools(all_events, window, filters, settings):
    events = selected(all_events, window, filters)
    calls = calls_of(events)
    catalog = catalog_of(all_events)
    grouped = {name: [] for name in catalog["tools"]}
    for event in calls:
        if event["tool"] and (not catalog["known"] or event["tool"] in catalog["tools"]):
            grouped.setdefault(event["tool"], []).append(event)
    exact = window[1] - window[0] < timedelta(hours=6)
    tools = []
    for tool, rows in sorted(grouped.items()):
        kinds = error_kinds(rows)
        retry, corrected = retries(rows)
        days = defaultdict(lambda: [0, 0])
        for event in rows:
            bucket = days[event["ts"].date()]
            bucket[0] += 1
            bucket[1] += int(event["is_error"])
        schema = {}
        for key, attr in (("input", "input_schema_valid"), ("output", "output_schema_valid")):
            if any(isinstance(e["attrs"].get(attr), bool) for e in rows):
                schema[key] = sum(1 for e in rows if e["attrs"].get(attr) is False)
            else:
                schema[key] = None
        tokens = token_total(rows, divisor_of(settings))
        tools.append({
            "tool": tool,
            "slo_class": slo_class(tool, settings, catalog["tools"].get(tool)),
            "calls": len(rows),
            "success_rate": rate(len(rows) - sum(e["is_error"] for e in rows), len(rows)),
            "errors": kinds,
            "latency": latency_value(rows, exact),
            "input_bytes_avg": average(rows, "input_bytes"),
            "output_bytes_avg": average(rows, "output_bytes"),
            "output_tokens_est": None if tokens is None or not rows else half_away(tokens / len(rows)),
            "retries": {"count": retry, "self_corrected_pct": rate(corrected, retry)},
            "schema_failures": schema,
            "trend": [{"t": day.isoformat(), "calls": item[0], "errors": item[1]} for day, item in sorted(days.items())],
            "_errors_n": sum(e["is_error"] for e in rows),
        })
    found = paths(events)
    ordered = sorted(found.items(), key=lambda item: (-item[1], item[0]))
    total = sum(found.values())
    path_rows = [{"sequence": list(seq), "count": count, "pct": rate(count, total)} for seq, count in ordered[:20]]
    dead = sorted(name for name, rows in grouped.items() if not rows and name in catalog["tools"])
    body = {
        "catalog": {
            "advertised": len(catalog["tools"]) if catalog["known"] else None,
            "used": sum(1 for rows in grouped.values() if rows),
            "dead": dead,
            "known": catalog["known"],
            "complete": catalog["known"],
            "catalog_hash": catalog["hash"],
            "updated_at": fmt(catalog["at"]) if catalog["at"] else None,
        },
        "tools": tools,
        "paths": path_rows,
    }
    return body, events


def expect_overview(all_events, window, filters, settings):
    events = selected(all_events, window, filters)
    prev = selected(all_events, (window[0] - (window[1] - window[0]), window[0]), filters)
    calls = calls_of(events)
    prev_calls = calls_of(prev)
    first = first_seen_map(all_events)
    ids = {e["identity"] for e in events if e["identity"]}
    prev_ids = {e["identity"] for e in prev if e["identity"]}
    sessions = {e["session_id"] for e in events if e["session_id"]}
    prev_sessions = {e["session_id"] for e in prev if e["session_id"]}
    catalog = catalog_of(all_events)
    grouped = {name: [] for name in catalog["tools"]}
    for event in calls:
        if event["tool"] and (not catalog["known"] or event["tool"] in catalog["tools"]):
            grouped.setdefault(event["tool"], []).append(event)
    exact = window[1] - window[0] < timedelta(hours=6)
    attention = []
    for tool, rows in grouped.items():
        errors = sum(e["is_error"] for e in rows)
        kind = slo_class(tool, settings, catalog["tools"].get(tool))
        attention.append({
            "tool": tool,
            "calls": len(rows),
            "success_rate": rate(len(rows) - errors, len(rows)),
            "p95": latency_value(rows, exact)["p95"],
            "slo_class": kind,
            "status": status_of(len(rows), errors, target_of(settings, kind), tool in catalog["tools"]),
        })
    rank = {"error": 0, "warn": 1, "dead": 2, "ok": 3}
    attention.sort(key=lambda row: (rank[row["status"]], -row["calls"], row["tool"]))
    clients = defaultdict(lambda: defaultdict(int))
    for event in calls:
        clients[event["ts"].date()][event["client_name"] or "Unknown"] += 1
    funnel_rows, _ = funnel(events, window, first)
    latency = latency_value(calls, exact)
    latency["prev_p95"] = latency_value(prev_calls, exact)["p95"]
    series = latency_series_value(calls, window)
    latency["sparkline"] = [p["p95"] for p in series["points"]] if series else None
    tokens = token_total(calls, divisor_of(settings))
    return {
        "tiles": {
            "tool_calls": {"value": len(calls), "prev": len(prev_calls)},
            "active_users": {
                "value": len(ids),
                "prev": len(prev_ids),
                "new": sum(1 for ident in ids if window[0] <= first.get(ident, window[1]) < window[1]),
                "by_kind": by_kind(events),
            },
            "sessions": {
                "value": len(sessions),
                "prev": len(prev_sessions),
                "calls_per_session": None if not sessions else one_decimal(len(calls) / len(sessions)),
            },
            "success_rate": {
                "value": rate(len(calls) - sum(e["is_error"] for e in calls), len(calls)),
                "prev": rate(len(prev_calls) - sum(e["is_error"] for e in prev_calls), len(prev_calls)),
                "tools_below_slo": sum(1 for row in attention if row["status"] == "error"),
            },
            "latency": latency,
            "context_tokens": {
                "value": tokens,
                "per_call": None if tokens is None or not calls else half_away(tokens / len(calls)),
                "estimated": True,
            },
        },
        "calls_by_client": {"buckets": "day", "points": [{"t": day.isoformat(), "by_client": dict(rows)} for day, rows in sorted(clients.items())]},
        "funnel": funnel_rows,
        "attention": attention,
        "cohorts": {"kind": "weekly", "rows": cohorts(all_events, window, filters, first)},
    }


def expect_reliability(all_events, window, filters, settings):
    events = selected(all_events, window, filters)
    calls = calls_of(events)
    catalog = catalog_of(all_events)
    slo = []
    for kind in ("read", "mutate"):
        target = target_of(settings, kind)
        rows = [e for e in calls if e["tool"] and slo_class(e["tool"], settings, catalog["tools"].get(e["tool"])) == kind]
        errors = sum(e["is_error"] for e in rows)
        def burn(hours):
            sample = calls_of(selected(all_events, (window[1] - timedelta(hours=hours), window[1]), filters))
            sample = [e for e in sample if e["tool"] and slo_class(e["tool"], settings, catalog["tools"].get(e["tool"])) == kind]
            if not sample:
                return None
            return (sum(e["is_error"] for e in sample) / len(sample)) / (1 - target / 100)
        allowed = 1 - target / 100
        budget = None
        if rows:
            budget = min(100.0, max(0.0, one_decimal((1 - (errors / len(rows)) / allowed) * 100)))
        slo.append({
            "class": kind, "target": target,
            "success_rate": rate(len(rows) - errors, len(rows)),
            "error_budget_pct": budget,
            "burn_rate_1h": burn(1), "burn_rate_6h": burn(6),
        })
    handshakes = [e for e in events if e["type"] == "mcp.initialize"]
    known = any(isinstance(e["attrs"].get("is_error"), bool) for e in handshakes)
    durations = sorted(e["duration_ms"] for e in handshakes if isinstance(e["duration_ms"], int))
    kind_known = any(isinstance(e["attrs"].get("error_kind"), str) for e in calls)
    cancel_known = any(isinstance(e["attrs"].get("cancelled"), bool) for e in calls)
    timeouts = sum(1 for e in calls if e["attrs"].get("error_kind") == "timeout") if kind_known else None
    cancellations = sum(1 for e in calls if e["attrs"].get("cancelled") is True) if cancel_known else None
    codes = defaultdict(int)
    auth = defaultdict(int)
    for event in events:
        if isinstance(event["attrs"].get("error_code"), int):
            codes[(event["attrs"]["error_code"], event["attrs"].get("error_kind"))] += 1
        if event["type"] == "error" and event["attrs"].get("where") == "auth" and isinstance(event["attrs"].get("reason"), str):
            auth[event["attrs"]["reason"]] += 1
    hallucinated = [e for e in calls if e["attrs"].get("error_kind") == "unknown_tool" or (catalog["known"] and e["tool"] not in catalog["tools"])]
    sessions = {e["session_id"] for e in events if e["session_id"]}
    bad_sessions = {e["session_id"] for e in events if e["is_error"] and e["session_id"]}
    measured = any(isinstance(e["attrs"].get("output_bytes"), int) for e in calls)
    silent = sum(1 for e in calls if (not e["is_error"] and e["attrs"].get("output_bytes") == 0) or (e["attrs"].get("cancelled") is True and isinstance(e["attrs"].get("output_bytes"), int) and e["attrs"]["output_bytes"] > 0))
    return {
        "slo": slo,
        "handshake": {
            "attempts": len(handshakes),
            "success_rate": rate(sum(1 for e in handshakes if not e["is_error"]), len(handshakes)) if known else None,
            "p95": durations[max(0, math.ceil(len(durations) * 0.95) - 1)] if durations else None,
        },
        "timeouts": {"count": timeouts, "pct": None if timeouts is None else rate(timeouts, len(calls))},
        "cancellations": {"count": cancellations, "pct": None if cancellations is None else rate(cancellations, len(calls))},
        "error_codes": [{"code": code, "kind": kind, "count": count} for (code, kind), count in sorted(codes.items(), key=lambda item: (item[0][0], item[0][1] or ""))],
        "hallucinated_tools": {"count": len(hallucinated) if kind_known or catalog["known"] else None, "names": sorted({e["tool"] for e in hallucinated if e["tool"]})},
        "sessions_with_errors": {"count": len(bad_sessions), "pct": rate(len(bad_sessions), len(sessions))},
        "silent_failures": {"count": silent if measured else None},
        "auth_failures": [{"reason": reason, "count": count} for reason, count in sorted(auth.items())],
        "latency_over_time": latency_series_value(calls, window),
        "availability": None,
    }


def diff(path, expected, actual, count_int=False):
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            MISMATCHES.append({"path": path, "expected": expected, "actual": actual})
            return
        for key, value in expected.items():
            if key not in actual:
                MISMATCHES.append({"path": path + "." + key, "expected": value, "actual": "<missing>"})
            else:
                diff(path + "." + key, value, actual[key], count_int or key in ("calls", "count", "value", "prev", "new", "sessions", "attempts", "size", "advertised", "used"))
        return
    if isinstance(expected, list):
        if not isinstance(actual, list):
            MISMATCHES.append({"path": path, "expected": expected, "actual": actual})
            return
        if len(expected) != len(actual):
            MISMATCHES.append({"path": path + ".length", "expected": len(expected), "actual": len(actual), "expected_body": expected, "actual_body": actual})
            return
        for index, (exp, act) in enumerate(zip(expected, actual)):
            diff(f"{path}[{index}]", exp, act)
        return
    if expected is None or actual is None:
        if expected is not actual and not (expected is None and actual is None):
            MISMATCHES.append({"path": path, "expected": expected, "actual": actual})
        return
    if isinstance(expected, bool) or isinstance(actual, bool):
        if expected != actual:
            MISMATCHES.append({"path": path, "expected": expected, "actual": actual})
        return
    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        if count_int and (isinstance(expected, int) and not isinstance(actual, int)):
            MISMATCHES.append({"path": path, "expected": expected, "actual": actual, "note": "count type"})
        elif abs(float(expected) - float(actual)) > 1e-6:
            MISMATCHES.append({"path": path, "expected": expected, "actual": actual})
        return
    if isinstance(expected, str) and isinstance(actual, str) and "T" in expected and "T" in actual:
        try:
            if parse_ts(expected) == parse_ts(actual):
                return
        except (TypeError, ValueError):
            pass
    if expected != actual:
        MISMATCHES.append({"path": path, "expected": expected, "actual": actual})


REQUIRED = {
    "overview": ["range", "generated_at", "tiles", "calls_by_client", "funnel", "attention", "cohorts"],
    "adoption": ["range", "generated_at", "active", "clients", "protocol_versions", "transports", "retention", "funnel", "identity_quality"],
    "tools": ["range", "generated_at", "catalog", "tools", "paths"],
    "reliability": ["range", "generated_at", "slo", "handshake", "timeouts", "cancellations", "error_codes", "hallucinated_tools", "sessions_with_errors", "silent_failures", "auth_failures", "availability", "latency_over_time"],
    "cost": ["range", "generated_at", "total_tokens_est", "per_call", "estimated", "by_tool", "by_tenant", "payload_hist", "billing_periods"],
    "protocol": ["range", "generated_at", "capabilities", "sampling", "elicitation", "tasks", "progress"],
    "digest": ["range", "generated_at", "tools", "top_error_kinds", "new", "returning", "dead_tools", "changes"],
    "alerts": ["range", "generated_at", "rules"],
}


def require_keys(name, body):
    if not isinstance(body, dict):
        finding("blocker", "shape-" + name, f"response is not an object: {body}")
        return
    missing = [key for key in REQUIRED[name] if key not in body]
    if missing:
        finding("blocker", "shape-" + name, "missing keys " + ",".join(missing))
    for key in ("from", "to", "prev_from", "prev_to"):
        if not isinstance(body.get("range", {}).get(key), str):
            finding("blocker", "range-" + name, f"range.{key} missing")
            return
    if not isinstance(body.get("generated_at"), str):
        finding("blocker", "generated-" + name, "generated_at is not a string")


def window_of(body):
    rng = body["range"]
    return parse_ts(rng["from"]), parse_ts(rng["to"])


def compare_route(name, body, events, settings, filters):
    require_keys(name, body)
    if name in ("alerts",) or not isinstance(body, dict) or "range" not in body:
        return
    if name == "tools":
        for tool in body.get("tools", []):
            buckets = tool.get("latency", {}).get("buckets")
            if tool["calls"] == 0:
                if buckets is not None:
                    finding("blocker", "latency-empty", str(tool))
            elif not isinstance(buckets, dict) or len(buckets.get("edges", [])) != 61 or len(buckets.get("counts", [])) != 60 or buckets["edges"][-1] is not None or sum(buckets["counts"]) != tool["calls"] or any(type(n) is not int or n < 0 for n in buckets["counts"]):
                finding("blocker", "latency-buckets", str(tool))
    window = window_of(body)
    span = window[1] - window[0]
    prev_span = window[0] - parse_ts(body["range"]["prev_from"])
    if abs(span - prev_span) > timedelta(seconds=1):
        finding("blocker", "prev-window", f"{name} previous window {prev_span} != {span}")
    if name == "overview":
        diff("overview", expect_overview(events, window, filters, settings), {k: body[k] for k in ("tiles", "calls_by_client", "funnel", "attention", "cohorts") if k in body})
    elif name == "tools":
        expected, _ = expect_tools(events, window, filters, settings)
        actual = body
        # Compare tools by name so latency method replacement is visible in the objects.
        exp_tools = {row["tool"]: row for row in expected["tools"]}
        act_tools = {row.get("tool"): row for row in actual.get("tools") or []}
        if set(exp_tools) != set(act_tools):
            MISMATCHES.append({"path": "tools.set", "expected": sorted(exp_tools), "actual": sorted(a for a in act_tools if a)})
        for tool, exp in exp_tools.items():
            act = act_tools.get(tool)
            if act:
                exp = dict(exp)
                exp.pop("_errors_n", None)
                diff("tools." + tool, exp, {k: act.get(k) for k in exp})
        diff("tools.catalog", expected["catalog"], actual.get("catalog"), True)
        diff("tools.paths", expected["paths"], actual.get("paths"), True)
    elif name == "reliability":
        expected = expect_reliability(events, window, filters, settings)
        diff("reliability", expected, {k: body.get(k) for k in expected})
    elif name == "adoption":
        diff("adoption", expect_adoption(events, window, filters), {k: body[k] for k in REQUIRED["adoption"] if k not in ("range", "generated_at") and k in body})
        adoption_trend(body)
        client_shares(body)
    elif name == "cost":
        diff("cost", expect_cost(events, window, filters, settings), {k: body.get(k) for k in ("total_tokens_est", "per_call", "estimated", "by_tool", "by_tenant", "payload_hist", "billing_periods")})
    elif name == "protocol":
        diff("protocol", expect_protocol(events, window, filters), {k: body.get(k) for k in ("capabilities", "sampling", "elicitation", "tasks", "progress")})
    elif name == "digest":
        diff("digest", expect_digest(events, window, filters, settings), {k: body.get(k) for k in ("tools", "top_error_kinds", "new", "returning", "dead_tools", "changes")})


def client_shares(body):
    clients = body["clients"]
    total = sum(client["calls"] for client in clients)
    for client in clients:
        expected = rate(client["calls"], total)
        if client.get("pct") != expected:
            finding("blocker", "client-call-share", f"{client['name']}: {client.get('pct')} != {expected}")
    if total and abs(sum(client.get("pct") or 0 for client in clients) - 100) > 0.1000001:
        finding("blocker", "client-share-total", f"Shares do not sum to 100 ± 0.1: {clients}")


def adoption_trend(body):
    """The tiles draw sparklines from these per-bucket samples, so every bucket must
    carry them and the rolling counts must contain the bucket they end on."""
    points = body.get("active", {}).get("points")
    if not isinstance(points, list):
        finding("blocker", "adoption-points", f"active.points is {points}")
        return
    for point in points:
        for field in ("sessions", "wau", "mau"):
            if field not in point:
                finding("blocker", "adoption-trend", f"{point.get('t')} has no {field}")
            elif point[field] is not None and not isinstance(point[field], int):
                finding("blocker", "adoption-trend", f"{point.get('t')} {field} is {point[field]!r}")
        if isinstance(point.get("wau"), int) and point["wau"] < point["users"]:
            finding("blocker", "adoption-wau", f"{point['t']} wau {point['wau']} < users {point['users']}")
        if isinstance(point.get("mau"), int) and isinstance(point.get("wau"), int) and point["mau"] < point["wau"]:
            finding("blocker", "adoption-mau", f"{point['t']} mau {point['mau']} < wau {point['wau']}")


def expect_adoption(all_events, window, filters):
    events = selected(all_events, window, filters)
    first = first_seen_map(all_events)
    days = defaultdict(list)
    for event in events:
        days[event["ts"].date()].append(event)
    def active_between(lo, hi):
        rows = selected(all_events, (lo, hi), filters)
        return len({e["identity"] for e in rows if e["identity"]})
    # A session belongs to the bucket holding its first selected event, so the
    # per-bucket counts sum to the overview sessions tile.
    session_day = {}
    for event in events:
        if event["session_id"] and event["session_id"] not in session_day:
            session_day[event["session_id"]] = event["ts"].date()
    started = defaultdict(int)
    for day in session_day.values():
        started[day] += 1
    points = []
    for day, rows in sorted(days.items()):
        ids = {e["identity"] for e in rows if e["identity"]}
        new = sum(1 for ident in ids if first.get(ident) and first[ident].date() == day)
        # Rolling counts end at the bucket end, clamped to the window end.
        end = min(datetime.combine(day + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc), window[1])
        points.append({"t": day.isoformat(), "users": len(ids),
                       "sessions": started[day] if session_day else None,
                       "wau": active_between(end - timedelta(days=7), end),
                       "mau": active_between(end - timedelta(days=30), end),
                       "new": new, "returning": len(ids) - new, "by_kind": by_kind(rows)})
    def active(days_back):
        return active_between(window[1] - timedelta(days=days_back), window[1])
    clients = {}
    protocols = defaultdict(set)
    transports = defaultdict(set)
    total_calls = len(calls_of(events))
    for event in events:
        key = (event["client_name"], event["client_version"])
        row = clients.setdefault(key, [set(), 0, set()])
        row[1] += int(event["type"] == "tool.called")
        if event["session_id"]:
            row[0].add(event["session_id"])
            protocol = event["protocol"] or event["attrs"].get("requested_protocol_version")
            if protocol:
                protocols[protocol].add(event["session_id"])
            if event["transport"]:
                transports[event["transport"]].add(event["session_id"])
        for cap in event["attrs"].get("client_capabilities") or []:
            if isinstance(cap, str):
                row[2].add(cap)
    steps, _ = funnel(events, window, first)
    previous = None
    for step in steps:
        count = step["count"]
        step["dropoff_pct"] = None if count is None else (0.0 if previous is None else rate(max(previous - count, 0), previous))
        previous = count
    return {
        "active": {"bucket": "day", "points": points, "dau": active(1), "wau": active(7), "mau": active(30)},
        "clients": sorted([
            {"name": name, "version": version, "sessions": len(sessions), "calls": calls, "pct": rate(calls, total_calls), "capabilities": sorted(caps)}
            for (name, version), (sessions, calls, caps) in clients.items()
        ], key=lambda row: ((row["name"] or ""), (row["version"] or ""))),
        "protocol_versions": sorted([{"version": version, "sessions": len(sessions)} for version, sessions in protocols.items()], key=lambda row: row["version"]),
        "transports": sorted([{"transport": transport, "sessions": len(sessions)} for transport, sessions in transports.items()], key=lambda row: row["transport"]),
        "retention": {"daily": {"d1": retention(all_events, window, events, first, 1), "d7": retention(all_events, window, events, first, 7), "d30": retention(all_events, window, events, first, 30)}, "weekly": cohorts(all_events, window, filters, first)},
        "funnel": {"steps": steps},
        "identity_quality": by_kind(events),
    }


def expect_cost(all_events, window, filters, settings):
    events = selected(all_events, window, filters)
    calls = calls_of(events)
    divisor = divisor_of(settings)
    tokens = token_total(calls, divisor)
    tools = defaultdict(list)
    tenants = defaultdict(list)
    periods = defaultdict(list)
    for event in calls:
        if event["tool"]:
            tools[event["tool"]].append(event)
        if event["identity"]:
            tenants[event["identity"]].append(event)
            periods[(event["ts"].strftime("%Y-%m"), event["identity"][1])].append(event)
    def pct(part):
        if part is None or tokens in (None, 0):
            return None
        return rate(part, tokens)
    return {
        "total_tokens_est": tokens,
        "per_call": None if tokens is None or not calls else half_away(tokens / len(calls)),
        "estimated": True,
        "by_tool": [{"tool": tool, "calls": len(rows), "tokens": token_total(rows, divisor), "pct": pct(token_total(rows, divisor))} for tool, rows in sorted(tools.items())],
        "by_tenant": [{"caller": ident[1], "identity_kind": ident[0], "calls": len(rows), "tokens": token_total(rows, divisor)} for ident, rows in sorted(tenants.items())],
        "payload_hist": {"buckets": ["<1K", "1-4K", "4-16K", "16-64K", ">64K"], "input": payload_hist(calls, "input_bytes"), "output": payload_hist(calls, "output_bytes")},
        "billing_periods": [{"period": period, "caller": caller, "calls": len(rows), "tokens": token_total(rows, divisor)} for (period, caller), rows in sorted(periods.items())],
    }


def expect_protocol(all_events, window, filters):
    events = selected(all_events, window, filters)
    sessions = {e["session_id"] for e in events if e["session_id"]}
    def caps(side):
        found = defaultdict(set)
        for event in events:
            if not event["session_id"]:
                continue
            for name in event["attrs"].get(side) or []:
                if isinstance(name, str):
                    found[name].add(event["session_id"])
        return [{"name": name, "sessions": len(rows), "pct": rate(len(rows), len(sessions))} for name, rows in sorted(found.items())]
    return {
        "capabilities": {"sessions": len(sessions), "client": caps("client_capabilities"), "server": caps("server_capabilities")},
        "sampling": {"requests": None, "p95": None, "rejected_pct": None, "by_model": []},
        "elicitation": {"requests": None, "accept_pct": None, "decline_pct": None, "cancel_pct": None},
        "tasks": {"created": None, "completed": None, "failed": None, "cancelled": None},
        "progress": {"long_calls": None, "with_progress_pct": None},
    }


def expect_digest(all_events, window, filters, settings):
    events = selected(all_events, window, filters)
    calls = calls_of(events)
    first = first_seen_map(all_events)
    ids = {e["identity"] for e in events if e["identity"]}
    new = sum(1 for ident in ids if window[0] <= first.get(ident, window[1]) < window[1])
    current, _ = expect_tools(all_events, window, filters, settings)
    previous, _ = expect_tools(all_events, (window[0] - (window[1] - window[0]), window[0]), filters, settings)
    prev_by = {row["tool"]: row for row in previous["tools"]}
    tools = []
    for row in current["tools"]:
        prev_calls = prev_by.get(row["tool"], {}).get("calls", 0)
        tools.append({
            "tool": row["tool"], "calls": row["calls"], "prev": prev_calls,
            "delta_pct": None if prev_calls <= 0 else one_decimal((row["calls"] - prev_calls) / prev_calls * 100),
            "success_rate": row["success_rate"], "p95": row["latency"]["p95"], "errors": row["errors"],
        })
    return {
        "tools": tools,
        "top_error_kinds": error_kinds(calls),
        "new": new,
        "returning": len(ids) - new,
        "dead_tools": current["catalog"]["dead"],
        "changes": [
            f"{len(calls)} tool calls, compared with {len(calls_of(selected(all_events, (window[0] - (window[1] - window[0]), window[0]), filters)))} in the previous week.",
            f"{new} new identities and {len(ids) - new} returning identities.",
        ],
    }


def wait_watermark(after, timeout=180):
    deadline = time.time() + timeout
    while time.time() < deadline:
        stamp = psql("SELECT received_at_watermark FROM rollup_cursor WHERE name='analytics'")
        if stamp and parse_ts(stamp) >= after:
            return parse_ts(stamp)
        time.sleep(2)
    finding("blocker", "rollup-watermark", f"analytics cursor did not pass {after}")
    return None


def snapshot(project):
    return psql(
        "SELECT jsonb_build_object("
        f"'hourly',(SELECT coalesce(jsonb_agg(jsonb_build_object('hour',hour,'tool',tool,'is_project',is_project,'metrics',metrics) ORDER BY hour,tool,is_project),'[]'::jsonb) FROM analytics_hourly WHERE project_id='{project}'),"
        f"'daily',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY day),'[]'::jsonb) FROM analytics_daily r WHERE project_id='{project}'),"
        f"'paths',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY day,sequence),'[]'::jsonb) FROM analytics_paths r WHERE project_id='{project}'),"
        f"'identity',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY day,kind,identity_key),'[]'::jsonb) FROM analytics_identity_daily r WHERE project_id='{project}')"
        ")"
    )


def executed_event_scans(node):
    """Ignore empty or runtime-pruned partitions; flag actual event row scans."""
    scans = []
    if (node.get("Node Type") == "Seq Scan"
            and node.get("Relation Name", "").startswith("events")
            and node.get("Actual Loops", 0) > 0
            and node.get("Actual Rows", 0) + node.get("Rows Removed by Filter", 0) > 0):
        scans.append(node["Relation Name"])
    for child in node.get("Plans", []):
        scans.extend(executed_event_scans(child))
    return scans


def percentile_bound(events, body):
    calls = calls_of(events)
    durations = [e["duration_ms"] for e in calls if isinstance(e["duration_ms"], int) and e["duration_ms"] > 0]
    if not durations or "tiles" not in body:
        return
    exact = exact_percentile(sorted(durations), 0.95)
    reported = body["tiles"]["latency"]["p95"]
    if exact and reported is not None and abs(reported - exact) / exact >= 0.26:
        finding("blocker", "percentile-bound", f"p95 {reported} differs from exact {exact} by >= 26%")


def e2e_catalogue_progress_probe(client, tenant_id):
    project = client.admin("projects", {"tenant_id": tenant_id, "slug": "e2e-regression", "name": "E2E regression"})["id"]
    key = client.admin("keys", {"project_id": project, "label": "e2e", "scopes": ["ingest", "read"]})["secret"]
    stamp = datetime.now(timezone.utc) - timedelta(minutes=2)

    def send(kind, attrs):
        nonlocal stamp
        if kind == "tool.called":
            attrs = {"input_bytes": 1, "output_bytes": 1, "output_kinds": ["text"], "cancelled": False, "is_error": False, **attrs}
        stamp += timedelta(seconds=1)
        status, body, _ = client.request("POST", "/v1/events", {
            "schema_version": 1, "sent_at": fmt(datetime.now(timezone.utc)),
            "source": {"sdk": "node", "sdk_version": "1", "server_name": "review", "server_version": "1", "instance_id": "e2e"},
            "events": [{"id": uuid7(), "ts": fmt(stamp), "type": kind, "attrs": attrs}],
        }, key=key)
        if status != 202 or body.get("accepted") != 1:
            finding("blocker", "e2e-ingest", f"{status} {body}")

    def get(route):
        status, body, _ = client.request("GET", f"/v1/projects/{project}/analytics/{route}?range=24h", key=key)
        if status != 200:
            finding("blocker", "e2e-route", f"{route}: {status} {body}")
        return body

    def expect(label, actual, expected):
        if actual != expected:
            finding("blocker", "e2e-" + label, f"expected {expected}, got {actual}")

    send("tool.called", {"tool": "known", "duration_ms": 2000, "is_error": True, "error_kind": "unknown_tool"})
    send("tool.called", {"tool": "outside", "duration_ms": 3000, "is_error": True})
    tools = get("tools")
    expect("uncatalogued", tools["catalog"]["known"], False)
    expect("uncatalogued-rows", sorted(t["tool"] for t in tools["tools"]), ["known", "outside"])
    expect("progress-waiting", get("protocol")["progress"], {"long_calls": None, "with_progress_pct": None})
    send("tools.listed", {"tools": [{"name": "known"}, {"name": "dead"}], "count": 2})
    tools = get("tools")
    expect("complete", tools["catalog"].get("complete"), True)
    expect("catalogue-rows", sorted(t["tool"] for t in tools["tools"]), ["dead", "known"])
    expect("used", tools["catalog"]["used"], 1)
    expect("dead", tools["catalog"]["dead"], ["dead"])
    expect("attention", sorted(t["tool"] for t in get("overview")["attention"]), ["dead", "known"])
    expect("hallucinations", get("reliability")["hallucinated_tools"], {"count": 2, "names": ["known", "outside"]})
    send("tools.listed", {"tools": [{"name": "known"}], "count": 10, "truncated": True})
    tools = get("tools")
    expect("truncated-complete", tools["catalog"].get("complete"), False)
    expect("truncated-dead", tools["catalog"]["dead"], None)
    expect("truncated-rows", sorted(t["tool"] for t in tools["tools"]), ["known", "outside"])
    expect("truncated-attention", sorted(t["tool"] for t in get("overview")["attention"]), ["known", "outside"])
    expect("truncated-hallucinations", get("reliability")["hallucinated_tools"], {"count": 1, "names": ["known"]})
    send("tool.called", {"tool": "known", "duration_ms": 2000, "progress_events": 0})
    expect("progress-opt-in", get("protocol")["progress"], {"long_calls": 3, "with_progress_pct": 0.0})
    print("E2E catalogue/progress assertions complete")


def main():
    wait_ready()
    client = Client()
    now = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(seconds=2)
    events, anchors = build(now)
    print(f"generated {len(events)} events")
    tenant = client.admin("tenants", {"slug": "review-r1-" + uuid.uuid4().hex[:8], "name": "Review"})
    tenant_id = tenant["id"]
    project = client.admin("projects", {"tenant_id": tenant_id, "slug": "analytics", "name": "Analytics"})
    project_id = project["id"]
    key = client.admin("keys", {"project_id": project_id, "label": "review", "scopes": ["ingest", "read"]})["secret"]
    psql(f"UPDATE projects SET rate_events_per_min=1000000, rate_bytes_per_min=1073741824, retention_days=90 WHERE id='{project_id}'")
    user_email = f"owner-{uuid.uuid4().hex[:8]}@review.test"
    client.admin("users", {"tenant_id": tenant_id, "email": user_email, "password": "review-owner-password", "role": "owner"})
    viewer_email = f"viewer-{uuid.uuid4().hex[:8]}@review.test"
    client.admin("users", {"tenant_id": tenant_id, "email": viewer_email, "password": "review-viewer-password", "role": "viewer"})

    e2e_catalogue_progress_probe(client, tenant_id)

    # Wire acceptance on its own project so an empty tools.listed cannot replace the dataset catalogue.
    wire = client.admin("projects", {"tenant_id": tenant_id, "slug": "wire", "name": "Wire"})
    wire_key = client.admin("keys", {"project_id": wire["id"], "label": "wire", "scopes": ["ingest"]})["secret"]
    bad = client.request("POST", "/v1/events", {
        "schema_version": 1, "sent_at": fmt(datetime.now(timezone.utc)),
        "source": {"sdk": "node", "sdk_version": "1", "server_name": "review", "server_version": "1", "instance_id": "bad"},
        "events": [
            {"id": uuid7(), "ts": fmt(now - timedelta(minutes=1)), "type": "tools.listed", "attrs": {"future_optional": True, "tools": []}},
            {"id": uuid7(), "ts": fmt(now - timedelta(minutes=1)), "type": "sampling.created", "attrs": {}},
            {"id": uuid7(), "ts": fmt(now - timedelta(minutes=1)), "type": "sampling.requested", "attrs": {}, "caller": {"subject_kind": "invalid-kind"}},
            {"id": uuid7(), "ts": fmt(now - timedelta(minutes=1)), "type": "tool.called", "attrs": {"tool": "get_product", "duration_ms": 1, "is_error": False, "input_bytes": 1, "output_bytes": 1, "output_kinds": ["text"], "cancelled": False}, "caller": {"subject": "x", "subject_kind": "oauth"}},
        ],
    }, wire_key)
    reasons = [item.get("reason") for item in (bad[1] or {}).get("rejected") or []]
    print("rejection probe", bad[0], reasons)
    if bad[0] != 202 or (bad[1] or {}).get("accepted") != 2 or reasons != ["unknown_type", "schema"]:
        finding("blocker", "wire-acceptance", f"expected tools.listed/OAuth caller accepted and unknown_type/invalid caller schema rejected, got {bad[0]} {bad[1]}")

    accepted, rejected = ingest(client, key, events)
    print(f"accepted {accepted} rejected batches {len(rejected)}")
    if rejected:
        finding("blocker", "ingest", "synthetic events rejected: " + json.dumps(rejected[:2])[:1500])
    attach_hashes(project_id, events)
    kinds = by_kind(events)
    print("identities", kinds, "distinct", len({e['identity'] for e in events if e['identity']}))
    if kinds["strong"] < 1 or kinds["key"] < 1 or kinds["network"] < 1:
        finding("blocker", "identity-kinds", f"dataset identities did not resolve to all three kinds: {kinds}")
    both = [e for e in events if e["caller"].get("subject") and e["caller"].get("key_id")]
    if any(e["identity"] != ("strong", e["caller"]["subject"]) for e in both):
        finding("blocker", "identity-precedence", "subject plus key_id did not count as strong")

    received = parse_ts(psql(f"SELECT max(received_at) FROM events WHERE project_id='{project_id}'"))
    print("waiting for rollup past", received)
    wait_watermark(received)
    before = snapshot(project_id)
    # A second worker cycle must not change aggregates.
    time.sleep(5)
    later = parse_ts(psql("SELECT received_at_watermark FROM rollup_cursor WHERE name='analytics'"))
    wait_watermark(later + timedelta(seconds=1), timeout=150)
    after = snapshot(project_id)
    if before != after:
        finding("blocker", "rollup-idempotence", "second analytics rollup changed hourly, daily, path, or identity aggregates")
    else:
        print("rollup idempotence ok")

    cursor_before = psql("SELECT received_at_watermark FROM rollup_cursor WHERE name='analytics'")
    snap_before_restart = before
    restart_server()
    cursor_after = psql("SELECT received_at_watermark FROM rollup_cursor WHERE name='analytics'")
    snap_after_restart = snapshot(project_id)
    if snap_before_restart != snap_after_restart:
        finding("blocker", "rollup-restart", "restart rollup changed stored aggregates with no new events")
    else:
        print("restart aggregates stable")
    if parse_ts(cursor_after) < parse_ts(cursor_before):
        finding("blocker", "cursor-restart", f"cursor moved backwards {cursor_before} -> {cursor_after}")
    print("cursor", cursor_before, "->", cursor_after)

    # Late event inside retention, timestamp in an earlier populated hour.
    late_ts = anchors["old"] + timedelta(minutes=12)
    late_event = {
        "id": uuid7(), "ts": late_ts, "type": "tool.called", "session_id": "s-late-arrival",
        "client_name": "Claude", "client_version": "1.2.0", "protocol": "2025-11-25",
        "caller": {"subject": "user-strong-00"}, "identity": ("strong", "user-strong-00"),
        "tool": "list_orders", "duration_ms": 77, "is_error": False, "transport": None,
        "attrs": {"tool": "list_orders", "duration_ms": 77, "is_error": False, "input_bytes": 5, "output_bytes": 9, "output_kinds": ["text"], "cancelled": False, "output_chars": 4},
    }
    hour = late_ts.replace(minute=0, second=0, microsecond=0)
    hour_before = psql(f"SELECT coalesce(metrics->>'calls','0') FROM analytics_hourly WHERE project_id='{project_id}' AND is_project AND hour='{fmt(hour)}'")
    status, payload, _ = client.request("POST", "/v1/events", {
        "schema_version": 1, "sent_at": fmt(datetime.now(timezone.utc)),
        "source": {"sdk": "python", "sdk_version": "1", "server_name": "review", "server_version": "1", "instance_id": "late"},
        "events": [wire_event(late_event)],
    }, key)
    print("late ingest", status, payload)
    if status != 202 or payload.get("rejected"):
        finding("blocker", "late-ingest", f"late event rejected {status} {payload}")
    else:
        events.append(late_event)
        events.sort(key=lambda e: (e["ts"], e["id"]))
        late_received = parse_ts(psql(f"SELECT max(received_at) FROM events WHERE project_id='{project_id}'"))
        wait_watermark(late_received)
        hour_after = psql(f"SELECT coalesce(metrics->>'calls','0') FROM analytics_hourly WHERE project_id='{project_id}' AND is_project AND hour='{fmt(hour)}'")
        print("late hour", hour, hour_before, "->", hour_after)
        if int(hour_after or 0) != int(hour_before or 0) + 1:
            finding("blocker", "late-bucket", f"late event did not land in {hour}: {hour_before} -> {hour_after}")

    settings = {}
    base = f"/v1/projects/{project_id}/analytics"
    ranges = ["24h", "7d", "30d", "90d"]
    explicit_from = anchors["heavy_c"] - timedelta(minutes=5)
    explicit_to = explicit_from + timedelta(hours=5)
    queries = [(f"?range={item}", {}) for item in ranges]
    queries.append((f"?from={fmt(explicit_from)}&to={fmt(explicit_to)}", {}))
    queries.append((f"?from={fmt(anchors['old'])}&to={fmt(now)}&client=Claude", {"client": "Claude"}))
    queries.append((f"?from={fmt(anchors['old'])}&to={fmt(now)}&tool=get_product", {"tool": "get_product"}))
    queries.append((f"?from={fmt(anchors['old'])}&to={fmt(now)}&caller=user-strong-00", {"caller": "user-strong-00"}))
    queries.append((f"?from={fmt(anchors['old'])}&to={fmt(now)}&transport=stdio", {"transport": "stdio"}))
    for name in ("overview", "adoption", "tools", "reliability", "cost", "protocol", "digest"):
        for query, filters in queries:
            if name == "digest" and "range=" in query:
                continue
            status, body, _ = client.request("GET", f"{base}/{name}{query}", key=key)
            if status != 200:
                finding("blocker", "route-" + name, f"{query} returned {status} {body}")
                continue
            before_len = len(MISMATCHES)
            compare_route(name, body, events, settings, filters)
            if len(MISMATCHES) != before_len:
                print(f"mismatches after {name}{query}: {len(MISMATCHES) - before_len}")
                for item in MISMATCHES[before_len:before_len + 6]:
                    shown = {k: item[k] for k in item if k not in ("expected_body", "actual_body")}
                    print(" MISMATCH", json.dumps(shown, default=str)[:500])
            if name == "overview" and not filters and "range=30d" in query:
                percentile_bound(selected(events, window_of(body), {}), body)
            if name == "overview" and not filters and query.startswith("?from="):
                method = body.get("tiles", {}).get("latency", {}).get("method")
                span = window_of(body)
                print("explicit overview method", method, "span", span[1] - span[0])
                if span[1] - span[0] < timedelta(hours=6) and method != "exact":
                    finding("blocker", "exact-window", f"sub-6h window method is {method}")
    # The per-bucket session counts are what the Overview sessions tile draws as its
    # sparkline, so they must add up to the tile they sit under in every window and
    # under every filter.
    for query, _ in queries:
        adoption_status, adoption_body, _ = client.request("GET", f"{base}/adoption{query}", key=key)
        overview_status, overview_body, _ = client.request("GET", f"{base}/overview{query}", key=key)
        if adoption_status != 200 or overview_status != 200:
            finding("blocker", "sessions-sum", f"{query} returned {adoption_status}/{overview_status}")
            continue
        total = sum(point.get("sessions") or 0 for point in adoption_body["active"]["points"])
        tile = overview_body["tiles"]["sessions"]["value"]
        print("sessions sum", query, total, "tile", tile)
        if total != tile:
            finding("blocker", "sessions-sum", f"{query} per-bucket sessions {total} != sessions tile {tile}")

    # Six-hour window is not exact.
    six_from = anchors["heavy_c"] - timedelta(minutes=1)
    status, body, _ = client.request("GET", f"{base}/overview?from={fmt(six_from)}&to={fmt(six_from + timedelta(hours=6))}", key=key)
    if status == 200 and body.get("tiles", {}).get("latency", {}).get("method") == "exact":
        finding("blocker", "histogram-window", "a 6h window used method exact; contract says under 6h")

    # Empty historical window: measured counts are 0, uncomputable rates are null.
    status, empty, _ = client.request("GET", f"{base}/overview?from=2026-08-01T00:00:00Z&to=2026-08-02T00:00:00Z", key=key)
    if status == 200:
        tiles = empty["tiles"]
        if tiles["success_rate"]["value"] not in (None,):
            finding("blocker", "null-success", f"empty window success_rate is {tiles['success_rate']['value']}")
        if tiles["context_tokens"]["value"] not in (None,):
            finding("blocker", "null-tokens", f"empty window tokens are {tiles['context_tokens']['value']}")
        if tiles["tool_calls"]["value"] != 0:
            finding("blocker", "empty-calls", f"empty window calls are {tiles['tool_calls']['value']}")
        if tiles["latency"]["p95"] not in (None,):
            finding("blocker", "null-latency", f"empty window p95 is {tiles['latency']['p95']}")
        funnel_day7 = next(step["count"] for step in empty["funnel"] if step["step"] == "returned_day_7")
        print("empty returned_day_7", funnel_day7, "catalog known", end=" ")
    status, tools_empty, _ = client.request("GET", f"{base}/tools?from=2026-08-01T00:00:00Z&to=2026-08-02T00:00:00Z", key=key)
    if status == 200:
        print("empty-window catalog", tools_empty.get("catalog"))

    # returned_day_7 on 24h is not observable.
    status, day, _ = client.request("GET", f"{base}/overview?range=24h", key=key)
    if status == 200:
        count = next(step["count"] for step in day["funnel"] if step["step"] == "returned_day_7")
        connected = next(step["count"] for step in day["funnel"] if step["step"] == "connected")
        print("24h funnel connected", connected, "returned_day_7", count)
        if connected and count == 0:
            finding("blocker", "returned-day-7-zero", "24h funnel returned_day_7 is 0 while no identity first seen in the window is 7 days old; contract says null when the figure is not computable")

    # Filter must change the used set. Dead follows calls inside the filtered set.
    status, filtered, _ = client.request("GET", f"{base}/tools?from={fmt(anchors['old'])}&to={fmt(now)}&client=Zed", key=key)
    status_u, unfiltered, _ = client.request("GET", f"{base}/tools?from={fmt(anchors['old'])}&to={fmt(now)}", key=key)
    if status == 200 and status_u == 200:
        if filtered["catalog"]["used"] == unfiltered["catalog"]["used"]:
            finding("blocker", "filter-ignored", "client=Zed did not change tools.used")
        print("zed dead", filtered["catalog"]["dead"], "used", filtered["catalog"]["used"], "unfiltered used", unfiltered["catalog"]["used"])
        lookup_rows = [row for row in filtered["tools"] if row["tool"] == "lookup_sku"]
        if not lookup_rows:
            finding("blocker", "filter-missing-tool", "client=Zed tools response omitted lookup_sku; tools=" + ",".join(row["tool"] for row in filtered["tools"]))
        else:
            lookup = lookup_rows[0]
            if lookup["errors"]["protocol"] not in (None,):
                finding("blocker", "null-error-kind", f"lookup_sku errors.protocol is {lookup['errors']['protocol']} without error_kind")
            if lookup["errors"]["timeout"] == 0:
                finding("blocker", "zero-error-kind", "errors.timeout is 0 where the contract says null until error_kind is present")

    # D1 eligibility versus a completed anniversary day.
    status, adoption, _ = client.request("GET", f"{base}/adoption?from={fmt(now - timedelta(days=4))}&to={fmt(now)}", key=key)
    if status == 200:
        window = window_of(adoption)
        first = first_seen_map(events)
        observed = adoption["retention"]["daily"]["d1"]
        code_like = retention(events, window, selected(events, window, {}), first, 1)
        calendar, eligible = calendar_retention(window, selected(events, window, {}), first, 1)
        print("d1 api", observed, "expected", code_like, "anniversary-ended", calendar, "eligible", eligible)
        if observed != calendar:
            finding("should-fix", "d1-eligibility", f"D1 is {observed}. Identities whose UTC anniversary day has fully ended are still excluded until the same clock time two days later, so a missed return is omitted. Anniversary-ended D1 would be {calendar}; timestamp-cutoff D1 is {code_like}.")

    # Timeline for the crafted retry session.
    retry_sessions = sorted({e["session_id"] for e in events if e["session_id"] and e["session_id"].startswith("s-strong-00") and e["ts"] == anchors["old"] or (e["session_id"] or "").startswith("s-strong-00-") and e["ts"] <= anchors["old"] + timedelta(hours=2)})
    session_id = next(e["session_id"] for e in events if e["type"] == "session.started" and e["identity"] == ("strong", "user-strong-00") and e["ts"] == anchors["old"])
    status, timeline, _ = client.request("GET", f"{base}/sessions/{session_id}/timeline?from={fmt(anchors['old'] - timedelta(minutes=1))}&to={fmt(anchors['old'] + timedelta(hours=3))}".replace("/analytics/sessions", f"/v1/projects/{project_id}/analytics/sessions") if False else f"{base}/sessions/{session_id}/timeline?from={fmt(anchors['old'] - timedelta(minutes=1))}&to={fmt(anchors['old'] + timedelta(hours=3))}", key=key)
    if status != 200:
        finding("blocker", "timeline", f"{session_id} returned {status} {timeline}")
    else:
        require_session = ["session_id", "client", "identity", "transport", "reason", "duration_ms"]
        missing = [key for key in require_session if key not in timeline.get("session", {})]
        if missing:
            finding("blocker", "timeline-header", "missing " + ",".join(missing))
        if timeline["session"].get("identity", {}).get("kind") != "strong":
            finding("blocker", "timeline-identity", f"strong subject rendered as {timeline['session'].get('identity')}")
        rows = [e for e in events if e["session_id"] == session_id and anchors["old"] - timedelta(minutes=1) <= e["ts"] < anchors["old"] + timedelta(hours=3)]
        if len(timeline["events"]) != len(rows):
            finding("blocker", "timeline-count", f"expected {len(rows)} events, got {len(timeline['events'])}")
        start = next(e["ts"] for e in rows if e["type"] == "session.started")
        for actual, exp in zip(timeline["events"], rows):
            offset = int((exp["ts"] - start).total_seconds() * 1000)
            if actual.get("offset_ms") != offset:
                finding("blocker", "timeline-offset", f"{exp['type']} offset {actual.get('offset_ms')} != {offset}")
                break
            for field in ("type", "is_error"):
                if actual.get(field) != exp[field] and not (field == "is_error" and actual.get(field) == exp["is_error"]):
                    finding("blocker", "timeline-field", f"{field} {actual.get(field)} != {exp[field]}")
                    break
        hashed = next((e for e in timeline["events"] if e.get("args_hash")), None)
        if hashed:
            stored = psql(f"SELECT attrs->'args' FROM events WHERE project_id='{project_id}' AND id='{hashed['id']}'")
            parsed = json.loads(stored)
            digest = hashlib.sha256(json.dumps(parsed, separators=(",", ":")).encode()).hexdigest()
            if hashed["args_hash"] != digest:
                finding("blocker", "args-hash", f"timeline hash {hashed['args_hash']} != sha256 of stored args {digest} ({stored})")
        else:
            finding("blocker", "args-hash", "no timeline event carried args_hash")

    # Invalid filters.
    for query in ("?nope=1", "?range=1d", "?from=" + fmt(now), "?range=7d&from=" + fmt(now) + "&to=" + fmt(now), "?client=", "?week=2026-W01"):
        status, body, _ = client.request("GET", f"{base}/overview{query}", key=key)
        if status != 400 or not isinstance(body, dict) or body.get("error") != "invalid_filter":
            finding("blocker", "invalid-filter", f"{query} -> {status} {body}")
    status, body, _ = client.request("GET", f"{base}/digest?week=2026-W99", key=key)
    if status != 400 or body.get("error") != "invalid_filter":
        finding("blocker", "invalid-week", f"bad week -> {status} {body}")
    week = anchors["heavy_c"].strftime("%G-W%V")
    status, body, _ = client.request("GET", f"{base}/digest?week={week}", key=key)
    if status != 200:
        finding("blocker", "digest-week", f"{week} -> {status} {body}")
    else:
        compare_route("digest", body, events, settings, {})

    # Replay does not double counts.
    calls_before = psql(f"SELECT count(*) FROM analytics_facts WHERE project_id='{project_id}' AND type='tool.called'")
    first = next(e for e in events if e["type"] == "tool.called")
    status, payload, _ = client.request("POST", "/v1/events", {
        "schema_version": 1, "sent_at": fmt(datetime.now(timezone.utc)),
        "source": {"sdk": "node", "sdk_version": "1", "server_name": "review", "server_version": "1", "instance_id": "replay"},
        "events": [wire_event(first)],
    }, key)
    calls_after = psql(f"SELECT count(*) FROM analytics_facts WHERE project_id='{project_id}' AND type='tool.called'")
    if calls_before != calls_after:
        finding("blocker", "replay", f"replay changed fact count {calls_before} -> {calls_after} ({status} {payload})")

    # Settings round-trip and validation. Owner session, not the ingest key.
    status, _, headers = client.request("POST", "/v1/auth/login", {"email": user_email, "password": "review-owner-password"})
    cookie = headers.get("Set-Cookie") or headers.get("set-cookie")
    if status != 200 or not cookie:
        finding("blocker", "login", f"owner login failed {status}")
    else:
        client.cookie = cookie.split(";", 1)[0]
        invalids = [
            {"slo_classes": {"get_product": "write"}},
            {"slo_targets": {"read": 100}},
            {"slo_targets": {"read": 0}},
            {"token_divisor": 0},
            {"token_divisor": -1},
            {"token_divisor": 1001},
            {"digest": {"enabled": "yes"}},
            {"digest": {"recipient": "not-an-email"}},
            {"alerts": [{"id": "nope", "enabled": True}]},
            {"not_a_setting": 1},
            {"probe_url": "ftp://example.com"},
            {"probe_url": "http://user:pass@127.0.0.1/mcp"},
        ]
        for body in invalids:
            status, payload, _ = client.request("PATCH", f"/v1/projects/{project_id}", body)
            if status != 400:
                finding("blocker", "settings-validation", f"{body} -> {status} {payload}")
            elif not isinstance(payload, dict) or payload.get("error") != "invalid_settings" or not isinstance(payload.get("message"), str):
                finding("blocker", "settings-error-shape", f"{body} -> {payload}")
        status, saved, _ = client.request("PATCH", f"/v1/projects/{project_id}", {
            "slo_classes": {"get_product": "mutate"},
            "slo_targets": {"read": 99.0, "mutate": 97.5},
            "token_divisor": 2,
            "digest": {"enabled": True, "recipient": "owner@review.test", "webhook_url": None},
            "probe_url": None,
        })
        if status != 200 or saved.get("token_divisor") != 2 or saved.get("slo_classes", {}).get("get_product") != "mutate" or saved.get("digest", {}).get("recipient") != "owner@review.test":
            finding("blocker", "settings-persist", f"PATCH -> {status} {saved}")
        if isinstance(saved, dict) and "probe_key" in saved:
            finding("blocker", "probe-key-leak", "PATCH response includes probe_key")
        status, tools, _ = client.request("GET", f"{base}/tools?from={fmt(anchors['old'])}&to={fmt(now)}", key=key)
        product = next(row for row in tools["tools"] if row["tool"] == "get_product")
        if product["slo_class"] != "mutate":
            finding("blocker", "slo-override", f"get_product class is {product['slo_class']} after PATCH mutate")
        admin_tool = next(row for row in tools["tools"] if row["tool"] == "get_admin")
        thing = next(row for row in tools["tools"] if row["tool"] == "Get_Thing")
        lookup = next(row for row in tools["tools"] if row["tool"] == "lookup_sku")
        flight = next(row for row in tools["tools"] if row["tool"] == "book_flight")
        print("classes", product["slo_class"], admin_tool["slo_class"], thing["slo_class"], lookup["slo_class"], flight["slo_class"])
        if admin_tool["slo_class"] != "mutate":
            finding("blocker", "slo-annotation", f"destructive get_admin class is {admin_tool['slo_class']}")
        if thing["slo_class"] != "mutate":
            finding("blocker", "slo-heuristic-case", f"Get_Thing class is {thing['slo_class']}")
        if lookup["slo_class"] != "read" or flight["slo_class"] != "mutate":
            finding("blocker", "slo-heuristic", f"lookup {lookup['slo_class']} flight {flight['slo_class']}")
        # Token divisor 2 should double the previous divisor-4 total on the same window.
        status, cost, _ = client.request("GET", f"{base}/cost?from={fmt(anchors['old'])}&to={fmt(now)}", key=key)
        expected_tokens = token_total(calls_of(selected(events, (anchors["old"], now), {})), 2)
        if cost.get("total_tokens_est") != expected_tokens or cost.get("estimated") is not True:
            finding("blocker", "token-divisor", f"cost tokens {cost.get('total_tokens_est')} estimated {cost.get('estimated')} != {expected_tokens}")
        # API key cannot change settings.
        bare = Client()
        status, payload, _ = bare.request("PATCH", f"/v1/projects/{project_id}", {"token_divisor": 4}, key=key)
        if status != 403:
            finding("blocker", "settings-auth", f"read key PATCH returned {status} {payload}")
        viewer = Client()
        status, _, headers = viewer.request("POST", "/v1/auth/login", {"email": viewer_email, "password": "review-viewer-password"})
        viewer.cookie = (headers.get("Set-Cookie") or headers.get("set-cookie") or "").split(";", 1)[0]
        status, payload, _ = viewer.request("PATCH", f"/v1/projects/{project_id}", {"token_divisor": 4})
        if status != 403:
            finding("blocker", "settings-viewer", f"viewer PATCH returned {status} {payload}")

    # Alerts on a fresh project so the truth dataset is not the signal.
    alert_project = client.admin("projects", {"tenant_id": tenant_id, "slug": "alerts", "name": "Alerts"})["id"]
    alert_key = client.admin("keys", {"project_id": alert_project, "label": "alerts", "scopes": ["ingest", "read"]})["secret"]
    psql(f"UPDATE projects SET rate_events_per_min=1000000, rate_bytes_per_min=1073741824 WHERE id='{alert_project}'")
    alert_events = []
    def alert_call(ts, tool, duration, error, client_name, subject):
        alert_events.append({
            "id": uuid7(), "ts": ts, "type": "tool.called", "session_id": "s-alert",
            "client_name": client_name, "client_version": "1", "protocol": "2025-06-18",
            "caller": {"subject": subject}, "identity": ("strong", subject), "tool": tool,
            "duration_ms": duration, "is_error": error, "transport": None,
            "attrs": {"tool": tool, "duration_ms": duration, "is_error": error, "input_bytes": 10, "output_bytes": 10, "output_kinds": ["text"], "cancelled": False, "output_chars": 8},
        })
    for hour in range(2, 26):
        base_ts = now - timedelta(hours=hour)
        for n in range(5):
            alert_call(base_ts + timedelta(minutes=n), "get_product", 100, False, "Claude", "alert-user")
    for n in range(40):
        alert_call(now - timedelta(minutes=30) + timedelta(seconds=n), "get_product", 8000, n < 20, "Claude", "alert-user")
    for n in range(5):
        alert_call(now - timedelta(minutes=20) + timedelta(seconds=n), "book_flight", 100, False, "Stranger", "stranger")
    for n in range(8):
        alert_call(now - timedelta(seconds=20) + timedelta(seconds=n), "get_product", 8000, True, "Claude", "alert-user")
    # Catalogue so destructive annotations exist.
    alert_events.append({
        "id": uuid7(), "ts": now - timedelta(days=3), "type": "tools.listed", "session_id": "s-alert",
        "client_name": "Claude", "client_version": "1", "protocol": "2025-06-18",
        "caller": {"subject": "alert-user"}, "identity": ("strong", "alert-user"), "tool": None,
        "duration_ms": None, "is_error": False, "transport": None,
        "attrs": {"tools": [{"name": "get_product", "annotations": ["readOnly"]}, {"name": "book_flight", "annotations": ["destructive"]}], "catalog_hash": "a" * 64},
    })
    accepted, rejected = ingest(client, alert_key, alert_events)
    print("alert ingest", accepted, rejected[:1])
    time.sleep(2)
    received = parse_ts(psql(f"SELECT max(received_at) FROM events WHERE project_id='{alert_project}'"))
    # Alerts are evaluated on the worker tick, which also rolls up.
    deadline = time.time() + 150
    fired = []
    while time.time() < deadline:
        rows = psql(f"SELECT rule || '=' || state || ':' || count(*) FROM alerts_log WHERE project_id='{alert_project}' GROUP BY rule, state ORDER BY rule")
        print("alerts", rows.replace("\n", " | "))
        fired = [line for line in rows.splitlines() if "=firing:" in line]
        if sum(1 for line in fired if line.split(":")[-1] != "0") >= 3:
            break
        time.sleep(5)
    rules = {line.split("=")[0] for line in fired}
    for rule in ("volume", "latency", "burn", "destructive"):
        if rule not in rules:
            log = psql(f"SELECT rule, state FROM alerts_log WHERE project_id='{alert_project}' ORDER BY ts")
            finding("blocker", "alert-" + rule, f"rule did not fire; log was {log}")
    duplicates = psql(f"SELECT count(*) FROM (SELECT rule, state FROM alerts_log WHERE project_id='{alert_project}' AND state='firing' GROUP BY rule, state HAVING count(*) > 1) s")
    if duplicates != "0":
        finding("blocker", "alert-once", f"a firing rule was inserted more than once: {duplicates}")
    # Error rule must not fire on a short burst.
    error_state = psql(f"SELECT state FROM alerts_log WHERE project_id='{alert_project}' AND rule='errors' ORDER BY ts DESC LIMIT 1")
    if error_state == "firing":
        finding("blocker", "alert-errors-sustain", "error rule fired without 15 minutes of sustained evidence")
    else:
        psql(f"UPDATE analytics_alert_pending SET since=now()-interval '20 minutes', evaluated_at=now() WHERE project_id='{alert_project}'")
        # The worker samples only the last minute, so keep that minute failing and
        # keep evaluated_at inside the 90s continuity gap until a tick lands.
        deadline = time.time() + 100
        while time.time() < deadline:
            more = []
            for _ in range(4):
                alert_call(datetime.now(timezone.utc) - timedelta(seconds=2), "get_product", 8000, True, "Claude", "alert-user")
                more.append(alert_events[-1])
            ingest(client, alert_key, more)
            psql(f"UPDATE analytics_alert_pending SET evaluated_at=now() WHERE project_id='{alert_project}' AND since IS NOT NULL")
            error_state = psql(f"SELECT state FROM alerts_log WHERE project_id='{alert_project}' AND rule='errors' ORDER BY ts DESC, id DESC LIMIT 1")
            if error_state == "firing":
                break
            time.sleep(8)
        print("errors after sustained backdate", error_state)
        if error_state != "firing":
            finding("blocker", "alert-errors-fire", f"sustained error breach stayed {error_state}")
        else:
            count = psql(f"SELECT count(*) FROM alerts_log WHERE project_id='{alert_project}' AND rule='errors' AND state='firing'")
            time.sleep(65)
            count2 = psql(f"SELECT count(*) FROM alerts_log WHERE project_id='{alert_project}' AND rule='errors' AND state='firing'")
            if count2 != count:
                finding("blocker", "alert-errors-once", f"error firing rows grew {count} -> {count2}")
    # Clear volume by raising its threshold.
    if client.cookie:
        status, payload, _ = client.request("PUT", f"/v1/projects/{alert_project}/alerts", {"rules": [
            {"id": "volume", "enabled": True, "threshold": 1000000},
            {"id": "latency", "enabled": False, "threshold": 2},
            {"id": "errors", "enabled": False, "threshold": 5},
            {"id": "destructive", "enabled": False},
            {"id": "burn", "enabled": False, "threshold": 6},
        ]})
        if status != 200:
            finding("blocker", "alerts-put", f"{status} {payload}")
        else:
            deadline = time.time() + 90
            cleared = False
            while time.time() < deadline:
                state = psql(f"SELECT state FROM alerts_log WHERE project_id='{alert_project}' AND rule='volume' ORDER BY ts DESC, id DESC LIMIT 1")
                if state == "ok":
                    cleared = True
                    break
                time.sleep(3)
            if not cleared:
                state = psql(f"SELECT state FROM alerts_log WHERE project_id='{alert_project}' AND rule='volume' ORDER BY ts DESC LIMIT 1")
                finding("blocker", "alert-clear", f"volume did not clear after the threshold was raised; state={state}")
            disabled = psql(f"SELECT state FROM alerts_log WHERE project_id='{alert_project}' AND rule='latency' ORDER BY ts DESC, id DESC LIMIT 1")
            if disabled != "disabled":
                finding("blocker", "alert-disable", f"disabled latency rule state is {disabled}")

    # Prober stays off, then records availability.
    if client.cookie:
        probes = psql(f"SELECT count(*) FROM probes WHERE project_id='{project_id}'")
        status, reliability, _ = client.request("GET", f"{base}/reliability?range=24h", key=key)
        if probes != "0" or reliability.get("availability") is not None:
            finding("blocker", "prober-default", f"probes={probes} availability={reliability.get('availability')}")
        server = ThreadingHTTPServer(("127.0.0.1", PROBE_PORT), Probe)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        status, saved, _ = client.request("PATCH", f"/v1/projects/{project_id}", {"probe_url": PROBE_URL, "probe_key": "review-probe-key"})
        if status != 200 or saved.get("probe_url") != PROBE_URL or "probe_key" in saved:
            finding("blocker", "probe-settings", f"{status} {saved}")
        deadline = time.time() + 90
        row = ""
        while time.time() < deadline:
            row = psql(f"SELECT ok || ' ' || advertised_tools FROM probes WHERE project_id='{project_id}' ORDER BY ts DESC LIMIT 1")
            if row.startswith("t"):
                break
            time.sleep(3)
        print("probe row", row)
        status, reliability, _ = client.request("GET", f"{base}/reliability?range=24h", key=key)
        availability = reliability.get("availability")
        if not row.startswith("t") or not isinstance(availability, dict):
            finding("blocker", "prober", f"row={row} availability={availability}")
        elif availability.get("healthy_tools") is not None or availability.get("advertised_tools") != 2 or availability.get("uptime_pct") != 100:
            finding("blocker", "prober-availability", json.dumps(availability))
        server.shutdown()

    # OpenAPI coverage.
    status, spec, _ = client.request("GET", "/v1/openapi.json")
    paths = spec.get("paths", {}) if isinstance(spec, dict) else {}
    for path in (
        "/v1/projects/{project}/analytics/overview",
        "/v1/projects/{project}/analytics/adoption",
        "/v1/projects/{project}/analytics/tools",
        "/v1/projects/{project}/analytics/reliability",
        "/v1/projects/{project}/analytics/cost",
        "/v1/projects/{project}/analytics/protocol",
        "/v1/projects/{project}/analytics/digest",
        "/v1/projects/{project}/analytics/alerts",
        "/v1/projects/{project}/analytics/sessions/{session}/timeline",
        "/v1/projects/{project}/alerts",
    ):
        if path not in paths:
            finding("blocker", "openapi-path", path + " missing")
    schemas = spec.get("components", {}).get("schemas", {}) if isinstance(spec, dict) else {}
    for schema in ("AnalyticsOverview", "AnalyticsAdoption", "AnalyticsTools", "AnalyticsReliability", "AnalyticsCost", "AnalyticsProtocol", "AnalyticsDigest", "AnalyticsAlerts", "AnalyticsTimeline"):
        if schema not in schemas:
            finding("blocker", "openapi-schema", schema + " missing")

    # Reproduce the CI planner shape even on a fresh database: populated daily
    # partitions outside the performance window, created by the real ingest path.
    partition_project = client.admin("projects", {"tenant_id": tenant_id, "slug": "partition-plan", "name": "Partition plan"})["id"]
    partition_key = client.admin("keys", {"project_id": partition_project, "label": "partition-plan", "scopes": ["ingest"]})["secret"]
    psql(f"UPDATE projects SET retention_days=90 WHERE id='{partition_project}'")
    partition_events = [{
        "id": uuid7(), "ts": fmt(datetime.now(timezone.utc) - timedelta(days=day)),
        "type": "tool.called", "attrs": {"tool": "partition_probe", "duration_ms": 10,
        "is_error": False, "input_bytes": 1, "output_bytes": 1, "output_kinds": ["text"], "cancelled": False},
    } for day in range(1, 32)]
    status, body, _ = client.request("POST", "/v1/events", {
        "schema_version": 1, "sent_at": fmt(datetime.now(timezone.utc)),
        "source": {"sdk": "node", "sdk_version": "1", "server_name": "review", "server_version": "1", "instance_id": "partition-plan"},
        "events": partition_events,
    }, key=partition_key)
    if status != 202 or body.get("accepted") != 31 or body.get("rejected"):
        finding("blocker", "partition-fixture", f"{status} {body}")
    partition_count = int(psql(f"SELECT count(DISTINCT tableoid) FROM events WHERE project_id='{partition_project}'"))
    print("populated daily partition fixture", partition_count)
    if partition_count < 31:
        finding("blocker", "partition-fixture", f"expected 31 populated daily partitions, got {partition_count}")

    # 100k route timing on its own project.
    perf = client.admin("projects", {"tenant_id": tenant_id, "slug": "perf", "name": "Perf"})["id"]
    perf_key = client.admin("keys", {"project_id": perf, "label": "perf", "scopes": ["read"]})["secret"]
    print("loading 100k events")
    psql(
        "INSERT INTO events(project_id,ts,received_at,id,type,session_id,tool,duration_ms,is_error,client_name,client_version,attrs,client,caller) "
        f"SELECT '{perf}', now() - interval '3 days' + (g%250000) * interval '1 second', clock_timestamp(), gen_random_uuid(), 'tool.called', "
        "'bench-'||(g%200), 'get_item', (g%5000)+1, g%97=0, CASE WHEN g%2=0 THEN 'Claude' ELSE 'Cursor' END, '1.0', "
        "jsonb_build_object('input_bytes',100,'output_bytes',400,'output_chars',200,'cancelled',false,'duration_ms',(g%5000)+1,'is_error',g%97=0,'tool','get_item'), "
        "jsonb_build_object('name', CASE WHEN g%2=0 THEN 'Claude' ELSE 'Cursor' END, 'version','1.0'), jsonb_build_object('subject','bench-'||(g%100)) "
        "FROM generate_series(1,100000) g"
    )
    facts = psql(f"SELECT count(*) FROM analytics_facts WHERE project_id='{perf}'")
    print("perf facts", facts)
    if facts != "100000":
        finding("blocker", "perf-load", f"expected 100000 facts, got {facts}")
    received = parse_ts(psql(f"SELECT max(received_at) FROM events WHERE project_id='{perf}'"))
    wait_watermark(received, timeout=240)
    timings = {}
    perf_base = f"/v1/projects/{perf}/analytics"
    print(f"Latency budget: {LATENCY_BUDGET_MS:g} ms; warmup then median of three")
    for name in ("overview", "adoption", "tools", "reliability", "cost", "protocol", "digest", "alerts", "timeline"):
        route = "sessions/bench-0/timeline" if name == "timeline" else name
        url = f"{perf_base}/{route}?range=7d"
        status, _, _ = client.request("GET", url, key=perf_key, timeout=30)
        if status != 200:
            finding("blocker", "perf-status", f"{name} warmup returned {status}")
        samples = []
        for _ in range(3):
            started = time.perf_counter()
            status, _, _ = client.request("GET", url, key=perf_key, timeout=30)
            samples.append((time.perf_counter() - started) * 1000)
            if status != 200:
                finding("blocker", "perf-status", f"{name} returned {status}")
        TIMING_SAMPLES[name] = [round(sample, 2) for sample in samples]
        elapsed = statistics.median(samples)
        timings[name] = round(elapsed, 2)
        print(f"BENCH {name}: median {timings[name]} ms; samples {TIMING_SAMPLES[name]}")
        if elapsed > LATENCY_BUDGET_MS:
            finding("should-fix", "perf-" + name, f"{timings[name]} ms median exceeds {LATENCY_BUDGET_MS:g} ms budget")
    plan = psql(
        "EXPLAIN SELECT ts,id,type FROM analytics_facts WHERE project_id="
        f"'{perf}' AND ts < now()"
    )
    # Use the production SQL, not a handwritten approximation of eligibility.
    with open(os.path.join(ROOT, "crates/signals-store/queries/analytics_histograms.sql")) as handle:
        eligibility = handle.read()
    for placeholder, value in (("$1", f"'{uuid.UUID(perf)}'::uuid"),
                               ("$2", "now()-interval '7 days'"), ("$3", "now()"),
                               ("$4", "'1970-01-01'::timestamptz")):
        eligibility = eligibility.replace(placeholder, value)
    nested = psql("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + eligibility)
    print("EXPLAIN facts\n", plan)
    print("EXPLAIN hourly\n", nested)
    scans = executed_event_scans(json.loads(nested)[0]["Plan"])
    if scans:
        finding("should-fix", "explain-events", "analytics histogram eligibility scans populated event partitions: " + ", ".join(scans))

    # Stored subject_kind precedence, which v1.0 wire schema cannot carry.
    kind_project = client.admin("projects", {"tenant_id": tenant_id, "slug": "kinds", "name": "Kinds"})["id"]
    kind_key = client.admin("keys", {"project_id": kind_project, "label": "kinds", "scopes": ["read"]})["secret"]
    psql(
        "INSERT INTO events(project_id,ts,received_at,id,type,session_id,tool,duration_ms,is_error,client_name,client_version,attrs,client,caller) VALUES "
        f"('{kind_project}', now()-interval '1 hour', clock_timestamp(), gen_random_uuid(), 'tool.called', 's', 'get_product', 10, false, 'Claude', '1', "
        "'{\"tool\":\"get_product\",\"duration_ms\":10,\"is_error\":false,\"input_bytes\":1,\"output_bytes\":1,\"output_kinds\":[\"text\"],\"cancelled\":false}'::jsonb, "
        "'{\"name\":\"Claude\",\"version\":\"1\"}'::jsonb, '{\"subject\":\"header-user\",\"subject_kind\":\"header\",\"key_id\":\"header-key\"}'::jsonb), "
        f"('{kind_project}', now()-interval '50 minutes', clock_timestamp(), gen_random_uuid(), 'tool.called', 's2', 'get_product', 10, false, 'Claude', '1', "
        "'{\"tool\":\"get_product\",\"duration_ms\":10,\"is_error\":false,\"input_bytes\":1,\"output_bytes\":1,\"output_kinds\":[\"text\"],\"cancelled\":false}'::jsonb, "
        "'{\"name\":\"Claude\",\"version\":\"1\"}'::jsonb, '{\"ip_hash\":\"abc123\",\"subject\":null}'::jsonb)"
    )
    status, body, _ = client.request("GET", f"/v1/projects/{kind_project}/analytics/overview?range=24h", key=kind_key)
    quality = body.get("tiles", {}).get("active_users", {}).get("by_kind") if isinstance(body, dict) else None
    print("subject_kind breakdown", quality, "status", status)
    if quality != {"strong": 0, "key": 1, "network": 1}:
        finding("blocker", "subject-kind-precedence", f"header subject should fall through to key and ip_hash should be network, got {quality}")

    dump_results(timings)


def dump_results(timings=None):
    out = {"findings": FINDINGS, "mismatches": MISMATCHES[:80], "mismatch_count": len(MISMATCHES), "timings": timings or {}, "timing_samples": TIMING_SAMPLES, "latency_budget_ms": LATENCY_BUDGET_MS, "latency_statistic": "median_of_three_after_warmup"}
    with open(os.path.join(ARTIFACTS, "findings.json"), "w") as handle:
        json.dump(out, handle, indent=2, default=str)
    print("FINDINGS", len(FINDINGS), "MISMATCHES", len(MISMATCHES))
    for item in MISMATCHES[:30]:
        print("MISMATCH", json.dumps(item, default=str)[:500])


class Probe(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        method = body.get("method")
        if self.headers.get("Authorization") != "Bearer review-probe-key":
            self.send_response(401)
            self.end_headers()
            return
        if method == "initialize":
            payload = {"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": "2025-03-26", "capabilities": {"tools": {}}}}
            raw = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("mcp-session-id", "probe-session")
            self.send_header("content-length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        elif method == "notifications/initialized":
            self.send_response(202)
            self.end_headers()
        elif method == "tools/list":
            payload = {"jsonrpc": "2.0", "id": 2, "result": {"tools": [{"name": "get_product"}, {"name": "book_flight"}]}}
            raw = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        else:
            self.send_response(400)
            self.end_headers()

    def do_DELETE(self):
        self.send_response(204)
        self.end_headers()

    def log_message(self, *_args):
        return


if __name__ == "__main__":
    try:
        require_unused_port(PROBE_PORT)
        restart_server()
        main()
        if FINDINGS or MISMATCHES:
            raise SystemExit(1)
    except Exception:
        dump_results()
        raise
    finally:
        stop_server()
