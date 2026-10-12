'use client';
import { createElement, useEffect, useRef, type CSSProperties, type ReactElement } from 'react';

// Animated icons are Lordicon "Wired Outline" Lottie files (licensed under the
// project's Lordicon PRO subscription) rendered by the <lord-icon> element.
// Ink follows the text colour through `--lord-icon-primary: currentColor` in the
// stylesheets: this element version keys its currentColor rules off a `current-color`
// *attribute*, which would also repaint the gold secondary, so the custom property
// (which the element's shadow palette rules read) is what carries the ink.
// The element and each icon's data load lazily, and icon data is handed to the
// element a few at a time per animation frame so a screen full of pills never
// costs one long main-thread task.

export type IconName =
 | 'overview' | 'adoption' | 'tools' | 'reliability' | 'sessions' | 'cost' | 'protocol' | 'live' | 'setup' | 'settings'
 | 'search' | 'copied' | 'pause' | 'play' | 'sun' | 'moon' | 'logout' | 'chevron' | 'key' | 'plus' | 'trash'
 | 'waiting' | 'healthy' | 'error' | 'dead' | 'streaming' | 'warn' | 'info';

type IconModule = { default: object };
const loaders: Record<IconName, () => Promise<IconModule>> = {
 overview: () => import('./lordicon/overview.json'),
 adoption: () => import('./lordicon/adoption.json'),
 tools: () => import('./lordicon/tools.json'),
 reliability: () => import('./lordicon/reliability.json'),
 sessions: () => import('./lordicon/sessions.json'),
 cost: () => import('./lordicon/cost.json'),
 protocol: () => import('./lordicon/protocol.json'),
 live: () => import('./lordicon/live.json'),
 setup: () => import('./lordicon/file-plus.json'),
 settings: () => import('./lordicon/settings.json'),
 search: () => import('./lordicon/search.json'),
 copied: () => import('./lordicon/copied.json'),
 pause: () => import('./lordicon/pause.json'),
 play: () => import('./lordicon/play.json'),
 sun: () => import('./lordicon/sun.json'),
 moon: () => import('./lordicon/moon.json'),
 logout: () => import('./lordicon/logout.json'),
 chevron: () => import('./lordicon/chevron.json'),
 key: () => import('./lordicon/key.json'),
 plus: () => import('./lordicon/plus.json'),
 trash: () => import('./lordicon/trash.json'),
 waiting: () => import('./lordicon/waiting.json'),
 healthy: () => import('./lordicon/healthy.json'),
 error: () => import('./lordicon/error.json'),
 dead: () => import('./lordicon/dead.json'),
 streaming: () => import('./lordicon/streaming.json'),
 warn: () => import('./lordicon/warn.json'),
 info: () => import('./lordicon/info.json'),
};
const cache = new Map<IconName, Promise<object>>();
function load(name: IconName): Promise<object> {
 let p = cache.get(name);
 if (!p) { p = loaders[name]().then(m => m.default); cache.set(name, p); }
 return p;
}
let element: Promise<void> | null = null;
function ensureElement(): Promise<void> {
 if (!element) element = import('@lordicon/element').then(m => { if (!customElements.get('lord-icon')) m.defineElement(); });
 return element;
}

// Hand icon data to elements at most `perFrame` per animation frame.
type Job = { el: HTMLElement & { icon?: object; stop?: () => void }; data: object };
const queue: Job[] = []; let scheduled = 0;
function flush() {
 scheduled = 0;
 for (let i = 0; i < 6 && queue.length; i++) {
  const job = queue.shift()!; if (!job.el.isConnected) continue;
  if (visualQa()) job.el.addEventListener('ready', () => job.el.stop?.(), { once: true }); // captures rest on the first frame
  job.el.icon = job.data;
 }
 if (queue.length) scheduled = requestAnimationFrame(flush);
}
function enqueue(job: Job) { queue.push(job); if (!scheduled) scheduled = requestAnimationFrame(flush); }

function visualQa(): boolean { return typeof window !== 'undefined' && !!(window as Window & { __SIGNALS_VISUAL_QA__?: boolean }).__SIGNALS_VISUAL_QA__; }
function motionOff(): boolean {
 if (typeof window === 'undefined') return true;
 return visualQa() || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

export type IconTrigger = 'hover' | 'click' | 'loop' | 'loop-on-hover' | 'in' | 'morph' | 'boomerang';
export type IconProps = {
 name: IconName; size?: number; trigger?: IconTrigger | null; target?: string; state?: string; stroke?: 'light' | 'regular' | 'bold';
 label?: string; className?: string; style?: CSSProperties;
};
export function Icon({ name, size = 18, trigger = 'hover', target, state, stroke = 'light', label, className, style }: IconProps): ReactElement {
 const ref = useRef<HTMLElement & { icon?: object }>(null);
 useEffect(() => {
  let alive = true;
  Promise.all([ensureElement(), load(name)]).then(([, data]) => { if (alive && ref.current) enqueue({ el: ref.current, data }); }).catch(() => undefined);
  return () => { alive = false; };
 }, [name]);
 const play = trigger && !motionOff() ? trigger : undefined;
 // Visual QA captures must land on the first frame; the element's reduced-motion handling
 // would otherwise seek one-shot animations to their last frame at an unpredictable moment.
 return createElement('lord-icon', {
  ref, class: `li${className ? ' ' + className : ''}`, trigger: play, target: play ? target : undefined, state, stroke, motion: visualQa() ? 'always' : undefined,
  style: { width: size, height: size, ...style }, role: label ? 'img' : undefined, 'aria-label': label, 'aria-hidden': label ? undefined : 'true',
 });
}

// Static glyphs for the few controls that need no motion. Same stroke rules as the set.
const glyphs = {
 cross: 'M6 6l12 12M18 6 6 18',
 menu: 'M4 7h16M4 12h16M4 17h16',
 'arrow-right': 'M5 12h14M13 6l6 6-6 6',
 'arrow-up': 'M12 19V5M6 11l6-6 6 6',
 'arrow-down': 'M12 5v14M6 13l6 6 6-6',
 copy: 'M9 9h11v11H9zM5 15V5h10',
 terminal: 'M4 17l6-5-6-5M12 19h8',
 user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c0-3.3 3.6-5 8-5s8 1.7 8 5',
} as const;
export type GlyphName = keyof typeof glyphs;
export function Glyph({ name, size = 16, label }: { name: GlyphName; size?: number; label?: string }): ReactElement {
 return <svg className="glyph" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}><path d={glyphs[name]} /></svg>;
}

// Status pills: one state word in, one icon out.
export function pillIcon(state: string): IconName | null {
 switch (state) {
  case 'ok': case 'good': case 'ended': case 'healthy': return 'healthy';
  case 'error': case 'bad': case 'failed': return 'error';
  case 'warn': case 'warning': return 'warn';
  case 'dead': return 'dead';
  case 'active': case 'streaming': case 'live': return 'streaming';
  default: return null;
 }
}
