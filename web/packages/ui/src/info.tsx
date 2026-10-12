'use client';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons/index.js';
import { explain } from './copy/explanations.js';

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

/** Resolves the `info` prop of a card or tile: an id into the copy file, or a node. */
export function infoContent(info: InfoSource): ReactNode | null {
 if (info == null || info === false) return null;
 // A dotted string is a key into the copy file: an unknown one renders nothing, so the
 // QA assertion that every card and tile carries an explanation catches the typo rather
 // than a reader reading the key. Any other string is literal copy.
 if (typeof info === 'string') { const copy = explain(info); return copy ? prose(copy) : info.includes('.') ? null : prose(info); }
 return info;
}

/**
 * The small info button that sits at the right of a card title or tile label, and the
 * anchored popover it opens. The popover is positioned in viewport coordinates and
 * clamped to the viewport, so it cannot clip at 1440 or at 390, and it never widens
 * the page. On a phone the panel is as wide as the viewport allows, which reads as a
 * sheet under the title.
 */
export function InfoPopover({ titleId, label, size = 16, children }: { titleId: string; label: string; size?: number; children: ReactNode }) {
 const [open, setOpen] = useState(false);
 const button = useRef<HTMLButtonElement>(null);
 const panel = useRef<HTMLDivElement>(null);
 const panelId = useId();
 const close = useCallback((refocus: boolean) => { setOpen(false); if (refocus) button.current?.focus(); }, []);

 useEffect(() => {
  if (!open) return;
  const token = { close: () => setOpen(false) };
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
   el.style.top = `${Math.round(below + h + edge <= innerHeight || above < edge ? Math.max(edge, Math.min(below, innerHeight - h - edge)) : above)}px`;
  };
  place();
  el.focus();
  const outside = (target: EventTarget | null) => !(target instanceof Node) || !(el.contains(target) || trigger.contains(target));
  const pointer = (event: PointerEvent) => { if (outside(event.target)) close(false); };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(true); } };
  const away = (event: FocusEvent) => { if (outside(event.relatedTarget)) close(false); };
  document.addEventListener('pointerdown', pointer, true);
  document.addEventListener('keydown', key, true);
  el.addEventListener('focusout', away);
  globalThis.addEventListener('resize', place);
  globalThis.addEventListener('scroll', place, true);
  return () => {
   if (openPanel === token) openPanel = null;
   document.removeEventListener('pointerdown', pointer, true);
   document.removeEventListener('keydown', key, true);
   el.removeEventListener('focusout', away);
   globalThis.removeEventListener('resize', place);
   globalThis.removeEventListener('scroll', place, true);
  };
 }, [open, close]);

 return <><button ref={button} type="button" className="info-button" aria-label={`About ${label}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => open ? close(true) : setOpen(true)}><Icon name="info" size={size} target="button"/></button>
  {open && <div ref={panel} popover="manual" id={panelId} className="info-pop" role="dialog" aria-labelledby={titleId} tabIndex={-1}>{children}</div>}</>;
}

/** Renders the button only when there is copy for this card or tile. */
export function InfoFor({ info, titleId, label, size }: { info?: InfoSource; titleId: string; label: string; size?: number }) {
 const content = info == null ? null : infoContent(info);
 return content ? <InfoPopover titleId={titleId} label={label} size={size}>{content}</InfoPopover> : null;
}
