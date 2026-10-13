'use client';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons/index.js';
import { explain, type ExplainContext } from './copy/explanations.js';

// One info popover is open at a time across the page; opening another closes it. The
// registration is held by identity, so a popover closing later cannot clear the one that
// replaced it.
let openPanel: { close: () => void } | null = null;

// The copy in src/copy/explanations.ts marks field and event names with backticks so it
// reads as prose in one file; render those spans as code rather than printing the ticks.
function prose(text: string): ReactNode[] {
 return text.split(/`([^`]+)`/).map((part, i) => i % 2 ? <code key={i}>{part}</code> : part);
}

export type InfoSource = string | ReactNode;

// An explanation that quotes a saved setting has to read the same number as the tile it
// explains. The screens that know those settings — they come back on the same answer as
// the numbers — put them here, and the popovers below read them. A host that renders a
// card outside any scope gets the collector's defaults, which is what the copy says.
const ExplainScope = createContext<ExplainContext>({});

/** Provides the project facts the copy may quote to every popover inside it. */
export function ExplainFor({ context, children }: { context: ExplainContext; children: ReactNode }) {
 return <ExplainScope.Provider value={context}>{children}</ExplainScope.Provider>;
}

/** Resolves the `info` prop of a card or tile: an id into the copy file, or a node. */
export function infoContent(info: InfoSource, context: ExplainContext = {}, label?: string, unit?: string): ReactNode | null {
 if (info == null || info === false) return null;
 // A dotted string is a key into the copy file: an unknown one renders nothing, so the
 // QA assertion that every card and tile carries an explanation catches the typo rather
 // than a reader reading the key. Any other string is literal copy.
 if (typeof info === 'string') { const copy = explain(info, context); return copy ? <><div className="info-pop__title">{label??copy.title}{unit&&<span className="info-pop__unit">{unit}</span>}</div><p>{prose(copy.body)}</p><section className="info-pop__computed"><strong>How it’s computed</strong><p>{prose(copy.computed)}</p></section>{copy.action&&<p className="info-pop__action"><strong>What to do</strong><br/>{prose(copy.action)}</p>}</> : info.includes('.') ? null : prose(info); }
 return info;
}

/**
 * The small info button that sits at the right of a card title or tile label, and the
 * anchored popover it opens. The popover is positioned in viewport coordinates and
 * clamped to the viewport, so it cannot clip at 1440 or at 390, and it never widens
 * the page. On a phone the panel is as wide as the viewport allows, which reads as a
 * sheet under the title.
 */
export function InfoPopover({ titleId, label, size = 24, children }: { titleId: string; label: string; size?: number; children: ReactNode }) {
 const [open, setOpen] = useState(false);
 const sticky = useRef(false), suppressFocus = useRef(false), pointerFocus = useRef(false);
 const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
 const cancelHover = () => clearTimeout(hoverTimer.current);
 const hover = () => { cancelHover(); hoverTimer.current = setTimeout(() => setOpen(true), 120); };
 const leave = () => { cancelHover(); if (!sticky.current) hoverTimer.current = setTimeout(() => setOpen(false), 120); };
 useEffect(() => () => clearTimeout(hoverTimer.current), []);
 const button = useRef<HTMLButtonElement>(null);
 const panel = useRef<HTMLDivElement>(null);
 const panelId = useId();
 const close = useCallback((refocus: boolean) => { clearTimeout(hoverTimer.current); sticky.current = false; setOpen(false); if (refocus) { suppressFocus.current = true; button.current?.focus(); suppressFocus.current = false; } }, []);

 useEffect(() => {
  if (!open) return;
  const token = { close: () => close(false) };
  openPanel?.close();
  openPanel = token;
  const el = panel.current!, trigger = button.current!;
  // The top layer, so a tile's transform or `contain` cannot become the containing
  // block for a fixed panel, and so a popover opened inside a modal drawer still
  // paints above it.
  try { el.showPopover?.(); } catch { /* already in the top layer */ }
  const place = () => {
   const r = trigger.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, gap = 8, edge = 8;
   el.style.left = `${Math.round(Math.max(edge, Math.min(innerWidth - w - edge, r.left + r.width / 2 - w / 2)))}px`;
   const below = r.bottom + gap, above = r.top - gap - h;
   el.dataset.side = below + h + edge <= innerHeight ? 'below' : 'above';
   if (innerWidth <= 560) { el.style.left = '8px'; el.style.top = `${innerHeight-h-8}px`; return; }
   el.style.setProperty('--arrow-x', `${Math.max(18, Math.min(w-18, r.left+r.width/2-parseFloat(el.style.left)))}px`);
   el.style.top = `${Math.round(below + h + edge <= innerHeight || above < edge ? Math.max(edge, Math.min(below, innerHeight - h - edge)) : above)}px`;
  };
  place();
  if (sticky.current) el.focus();
  const outside = (target: EventTarget | null) => !(target instanceof Node) || !(el.contains(target) || trigger.contains(target));
  const pointer = (event: PointerEvent) => { if (outside(event.target)) close(false); };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(true); } };

  document.addEventListener('pointerdown', pointer, true);
  document.addEventListener('keydown', key, true);

  globalThis.addEventListener('resize', place);
  globalThis.addEventListener('scroll', place, true);
  return () => {
   if (openPanel === token) openPanel = null;
   document.removeEventListener('pointerdown', pointer, true);
   document.removeEventListener('keydown', key, true);

   globalThis.removeEventListener('resize', place);
   globalThis.removeEventListener('scroll', place, true);
  };
 }, [open, close]);

 return <><button ref={button} type="button" className="info-button" aria-label={`About ${label}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onMouseEnter={hover} onMouseLeave={leave} onPointerDown={() => { pointerFocus.current = true; }} onPointerUp={() => { pointerFocus.current = false; }} onPointerCancel={() => { pointerFocus.current = false; }} onBlur={() => { pointerFocus.current = false; }} onFocus={() => { if (!suppressFocus.current && !pointerFocus.current) { sticky.current = true; setOpen(true); } }} onClick={() => { cancelHover(); pointerFocus.current = false; if (open && sticky.current) close(true); else { sticky.current = true; setOpen(true); panel.current?.focus(); } }}><Icon name="info" size={size} target="button"/></button>
  {open && <div ref={panel} popover="manual" id={panelId} className="info-pop" role="dialog" aria-labelledby={titleId} onMouseEnter={cancelHover} onMouseLeave={leave} tabIndex={-1}>{children}</div>}</>;
}

/** Renders the button only when there is copy for this card or tile. */
export function InfoFor({ info, titleId, label, size, unit }: { info?: InfoSource; titleId: string; label: string; size?: number; unit?: string }) {
 const context = useContext(ExplainScope);
 const content = info == null ? null : infoContent(info, context, label, unit);
 return content ? <InfoPopover titleId={titleId} label={label} size={size}>{content}</InfoPopover> : null;
}
