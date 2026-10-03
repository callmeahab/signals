#!/usr/bin/env python3
import json, os, subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
meta={"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"Example smoke","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}
def req(i,method,params=None):return {"jsonrpc":"2.0","id":i,"method":method,"params":{"_meta":meta,**(params or {})}}
messages=[req(1,"server/discover"),req(2,"tools/list"),req(3,"tools/call",{"name":"add","arguments":{"a":2,"b":3}}),req(4,"tools/call",{"name":"add","arguments":{"a":"invalid","b":3}}),{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":999}},req(5,"ping",{"_meta":{**meta,"io.modelcontextprotocol/protocolVersion":"1900-01-01"}}),{"jsonrpc":"2.0","id":6,"method":"ping","params":{}},req(7,"tools/list",{"_meta":{**meta,"io.modelcontextprotocol/clientInfo":{"name":"Another client","version":"2"}}})]
for command in [["bun",str(root/"node/server.mjs")],["python3",str(root/"python/server.py")]]:
 result=subprocess.run(command,input="\n".join(json.dumps(v) for v in messages)+"\n",text=True,capture_output=True,timeout=30,check=True)
 replies=[json.loads(line) for line in result.stdout.splitlines()];assert [v["id"] for v in replies]==[1,2,3,4,5,6,7];assert replies[2]["result"]["content"][0]["text"]=="5";assert replies[3]["result"]["isError"] is True
 assert replies[4]["error"]["code"]==-32022;assert replies[5]["error"]["code"]==-32602;assert all(v.get("result",{}).get("resultType")=="complete" for v in [replies[0],replies[1],replies[2],replies[3],replies[6]])
 print("PASS",Path(command[1]).parent.name,"MCP 2026-07-28 discovery/list/call, per-request metadata, version/errors and clean JSON-RPC stdout")
