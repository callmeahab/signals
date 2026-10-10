// Review round 1 probe: every event field the dashboard reads must exist in the
// spec (events.schema.json / batch.schema.json) or in the documented stored form
// (CONTRACT.md §3 replaces caller.ip with caller.ip_hash), and the UI's own types
// must not declare a key the spec does not define.
//   node reports/review-r1/field-audit-probe.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const repo = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const events = JSON.parse(readFileSync('/home/vuk/orca/projects/signals-spec/events.schema.json', 'utf8'));
const batch = JSON.parse(readFileSync('/home/vuk/orca/projects/signals-spec/batch.schema.json', 'utf8'));

const types = events.$defs.event_type.enum;
const attrKeys = new Set();
for (const type of types) for (const key of Object.keys(events.$defs[type].properties.attrs.properties)) attrKeys.add(key);
const nested = {
  client: new Set(Object.keys(events.$defs.client.properties)),
  caller: new Set([...Object.keys(events.$defs.caller.properties).filter(k => k !== 'ip'), 'ip_hash']),
  source: new Set(Object.keys(batch.$defs.source.properties)),
};
const envelopeKeys = new Set(Object.keys(events.properties));
// Collector read-model additions, documented in web/packages/ui/src/types.ts.
const readModelKeys = new Set(['caller_id', 'source']);

const files = execFileSync('git', ['-C', repo, 'ls-files', 'web', 'examples'], { encoding: 'utf8' })
  .split('\n').filter(f => /\.(ts|tsx|mjs)$/.test(f));

const problems = [];
const seen = { attrs: new Set(), client: new Set(), caller: new Set(), source: new Set() };
for (const file of files) {
  const text = readFileSync(`${repo}/${file}`, 'utf8');
  // Every `…attrs.<key>` / `attrs['<key>']` read.
  for (const match of text.matchAll(/\battrs\??\.([A-Za-z_][A-Za-z0-9_]*)|\battrs\??\[['"]([^'"]+)['"]\]/g)) {
    const key = match[1] ?? match[2];
    seen.attrs.add(key);
    if (!attrKeys.has(key)) problems.push(`${file}: attrs.${key} is not defined by any event type`);
  }
  // Nested identity objects, only as a member of something else (e.g. `e.client?.name`),
  // so the local `client`/`caller` variables of the read model are not mistaken for them.
  for (const match of text.matchAll(/\.(client|caller|source)\??\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const [, group, key] = match;
    seen[group].add(key);
    if (!nested[group].has(key)) problems.push(`${file}: ${group}.${key} is not in the spec's ${group} object`);
  }
}

// The UI's own event type must stay inside the spec envelope + documented read model.
const typesSource = readFileSync(`${repo}/web/packages/ui/src/types.ts`, 'utf8');
const eventLine = typesSource.match(/export type SignalEvent = \{[^\n]*\};/)[0];
// Flatten inline nested objects (caller: { … }) so only top-level keys are scanned.
const eventBlock = eventLine.replace(/\{[^{}]*\}(?=[;\s])/g, 'inline').replace(/^export type SignalEvent = inline;$/, eventLine);
for (const match of eventBlock.matchAll(/(?:\{ |; )([a-z_][a-z0-9_]*)\??:/g)) {
  const key = match[1];
  if (!envelopeKeys.has(key) && !readModelKeys.has(key)) problems.push(`types.ts: SignalEvent declares ${key}, which is neither a spec envelope key nor a documented read-model key`);
}
const attrsBlock = typesSource.match(/export type EventAttrs = [\s\S]*?\n\};/)[0];
for (const match of attrsBlock.matchAll(/(?:^|[\s{;])([a-z_][a-z0-9_]*)\?:/gim)) {
  if (!attrKeys.has(match[1])) problems.push(`types.ts: EventAttrs declares ${match[1]}, which no event type defines`);
}
const declaredTypes = [...typesSource.match(/export type EventType = [^;]+;/)[0].matchAll(/'([^']+)'/g)].map(m => m[1]);
assert.deepEqual(declaredTypes.slice().sort(), types.slice().sort(), 'EventType must be exactly the spec enum');
const declaredCaller = [...typesSource.match(/caller\?: \{([^}]+)\}/)[1].matchAll(/([a-z_]+)\?:/g)].map(m => m[1]);
const missingCaller = [...nested.caller].filter(k => !declaredCaller.includes(k));

if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`PASS field audit: every attrs/client/caller/source field read by web/ and examples/ is spec-defined`);
console.log(`  attrs keys read:  ${[...seen.attrs].sort().join(', ')}`);
console.log(`  client keys read: ${[...seen.client].sort().join(', ')}`);
console.log(`  caller keys read: ${[...seen.caller].sort().join(', ') || '(none)'}`);
console.log(`  source keys read: ${[...seen.source].sort().join(', ') || '(none)'}`);
console.log(`EventType is exactly the spec enum (${types.length} types).`);
console.log(`SignalEvent.caller declares [${declaredCaller.join(', ')}]; stored-form keys not declared: [${missingCaller.join(', ') || 'none'}]`);
