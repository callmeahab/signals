#!/usr/bin/env python3
"""Independent review probe for collector spec v1.1.0. Does not modify product source.

Writes reports/review-v11-r1/probe-result.json and prints a short summary.
"""
import base64
import email
import email.policy
import gzip
import json
import os
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path("/home/vuk/orca/workspaces/signals-collector/collector-v1-1")
SPEC = Path("/home/vuk/orca/projects/signals-spec")
OUT = ROOT / "reports/review-v11-r1"
TMP = Path("/var/tmp/collector-v11-r1")
BIN = TMP / "target/debug/signals"
DELIVERY_BIN = TMP / "target/debug/delivery_probe"
BASE = "http://127.0.0.1:26112"
PG = "collector-v11-r1-pg"
ADMIN = "review-v11-r1-admin-token-32chars"
FAIL_FLAG = TMP / "webhook-fail"
MAIL_DIR = TMP / "mail"
HOOK_DIR = TMP / "hooks"
NODE_REF = OUT / "ref.mjs"

findings = []
verified = []


def record(kind, title, command, observed, expected, contract):
    findings.append({
        "kind": kind,
        "title": title,
        "command": command,
        "observed": observed if isinstance(observed, str) else json.dumps(observed, default=str)[:4000],
        "expected": expected if isinstance(expected, str) else json.dumps(expected, default=str)[:4000],
        "contract": contract,
    })


def ok(claim, detail):
    verified.append({"claim": claim, "detail": detail if isinstance(detail, str) else json.dumps(detail, default=str)[:2000]})


def uuid7():
    ms = int(time.time() * 1000) & ((1 << 48) - 1)
    raw = bytearray(ms.to_bytes(6, "big") + os.urandom(10))
    raw[6] = (raw[6] & 0x0F) | 0x70
    raw[8] = (raw[8] & 0x3F) | 0x80
    return str(uuid.UUID(bytes=bytes(raw)))


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def psql(sql):
    result = subprocess.run(
        ["docker", "exec", "-i", PG, "psql", "-U", "postgres", "-d", "signals", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout)
    return result.stdout.strip()


def http(method, path, body=None, headers=None, timeout=60):
    data = body if isinstance(body, bytes) or body is None else json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            return response.status, raw, dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, error.read(), dict(error.headers)


def admin(route, payload):
    status, raw, _ = http("POST", "/v1/admin/" + route, payload, {
        "Authorization": "Bearer " + ADMIN,
        "Content-Type": "application/json",
    })
    if status != 200:
        raise RuntimeError(f"admin {route} {status} {raw[:400]!r}")
    return json.loads(raw)


class Project:
    def __init__(self, slug, name="review"):
        self.tenant = admin("tenants", {"slug": slug + "-" + uuid.uuid4().hex[:8], "name": name})
        self.doc = admin("projects", {"tenant_id": self.tenant["id"], "slug": slug[:40], "name": name})
        self.id = self.doc["id"]
        self.key = admin("keys", {"project_id": self.id, "label": slug, "scopes": ["ingest", "read"]})["secret"]
        psql(f"UPDATE projects SET retention_days=30, rate_events_per_min=1000000, rate_bytes_per_min=1073741824 WHERE id='{self.id}'")

    def post(self, body, content_type, encoding="identity"):
        payload = gzip.compress(body) if encoding == "gzip" else body
        headers = {
            "Authorization": "Bearer " + self.key,
            "Content-Type": "application/x-ndjson" if content_type == "ndjson" else "application/json",
            "Content-Encoding": encoding,
        }
        status, raw, _ = http("POST", "/v1/events", payload, headers)
        try:
            data = json.loads(raw)
        except ValueError:
            data = {"non_json": raw.decode(errors="replace")[:500]}
        if status == 202:
            verdict = {"status": 202, "error": None, "accepted": data.get("accepted"), "rejected": data.get("rejected") or []}
        else:
            verdict = {"status": status, "error": data.get("error"), "accepted": None, "rejected": data.get("rejected") or []}
        verdict["rejected"] = [{"index": r.get("index"), "reason": r.get("reason")} for r in verdict["rejected"]]
        return verdict

    def analytics(self, name, **params):
        query = urllib.parse.urlencode(params)
        status, raw, _ = http("GET", f"/v1/projects/{self.id}/analytics/{name}?{query}", headers={"Authorization": "Bearer " + self.key})
        data = json.loads(raw) if raw else {}
        return status, data


SOURCE = json.loads((ROOT / "spec/fixtures/valid/tools-listed.json").read_text())["source"]
CLIENT = {"name": "claude-ai", "version": "1.2.0", "protocol_version": "2025-06-18"}
CALLER = {"key_id": "k_review", "subject": None, "ip": "203.0.113.9", "user_agent": "review/1"}
SENT = "2026-10-11T16:00:00.000Z"
SENT_MS = int(datetime(2026, 10, 11, 16, 0, tzinfo=timezone.utc).timestamp() * 1000)


def event(kind, attrs, caller=None, ts=SENT, session="s_review"):
    return {
        "id": uuid7(), "ts": ts, "type": kind, "session_id": session,
        "client": CLIENT, "caller": caller or dict(CALLER), "attrs": attrs,
    }


def batch_bytes(events, sent_at=SENT):
    doc = {"schema_version": 1, "source": SOURCE, "sent_at": sent_at, "dropped": 0, "events": events}
    return json.dumps(doc, separators=(",", ":")).encode()


def tool_attrs(**extra):
    attrs = {
        "tool": "echo", "duration_ms": 5, "is_error": False, "input_bytes": 1,
        "output_bytes": 1, "output_kinds": ["text"], "cancelled": False,
    }
    attrs.update(extra)
    return attrs


def reference_all(cases):
    path = TMP / "ref-cases.json"
    path.write_text(json.dumps(cases))
    result = subprocess.run(["node", str(NODE_REF), str(path)], capture_output=True, text=True, cwd=str(SPEC / "conformance"))
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-2000:])
    return {row["id"]: row for row in json.loads(result.stdout)}


