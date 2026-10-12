// SVG geometry adapted from the approved dashboard v3 mock. All inputs come from the client.
const nf = new Intl.NumberFormat('en-US');
const f = {
  int: (n) => nf.format(Math.round(n)),
  compact: (n) => n == null ? '—'
    : Math.abs(n) >= 1e9 ? (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B'
    : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.0+$/, '') + 'M'
    : Math.abs(n) >= 1e4 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
    : nf.format(Math.round(n)),
  pct: (n, d = 1) => n == null ? '—' : n.toFixed(d) + '%',
  ms: (n) => n == null ? '—' : n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 2).replace(/0$/, '') + ' s' : n + ' ms',
  day: (iso) => iso.slice(5,10).replace('-', '/'),
  delta: (a, b) => b ? Math.round((a / b - 1) * 1000) / 10 : null,
  bytes: (n) => n == null ? '—' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B',
};
const px = (n) => Math.round(n * 100) / 100;
const clip = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const scale = (d0, d1, r0, r1) => (v) => d1 === d0 ? r0 : r0 + (v - d0) / (d1 - d0) * (r1 - r0);
let uid = 0;
const nextId = () => 'g' + (++uid);

/* Catmull-Rom-ish cubic, control points clamped inside each segment's own
 * y-range so a smoothed stack never dips below the series under it. */
function curve(pts) {
  if (pts.length < 2) return pts.length ? `M${px(pts[0][0])},${px(pts[0][1])}` : '';
  let d = `M${px(pts[0][0])},${px(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, t = 0.2;
    const lo = Math.min(p1[1], p2[1]), hi = Math.max(p1[1], p2[1]);
    const c1y = Math.min(hi, Math.max(lo, p1[1] + (p2[1] - p0[1]) * t));
    const c2y = Math.min(hi, Math.max(lo, p2[1] - (p3[1] - p1[1]) * t));
    const dx = (p2[0] - p1[0]) * 0.34;
    d += `C${px(p1[0] + dx)},${px(c1y)} ${px(p2[0] - dx)},${px(c2y)} ${px(p2[0])},${px(p2[1])}`;
  }
  return d;
}
function arcPath(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${px(x0)},${px(y0)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${px(x1)},${px(y1)}`;
}
/* how often an x label fits without colliding, given the plot width */
const axisDate = (labels, iso) => {
  if (!iso.includes('T') || labels.length < 2) return f.day(iso);
  const gap = Date.parse(labels[1]) - Date.parse(labels[0]);
  return gap < 60000 ? iso.slice(11,19) : gap < 86400000 ? iso.slice(11,16) : gap >= 604800000 ? `Week of ${iso.slice(5,10)}` : f.day(iso);
};
const labelEvery = (n, iw, minPx = 48) => Math.max(1, Math.ceil(minPx / Math.max(1, iw / Math.max(1, n - 1))));

function niceTicks(max, n = 4) {
  if (max <= 0) return [0];
  const raw = max / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) * mag;
  const out = []; for (let v = 0; v <= Math.ceil(max / step) * step + step * 0.001; v += step) out.push(v);
  return out;
}

