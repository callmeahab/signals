import type { Range } from './types.js';
// The collector buckets calls by client, adoption actives and tool trends by UTC day on
// every range (`analytics.rs` writes `"buckets":"day"` and `"bucket":"day"` literally, and
// a tool's trend is keyed by `date_naive()`). Latency is the one series that follows the
// window: hourly while the window is 48 hours or less, daily after that.
export const SERIES_BUCKET = 'day' as const;
export const latencyBucket = (range: Range = '7d') => range === '24h' ? 'hour' : 'day';
export const bucketMilliseconds = { hour: 3600000, day: 86400000, week: 604800000 };
export const bucketLabel = (bucket: string) => bucket === 'hour' ? 'Hourly' : bucket === 'week' ? 'Weekly' : bucket === 'day' ? 'Daily' : bucket;
export function sessionDuration(start: string, end: string | null) {
 if (!end) return 'In progress';
 const ms = Date.parse(end) - Date.parse(start);
 if (!Number.isFinite(ms) || ms < 0) return 'No data yet';
 const seconds = Math.floor(ms / 1000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
 return hours ? `${hours} h ${minutes % 60} min` : minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}
