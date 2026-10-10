// Review round 2, check 1: build the fuzzer bodies and the reference verdicts.
//
// Reads a JSON job on stdin, writes one JSON line per case on stdout. The case
// bodies carry raw number tokens (e.g. `1.0`, `1e21`, `18446744073709551615`)
// so the wire spelling differs from `JSON.stringify`, and the pad string is
// solved so the measured container lands exactly on `cap + offset` as
// `serialisedBytes` (the CONTRACT.md definition of "serialised") sees it.
//
//   node numbers.mjs <spec root> <collector root> < job.json > cases.jsonl
//
// job: { now, cases: [ { name, fixture, target, cap, offset, numbers:[token] } ] }
// target "event" measures the whole event; otherwise it measures
// `attrs.<target>` (args / fields / props).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [specRoot, collectorRoot] = process.argv.slice(2);
const spec = pathToFileURL(specRoot.endsWith("/") ? specRoot : specRoot + "/");
const { createValidators } = await import(new URL("conformance/src/lib/schema.mjs", spec));
const { processBatch, serialisedBytes } = await import(new URL("conformance/src/lib/ingest.mjs", spec));
const validators = createValidators();

const fixtures = new Map();
function fixture(name) {
  if (!fixtures.has(name)) {
    fixtures.set(
      name,
      JSON.parse(readFileSync(`${collectorRoot}/spec/fixtures/valid/${name}.json`, "utf8")),
    );
  }
  return fixtures.get(name);
}

function bodyText(job, c, padLen) {
  const base = fixture(c.fixture);
  const batch = structuredClone(base);
  batch.sent_at = job.now;
  const event = structuredClone(base.events[0]);
  event.id = c.id;
  event.ts = job.now;
  const container = c.target === "event" ? event.attrs : (event.attrs[c.target] = {});
  container.nums = c.numbers.map((_, i) => `@@N${i}@@`);
  container.pad = "p".repeat(Math.max(padLen, 0));
  batch.events = [event];
  let text = JSON.stringify(batch);
  c.numbers.forEach((token, i) => {
    const needle = `"@@N${i}@@"`;
    if (!text.includes(needle)) throw new Error(`${c.name}: placeholder ${i} missing`);
    text = text.replace(needle, token);
  });
  if (text.includes("@@N")) throw new Error(`${c.name}: placeholder left over`);
  return text;
}

function measure(c, text) {
  const event = JSON.parse(text).events[0];
  return c.target === "event" ? serialisedBytes(event) : serialisedBytes(event.attrs[c.target]);
}

const job = JSON.parse(readFileSync(0, "utf8"));
const out = [];
for (const c of job.cases) {
  const target = c.cap + c.offset;
  // Pad is ASCII, so the measured size is affine in its length: solve, then
  // verify and nudge, which also covers a pad that cannot reach the target.
  let padLen = target - measure(c, bodyText(job, c, 0));
  let text = bodyText(job, c, padLen);
  let measured = measure(c, text);
  for (let tries = 0; measured !== target && tries < 8; tries++) {
    padLen += target - measured;
    if (padLen < 0) break;
    text = bodyText(job, c, padLen);
    measured = measure(c, text);
  }
  if (measured !== target) {
    out.push(JSON.stringify({ name: c.name, skipped: `cannot hit ${target} (got ${measured})` }));
    continue;
  }
  const body = Buffer.from(text, "utf8");
  const result = processBatch("json", body, {
    validators,
    receivedAtMs: null,
    retentionDays: 30,
    bodyBytes: body.length,
  });
  const payload = result.body ?? {};
  out.push(
    JSON.stringify({
      name: c.name,
      target: c.target,
      cap: c.cap,
      offset: c.offset,
      numbers: c.numbers,
      measured,
      bodyBytes: body.length,
      body: text,
      verdict: {
        status: result.status,
        error: payload.error ?? null,
        accepted: Object.prototype.hasOwnProperty.call(payload, "accepted") ? payload.accepted : null,
        rejected: Array.isArray(payload.rejected)
          ? payload.rejected.map((r) => ({ index: r.index, reason: r.reason }))
          : null,
      },
    }),
  );
}
process.stdout.write(out.join("\n") + "\n");
