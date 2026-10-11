// Independent, small JSON-shape description of briefs/v2/analytics-api.md.
// Optional frontend additions are named explicitly; unknown keys fail validation.
import assert from 'node:assert/strict';
const nullable = shape => ({ nullable: shape });
const optional = shape => ({ optional: shape });
const list = shape => [shape];
const map = shape => ({ map: shape });
const n='number', i='integer', s='string', b='boolean', nn=nullable(n), ni=nullable(i), ns=nullable(s);
const identity={strong:i,key:i,network:i};
const latency={p50:ni,p95:ni,p99:ni,method:s};
const cohort={cohort_start:s,size:i,retained_pct:list(nn)};
const funnel={step:s,count:ni,eligible:optional(i),dropoff_pct:optional(nn)};
const meta={range:{from:s,to:s,prev_from:s,prev_to:s},generated_at:s};
const tool={tool:s,slo_class:s,calls:i,success_rate:nn,errors:{tool:ni,protocol:ni,timeout:ni,cancelled:ni,unknown:ni},latency,input_bytes_avg:nn,output_bytes_avg:nn,output_tokens_est:nn,retries:{count:i,self_corrected_pct:nn},schema_failures:{input:ni,output:ni},trend:list({t:s,calls:i,errors:i})};
const capability={name:s,sessions:i,pct:n};
const countRate={count:ni,pct:nn};
export const analyticsShapes={
 overview:{...meta,tiles:{tool_calls:{value:i,prev:ni},active_users:{value:i,prev:ni,new:i,by_kind:identity},sessions:{value:i,prev:ni,calls_per_session:nn},success_rate:{value:nn,prev:nn,tools_below_slo:i},latency:{...latency,prev_p95:ni},context_tokens:{value:ni,prev:optional(ni),per_call:nn,estimated:b}},calls_by_client:{buckets:s,points:list({t:s,by_client:map(i)})},funnel:list(funnel),attention:list({tool:s,calls:i,success_rate:nn,p95:ni,slo_class:s,status:s}),cohorts:{kind:s,rows:list(cohort)}},
 adoption:{...meta,active:{bucket:s,dau:i,wau:i,mau:i,points:list({t:s,users:i,new:i,returning:i,by_kind:identity,wau:optional(ni),mau:optional(ni)})},clients:list({name:s,version:s,sessions:i,calls:i,pct:n,capabilities:list(s)}),protocol_versions:list({version:s,sessions:i}),transports:list({transport:s,sessions:i}),retention:{daily:{d1:nn,d7:nn,d30:nn},weekly:list(cohort)},funnel:{steps:list(funnel)},identity_quality:identity},
 tools:{...meta,catalog:{advertised:ni,used:i,dead:list(s),known:b,catalog_hash:ns,updated_at:ns},tools:list(tool),paths:list({sequence:list(s),count:i,pct:n})},
 reliability:{...meta,slo:list({class:s,target:n,success_rate:nn,error_budget_pct:nn,burn_rate_1h:nn,burn_rate_6h:nn}),handshake:{attempts:i,success_rate:nn,p95:ni},timeouts:countRate,cancellations:countRate,error_codes:list({code:i,kind:s,count:i}),hallucinated_tools:{count:ni,names:list(s)},sessions_with_errors:countRate,silent_failures:{count:ni},auth_failures:list({reason:s,count:i}),availability:nullable({uptime_pct:nn,last_probe_at:ns,last_failure_at:ns,advertised_tools:ni,healthy_tools:ni,probes:list({t:s,ok:b,latency_ms:i})})},
 cost:{...meta,total_tokens_est:ni,per_call:nn,estimated:b,by_tool:list({tool:s,calls:i,tokens:i,pct:n}),by_tenant:list({caller:s,identity_kind:s,calls:i,tokens:i}),payload_hist:{buckets:list(s),input:list(i),output:list(i)},billing_periods:list({period:s,caller:s,calls:i,tokens:i})},
 protocol:{...meta,capabilities:{sessions:i,client:list(capability),server:list(capability)},sampling:{requests:ni,p95:ni,rejected_pct:nn,by_model:list({model:s,requests:i})},elicitation:{requests:ni,accept_pct:nn,decline_pct:nn,cancel_pct:nn},tasks:{created:ni,completed:ni,failed:ni,cancelled:ni},progress:{long_calls:ni,with_progress_pct:nn}},
 // These envelopes are the existing explicit UI expectations; the brief specifies
 // their contents in prose rather than complete JSON examples (see report).
 alerts:{...meta,rules:list({id:s,name:s,enabled:b,threshold:n,window_minutes:i,state:s})},
 digest:{...meta,tools:list({tool:s,calls:i,delta_pct:nn,success_rate:nn,p95:ni}),top_error_kinds:list({kind:s,count:i}),new:i,returning:i,dead_tools:list(s),changes:list(s)},
 timeline:{...meta,session:{session_id:s,client:nullable({name:s,version:optional(s),protocol_version:optional(s)}),identity:nullable({kind:s,key:s}),transport:ns,reason:ns,duration_ms:ni},events:list({id:optional(s),ts:optional(s),offset_ms:i,type:s,tool:optional(s),method:optional(s),uri:optional(s),prompt:optional(s),duration_ms:ni,is_error:nullable(b),error_kind:ns,output_kinds:nullable(list(s)),input_bytes:ni,output_bytes:ni,args_hash:ns})},
};
export function validateShape(value,shape,path='payload') {
 if(typeof shape==='string'){
  assert(shape==='integer'?Number.isInteger(value):typeof value===shape,`${path}: expected ${shape}`);
  if(shape==='number')assert(Number.isFinite(value),`${path}: expected finite number`);
  return;
 }
 if(Array.isArray(shape)){assert(Array.isArray(value),`${path}: expected array`);value.forEach((v,k)=>validateShape(v,shape[0],`${path}[${k}]`));return;}
 if('nullable' in shape){if(value!==null)validateShape(value,shape.nullable,path);return;}
 if('optional' in shape){if(value!==undefined)validateShape(value,shape.optional,path);return;}
 assert(value!==null&&typeof value==='object'&&!Array.isArray(value),`${path}: expected object`);
 if('map' in shape){Object.entries(value).forEach(([k,v])=>validateShape(v,shape.map,`${path}.${k}`));return;}
 for(const key of Object.keys(value))assert(Object.hasOwn(shape,key),`${path}.${key}: unexpected key`);
 for(const [key,child] of Object.entries(shape)){
  if(!(typeof child==='object'&&!Array.isArray(child)&&'optional' in child))assert(Object.hasOwn(value,key),`${path}.${key}: missing key`);
  validateShape(value[key],child,`${path}.${key}`);
 }
}
