#!/usr/bin/env python3
"""Additional authenticated transport checks, using an isolated ingest/read key."""
import argparse, gzip, json, os, urllib.request, urllib.error
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--url',required=True);a=p.parse_args()
key=os.environ['SIGNALS_API_KEY']
batch=json.loads((Path(__file__).resolve().parents[1]/'spec/fixtures/valid/tool-called.json').read_bytes())
import datetime,uuid
now=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
batch['sent_at']=now
for event in batch['events']:event['ts']=now
body=json.dumps(batch).encode()
def request(data,expected,code=None,headers=None,token=key,path='/v1/events'):
 h={'Content-Type':'application/json','Authorization':'Bearer '+token}
 h.update(headers or {})
 r=urllib.request.Request(a.url+path,data,headers=h)
 try:response=urllib.request.urlopen(r,timeout=15)
 except urllib.error.HTTPError as error:response=error
 with response:
  result=json.load(response)
  assert response.status==expected,(response.status,result,expected)
 if code:assert result['error']==code and isinstance(result['message'],str),result
 return result
request(b'x'*1048577,401,'unauthorized',token='invalid')
request(b'invalid gzip',401,'unauthorized',headers={'Content-Encoding':'gzip'},token='invalid')
request(b'invalid gzip',400,'malformed_gzip',headers={'Content-Encoding':'gzip'})
request(body,415,'unsupported_media_type',headers={'Content-Encoding':'br'})
request(body,415,'unsupported_media_type',headers={'Content-Type':'text/plain'})
request(b'\xff',400,'malformed_body')
request(gzip.compress(b'x'*1048577),413,'body_too_large',headers={'Content-Encoding':'gzip'})
request(b'x'*1048577,413,'body_too_large')
request(body,202,headers={'Content-Type':'application/json; charset=utf-8','Authorization':'bEaReR\t '+key})
for _ in range(2):
 result=request(body,202)
 assert result=={'accepted':len(batch['events']),'rejected':[]},result
who=request(None,200,path='/v1/whoami')
assert set(who)=={'project','label','scopes'} and isinstance(who['project'],str),who
if os.getenv('SIGNALS_READ_KEY'):
 read=os.environ['SIGNALS_READ_KEY']
 assert request(None,200,token=read,path='/v1/whoami')['scopes']==['read']
 request(body,403,'forbidden',token=read)
# NUL is repaired after validation, and caller IP is hashed before persistence.
event=batch['events'][0]
event['id']=str(uuid.UUID(int=(uuid.uuid4().int & ~(15 << 76)) | (7 << 76)))
event['caller']={'ip':'203.0.113.9','subject':'transport-qa','user_agent':'qa'}
event['attrs']['nul']='a\u0000b'
event['attrs']['nul\u0000key']='preserved'
assert request(json.dumps(batch).encode(),202)['rejected']==[]
page=request(None,200,path='/v1/projects/'+who['project']+'/events?tool='+event['attrs']['tool'])
stored=next(e for e in page['items'] if e['id']==event['id'])
assert stored['attrs']['nul']=='a\ufffdb' and stored['attrs']['nul\ufffdkey']=='preserved',stored
assert 'ip' not in stored['caller'] and len(stored['caller']['ip_hash'])==64,stored
assert stored['source']==batch['source'] and stored['client']==event.get('client'),stored
print('PASS auth-before-body, media/encoding, gzip/decoded limits, UTF-8, Bearer whitespace/case, replay, whoami scopes, NUL repair, source/client persistence, caller IP hashing')
