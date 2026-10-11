#!/usr/bin/env python3
"""Exercise the deployed eggs and collector; never print credentials."""
import http.cookiejar
import json
import shlex
import subprocess
import time
import urllib.request
from pathlib import Path

BASE = 'http://10.8.0.11:8300'


def run(args, source=None):
    print('$ ' + shlex.join(args), flush=True)
    result = subprocess.run(args, input=source, text=True, capture_output=True, check=True)
    print(result.stdout.strip(), flush=True)
    return result.stdout


for endpoint in ['/healthz', '/readyz']:
    with urllib.request.urlopen(BASE + endpoint, timeout=5) as response:
        print('GET', endpoint, response.status, response.read().decode())

for egg in ['egg-node', 'egg-python']:
    values = {}
    for line in Path('/home/vuk/mcpramen-' + egg + '/.env').read_text().splitlines():
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key] = value.strip("\"'")
    request = urllib.request.Request(BASE + '/v1/whoami', headers={'Authorization': 'Bearer ' + values['SIGNALS_KEY']})
    with urllib.request.urlopen(request, timeout=5) as response:
        identity = json.load(response)
        assert identity['label'] == egg and identity['scopes'] == ['ingest']
        print(egg, 'GET /v1/whoami', response.status, json.dumps(identity))

run(['docker', 'exec', 'egg-node-app-1', 'node', '-e', "fetch('http://10.8.0.11:8300/healthz').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)})"])
run(['docker', 'exec', 'egg-python-app-1', 'python', '-c', "import urllib.request; r=urllib.request.urlopen('http://10.8.0.11:8300/healthz'); print(r.status,r.read().decode())"])

mcp = '''import asyncio
from mcp.client import ClientSession
from mcp.client.streamable_http import streamable_http_client
async def run():
 for name, port in [('egg-node',8001),('egg-python',8000)]:
  async with streamable_http_client(f'http://10.8.0.11:{port}/mcp') as streams:
   async with ClientSession(streams[0],streams[1]) as client:
    init=await client.initialize()
    print(name,'initialize',init.server_info.model_dump())
    result=await client.call_tool('search_products',{'query':'Mug'})
    print(name,'search_products',result.structured_content)
    assert not result.is_error
    assert result.structured_content['data']['total'] == 1
asyncio.run(run())
'''
print('MCP client source:\n' + mcp)
run(['docker', 'exec', '-i', 'egg-python-app-1', 'python', '-'], mcp)

# Allow the SDKs' asynchronous batch flush and collector rollup to run.
time.sleep(6)
run(['docker', 'exec', 'signals-postgres-1', 'psql', '-U', 'signals', '-d', 'signals', '-c', "SELECT p.slug,e.type,e.source->>'sdk' AS sdk,count(*) FROM events e JOIN projects p ON p.id=e.project_id GROUP BY 1,2,3 ORDER BY 1,2;"])
settings = {k: json.loads(v) for k, v in (line.split('=', 1) for line in Path('/home/vuk/signals-deploy/.env').read_text().splitlines())}
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
request = urllib.request.Request(BASE + '/v1/auth/login', headers={'Content-Type': 'application/json', 'Origin': BASE}, data=json.dumps({'email': settings['SIGNALS_BOOTSTRAP_EMAIL'], 'password': settings['SIGNALS_BOOTSTRAP_PASSWORD']}).encode())
with client.open(request, timeout=10) as response:
    account = json.load(response)
    print('POST /v1/auth/login', response.status, account['user']['email'])
assert {p['slug'] for p in account['projects']} == {'egg-node', 'egg-python'}
for project in account['projects']:
    path = '/v1/projects/' + project['id'] + '/events'
    with client.open(BASE + path, timeout=10) as response:
        data = json.load(response)
        events = data['items']
        calls = [e for e in events if e['type'] == 'tool.called']
        assert calls, 'Missing tool.called for ' + project['slug']
        assert any(e['source']['sdk'] == project['slug'].split('-')[1] for e in calls)
        print('GET', path, response.status, 'events=', len(events), 'tool.called=', len(calls), 'sdk=', calls[0]['source']['sdk'])
print('PASS: both eggs initialized and called; both SDK sources visible through authenticated dashboard read API.')
