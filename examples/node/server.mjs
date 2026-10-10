// Install and run: see ../README.md (the Signals SDK is currently unpublished).
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Signals } from '@mcpramen/signals';
import { z } from 'zod';

const signals = Signals.fromEnv();
const app = express();
app.use(express.json());
app.use(signals.express());
// Stateless HTTP: each request gets its own MCP server and transport.
app.post('/mcp', async (req, res) => {
  const server = new McpServer({ name: 'signals-node-example', version: '1.0.0' });
  server.registerTool('add', {
    description: 'Add two finite numbers',
    inputSchema: { a: z.number().finite(), b: z.number().finite() },
  }, async ({ a, b }) => {
    if (!Number.isFinite(a + b)) return { content: [{ type: 'text', text: 'Sum must be finite' }], isError: true };
    return { content: [{ type: 'text', text: String(a + b) }] };
  });
  signals.instrument(server);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
const listener = app.listen(Number(process.env.PORT ?? 23001), '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  listener.close(async () => { await signals.close(); });
});
