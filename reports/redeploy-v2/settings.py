import http.cookiejar,json,urllib.request
from pathlib import Path
base='http://10.8.0.11:8300'
env={k:json.loads(v) for k,v in (l.split('=',1) for l in Path('/home/vuk/signals-deploy/.env').read_text().splitlines())}
c=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def req(path,data=None,method=None):
 r=c.open(urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json','Origin':base}),timeout=20)
 return json.load(r)
a=req('/v1/auth/login',{'email':env['SIGNALS_BOOTSTRAP_EMAIL'],'password':env['SIGNALS_BOOTSTRAP_PASSWORD']})
for p in a['projects']:
 path='/v1/projects/'+p['id']
 tools=req(path+'/analytics/tools')['tools']
 catalogs={line.split(' ',2)[1]:json.loads(line.split(' ',2)[2]) for line in Path('reports/redeploy-v2/mcp.log').read_text().splitlines() if line.startswith('CATALOG ')}
 classes={t['name']:('read' if t['annotations']['read_only_hint'] else 'mutate') for t in catalogs[p['slug']]}
 settings={'slo_classes':{t['tool']:classes.get(t['tool'],'mutate') for t in tools},'slo_targets':{'read':99.5,'mutate':98.0},'token_divisor':4,'digest':{'enabled':False},'alerts':[{'id':'volume','enabled':True,'threshold':3},{'id':'latency','enabled':True,'threshold':2},{'id':'errors','enabled':True,'threshold':5},{'id':'destructive','enabled':True},{'id':'burn','enabled':True,'threshold':6}]}
 saved=req(path,settings,'PATCH')
 for k,v in settings.items():
  if k=='digest':assert saved[k]['enabled']==False
  else:assert saved[k]==v
 print('PATCH',path,p['slug'],'200',json.dumps(settings))
print('PASS settings persisted; digest disabled because no receiver supplied')
