// Review round 1 probe: the batches web/scripts/backend-qa.mjs posts must be
// spec-valid and its expectations must match ingest.openapi.yaml (202 body shape,
// replays counted as accepted). The batch literals are lifted out of the QA script
// itself so the probe checks the shipped code, not a copy of it.
// Run:  node reports/review-r1/backend-qa-batch-probe.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createValidators, formatErrors } from '/home/vuk/orca/projects/signals-spec/conformance/src/lib/schema.mjs';

const out = process.env.PROBE_OUT ?? '/tmp/review-r1-out';
mkdirSync(out, { recursive: true });
const source = readFileSync(new URL('../../web/scripts/backend-qa.mjs', import.meta.url), 'utf8');
const pick = prefix => {
  const line = source.split('\n').find(l => l.trimStart().startsWith(prefix));
  assert.ok(line, `backend-qa.mjs no longer has a line starting with ${prefix}`);
  return line.trim();
};
const program = [pick('const uuid7='), pick('const envelope='), pick('const first='), pick('const events='), pick('const liveEvent=')]
  .join('\n') + '\nexport const batches = { main: envelope(events), live: envelope([liveEvent]) };\n';
writeFileSync(`${out}/backend-qa-extract.mjs`, program);
const { batches } = await import(`${out}/backend-qa-extract.mjs`);
writeFileSync(`${out}/backend-qa-batch.json`, JSON.stringify(batches.main, null, 2));

const validators = createValidators();
for (const [name, batch] of Object.entries(batches)) {
  assert.ok(validators.validateBatch(batch), `${name}: ${formatErrors(validators.validateBatch.errors).join('; ')}`);
  for (const [i, event] of batch.events.entries()) {
    assert.ok(validators.validateEvent(event), `${name}[${i}]: ${formatErrors(validators.validateEvent.errors).join('; ')}`);
  }
}
console.log(`PASS backend-qa batches validate: main ${batches.main.events.length} events, live ${batches.live.events.length} event`);

// The reference collector must answer exactly what the script asserts, twice:
// 202 {accepted, rejected} and the same accepted count on replay.
const port = Number(process.env.PROBE_MOCK_PORT ?? 23352);
const record = `${out}/backend-qa-record.ndjson`;
const mock = spawn('node', ['/home/vuk/orca/projects/signals-spec/conformance/src/serve.mjs', '--port', String(port), '--clock', 'sent_at', '--record', record, '--key', 'sgk_test_x', '--quiet'], { stdio: 'pipe' });
try {
  for (let n = 0; n < 100; n++) { try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) break; } catch { /* starting */ } await delay(100); }
  const post = async body => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/events`, { method: 'POST', headers: { Authorization: 'Bearer sgk_test_x', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const first = await post(batches.main);
  const replay = await post(batches.main);
  writeFileSync(`${out}/backend-qa-responses.json`, JSON.stringify({ first, replay }, null, 2));
  assert.equal(first.status, 202, JSON.stringify(first));
  assert.equal(first.body.accepted, batches.main.events.length, JSON.stringify(first));
  assert.deepEqual(first.body.rejected, []);
  assert.equal(replay.status, 202, JSON.stringify(replay));
  assert.equal(replay.body.accepted, batches.main.events.length, `replay must count as accepted: ${JSON.stringify(replay)}`);
  const stored = readFileSync(record, 'utf8').trim().split('\n').length;
  assert.equal(stored, batches.main.events.length, `replays must not be stored twice: ${stored}`);
  console.log(`PASS reference collector: first ${first.status} accepted=${first.body.accepted}, replay ${replay.status} accepted=${replay.body.accepted}, stored lines ${stored}`);
} finally { mock.kill('SIGTERM'); }
