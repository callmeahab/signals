'use client';
import { Icon } from '../icons/index.js';
import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import * as render from './renderers.js';
import type { Cohort, FunnelStep, TimelineAnalytics } from '../analytics-types.js';

type Cell = string | number | null | undefined;
type Draw = (width:number)=>string|{html:string;after?:(element:HTMLElement)=>void|(()=>void)};
const colors=['var(--chart-3)','var(--chart-1)','var(--chart-2)'];
export const clientColor=(name:string,index=0)=>({Claude:'var(--chart-1)',Cursor:'var(--chart-3)',ChatGPT:'var(--chart-2)'}[name]??colors[index%3]);

// Row values carry their own unit and formatting, so one tooltip line reads as a
// sentence ("Tool calls: 3,731 calls") in the keyboard readout, at the pointer and in
// the hidden table twin, which all read the same `headers`/`rows`.
const nf=new Intl.NumberFormat('en');
type Fmt=(n:number)=>string;
const round=(n:number)=>Math.round(n*10)/10;
export const unitFormat=(suffix:string):Fmt=>n=>suffix?`${nf.format(round(n))} ${suffix}`:nf.format(round(n));
const plain=unitFormat('');
const msFormat:Fmt=n=>`${nf.format(Math.round(n))} ms`;
const pctFormat:Fmt=n=>`${round(n)}%`;
const cell=(value:number|null|undefined,format:Fmt=plain)=>value==null?null:format(value);
const dateCell=(labels:string[],index:number)=>labels[index]==null?null:render.axisDate(labels,labels[index]);

// Keyboard inspection must not open on a pointer click, and the figure is focusable, so
// a click focuses it. `:focus-visible` already excludes a pointer click in current
// browsers; the shared flag makes the same decision for a programmatic focus that
// follows a key press, which is how a screen reader or a test arrives.
let keyboardIntent=false, watching=false;
function watchInput(){
 if(watching||typeof document==='undefined')return;
 watching=true;
 document.addEventListener('keydown',()=>{keyboardIntent=true;},true);
 document.addEventListener('pointerdown',()=>{keyboardIntent=false;},true);
}

function Readout({headers,rows,index,pointer}:{headers:string[];rows:Cell[][];index:number;pointer?:boolean}){
 const row=rows[index];
 if(!row)return null;
 return <div className={`chart-key-tooltip${pointer?' chart-key-tooltip--pointer':''}`} role="tooltip">{row.map((v,i)=><span key={i}>{headers[i]}: {v??'No data yet'} </span>)}</div>;
}