def compare_cases(project, cases, label):
    print(f"reference {label} ({len(cases)})", flush=True)
    expected = reference_all([{
        "id": c["id"],
        "content_type": c["content_type"],
        "received_at_ms": c["received_at_ms"],
        "body_b64": base64.b64encode(c["body"]).decode(),
    } for c in cases])
    mismatches = []
    for index, case in enumerate(cases):
        actual = project.post(case["body"], case["content_type"], case.get("encoding", "identity"))
        exp = expected[case["id"]]
        exp_n = {"status": exp["status"], "error": exp["error"], "accepted": exp["accepted"], "rejected": exp["rejected"]}
        if actual != exp_n:
            mismatches.append({"id": case["id"], "collector": actual, "reference": exp_n})
        if index and index % 100 == 0:
            print(f"  posted {index}/{len(cases)} mismatches {len(mismatches)}", flush=True)
    if mismatches:
        record(
            "blocker",
            f"{label}: collector verdicts diverge from conformance/src/lib/ingest.mjs",
            f"POST /v1/events compared with node reports/review-v11-r1/ref.mjs ({len(cases)} cases)",
            mismatches[:12],
            "identical status, error, accepted count, and rejected index/reason",
            "Review check 2: collector verdicts must match the reference pipeline. v1.0 batches stay unchanged.",
        )
    else:
        ok(label, f"{len(cases)} cases matched the reference pipeline")
    return mismatches


def sent_ms_of(body, content_type):
    if content_type == "ndjson":
        line = next(line for line in body.decode().splitlines() if line.strip())
        doc = json.loads(line)
    else:
        doc = json.loads(body)
    text = doc["sent_at"].replace("Z", "+00:00")
    return int(datetime.fromisoformat(text).timestamp() * 1000)


def fixture_cases(root, prefix):
    cases = []
    for category in ("valid", "invalid"):
        directory = root / category
        if not directory.is_dir():
            continue
        for path in sorted(directory.iterdir()):
            if path.suffix not in {".json", ".ndjson"} or path.name.endswith(".expected.json"):
                continue
            content_type = "ndjson" if path.suffix == ".ndjson" else "json"
            body = path.read_bytes()
            for encoding in ("identity", "gzip"):
                cases.append({
                    "id": f"{prefix}:{encoding}:{category}/{path.name}",
                    "body": body,
                    "content_type": content_type,
                    "encoding": encoding,
                    "received_at_ms": None,
                })
    return cases


def crafted_cases():
    cases = []

    def add(name, events, valid_shape=True):
        body = batch_bytes(events)
        for encoding in ("identity", "gzip"):
            cases.append({
                "id": f"crafted:{encoding}:{name}",
                "body": body,
                "content_type": "json",
                "encoding": encoding,
                "received_at_ms": None,
            })

    hash64 = "ab" * 32
    tools = lambda n, name_len=1: [{"name": (f"t{i}" if name_len == 1 else "n" * name_len)} for i in range(n)]
    add("tools-500", [event("tools.listed", {"count": 500, "tools": tools(500), "truncated": False, "catalog_hash": hash64, "duration_ms": 1, "is_error": False, "source": "list"})])
    add("tools-501", [event("tools.listed", {"count": 501, "tools": tools(501), "truncated": True, "catalog_hash": hash64, "is_error": False, "source": "list"})])
    add("tool-name-256", [event("tools.listed", {"tools": [{"name": "n" * 256}], "is_error": False, "source": "list"})])
    add("tool-name-257", [event("tools.listed", {"tools": [{"name": "n" * 257}], "is_error": False, "source": "list"})])
    add("annotation-32", [event("tools.listed", {"tools": [{"name": "a", "annotations": ["a" * 32]}], "is_error": False, "source": "list"})])
    add("annotation-33", [event("tools.listed", {"tools": [{"name": "a", "annotations": ["a" * 33]}], "is_error": False, "source": "list"})])
    add("annotations-8", [event("tools.listed", {"tools": [{"name": "a", "annotations": [f"h{i}" for i in range(8)]}], "is_error": False, "source": "list"})])
    add("annotations-9", [event("tools.listed", {"tools": [{"name": "a", "annotations": [f"h{i}" for i in range(9)]}], "is_error": False, "source": "list"})])
    add("catalog-hash-64", [event("tools.listed", {"catalog_hash": "c" * 64, "tools": [{"name": "a"}], "is_error": False, "source": "list_changed"})])
    add("catalog-hash-65", [event("tools.listed", {"catalog_hash": "c" * 65, "tools": [{"name": "a"}], "is_error": False, "source": "list"})])
    add("schema-hash-64", [event("tools.listed", {"tools": [{"name": "a", "schema_hash": "d" * 64}], "is_error": False, "source": "list"})])
    add("schema-hash-65", [event("tools.listed", {"tools": [{"name": "a", "schema_hash": "d" * 65}], "is_error": False, "source": "list"})])
    add("source-bad", [event("tools.listed", {"tools": [{"name": "a"}], "source": "cache", "is_error": False})])
    add("count-0", [event("tools.listed", {"count": 0, "tools": [], "truncated": True, "catalog_hash": hash64, "is_error": False, "source": "list"})])
    add("count-neg", [event("tools.listed", {"count": -1, "tools": [], "is_error": False, "source": "list"})])
    add("listed-error", [event("tools.listed", {"is_error": True, "duration_ms": 3})])
    for kind in ("oauth", "api_key", "header", "none"):
        caller = {"key_id": "k_review", "subject": None if kind == "none" else "user", "subject_kind": kind, "ip": "203.0.113.9"}
        add(f"subject-kind-{kind}", [event("session.started", {"transport": "streamable-http", "derived": False}, caller=caller)])
    add("subject-kind-bad", [event("session.started", {"transport": "streamable-http", "derived": False}, caller={"subject": "user", "subject_kind": "oauth2"})])
    add("subject-none-present", [event("session.started", {"transport": "streamable-http", "derived": False}, caller={"subject": "user", "subject_kind": "none"})])
    add("subject-256", [event("session.started", {"transport": "streamable-http", "derived": False}, caller={"subject": "é" * 256, "subject_kind": "oauth"})])
    add("subject-257", [event("session.started", {"transport": "streamable-http", "derived": False}, caller={"subject": "é" * 257, "subject_kind": "oauth"})])
    add("derived-true", [event("session.started", {"transport": "synthetic", "derived": True})])
    add("derived-false", [event("session.started", {"transport": "stdio", "derived": False})])
    add("derived-true-real", [event("session.started", {"transport": "stdio", "derived": True})])
    add("derived-false-synthetic", [event("session.started", {"transport": "synthetic", "derived": False})])
    for kind in ("tool", "protocol", "timeout", "unknown_tool", "invalid_params", "auth", "internal"):
        add(f"error-kind-{kind}", [event("tool.called", tool_attrs(error_kind=kind, is_error=True, error_code=-32602, request_id="r" * 8))])
    add("error-kind-cancelled", [event("tool.called", tool_attrs(error_kind="cancelled", is_error=False, cancelled=True, output_bytes=0, output_kinds=[], output_items=0))])
    add("error-kind-bad", [event("tool.called", tool_attrs(error_kind="boom", is_error=True))])
    add("error-kind-success", [event("tool.called", tool_attrs(error_kind="tool", is_error=False))])
    add("cancelled-but-error", [event("tool.called", tool_attrs(error_kind="cancelled", is_error=True, cancelled=True, output_bytes=0, output_kinds=[]))])
    add("request-id-64", [event("tool.called", tool_attrs(request_id="r" * 64))])
    add("request-id-65", [event("tool.called", tool_attrs(request_id="r" * 65))])
    add("output-chars-0", [event("tool.called", tool_attrs(output_chars=0, output_items=0))])
    add("output-chars-neg", [event("tool.called", tool_attrs(output_chars=-1))])
    add("output-items-neg", [event("tool.called", tool_attrs(output_items=-1))])
    add("duration-neg", [event("tool.called", tool_attrs(duration_ms=-1))])
    add("schema-flags", [event("tool.called", tool_attrs(input_schema_valid=False, output_schema_valid=True))])
    add("progress", [event("tool.called", tool_attrs(duration_ms=1000, progress_events=2, first_progress_ms=10))])
    add("progress-neg", [event("tool.called", tool_attrs(progress_events=-1))])
    caps = ["c" * 64 for _ in range(32)]
    add("init-ok", [event("mcp.initialize", {"requested_protocol_version": "2025-11-25", "client_capabilities": caps, "server_capabilities": ["tools"], "duration_ms": 12, "is_error": False})])
    add("init-caps-33", [event("mcp.initialize", {"requested_protocol_version": "2025-11-25", "client_capabilities": caps + ["extra"], "server_capabilities": ["tools"], "is_error": False, "duration_ms": 1})])
    add("init-error-kind", [event("mcp.initialize", {"requested_protocol_version": "2025-11-25", "client_capabilities": [], "server_capabilities": [], "duration_ms": 4, "is_error": True, "error_kind": "timeout"})])
    add("init-kind-success", [event("mcp.initialize", {"requested_protocol_version": "2025-11-25", "client_capabilities": [], "server_capabilities": [], "is_error": False, "error_kind": "internal"})])
    for mode in ("form", "url"):
        add(f"elicit-{mode}", [event("elicitation.requested", {"mode": mode, "action": "accept", "duration_ms": 20})])
    add("elicit-bad-mode", [event("elicitation.requested", {"mode": "email", "action": "accept"})])
    for action in ("accept", "decline", "cancel", "error"):
        add(f"elicit-action-{action}", [event("elicitation.requested", {"action": action, "duration_ms": 1})])
    add("elicit-bad-action", [event("elicitation.requested", {"action": "yes"})])
    add("sampling-ok", [event("sampling.requested", {"model": "m" * 128, "max_tokens": 64, "stop_reason": "s" * 64, "duration_ms": 30, "is_error": False, "rejected": False})])
    add("sampling-model-129", [event("sampling.requested", {"model": "m" * 129, "is_error": False})])
    add("sampling-stop-65", [event("sampling.requested", {"stop_reason": "s" * 65, "is_error": False})])
    add("sampling-rejected", [event("sampling.requested", {"rejected": True, "is_error": False, "duration_ms": 5})])
    add("sampling-rejected-error", [event("sampling.requested", {"rejected": True, "is_error": True})])
    add("sampling-tokens-neg", [event("sampling.requested", {"max_tokens": -1, "is_error": False})])
    add("task-ok", [event("task.updated", {"task_id": "t" * 128, "status": "completed", "poll_count": 3})])
    add("task-id-129", [event("task.updated", {"task_id": "t" * 129, "status": "working"})])
    add("task-status-32", [event("task.updated", {"task_id": "t", "status": "s" * 32})])
    add("task-status-33", [event("task.updated", {"task_id": "t", "status": "s" * 33})])
    add("task-poll-neg", [event("task.updated", {"poll_count": -1})])
    for reason in ("missing", "invalid", "expired", "revoked", "scope", "other"):
        add(f"auth-{reason}", [event("error", {"message": "nope", "where": "auth", "reason": reason})])
    add("auth-reason-bad", [event("error", {"message": "nope", "where": "auth", "reason": "nope"})])
    add("reason-not-auth", [event("error", {"message": "nope", "where": "transport", "reason": "missing"})])
    add("error-code-big", [event("mcp.request", {"method": "tools/call", "duration_ms": 1, "is_error": True, "error_kind": "internal", "error_code": 9007199254740993, "request_id": "big"})])
    return cases


