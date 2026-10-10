#!/usr/bin/env bash
# Review round 2, check 5: no regression in the real SDK path.
#
# Runs the Python SDK example (`examples/basic_streamable_http`) against a
# collector on the NORMAL clock (no SIGNALS_CONFORMANCE_CLOCK), drives one MCP
# tool call with the `mcp` client, and shows the resulting events in the read
# API. Exits non-zero unless the read API returns a `tool.called` row for the
# `add` tool whose `source` names the SDK.
#
#   COLLECTOR=http://127.0.0.1:29352 \
#   SIGNALS_KEY=... SIGNALS_READ_KEY=... PROJECT=<uuid> \
#   reports/review-r2/sdk_probe.sh
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SDK="${SDK:-/home/vuk/orca/projects/signals-python}"
COLLECTOR="${COLLECTOR:?set COLLECTOR to the wall-clock collector base URL}"
PROJECT="${PROJECT:?set PROJECT to its project id}"
EXAMPLE_PORT="${EXAMPLE_PORT:-29353}"
log="$root/target/review-r2/sdk-example.log"
mkdir -p "$(dirname "$log")"

echo "== starting the SDK example on 127.0.0.1:$EXAMPLE_PORT against $COLLECTOR"
(
  cd "$SDK"
  SIGNALS_URL="$COLLECTOR" SIGNALS_KEY="$SIGNALS_KEY" SIGNALS_DEBUG=true \
  SIGNALS_CAPTURE_ARGS=true PORT="$EXAMPLE_PORT" \
    uv run --project "$SDK" python examples/basic_streamable_http/main.py
) >"$log" 2>&1 &
example=$!
trap 'kill "$example" 2>/dev/null || true' EXIT

for _ in $(seq 1 200); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$EXAMPLE_PORT/mcp" -X POST \
      -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
      -d '{"jsonrpc":"2.0","id":1,"method":"ping"}' 2>/dev/null; then break; fi
  if ! kill -0 "$example" 2>/dev/null; then echo "example exited early:"; tail -30 "$log"; exit 1; fi
  sleep 0.25
done

echo "== driving one tool call"
uv run --project "$SDK" python "$root/reports/review-r2/sdk_client.mcp.py" \
  "http://127.0.0.1:$EXAMPLE_PORT/mcp"

echo "== stopping the example so the SDK flushes on close"
kill -TERM "$example" 2>/dev/null || true
wait "$example" 2>/dev/null || true
trap - EXIT
echo "-- example log tail"
tail -15 "$log"

echo "== read API on $COLLECTOR"
python3 - "$COLLECTOR" "$PROJECT" "${SIGNALS_READ_KEY:-$SIGNALS_KEY}" <<'PY'
import json, sys, time, urllib.request, urllib.error
base, project, key = sys.argv[1:4]

def get(path):
    req = urllib.request.Request(base.rstrip("/") + path, headers={"Authorization": "Bearer " + key})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.status, {"body": e.read().decode(errors="replace")}

deadline = time.time() + 60
items = []
while time.time() < deadline:
    status, page = get(f"/v1/projects/{project}/events")
    items = page.get("items", []) if isinstance(page, dict) else []
    if items:
        break
    time.sleep(2)
print("GET /v1/projects/{id}/events ->", status, len(items), "events")
for e in items:
    print(json.dumps({k: e[k] for k in ("ts", "type", "tool", "is_error", "session_id") if k in e}))
calls = [e for e in items if e.get("type") == "tool.called" and e.get("tool") == "add"]
print("tool.called rows for add:", len(calls))
if calls:
    print("sample row:", json.dumps(calls[0], indent=2)[:1600])
kinds = sorted({e["type"] for e in items})
print("types:", kinds)
sources = sorted({json.dumps(e.get("source"), sort_keys=True) for e in items})
print("sources:", sources)
status, tools = get(f"/v1/projects/{project}/tools?range=24h")
print("GET /tools ->", status, json.dumps(tools)[:400])
ok = bool(calls) and all('"sdk": "python"' in s or '"sdk":"python"' in s for s in sources)
print("RESULT:", "PASS" if ok else "FAIL")
raise SystemExit(0 if ok else 1)
PY
