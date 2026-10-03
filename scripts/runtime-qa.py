#!/usr/bin/env python3
import argparse, concurrent.futures, datetime, gzip, http.cookiejar, json, os, queue, subprocess, threading, time, urllib.request, urllib.error, uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument("--compose",type=Path,default=Path(__file__).resolve().parents[1]/"docker/qa.compose.yml");p.add_argument("--project",default="signals-qa");p.add_argument("--skip-faults",action="store_true");a=p.parse_args()
assert a.project.startswith("signals-") and "qa" in a.project,"Requires isolated signals-…qa compose project"
base=os.getenv("SIGNALS_URL","http://127.0.0.1:8352");one="http://127.0.0.1:8350";two="http://127.0.0.1:8351";root=Path(__file__).resolve().parents[1];jar=http.cookiejar.CookieJar();client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar));report={"fixture":"isolated runtime QA","started_at":datetime.datetime.now(datetime.timezone.utc).isoformat()}
def docker(*args): return subprocess.run(["docker","compose","-p",a.project,"-f",str(a.compose),*args],check=True,text=True,capture_output=True).stdout
def request(path,method="GET",body=None,key=None,url=base,headers=None,raw=False):
 h={"Content-Type":"application/json",**(headers or {})}
 if key: h["Authorization"]="Bearer "+key
 data=body if isinstance(body,bytes) else None if body is None else json.dumps(body).encode()
 try:
  with client.open(urllib.request.Request(url+path,data,headers=h,method=method),timeout=15) as response: status=response.status;head=dict(response.headers);content=response.read()
 except urllib.error.HTTPError as error: status=error.code;head=dict(error.headers);content=error.read()
 try: parsed=json.loads(content or "null")
 except json.JSONDecodeError: parsed=content.decode()
 return status,head,content.decode() if raw else parsed
def wait_ready(url=base):
 for _ in range(100):
  try:
   if request("/readyz",url=url,raw=True)[0]==200:return
  except (OSError,urllib.error.URLError): pass
  time.sleep(.2)
 raise AssertionError("Readiness did not recover")
wait_ready();assert request("/v1/auth/login","POST",{"email":"owner@signals.test","password":"signals-test-password"})[0]==200
project=request("/v1/auth/me")[2]["projects"][0];pid=project["id"]
settings={k:project[k] for k in ["name","retention_days","rate_events_per_min","rate_bytes_per_min"]};settings.update(rate_events_per_min=10000000,rate_bytes_per_min=2000000000)
assert request("/v1/projects/"+pid,"PATCH",settings)[0]==200
mint=request("/v1/projects/"+pid+"/keys","POST",{"label":"Runtime QA","scopes":["ingest","read"]})[2];key=mint["secret"]
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
def batch(n,tool="runtime-qa"):
 ts=now();return {"sent_at":ts,"events":[{"id":str(uuid.uuid4()),"ts":ts,"type":"tool.call","tool":tool,"duration_ms":42,"attrs":{},"caller":{"subject":"runtime-qa"}} for _ in range(n)]}
subprocess.run(["python3",str(root/"scripts/conformance.py"),"--url",one],env={**os.environ,"SIGNALS_API_KEY":key},check=True)
request_id=str(uuid.uuid4());status,headers,_=request("/healthz",headers={"X-Request-ID":request_id},raw=True);assert status==200 and headers.get("x-request-id",headers.get("X-Request-ID"))==request_id
assert request("/v1/events","POST",gzip.compress(json.dumps({"sent_at":now(),"events":[{"attrs":{"message":"x"*2097152}}]}).encode()),key=key,headers={"Content-Encoding":"gzip"})[0]==413
cors=request("/v1/events","OPTIONS",headers={"Origin":"http://127.0.0.1:8350","Access-Control-Request-Method":"POST","Access-Control-Request-Headers":"authorization,content-type"},raw=True);assert cors[0] in (200,204);assert any(k.lower()=="access-control-allow-origin" for k in cors[1])
assert request("/v1/events.schema.json")[0]==200;assert request("/v1/ingest.openapi.yaml",raw=True)[0]==200
received=queue.Queue();done=threading.Event();live_tool="replica-live-"+uuid.uuid4().hex
def tail():
 try:
  with urllib.request.urlopen(urllib.request.Request(base+"/v1/projects/"+pid+"/live?tool="+live_tool,headers={"Authorization":"Bearer "+key}),timeout=15) as response:
   received.put(("backend",response.headers.get("X-Signals-Backend")))
   for line in response:
    if line.startswith(b"data: "):received.put(json.loads(line[6:])["id"])
    if done.is_set():return
 except Exception as error:received.put(("error",str(error)))
