import assert from 'node:assert/strict';
import { snippetId } from '../packages/ui/src/snippet-id.ts';
const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const original = globalThis.crypto;
const insecureCrypto = { getRandomValues: original.getRandomValues.bind(original), randomUUID: original.randomUUID };
delete insecureCrypto.randomUUID;
const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
try {
  Object.defineProperty(globalThis, 'crypto', { configurable:true, value:insecureCrypto });
  assert.equal(globalThis.crypto.randomUUID, undefined);
  const start = Date.now();
  const id = snippetId();
  assert.match(id, pattern);
  const timestamp = parseInt(id.replaceAll('-', '').slice(0,12),16);
  assert(timestamp >= start && timestamp <= Date.now());
  assert.notEqual(snippetId(), id);
  for (const unavailable of [undefined, {}, {getRandomValues(){throw new Error('unavailable');}}]) {
    Object.defineProperty(globalThis, 'crypto', { configurable:true, value:unavailable });
    assert.match(snippetId(), pattern);
  }
} finally {
  Object.defineProperty(globalThis, 'crypto', descriptor);
}
console.log('Snippet UUID QA passed: randomUUID deleted, UUIDv7 timestamp/version/variant, missing and throwing crypto fallbacks.');
