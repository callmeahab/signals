// In-process reference pipeline (signals-spec v1.1.0 conformance/src/lib/ingest.mjs).
// stdin is unused. argv[2] is a JSON array of cases:
//   {id, content_type: "json"|"ndjson", received_at_ms, body_b64}
import { readFileSync } from "node:fs";
import { createValidators } from "/home/vuk/orca/projects/signals-spec/conformance/src/lib/schema.mjs";
import { processBatch } from "/home/vuk/orca/projects/signals-spec/conformance/src/lib/ingest.mjs";

const validators = createValidators();
const cases = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = cases.map((c) => {
  const body = Buffer.from(c.body_b64, "base64");
  const result = processBatch(c.content_type, body, {
    validators,
    receivedAtMs: c.received_at_ms,
    retentionDays: c.retention_days ?? 30,
    bodyBytes: body.length,
  });
  const rejected = (result.body?.rejected ?? []).map((r) => ({ index: r.index, reason: r.reason }));
  return {
    id: c.id,
    status: result.status,
    error: result.body?.error ?? null,
    accepted: result.status === 202 ? result.body.accepted : null,
    rejected,
  };
});
process.stdout.write(JSON.stringify(out));
