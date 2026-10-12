'use client';
// One place the shell can watch what the screens are doing. The workspace strip reads
// it for "updated 12 s ago" and the collector-dot pulse; the dashboard reads it to dim
// the previous screen while a range or project change is in flight. Deliberately a
// module store and not React context: the shell that renders the strip lives outside
// the dashboard's tree, and neither reader may cost a re-render of the screen.

/** How long between polls of the active screen's analytics routes. */
export const POLL_INTERVAL_MS = 60_000;
/** A skeleton that appears for 80 ms reads as a glitch, so wait, then hold. */
export const SKELETON_DELAY_MS = 200, SKELETON_MIN_MS = 400, CONTENT_FADE_MS = 240;

/** `first` has nothing to show yet, `change` replaces a range or project, `refresh` is a poll. */
export type LoadKind = 'first' | 'change' | 'refresh';
export type ActivityState = {
 /** Requests in flight, of any kind. */
 pending: number;
 /** Requests in flight that replace content already on screen; these dim it. */
 changing: number;
 /** When data last landed, or null before the first success. */
 updatedAt: number | null;
 /** Successful loads so far, so a reader can tell "new data" from "same data". */
 loads: number;
};

let state: ActivityState = { pending: 0, changing: 0, updatedAt: null, loads: 0 };
const listeners = new Set<(state: ActivityState) => void>();

export function activityState(): ActivityState { return state; }
export function onActivity(listener: (state: ActivityState) => void): () => void {
 listeners.add(listener);
 return () => { listeners.delete(listener); };
}
function emit(next: ActivityState) {
 state = next;
 // Mirrored onto the window so the live checks can watch refreshes land without
 // reaching into React, and so a developer can read it from the console.
 if (typeof window !== 'undefined') (window as Window & { __SIGNALS_ACTIVITY__?: ActivityState }).__SIGNALS_ACTIVITY__ = state;
 for (const listener of [...listeners]) listener(state);
}

export function beginLoad(kind: LoadKind) {
 emit({ ...state, pending: state.pending + 1, changing: state.changing + (kind === 'change' ? 1 : 0) });
}
export function endLoad(kind: LoadKind, ok: boolean) {
 emit({
  pending: Math.max(0, state.pending - 1),
  changing: Math.max(0, state.changing - (kind === 'change' ? 1 : 0)),
  updatedAt: ok ? Date.now() : state.updatedAt,
  loads: ok ? state.loads + 1 : state.loads,
 });
}

/** Visual and performance QA freeze polling and motion so captures stay deterministic. */
export function visualQa(): boolean {
 return typeof window !== 'undefined' && !!(window as Window & { __SIGNALS_VISUAL_QA__?: boolean }).__SIGNALS_VISUAL_QA__;
}

/** "updated 12 s ago" — seconds, then minutes, then hours. */
export function sinceText(at: number, now = Date.now()): string {
 const seconds = Math.max(0, Math.round((now - at) / 1000));
 if (seconds < 60) return `${seconds} s`;
 const minutes = Math.round(seconds / 60);
 return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}