def require(title, condition, observed, expected, contract, command):
    if condition:
        ok(title, observed)
    else:
        record("blocker", title, command, observed, expected, contract)


def getpath(obj, path):
    current = obj
    for part in path.split("."):
        if isinstance(current, list):
            current = current[int(part)]
        elif isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def ingest_recordings(project, paths, start):
    accepted = 0
    rejected = []
    for path in paths:
        rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
        events = []
        for index, row in enumerate(rows):
            ev = dict(row["event"])
            ev["id"] = uuid7()
            ev["ts"] = iso(start + timedelta(milliseconds=index * 20))
            # Artifacts record the collector-side hash. The wire caller object
            # has `ip`, and `ip_hash` is rejected by events.schema.json.
            caller = ev.get("caller")
            if isinstance(caller, dict) and "ip_hash" in caller:
                ev["caller"] = {key: value for key, value in caller.items() if key != "ip_hash"}
            events.append(ev)
        body = json.dumps({
            "schema_version": 1,
            "source": rows[0].get("source") or SOURCE,
            "sent_at": iso(start + timedelta(seconds=30)),
            "dropped": rows[0].get("dropped") or 0,
            "events": events,
        }, separators=(",", ":")).encode()
        # Reference uses the same bytes. A recording the reference rejects is not a collector defect.
        verdict = project.post(body, "json")
        ref = reference_all([{
            "id": path.name,
            "content_type": "json",
            "received_at_ms": None,
            "body_b64": base64.b64encode(body).decode(),
        }])[path.name]
        if verdict["status"] != ref["status"] or verdict["rejected"] != ref["rejected"] or verdict["accepted"] != ref["accepted"]:
            record(
                "blocker",
                f"SDK recording {path.name} diverges from the reference pipeline",
                f"POST rewritten {path}",
                verdict,
                ref,
                "Review check 3: ingest the Node and Python v1.1 recordings. Verdicts must match ingest.mjs.",
            )
        accepted += verdict.get("accepted") or 0
        rejected.append({"file": path.name, "collector": verdict, "reference_rejected": ref["rejected"]})
    return accepted, rejected


