import { recordProjectRead } from './project-status';
import type { Caller, EventFilter, Key, Overview, Page, Point, Project, Range, Session, SignalEvent, SignalsClient, Tool, User } from '@mcpramen/signals-ui';

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/v1${path}`, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } }).catch(error => { if (!options.signal?.aborted) recordProjectRead(path, true); throw error; });
  // The status travels with the error: only a rejected session may sign the shell out,
  // and a network blip must not.
  if (!response.ok) { if (response.status === 401 || response.status === 403 || response.status >= 500) recordProjectRead(path, true); const body = await response.json().catch(() => ({})); throw Object.assign(new Error(body.message ?? body.error ?? `Request failed (${response.status})`), { status: response.status }); }
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  recordProjectRead(path, false, data);
  return data;
}
// Legacy reads stop at 30 days; analytics keeps the requested 90-day window.
const legacyRange = (range: Range) => range === '90d' ? '30d' : range;
const legacyBucket = (range: Range) => range === '24h' ? '1h' : '1d';
const path = (project: string, route: string) => `/projects/${encodeURIComponent(project)}${route}`;
const query = (values: Record<string, string | boolean | undefined>) => new URLSearchParams(Object.entries(values).filter(([,v]) => v !== undefined)  .map(([k,v]) => [k,String(v)]) as [string,string][]).toString();
export const client: SignalsClient = {
  project: (p, signal) => request<Project>(path(p, ''), {signal}),
  analytics: (p, route, filters, signal) => request(path(p, `/analytics/${route}?${query({...filters})}`), {signal}),
  timeline: (p, session, signal) => request(path(p, `/analytics/sessions/${encodeURIComponent(session)}/timeline`), {signal}),
  saveAlerts: (p, rules) => request(path(p, '/alerts'), {method:'PUT',body:JSON.stringify({rules})}),
  ingestUrl: `${location.origin}/v1/events`,
  toolTimeseries: (p, tool, range, signal) => request<Point[]>(path(p, `/tool-timeseries?${query({tool,range:legacyRange(range),bucket:legacyBucket(range)})}`), {signal}),
  callerTimeseries: (p, caller, range, signal) => request<Point[]>(path(p, `/callers/${encodeURIComponent(caller)}/timeseries?range=${legacyRange(range)}`), {signal}),
  overview: (p, range, signal) => request<Overview>(path(p, `/overview?range=${legacyRange(range)}`), { signal }),
  timeseries: (p, range, signal) => request<Point[]>(path(p, `/timeseries?range=${legacyRange(range)}&bucket=${legacyBucket(range)}`), { signal }),
  tools: (p, range, signal) => request<Tool[]>(path(p, `/tools?range=${legacyRange(range)}`), { signal }),
  callers: (p, range, signal) => request<Caller[]>(path(p, `/callers?range=${legacyRange(range)}`), { signal }),
  sessions: (p, cursor, signal) => request<Page<Session>>(path(p, `/sessions?${query({cursor})}`), { signal }),
  sessionEvents: (p, id, signal, cursor) => request<Page<SignalEvent>>(path(p, `/sessions/${encodeURIComponent(id)}/events?${query({cursor})}`), { signal }),
  events: (p, filter: EventFilter, signal) => request<Page<SignalEvent>>(path(p, `/events?${query({...filter})}`), { signal }),
  keys: (p, signal) => request<Key[]>(path(p, '/keys'), { signal }),
  createKey: (p, label, scopes) => request(path(p, '/keys'), { method: 'POST', body: JSON.stringify({label, scopes}) }),
  revokeKey: (p, key) => request(path(p, `/keys/${key}`), { method: 'DELETE' }),
  updateProject: (p, settings) => request<Project>(path(p, ''), { method: 'PATCH', body: JSON.stringify(Object.fromEntries(Object.entries(settings).filter(([key])=>['name','retention_days','rate_events_per_min','rate_bytes_per_min','slo_classes','slo_targets','digest','token_divisor','alerts'].includes(key)))) }),
  users: (p, signal) => request<User[]>(path(p, '/users'), { signal }),
  createUser: (p, email, password, role) => request<User>(path(p, '/users'), {method:'POST',body:JSON.stringify({email,password,role})}),
  subscribe(p, onEvent, onStatus) {
    let closed = false;
    const source = new EventSource(`/v1${path(p, '/live')}`);
    const refresh = () => {
      void request<Page<SignalEvent>>(path(p, '/events')).then(page => {
        if (!closed) [...page.items].reverse().forEach(onEvent);
      }).catch(() => { if (!closed) onStatus('reconnecting'); });
    };
    source.onopen = () => { onStatus('connected'); refresh(); };
    source.onerror = () => onStatus('reconnecting');
    source.addEventListener('gap', refresh);
    source.addEventListener('signal', e => { try { onEvent(JSON.parse((e as MessageEvent).data)); } catch { onStatus('reconnecting'); } });
    return () => { closed = true; source.close(); };
  },
};
export const auth = {
  me: () => request<{user: User; projects: Project[]}>('/auth/me'),
  login: (email: string, password: string) => request<{user: User; projects: Project[]}>('/auth/login', { method: 'POST', body: JSON.stringify({email,password}) }),
  logout: () => request<void>('/auth/logout', {method:'POST'}),
};
export const statusOf = (error: unknown): number | undefined => (error as { status?: number } | null)?.status;
export type { Range };