function sparkline({ values, color = 'var(--chart-1)', h = 38, fill = true }) {
  return (w) => {
    const valid=values.filter(v=>v!=null); const pad = 3, lo = Math.min(...valid), hi = Math.max(...valid);
    const x = scale(0, values.length - 1, pad, w - pad);
    const y = scale(lo - (hi - lo) * 0.35 || 0, hi + (hi - lo) * 0.12 || 1, h - pad, pad + 4);
    const pts = values.map((v, i) => v==null?null:[x(i), y(v)]);
    const id = nextId();
    const groups=[];for(const p of pts){if(p){if(!groups.length)groups.push([]);groups.at(-1).push(p);}else if(groups.at(-1)?.length)groups.push([]);}const line = groups.filter(g=>g.length).map(curve).join(' ');
    const area = `${line}L${px(x(values.length - 1))},${h}L${px(x(0))},${h}Z`;
    const last = pts.filter(Boolean).at(-1);
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity=".40"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <g class="plot">
      ${fill && valid.length===values.length ? `<path d="${area}" fill="url(#${id})"/>` : ''}
      <path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${px(last[0])}" cy="${px(last[1])}" r="2.6" fill="${color}"/>
      </g></svg>`;
  };
}

/* -------------------------------------------- stacked area + crosshair ---- */
function stackedArea({ labels, series, h = 260, yfmt = f.compact, unit = '' }) {
  return (w) => {
    const pad = { t: 12, r: 14, b: 26, l: 44 };
    const iw = Math.max(40, w - pad.l - pad.r), ih = h - pad.t - pad.b;
    const n = labels.length;
    const totals = labels.map((_, i) => series.reduce((s, sr) => s + sr.values[i], 0));
    const ticks = niceTicks(Math.max(...totals), 4);
    const ymax = ticks[ticks.length - 1] || 1;
    const x = n === 1 ? () => pad.l + iw / 2 : scale(0, n - 1, pad.l, pad.l + iw), y = scale(0, ymax, pad.t + ih, pad.t);
    let acc = labels.map(() => 0);
    const layers = series.map((sr) => {
      const top = sr.values.map((v, i) => { acc[i] += v; return [x(i), y(acc[i])]; });
      const bot = sr.values.map((v, i) => [x(i), y(acc[i] - v)]).reverse();
      return { ...sr, top: top.slice(), area: `${curve(top)}L${curve(bot).slice(1).replace(/^M/, '')}Z`, line: curve(top) };
    });
    const id = nextId();
    const defs = layers.map((l, i) => `<linearGradient id="${id}s${i}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${l.color}" stop-opacity=".82"/>
        <stop offset="100%" stop-color="${l.color}" stop-opacity=".30"/></linearGradient>`).join('');
    const grid = ticks.map((t) => `<line class="gridline" x1="${pad.l}" y1="${px(y(t))}" x2="${px(pad.l + iw)}" y2="${px(y(t))}"/>
        <text class="ax" x="${pad.l - 8}" y="${px(y(t) + 3.5)}" text-anchor="end">${yfmt(t)}</text>`).join('');
    const every = labelEvery(n, iw, labels.length>1&&Date.parse(labels[1])-Date.parse(labels[0])>=604800000?110:48);
    const xlab = labels.map((l, i) => (i % every && i !== n - 1) ? '' :
      `<text class="ax ax--dim" x="${px(x(i))}" y="${h - 7}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(axisDate(labels,l))}</text>`).join('');
    const html = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
      <defs>${defs}</defs>${grid}
      <g class="plot">
        ${layers.map((l, i) => n === 1 ? `<rect x="${x(0)-16}" y="${l.top[0][1]}" width="32" height="${y(0)-y(l.values[0])}" fill="${l.color}"/>` : `<path d="${l.area}" fill="url(#${id}s${i})"/>`).join('')}
        ${layers.map((l) => `<path d="${l.line}" fill="none" stroke="${l.color}" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"/>`).join('')}
      </g>
      <line class="axline" x1="${pad.l}" y1="${px(pad.t + ih)}" x2="${px(pad.l + iw)}" y2="${px(pad.t + ih)}"/>
      ${xlab}
      <g class="xh" style="opacity:0">
        <line y1="${pad.t}" y2="${px(pad.t + ih)}" stroke="var(--viz-ink-strong)" stroke-width="1" stroke-dasharray="3 3"/>
        ${layers.map((l) => `<circle r="4" fill="${l.color}" stroke="var(--card)" stroke-width="1.8"/>`).join('')}
      </g>
      <rect class="hit" x="${pad.l}" y="${pad.t}" width="${px(iw)}" height="${px(ih)}" fill="transparent"/>
    </svg><div class="tip"></div>`;
    const after = (el) => {
      const svg = el.querySelector('svg'), tip = el.querySelector('.tip');
      const xh = el.querySelector('.xh'), line = xh.querySelector('line'), dots = [...xh.querySelectorAll('circle')];
      const move = (ev) => {
        const r = svg.getBoundingClientRect();
        const rel = (ev.clientX - r.left) * (w / r.width);
        const i = Math.max(0, Math.min(n - 1, Math.round((rel - pad.l) / (iw / (n - 1 || 1)))));
        xh.style.opacity = '1'; line.setAttribute('x1', px(x(i))); line.setAttribute('x2', px(x(i)));
        let c = 0;
        layers.forEach((l, k) => { c += l.values[i]; dots[k].setAttribute('cx', px(x(i))); dots[k].setAttribute('cy', px(y(c))); });
        tip.innerHTML = `<div class="tip__t">${esc(axisDate(labels,labels[i]))}</div>` +
          [...layers].reverse().map((l) => `<div class="tip__r"><span><i style="background:${l.color}"></i>${esc(l.name)}</span><b>${f.int(l.values[i])}</b></div>`).join('') +
          `<div class="tip__sum"><span>total${unit}</span><b class="tnum">${f.int(totals[i])}</b></div>`;
        tip.classList.add('on');
        const tw = tip.offsetWidth || 150;
        tip.style.left = Math.max(2, Math.min(w - tw - 2, x(i) * (r.width / w) - tw / 2)) + 'px';
        tip.style.top = '6px';
      };
      svg.addEventListener('pointermove', move);
      const leave = () => { xh.style.opacity = '0'; tip.classList.remove('on'); };
      svg.addEventListener('pointerleave', leave);
      return () => { svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerleave', leave); };
    };
    return { html, after };
  };
}

/* ----------------------------------------------------------- band chart --- */
/* Log y-axis: p50, p95 and p99 are an order of magnitude apart, so a linear
 * scale would flatten the two lines that matter into the baseline. */
function bandChart({ labels, lo, mid, hi, h = 220 }) {
  return (w) => {
    const pad = { t: 14, r: 34, b: 26, l: 46 };
    const iw = Math.max(40, w - pad.l - pad.r), ih = h - pad.t - pad.b, n = labels.length;
    const y0 = Math.max(.1,Math.min(100,...lo.filter(v=>v!=null))), y1 = Math.max(y0*2,...hi.filter(v=>v!=null)) * 1.25;
    const x = scale(0, n - 1, pad.l, pad.l + iw);
    const ly = scale(Math.log(y0), Math.log(y1), pad.t + ih, pad.t);
    const y = (v) => ly(Math.log(Math.max(y0, v)));
    const groups=[];for(let i=0;i<n;i++){if(lo[i]!=null&&mid[i]!=null&&hi[i]!=null){if(!groups.length)groups.push([]);groups.at(-1).push(i);}else if(groups.at(-1)?.length)groups.push([]);}const runs=groups.filter(g=>g.length);
    const P = (a,indices) => indices.map(i=>[x(i),y(a[i])]);
    const line = a=>runs.map(g=>curve(P(a,g))).join(' ');
    const rev = (a) => a.slice().reverse();
    const bandOuter = runs.map(g=>curve(P(hi,g))+'L'+curve(rev(P(mid,g))).slice(1)+'Z').join(' ');
    const bandInner = runs.map(g=>curve(P(mid,g))+'L'+curve(rev(P(lo,g))).slice(1)+'Z').join(' ');
    const id = nextId();
    const ticks = [100, 300, 1000, 3000].filter((t) => t <= y1);
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--chart-2)" stop-opacity=".30"/>
        <stop offset="100%" stop-color="var(--chart-2)" stop-opacity=".06"/></linearGradient>
        <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--chart-1)" stop-opacity=".34"/>
        <stop offset="100%" stop-color="var(--chart-1)" stop-opacity=".10"/></linearGradient></defs>
      ${ticks.map((t) => `<line class="gridline" x1="${pad.l}" y1="${px(y(t))}" x2="${px(pad.l + iw)}" y2="${px(y(t))}"/>
        <text class="ax" x="${pad.l - 8}" y="${px(y(t) + 3.5)}" text-anchor="end">${t >= 1000 ? (t / 1000) + ' s' : t}</text>`).join('')}
      <g class="plot">
        <path d="${bandOuter}" fill="url(#${id})"/>
        ${runs.filter(g=>g.length===1).flatMap(g=>[[lo,'var(--chart-3)'],[mid,'var(--chart-1)'],[hi,'var(--chart-2)']].map(([a,c])=>`<circle cx="${x(g[0])}" cy="${y(a[g[0]])}" r="3" fill="${c}"/>`)).join('')}
        <path d="${bandInner}" fill="url(#${id}b)"/>
        <path d="${line(hi)}" fill="none" stroke="var(--chart-2)" stroke-width="1.6" stroke-dasharray="4 3"/>
        <path d="${line(mid)}" fill="none" stroke="var(--chart-1)" stroke-width="2.4" stroke-linecap="round"/>
        <path d="${line(lo)}" fill="none" stroke="var(--chart-3)" stroke-width="2" stroke-linecap="round"/>
      </g>
      <line class="axline" x1="${pad.l}" y1="${px(pad.t + ih)}" x2="${px(pad.l + iw)}" y2="${px(pad.t + ih)}"/>
      ${labels.map((l, i) => (i % labelEvery(n, iw, labels.length>1&&Date.parse(labels[1])-Date.parse(labels[0])>=604800000?110:48) && i !== n - 1) ? '' : `<text class="ax ax--dim" x="${px(x(i))}" y="${h - 7}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(axisDate(labels,l))}</text>`).join('')}
      <text class="ax" x="${px(pad.l + iw + 5)}" y="${px(y(hi.filter(v=>v!=null).at(-1)) + 3.5)}" style="fill:var(--chart-2)">p99</text>
      <text class="ax" x="${px(pad.l + iw + 5)}" y="${px(y(mid.filter(v=>v!=null).at(-1)) + 3.5)}" style="fill:var(--primary-ink)">p95</text>
      <text class="ax" x="${px(pad.l + iw + 5)}" y="${px(y(lo.filter(v=>v!=null).at(-1)) + 3.5)}" style="fill:var(--chart-3)">p50</text>
      <text class="ax ax--dim" x="${pad.l - 8}" y="${px(pad.t + ih + 13)}" text-anchor="end">ms</text>
    </svg>`;
  };
}

/* ---------------------------------------------------------------- donut --- */
function donut({ items, h = 212, centre, centreSub }) {
  return (w) => {
    const cx = w / 2, cy = h / 2 + 2, R = Math.min(w, h) / 2 - 16, ring = Math.max(16, R * 0.34);
    const total = items.reduce((s, d) => s + d.value, 0) || 1;
    let a = -Math.PI / 2;
    const segs = items.map((d, i) => {
      const sweep = d.value / total * Math.PI * 2, gap = Math.min(0.045, sweep * 0.12);
      const p = arcPath(cx, cy, R - ring / 2, a + gap / 2, a + sweep - gap / 2);
      a += sweep;
      return `<path class="stroke-draw" style="--pd:${i * 70}ms" d="${p}" fill="none" stroke="${d.color}" stroke-width="${px(ring)}" stroke-linecap="butt"/>`;
    }).join('');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
      <circle cx="${px(cx)}" cy="${px(cy)}" r="${px(R - ring / 2)}" fill="none" stroke="var(--viz-track)" stroke-width="${px(ring)}"/>
      ${segs}
      <text x="${px(cx)}" y="${px(cy - 1)}" text-anchor="middle" style="font:700 ${Math.round(Math.min(30, R * 0.52))}px var(--sans);font-variant-numeric:tabular-nums;letter-spacing:-.02em" fill="var(--foreground)">${esc(centre)}</text>
      <text x="${px(cx)}" y="${px(cy + 18)}" text-anchor="middle" class="ax">${esc(centreSub || '')}</text>
    </svg>`;
  };
}

