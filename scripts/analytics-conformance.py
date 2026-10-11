#!/usr/bin/env python3
"""Run pinned wire and transport fixtures using an already migrated isolated DB.
Requires DATABASE_URL and the caller-owned ANALYTICS_PG_CONTAINER; never uses host psql.
"""
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request
import uuid

root = Path(__file__).resolve().parents[1]
base = 'http://127.0.0.1:25483'
admin = 'analytics-isolated-admin-token-32-characters'
env = {**os.environ, 'SIGNALS_CONFORMANCE_CLOCK': 'sent_at',
       'SIGNALS_BIND': '127.0.0.1:25483', 'SIGNALS_PUBLIC_URL': base,
       'SIGNALS_ADMIN_TOKEN': admin, 'SIGNALS_SESSION_SECRET': 'analytics-isolated-session-secret-32-characters',
       'SIGNALS_BOOTSTRAP_EMAIL': 'owner@analytics.test', 'SIGNALS_BOOTSTRAP_PASSWORD': 'analytics-test-password'}
with open('/tmp/analytics-conformance-server.log', 'w') as log:
    server = subprocess.Popen([str(root / 'target/debug/signals'), 'serve'], env=env, stdout=log, stderr=log)
    try:
        for _ in range(150):
            if server.poll() is not None:
                raise RuntimeError('Collector exited; inspect /tmp/analytics-conformance-server.log')
            try:
                with urllib.request.urlopen(base + '/readyz', timeout=1) as response:
                    if response.status == 200:
                        break
            except OSError:
                pass
            time.sleep(.1)
        else:
            raise RuntimeError('Collector not ready')
        def provision(route, data):
            req = urllib.request.Request(base + '/v1/admin/' + route, json.dumps(data).encode(), headers={'Authorization': 'Bearer ' + admin, 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req) as response:
                return json.load(response)
        tenant = provision('tenants', {'slug': 'conformance-' + uuid.uuid4().hex[:10], 'name': 'Conformance'})
        project = provision('projects', {'tenant_id': tenant['id'], 'slug': 'fixtures', 'name': 'Fixtures'})
        key = provision('keys', {'project_id': project['id'], 'label': 'Fixtures', 'scopes': ['ingest', 'read']})['secret']
        subprocess.run(['docker', 'exec', os.environ['ANALYTICS_PG_CONTAINER'], 'psql', '-U', 'postgres', '-d', 'signals', '-v', 'ON_ERROR_STOP=1', '-c', f"UPDATE projects SET rate_events_per_min=1000000,rate_bytes_per_min=1073741824 WHERE id='{project['id']}'"], check=True)
        subprocess.run(['python3', str(root / 'scripts/spec-conformance.py'), '--url', base], env={**env, 'SIGNALS_API_KEY': key}, check=True)
        read = provision('keys', {'project_id': project['id'], 'label': 'Read', 'scopes': ['read']})['secret']
        subprocess.run(['python3', str(root / 'scripts/transport-conformance.py'), '--url', base], env={**env, 'SIGNALS_API_KEY': key, 'SIGNALS_READ_KEY': read}, check=True)
    finally:
        server.terminate()
        try:
            server.wait(timeout=15)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()