export function Chart({label,kind,draw,headers,rows,height=220}:{label:string;kind:string;draw:Draw;headers:string[];rows:Cell[][];height?:number}) {
 const host=useRef<HTMLDivElement>(null),figure=useRef<HTMLElement>(null),tip=useRef<HTMLDivElement>(null),id=useId();
 const [selected,setSelected]=useState<number|null>(null);
 const [hover,setHover]=useState<{index:number;x:number;y:number}|null>(null);
 const pending=useRef<{index:number;x:number;y:number}|null>(null),timer=useRef(0);
 // A 60-second refresh redraws the same chart: the first paint draws in, later paints
 // land finished (`nt`), so nothing re-animates and nothing moves.
 const painted=useRef(false);
 useEffect(()=>{watchInput();return()=>clearTimeout(timer.current);},[]);
 useLayoutEffect(()=>{const el=host.current;if(!el)return;let frame=0;let resizeFrame=0;let width=0;let visible=false;let pendingWidth=0;let disposed=false;let detach:(()=>void)|void;
 const paint=(w:number)=>{if(disposed||w<=0||w===width)return;detach?.();cancelAnimationFrame(frame);width=w;const result=draw(w);const out=typeof result==='string'?{html:result}:result;el.innerHTML=out.html;el.querySelectorAll('svg').forEach(svg=>{svg.setAttribute('role','img');svg.setAttribute('aria-label',label);svg.removeAttribute('aria-hidden');if(!svg.hasAttribute('viewBox'))svg.setAttribute('viewBox',`0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}`);});
 el.querySelectorAll<SVGPathElement>('.stroke-draw').forEach(p=>{p.setAttribute('pathLength','1');p.style.setProperty('--len','1');});
 // Give each staggered bar its own SVG root so its transform can composite.
 const bars=el.querySelectorAll<SVGRectElement>('rect.growx,rect.growy');
 if(bars.length){const original=el.querySelector('svg')!;const gridlines=original.querySelectorAll('.gridline');if(gridlines.length){const grid=original.cloneNode(false) as SVGSVGElement;grid.removeAttribute('role');grid.removeAttribute('aria-label');grid.setAttribute('aria-hidden','true');grid.style.cssText='position:absolute;z-index:1;left:0;top:0;z-index:0';gridlines.forEach(line=>grid.append(line));el.append(grid);}}
 bars.forEach(rect=>{const layer=document.createElementNS('http://www.w3.org/2000/svg','svg');const x=rect.getAttribute('x')??'0',y=rect.getAttribute('y')??'0',w=rect.getAttribute('width')??'0',h=rect.getAttribute('height')??'0';layer.setAttribute('class',rect.getAttribute('class')!);layer.setAttribute('aria-hidden','true');layer.setAttribute('width',w);layer.setAttribute('height',h);layer.style.cssText=`position:absolute;z-index:1;left:${x}px;top:${y}px;overflow:visible;pointer-events:none;will-change:transform;transform-origin:left ${rect.classList.contains('growy')?'bottom':'top'};--pd:${rect.style.getPropertyValue('--pd')||'0ms'}`;rect.removeAttribute('class');rect.removeAttribute('style');rect.setAttribute('x','0');rect.setAttribute('y','0');layer.append(rect);el.append(layer);});
 const instant=painted.current;painted.current=true;
 detach=out.after?.(el);frame=requestAnimationFrame(()=>el.querySelectorAll('.plot,.stroke-draw,.growx,.growy,.popin').forEach(n=>{if(instant)n.classList.add('nt');n.classList.add('on');}));};
 const observer=new ResizeObserver(entries=>{pendingWidth=Math.round(entries[0].contentRect.width);if(visible){cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>paint(pendingWidth));}});observer.observe(el);const intersection=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){visible=true;resizeFrame=requestAnimationFrame(()=>paint(pendingWidth));intersection.disconnect();}},{rootMargin:'0px'});intersection.observe(el.parentElement!);return()=>{disposed=true;intersection.disconnect();observer.disconnect();cancelAnimationFrame(frame);cancelAnimationFrame(resizeFrame);detach?.();el.replaceChildren();};},[draw,label]);
 // Keep the pointer readout inside the plot box, so it cannot clip at any width.
 useLayoutEffect(()=>{const el=tip.current,box=figure.current;if(!el||!box||!hover)return;
  const {width:bw,height:bh}=box.getBoundingClientRect();
  let left=hover.x+14,top=hover.y+14;
  if(left+el.offsetWidth>bw-2)left=Math.max(2,hover.x-el.offsetWidth-14);
  if(top+el.offsetHeight>bh-2)top=Math.max(2,hover.y-el.offsetHeight-14);
  el.style.left=`${Math.round(left)}px`;el.style.top=`${Math.round(top)}px`;},[hover]);
 const leave=()=>{clearTimeout(timer.current);timer.current=0;pending.current=null;setHover(null);};
 const move=(event:React.PointerEvent)=>{
  if(event.pointerType==='touch')return;
  const target=event.target as Element|null;
  const anchor=target?.closest?.('[data-row]');
  const index=anchor?Number(anchor.getAttribute('data-row')):Number.NaN;
  if(!Number.isInteger(index)||!rows[index]){leave();return;}
  const box=figure.current!.getBoundingClientRect();
  pending.current={index,x:event.clientX-box.left,y:event.clientY-box.top};
  if(hover){setHover(pending.current);return;}
  if(!timer.current)timer.current=window.setTimeout(()=>{timer.current=0;setHover(pending.current);},120);
 };
 const scrolls=kind==='gantt'||kind==='sankey';
 return <div className="table-container">{scrolls&&<p className="table-scroll-hint">Scroll horizontally to inspect the full chart ↔</p>}<div className={scrolls?'table-scroll chart-scroll':undefined} tabIndex={scrolls?0:undefined}><figure ref={figure} className={`v3-chart chartbox chart-${kind}`} data-chart={kind} style={{margin:0,minHeight:height}} tabIndex={0} aria-label={`${label}. Use arrow keys to inspect values.`} aria-describedby={id} onPointerMove={move} onPointerLeave={leave} onFocus={e=>{if(keyboardIntent||e.currentTarget.matches(':focus-visible'))setSelected(0);}} onBlur={()=>setSelected(null)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();setSelected(i=>e.key==='Home'?0:e.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,(i??0)+(e.key==='ArrowRight'?1:-1))));}}}>
 <div ref={host}/>{selected!==null&&<Readout headers={headers} rows={rows} index={selected}/>}
 {selected===null&&hover&&<div ref={tip} className="chart-tip-layer"><Readout headers={headers} rows={rows} index={hover.index} pointer/></div>}
 <table className="sr-only" id={id}><caption>{label}</caption><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{row.map((value,j)=><td key={j}>{value??'No data yet'}</td>)}</tr>)}</tbody></table>
 </figure></div></div>;
}
export function Waiting({event='SDK events'}:{event?:string;shape?:'bars'|'line'|'ring'}){return <div className="emptychart"><Icon name="waiting" size={44} target=".emptychart"/><div className="emptychart__t">No data yet</div><div className="emptychart__s">Waiting for {event}</div></div>;}
// `labels` are the series' own bucket timestamps, so the readout names a date rather
// than an ordinal, and `format` is the tile's own formatter, so it carries the unit.
export function Sparkline({values,labels,series,format=plain,label='Trend',color='var(--chart-1)',height=38}:{height?:number;values:(number|null|undefined)[];labels?:string[];series?:string;format?:Fmt;label?:string;color?:string}){
 return values.length&&values.some(v=>v!=null)
  ?<Chart kind="sparkline" label={label} height={height} draw={render.sparkline({values:values as number[],color,h:height})}
    headers={[labels?.length?'Date':'Bucket',series??'Value']}
    rows={values.map((v,i)=>[labels?.length?dateCell(labels,i):i+1,cell(v,format)])}/>
  :<div className="spark-wait">Waiting for trend</div>;
}
export type Series={name:string;color:string;values:number[]};
export function Area({labels,series,label='Calls by client',height=260,format=unitFormat('calls')}:{labels:string[];series:Series[];label?:string;height?:number;format?:Fmt}){return labels.length?<><div className="legend">{series.map(s=><span key={s.name}><i style={{background:s.color}}/>{s.name}</span>)}</div><Chart kind={series.length>1?'stacked-area':'area'} label={label} height={height} draw={render.stackedArea({labels,series,h:height})} headers={['Date',...series.map(s=>s.name)]} rows={labels.map((t,i)=>[render.axisDate(labels,t),...series.map(s=>cell(s.values[i],format))])}/></>:<Waiting/>;}
export function Donut({items,label,centre='',sub='',columns=['Category','Value'],format=plain}:{items:{name:string;value:number;color:string}[];label:string;centre?:string;sub?:string;columns?:[string,string];format?:Fmt}){return items.length?<Chart kind="donut" label={label} draw={render.donut({items,centre,centreSub:sub})} headers={columns} rows={items.map(i=>[i.name,cell(i.value,format)])}/>:<Waiting event="category observations" shape="ring"/>;}
// Only a funnel that cannot measure its first step is empty. A later null step is a
// null step inside the chart; it never blanks the steps that do have counts.
export function Funnel({steps}:{steps:FunnelStep[]}){const rows=steps.map(s=>({...s,label:s.step.replaceAll('_',' ')}));return steps.length&&steps[0].count!=null?<Chart kind="funnel" label="Activation funnel" height={252} draw={render.funnel({steps:rows})} headers={['Step','Identities','Drop-off']} rows={steps.map(s=>[s.step,s.count==null?'—':unitFormat('identities')(s.count),s.dropoff_pct==null?'—':pctFormat(s.dropoff_pct)])}/>:<Waiting event="identity activation events"/>;}
export function Gauge({pct,burn,label}:{pct:number|null;burn:number|null;label:string}){return pct===null||burn===null?<Waiting event="SLO observations · No calls for this class" shape="ring"/>:<Chart kind="gauge" label={label} draw={render.gauge({pct,burn1:burn})} headers={['Error budget remaining','Burn rate 1 h']} rows={[[pctFormat(pct),`${round(burn)}×`]]}/>;}
export function Histogram({buckets,markers}:{buckets?:{edges:(number|null)[];counts:number[]}|null;markers:{p50:number|null;p95:number|null;p99:number|null}}){const bins=buckets?.counts.map((n,i)=>({lo:buckets.edges[i]??1,hi:buckets.edges[i+1]??(buckets.edges[i]??1)*1.26,n}));return bins?.length?<Chart kind="histogram" label="Latency distribution" height={228} draw={render.latencyHist({buckets:bins,markers:Object.fromEntries((['p50','p95','p99'] as const).map(k=>[k,markers[k]]).filter(([,v])=>typeof v==='number'&&Number.isFinite(v)))})} headers={['Latency band','Calls']} rows={bins.map((b,i)=>[buckets!.edges[i+1]==null?`${nf.format(round(b.lo))} ms and over`:`${nf.format(round(b.lo))} – ${nf.format(round(b.hi))} ms`,unitFormat('calls')(b.n)])}/>:<Waiting event="latency histogram buckets"/>;}
export function Band({points}:{points:{t:string;p50?:number|null;p95?:number|null;p99?:number|null}[]}){const labels=points.map(p=>p.t);return points.length&&points.some(p=>p.p50!=null&&p.p95!=null&&p.p99!=null)?<Chart kind="band" label="Latency p50–p95–p99" draw={render.bandChart({labels,lo:points.map(p=>p.p50!),mid:points.map(p=>p.p95!),hi:points.map(p=>p.p99!)})} headers={['Date','p50','p95','p99']} rows={points.map((p,i)=>[dateCell(labels,i),cell(p.p50,msFormat),cell(p.p95,msFormat),cell(p.p99,msFormat)])}/>:<Waiting event="per-bucket latency percentiles" shape="line"/>;}
// `count` is occurrences of the pair or triple in the window, and the share uses every
// observed occurrence as its denominator (docs/analytics.md, "Paths").
export function Sankey({paths}:{paths:{sequence:string[];count:number;pct:number}[]}){const columns=Math.max(0,...paths.map(p=>p.sequence.length));const widest=Math.max(0,...Array.from({length:columns},(_,c)=>new Set(paths.filter(p=>p.sequence[c]).map(p=>p.sequence[c])).size));const height=Math.max(250,widest*26+20);return paths.length?<Chart kind="sankey" label="Common tool paths" height={height} draw={render.sankey({paths,h:height})} headers={['Path','Occurrences','Share']} rows={paths.map(p=>[p.sequence.join(' → '),unitFormat('times')(p.count),pctFormat(p.pct)])}/>:<Waiting event="multi-tool sessions"/>;}
export function Treemap({items}:{items:{tool:string;tokens:number;pct:number}[]}){return items.some(i=>i.tokens>0)?<Chart kind="treemap" label="Context tokens by tool" height={320} draw={render.treemap({items:items.filter(i=>i.tokens>0).map(i=>({name:i.tool,value:i.tokens,pct:i.pct}))})} headers={['Tool','Context tokens','Share']} rows={items.map(i=>[i.tool,`≈ ${unitFormat('tokens')(i.tokens)}`,pctFormat(i.pct)])}/>:<Waiting event="tool output bytes"/>;}
export function GroupedBars({labels,series,label,category='Category',xTitle,format=plain}:{labels:string[];series:Series[];label:string;category?:string;xTitle?:string;format?:Fmt}){return labels.length?<><div className="legend">{series.map(s=><span key={s.name}><i style={{background:s.color}}/>{s.name}</span>)}</div><Chart kind="bars" label={label} draw={render.groupedBars({labels,series,xTitle})} headers={[category,...series.map(s=>s.name)]} rows={labels.map((l,i)=>[l,...series.map(s=>cell(s.values[i],format))])}/></>:<Waiting/>;}
export function Gantt({data}:{data:TimelineAnalytics}){const targets=[...new Set(data.events.map(e=>e.tool??e.method??e.uri??e.prompt??'session'))];const rows=targets.map(label=>({label,kind:label==='session'?'session':data.events.some(e=>e.tool===label)?'tool':'protocol',events:data.events.filter(e=>(e.tool??e.method??e.uri??e.prompt??'session')===label).map(e=>({at:e.offset_ms,dur:e.duration_ms??0,err:e.is_error}))}));return <Chart kind="gantt" label="Session replay" height={rows.length*24+48} draw={render.swimlane({rows,total:Math.max(1,data.session.duration_ms??0,...data.events.map(e=>e.offset_ms+(e.duration_ms??0)))})} headers={['Event','Target','Offset','Duration','Error']} rows={data.events.map(e=>[e.type,e.tool??e.method??e.uri??e.prompt??'Session lifecycle',`+${msFormat(e.offset_ms)}`,cell(e.duration_ms,msFormat),e.is_error==null?'Not reported':e.is_error?'yes':'no'])}/>;}
const safe=(s:string)=>s.replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]!));
export function Heatmap({rows}:{rows:Cohort[]}){const cols=Math.max(1,...rows.map(r=>r.retained_pct.length));return <Chart kind="heatmap" label="Weekly retention" height={rows.length*40+30} headers={['Cohort','Identities',...Array.from({length:cols},(_,i)=>`Week ${i}`)]} rows={rows.map(r=>[`Week of ${r.cohort_start}`,unitFormat('identities')(r.size),...r.retained_pct.map(p=>cell(p,pctFormat))])} draw={w=>{const left=Math.min(150,w*.4),cw=(w-left)/cols;return `<svg width="${w}" height="${rows.length*40+30}">${Array.from({length:cols},(_,i)=>`<text class="ax" x="${left+cw*(i+.5)}" y="12" text-anchor="middle">W${i}</text>`).join('')}${rows.map((r,i)=>`<text class="ax" x="${left-10}" y="${i*40+49}" text-anchor="end">${r.size}</text><text class="ax" x="0" y="${i*40+49}">${safe(r.cohort_start)}</text>${r.retained_pct.map((p,j)=>`<rect x="${left+j*cw+2}" y="${i*40+26}" width="${cw-4}" height="34" rx="6" fill="${p===null?'var(--viz-track)':`color-mix(in oklch,var(--chart-3) ${8+p*.84}%,var(--surface-sunken))`}"/><text class="ax" x="${left+(j+.5)*cw}" y="${i*40+48}" text-anchor="middle" style="fill:${p!==null&&p>=56?'var(--card)':'var(--foreground)'}">${p===null?'–':p+'%'}</text>`).join('')}`).join('')}</svg>`;}}/>;}
export function Ribbon({value,target=99.5,label}:{value:number|null;target?:number;label:string}){return <Chart kind="ribbon" label={label} height={22} headers={['Success','Class target']} rows={[[cell(value,pctFormat),pctFormat(target)]]} draw={w=>`<svg width="${w}" height="22"><rect y="6" width="${w}" height="10" rx="5" fill="var(--viz-track)"/>${value===null?'':`<rect y="6" width="${Math.max(0,Math.min(1,(value-90)/10))*w}" height="10" rx="5" fill="${value<target?'var(--destructive)':'var(--chart-3)'}"/>`}<line x1="${(target-90)/10*w}" x2="${(target-90)/10*w}" y1="3" y2="19" stroke="var(--foreground)"/></svg>`}/>;}
export function DotGrid({items,label,color='var(--chart-1)'}:{color?:string;items:{name:string;pct:number;sessions:number}[];label:string}){return <Chart kind="dot-grid" label={label} height={items.length*60} headers={['Capability','Sessions','Share']} rows={items.map(i=>[i.name,unitFormat('sessions')(i.sessions),pctFormat(i.pct)])} draw={w=>`<svg width="${w}" height="${items.length*60}">${items.map((item,row)=>`<text class="ax" x="0" y="${row*60+13}">${safe(item.name)} · ${item.pct}%</text>${Array.from({length:50},(_,i)=>`<circle cx="${5+i%25*(w-10)/25}" cy="${row*60+28+Math.floor(i/25)*13}" r="4" fill="${i<Math.round(item.pct/2)?color:'var(--viz-track)'}"/>`).join('')}`).join('')}</svg>`}/>;}

