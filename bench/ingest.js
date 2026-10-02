import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
const acceptedEvents=new Counter('accepted_events');

export const options = { scenarios: { ingest: { executor:'constant-arrival-rate', rate:50, timeUnit:'1s', duration:'60s', preAllocatedVUs:20, maxVUs:100 } }, thresholds: { http_req_duration:['p(99)<50'], http_req_failed:['rate<0.001'],checks:['rate==1'],accepted_events:['count>=300000'],dropped_iterations:['count==0'] } };
export default function () {
  const ts=new Date().toISOString();
  const events=Array.from({length:100},(_,i)=>({id:uuid(),ts,type:'tool.call',tool:'search',duration_ms:42,is_error:false,attrs:{},session_id:`bench-${__VU}`}));
  const response=http.post(`${__ENV.SIGNALS_URL||'http://localhost:8300'}/v1/events`,JSON.stringify({sent_at:ts,events}),{headers:{'Content-Type':'application/json',Authorization:`Bearer ${__ENV.SIGNALS_API_KEY}`}});
  if(response.status===202)acceptedEvents.add(response.json('accepted'));
  check(response,{'batch acknowledged':r=>r.status===202,'all accepted':r=>r.status===202&&r.json('accepted')===100});
}
function uuid(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16);});}