/* --------------------------------------- log-scaled latency histogram ----- */
function latencyHist({ buckets, markers, h = 228 }) {
  return (w) => {
    const pad = { t: 46, r: 12, b: 26, l: 40 };
    const iw = Math.max(40, w - pad.l - pad.r), ih = h - pad.t - pad.b;
    const lx = scale(Math.log(buckets[0].lo), Math.log(buckets[buckets.length - 1].hi), pad.l, pad.l + iw);
    const maxN = Math.max(...buckets.map((b) => b.n));
    const ticks = niceTicks(maxN, 3), ymax = ticks[ticks.length - 1] || 1;
    const y = scale(0, ymax, pad.t + ih, pad.t);
    const bars = buckets.map((b, i) => {
      const x0 = lx(Math.log(b.lo)), x1 = lx(Math.log(b.hi));
      const bh = Math.max(0, pad.t + ih - y(b.n));
      const over = b.lo >= markers.p95;
      return `<rect class="growy" style="--pd:${i * 12}ms;transform-origin:${px(x0)}px ${px(pad.t + ih)}px" x="${px(x0)}" y="${px(y(b.n))}"
        width="${px(Math.max(1, x1 - x0 - 1.2))}" height="${px(bh)}" rx="2"
        fill="${over ? 'var(--chart-2)' : 'var(--chart-1)'}" fill-opacity="${over ? .72 : .9}"/>`;
    }).join('');
    const xt = [10, 30, 100, 300, 1000, 3000, 10000].filter((v) => v >= buckets[0].lo && v <= buckets[buckets.length - 1].hi);
    let lastRight = -1e9;
    const mk = Object.entries(markers).filter(([k,v])=>['p50','p95','p99'].includes(k)&&Number.isFinite(v)).sort((a, b) => a[1] - b[1]).map(([k, v], i) => {
      const X = lx(Math.log(Math.max(buckets[0].lo,v))), label = `${k} ${f.int(v)}`;
      const lw = Math.max(48, label.length * 6.2 + 12);
      const row = X - lw / 2 < lastRight + 4 ? 1 : 0;
      if (!row) lastRight = X + lw / 2;
      const ly = pad.t - 9 - row * 19, lx0 = Math.max(1, Math.min(w - lw - 1, X - lw / 2));
      return `<g class="popin" style="--pd:${320 + i * 90}ms;transform-origin:${px(X)}px ${px(pad.t)}px">
        <line x1="${px(X)}" y1="${px(ly)}" x2="${px(X)}" y2="${px(pad.t + ih)}" stroke="var(--viz-ink-strong)" stroke-width="1.4" stroke-dasharray="3 3"/>
        <rect x="${px(lx0)}" y="${px(ly - 15)}" width="${px(lw)}" height="16" rx="8" fill="var(--surface-2)" stroke="var(--border)"/>
        <text x="${px(lx0 + lw / 2)}" y="${px(ly - 3.5)}" text-anchor="middle" class="ax" style="fill:var(--foreground)">${label}</text></g>`;
    }).join('');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
      ${ticks.map((t) => `<line class="gridline" x1="${pad.l}" y1="${px(y(t))}" x2="${px(pad.l + iw)}" y2="${px(y(t))}"/>
        <text class="ax" x="${pad.l - 7}" y="${px(y(t) + 3.5)}" text-anchor="end">${f.compact(t)}</text>`).join('')}
      ${bars}
      <line class="axline" x1="${pad.l}" y1="${px(pad.t + ih)}" x2="${px(pad.l + iw)}" y2="${px(pad.t + ih)}"/>
      ${xt.map((v) => `<text class="ax ax--dim" x="${px(lx(Math.log(v)))}" y="${h - 7}" text-anchor="middle">${v >= 1000 ? (v / 1000) + 's' : v}</text>`).join('')}
      ${mk}
    </svg>`;
  };
}

/* ---------------------------------------------------------------- funnel -- */
function funnel({ steps, h = 252 }) {
  return (w) => {
    const pad = { t: 8, r: 8, b: 8, l: 8 };
    const iw = Math.max(60, w - pad.l - pad.r);
    const gutter = Math.min(104, iw * 0.34);           // the count + drop-off column
    const rowH = (h - pad.t - pad.b - (steps.length - 1) * 10) / steps.length;
    const max = steps[0].count || 1;
    const bw = (c) => Math.max(26, c / max * (iw - gutter - 8));
    let out = '';
    steps.forEach((s, i) => {
      const yTop = pad.t + i * (rowH + 10), wNow = bw(s.count), mid = yTop + rowH / 2 + 4.5;
      const inside = wNow > s.label.length * 7.1 + 20;
      if (i) {
        const prev = bw(steps[i - 1].count), yPrev = pad.t + (i - 1) * (rowH + 10) + rowH;
        out += `<path class="popin" style="--pd:${260 + i * 80}ms;transform-origin:${px(pad.l + wNow)}px ${px(yPrev)}px"
          d="M${px(pad.l + wNow)},${px(yPrev)} L${px(pad.l + prev)},${px(yPrev)} L${px(pad.l + wNow)},${px(yTop)} Z"
          fill="var(--destructive)" fill-opacity=".20"/>`;
      }
      out += `<rect class="growx" style="--pd:${i * 80}ms;transform-origin:${px(pad.l)}px 0" x="${px(pad.l)}" y="${px(yTop)}"
          width="${px(wNow)}" height="${px(rowH)}" rx="7" fill="url(#fnl)"/>
        <text x="${px(pad.l + (inside ? 12 : wNow + 9))}" y="${px(mid)}" style="font:600 13px var(--sans);fill:${inside ? 'var(--primary-foreground)' : 'var(--muted-foreground)'}">${esc(s.label)}</text>
        <text x="${px(pad.l + iw - 52)}" y="${px(mid)}" text-anchor="end" style="font:700 14px var(--sans);font-variant-numeric:tabular-nums;fill:var(--foreground)">${f.int(s.count)}</text>
        ${i ? `<text x="${px(pad.l + iw)}" y="${px(mid)}" text-anchor="end" class="ax" style="fill:var(--destructive)">−${s.drop}%</text>` : ''}`;
    });
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
      <defs><linearGradient id="fnl" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="var(--chart-1)"/><stop offset="100%" stop-color="var(--chart-4)"/></linearGradient></defs>
      ${out}</svg>`;
  };
}

