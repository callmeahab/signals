// Review round 3 (reviews/dash-v6-r3.md): S2's fresh variant. The round-2 probe
// (`test/review-v6-r2/hover-copy.mjs`) opens nine hover cards in a browser — the seven it
// found plus two controls. This one sweeps all 89 entries in
// `packages/ui/src/copy/explanations.ts` statically, so a body the browser probe never
// opens cannot hide, and it checks the field contract the file's own header states:
//
//   "Each entry is two or three short sentences for a manager: what the number is, how it
//    is computed (window, identity precedence, SLO class, estimate against exact), and
//    what a bad value means or what to do about it."
//
//   bun test/review-v6-r3/copy-sweep.mjs
import { explanations } from '../../packages/ui/src/copy/explanations.ts';

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); else console.log(`ok   ${message}`); };
const context = { sloTargets: { read: 99.5, mutate: 98 } };
const resolve = entry => typeof entry === 'function' ? entry(context) : entry;

// A body opening with a *bare* pronoun has no antecedent: the hover card's title row
// above it is a noun phrase, not a sentence. "This tool's own call durations" and "These
// sessions connect…" are determiner + noun and name their subject, so only a pronoun
// standing alone as the subject counts.
const DANGLING = /^(It|They|Those|Such)\b|^(This|These)\s+(is|are|was|were|never|only|do|does|can|cannot|may|might|will|would|should|moves|means|stays|sits?|counts?|measures?|shows?|appears?|happens?)\b/;
// A body that is not a sentence: no terminal punctuation, or short enough to be a label.
const NOT_A_SENTENCE = body => !/[.!?]$/.test(body.trim()) || body.trim().length < 30;

const ids = Object.keys(explanations);
check(ids.length === 89, `all ${ids.length} explanations are present`);

const dangling = [], stubs = [], missing = [];
for (const id of ids) {
  const { title, body, computed } = resolve(explanations[id]);
  if (!title || !body || !computed) { missing.push(id); continue; }
  // Only the body is judged for a bare opening pronoun: it sits directly under the hover
  // card's title row, which is a noun phrase. `computed` and `action` follow the body,
  // which supplies their antecedent, so "It is a rolling count…" reads correctly there.
  if (DANGLING.test(body)) dangling.push(`${id}: ${body}`);
  if (NOT_A_SENTENCE(body)) stubs.push(`${id}: ${body}`);
}

check(missing.length === 0, `every entry has title, body and computed: ${JSON.stringify(missing)}`);
check(dangling.length === 0, `no body opens with a pronoun that has no antecedent (${dangling.length}): ${JSON.stringify(dangling, null, 1)}`);
check(stubs.length === 0, `every body is a complete sentence rather than a label (${stubs.length}): ${JSON.stringify(stubs, null, 1)}`);

// Three entries the round-2 sampling never opened carry the same mislabel the round was
// about: their derivation is in the body and their "How it's computed" section holds an
// interpretation instead. Listed by name rather than by heuristic, with what the reader
// sees under the heading. Untouched since `8d055b6`, so these are missed instances, not
// a regression of the round-2 fix.
const MISLABELLED = {
  'adoption.tile.mau': 'It is the denominator for stickiness and the widest honest measure of reach.',
  'reliability.tile.silent-failures': 'The model cannot tell these from an empty answer, so they look like your tool had nothing to say.',
  'reliability.card.error-codes': 'It stays empty until the SDKs report codes, which is different from having no errors.',
};
for (const [id, text] of Object.entries(MISLABELLED)) {
  const { body, computed } = resolve(explanations[id]);
  check(computed !== text,
    `${id}: "How it's computed" describes a derivation, not what to make of the number — it reads ${JSON.stringify(computed)} while the derivation sits in the body (${JSON.stringify(body)})`);
}

// The seven the round-2 review named, by id, so a regression on exactly those is loud.
const NAMED = ['sessions.tile.stdio', 'sessions.tile.open', 'reliability.tile.sessions-with-errors',
  'reliability.card.auth-failures', 'cost.tile.per-call', 'protocol.tile.elicitation', 'live.card.stream'];
for (const id of NAMED) {
  const { body } = resolve(explanations[id]);
  check(!DANGLING.test(body) && !NOT_A_SENTENCE(body), `${id} body is a complete opening sentence: ${JSON.stringify(body)}`);
}

if (failures.length) { console.error('\n' + failures.map(f => `FAIL ${f}`).join('\n')); process.exit(1); }
console.log('review-v6-r3 copy-sweep probe passed');
