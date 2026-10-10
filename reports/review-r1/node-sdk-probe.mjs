// Review round 1 probe, Node side:
//  1. runs the Setup screen's Node snippet verbatim (only the `app` and `transport`
//     its own comment tells the reader to supply are added) and drives MCP over HTTP;
//  2. starts the shipped examples/node/server.mjs against the spec's mock collector,
//     drives one tools/call with the real MCP client, and asserts the events arrive.
// The SDKs are resolved from the local checkouts, as examples/README.md documents.
//   node reports/review-r1/node-sdk-probe.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, symlinkSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const repo = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const sdk = '/home/vuk/orca/projects/signals-node';
const spec = '/home/vuk/orca/projects/signals-spec/conformance/src/serve.mjs';
const out = process.env.PROBE_OUT ?? '/tmp/review-r1-out';
mkdirSync(out, { recursive: true });

// examples/README.md: "npm install /path/to/signals-node" + the MCP SDK, express and zod.
// Link the local checkouts instead of writing a package.json into the repository.
function linkDeps(dir) {
  mkdirSync(`${dir}/node_modules/@mcpramen`, { recursive: true });
  mkdirSync(`${dir}/node_modules/@modelcontextprotocol`, { recursive: true });
  for (const [name, target] of [['express', `${sdk}/node_modules/express`], ['zod', `${sdk}/node_modules/zod`],
    ['@modelcontextprotocol/sdk', `${sdk}/node_modules/@modelcontextprotocol/sdk`], ['@mcpramen/signals', sdk]]) {
    const link = `${dir}/node_modules/${name}`;
    if (!existsSync(link)) symlinkSync(target, link, 'dir');
  }
}

const startMock = (port, record) => spawn('node', [spec, '--port', String(port), '--record', record, '--key', 'sgk_test_x', '--quiet'], { stdio: 'pipe' });
async function waitHealthy(port) {
  for (let n = 0; n < 150; n++) { try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return true; } catch { /* starting */ } await delay(100); }
  return false;
}
async function waitMcp(port, child) {
  // Any answer (including 404) proves the listener is up; no request is sent to
  // /mcp so a shared stateless transport is not disturbed before the real call.
  for (let n = 0; n < 200; n++) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}`);
    try { await fetch(`http://127.0.0.1:${port}/`); return true; } catch { /* starting */ }
    await delay(100);
  }
  return false;
}

// ---------- 1. the Setup screen's Node snippet ----------
{
  const snippet = readFileSync(`${out}/setup-node.txt`, 'utf8');
  assert.match(snippet, /Signals\.fromEnv\(\)/);
  const dir = `${out}/node-snippet`;
  mkdirSync(dir, { recursive: true });
  linkDeps(dir);
  const [head, tail] = snippet.split('// Your Express app and MCP transport:');
  const program = [
    "import express from 'express';",
    "import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';",
    head.trim(),
    // supplied by the reader, per the snippet's own comment
    'const app = express();',
    'app.use(express.json());',
    'const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });',
    tail.trim(),
    "app.post('/mcp', (req, res) => transport.handleRequest(req, res, req.body));",
    `app.listen(${Number(process.env.PROBE_NODE_SNIPPET_PORT ?? 23362)}, '127.0.0.1');`,
  ].join('\n');
  writeFileSync(`${dir}/snippet.mjs`, program);
  const port = Number(process.env.PROBE_NODE_SNIPPET_PORT ?? 23362);
  const child = spawn('node', [`${dir}/snippet.mjs`], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SIGNALS_URL: 'http://127.0.0.1:1', SIGNALS_KEY: 'sgk_test_x' } });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  try {
    assert.ok(await waitMcp(port, child), `snippet server did not start: ${stderr}`);
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'review-r1', version: '1.0' } } }) });
    const text = await response.text();
    writeFileSync(`${out}/node-snippet-initialize.txt`, `HTTP ${response.status} ${response.headers.get('content-type')}\n${text}`);
    assert.match(text, /serverInfo/, `HTTP ${response.status} ${response.headers.get('content-type')}: ${text}`);
    assert.equal(stderr.trim(), '', `snippet wrote to stderr: ${stderr}`);
    console.log('PASS Setup Node snippet: imports, starts and answers MCP initialize');
  } finally { child.kill('SIGTERM'); }
}

// ---------- 2. examples/node/server.mjs end to end ----------
{
  // PROBE_EXAMPLE_DIR runs the shipped server.mjs from a directory installed
  // exactly as examples/README.md documents (npm install <checkout> + peers).
  const exampleDir = process.env.PROBE_EXAMPLE_DIR ?? `${repo}/examples/node`;
  if (exampleDir !== `${repo}/examples/node`) copyFileSync(`${repo}/examples/node/server.mjs`, `${exampleDir}/server.mjs`);
  linkDeps(exampleDir);
  const mockPort = Number(process.env.PROBE_MOCK_PORT ?? 23363);
  const serverPort = Number(process.env.PROBE_NODE_EXAMPLE_PORT ?? 23364);
  const record = `${out}/node-example-record.ndjson`;
  writeFileSync(record, '');
  const mock = startMock(mockPort, record);
  const child = spawn('node', [`${exampleDir}/server.mjs`], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: String(serverPort), SIGNALS_URL: `http://127.0.0.1:${mockPort}`, SIGNALS_KEY: 'sgk_test_x', SIGNALS_DEBUG: '1' } });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  try {
    assert.ok(await waitHealthy(mockPort), 'mock collector did not start');
    assert.ok(await waitMcp(serverPort, child), `example server did not start: ${stderr}`);
    const { Client } = await import(`${exampleDir}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js`);
    const { StreamableHTTPClientTransport } = await import(`${exampleDir}/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js`);
    const client = new Client({ name: 'review-r1', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${serverPort}/mcp`)));
    const tools = await client.listTools();
    const result = await client.callTool({ name: 'add', arguments: { a: 2, b: 3 } });
    writeFileSync(`${out}/node-example-call.json`, JSON.stringify({ tools: tools.tools.map(t => t.name), result }, null, 2));
    assert.deepEqual(tools.tools.map(t => t.name), ['add']);
    assert.equal(result.content[0].text, '5', JSON.stringify(result));
    await client.close();
    // SIGTERM makes the example flush before exit.
    child.kill('SIGTERM');
    for (let n = 0; n < 100; n++) { if (readFileSync(record, 'utf8').trim()) break; await delay(100); }
    const lines = readFileSync(record, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    writeFileSync(`${out}/node-example-events.json`, JSON.stringify(lines, null, 2));
    const types = lines.map(l => l.event.type);
    console.log(`PASS examples/node/server.mjs: tools/call → 5, ${lines.length} events recorded by the spec mock: ${[...new Set(types)].sort().join(', ')}`);
    assert.ok(lines.length > 0, `no events reached the mock collector; server stderr:\n${stderr}`);
    assert.ok(types.includes('tool.called'), `no tool.called event: ${types.join(',')}`);
    const call = lines.find(l => l.event.type === 'tool.called');
    assert.equal(call.event.attrs.tool, 'add');
    assert.equal(call.source.sdk, 'node');
  } finally { child.kill('SIGTERM'); mock.kill('SIGTERM'); }
}