/* ---------------------------------------------------------------- gauge --- */
/* Arc = error budget remaining. Needle = 1-hour burn rate on the inner ring,
 * whose last tick is the 6x alert line (one window's budget inside the hour).
 * Readout sits in the dial's bottom gap so the needle can never cross it. */
function gauge({ pct, burn1, h = 210 }) {
  return (w) => {
    const ring = 14;
    const R = Math.max(54, Math.min(100, w / 2 - 11));
    const cx = w / 2, cy = R + 13;
    const A0 = Math.PI * (150 / 180), A1 = Math.PI * (390 / 180), span = A1 - A0;
    const val = Math.max(0, Math.min(100, pct ?? 0));
    const col = val > 50 ? 'var(--chart-3)' : val > 15 ? 'var(--chart-1)' : 'var(--destructive)';
    const nr = R - ring - 7, tr = R - ring / 2 - 3;
    const burnAng = A0 + Math.min(1, (burn1 ?? 0) / 6) * span;
    const tick = (b) => { const a = A0 + Math.min(1, b / 6) * span, alert = b === 6;
      return `<line x1="${px(cx + (tr - 9) * Math.cos(a))}" y1="${px(cy + (tr - 9) * Math.sin(a))}"
        x2="${px(cx + tr * Math.cos(a))}" y2="${px(cy + tr * Math.sin(a))}"
        stroke="${alert ? 'var(--destructive)' : 'var(--viz-ink)'}" stroke-width="${alert ? 2.4 : 1.4}" stroke-linecap="round"/>`; };
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
      <path d="${arcPath(cx, cy, R, A0, A1)}" fill="none" stroke="var(--viz-track)" stroke-width="${ring}" stroke-linecap="round"/>
      ${val > 0.4 ? `<path class="stroke-draw" d="${arcPath(cx, cy, R, A0, A0 + span * val / 100)}" fill="none" stroke="${col}" stroke-width="${ring}" stroke-linecap="round"/>` : ''}
      ${[0, 1, 3, 6].map(tick).join('')}
      <g class="needle" style="transform:rotate(${px(burnAng * 180 / Math.PI)}deg);transform-origin:${px(cx)}px ${px(cy)}px">
        <line x1="${px(cx - 9)}" y1="${px(cy)}" x2="${px(cx + nr)}" y2="${px(cy)}" stroke="var(--foreground)" stroke-width="2.2" stroke-linecap="round"/>
        <circle cx="${px(cx + nr)}" cy="${px(cy)}" r="3.4" fill="var(--foreground)"/>
      </g>
      <circle cx="${px(cx)}" cy="${px(cy)}" r="5.5" fill="var(--card)" stroke="var(--foreground)" stroke-width="2"/>
      <text x="${px(cx)}" y="${px(cy + R * 0.66 + 12)}" text-anchor="middle" style="font:700 30px var(--sans);font-variant-numeric:tabular-nums;letter-spacing:-.02em;fill:${val > 0.4 ? 'var(--foreground)' : 'var(--destructive)'}">${val.toFixed(1)}%</text>
      <text x="${px(cx)}" y="${px(cy + R * 0.66 + 28)}" text-anchor="middle" class="ax">budget remaining</text>
    </svg>`;
  };
}

/* --------------------------------------------------------------- sankey --- */
function sankey({ paths, h = 250 }) {
  return (w) => {
    const pad = { t: 10, r: 10, b: 10, l: 10 };
    const cols = Math.max(...paths.map((p) => p.sequence.length));
    const nodeW = 11, colGap = (w - pad.l - pad.r - nodeW) / Math.max(1, cols - 1);
    const nodes = new Map(), links = [];
    paths.forEach((p) => p.sequence.forEach((name, c) => {
      const k = c + '|' + name;
      if (!nodes.has(k)) nodes.set(k, { k, c, name, v: 0, in: 0, out: 0 });
      nodes.get(k).v += p.count;
      if (c) links.push({ a: (c - 1) + '|' + p.sequence[c - 1], b: k, v: p.count });
    }));
    const byCol = [...Array(cols)].map((_, c) => [...nodes.values()].filter((n) => n.c === c).sort((a, b) => b.v - a.v));
    const totalMax = Math.max(...byCol.map((col) => col.reduce((s, n) => s + n.v, 0)));
    const gapY = 14, availH = h - pad.t - pad.b;
    byCol.forEach((col) => {
      const sum = col.reduce((s, n) => s + n.v, 0);
      const sc = (availH - (col.length - 1) * gapY) / totalMax;
      let yy = pad.t + (availH - (sum * sc + (col.length - 1) * gapY)) / 2;
      col.forEach((n) => { n.h = Math.max(10, n.v * sc); n.y = yy; n.x = pad.l + n.c * colGap; yy += n.h + gapY; n.oy = n.y; n.iy = n.y; });
    });
    const COLS = ['var(--chart-3)', 'var(--chart-1)', 'var(--chart-2)'];
    const ribbons = links.map((l, i) => {
      const a = nodes.get(l.a), b = nodes.get(l.b);
      const sc = a.h / a.v, th = Math.max(3, l.v * sc);
      const y0 = a.oy; a.oy += th;
      const scb = b.h / b.v, thb = Math.max(3, l.v * scb);
      const y1 = b.iy; b.iy += thb;
      const x0 = a.x + nodeW, x1 = b.x, mx = (x0 + x1) / 2;
      return `<path class="plot" style="--pd:${120 + i * 70}ms" d="M${px(x0)},${px(y0)} C${px(mx)},${px(y0)} ${px(mx)},${px(y1)} ${px(x1)},${px(y1)}
        L${px(x1)},${px(y1 + thb)} C${px(mx)},${px(y1 + thb)} ${px(mx)},${px(y0 + th)} ${px(x0)},${px(y0 + th)} Z"
        fill="url(#skg${i})" fill-opacity=".55"/>
        <linearGradient id="skg${i}" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
        <stop offset="0%" stop-color="${COLS[a.c % 3]}"/><stop offset="100%" stop-color="${COLS[b.c % 3]}"/></linearGradient>`;
    }).join('');
    const nodeEls = [...nodes.values()].map((n) => {
      const right = n.c === cols - 1 || n.x + nodeW + 90 > w;
      return `<rect class="growy" style="transform-origin:${px(n.x)}px ${px(n.y + n.h)}px" x="${px(n.x)}" y="${px(n.y)}" width="${nodeW}" height="${px(n.h)}" rx="3.5" fill="${COLS[n.c % 3]}"/>
      <text class="ax" x="${px(right ? n.x - 6 : n.x + nodeW + 6)}" y="${px(n.y + n.h / 2 + 3.5)}" text-anchor="${right ? 'end' : 'start'}" style="font-family:var(--mono);font-size:10.5px;fill:var(--foreground)">${esc(n.name)}</text>`;
    }).join('');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"><defs></defs>${ribbons}${nodeEls}</svg>`;
  };
}

