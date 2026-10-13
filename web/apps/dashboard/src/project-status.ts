// Observe existing reads; status never causes a request of its own.
export type ProjectStatus = 'healthy' | 'warn' | 'error' | 'dead';
type Snapshot = { failed: boolean; active?: boolean; range?: string };
const snapshots = new Map<string, Snapshot>();
const listeners = new Set<() => void>();
export const watchProjectStatus = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function projectStatus(id: string, demo: boolean, range = '7d'): ProjectStatus {
 const value = snapshots.get(id);
 return demo ? 'dead' : value?.failed ? 'error' : value?.active && value.range === range ? 'healthy' : 'warn';
}
export const statusLabel: Record<ProjectStatus, string> = { healthy: 'Connected · receiving events in this window', warn: 'Connected · no events observed in this window', error: 'Unreachable or authentication failing', dead: 'Demo workspace' };
export function recordProjectRead(path: string, failed: boolean, data?: unknown) {
 const match = path.match(/^\/projects\/([^/?]+)/); if (!match) return;
 const id = decodeURIComponent(match[1]), previous = snapshots.get(id);
 const next = { ...previous, failed };
 if (!failed && /\/analytics\/overview\?/.test(path)) {
  const overview = data as { tiles?: { tool_calls?: { value?: number }; active_users?: { value?: number }; sessions?: { value?: number } } };
  // Active identities count any event, including projects with no tool calls yet.
  next.range = new URLSearchParams(path.split('?')[1]).get('range') ?? '7d';
  next.active = (overview.tiles?.active_users?.value ?? overview.tiles?.tool_calls?.value ?? 0) > 0;
 }
 if (previous?.failed === next.failed && previous?.active === next.active && previous?.range === next.range) return;
 snapshots.set(id, next); for (const listener of listeners) listener();
}
