// Reference verdicts for the collector-ingest round-1 probe.
// Invoked by probe.py. The spec checkout must contain conformance/ and its node_modules.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [cmd, specRoot, arg] = process.argv.slice(2);
const spec = pathToFileURL(specRoot.endsWith("/") ? specRoot : specRoot + "/");
const { createValidators } = await import(new URL("conformance/src/lib/schema.mjs", spec));
const { processBatch, serialisedBytes } = await import(new URL("conformance/src/lib/ingest.mjs", spec));
const validators = createValidators();

function verdict(kind, body) {
  const result = processBatch(kind, body, {
    validators,
    receivedAtMs: null,
    retentionDays: 30,
    bodyBytes: body.length,
  });
  const payload = result.body ?? {};
  const rejected = Array.isArray(payload.rejected)
    ? payload.rejected.map((item) => ({ index: item.index, reason: item.reason }))
    : null;
  return {
    status: result.status,
    error: payload.error ?? null,
    accepted: Object.prototype.hasOwnProperty.call(payload, "accepted") ? payload.accepted : null,
    rejected,
    keys: Object.keys(payload),
  };
}

if (cmd === "verdict") {
  const body = readFileSync(0);
  process.stdout.write(JSON.stringify(verdict(arg, body)));
} else if (cmd === "sizes") {
  const fixture = JSON.parse(readFileSync(arg, "utf8"));
  const now = process.argv[5];
  const base = structuredClone(fixture.events[0]);
  const count = 8;
  function build(padLen) {
    const event = structuredClone(base);
    event.id = "018f4c2a-7c3e-7a11-8b2d-6e5f4a3b2c1d";
    event.ts = now;
    event.attrs.nums = Array.from({ length: count }, () => 1);
    event.attrs.pad = "p".repeat(padLen);
    const canonicalEvent = JSON.stringify(event);
    const marker = `"nums":[${Array.from({ length: count }, () => 1).join(",")}]`;
    if (!canonicalEvent.includes(marker)) throw new Error("nums marker missing");
    const wireEvent = canonicalEvent.replace(marker, `"nums":[${Array.from({ length: count }, () => "1.0").join(",")}]`);
    return { canonicalEvent, wireEvent, jsSize: Buffer.byteLength(canonicalEvent) };
  }
  let lo = 0;
  let hi = 20000;
  let exact = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const size = build(mid).jsSize;
    if (size === 16384) {
      exact = mid;
      break;
    }
    if (size < 16384) lo = mid + 1;
    else hi = mid - 1;
  }
  if (exact === null) throw new Error(`no pad hits 16384 (lo=${lo})`);
  const batchOf = (eventText) => {
    const batch = structuredClone(fixture);
    batch.sent_at = now;
    batch.events = [JSON.parse(eventText)];
    const canonical = JSON.stringify(batch);
    if (!eventText.includes("1.0")) return canonical;
    const marker = `"nums":[${Array.from({ length: count }, () => 1).join(",")}]`;
    const wired = `"nums":[${Array.from({ length: count }, () => "1.0").join(",")}]`;
    if (!canonical.includes(marker)) throw new Error("batch marker missing");
    return canonical.replace(marker, wired);
  };
  const at = build(exact);
  const over = build(exact + 1);
  const wire = batchOf(at.wireEvent);
  const parsedWire = JSON.parse(wire).events[0];
  if (serialisedBytes(parsedWire) !== 16384) {
    throw new Error(`wire JSON.stringify size ${serialisedBytes(parsedWire)}`);
  }
  if (!wire.includes("1.0")) throw new Error("wire spelling missing");
  const cases = {
    canonical_16384: batchOf(at.canonicalEvent),
    canonical_16385: batchOf(over.canonicalEvent),
    wire_1_0_js_16384: wire,
  };
  const out = {};
  for (const [name, text] of Object.entries(cases)) {
    const body = Buffer.from(text);
    const event = JSON.parse(text).events[0];
    out[name] = {
      body: text,
      jsEventBytes: serialisedBytes(event),
      verdict: verdict("json", body),
    };
  }
  process.stdout.write(JSON.stringify(out));
} else {
  throw new Error(`unknown command ${cmd}`);
}
