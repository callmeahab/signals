#!/usr/bin/env python3
import datetime, json, math, os, queue, sys, threading, time, urllib.request, urllib.error, uuid
version="2026-07-28";server_info={"name":"signals-python-example","version":"0.1.0"};key=os.getenv("SIGNALS_API_KEY");endpoint=os.getenv("SIGNALS_URL","http://localhost:8300");events=queue.Queue()
def deliver():
 while True:
  batch=events.get()
  if batch is None:events.task_done();return
  payload=json.dumps(batch).encode()
  for attempt in range(3):
   try:
    with urllib.request.urlopen(urllib.request.Request(endpoint+"/v1/events",payload,headers={"Content-Type":"application/json","Authorization":"Bearer "+key}),timeout=5) as response:
     result=json.load(response)
     if result.get("rejected"):print("Signals rejected example events",file=sys.stderr)
     break
   except urllib.error.HTTPError as error:
    if error.code<500 and error.code!=429:break
   except OSError:pass
   time.sleep(.1*2**attempt)
  else:print("Signals telemetry could not be delivered",file=sys.stderr)
  events.task_done()
worker=threading.Thread(target=deliver,daemon=True)
if key:worker.start()
def emit(client,kind,**fields):
 if not key:return
 ts=datetime.datetime.now(datetime.timezone.utc).isoformat();event={"id":str(uuid.uuid4()),"ts":ts,"type":kind,"client_name":str(client.get("name","Example client"))[:128],"client_version":str(client.get("version","unknown"))[:128],"caller":{"subject":"python-example"},"attrs":{"transport":"stdio"},**fields};events.put({"sent_at":ts,"events":[event]})
def handle(request):
 valid_id=isinstance(request,dict) and (isinstance(request.get("id"),str) or type(request.get("id")) is int)
 def error(code,message,data=None):return {"jsonrpc":"2.0",**({"id":request["id"]} if valid_id else {}),"error":{"code":code,"message":message,**({"data":data} if data is not None else {})}}
 if not isinstance(request,dict) or request.get("jsonrpc")!="2.0" or not isinstance(request.get("method"),str):return error(-32600,"Invalid request")
 if "id" not in request:return None
 if not valid_id:return error(-32600,"Request id must be a string or integer")
 if request["method"]=="initialize":return error(-32601,"Use per-request metadata; supported MCP version: "+version)
 params=request.get("params");meta=params.get("_meta") if isinstance(params,dict) else None
 if not isinstance(meta,dict) or not isinstance(meta.get("io.modelcontextprotocol/protocolVersion"),str) or not isinstance(meta.get("io.modelcontextprotocol/clientCapabilities"),dict):return error(-32602,"Required protocol version and client capabilities metadata missing")
 requested=meta["io.modelcontextprotocol/protocolVersion"]
 if requested!=version:return error(-32022,"Unsupported protocol version",{"supported":[version],"requested":requested})
 client=meta.get("io.modelcontextprotocol/clientInfo",{"name":"Unknown client","version":"unknown"})
 if not isinstance(client,dict) or not isinstance(client.get("name"),str) or not isinstance(client.get("version"),str):return error(-32602,"Invalid client identity")
 def complete(result):return {"jsonrpc":"2.0","id":request["id"],"result":{"resultType":"complete","_meta":{"io.modelcontextprotocol/serverInfo":server_info},**result}}
 method=request["method"]
 if method=="server/discover":return complete({"supportedVersions":[version],"capabilities":{"tools":{}}})
 if method=="ping":return complete({})
 if method=="tools/list":return complete({"tools":[{"name":"add","description":"Add two finite numbers","inputSchema":{"type":"object","properties":{"a":{"type":"number"},"b":{"type":"number"}},"required":["a","b"],"additionalProperties":False}}]})
 if method=="tools/call":
  if params.get("name")!="add":return error(-32602,"Unknown tool")
  start=time.perf_counter();args=params.get("arguments");args=args if isinstance(args,dict) else {};a=args.get("a");b=args.get("b");valid=set(args)<=set(["a","b"]) and type(a) in (int,float) and type(b) in (int,float)
  try:valid=valid and math.isfinite(a) and math.isfinite(b) and math.isfinite(a+b)
  except OverflowError:valid=False
  result={"content":[{"type":"text","text":str(a+b) if valid else "Expected add with two finite numbers"}],"isError":not valid}
  emit(client,"tool.call",tool="add",duration_ms=round((time.perf_counter()-start)*1000),is_error=not valid,attrs={"transport":"stdio",**({} if valid else {"error_message":"Expected two finite numbers"})});return complete(result)
 return error(-32601,"Method not found")
try:
 for line in sys.stdin:
  try:
   result=handle(json.loads(line))
   if result:print(json.dumps(result),flush=True)
  except (ValueError,TypeError):print(json.dumps({"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error"}}),flush=True)
finally:
 if key:events.put(None);worker.join(timeout=15)
