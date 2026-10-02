#!/usr/bin/env python3
import argparse, datetime, gzip, json, os, re, urllib.request, urllib.error, uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument("--url",default=os.getenv("SIGNALS_URL","http://localhost:8300"));p.add_argument("--fixtures",type=Path,default=Path(__file__).resolve().parents[1]/"spec/fixtures/development.json");a=p.parse_args()
key=os.environ["SIGNALS_API_KEY"]
for fixture in json.loads(a.fixtures.read_text()):
 now=datetime.datetime.now(datetime.timezone.utc);tokens={"NOW":now.isoformat(),"FUTURE":(now+datetime.timedelta(minutes=6)).isoformat(),"OLD":(now-datetime.timedelta(days=401)).isoformat()}
 def expand(m):
  token=m.group(1)
  if token not in tokens: tokens[token]=str(uuid.uuid4())
  return tokens[token]
 body=re.sub(r"\{\{([^}]+)\}\}",expand,json.dumps(fixture["batch"])).encode()
 def send(expected):
  request=urllib.request.Request(a.url.rstrip("/")+"/v1/events",gzip.compress(body),headers={"Authorization":"Bearer "+key,"Content-Type":"application/json","Content-Encoding":"gzip"})
  try:
   with urllib.request.urlopen(request,timeout=15) as response: status=response.status;data=json.load(response)
  except urllib.error.HTTPError as error: status=error.code;data=json.load(error)
  assert status==fixture["status"],(fixture["name"],status,data)
  for field,value in expected.items():
   actual=[v["reason"] for v in data.get("rejected",[])] if field=="rejected_reasons" else data.get(field)
   assert actual==value,(fixture["name"],field,actual,value)
 send(fixture["expected"])
 if "replay" in fixture: send(fixture["replay"])
 print("PASS",fixture["name"])
print("Fixture suite passed:",a.fixtures.name,"(see spec/manifest.json for contract status)")
