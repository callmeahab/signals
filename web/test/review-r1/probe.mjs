// Round-1 review probes. These assertions describe the contract in
// briefs/v2/analytics-api.md and briefs/v2/dash-restyle.md. They fail on
// the current demo client and analytics screen. Run from web/:
//   bun test/review-r1/probe.mjs
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoClient } from '../../apps/dashboard/src/demo.ts';
import { bucketForRange, bucketMilliseconds, sessionDuration } from '../../packages/ui/src/time.ts';
import { OverviewAnalyticsScreen, AdoptionScreen, ReliabilityScreen } from '../../packages/ui/src/analytics.tsx';

const failures = [];
function check(ok, message) {
  if (!ok) failures.push(message);
}

for (const range of ['24h', '7d', '30d', '90d']) {
  const overview = await demoClient.analytics('demo', 'overview', { range });
  const times = overview.calls_by_client.points.map(point => Date.parse(point.t));
  const gaps = times.slice(1).map((time, index) => (time - times[index]) / 3600000);
  const expected=bucketForRange(range), hours=bucketMilliseconds[expected]/3600000;
  const daily = overview.calls_by_client.buckets === expected && gaps.every(gap => gap === hours);
  check(daily, `${range} calls_by_client buckets=${overview.calls_by_client.buckets} gaps=${gaps.map(gap => gap.toFixed(2)).join(',')}h (expected ${expected}, ${hours}h)`);
  check(times.length === Math.ceil((Date.parse(overview.range.to)-Date.parse(overview.range.from))/(hours*3600000)), `${range}: complete bucket count`);
  const overviewHtml=renderToStaticMarkup(createElement(OverviewAnalyticsScreen,{data:overview}));
  check(overviewHtml.includes(`${expected==='hour'?'Hourly':expected==='week'?'Weekly':'Daily'} tool calls`), `${range}: subtitle follows response`);
  check(expected!=='hour'||overviewHtml.includes('00:00'), `${range}: hourly axis includes time`);
  check(expected!=='week'||overviewHtml.includes('Week of'), `${range}: weekly axis identifies week`);
  const adoption = await demoClient.analytics('demo', 'adoption', { range });
  const adoptionHtml=renderToStaticMarkup(createElement(AdoptionScreen,{data:adoption}));
  check(adoptionHtml.includes(`${expected==='hour'?'Hourly':expected==='week'?'Weekly':'Daily'} observations`),`${range}: adoption subtitle follows response`);
  const adoptionTimes = adoption.active.points.map(point => Date.parse(point.t));
  const adoptionGaps = adoptionTimes.slice(1).map((time, index) => (time - adoptionTimes[index]) / 3600000);
  const adoptionDaily = adoption.active.bucket === expected && adoptionGaps.every(gap => gap === hours);
  check(adoptionDaily, `${range} adoption bucket=${adoption.active.bucket} gaps=${adoptionGaps.map(gap => gap.toFixed(2)).join(',')}h`);
}

const tools = await demoClient.analytics('demo', 'tools', { range: '7d' });
const overview = await demoClient.analytics('demo', 'overview', { range: '7d' });
const deadInAttention = new Set(overview.attention.filter(row => row.status === 'dead').map(row => row.tool));
for (const name of tools.catalog.dead) {
  check(deadInAttention.has(name), `catalog dead tool ${name} missing from overview attention`);
}

const sessions = await demoClient.sessions('demo');
const ended = sessions.items.find(session => session.ended_at);
const durationMs = +new Date(ended.ended_at) - +new Date(ended.started_at);
check(sessionDuration(ended.started_at,ended.ended_at) === '8 s', `session duration ${durationMs}ms must show seconds`);
assert.equal(sessionDuration('2026-10-01T00:00:00Z','2026-10-01T00:02:10Z'),'2 min 10 s');
assert.equal(sessionDuration('2026-10-01T00:00:00Z','2026-10-01T01:04:00Z'),'1 h 4 min');

const emptyClass = {
  range: { from: 'a', to: 'b', prev_from: 'c', prev_to: 'd' },
  generated_at: 't',
  slo: [{ class: 'read', target: 99.5, success_rate: null, error_budget_pct: null, burn_rate_1h: null, burn_rate_6h: null }],
  handshake: { attempts: 10, success_rate: 99.2, p95: 40 },
  timeouts: { count: null, pct: null },
  cancellations: { count: null, pct: null },
  error_codes: [],
  hallucinated_tools: { count: null, names: [] },
  sessions_with_errors: { count: null, pct: null },
  silent_failures: { count: null },
  auth_failures: [],
  availability: null,
};
const html = renderToStaticMarkup(createElement(ReliabilityScreen, { data: emptyClass }));
const progress = html.match(/<progress[^>]*>/)?.[0] ?? '';
check(!progress, `null error_budget_pct rendered as ${progress}`);
check(!html.includes('waiting for init outcomes'), 'handshake detail still says waiting for init outcomes when success_rate and p95 are present');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('review-r1 probe passed');