def main():
    for directory in (MAIL_DIR, HOOK_DIR):
        if directory.exists():
            for path in directory.iterdir():
                path.unlink()
        directory.mkdir(parents=True, exist_ok=True)
    if FAIL_FLAG.exists():
        FAIL_FLAG.unlink()
    log_path = TMP / "server.log"
    env = os.environ.copy()
    env.update({
        "PATH": os.path.expanduser("~/.cargo/bin") + ":" + os.path.expanduser("~/.bun/bin") + ":" + env.get("PATH", ""),
        "DATABASE_URL": "postgres://postgres:signals@127.0.0.1:26111/signals",
        "SIGNALS_BIND": "127.0.0.1:26112",
        "SIGNALS_PUBLIC_URL": BASE,
        "SIGNALS_ADMIN_TOKEN": ADMIN,
        "SIGNALS_SESSION_SECRET": "review-v11-r1-session-secret-32ch",
        "SIGNALS_BOOTSTRAP_EMAIL": "owner@signals.test",
        "SIGNALS_BOOTSTRAP_PASSWORD": "signals-test-password",
        "SIGNALS_CONFORMANCE_CLOCK": "sent_at",
        "SIGNALS_SMTP_URL": "smtp://127.0.0.1:26114",
        "SIGNALS_SMTP_FROM": "signals@example.test",
        "RUST_LOG": "info",
    })
    log = open(log_path, "w")
    server = subprocess.Popen([str(BIN), "serve"], env=env, stdout=log, stderr=subprocess.STDOUT)
    try:
        ready = False
        for _ in range(100):
            if server.poll() is not None:
                raise RuntimeError(log_path.read_text()[-2000:])
            try:
                status, _, _ = http("GET", "/readyz", timeout=1)
                if status == 200:
                    ready = True
                    break
            except OSError:
                pass
            time.sleep(0.2)
        if not ready:
            raise RuntimeError("collector not ready: " + log_path.read_text()[-2000:])
        ok("server boot", "GET /readyz 200 with SIGNALS_CONFORMANCE_CLOCK=sent_at")

        verdict_project = Project("verdicts", "verdicts")
        print("fixtures v1.1", flush=True)
        compare_cases(verdict_project, fixture_cases(ROOT / "spec/fixtures", "v11"), "vendored v1.1.0 fixtures, identity and gzip")
        v10 = TMP / "v1015"
        if not (v10 / "fixtures/valid").exists():
            v10.mkdir(parents=True, exist_ok=True)
            archive = subprocess.check_output(["git", "-C", str(SPEC), "archive", "v1.0.15", "fixtures"])
            subprocess.run(["tar", "-x", "-C", str(v10)], input=archive, check=True)
        print("fixtures v1.0.15", flush=True)
        compare_cases(verdict_project, fixture_cases(v10 / "fixtures", "v10"), "v1.0.15 fixtures against the v1.1 reference and collector")
        print("crafted", flush=True)
        compare_cases(verdict_project, crafted_cases(), "crafted v1.1 caps, enums, and cross-field rules")

        now = datetime.now(timezone.utc)
        storage = Project("storage", "storage")
        recordings = [
            Path("/home/vuk/orca/workspaces/signals-node/sdk-node-v1-1/artifacts/conformance-stateful.ndjson"),
            Path("/home/vuk/orca/workspaces/signals-node/sdk-node-v1-1/artifacts/review-r1-extra.ndjson"),
            Path("/home/vuk/orca/workspaces/signals-node/sdk-node-v1-1/artifacts/review-r1-auth.ndjson"),
            Path("/home/vuk/orca/workspaces/signals-python/sdk-python-v1-1/artifacts/basic.ndjson"),
            Path("/home/vuk/orca/workspaces/signals-python/sdk-python-v1-1/artifacts/review-v11-r2-live.ndjson"),
            Path("/home/vuk/orca/workspaces/signals-python/sdk-python-v1-1/artifacts/review-v11-r2-auth.ndjson"),
        ]
        print("recordings", flush=True)
        accepted, rejected_info = ingest_recordings(storage, recordings, now - timedelta(minutes=20))
        ok("sdk recordings posted", {"accepted": accepted, "files": [r["file"] + " collector " + str(r["collector"]["status"]) + " rejected " + str(r["collector"]["rejected"]) for r in rejected_info]})

        supplement_ts = iso(now - timedelta(minutes=5))
        supplement = [
            event("session.started", {"transport": "synthetic", "derived": True}, caller={"subject": "user-oauth", "subject_kind": "oauth", "key_id": "should_not_win"}, ts=supplement_ts, session="s_ident"),
            event("session.started", {"transport": "streamable-http", "derived": False}, caller={"subject": "user-apikey", "subject_kind": "api_key", "key_id": "kid_api"}, ts=supplement_ts, session="s_ident"),
            event("session.started", {"transport": "streamable-http", "derived": False}, caller={"subject": "user-header", "subject_kind": "header", "key_id": "kid_header"}, ts=supplement_ts, session="s_ident"),
            event("mcp.initialize", {"requested_protocol_version": "2025-11-25", "client_capabilities": ["sampling"], "server_capabilities": ["tools"], "duration_ms": 42, "is_error": False}, ts=supplement_ts, session="s_proto"),
            event("mcp.initialize", {"requested_protocol_version": "2025-11-25", "client_capabilities": [], "server_capabilities": [], "duration_ms": 80, "is_error": True, "error_kind": "internal"}, ts=supplement_ts, session="s_proto"),
            event("tools.listed", {"count": 2, "tools": [{"name": "listed_tool", "annotations": ["readOnly"], "schema_hash": "e" * 64}, {"name": "idle_tool", "annotations": ["destructive"], "schema_hash": "f" * 64}], "truncated": False, "catalog_hash": "1" * 64, "duration_ms": 7, "is_error": False, "source": "list"}, ts=supplement_ts, session="s_proto"),
            event("tool.called", tool_attrs(tool="listed_tool", duration_ms=1500, output_chars=100, output_bytes=4, output_items=2, input_schema_valid=False, output_schema_valid=False, error_kind="timeout", is_error=True, error_code=-32000, request_id="req-timeout", progress_events=2, first_progress_ms=25), ts=supplement_ts, session="s_proto"),
            event("tool.called", tool_attrs(tool="ghost_tool", is_error=True, error_kind="unknown_tool", error_code=-32602, output_chars=8, request_id="req-ghost"), ts=supplement_ts, session="s_proto"),
            event("sampling.requested", {"model": "probe-model", "max_tokens": 16, "stop_reason": "endTurn", "duration_ms": 40, "is_error": False, "rejected": True}, ts=supplement_ts, session="s_proto"),
            event("elicitation.requested", {"mode": "form", "action": "decline", "duration_ms": 15}, ts=supplement_ts, session="s_proto"),
            event("task.updated", {"task_id": "task-1", "status": "completed", "poll_count": 2}, ts=supplement_ts, session="s_proto"),
            event("task.updated", {"task_id": "task-2", "status": "failed", "poll_count": 1}, ts=supplement_ts, session="s_proto"),
            event("error", {"message": "expired token", "where": "auth", "reason": "expired"}, ts=supplement_ts, session="s_proto"),
            event("mcp.request", {"method": "tools/call", "duration_ms": 1, "is_error": True, "error_kind": "internal", "error_code": 9007199254740993, "request_id": "big"}, ts=supplement_ts, session="s_proto"),
        ]
        body = batch_bytes(supplement, sent_at=iso(now - timedelta(minutes=4)))
        verdict = storage.post(body, "json")
        ref = reference_all([{"id": "supplement", "content_type": "json", "received_at_ms": None, "body_b64": base64.b64encode(body).decode()}])["supplement"]
        require(
            "supplement batch matches reference and is stored",
            verdict == {"status": ref["status"], "error": ref["error"], "accepted": ref["accepted"], "rejected": ref["rejected"]} and verdict["accepted"] == len(supplement) and not verdict["rejected"],
            {"collector": verdict, "reference": ref},
            f"202 accepted {len(supplement)}",
            "Review check 3: v1.1 fields must be accepted when the reference accepts them.",
            "POST supplement batch",
        )

        window = {"from": iso(now - timedelta(hours=3)), "to": iso(now + timedelta(minutes=5))}
        status, tools = storage.analytics("tools", **window)
        status_r, reliability = storage.analytics("reliability", **window)
        status_c, cost = storage.analytics("cost", **window)
        status_p, protocol = storage.analytics("protocol", **window)
        status_o, overview = storage.analytics("overview", range="24h")
        require("analytics routes 200", all(code == 200 for code in (status, status_r, status_c, status_p, status_o)),
                [status, status_r, status_c, status_p, status_o], "all 200",
                "Analytics routes must answer for ingested v1.1 data.", "GET analytics tools/reliability/cost/protocol/overview")

        facts = json.loads(psql(
            "SELECT coalesce(json_agg(attrs), '[]'::json) FROM analytics_facts WHERE project_id='%s' AND attrs ? 'request_id'" % storage.id
        ) or "[]")
        timeout = next((row for row in facts if row.get("request_id") == "req-timeout"), None)
        require("facts keep v1.1 metric attrs", timeout is not None and timeout.get("output_chars") == 100 and timeout.get("output_items") == 2 and timeout.get("input_schema_valid") is False and timeout.get("error_kind") == "timeout" and timeout.get("error_code") == -32000 and timeout.get("progress_events") == 2,
                timeout, "output_chars 100, error_code -32000, schema flag false",
                "Author brief: events store error_kind, error_code, request_id, output_chars, output_items, schema flags.",
                "SELECT attrs FROM analytics_facts WHERE request_id=req-timeout")
        derived = psql("SELECT count(*) FROM analytics_facts WHERE project_id='%s' AND attrs->>'derived'='true'" % storage.id)
        require("derived lands in analytics facts", derived not in ("", "0"), derived, "at least 1",
                "Author brief: derived is stored and readable.", "SELECT derived FROM analytics_facts")
        catalog = json.loads(psql(
            "SELECT coalesce(json_agg(json_build_object('tool',tool,'annotations',annotations,'schema_hash',schema_hash,'catalog_hash',catalog_hash,'truncated',truncated)), '[]'::json) FROM tool_catalog WHERE project_id='%s'" % storage.id
        ) or "[]")
        listed = next((row for row in catalog if row["tool"] == "listed_tool"), None)
        require("tool_catalog stores names, annotations, schema_hash, catalog_hash",
                listed and listed["schema_hash"] == "e" * 64 and listed["catalog_hash"] == "1" * 64 and "readOnly" in (listed["annotations"] or []),
                listed, "listed_tool with readOnly, schema hash, catalog hash",
                "Author brief: tool_catalog is filled from tools.listed.",
                "SELECT tool_catalog")
        identities = json.loads(psql(
            "SELECT coalesce(json_agg(json_build_object('kind',kind,'identity_key',identity_key)), '[]'::json) FROM identities WHERE project_id='%s'" % storage.id
        ) or "[]")
        pairs = {(row["kind"], row["identity_key"]) for row in identities}
        require("identities.kind follows subject_kind precedence",
                ("strong", "user-oauth") in pairs and ("key", "kid_api") in pairs and ("key", "kid_header") in pairs and ("strong", "user-apikey") not in pairs and ("strong", "user-header") not in pairs,
                sorted(map(list, pairs)),
                "oauth subject is strong; api_key and header fall through to key_id",
                "Analytics contract identity precedence; author brief identities.kind uses caller.subject_kind.",
                "SELECT kind, identity_key FROM identities")
        init = json.loads(psql(
            "SELECT coalesce(json_agg(json_build_object('duration_ms',duration_ms,'is_error',is_error,'attrs',attrs)), '[]'::json) FROM events WHERE project_id='%s' AND type='mcp.initialize' AND session_id='s_proto'" % storage.id
        ) or "[]")
        require("initialize duration and error are columns",
                any(row["duration_ms"] == 42 and row["is_error"] is False for row in init) and any(row["is_error"] is True and row["duration_ms"] == 80 for row in init),
                init, "duration 42 success and duration 80 error",
                "Author brief: initialize duration/error are stored.",
                "SELECT duration_ms, is_error FROM events WHERE type=mcp.initialize")

        def not_null(title, obj, path, contract):
            value = getpath(obj, path)
            require(title, value is not None, {"path": path, "value": value}, "a number or object, not null", contract, f"GET analytics {path}")

        not_null("handshake success_rate", reliability, "handshake.success_rate", "Review check 3: handshake is a real number when initialize is_error was ingested.")
        not_null("handshake p95", reliability, "handshake.p95", "Review check 3: handshake duration is readable.")
        not_null("timeout count", reliability, "timeouts.count", "Review check 3: timeouts are real numbers when error_kind timeout was ingested.")
        not_null("hallucinated count on a complete catalogue", reliability, "hallucinated_tools.count", "Review check 3: hallucinated tools versus the catalogue.")
        not_null("context tokens", overview, "tiles.context_tokens.value", "Review check 3: tokens from output_chars.")
        not_null("sampling requests", protocol, "sampling.requests", "Review check 3: protocol counters.")
        not_null("elicitation requests", protocol, "elicitation.requests", "Review check 3: protocol counters.")
        not_null("tasks created", protocol, "tasks.created", "Review check 3: protocol counters.")
        not_null("discovery requests", protocol, "discovery.requests", "Review check 3: discovery load.")
        not_null("discovery p95", protocol, "discovery.p95", "Review check 3: discovery duration.")
        not_null("long calls", protocol, "progress.long_calls", "Review check 3: protocol progress.")
        auth_reasons = {row.get("reason") for row in (reliability.get("auth_failures") or [])}
        require("auth failure reasons", {"expired", "missing", "invalid", "scope"} <= auth_reasons, sorted(auth_reasons),
                "expired, missing, invalid, scope from ingested error events",
                "Review check 3: auth reason is readable through the analytics route.",
                "GET reliability auth_failures")
        tool_rows = {row["tool"]: row for row in tools.get("tools") or []}
        listed_row = tool_rows.get("listed_tool")
        require("schema failure counts", listed_row and listed_row["schema_failures"]["input"] is not None and listed_row["schema_failures"]["output"] is not None and (listed_row["schema_failures"]["input"] or 0) >= 1,
                listed_row["schema_failures"] if listed_row else None, "input and output counts, input >= 1",
                "Review check 3: schema failures are real numbers when the flags were ingested.",
                "GET tools schema_failures")
        require("error split is populated", listed_row and all(listed_row["errors"][k] is not None for k in ("tool", "protocol", "timeout", "cancelled", "unknown")) and listed_row["errors"]["timeout"] >= 1,
                listed_row["errors"] if listed_row else None, "timeout >= 1 and the other kinds numeric",
                "Review check 3: error split replaces null once error_kind exists.",
                "GET tools errors")
        ghost = (reliability.get("hallucinated_tools") or {}).get("names") or []
        require("ghost_tool is hallucinated against the complete catalogue", "ghost_tool" in ghost, ghost, "names include ghost_tool",
                "Review check 3: hallucinated tools versus catalogue.", "GET reliability hallucinated_tools.names")
        big = next((row for row in facts if row.get("request_id") == "big"), None)
        # error_code on mcp.request may be the only big integer. Query it directly.
        big_row = psql("SELECT attrs->>'error_code' FROM analytics_facts WHERE project_id='%s' AND attrs->>'request_id'='big'" % storage.id)
        require("error_code above 2^53 keeps its decimal digits", big_row == "9007199254740993", big_row, "9007199254740993",
                "A v1.1 error_code the reference accepts must not lose integer precision in storage.",
                "SELECT attrs->>'error_code' WHERE request_id=big")

        # Isolated token numerator: output_chars 100 must beat output_bytes 4 (25, not 1).
        tokens = Project("tokens", "tokens")
        ts = iso(now - timedelta(minutes=2))
        token_body = batch_bytes([event("tool.called", tool_attrs(tool="chars_only", output_chars=100, output_bytes=4, output_items=1), ts=ts)], sent_at=iso(now - timedelta(minutes=1)))
        token_verdict = tokens.post(token_body, "json")
        status, cost_one = tokens.analytics("cost", **window)
        measured = cost_one.get("total_tokens_est")
        require("tokens come from output_chars", token_verdict["accepted"] == 1 and measured == 25, {"verdict": token_verdict, "total_tokens_est": measured, "by_tool": cost_one.get("by_tool")},
                "total_tokens_est 25 (100/4), not 1 (4/4)",
                "Analytics contract: token estimate uses output_chars when present, else output_bytes, divided by 4.",
                "POST chars_only output_chars=100 output_bytes=4; GET cost")

        catalogue = Project("catalogue", "catalogue")
        base = now - timedelta(minutes=3)
        def listed(offset, attrs, session="s_cat"):
            return event("tools.listed", attrs, ts=iso(base + timedelta(seconds=offset)), session=session)
        def call(offset, name):
            return event("tool.called", tool_attrs(tool=name), ts=iso(base + timedelta(seconds=offset)), session="s_cat")
        steps = [
            ("full", [listed(0, {"count": 2, "tools": [{"name": "alpha"}, {"name": "beta"}], "truncated": False, "catalog_hash": "a" * 64, "is_error": False, "source": "list", "duration_ms": 2}), call(1, "alpha")]),
            # A failed snapshot must not carry count, tools, or catalog_hash (schema).
            ("failed", [listed(2, {"is_error": True, "duration_ms": 4})]),
            ("changed", [listed(3, {"count": 2, "tools": [{"name": "alpha"}, {"name": "delta"}], "truncated": False, "catalog_hash": "c" * 64, "is_error": False, "source": "list_changed", "duration_ms": 2})]),
            ("truncated", [listed(4, {"count": 9, "tools": [{"name": "alpha"}], "truncated": True, "catalog_hash": "d" * 64, "is_error": False, "source": "list_changed", "duration_ms": 2}), call(5, "not_in_truncated")]),
        ]
        observed = {}
        for name, events in steps:
            body = batch_bytes(events, sent_at=iso(base + timedelta(seconds=10)))
            verdict = catalogue.post(body, "json")
            ref = reference_all([{"id": name, "content_type": "json", "received_at_ms": None, "body_b64": base64.b64encode(body).decode()}])[name]
            if verdict["rejected"] or verdict["accepted"] != len(events) or verdict["rejected"] != ref["rejected"]:
                record("blocker", f"catalogue step {name} was not stored as the reference accepts it", "POST " + name, {"collector": verdict, "reference": ref}, "accepted all events", "Review check 4 setup must be accepted.")
            status, tools = catalogue.analytics("tools", **window)
            snap = json.loads(psql("SELECT json_build_object('tools', tools, 'truncated', truncated, 'advertised', advertised_count, 'hash', catalog_hash) FROM catalog_snapshots WHERE project_id='%s'" % catalogue.id) or "null")
            observed[name] = {"dead": (tools.get("catalog") or {}).get("dead"), "snap": snap, "status": status}
        full, failed, changed, truncated = (observed[name] for name in ("full", "failed", "changed", "truncated"))
        require("a complete tools.listed marks only uncalled listed tools dead",
                full["snap"]["tools"] == ["alpha", "beta"] and full["snap"]["truncated"] is False and full["dead"] == ["beta"],
                full, "tools [alpha, beta], dead [beta]",
                "Review check 4 baseline: a complete catalogue marks advertised-but-uncalled tools dead.",
                "GET tools after the first tools.listed")
        require("failed tools.listed does not clear a known catalogue",
                failed["snap"]["tools"] == ["alpha", "beta"] and "zzz" not in failed["snap"]["tools"] and failed["dead"] == ["beta"] and failed["snap"]["hash"] == "a" * 64,
                failed, "snapshot unchanged: alpha, beta, hash a*64, dead [beta]",
                "Review check 4: a failed snapshot (is_error) must not clear a known catalogue.",
                "GET tools and catalog_snapshots after is_error tools.listed")
        require("list_changed replaces the catalogue",
                changed["snap"]["tools"] == ["alpha", "delta"] and changed["dead"] == ["delta"] and "beta" not in changed["dead"] and "beta" not in changed["snap"]["tools"],
                changed, "tools [alpha, delta], dead [delta], beta gone",
                "Review check 4: list_changed replaces the known catalogue.",
                "GET tools after source=list_changed")
        status_r, reliability = catalogue.analytics("reliability", **window)
        names = (reliability.get("hallucinated_tools") or {}).get("names")
        count = (reliability.get("hallucinated_tools") or {}).get("count")
        require("truncated tools.listed with catalog_hash does not mark unlisted tools dead",
                truncated["snap"]["tools"] == ["alpha"] and truncated["snap"]["truncated"] is True and truncated["snap"]["advertised"] == 9 and truncated["snap"]["hash"] == "d" * 64 and "beta" not in (truncated["dead"] or []) and "delta" not in (truncated["dead"] or []) and "not_in_truncated" not in (truncated["dead"] or []) and "zzz" not in (truncated["dead"] or []),
                truncated, "tools [alpha], truncated, advertised 9, unlisted names absent from dead",
                "Review check 4: truncated: true with a catalog_hash must not mark unlisted tools as dead (coverage unknown).",
                "GET tools after truncated list_changed and a call to an unlisted name")
        require("truncated catalogue does not call unlisted tools hallucinated",
                "not_in_truncated" not in (names or []) and "beta" not in (names or []) and "delta" not in (names or []),
                {"count": count, "names": names},
                "not_in_truncated, beta, and delta absent from hallucinated names",
                "Review check 4: coverage is unknown when truncated is true.",
                "GET reliability hallucinated_tools")

        print("delivery", flush=True)
        sinks = start_sinks()
        env2 = env.copy()
        env2["WEBHOOK_URL"] = "http://127.0.0.1:26113/hook"
        env2["WEBHOOK_FAIL_FLAG"] = str(FAIL_FLAG)
        env2["DATABASE_URL"] = env["DATABASE_URL"]
        probe = subprocess.run([str(DELIVERY_BIN)], env=env2, capture_output=True, text=True, timeout=120)
        if probe.returncode != 0:
            record("blocker", "delivery probe crashed", "delivery_probe", probe.stderr[-2000:] + probe.stdout[-1000:], "exit 0",
                   "Review check 5: failures to deliver must not crash the worker.")
            outbox = None
        else:
            outbox = json.loads(probe.stdout.strip().splitlines()[-1])
            ok("delivery probe exit", outbox)
        time.sleep(0.3)
        mails = sorted(MAIL_DIR.glob("*.eml"))
        decoded = [decode_mail(path.read_bytes()) for path in mails]
        hooks = [json.loads(path.read_text()) for path in sorted(HOOK_DIR.glob("*.json"))]
        digest_mails = [mail for mail in decoded if mail["kind"] == "digest"]
        digest_mail = digest_mails[0] if digest_mails else {"raw": "", "html": "", "text": "", "subject": ""}
        digest_hooks = [h for h in hooks if h.get("body", {}).get("type") == "digest"]
        alert_hooks = [h for h in hooks if h.get("body", {}).get("type") == "alert"]
        require("digest email and webhook were delivered", bool(digest_mails) and len(digest_hooks) == 1, {"mails": len(mails), "digest_mails": len(digest_mails), "digest_hooks": len(digest_hooks), "subjects": [m["subject"] for m in decoded]},
                "one digest webhook and one digest email",
                "Author brief: Monday 07:00 digest via SMTP and webhook.",
                "delivery::queue(2026-10-12T07:00:00Z) then flush against local sinks")
        html = digest_mail["html"]
        text = digest_mail["text"]
        require("email is multipart plain and html in the mcpramen look",
                digest_mail["raw"].lower().count("multipart/alternative") >= 1 and "text/plain" in digest_mail["raw"] and "text/html" in digest_mail["raw"] and "mcpramen signals" in html and "Krona One" in html and "#ca8a04" in html and "#fafaf9" in html and "<link" not in html.lower() and "@import" not in html and "url(" not in html.lower() and "<script" not in html.lower() and "super-secret-probe-key" not in html and "super-secret-probe-key" not in text and env["SIGNALS_ADMIN_TOKEN"] not in html and "&lt;script&gt;" in html and text.strip() != "",
                {"subject": digest_mail["subject"], "html_has_brand": "mcpramen signals" in html, "krona": "Krona One" in html, "escaped": "&lt;script&gt;" in html, "raw_script": "<script" in html.lower(), "text_excerpt": text[:400], "html_excerpt": html[:500]},
                "inline stone/gold CSS, Krona fallback, escaped project name, no external assets, no probe key or admin token, non-empty text part",
                "Review check 5: HTML and text emails, mcpramen look, inline CSS, no external assets, no secrets.",
                "decode saved SMTP DATA")
        hook_types = [h.get("content_type") for h in digest_hooks]
        require("webhook digest is JSON", bool(digest_hooks) and digest_hooks[0].get("body", {}).get("week") == "2026-W41" and "application/json" in (digest_hooks[0].get("content_type") or ""),
                {"content_type": hook_types, "week": (digest_hooks[0].get("body") or {}).get("week") if digest_hooks else None, "keys": sorted((digest_hooks[0].get("body") or {}).keys()) if digest_hooks else None},
                "application/json type=digest week=2026-W41",
                "Author brief: webhook JSON POST of the digest.",
                "inspect webhook body")
        states = [((h.get("body") or {}).get("rule"), (h.get("body") or {}).get("state")) for h in alert_hooks]
        require("alert transitions deliver once each", states.count(("errors", "firing")) == 1 and states.count(("errors", "ok")) == 1 and states.count(("latency", "firing")) == 1,
                states, "errors/firing once, errors/ok once, latency/firing once after retry",
                "Review check 5: alert transitions deliver once per transition.",
                "queue/flush twice per inserted alert; webhook 503 once then recovery")
        if outbox:
            failed = [row for row in outbox["outbox"] if row["dedupe_key"].startswith("alert:") and row["attempts"] > 1]
            digest_rows = [row for row in outbox["outbox"] if row["dedupe_key"].startswith("digest:")]
            require("a refused delivery retries without crashing and does not resend the digest",
                    all(row["delivered"] and row["attempts"] == 1 for row in digest_rows) and failed and all(row["delivered"] for row in outbox["outbox"]),
                    outbox, "digest attempts stay 1; failed alert rows end delivered after retry",
                    "Review check 5: failures to deliver must not crash the worker.",
                    "flush with SMTP port closed and webhook 503, then flush again")
        status, _, _ = http("GET", "/readyz")
        require("collector stayed up after delivery failures", status == 200 and server.poll() is None, {"readyz": status, "exit": server.poll()}, "readyz 200 and process alive",
                "Review check 5: delivery failure must not crash the worker.", "GET /readyz after the delivery probe")
        sinks["stop"]()

        compose()
    except Exception as exc:
        record("blocker", "probe crashed before finishing", "python3 reports/review-v11-r1/probe.py", repr(exc), "the probe finishes and writes probe-result.json", "A crashed probe is not evidence. The traceback is in the probe stderr.")
        raise
    finally:
        if server.poll() is None:
            server.terminate()
            try:
                server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                server.kill()
        log.close()
        result = {"findings": findings, "verified": verified}
        (OUT / "probe-result.json").write_text(json.dumps(result, indent=2))
        print(json.dumps({"findings": len(findings), "verified": len(verified), "titles": [f["title"] for f in findings]}, indent=2))


