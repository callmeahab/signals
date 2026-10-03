#!/usr/bin/env python3
import json, os, subprocess, time, urllib.request
from pathlib import Path
root=Path(__file__).resolve().parents[1];base=os.getenv("SIGNALS_URL","http://127.0.0.1:8350");token="ci-isolated-admin-token-32-characters"
from urllib.parse import urlparse
parsed=urlparse(base);assert parsed.hostname in ("127.0.0.1","localhost"),"Requires isolated localhost collector"
env={**os.environ,"SIGNALS_BIND":"127.0.0.1:"+str(parsed.port or 8350),"SIGNALS_PUBLIC_URL":base,"SIGNALS_ADMIN_TOKEN":token,"SIGNALS_SESSION_SECRET":"ci-isolated-session-secret-32-characters","SIGNALS_BOOTSTRAP_EMAIL":"owner@signals.test","SIGNALS_BOOTSTRAP_PASSWORD":"signals-test-password"}
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
  tenant=provision("tenants",{"slug":"conformance","name":"Conformance"});project=provision("projects",{"tenant_id":tenant["id"],"slug":"fixtures","name":"Fixtures"});key=provision("keys",{"project_id":project["id"],"label":"Fixtures","scopes":["ingest"]})["secret"]
  manifest=json.loads((root/"spec/manifest.json").read_text());fixture=root/(manifest.get("fixtures") or "spec/fixtures/development.json")
  subprocess.run(["python3",str(root/"scripts/conformance.py"),"--url",base,"--fixtures",str(fixture)],env={**os.environ,"SIGNALS_API_KEY":key},check=True)
  subprocess.run(["bun","run","qa:backend"],cwd=root/"web",env={**os.environ,"SIGNALS_URL":base},check=True)
 finally:
  server.terminate()
  try:server.wait(timeout=15)
  except subprocess.TimeoutExpired:server.kill();server.wait()
