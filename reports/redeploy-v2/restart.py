import subprocess,time,urllib.request
names=['signals-signals-1','signals-postgres-1','egg-node-app-1','egg-python-app-1','egg-node-issuer-1','egg-node-proxy-1','egg-python-bootstrap-app-1','egg-python-proxy-1']
for name in names:
 start=time.monotonic()
 print('$ docker restart',name,flush=True)
 subprocess.run(['docker','restart',name],check=True)
 deadline=time.monotonic()+30
 while True:
  try:
   with urllib.request.urlopen('http://10.8.0.11:8300/readyz',timeout=2) as r:
    assert r.status==200
    print('GET /readyz 200 after',round(time.monotonic()-start,2),'seconds',flush=True)
    break
  except Exception:
   if time.monotonic()>deadline:raise
   time.sleep(.5)
print('$ docker inspect <eight task containers> --format restart/ports')
subprocess.run(['docker','inspect',*names,'--format','{{.Name}} restart={{.HostConfig.RestartPolicy.Name}} ports={{json .HostConfig.PortBindings}}'],check=True)