thread=threading.Thread(target=tail,daemon=True);thread.start();kind,backend=received.get(timeout=10);assert kind=="backend" and backend
ids=set()
for url in [one,two]:
 b=batch(1,live_tool);ids.add(b["events"][0]["id"]);assert request("/v1/events","POST",b,key,url)[0]==202
seen={received.get(timeout=10),received.get(timeout=10)};done.set();assert seen==ids,(seen,ids)
backends={request("/healthz",raw=True)[1].get("X-Signals-Backend") for _ in range(12)};assert len(backends)==2,backends
report["proxy_live_replicas"]=2
assert request("/v1/whoami",key=key,url=two)[0]==200
assert request("/v1/projects/"+pid+"/keys/"+mint["key"]["id"],"DELETE")[0]==204
assert request("/v1/whoami",key=key,url=two)[0]==401
mint=request("/v1/projects/"+pid+"/keys","POST",{"label":"Fault QA","scopes":["ingest","read"]})[2];key=mint["secret"]
if not a.skip_faults:
 token="fault-"+uuid.uuid4().hex;batches=[batch(100,token) for _ in range(40)];acked=[];failed=[]
 assert request("/v1/events","POST",batches[0],key,one)[0]==202;acked.append(batches[0])
 def ingest(b):
  try:
   status,_,response=request("/v1/events","POST",b,key,one)
   return (b,status,response)
  except Exception:return (b,0,None)
 gate=subprocess.Popen(["docker","compose","-p",a.project,"-f",str(a.compose),"exec","-T","postgres","psql","-U","signals","-d","signals_test","-c",f"BEGIN; SELECT pg_advisory_xact_lock({0x53494701}); SELECT pg_sleep(30)"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 try:
  for _ in range(100):
   held=int(docker("exec","-T","postgres","psql","-U","signals","-d","signals_test","-At","-c",f"SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid={0x53494701} AND granted").strip())
   if held:break
   time.sleep(.02)
  else:raise AssertionError("Fault gate did not acquire ingest lock")
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
   futures=[pool.submit(ingest,b) for b in batches[1:]]
   for _ in range(100):
    waiting=int(docker("exec","-T","postgres","psql","-U","signals","-d","signals_test","-At","-c",f"SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid={0x53494701} AND NOT granted").strip())
    if waiting:break
    time.sleep(.02)
   else:raise AssertionError("No ingest transaction reached the fault gate")
   docker("kill","-s","SIGKILL","postgres")
   for future in futures:
    b,status,response=future.result();(acked if status==202 else failed).append(b)
 finally:
  docker("start","postgres")
  gate.wait(timeout=10)
 assert acked and failed,"Fault test needs acknowledged and interrupted batches"
 docker("start","postgres");wait_ready(one);wait_ready(two)
 expected={e["id"] for b in acked for e in b["events"]}
 query=f"SELECT id::text FROM events WHERE project_id='{pid}'::uuid AND tool='{token}' ORDER BY id"
 durable=set(docker("exec","-T","postgres","psql","-U","signals","-d","signals_test","-At","-c",query).splitlines());assert expected<=durable,"Acknowledged events lost"
 for b in batches:assert request("/v1/events","POST",b,key,one)[0]==202
 count=int(docker("exec","-T","postgres","psql","-U","signals","-d","signals_test","-At","-c",f"SELECT count(*) FROM events WHERE project_id='{pid}'::uuid AND tool='{token}'").strip());assert count==4000,count
 report["db_kill"]={"acknowledged_events":len(expected),"unacknowledged_batches":len(failed),"unique_after_retries":count}
 docker("stop","-t","10","replica");wait_ready();assert request("/v1/events","POST",batch(1,"failover"),key)[0]==202
 docker("start","replica");wait_ready(two);report["replica_failover"]=True
 started=time.monotonic();docker("stop","-t","15","signals");report["shutdown_seconds"]=round(time.monotonic()-started,3);assert report["shutdown_seconds"]<15;docker("start","signals");wait_ready(one)
for _ in range(30):
 try:
  result=request('/api/v1/query?query=up%7Bjob%3D%22signals%22%7D',url='http://127.0.0.1:19090')[2]["data"]["result"]
  if result and all(v["value"][1]=="1" for v in result):break
 except Exception:pass
 time.sleep(.5)
else:raise AssertionError("Prometheus scrape did not recover")
report["prometheus_up"]=True
request("/healthz",headers={"X-Request-ID":request_id},raw=True)
for _ in range(30):
 logs=docker("logs","--no-color","otel")
 if request_id in logs and "http.request" in logs:break
 time.sleep(.5)
else:raise AssertionError("OTLP receiver did not record the HTTP span/request ID")
assert key not in logs and 'signals-test-password' not in logs
report["otlp_export"]=True
out=root/"bench/artifacts";out.mkdir(parents=True,exist_ok=True);(out/"runtime-qa.json").write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps(report,indent=2))
