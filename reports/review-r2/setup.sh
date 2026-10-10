#!/usr/bin/env bash
# Review round 2 harness: start the collector from this worktree against the
# disposable review Postgres and provision a 30-day-retention project with
# ingest+read keys. Writes key material under target/review-r2/ (gitignored).
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_PORT="${PG_PORT:-29350}"
PG_CONTAINER="${PG_CONTAINER:-signals-review-r2-pg}"
PORT="${PORT:-29351}"
CLOCK="${CLOCK:-sent_at}"
DB="${DB:-signals}"
BASE="http://127.0.0.1:${PORT}"
TOKEN="review-r2-admin-token-32-characters"
out="$root/target/review-r2/$PORT"
mkdir -p "$out"

export DATABASE_URL="postgres://signals:signals@127.0.0.1:${PG_PORT}/${DB}"
env_args=(
  "DATABASE_URL=$DATABASE_URL"
  "SIGNALS_BIND=127.0.0.1:${PORT}"
  "SIGNALS_PUBLIC_URL=$BASE"
  "SIGNALS_URL=$BASE"
  "SIGNALS_ADMIN_TOKEN=$TOKEN"
  "SIGNALS_SESSION_SECRET=review-r2-session-secret-32-characters"
  "SIGNALS_BOOTSTRAP_EMAIL=owner@signals.test"
  "SIGNALS_BOOTSTRAP_PASSWORD=signals-test-password"
)
[ "$CLOCK" = "none" ] || env_args+=("SIGNALS_CONFORMANCE_CLOCK=$CLOCK")

env "${env_args[@]}" "$root/target/debug/signals" serve >"$out/server.log" 2>&1 &
echo $! > "$out/server.pid"
for _ in $(seq 1 200); do
  if curl -fsS "$BASE/readyz" >/dev/null 2>&1; then break; fi
  sleep 0.2
done
curl -fsS "$BASE/readyz" >/dev/null

admin() { curl -fsS -X POST "$BASE/v1/admin/$1" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$2"; }
tenant=$(admin tenants "{\"slug\":\"review-r2-$PORT\",\"name\":\"Review r2 $PORT\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
project=$(admin projects "{\"tenant_id\":\"$tenant\",\"slug\":\"fixtures\",\"name\":\"Fixtures\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
admin keys "{\"project_id\":\"$project\",\"label\":\"Ingest\",\"scopes\":[\"ingest\",\"read\"]}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["secret"])' > "$out/key"
admin keys "{\"project_id\":\"$project\",\"label\":\"Read\",\"scopes\":[\"read\"]}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["secret"])' > "$out/read-key"
echo "$project" > "$out/project"
docker exec -i "$PG_CONTAINER" psql -U signals -d "$DB" -v ON_ERROR_STOP=1 \
  -c "UPDATE projects SET retention_days=30,rate_events_per_min=100000,rate_bytes_per_min=1073741824 WHERE id='$project'"
echo "collector $BASE project $project clock=$CLOCK keys in $out"
