'use client';
import { useId, useState } from 'react';
import type { Point } from './types.js';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export function Sparkline({ values, error = false }: { values: number[]; error?: boolean }) {
  const max = Math.max(...values, 1);
  const points = values.map((v, i) => `${i * 80 / Math.max(values.length - 1, 1)},${24 - v / max * 20}`).join(' ');
  return <svg viewBox="0 0 80 28" className={`sparkline ${error ? 'error' : ''}`} aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function ActivityChart({ points, latency = false }: { points: Point[]; latency?: boolean }) {
  const id = useId().replaceAll(':', '');
  const [active, setActive] = useState<number | null>(null);
  const width = 800, height = 230, top = 15, bottom = 34, left = 52, right = 12;
  const key = latency ? 'latency_p95' : 'requests';
  const max = Math.max(...points.map(p => p[key]), 1) * 1.12;
  const x = (i: number) => left + i / Math.max(points.length - 1, 1) * (width - left - right);
  const y = (v: number) => top + (1 - v / max) * (height - top - bottom);
  const line = (metric: 'requests' | 'errors' | 'latency_p50' | 'latency_p95') => points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[metric])}`).join(' ');
  const area = points.length ? `${line(key)} L${x(points.length - 1)},${height - bottom} L${left},${height - bottom} Z` : '';
  const time = (ts: string) => new Date(ts).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  const chosen = active === null ? null : points[active];
  return <div className="chart-wrap">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={latency ? '50th and 95th percentile latency over time in milliseconds' : 'Requests and errors over time'}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity=".22" /><stop offset="100%" stopColor="var(--primary)" stopOpacity="0" /></linearGradient></defs>
      {[0, .25, .5, .75, 1].map(f => <g key={f}><line x1={left} x2={width - right} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" strokeDasharray="3 5" /><text x={left - 12} y={y(max * f) + 4} textAnchor="end" className="chart-label">{compact.format(max * f)}{latency ? 'ms' : ''}</text></g>)}
      <path d={area} fill={`url(#${id})`} />
      <path d={line(key)} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" />
      <path d={line(latency ? 'latency_p50' : 'errors')} fill="none" stroke={latency ? 'var(--chart-3)' : 'var(--destructive)'} strokeWidth="2" strokeLinejoin="round" />
      {[0, .25, .5, .75, 1].map(f => { const i = Math.round(f * (points.length - 1)); return points[i] && <text key={f} x={x(i)} y={height - 6} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} className="chart-label">{new Date(points[i].ts).toLocaleString('en', { timeZone: 'UTC', ...(points.length > 30 ? { month: 'short', day: 'numeric' } : { hour: '2-digit', minute: '2-digit', hour12: false }) })}</text>; })}
      {chosen && active !== null && <><line x1={x(active)} x2={x(active)} y1={top} y2={height - bottom} stroke="var(--muted-foreground)" strokeDasharray="4 4" /><circle cx={x(active)} cy={y(chosen[key])} r="4" fill="var(--primary)" /></>}
      {points.map((p, i) => <rect key={p.ts} x={x(i) - 400 / Math.max(points.length, 1)} y={0} width={800 / Math.max(points.length, 1)} height={height - bottom} fill="transparent" onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} />)}
    </svg>
    <div className="chart-readout" aria-live="polite">{chosen ? <><span>{time(chosen.ts)} UTC</span><strong>{compact.format(chosen[key])} {latency ? 'ms p95' : 'requests'}</strong><span>{latency ? `${Math.round(chosen.latency_p50)} ms p50` : `${chosen.errors} errors`}</span></> : <span>Hover to inspect a point · all times UTC</span>}</div>
  </div>;
}
