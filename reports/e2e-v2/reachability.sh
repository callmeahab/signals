#!/bin/bash
# Confirm the collector and eggs answer only on the VPN address.
set -u
echo "=== listeners ==="
ss -ltnp | awk 'NR==1 || /:8300|:8000|:8001|:5432/'
echo "=== docker ports ==="
for c in signals-signals-1 signals-postgres-1 egg-node-app-1 egg-python-app-1; do
  echo -n "$c "
  docker port "$c" || true
done
probe() {
  local label="$1" url="$2"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 5 "$url" || true)
  if [ -z "$code" ]; then code="000"; fi
  echo "$label $url $code"
}
echo "=== http ==="
for port in 8300 8000 8001; do
  probe vpn "http://10.8.0.11:${port}/healthz"
  probe lan "http://192.168.22.23:${port}/healthz"
  probe wildcard "http://0.0.0.0:${port}/healthz"
  probe loopback "http://127.0.0.1:${port}/healthz"
done
echo "=== postgres ==="
probe postgres-vpn "http://10.8.0.11:5432/"
probe postgres-lan "http://192.168.22.23:5432/"
probe postgres-loop "http://127.0.0.1:5432/"
echo "=== published bindings ==="
docker inspect signals-signals-1 egg-node-app-1 egg-python-app-1 signals-postgres-1 \
  --format '{{.Name}} restart={{.HostConfig.RestartPolicy.Name}} ports={{json .HostConfig.PortBindings}}'
