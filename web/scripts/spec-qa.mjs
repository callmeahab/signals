import assert from 'node:assert/strict';
import { demoClient } from '../apps/dashboard/src/demo.ts';
import { demoClient as hostClient } from '../../examples/next-host/app/fixture.ts';
const required = {
  'session.started':['transport'], 'session.ended':['duration_ms','reason'],
  'mcp.initialize':['requested_protocol_version','client_capabilities','server_capabilities'],
  'tool.called':['tool','duration_ms','is_error','input_bytes','output_bytes','output_kinds','cancelled'],
  'resource.read':['uri','duration_ms','is_error','output_bytes'],
  'prompt.get':['prompt','duration_ms','is_error','output_bytes'],
  'mcp.request':['method','duration_ms','is_error'], log:['level','message'], error:['message','where'], custom:['name'],
};
for (const client of [demoClient,hostClient]) {
  const {items}=await client.events('demo',{});
  assert.deepEqual([...new Set(items.map(e=>e.type))].sort(),Object.keys(required).sort());
  for(const event of items) {
    assert.match(event.id,/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(new Date(event.ts).toISOString(),event.ts);
    for(const field of required[event.type]) assert(field in event.attrs,`${event.type}: ${field}`);
    assert(event.client.name && event.client.version && event.client.protocol_version);
    assert(event.source.sdk && event.source.instance_id);
    assert(!('tool' in event) && !('is_error' in event) && !('duration_ms' in event));
  }
  const networkCallers=(await client.callers('demo','24h')).filter(c=>c.kind==='network');
  assert(networkCallers.length>0);
  for(const caller of networkCallers) {
    const {items:events}=await client.events('demo',{caller:caller.id});
    assert(events.length>0);
    for(const event of events) {
      assert.match(event.caller.ip_hash,/^[0-9a-f]{64}$/);
      assert(!('ip' in event.caller), 'stored caller must not expose raw IP');
    }
  }
  const {items:logs}=await client.events('demo',{type:'log',q:'document index'});
  assert(logs.length>0 && logs.every(e=>e.type==='log'));
  const {items:errors}=await client.events('demo',{is_error:true});
  assert(errors.some(e=>e.type==='error') && errors.some(e=>e.type==='tool.called'));
  const {items:toolErrors}=await client.events('demo',{tool:'search_documents',is_error:true});
  assert(toolErrors.length>0 && toolErrors.every(e=>e.attrs.tool==='search_documents' && e.attrs.is_error));
  const {items:sessions}=await client.sessions('demo');
  assert(sessions.every(s=>s.client_name));
}
console.log('Spec fixture QA passed: all 10 event types, UUIDv7, attrs, client/source, search and error/tool filters.');

// Validate JSON on the wire, independently of the TypeScript implementation.
const { analyticsShapes, validateShape } = await import('./analytics-shapes.mjs');
const json = value => JSON.parse(JSON.stringify(value));
for (const range of ['24h','7d','30d','90d']) {
 for (const [route,shape] of Object.entries(analyticsShapes)) {
  if (route === 'timeline') continue;
  validateShape(json(await demoClient.analytics('demo',route,{range})),shape,route);
 }
}
for(const session of (await demoClient.sessions('demo')).items)
 validateShape(json(await demoClient.timeline('demo',session.session_id)),analyticsShapes.timeline,'timeline');
// Guard the validator itself against silently accepting missing/extra keys or bad types.
const sample=json(await demoClient.analytics('demo','overview',{range:'7d'}));
const missing=globalThis.structuredClone(sample);delete missing.tiles.tool_calls.value;
assert.throws(()=>validateShape(missing,analyticsShapes.overview),/missing key/);
const wrong=globalThis.structuredClone(sample);wrong.tiles.tool_calls.value='48212';
assert.throws(()=>validateShape(wrong,analyticsShapes.overview),/expected integer/);
assert.throws(()=>validateShape({...sample,undocumented:true},analyticsShapes.overview),/unexpected key/);
console.log('Demo contract shapes passed: 8 analytics routes × 4 ranges, all session timelines, missing/extra keys and type-drift guards.');