def start_sinks():
    class Hook(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            if FAIL_FLAG.exists():
                self.send_response(503)
                self.end_headers()
                return
            name = str(time.time_ns())
            (HOOK_DIR / f"{name}.json").write_text(json.dumps({
                "content_type": self.headers.get("Content-Type"),
                "body": json.loads(raw.decode() or "null"),
            }))
            self.send_response(204)
            self.end_headers()

        def log_message(self, *_args):
            return

    httpd = ThreadingHTTPServer(("127.0.0.1", 26113), Hook)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    smtp = SmtpSink(26114, MAIL_DIR)
    smtp.start()
    return {"stop": lambda: (httpd.shutdown(), smtp.stop.set())}


class SmtpSink(threading.Thread):
    def __init__(self, port, directory):
        super().__init__(daemon=True)
        self.directory = directory
        self.stop = threading.Event()
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", port))
        self.sock.listen(40)
        self.sock.settimeout(0.5)
        self.count = 0

    def run(self):
        while not self.stop.is_set():
            try:
                conn, _addr = self.sock.accept()
            except socket.timeout:
                continue
            threading.Thread(target=self.handle, args=(conn,), daemon=True).start()

    def handle(self, conn):
        conn.settimeout(20)
        buf = b""
        body = False
        data = b""

        def send(text):
            conn.sendall(text.encode())

        try:
            send("220 local SMTP\r\n")
            while True:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                buf += chunk
                while True:
                    if body:
                        marker = buf.find(b"\r\n.\r\n")
                        if marker < 0:
                            break
                        data = buf[:marker]
                        buf = buf[marker + 5:]
                        body = False
                        self.count += 1
                        (self.directory / f"{time.time_ns()}.eml").write_bytes(data)
                        send("250 queued\r\n")
                    else:
                        split = buf.find(b"\r\n")
                        if split < 0:
                            break
                        line = buf[:split].decode(errors="replace")
                        buf = buf[split + 2:]
                        upper = line.upper()
                        if upper.startswith("EHLO") or upper.startswith("HELO"):
                            send("250-localhost\r\n250 8BITMIME\r\n")
                        elif upper == "DATA":
                            body = True
                            send("354 send\r\n")
                        elif upper == "QUIT":
                            send("221 bye\r\n")
                            return
                        else:
                            send("250 ok\r\n")
        except OSError:
            return
        finally:
            conn.close()


def decode_mail(raw):
    msg = email.message_from_bytes(raw, policy=email.policy.default)
    text, html = "", ""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                text += part.get_content()
            elif part.get_content_type() == "text/html":
                html += part.get_content()
    else:
        text = msg.get_content()
    subject = str(msg.get("subject") or "")
    kind = "digest" if "weekly digest" in subject.lower() or "weekly digest" in text.lower() else "alert"
    return {"raw": raw.decode(errors="replace"), "subject": subject, "text": text, "html": html, "kind": kind}


def compose():
    # Root compose loads env_file: .env (pre-existing). A clean clone has
    # .env.example and README says to run scripts/init-env.sh first. Use that
    # example only for the config render, then remove it.
    env_path = ROOT / ".env"
    created_env = False
    if not env_path.exists():
        env_path.write_text((ROOT / ".env.example").read_text())
        created_env = True
    try:
        _compose_cases()
    finally:
        if created_env and env_path.exists():
            env_path.unlink()


def _compose_cases():
    cases = {
        "docker-compose.yml": {
            "args": ["docker", "compose", "-f", "docker-compose.yml", "config"],
            "env": {
                "SIGNALS_ADMIN_TOKEN": "a" * 32,
                "SIGNALS_SESSION_SECRET": "b" * 32,
                "SIGNALS_BOOTSTRAP_EMAIL": "owner@example.test",
                "SIGNALS_BOOTSTRAP_PASSWORD": "c" * 24,
            },
        },
        "deploy/compose/compose.yaml": {
            "args": ["docker", "compose", "-f", "deploy/compose/compose.yaml", "config"],
            "env": {
                "POSTGRES_PASSWORD": "d" * 24,
                "SIGNALS_PUBLIC_URL": "http://127.0.0.1:8300",
                "SIGNALS_CORS_ORIGINS": "http://127.0.0.1:8300",
                "SIGNALS_ADMIN_TOKEN": "a" * 32,
                "SIGNALS_SESSION_SECRET": "b" * 32,
                "SIGNALS_BOOTSTRAP_EMAIL": "owner@example.test",
                "SIGNALS_BOOTSTRAP_PASSWORD": "c" * 24,
            },
        },
    }
    for name, spec in cases.items():
        env = os.environ.copy()
        env.update(spec["env"])
        result = subprocess.run(spec["args"], cwd=ROOT, env=env, capture_output=True, text=True)
        rendered = result.stdout
        shm_ok = "shm_size" in rendered and ("1073741824" in rendered or "1g" in rendered.lower() or "1gb" in rendered.lower())
        require(
            f"{name} config sets postgres shm_size 1g",
            result.returncode == 0 and shm_ok,
            {"exit": result.returncode, "stderr": result.stderr[-500:], "shm": [line.strip() for line in rendered.splitlines() if "shm" in line.lower()]},
            "exit 0 and shm_size of 1 GiB",
            "Review check 6: shm_size 1g in both compose files and docker compose config from a clean clone.",
            " ".join(spec["args"]),
        )
    readme = (ROOT / "deploy/compose/README.md").read_text()
    require("README documents shm_size 1g", "shm_size: 1g" in readme and "64" in readme, "documented" if "shm_size: 1g" in readme else "missing",
            "deploy/compose/README.md mentions shm_size: 1g",
            "Author brief: document shm_size in deploy/compose/README.md.",
            "read deploy/compose/README.md")


if __name__ == "__main__":
    main()