/* -------------------------------------------------------------- treemap --- */
function squarify(items, x, y, w, h) {
  const out = [], total = items.reduce((s, i) => s + i.value, 0) || 1;
  let rest = items.map((i) => ({ ...i, a: i.value / total * w * h }));
  let rx = x, ry = y, rw = w, rh = h;
  const worst = (row, len) => {
    const s = row.reduce((a, b) => a + b.a, 0), mx = Math.max(...row.map((r) => r.a)), mn = Math.min(...row.map((r) => r.a));
    return Math.max(len * len * mx / (s * s), (s * s) / (len * len * mn));
  };
  while (rest.length) {
    const vertical = rw >= rh, len = vertical ? rh : rw;
    const row = [rest[0]]; let i = 1;
    while (i < rest.length && worst([...row, rest[i]], len) <= worst(row, len)) row.push(rest[i++]);
    const s = row.reduce((a, b) => a + b.a, 0), thick = s / len;
    let off = vertical ? ry : rx;
    row.forEach((r) => {
      const side = r.a / thick;
      out.push(vertical ? { ...r, x: rx, y: off, w: thick, h: side } : { ...r, x: off, y: ry, w: side, h: thick });
      off += side;
    });
    if (vertical) { rx += thick; rw -= thick; } else { ry += thick; rh -= thick; }
    rest = rest.slice(row.length);
    if (rw < 0.5 || rh < 0.5) break;
  }
  return out;
}
function treemap({ items, h = 320, fmt = f.compact }) {
  return (w) => {
    const cells = squarify(items, 0, 0, w, h);
    const max = Math.max(...items.map((i) => i.value));
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">${cells.map((c, i) => {
      const k = c.value / max;
      const fill = `color-mix(in oklch, var(--chart-1) ${Math.round(54 + k * 42)}%, var(--surface-sunken))`;
      const big = c.w > 104 && c.h > 62, mid = c.w > Math.max(72, c.name.length * 6.6 + 22) && c.h > 30;
      return `<g class="popin" style="--pd:${i * 45}ms;transform-origin:${px(c.x + c.w / 2)}px ${px(c.y + c.h / 2)}px">
        <rect x="${px(c.x + 1.5)}" y="${px(c.y + 1.5)}" width="${px(Math.max(0, c.w - 3))}" height="${px(Math.max(0, c.h - 3))}" rx="8" fill="${fill}" stroke="var(--border)"/>
        ${mid ? `<text x="${px(c.x + 11)}" y="${px(c.y + 22)}" style="font-family:var(--mono);font-size:11.5px;fill:var(--primary-foreground)">${esc(c.name)}</text>` : ''}
        ${big ? `<text x="${px(c.x + 11)}" y="${px(c.y + 42)}" style="font:700 15px var(--sans);font-variant-numeric:tabular-nums;fill:var(--primary-foreground)">${fmt(c.value)}</text>
                 <text x="${px(c.x + 11)}" y="${px(c.y + 57)}" style="font-family:var(--mono);font-size:10px;fill:color-mix(in oklch, var(--primary-foreground) 74%, transparent)">${c.pct}% of tokens</text>` : ''}
      </g>`; }).join('')}</svg>`;
  };
}

/* --------------------------------------------------------- grouped bars --- */
function groupedBars({ labels, series, h = 220, yfmt = f.compact }) {
  return (w) => {
    const pad = { t: 12, r: 10, b: 38, l: 42 };
    const iw = Math.max(40, w - pad.l - pad.r), ih = h - pad.t - pad.b;
    const max = Math.max(...series.flatMap((s) => s.values));
    const ticks = niceTicks(max, 4), ymax = ticks[ticks.length - 1] || 1;
    const y = scale(0, ymax, pad.t + ih, pad.t);
    const gw = iw / labels.length, bw = Math.min(26, (gw - 12) / series.length);
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
      ${ticks.map((t) => `<line class="gridline" x1="${pad.l}" y1="${px(y(t))}" x2="${px(pad.l + iw)}" y2="${px(y(t))}"/>
        <text class="ax" x="${pad.l - 7}" y="${px(y(t) + 3.5)}" text-anchor="end">${yfmt(t)}</text>`).join('')}
      ${labels.map((lb, i) => series.map((s, k) => {
        const x0 = pad.l + i * gw + gw / 2 - (series.length * bw + 4) / 2 + k * (bw + 4);
        const bh = Math.max(1, pad.t + ih - y(s.values[i]));
        return `<rect class="growy" style="--pd:${i * 55 + k * 24}ms;transform-origin:${px(x0)}px ${px(pad.t + ih)}px" x="${px(x0)}" y="${px(y(s.values[i]))}" width="${px(bw)}" height="${px(bh)}" rx="4" fill="${s.color}"/>`;
      }).join('')).join('')}
      <line class="axline" x1="${pad.l}" y1="${px(pad.t + ih)}" x2="${px(pad.l + iw)}" y2="${px(pad.t + ih)}"/>
      ${labels.map((lb, i) => `<text class="ax ax--dim" x="${px(pad.l + i * gw + gw / 2)}" y="${h - 20}" text-anchor="middle">${esc(lb)}</text>`).join('')}
      <text class="ax ax--dim" x="${px(pad.l + iw / 2)}" y="${h - 5}" text-anchor="middle">payload size</text>
    </svg>`;
  };
}

