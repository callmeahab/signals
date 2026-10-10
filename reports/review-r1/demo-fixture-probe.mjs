// Review round 1 probe: every event demo.ts and fixture.ts serve must be a
// spec-valid event once the collector read-model additions (caller_id, source)
// are removed, and the whole set must be accepted by the spec's mock collector.
// Run from web/ with bun (the fixtures are TypeScript):
//   bun ../reports/review-r1/demo-fixture-probe.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createValidators, formatErrors } from '/home/vuk/orca/projects/signals-spec/conformance/src/lib/schema.mjs';
import { demoClient } from '../../web/apps/dashboard/src/demo.ts';
import { demoClient as hostClient } from '../../examples/next-host/app/fixture.ts';

const out = process.env.PROBE_OUT ?? '/tmp/review-r1-out';
mkdirSync(out, { recursive: true });
const validators = createValidators();
const port = Number(process.env.PROBE_MOCK_PORT ?? 23353);
const record = `${out}/demo-fixture-record.ndjson`;
const mock = spawn('node', ['/home/vuk/orca/projects/signals-spec/conformance/src/serve.mjs', '--port', String(port), '--clock', 'sent_at', '--record', record, '--key', 'sgk_test_x', '--quiet'], { stdio: 'pipe' });
try {
  for (let n = 0; n < 100; n++) { try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break; } catch { /* starting */ } await delay(100); }
  let total = 0;
  for (const [name, client] of [['demo.ts', demoClient], ['fixture.ts', hostClient]]) {
    const { items } = await client.events('demo', {});
    const wire = items.map(({ caller_id: _c, source: _s, ...event }) => event);
    const source = items[0].source;
    assert.ok(validators.validateSource(source), `${name} source: ${formatErrors(validators.validateSource.errors).join('; ')}`);
    for (const [i, event] of wire.entries()) {
      assert.ok(validators.validateEvent(event), `${name}[${i}] (${event.type}): ${formatErrors(validators.validateEvent.errors).join('; ')}`);
    }
    const batch = { schema_version: 1, source, sent_at: new Date().toISOString(), dropped: 0, events: wire };
    assert.ok(validators.validateBatch(batch), `${name} batch: ${formatErrors(validators.validateBatch.errors).join('; ')}`);
    const response = await fetch(`http://127.0.0.1:${port}/v1/events`, { method: 'POST', headers: { Authorization: 'Bearer sgk_test_x', 'Content-Type': 'application/json' }, body: JSON.stringify(batch) });
    const body = await response.json();
    writeFileSync(`${out}/demo-fixture-${name.replace(/\W/g, '-')}.json`, JSON.stringify({ status: response.status, body, events: wire.length }, null, 2));
    assert.equal(response.status, 202, JSON.stringify(body));
    assert.deepEqual(body.rejected, [], `${name}: ${JSON.stringify(body)}`);
    assert.equal(body.accepted, wire.length);
    const types = [...new Set(wire.map(e => e.type))].sort();
    assert.equal(types.length, 10, `${name} covers ${types.length} types: ${types.join(',')}`);
    console.log(`PASS ${name}: ${wire.length} events, ${types.length} types, mock ${response.status} accepted=${body.accepted}`);
    total += wire.length;
  }
  const stored = readFileSync(record, 'utf8').trim().split('\n').length;
  console.log(`PASS mock stored ${stored} of ${total} posted fixture events`);
} finally { mock.kill('SIGTERM'); }
