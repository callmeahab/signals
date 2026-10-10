// Reference verdicts for the collector-ingest round-2 probes.
// Invoked by edge_probe.py. The spec checkout must contain conformance/ and its
// node_modules. Reads the decoded body on stdin; an optional fourth argument
// overrides the decompressed body size used for the 413 check.
//
//   node reference.mjs verdict <spec root> json|ndjson [bodyBytes] < body
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [cmd, specRoot, kind, bodyBytes] = process.argv.slice(2);
const spec = pathToFileURL(specRoot.endsWith("/") ? specRoot : specRoot + "/");
const { createValidators } = await import(new URL("conformance/src/lib/schema.mjs", spec));
const { processBatch } = await import(new URL("conformance/src/lib/ingest.mjs", spec));
const validators = createValidators();

if (cmd !== "verdict") throw new Error(`unknown command ${cmd}`);

const body = readFileSync(0);
const result = processBatch(kind, body, {
  validators,
  receivedAtMs: null,
  retentionDays: 30,
  bodyBytes: bodyBytes === undefined ? body.length : Number(bodyBytes),
});
const payload = result.body ?? {};
process.stdout.write(
  JSON.stringify({
    status: result.status,
    error: payload.error ?? null,
    accepted: Object.prototype.hasOwnProperty.call(payload, "accepted") ? payload.accepted : null,
    rejected: Array.isArray(payload.rejected)
      ? payload.rejected.map((r) => ({ index: r.index, reason: r.reason }))
      : null,
    keys: Object.keys(payload),
  }),
);
