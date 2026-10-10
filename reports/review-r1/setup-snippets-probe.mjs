// Review round 1 probe: capture the Setup screen snippets from the running demo UI
// and validate the raw-HTTP batch with the spec's conformance validator + pipeline.
// Run from web/:  PLAYWRIGHT_CHANNEL=chromium bun ../reports/review-r1/setup-snippets-probe.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const playwright = await import(process.env.PW_MODULE ?? new URL('../../web/node_modules/@playwright/test/index.js', import.meta.url).href);
const chromium = playwright.chromium ?? playwright.default.chromium;
import { createValidators, formatErrors } from '/home/vuk/orca/projects/signals-spec/conformance/src/lib/schema.mjs';
import { processBatch } from '/home/vuk/orca/projects/signals-spec/conformance/src/lib/ingest.mjs';

const out = process.env.PROBE_OUT ?? '/tmp/review-r1-out';
const port = Number(process.env.PROBE_UI_PORT ?? 23350);
const base = `http://127.0.0.1:${port}`;
mkdirSync(out, { recursive: true });

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'apps/dashboard/vite.config.ts', '--host', '127.0.0.1', '--port', String(port)], { env: { ...process.env, VITE_DEMO: '1' }, stdio: 'pipe' });
try {
  let ready = false;
  for (let n = 0; n < 150; n++) { if (server.exitCode !== null) throw new Error('vite exited'); try { ready = (await fetch(base)).ok; } catch { ready = false; } if (ready) break; await delay(100); }
  if (!ready) throw new Error('demo UI did not start');

  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chromium' });
  const snippets = {};
  try {
    const page = await browser.newPage();
    await page.goto(`${base}/#setup`);
    snippets.env = await page.locator('.copy-block pre').first().innerText();
    for (const [tab, file] of [['Python', 'python'], ['Node.js', 'node'], ['cURL', 'curl']]) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      snippets[file] = await page.locator('.copy-block pre').last().innerText();
      writeFileSync(`${out}/setup-${file}.txt`, snippets[file]);
    }
    writeFileSync(`${out}/setup-env.txt`, snippets.env);
  } finally { await browser.close(); }

  // The raw-HTTP snippet must be a spec-valid batch.
  const body = snippets.curl.match(/-d '([\s\S]+)'/)[1];
  writeFileSync(`${out}/setup-curl-batch.json`, body);
  const validators = createValidators();
  const batch = JSON.parse(body);
  assert.ok(validators.validateBatch(batch), `batch.schema.json: ${formatErrors(validators.validateBatch.errors).join('; ')}`);
  for (const event of batch.events) {
    assert.ok(validators.validateEvent(event), `events.schema.json: ${formatErrors(validators.validateEvent.errors).join('; ')}`);
  }
  // Full ingest pipeline, as the reference collector runs it (clock = sent_at).
  const result = processBatch('json', body, { validators, receivedAtMs: null, retentionDays: 30 });
  writeFileSync(`${out}/setup-curl-ingest.json`, JSON.stringify({ status: result.status, accepted: result.accepted?.length, rejected: result.rejected }, null, 2));
  assert.equal(result.status, 202, JSON.stringify(result.error ?? result));
  assert.deepEqual(result.rejected, []);
  assert.equal(result.accepted.length, batch.events.length);

  // Run the copied curl command verbatim against the spec's mock collector
  // (only the host:port is redirected away from the demo's hard-coded 8300).
  const mockPort = Number(process.env.PROBE_MOCK_PORT ?? 23351);
  const record = `${out}/setup-curl-record.ndjson`;
  const mock = spawn('node', ['/home/vuk/orca/projects/signals-spec/conformance/src/serve.mjs', '--port', String(mockPort), '--clock', 'sent_at', '--record', record, '--key', 'sgk_test_x', '--quiet'], { stdio: 'pipe' });
  try {
    for (let n = 0; n < 100; n++) { try { if ((await fetch(`http://127.0.0.1:${mockPort}/healthz`)).ok) break; } catch { /* starting */ } await delay(100); }
    const command = snippets.curl.replace(/"http:\/\/[^"]+"/, `"http://127.0.0.1:${mockPort}/v1/events"`) + ' -s -o - -w "\\n%{http_code}\\n"';
    writeFileSync(`${out}/setup-curl-command.sh`, `export SIGNALS_KEY=sgk_test_x\n${command}\n`);
    const { execFileSync } = await import('node:child_process');
    const stdout = execFileSync('bash', ['-c', command], { env: { ...process.env, SIGNALS_KEY: 'sgk_test_x' }, encoding: 'utf8' });
    writeFileSync(`${out}/setup-curl-response.txt`, stdout);
    const lines = stdout.trim().split('\n');
    assert.equal(lines.at(-1), '202', stdout);
    assert.deepEqual(JSON.parse(lines[0]), { accepted: 1, rejected: [] }, stdout);
    console.log(`PASS copied curl command against the mock collector: ${lines.at(-1)} ${lines[0]}`);
  } finally { mock.kill('SIGTERM'); }

  // The snippets must name the documented variables and SDK entry points.
  assert.match(snippets.env, /SIGNALS_URL=/);
  assert.match(snippets.env, /SIGNALS_KEY=/);
  assert.doesNotMatch(JSON.stringify(snippets), /SIGNALS_API_KEY/);
  assert.match(snippets.curl, /Authorization: Bearer \$SIGNALS_KEY/);
  console.log(`PASS setup raw-HTTP snippet: spec-valid batch, pipeline ${result.status}, accepted ${result.accepted.length}, rejected ${result.rejected.length}`);
} finally { server.kill('SIGTERM'); }