export function Rings({dau,wau,mau}:{dau:number;wau:number;mau:number}){const values=[dau,wau,mau];return <Chart kind="donut" label="DAU / WAU / MAU" height={212} headers={['Window','Active identities']} rows={values.map((v,i)=>[['Daily','Weekly','Monthly'][i],unitFormat('identities')(v)])} draw={w=>{const cx=w/2,cy=100;return `<svg width="${w}" height="212">${values.map((v,i)=>{const outer=Math.min(84,w/2-12),r=outer-i*outer/5,c=2*Math.PI*r;return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--viz-track)" stroke-width="11"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${['var(--chart-1)','var(--chart-3)','var(--chart-2)'][i]}" stroke-width="11" stroke-dasharray="${mau?v/mau*c:0} ${c}" stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/>`;}).join('')}<text x="${cx}" y="100" text-anchor="middle" style="font:700 28px var(--sans);fill:var(--foreground)">${mau?(dau/mau*100).toFixed(1)+'%':'No data yet'}</text><text class="ax" x="${cx}" y="119" text-anchor="middle">DAU / MAU</text></svg>`;}}/>;}

export function RankedBars({items,label,color='var(--chart-1)',columns=['Name','Value'],format=plain}:{color?:string;items:{name:string;value:number}[];label:string;columns?:[string,string];format?:Fmt}){const max=Math.max(1,...items.map(i=>i.value));return <Chart kind="bars" label={label} height={items.length*50} headers={columns} rows={items.map(i=>[i.name,cell(i.value,format)])} draw={w=>`<svg width="${w}" height="${items.length*50}">${items.map((item,i)=>`<text class="ax" x="0" y="${i*50+12}">${safe(item.name)}</text><text class="ax" x="${w}" y="${i*50+12}" text-anchor="end">${new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(item.value)}</text><rect y="${i*50+22}" width="${w}" height="9" rx="4" fill="var(--viz-track)"/><rect y="${i*50+22}" width="${w*item.value/max}" height="9" rx="4" fill="${color}"/><rect class="hit" data-row="${i}" x="0" y="${i*50}" width="${w}" height="50" fill="transparent"/>`).join('')}</svg>`}/>;}

// The curve ends at the last step that has a count; trailing null steps have no share
// to plot, so they stay out of the geometry and read as "—" in the table twin.
export function Conversion({steps}:{steps:FunnelStep[]}){const base=steps[0]?.count;const last=steps.reduce((n,s,i)=>s.count!=null?i:n,-1),drawn=steps.slice(0,last+1);const values=drawn.map(s=>base&&s.count!=null?s.count/base*100:null);return base?<Chart kind="line" label="Conversion" height={230} headers={['Step','Identities','Share']} rows={steps.map((s,i)=>[s.step,s.count==null?'—':unitFormat('identities')(s.count),values[i]==null?'—':pctFormat(values[i]!)])} draw={w=>{const x=(i:number)=>38+i*(w-60)/Math.max(1,drawn.length-1),y=(v:number)=>190-v*1.7;return `<svg width="${w}" height="230">${[0,25,50,75,100].map(v=>`<text class="ax" x="30" y="${y(v)+4}" text-anchor="end">${v}%</text><line class="gridline" x1="38" x2="${w-14}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}<path d="${values.map((v,i)=>v===null?'':`${i?'L':'M'}${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="var(--chart-3)" stroke-width="2.5"/>${values.map((v,i)=>v===null?'':`<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="var(--chart-3)"/><text class="ax" x="${x(i)}" y="${y(v)-9}" text-anchor="middle">${v.toFixed(1)}%</text><text class="ax" x="${x(i)}" y="217" text-anchor="${i===0?'start':i===drawn.length-1?'end':'middle'}">${safe(drawn[i].step.replaceAll('_',' '))}</text>`).join('')}</svg>`;}}/>:<Waiting event="connected identities" shape="line"/>;}
