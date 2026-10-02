#!/usr/bin/env python3
import json, os, pathlib, urllib.request, http.cookiejar
base=os.getenv('SIGNALS_URL','http://127.0.0.1:8350');jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
def req(path,method='GET',data=None):
 with client.open(urllib.request.Request(base+path,None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'},method=method)) as response:return json.load(response)
req('/v1/auth/login','POST',{'email':os.getenv('SIGNALS_TEST_EMAIL','owner@signals.test'),'password':os.getenv('SIGNALS_TEST_PASSWORD','signals-test-password')});p=req('/v1/auth/me')['projects'][0]
settings={k:p[k] for k in ['name','retention_days','rate_events_per_min','rate_bytes_per_min']};settings.update(rate_events_per_min=10000000,rate_bytes_per_min=2000000000);req('/v1/projects/'+p['id'],'PATCH',settings)
k=req('/v1/projects/'+p['id']+'/keys','POST',{'label':'k6 benchmark','scopes':['ingest']})['secret'];out=pathlib.Path(os.environ.get('SIGNALS_BENCH_ENV','/tmp/signals-bench.env'));out.write_text('SIGNALS_URL=http://signals:8300\nSIGNALS_API_KEY='+k+'\n');out.chmod(0o600);print('Benchmark key written to private env file; project',p['id'])
