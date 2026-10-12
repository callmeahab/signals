import assert from 'node:assert/strict';
import { demoClient, demoProject } from '../apps/dashboard/src/demo.ts';
const sum=(rows,field)=>rows.reduce((n,r)=>n+r[field],0);
for(const range of ['24h','7d','30d','90d']) {
 const routes=Object.fromEntries(await Promise.all(['overview','adoption','tools','reliability','cost','protocol','alerts','digest'].map(async name=>[name,await demoClient.analytics('demo',name,{range})])));
 const {overview:o,tools:t,cost:c,adoption:a}=routes;
 assert.equal(sum(t.tools,'calls'),o.tiles.tool_calls.value);
 assert.equal(sum(c.by_tool,'tokens'),o.tiles.context_tokens.value);
 assert.equal(sum(c.by_tenant,'tokens'),c.total_tokens_est);
 assert.equal(sum(c.by_tenant,'calls'),o.tiles.tool_calls.value);
 assert.equal(sum(a.clients,'calls'),o.tiles.tool_calls.value);
 for(const client of a.clients)assert.equal(client.pct,Math.round(client.calls/o.tiles.tool_calls.value*1000)/10);
 assert(Math.abs(sum(a.clients,'pct')-100)<=.1000001);
 assert.equal(sum(a.clients,'sessions'),o.tiles.sessions.value);
 assert.equal(sum(a.transports,'sessions'),o.tiles.sessions.value);
 assert.equal(c.payload_hist.input.reduce((a,b)=>a+b,0),o.tiles.tool_calls.value);
 assert.equal(c.payload_hist.output.reduce((a,b)=>a+b,0),o.tiles.tool_calls.value);
 assert.equal(o.calls_by_client.points.reduce((n,p)=>n+Object.values(p.by_client).reduce((a,b)=>a+b,0),0),o.tiles.tool_calls.value);
 assert.equal(Object.values(o.tiles.active_users.by_kind).reduce((a,b)=>a+b,0),o.tiles.active_users.value);
 for(const p of a.active.points){assert.equal(p.new+p.returning,p.users);assert.equal(Object.values(p.by_kind).reduce((a,b)=>a+b,0),p.users);}
 for(const row of t.tools){assert.equal(sum(row.trend,'calls'),row.calls);assert.equal(sum(row.trend,'errors'),row.errors.tool);assert.equal(row.schema_failures.input,null);assert.equal(row.latency.buckets.edges.length,61);assert.equal(row.latency.buckets.edges.at(-1),null);assert.equal(row.latency.buckets.counts.length,60);assert.equal(row.latency.buckets.counts.reduce((a,b)=>a+b,0),row.calls);assert(row.latency.p50<=row.latency.p95&&row.latency.p95<=row.latency.p99);}
 assert.equal(routes.reliability.handshake.success_rate,null);assert.deepEqual(o.tiles.latency.sparkline,routes.reliability.latency_over_time.points.map(p=>p.p95));assert.equal(a.active.points.reduce((n,p)=>n+p.sessions,0),o.tiles.sessions.value);
 assert.equal(routes.reliability.availability,null);
 assert.equal(routes.protocol.sampling.requests,null);
 for(const value of Object.values(routes)){assert(value.generated_at);assert.equal(Date.parse(value.range.to)-Date.parse(value.range.from),Date.parse(value.range.prev_to)-Date.parse(value.range.prev_from));}
 assert.equal(t.catalog.advertised,t.catalog.used+t.catalog.dead.length);
}
for(const name of ['client','tool','transport','caller'])await assert.rejects(()=>demoClient.analytics('demo','overview',{[name]:'invalid'}),/invalid_filter/);
const filtered=await demoClient.analytics('demo','tools',{tool:'get_product'});assert.deepEqual(filtered.tools.map(t=>t.tool),['get_product']);
const timeline=await demoClient.timeline('demo','demo-session-0');assert.equal(timeline.session.session_id,'demo-session-0');assert(timeline.events.every((e,i,rows)=>i===0||e.offset_ms>=rows[i-1].offset_ms));
const before=await demoClient.analytics('demo','cost',{});
await demoClient.updateProject('demo',{...demoProject,token_divisor:8});
const after=await demoClient.analytics('demo','cost',{});assert.equal(after.total_tokens_est,before.total_tokens_est/2);
await demoClient.updateProject('demo',{...demoProject,token_divisor:4});
const alerts=await demoClient.analytics('demo','alerts',{});assert.equal(alerts.rules.length,5);const updated=alerts.rules.map(r=>({...r,enabled:false}));await demoClient.saveAlerts('demo',updated);assert((await demoClient.analytics('demo','alerts',{})).rules.every(r=>!r.enabled));await demoClient.saveAlerts('demo',alerts.rules);
console.log('Analytics QA passed: 8 routes × 4 ranges, coherent totals, nulls, filters, ordered timeline, token divisor and alert persistence.');

const many=await demoClient.analytics('demo-many-clients','adoption',{range:'7d'});
const manyOverview=await demoClient.analytics('demo-many-clients','overview',{range:'7d'});
assert.equal(many.clients.length,27);
assert.equal(sum(many.clients,'sessions'),manyOverview.tiles.sessions.value);
assert.equal(sum(many.clients,'calls'),manyOverview.tiles.tool_calls.value);
assert.equal(manyOverview.calls_by_client.points.reduce((sum,p)=>sum+Object.values(p.by_client).reduce((a,b)=>a+b,0),0),manyOverview.tiles.tool_calls.value);
for(const c of many.clients)assert.equal(c.pct,Math.round(c.calls/manyOverview.tiles.tool_calls.value*1000)/10);
const zero=await demoClient.analytics('demo','adoption',{range:'24h',from:'2026-10-11T00:00:00Z',to:'2026-10-11T00:00:01Z'});
assert(zero.clients.every(c=>c.calls===0&&c.pct===null));
console.log('Client share QA passed: 27 clients, repeated versions, coherent calls/sessions and null shares without calls.');
