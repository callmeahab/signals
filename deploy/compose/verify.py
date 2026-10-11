#!/usr/bin/env python3
"""Acceptance checks for a deployed Signals collector. Prints no secrets.

Environment:
  SIGNALS_URL       collector base URL (default http://127.0.0.1:8300)
  SIGNALS_KEYS      comma-separated ingest keys to check with /v1/whoami (optional)
  SIGNALS_EMAIL / SIGNALS_PASSWORD   dashboard login (optional; enables the read checks)
"""
import http.cookiejar, json, os, sys, urllib.request

base = os.environ.get("SIGNALS_URL", "http://127.0.0.1:8300").rstrip("/")
keys = [k for k in os.environ.get("SIGNALS_KEYS", "").split(",") if k]
email, password = os.environ.get("SIGNALS_EMAIL"), os.environ.get("SIGNALS_PASSWORD")
failures = 0

def get(path, headers=None, opener=None):
    req = urllib.request.Request(base + path, headers=headers or {})
    with (opener or urllib.request.build_opener()).open(req, timeout=20) as r:
        return r.status, r.read().decode()

for path in ("/healthz", "/readyz"):
    status, body = get(path)
    ok = status == 200
    failures += not ok
    print(f"GET {path} {status} {body.strip()[:40]}")

for key in keys:
    try:
        status, body = get("/v1/whoami", {"Authorization": "Bearer " + key})
        doc = json.loads(body)
        print(f"whoami {status} project={doc.get('project')} label={doc.get('label')} scopes={doc.get('scopes')}")
        failures += status != 200
    except Exception as exc:  # noqa: BLE001
        failures += 1
        print(f"whoami failed for a key: {type(exc).__name__}")

if email and password:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    req = urllib.request.Request(base + "/v1/auth/login", json.dumps({"email": email, "password": password}).encode(),
                                 headers={"Content-Type": "application/json", "Origin": base})
    with opener.open(req, timeout=20) as r:
        me = json.load(r)
    print(f"login {r.status} projects={len(me.get('projects', []))}")
    for project in me.get("projects", []):
        status, body = get(f"/v1/projects/{project['id']}/analytics/overview?range=7d", opener=opener)
        tiles = json.loads(body).get("tiles", {})
        calls = (tiles.get("tool_calls") or {}).get("value")
        print(f"overview {project.get('slug')} {status} tool_calls={calls}")
        failures += status != 200

print("PASS" if not failures else f"FAIL ({failures} checks)")
sys.exit(1 if failures else 0)
