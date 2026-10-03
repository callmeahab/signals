import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
const endpoint=process.env.SIGNALS_URL??'http://localhost:8300',key=process.env.SIGNALS_API_KEY;
const version='2026-07-28',serverInfo={name:'signals-node-example',version:'0.1.0'};
let chain=Promise.resolve();
function emit(client,type,fields={}) {
 if(!key)return;
 const ts=new Date().toISOString(),batch={sent_at:ts,events:[{id:randomUUID(),ts,type,client_name:String(client.name).slice(0,128),client_version:String(client.version).slice(0,128),caller:{subject:'node-example'},attrs:{transport:'stdio'},...fields}]};
 chain=chain.then(async()=>{for(let n=0;n<3;n++){try{const response=await fetch(`${endpoint}/v1/events`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify(batch),signal:AbortSignal.timeout(5000)});if(response.status===202){const result=await response.json();if(result.rejected.length)console.error('Signals rejected example events');return;}if(response.status<500&&response.status!==429)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100*2**n));}console.error('Signals telemetry could not be delivered');});
}
function handle(request){
 const validId=request && (typeof request.id==='string' || (Number.isInteger(request.id)&&typeof request.id==='number'));
 const error=(code,message,data)=>({jsonrpc:'2.0',...(validId?{id:request.id}:{}),error:{code,message,...(data?{data}:{})}});
 if(!request||Array.isArray(request)||request.jsonrpc!=='2.0'||typeof request.method!=='string')return error(-32600,'Invalid request');
 if(!('id'in request))return null;
 if(!validId)return error(-32600,'Request id must be a string or integer');
 if(request.method==='initialize')return error(-32601,`Use per-request metadata; supported MCP version: ${version}`);
 const params=request.params,meta=params?._meta;
 if(!params||Array.isArray(params)||typeof params!=='object'||!meta||typeof meta!=='object'||typeof meta['io.modelcontextprotocol/protocolVersion']!=='string'||!meta['io.modelcontextprotocol/clientCapabilities']||typeof meta['io.modelcontextprotocol/clientCapabilities']!=='object'||Array.isArray(meta['io.modelcontextprotocol/clientCapabilities']))return error(-32602,'Required protocol version and client capabilities metadata missing');
 const requested=meta['io.modelcontextprotocol/protocolVersion'];
 if(requested!==version)return error(-32022,'Unsupported protocol version',{supported:[version],requested});
 const client=meta['io.modelcontextprotocol/clientInfo']??{name:'Unknown client',version:'unknown'};
 if(!client||typeof client.name!=='string'||typeof client.version!=='string')return error(-32602,'Invalid client identity');
 const complete=result=>({jsonrpc:'2.0',id:request.id,result:{resultType:'complete',_meta:{'io.modelcontextprotocol/serverInfo':serverInfo},...result}});
 if(request.method==='server/discover')return complete({supportedVersions:[version],capabilities:{tools:{}}});
 if(request.method==='ping')return complete({});
 if(request.method==='tools/list')return complete({tools:[{name:'add',description:'Add two finite numbers',inputSchema:{type:'object',properties:{a:{type:'number'},b:{type:'number'}},required:['a','b'],additionalProperties:false}}]});
 if(request.method==='tools/call'){
  if(params.name!=='add')return error(-32602,'Unknown tool');
  const start=performance.now(),args=params.arguments;
  const valid=args&&typeof args==='object'&&!Array.isArray(args)&&Object.keys(args).every(k=>k==='a'||k==='b')&&Number.isFinite(args.a)&&Number.isFinite(args.b)&&Number.isFinite(args.a+args.b);
  const result={content:[{type:'text',text:valid?String(args.a+args.b):'Expected add with two finite numbers'}],isError:!valid};
  emit(client,'tool.call',{tool:'add',duration_ms:Math.round(performance.now()-start),is_error:result.isError,attrs:{transport:'stdio',...(result.isError?{error_message:'Expected two finite numbers'}:{})}});return complete(result);
 }
 return error(-32601,'Method not found');
}
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
process.on('SIGTERM',()=>input.close());process.on('SIGINT',()=>input.close());
for await(const line of input){try{const result=handle(JSON.parse(line));if(result)console.log(JSON.stringify(result));}catch{console.log(JSON.stringify({jsonrpc:'2.0',error:{code:-32700,message:'Parse error'}}));}}
await chain;
