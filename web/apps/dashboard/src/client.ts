import type { Caller, EventFilter, Key, Overview, Page, Point, Project, Range, Session, SignalEvent, SignalsClient, Tool, User } from '@mcpramen/signals-ui';

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/v1${path}`, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error ?? `Request failed (${response.status})`); }
  if (response.status === 204) return undefined as T;
  return response.json();
}
const path = (project: string, route: string) => `/projects/${encodeURIComponent(project)}${route}`;
const query = (values: Record<string, string | boolean | undefined>) => new URLSearchParams(Object.entries(values).filter(([,v]) => v !== undefined)  .map(([k,v]) => [k,String(v)]) as [string,string][]).toString();
export const client: SignalsClient = {
  ingestUrl: `${location.origin}/v1/events`,
  toolTimeseries: (p, tool, range, signal) => request<Point[]>(path(p, `/tool-timeseries?${query({tool,range,bucket:range==='30d'?'1d':'1h'})}`), {signal}),
  callerTimeseries: (p, caller, range, signal) => request<Point[]>(path(p, `/callers/${encodeURIComponent(caller)}/timeseries?range=${range}`), {signal}),
  overview: (p, range, signal) => request<Overview>(path(p, `/overview?range=${range}`), { signal }),
  timeseries: (p, range, signal) => request<Point[]>(path(p, `/timeseries?range=${range}&bucket=${range === '30d' ? '1d' : '1h'}`), { signal }),
  tools: (p, range, signal) => request<Tool[]>(path(p, `/tools?range=${range}`), { signal }),
  callers: (p, range, signal) => request<Caller[]>(path(p, `/callers?range=${range}`), { signal }),
  sessions: (p, cursor, signal) => request<Page<Session>>(path(p, `/sessions?${query({cursor})}`), { signal }),
  sessionEvents: (p, id, signal, cursor) => request<Page<SignalEvent>>(path(p, `/sessions/${encodeURIComponent(id)}/events?${query({cursor})}`), { signal }),
  events: (p, filter: EventFilter, signal) => request<Page<SignalEvent>>(path(p, `/events?${query({...filter})}`), { signal }),
  keys: (p, signal) => request<Key[]>(path(p, '/keys'), { signal }),
  createKey: (p, label, scopes) => request(path(p, '/keys'), { method: 'POST', body: JSON.stringify({label, scopes}) }),
  revokeKey: (p, key) => request(path(p, `/keys/${key}`), { method: 'DELETE' }),
  updateProject: (p, settings) => request<Project>(path(p, ''), { method: 'PATCH', body: JSON.stringify(settings) }),
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
export type { Range };
