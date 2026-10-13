'use client';
// The screen's entrance, in one place.
//
// Until v5 a card's entrance and a chart's SVG were both keyed to an
// IntersectionObserver, so everything below the fold sat unbuilt and unanimated until
// the reader scrolled it into view -- and then ran its entrance under the pointer,
// mid-read. The whole screen now runs one choreography from the top, once per
// navigation: tiles at 130 + i·55 ms, cards at 300 + i·85 ms capped at 1.1 s, and each
// chart's draw-in anchored to the card or tile it belongs to rather than to the mount,
// so a chart never draws before the card carrying it is on its way in.
//
// Nothing here runs on scroll, on resize or on a poll refresh: `enter` is called once
// from a mount effect, and a chart redrawn at a new width or with new numbers lands
// finished (`nt`) the way v4 established.

/** The entrance itself: 520 ms, rising 14 px, with the owner's stagger as its delay. */
const DURATION_MS = 520;
/** Tiles lead the page: the first at 130 ms, then one every 55 ms. */
export const tileDelay = (index: number) => 130 + Math.max(0, index) * 55;
/** Cards follow: the first at 300 ms, then one every 85 ms, and none later than 1.1 s. */
export const cardDelay = (index: number) => Math.min(1100, 300 + Math.max(0, index) * 85);
/**
 * How far a chart's draw-in trails the entrance of the card or tile it sits in: about a
 * third of the 520 ms rise, which is long enough that the card is plainly leading and
 * short enough that the last card's chart still starts inside 1.3 s.
 */
export const CHART_AFTER_OWNER_MS = 180;

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// When each owner's entrance starts, in `performance.now()` time. A chart asks its
// nearest entered ancestor rather than being told its index, so the same component
// works in a screen's grid, in a tile row and inside a drawer.
const enteredAt = new WeakMap<Element, number>();

/**
 * Runs an owner's entrance, records when it starts, and publishes `--draw-in`: how long
 * after the mount anything inside it may begin drawing. Two clocks, because a chart's
 * entrance comes in two forms. The parts a renderer builds -- a plot, a stroke, a bar --
 * are marked `on` when the SVG is built, which is some frames after the mount, and they
 * take `--cd`, what is *left* of this delay at that moment (see `drawInDelay`). The
 * parts that are in the markup from the first render -- a tile's sparkline wrapper, the
 * stacked area's and the donut's own box -- start their animation at the mount, and they
 * take `--draw-in` straight. Both land on the same instant.
 */
export function enter(el: HTMLElement, delay = 0): Animation | undefined {
 enteredAt.set(el, performance.now() + delay);
 el.style.setProperty('--draw-in', `${delay + CHART_AFTER_OWNER_MS}ms`);
 if (reduced()) return;
 return el.animate(
  [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0px)' }],
  { duration: DURATION_MS, delay, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' },
 );
}

/** Milliseconds from now until the chart inside `el` should begin drawing in. */
export function drawInDelay(el: Element): number {
 for (let node: Element | null = el; node; node = node.parentElement) {
  const at = enteredAt.get(node);
  if (at != null) return Math.max(0, at + CHART_AFTER_OWNER_MS - performance.now());
 }
 return 0;
}

// Building a screen's chart SVGs is the one part of the entrance that costs real
// main-thread time, and painting every chart at mount puts all of it in the mount's
// own task. The queue spends it one card per animation frame instead, in document
// order, which keeps any single task short while the visual order is exactly the
// document's. A chart's own entrance delay is what hides the staggered build: the card
// is still invisible when its chart is constructed.
type Job = { el: Element; run: () => void };
let queue: Job[] = [];
let frame = 0;
const owner = (el: Element) => el.closest('.card, .tiles, .panel') ?? el;
const documentOrder = (a: Job, b: Job) =>
 a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;

function flush() {
 frame = 0;
 if (!queue.length) return;
 queue.sort(documentOrder);
 const group = owner(queue[0].el);
 const batch: Job[] = [];
 while (queue.length && owner(queue[0].el) === group) batch.push(queue.shift()!);
 if (queue.length) frame = requestAnimationFrame(flush);
 for (const job of batch) job.run();
}

/** Queues one chart's SVG construction. Returns a canceller for the unmount path. */
export function queuePaint(el: Element, run: () => void): () => void {
 const job: Job = { el, run };
 queue.push(job);
 if (!frame) frame = requestAnimationFrame(flush);
 return () => {
  queue = queue.filter(other => other !== job);
  if (!queue.length && frame) { cancelAnimationFrame(frame); frame = 0; }
 };
}
