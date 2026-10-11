import { bucketForRange, bucketMilliseconds } from '@mcpramen/signals-ui';
import type { AnalyticsRoutes, AnalyticsMeta, AnalyticsQuery, AnalyticsTool, AlertRule, TimelineAnalytics, AnalyticsSettings } from '@mcpramen/signals-ui';
const end = Date.UTC(2026,9,12);
const iso = (t:number) => new Date(t).toISOString();
export const defaultRules:AlertRule[] = [
 {id:'volume',name:'Volume versus 7-day average',enabled:true,threshold:3,window_minutes:60,state:'ok'},
 {id:'latency',name:'p95 versus 24-hour baseline',enabled:true,threshold:2,window_minutes:60,state:'ok'},
 {id:'errors',name:'Error rate (%)',enabled:true,threshold:5,window_minutes:15,state:'firing'},
 {id:'destructive',name:'Destructive tool · unrecognised client',enabled:true,threshold:1,window_minutes:1,state:'ok'},
 {id:'burn',name:'Error-budget burn',enabled:true,threshold:6,window_minutes:60,state:'ok'},
];
let settings:Partial<AnalyticsSettings>={};
export function setAnalyticsSettings(next:Partial<AnalyticsSettings>){settings={...settings,...next};}

export let rules = structuredClone(defaultRules);
export function setRules(next:AlertRule[]){rules=structuredClone(next);}
export function demoAnalytics<K extends keyof AnalyticsRoutes>(route:K, query:AnalyticsQuery):AnalyticsRoutes[K] {
 const days = query.range==='24h'?1:query.range==='30d'?30:query.range==='90d'?90:7;
 const to=query.to?Date.parse(query.to):end, from=query.from?Date.parse(query.from):to-days*86400000;
 const bucket=bucketForRange(query.range), step=bucketMilliseconds[bucket];
 const count=Math.max(1,Math.ceil((to-from)/step));
 const weights=Array.from({length:count},(_,i)=>Math.min(step,to-from-i*step)*(1+.3*Math.sin(i*.7)));
 const totalWeight=weights.reduce((a,b)=>a+b,0);
 const split=(n:number,i:number)=>i===count-1?n-weights.slice(0,-1).reduce((a,w)=>a+Math.floor(n*w/totalWeight),0):Math.floor(n*weights[i]/totalWeight);
 const dead=['cancel_booking','refund','archive_order'];
 const meta:AnalyticsMeta={range:{from:iso(from),to:iso(to),prev_from:iso(from-(to-from)),prev_to:iso(from)},generated_at:iso(to)};
 const factor=(to-from)/604800000;
 const filterFactor=(query.client?{Claude:.46,Cursor:.34,ChatGPT:.2}[query.client]??1:1)*(query.caller?{'user:avery':.5,'key:production':.35,'network:a18c72':.15}[query.caller]??1:1)*(query.transport==='stdio'?280/6480:query.transport==='streamable-http'?6200/6480:1);
 const scale=(n:number)=>Math.round(n*factor*filterFactor);
 const names=['search_products','get_product','list_orders','get_customer','fetch_document','get_inventory','book_flight','send_email','add_to_cart','create_ticket','update_customer','submit_order'];
 const baseCalls=[9000,12901,6200,4800,3200,2500,1204,388,2700,1800,1619,1900];
 const clients=['Claude','Cursor','ChatGPT'];
 if(query.client&&!clients.includes(query.client)||query.tool&&!names.includes(query.tool)||query.transport&&!['streamable-http','stdio'].includes(query.transport)||query.caller&&!['user:avery','key:production','network:a18c72'].includes(query.caller))throw new Error('invalid_filter');
 const tools:AnalyticsTool[]=names.map((tool,i):AnalyticsTool=>{
  const calls=scale(baseCalls[i]),errors=Math.round(calls*(i<6?.003:i===6?.059:.03));
  return {tool,slo_class:settings.slo_classes?.[tool]??(i<6?'read':'mutate'),calls,success_rate:calls?Math.round((1-errors/calls)*1000)/10:null,errors:{tool:errors,protocol:null,timeout:null,cancelled:null,unknown:null},latency:{p50:95+i*15,p95:i===6?1900:320+i*28,p99:900+i*150,method:'histogram'},input_bytes_avg:210+i*12,output_bytes_avg:1840+i*80,output_tokens_est:Math.round((1840+i*80)/(settings.token_divisor??4)),retries:{count:Math.round(errors*.7),self_corrected_pct:72.5},schema_failures:{input:null,output:null},trend:Array.from({length:count},(_,d)=>({t:iso(from+step*d),calls:split(calls,d),errors:split(errors,d)}))};
 }).filter(t=>!query.tool||t.tool===query.tool);
 const calls=tools.reduce((s,t)=>s+t.calls,0),errors=tools.reduce((s,t)=>s+(t.errors.tool??0),0),totalTokens=tools.reduce((s,t)=>s+t.calls*(t.output_tokens_est??0),0);
 const sessionCount=scale(6480), active=scale(1094),newUsers=scale(312);
 const quality={strong:Math.round(active*.75),key:Math.round(active*.174),network:active-Math.round(active*.75)-Math.round(active*.174)};
 const steps=[['connected',312],['listed_tools',274],['first_call',190],['five_calls',137],['returned_day_7',84]] as const;
 const funnel=steps.map(([step,count],i)=>({step,count:scale(count),dropoff_pct:i?Math.round((1-count/steps[i-1][1])*1000)/10:0}));
 const cohorts=[0,1,2,3].map(i=>({cohort_start:iso(from-(4-i)*604800000).slice(0,10),size:120+i*18,retained_pct:[100,41+i*3,33+i*2,29+i,27].map((n,j)=>j>4-i?null:n)}));
 const byClient=clients.map((name,i)=>({name,version:['0.1.0','1.7.2','1.2026.280'][i],calls:i===2?calls-Math.round(calls*.46)-Math.round(calls*.34):Math.round(calls*[.46,.34][i]),sessions:i===2?sessionCount-Math.round(sessionCount*.46)-Math.round(sessionCount*.34):Math.round(sessionCount*[.46,.34][i]),pct:[46,34,20][i],capabilities:i===0?['sampling','roots']:i===1?['roots','elicitation']:['roots']}));
 if(query.client){const selected=byClient.find(c=>c.name===query.client)!;byClient.splice(0,byClient.length,{...selected,calls,sessions:sessionCount,pct:100});}
 const tenants=['user:avery','key:production','network:a18c72'].map((caller,i)=>({caller,identity_kind:(['strong','key','network'] as const)[i],calls:i===2?calls-Math.round(calls*.5)-Math.round(calls*.35):Math.round(calls*[.5,.35][i]),tokens:i===2?totalTokens-Math.round(totalTokens*.5)-Math.round(totalTokens*.35):Math.round(totalTokens*[.5,.35][i])}));
 if(query.caller){const selected=tenants.find(t=>t.caller===query.caller)!;tenants.splice(0,tenants.length,{...selected,calls,tokens:totalTokens});}
 const overview:AnalyticsRoutes['overview']={...meta,tiles:{tool_calls:{value:calls,prev:Math.round(calls/1.12)},active_users:{value:active,prev:scale(1012),new:newUsers,by_kind:quality},sessions:{value:sessionCount,prev:scale(6102),calls_per_session:sessionCount?Math.round(calls/sessionCount*10)/10:null},success_rate:{value:calls?Math.round((1-errors/calls)*1000)/10:null,prev:99.1,tools_below_slo:tools.filter(t=>(t.success_rate??100)<(settings.slo_targets?.[t.slo_class]??(t.slo_class==='read'?99.5:98))).length},latency:{p50:180,p95:640,p99:2100,prev_p95:610,method:'histogram'},context_tokens:{value:totalTokens,prev:Math.round(totalTokens/1.1),per_call:calls?Math.round(totalTokens/calls):null,estimated:true}},calls_by_client:{buckets:bucket,points:Array.from({length:count},(_,i)=>({t:iso(from+step*i),by_client:Object.fromEntries(byClient.map(c=>[c.name,split(c.calls,i)]))}))},funnel,attention:[...tools.filter(t=>(t.success_rate??100)<(settings.slo_targets?.[t.slo_class]??(t.slo_class==='read'?99.5:98))).map(t=>({tool:t.tool,calls:t.calls,success_rate:t.success_rate,p95:t.latency.p95,slo_class:t.slo_class,status:'error' as const})),...dead.map(tool=>({tool,calls:0,success_rate:null,p95:null,slo_class:'mutate',status:'dead' as const}))],cohorts:{kind:'weekly',rows:cohorts}};
 const histogram=(parts:number[])=>parts.map((n,i)=>i===parts.length-1?calls-parts.slice(0,-1).reduce((s,n)=>s+Math.round(calls*n),0):Math.round(calls*n));
 const data:AnalyticsRoutes={overview,
 adoption:{...meta,active:{bucket,dau:scale(410),wau:active,mau:scale(2810),points:Array.from({length:count},(_,i)=>({t:iso(from+step*i),users:scale(350+i*10),wau:scale(Math.round(900+i*194/6)),mau:scale(2600+i*35),new:split(newUsers,i),returning:scale(350+i*10)-split(newUsers,i),by_kind:{strong:scale(260+i*8),key:scale(60+i),network:scale(350+i*10)-scale(260+i*8)-scale(60+i)}}))},clients:byClient,protocol_versions:[{version:'2025-11-25',sessions:sessionCount-scale(280)},{version:'2025-03-26',sessions:scale(280)}],transports:[{transport:'streamable-http',sessions:sessionCount-scale(280)},{transport:'stdio',sessions:scale(280)}],retention:{daily:{d1:38.2,d7:27.5,d30:18.1},weekly:cohorts},funnel:{steps:funnel},identity_quality:quality},
 tools:{...meta,catalog:{advertised:15,used:tools.length,dead,known:true,catalog_hash:'demo-catalog-v2',updated_at:iso(from)},tools,paths:[{sequence:['search_products','get_product','add_to_cart'],count:scale(812),pct:12.5},{sequence:['get_customer','list_orders'],count:scale(621),pct:9.6},{sequence:['search_products','book_flight'],count:scale(408),pct:6.3}]},
 reliability:{...meta,slo:(['read','mutate'] as const).map(c=>{const group=tools.filter(t=>t.slo_class===c),n=group.reduce((s,t)=>s+t.calls,0),e=group.reduce((s,t)=>s+(t.errors.tool??0),0),target=settings.slo_targets?.[c]??(c==='read'?99.5:98);return {class:c,target,success_rate:n?Math.round((1-e/n)*1000)/10:null,error_budget_pct:n?Math.max(0,Math.round((1-e/(n*(1-target/100)))*1000)/10):null,burn_rate_1h:c==='read'?.4:1.7,burn_rate_6h:c==='read'?.6:1.6};}),handshake:{attempts:sessionCount,success_rate:null,p95:null},timeouts:{count:null,pct:null},cancellations:{count:scale(31),pct:.1},error_codes:[],hallucinated_tools:{count:null,names:[]},sessions_with_errors:{count:scale(210),pct:3.2},silent_failures:{count:scale(4)},auth_failures:[],availability:null},
 cost:{...meta,total_tokens_est:totalTokens,per_call:calls?Math.round(totalTokens/calls):null,estimated:true,by_tool:tools.map(t=>({tool:t.tool,calls:t.calls,tokens:t.calls*(t.output_tokens_est??0),pct:Math.round(t.calls*(t.output_tokens_est??0)/Math.max(1,totalTokens)*1000)/10})).sort((a,b)=>b.tokens-a.tokens),by_tenant:tenants,payload_hist:{buckets:['<1K','1–4K','4–16K','16–64K','>64K'],input:histogram([.25,.62,.1,.02,.01]),output:histogram([.17,.41,.31,.08,.03])},billing_periods:tenants.map(t=>({period:'2026-10',caller:t.caller,calls:t.calls,tokens:t.tokens}))},
 protocol:{...meta,capabilities:{sessions:sessionCount,client:[{name:'roots',sessions:sessionCount,pct:100},{name:'sampling',sessions:Math.round(sessionCount*.46),pct:46},{name:'elicitation',sessions:Math.round(sessionCount*.34),pct:34}],server:[{name:'tools',sessions:sessionCount,pct:100},{name:'resources',sessions:sessionCount,pct:100},{name:'prompts',sessions:sessionCount,pct:100}]},sampling:{requests:null,p95:null,rejected_pct:null,by_model:[]},elicitation:{requests:null,accept_pct:null,decline_pct:null,cancel_pct:null},tasks:{created:null,completed:null,failed:null,cancelled:null},progress:{long_calls:null,with_progress_pct:null}},
 alerts:{...meta,rules:structuredClone(rules)},digest:{...meta,tools:tools.map(t=>({tool:t.tool,calls:t.calls,delta_pct:12,success_rate:t.success_rate,p95:t.latency.p95})),top_error_kinds:[{kind:'tool',count:errors}],new:newUsers,returning:active-newUsers,dead_tools:dead,changes:['Tool calls grew 12% versus the previous window.','Booking success is below the mutate SLO.']}};
 return data[route];
}
export function demoTimeline(id:string):TimelineAnalytics {
 const meta=demoAnalytics('overview',{});
 const index=Number(id.split('-').at(-1))||0;
 const active=index<2;
 return {range:meta.range,generated_at:meta.generated_at,session:{session_id:id,client:['Claude','ChatGPT','Cursor','Other'][index%4],identity:['Production app','Avery Chen','Support workspace','Network a18c72','Development key','Jordan Lee'][index%6],transport:'streamable-http',reason:active?null:'client',duration_ms:active?null:8400},events:[['session.started',null,0],['mcp.initialize','initialize',30],['mcp.request','tools/list',90],['tool.called','search_products',250],['tool.called','get_product',960],['tool.called','add_to_cart',1500],['session.ended',null,8400]].filter(([type])=>!active||type!=='session.ended').map(([type,name,offset],i)=>({type:String(type),offset_ms:Number(offset),...(type==='tool.called'?{tool:String(name)}:name?{method:String(name)}:{}),duration_ms:i===0||i===6?null:80+i*35,is_error:false,error_kind:null,output_kinds:i>2&&i<6?['text']:[],input_bytes:i>2&&i<6?210:null,output_bytes:i>2&&i<6?1840:null,args_hash:null}))};
}
