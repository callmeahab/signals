import { demoAnalytics, demoTimeline, setRules, setAnalyticsSettings } from './demo-analytics';
import type { Caller, EventAttrs, EventType, Key, Overview, Point, Project, Range, Session, SignalEvent, SignalsClient, Tool, User } from '@mcpramen/signals-ui';
export const demoProject: Project = { id:'demo',name:'Northwind MCP',slug:'northwind',retention_days:30,rate_events_per_min:600,rate_bytes_per_min:5242880 };
export const truncatedDemoProject:Project={...demoProject,id:'demo-truncated',name:'Northwind MCP · truncated catalogue',slug:'northwind-truncated'};
export const manyClientsDemoProject:Project={...demoProject,id:'demo-many-clients',name:'Northwind MCP · 27 clients',slug:'northwind-many-clients'};
export const freshDemoProject:Project={...demoProject,id:'demo-fresh',name:'Northwind MCP · first week',slug:'northwind-fresh'};
const tools = ['search_documents','get_customer','list_orders','get_inventory','create_ticket','fetch_document'];
const clients = ['Claude','ChatGPT','Cursor','Other'];
const now = new Date(); now.setUTCMinutes(0,0,0);
const ts = (hours: number) => new Date(+now-hours*3600000).toISOString();
const points = (range: Range): Point[] => Array.from({length:range==='24h'?24:range==='7d'?168:30},(_,i) => {
  const requests = Math.round(340+Math.sin(i*.8)*120+Math.cos(i*.28)*170+(i%5)*31);
  return {ts:range==='30d'?ts((29-i)*24):ts((range==='24h'?23:167)-i),requests,errors:Math.max(0,Math.round(requests*.012+(i%9===0?12:0))),sessions:Math.round(requests*.06),callers:Math.round(requests*.025),latency_p50:80+(i%7)*12,latency_p95:210+(i%8)*24};
});
const callerRows:Caller[] = ['Production app','Avery Chen','Support workspace','Network a18c72','Development key','Jordan Lee'].map((label,i)=>({id:String(i+1),label,kind:i===3?'network':i%2?'strong':'key',calls:3800-i*550,errors:i%3*4,sessions:28-i*3,clients:[clients[i%4]],favourite_tools:[tools[i%tools.length]],first_seen:ts(24*12+i),last_seen:ts(i*.02)}));
const sessionRows:Session[] = Array.from({length:12},(_,i)=>({session_id:`demo-session-${i}`,client_name:clients[i%4],caller_label:callerRows[i%6].label,started_at:ts(i*.2),ended_at:i<2?null:ts(i*.2-8400/3600000),calls:12+i*2,errors:i%5===0?1:0,transport:'streamable-http',reason:i<2?null:'client'}));
const eventTypes:EventType[] = ['session.started','mcp.initialize','tool.called','resource.read','prompt.get','mcp.request','log','error','custom','session.ended'];
function event(i:number):SignalEvent {
  const type = eventTypes[i % eventTypes.length];
  const attrs:Record<EventType,EventAttrs> = {
    'session.started': {transport:'streamable-http'},
    'mcp.initialize': {requested_protocol_version:'2025-03-26',client_capabilities:['roots'],server_capabilities:['tools','resources','prompts']},
    'tool.called': {tool:tools[Math.floor(i/10)%tools.length],duration_ms:67+i*17,is_error:i%3===2,input_bytes:28,output_bytes:120,output_kinds:['text'],cancelled:false,...(i%3===2?{error_message:'Upstream request timed out after 5000 ms'}:{})},
    'resource.read': {uri:'docs://getting-started',duration_ms:12,is_error:false,output_bytes:512},
    'prompt.get': {prompt:'summarize',duration_ms:8,is_error:false,output_bytes:80},
    'mcp.request': {method:'tools/list',duration_ms:4,is_error:false},
    log: {level:'info',message:'Connected to document index',fields:{documents:42}},
    error: {message:'Upstream connection closed',where:'transport'},
    custom: {name:'document.indexed',props:{collection:'support'}},
    'session.ended': {duration_ms:7200,reason:'client'},
  };
  return {id:`019a0000-0000-7000-8000-${i.toString(16).padStart(12,'0')}`,ts:ts(i*.002),type,session_id:sessionRows[i%12].session_id,caller_id:String(i%6+1),...(callerRows[i%6].kind==='network'?{caller:{ip_hash:'a18c72'+ '0'.repeat(58)}}:{}),client:{name:clients[i%4],version:'1.0',protocol_version:'2025-03-26'},source:{sdk:'demo',sdk_version:'1',server_name:'Northwind MCP',server_version:'1.0',instance_id:'demo-1',hostname:'demo.local'},attrs:attrs[type]};
}
let keys:Key[] = [{id:'demo-key',key_id:'7f23ac10',label:'Production',scopes:['ingest'],created_at:ts(24*5),last_used_at:ts(.1),revoked_at:null}];
let demoUsers:User[]=[{id:'demo-owner',email:'you@northwind.dev',role:'owner'}];
export const demoClient:SignalsClient = {
  async analytics(project,route,query){return demoAnalytics(route,query,project!=='demo-truncated',project==='demo-fresh',project==='demo-many-clients');},
  async timeline(_p,id){return demoTimeline(id);},
  async saveAlerts(_p,rules){setRules(rules);},
  ingestUrl: 'http://localhost:8300/v1/events',
  async toolTimeseries(_p, _t, range) {return points(range);},
  async callerTimeseries(_p, _c, range) {return points(range);},

  async overview(_p,range):Promise<Overview> {const p=points(range);const requests=p.reduce((n,p)=>n+p.requests,0),errors=p.reduce((n,p)=>n+p.errors,0);return {requests,errors,tool_calls:Math.round(requests*.92),error_rate:errors/requests*100,sessions:range==='24h'?284:range==='7d'?1632:6025,unique_callers:range==='24h'?86:range==='7d'?241:712,p50:104,p95:326,deltas:{requests:18.4,error_rate:-12.6,p95:-8.2,unique_callers:9.8},clients:clients.map((name,i)=>({name,count:Math.round(requests*[.48,.32,.14,.06][i])})),updated_at:new Date().toISOString()};},
  async timeseries(_p,range) {return points(range);},
  async tools(_p,range):Promise<Tool[]> {const factor=range==='24h'?1:range==='7d'?7:30;return tools.map((tool,i)=>({tool,calls:(4200-i*620)*factor,errors:(i===2?42:i*3)*factor,p50:48+i*21,p95:132+i*68,last_called:ts(i*.02),trend:Array.from({length:16},(_,j)=>40+(j*17+i*11)%70)}));},
  async callers() {return callerRows;}, async sessions() {return {items:sessionRows,next_cursor:null};},
  async sessionEvents(_p,id) {return {items:Array.from({length:16},(_,i)=>({...event(i),session_id:id})).reverse(),next_cursor:null};},
  async events(_p,filter) {return {items:Array.from({length:40},(_,i)=>event(i)).filter(e=>(!filter.tool||e.attrs.tool===filter.tool)&&(!filter.type||e.type===filter.type)&&(!filter.q||JSON.stringify(e).toLowerCase().includes(filter.q.toLowerCase()))&&(!filter.caller||e.caller_id===filter.caller)&&(filter.is_error===undefined||(e.type==='error'||e.attrs.is_error===true||e.attrs.level==='error')===filter.is_error)),next_cursor:null};},
  subscribe(_p,onEvent,onStatus) {onStatus('connected');if(typeof window!=='undefined'&&(window as Window & {__SIGNALS_VISUAL_QA__?:boolean}).__SIGNALS_VISUAL_QA__)return ()=>{};let i=100;const timer=setInterval(()=>onEvent({...event(i++),ts:new Date().toISOString()}),2200);return ()=>clearInterval(timer);},
  async keys(){return [...keys];},
  async createKey(_p,label,scopes) {const secret=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');const key:Key={id:crypto.randomUUID(),key_id:crypto.randomUUID().replaceAll('-',''),label,scopes,created_at:new Date().toISOString(),last_used_at:null,revoked_at:null};keys=[key,...keys];return {key,secret:`sgk_${key.key_id}_${secret}`};},
  async revokeKey(_p,id){keys=keys.map(k=>k.id===id?{...k,revoked_at:new Date().toISOString()}:k);},
  async updateProject(id,settings){const project=id===truncatedDemoProject.id?truncatedDemoProject:id===freshDemoProject.id?freshDemoProject:demoProject;setAnalyticsSettings(settings);if(settings.alerts)setRules(settings.alerts);Object.assign(project,settings);return {...project};},
  async users(){return [...demoUsers];},
  async createUser(_p,email,_password,role){const user={id:crypto.randomUUID(),email,role};demoUsers=[...demoUsers,user];return user;},
};
