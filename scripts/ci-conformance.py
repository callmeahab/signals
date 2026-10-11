#!/usr/bin/env python3
import json, os, subprocess, time, urllib.request
from pathlib import Path
root=Path(__file__).resolve().parents[1];base=os.getenv("SIGNALS_URL","http://127.0.0.1:8350");token="ci-isolated-admin-token-32-characters"
from urllib.parse import urlparse
parsed=urlparse(base);assert parsed.hostname in ("127.0.0.1","localhost"),"Requires isolated localhost collector"
env={**os.environ,"SIGNALS_CONFORMANCE_CLOCK":"sent_at","SIGNALS_BIND":"127.0.0.1:"+str(parsed.port or 8350),"SIGNALS_PUBLIC_URL":base,"SIGNALS_ADMIN_TOKEN":token,"SIGNALS_SESSION_SECRET":"ci-isolated-session-secret-32-characters","SIGNALS_BOOTSTRAP_EMAIL":"owner@signals.test","SIGNALS_BOOTSTRAP_PASSWORD":"signals-test-password"}
with open(root/"target/ci-server.log","w") as log:
 server=subprocess.Popen([str(root/"target/debug/signals"),"serve"],env=env,stdout=log,stderr=log)
 try:
  for _ in range(100):
   if server.poll() is not None: raise RuntimeError("Collector exited; inspect target/ci-server.log")
   try:
    with urllib.request.urlopen(base+"/readyz",timeout=1) as response:
     if response.status==200:break
   except OSError:pass
   time.sleep(.1)
  else:raise RuntimeError("Collector not ready")
  def provision(route,data):
   with urllib.request.urlopen(urllib.request.Request(base+"/v1/admin/"+route,json.dumps(data).encode(),headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})) as response:return json.load(response)
  tenant=provision("tenants",{"slug":"conformance","name":"Conformance"});project=provision("projects",{"tenant_id":tenant["id"],"slug":"fixtures","name":"Fixtures"});key=provision("keys",{"project_id":project["id"],"label":"Fixtures","scopes":["ingest","read"]})["secret"]
  pg = os.getenv("ANALYTICS_PG_CONTAINER")
  psql = ["docker", "exec", "-i", pg, "psql", "-U", "postgres", "-d", "signals"] if pg else ["psql", os.environ["DATABASE_URL"]]
  subprocess.run(psql+["-v","ON_ERROR_STOP=1","-c",f"UPDATE projects SET retention_days=30,rate_events_per_min=100000,rate_bytes_per_min=1073741824 WHERE id='{project['id']}'"],check=True)
  subprocess.run(["python3",str(root/"scripts/spec-conformance.py"),"--url",base],env={**os.environ,"SIGNALS_API_KEY":key},check=True)
  read_key=provision("keys",{"project_id":project["id"],"label":"Read-only fixture key","scopes":["read"]})["secret"]
  subprocess.run(["python3",str(root/"scripts/transport-conformance.py"),"--url",base],env={**os.environ,"SIGNALS_API_KEY":key,"SIGNALS_READ_KEY":read_key},check=True)
  subprocess.run(["bun","run","qa:backend"],cwd=root/"web",env={**os.environ,"SIGNALS_URL":base},check=True)
 finally:
  server.terminate()
  try:server.wait(timeout=15)
  except subprocess.TimeoutExpired:server.kill();server.wait()

# Run the independent analytics review probe on its own collector, using the same
# isolated database. Release mode is required for its 100k-event latency checks.
subprocess.run(["cargo", "build", "--locked", "--release", "--bin", "signals"], cwd=root, check=True)
subprocess.run(["python3", str(root/"scripts/analytics-review-probe.py")], cwd=root, check=True)
