export type Range = '24h' | '7d' | '30d';
export type Screen = 'overview' | 'tools' | 'callers' | 'sessions' | 'live' | 'settings' | 'setup';
export type Project = { id: string; name: string; slug: string; retention_days: number; rate_events_per_min: number; rate_bytes_per_min: number };
export type SignalEvent = { id: string; ts: string; type: string; session_id?: string | null; caller_id?: string | null; tool?: string | null; duration_ms?: number | null; is_error: boolean; client_name?: string | null; attrs: Record<string, unknown> };
export type Tool = { tool: string; calls: number; errors: number; p50: number; p95: number; p99?: number; last_called: string; trend: number[] };
export type Caller = { id: string; kind: string; label: string; calls: number; errors: number; sessions: number; clients: string[]; first_seen: string; last_seen: string };
export type Session = { session_id: string; client_name: string; caller_label: string; started_at: string; ended_at: string | null; calls: number; errors: number; transport: string };
export type Point = { ts: string; requests: number; errors: number; sessions: number; callers: number; latency_p50: number; latency_p95: number; latency_p99?: number };
export type Overview = { requests: number; tool_calls: number; errors: number; error_rate: number; sessions: number; unique_callers: number; p50: number; p95: number; p99?: number; top_tools?: Tool[]; deltas: Record<string, number | null>; clients: { name: string; count: number }[]; updated_at: string };
export type Key = { id: string; key_id: string; label: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null };
export type User = { id: string; email: string; role: 'owner' | 'viewer' };
export type Page<T> = { items: T[]; next_cursor: string | null };
export type EventFilter = { type?: string; tool?: string; q?: string; cursor?: string; caller?: string; since?: string; is_error?: boolean };

export interface SignalsClient {
  ingestUrl: string;
  toolTimeseries(project: string, tool: string, range: Range, signal?: AbortSignal): Promise<Point[]>;
  callerTimeseries(project: string, caller: string, range: Range, signal?: AbortSignal): Promise<Point[]>;
  overview(project: string, range: Range, signal?: AbortSignal): Promise<Overview>;
  timeseries(project: string, range: Range, signal?: AbortSignal): Promise<Point[]>;
  tools(project: string, range: Range, signal?: AbortSignal): Promise<Tool[]>;
  callers(project: string, range: Range, signal?: AbortSignal): Promise<Caller[]>;
  sessions(project: string, cursor?: string, signal?: AbortSignal): Promise<Page<Session>>;
  sessionEvents(project: string, session: string, signal?: AbortSignal, cursor?: string): Promise<Page<SignalEvent>>;
  events(project: string, filter: EventFilter, signal?: AbortSignal): Promise<Page<SignalEvent>>;
  subscribe(project: string, onEvent: (event: SignalEvent) => void, onStatus: (status: 'connected' | 'reconnecting') => void): () => void;
  keys(project: string, signal?: AbortSignal): Promise<Key[]>;
  createKey(project: string, label: string, scopes: string[]): Promise<{ key: Key; secret: string }>;
  revokeKey(project: string, key: string): Promise<void>;
  updateProject(project: string, settings: Pick<Project, 'name' | 'retention_days' | 'rate_events_per_min' | 'rate_bytes_per_min'>): Promise<Project>;
  users(project: string, signal?: AbortSignal): Promise<User[]>;
  createUser(project: string, email: string, password: string, role: 'owner' | 'viewer'): Promise<User>;
}