/* ------------------------------------------------------------- swimlane --- */
/* One lane per target (the session, then each method / resource / tool), which
 * is what makes a trace readable: the name lives on the left axis, so a 240 ms
 * call does not have to carry a 15-character label inside 34 px of bar. */
function swimlane({ rows, total, rowH = 24 }) {
  return (w) => {
    const pad = { t: 10, r: 16, b: 26, l: Math.min(126, Math.max(74, w * 0.22)) };
    const iw = Math.max(60, w - pad.l - pad.r);
    const h = pad.t + rows.length * rowH + pad.b;
    const x = scale(0, total, pad.l, pad.l + iw);
    const ticks = niceTicks(total / 1000, 4).map((v) => v * 1000).filter((v) => v <= total);
    const KIND = { session: 'var(--chart-3)', protocol: 'var(--chart-5)', tool: 'var(--chart-1)' };
    let i = 0;
    const lanes = rows.map((r, ri) => {
      const yc = pad.t + ri * rowH + rowH / 2;
      const col = r.err ? 'var(--destructive)' : KIND[r.kind];
      const bars = r.events.map((e, ei) => {
        i++;
        const x0 = x(e.at), bw = e.dur ? Math.max(4, x(e.at + e.dur) - x0) : 0;
        const c = e.err ? 'var(--destructive)' : KIND[r.kind];
        const body = bw
          ? `<rect x="${px(x0)}" y="${px(yc - 7)}" width="${px(bw)}" height="14" rx="4" fill="${c}" fill-opacity=".95"/>`
          : `<path d="M${px(x0)},${px(yc - 6)} l6,6 l-6,6 l-6,-6 Z" fill="${c}"/>`;
        let tag = e.tag || (e.dur ? f.ms(e.dur) : '');
        let tw = tag.length * 5.6 + 8;
        const next = r.events[ei + 1];
        if (next && x0 + bw + 6 + tw > x(next.at) - 4) tag = '';   // the next bar needs the room
        tw = tag.length * 5.6 + 8;
        const right = x0 + bw + 6 + tw > pad.l + iw;
        return `<g class="popin" style="--pd:${i * 42}ms;transform-origin:${px(x0)}px ${px(yc)}px">${body}
          ${tag ? `<text x="${px(right ? x0 - (bw ? 0 : 9) - 5 : x0 + bw + 6)}" y="${px(yc + 3.5)}" text-anchor="${right ? 'end' : 'start'}"
            style="font-family:var(--mono);font-size:9.5px;fill:${e.err ? 'var(--destructive)' : 'var(--ink-faint)'}">${esc(tag)}</text>` : ''}</g>`;
      }).join('');
      return `<rect x="${pad.l}" y="${px(pad.t + ri * rowH + 2)}" width="${px(iw)}" height="${px(rowH - 4)}" rx="6"
          fill="${ri % 2 ? 'var(--viz-track)' : 'transparent'}"/>
        <text x="${px(pad.l - 9)}" y="${px(yc + 3.5)}" text-anchor="end"
          style="font-family:var(--mono);font-size:10px;fill:${r.kind === 'tool' ? 'var(--foreground)' : 'var(--muted-foreground)'}">${esc(clip(r.label, Math.floor((pad.l - 14) / 5.95)))}</text>
        <circle cx="${px(pad.l - 2)}" cy="${px(yc)}" r="2" fill="${col}"/>
        ${bars}`;
    }).join('');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
      ${ticks.map((t) => `<line class="gridline" x1="${px(x(t))}" y1="${pad.t}" x2="${px(x(t))}" y2="${px(h - pad.b + 2)}"/>
        <text class="ax ax--dim" x="${px(x(t))}" y="${px(h - 8)}" text-anchor="middle">${t / 1000}s</text>`).join('')}
      ${lanes}
    </svg>`;
  };
}

export { sparkline, stackedArea, bandChart, donut, latencyHist, funnel, gauge, sankey, treemap, groupedBars, swimlane };
