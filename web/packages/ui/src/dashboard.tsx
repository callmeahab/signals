'use client';
import { TableScroll } from './table-scroll.js';
import { sessionDuration } from './time.js';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Glyph, Icon } from './icons/index.js';
import { Gantt, Donut, RankedBars, Sparkline as MiniSparkline, clientColor } from './charts/index.js';
import { Card, TilesV3 } from './analytics-v3.js';
import { AnalyticsV3 } from './analytics-v3.js';
import { AnalyticsSettingsPanel, TenantUsage, Timeline, NoData } from './analytics.js';
import { snippetId } from './snippet-id.js';
import { ActivityChart, Sparkline } from './charts.js';
import type { Caller, Key, Overview, Project, Range, Screen, Session, SignalEvent, SignalsClient, Tool, User } from './types.js';

const number = new Intl.NumberFormat('en');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const date = (v: string) => new Date(v).toLocaleString('en', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const time = (v: string) => new Date(v).toLocaleTimeString('en', { timeZone: 'UTC', hour12: false });

export function useQuery<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ value?: T; error?: string; loading: boolean }>({ loading: true });
  const loader = useRef(load);
  loader.current = load;
  const previousDeps = useRef(deps);
  const revision = useRef(0);
  if (deps.length !== previousDeps.current.length || deps.some((value, index) => !Object.is(value, previousDeps.current[index]))) {
    previousDeps.current = deps;
    revision.current += 1;
  }
  const dependencyVersion = revision.current;
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    Promise.resolve().then(() => loader.current(controller.signal)).then(value => { if (!controller.signal.aborted) setState({ value, loading: false }); }, error => { if (!controller.signal.aborted) setState({ error: error instanceof Error ? error.message : 'Could not load data.', loading: false }); });
    return () => controller.abort();
  }, [dependencyVersion, refresh]);
  return { ...state, reload: () => setRefresh(n => n + 1) };
}

export function QueryState({ loading, error, retry }: { loading: boolean; error?: string; retry: () => void }) {
  return loading ? <div className="loading-state" role="status"><Icon name="reliability" size={22}/><span>Reading your signals…</span></div> : error ? <div className="empty-state" role="alert"><h2>Couldn’t load this view</h2><p>{error}</p><button className="button" onClick={retry}>Try again</button></div> : null;
}
function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="empty-state"><NoData reason={`${title} · ${children}`}/></div>; }
export function Panel({ title, subtitle, action, children, className = '' }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>;
}
function Pill({ error = false, live = false, children }: { error?: boolean; live?: boolean; children: ReactNode }) { const icon = error ? 'error' : live ? 'streaming' : 'healthy'; return <span className={`status-pill ${error ? 'bad' : 'good'}`}><Icon name={icon} size={12} trigger={live ? 'loop' : null}/>{children}</span>; }
function ToolName({ name }: { name: string }) { return <span className="tool-name"><span className="tool-icon"><Glyph name="terminal" size={15}/></span><code>{name}</code></span>; }
function Delta({ value, inverse = false }: { value: number | null | undefined; inverse?: boolean }) {
  if (value == null) return <span className="delta neutral">No prior data</span>;
  const up = value >= 0;
  return <span className={`delta ${(inverse ? !up : up) ? 'good' : 'bad'}`}>{up ? <Glyph name="arrow-up" size={12}/> : <Glyph name="arrow-down" size={12}/>}{Math.abs(value).toFixed(1)}%</span>;
}

export function SignalsDashboard({ client, project, screen, range, onNavigate, onProjectChange, readOnly = false }: { client: SignalsClient; project: Project; screen: Screen; range: Range; onNavigate: (screen: Screen) => void; onProjectChange: (project: Project) => void; readOnly?: boolean }) {
  const props = { client, project, range };
  return <div className="signals-ui">
    {client.analytics && (['overview','adoption','tools','reliability','cost','protocol'] as string[]).includes(screen) && <AnalyticsV3 key={screen} {...props} screen={screen as 'overview'|'adoption'|'tools'|'reliability'|'cost'|'protocol'} />}
    {client.analytics && screen === 'settings' && <AnalyticsSettingsPanel client={client} project={project} onProjectChange={onProjectChange} readOnly={readOnly}/>}
    {client.analytics && screen === 'callers' && <TenantUsage {...props}/>}
    {!client.analytics && screen === 'overview' && <OverviewScreen {...props} onNavigate={onNavigate} />}
    {!client.analytics && screen === 'tools' && <ToolsScreen {...props} />}
    {screen === 'callers' && <CallersScreen {...props} />}
    {screen === 'sessions' && <SessionsScreen {...props} />}
    {screen === 'live' && <LiveScreen {...props} />}
    {screen === 'settings' && <SettingsScreen {...props} onProjectChange={onProjectChange} readOnly={readOnly} />}
    {screen === 'setup' && <SetupScreen ingestUrl={client.ingestUrl} />}
  </div>;
}
type ScreenProps = { client: SignalsClient; project: Project; range: Range };

function OverviewScreen({ client, project, range, onNavigate }: ScreenProps & { onNavigate: (screen: Screen) => void }) {
  const query = useQuery(async signal => {
    const [overview, points, tools, sessions] = await Promise.all([client.overview(project.id, range, signal), client.timeseries(project.id, range, signal), client.tools(project.id, range, signal), client.sessions(project.id, undefined, signal)]);
    return { overview, points, tools, sessions: sessions.items };
  }, [client, project.id, range]);
  if (!query.value) return <QueryState loading={query.loading} error={query.error} retry={query.reload} />;
  const { overview: o, points, tools, sessions } = query.value;
  if (o.requests === 0) return <><Empty title="Your first signal starts here">Connect your SDK to see who’s using your MCP server.</Empty><SetupScreen ingestUrl={client.ingestUrl} /></>;
  const tiles: { label: string; value: string; delta: string; inverse?: boolean; detail: string }[] = [
    { label: 'Requests', value: compact.format(o.requests), delta: 'requests', detail: `${number.format(o.tool_calls)} tool calls` },
    { label: 'Error rate', value: `${o.error_rate.toFixed(2)}%`, delta: 'error_rate', inverse: true, detail: `${number.format(o.errors)} failed requests` },
    { label: 'p95 latency', value: number.format(Math.round(o.p95)), delta: 'p95', inverse: true, detail: `${Math.round(o.p50)} ms at p50` },
    { label: 'Unique callers', value: compact.format(o.unique_callers), delta: 'unique_callers', detail: `${number.format(o.sessions)} sessions` },
  ];
  return <>
    <div className="metric-grid">{tiles.map((t, i) => <div className={`metric-card ${i === 0 ? 'featured' : ''}`} key={t.label}><div className="metric-label">{t.label}<span>{i === 0 ? <Icon name="live" size={17} target=".metric-card"/> : i === 3 ? <Icon name="adoption" size={17} target=".metric-card"/> : <Icon name="reliability" size={17} target=".metric-card"/>}</span></div><div className="metric-value">{t.value}{i === 2 && <small>ms</small>}</div><div className="metric-bottom"><span>{t.detail}</span><Delta value={o.deltas[t.delta]} inverse={t.inverse} /></div></div>)}</div>
    <Panel title="A little pulse. A lot of insight." subtitle="Requests and errors across your MCP server" action={<div className="chart-legend"><span><i className="flame" />Requests</span><span><i className="red" />Errors</span></div>}><ActivityChart points={points} /></Panel>
    <div className="two-columns"><Panel title="Latency" subtitle="Response time, in milliseconds" action={<div className="chart-legend"><span><i className="teal" />p50</span><span><i className="flame" />p95</span></div>}><ActivityChart points={points} latency /></Panel><ClientsPanel overview={o} /></div>
    <div className="two-columns"><Panel title="Your busiest tools" subtitle="The work your server is doing" action={<button className="text-button" onClick={() => onNavigate('tools')}>All tools<Glyph name="arrow-right" size={15}/></button>}><div className="tool-summary">{tools.slice(0, 5).map(t => <div key={t.tool}><ToolName name={t.tool} /><Sparkline values={t.trend} /><strong>{compact.format(t.calls)}</strong></div>)}</div></Panel><Panel title="Recent sessions" subtitle="A few of your latest connections" action={<button className="text-button" onClick={() => onNavigate('sessions')}>All sessions<Glyph name="arrow-right" size={15}/></button>}><div className="session-summary">{sessions.slice(0, 4).map(s => <div key={s.session_id}><span className="client-avatar">{(s.client_name ?? s.client?.name ?? 'Unknown').slice(0, 1)}</span><div><strong>{s.client_name ?? s.client?.name ?? 'Unknown'}</strong><span>{s.caller_label}</span></div><div><strong>{s.calls} calls</strong><span>{date(s.started_at)}</span></div></div>)}</div></Panel></div>
    <p className="data-note"><Icon name="copied" size={13}/>Data received up to {time(o.updated_at)} UTC · raw events retained for {project.retention_days} days</p>
  </>;
}
function ClientsPanel({ overview }: { overview: Overview }) {
  const total = overview.clients.reduce((n, c) => n + c.count, 0);
  return <Panel title="Who’s connecting" subtitle="Requests by MCP client"><div className="client-stack" role="img" aria-label={overview.clients.map(c => `${c.name}: ${c.count} requests`).join(', ')}>{overview.clients.map((c, i) => <span key={c.name} className={`client-color color-${i % 4}`} style={{ width: `${total ? c.count / total * 100 : 0}%` }} />)}</div><div className="client-list">{overview.clients.map((c, i) => <div key={c.name}><span className={`legend-dot color-${i % 4}`} /><strong>{c.name}</strong><span>{number.format(c.count)}</span><b>{total ? (c.count / total * 100).toFixed(1) : 0}%</b></div>)}</div></Panel>;
}

function ToolsScreen({ client, project, range }: ScreenProps) {
  const query = useQuery(signal => client.tools(project.id, range, signal), [client, project.id, range]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'calls' | 'errors' | 'p95'>('calls');
  const [selected, setSelected] = useState<Tool | null>(null);
  const rows = query.value?.filter(t => t.tool.toLowerCase().includes(search.toLowerCase())).sort((a, b) => b[sort] - a[sort]) ?? [];
  return <><div className="view-toolbar"><SearchInput value={search} onChange={setSearch} placeholder="Find a tool…" /><span>{rows.length} tools</span></div>{!query.value ? <QueryState {...query} retry={query.reload} /> : <Panel title="Every tool, at a glance" subtitle="Select a tool to inspect its recent activity"><TableScroll><table><thead><tr><th>Tool</th><th><button onClick={() => setSort('calls')}>Calls {sort === 'calls' && <Icon name="chevron" size={14} target="button, summary"/>}</button></th><th><button onClick={() => setSort('errors')}>Errors {sort === 'errors' && <Icon name="chevron" size={14} target="button, summary"/>}</button></th><th>p50</th><th><button onClick={() => setSort('p95')}>p95 {sort === 'p95' && <Icon name="chevron" size={14} target="button, summary"/>}</button></th><th>Activity</th><th>Last called</th></tr></thead><tbody>{rows.map(t => <tr key={t.tool}><td><button className="row-button" onClick={() => setSelected(t)}><ToolName name={t.tool} /></button></td><td>{number.format(t.calls)}</td><td className={t.errors ? 'error-text' : ''}>{t.errors}</td><td>{Math.round(t.p50)} ms</td><td>{Math.round(t.p95)} ms</td><td><Sparkline values={t.trend} /></td><td className="mono muted">{date(t.last_called)}</td></tr>)}</tbody></table></TableScroll>{!rows.length && <Empty title="No matching tools">Try a different search, or call a tool from your MCP client.</Empty>}</Panel>}{selected && <EventDrawer client={client} project={project.id} tool={selected} range={range} onClose={() => setSelected(null)} />}</>;
}
function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) { return <label className="search-input"><Icon name="search" size={17} target="label"/><input aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></label>; }

function CallersScreen({ client, project, range }: ScreenProps) {
  const query = useQuery(signal => client.callers(project.id, range, signal), [client, project.id, range]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Caller | null>(null);
  const rows = query.value?.filter(c => `${c.label} ${c.kind}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <><div className="view-toolbar"><SearchInput value={search} onChange={setSearch} placeholder="Find a caller…" /><span>{rows.length} identities</span></div>{!query.value ? <QueryState {...query} retry={query.reload} /> : <Panel title="A name behind every connection" subtitle="Keys, authenticated subjects, and anonymous network identities"><TableScroll><table><thead><tr><th>Caller</th><th>Identity</th><th>Calls</th><th>Sessions</th><th>Errors</th><th>Clients</th><th>First seen</th><th>Last seen</th><th>Error rate</th><th>Favourite tools</th></tr></thead><tbody>{rows.map(c => <tr key={c.id}><td><button className="row-button" onClick={() => setSelected(c)}><span className="caller-icon"><Glyph name="user" size={15}/></span>{c.label}</button></td><td><span className="neutral-pill">{c.kind}</span></td><td>{number.format(c.calls)}</td><td>{c.sessions}</td><td className={c.errors ? 'error-text' : ''}>{c.errors}</td><td>{c.clients.join(', ')}</td><td className="mono muted">{date(c.first_seen)}</td><td className="mono muted">{date(c.last_seen)}</td><td>{c.calls?`${(100*c.errors/c.calls).toFixed(1)}%`:"No data yet"}</td><td className="mono">{c.favourite_tools?.join(", ")??"No data yet"}</td></tr>)}</tbody></table></TableScroll>{!rows.length && <Empty title="No callers yet">Caller identities appear when the first event arrives.</Empty>}</Panel>}{selected && <CallerDrawer client={client} project={project.id} caller={selected} range={range} onClose={() => setSelected(null)} />}</>;
}
function SessionPreview({client,project,session}:{client:SignalsClient;project:string;session:string}){const q=useQuery(signal=>client.timeline!(project,session,signal),[client,project,session]);return <Card title="Session replay" sub="One lane per target · offsets from the first event" focal>{q.value?<Gantt data={q.value}/>:<QueryState {...q} retry={q.reload}/>}</Card>;}
function SessionsScreen({ client, project, range }: ScreenProps) {
  const [cursor, setCursor] = useState<string | undefined>();
  const query = useQuery(async signal => {const [page,overview,reliability,adoption]=await Promise.all([client.sessions(project.id,cursor,signal),client.analytics?.(project.id,'overview',{range},signal),client.analytics?.(project.id,'reliability',{range},signal),client.analytics?.(project.id,'adoption',{range},signal)]);return {...page,overview,reliability,adoption};}, [client, project.id, cursor,range]);
  const [selected, setSelected] = useState<Session | null>(null);
  const d=query.value;
  return <>{d?.overview&&<TilesV3 compact items={[{label:'Sessions',value:d.overview.tiles.sessions.value,meta:`${d.overview.tiles.sessions.calls_per_session??'No data yet'} calls / session`,values:d.adoption?.active.points.map(p=>p.sessions)},{label:'With errors',value:d.reliability?.sessions_with_errors.count,meta:'at least one failed call'},{label:'Cancelled',value:d.reliability?.cancellations.count,meta:'client cancelled mid-call'},{label:'streamable-http',value:d.adoption?.transports.find(t=>t.transport==='streamable-http')?.sessions,meta:'primary transport'},{label:'stdio',value:d.adoption?.transports.find(t=>t.transport==='stdio')?.sessions,meta:'local and dev clients'},{label:'Open on this page',value:d.items.filter(s=>!s.ended_at).length,meta:'no session.ended yet'}]}/>} {query.value?.items[0]&&client.timeline&&<SessionPreview client={client} project={project.id} session={query.value.items[0].session_id}/>} {!query.value ? <QueryState {...query} retry={query.reload} /> : <div className="grid"><Panel className="s12" title="The story of a connection" subtitle="Newest sessions first · select one to see its timeline"><TableScroll><table><thead><tr><th>Client</th><th>Caller</th><th>Started</th><th>Duration</th><th>Depth</th><th>Errors</th><th>Outcome</th><th>Transport</th><th>Reason</th></tr></thead><tbody>{query.value.items.map(s => <tr key={s.session_id}><td><button className="row-button" onClick={() => setSelected(s)}><span className="client-avatar small">{(s.client_name ?? s.client?.name ?? 'Unknown').slice(0, 1)}</span>{s.client_name ?? s.client?.name ?? 'Unknown'}</button></td><td>{s.caller_label}</td><td className="mono muted">{date(s.started_at)}</td><td>{sessionDuration(s.started_at,s.ended_at)}</td><td>{s.calls}</td><td className={s.errors ? 'error-text' : ''}>{s.errors}</td><td><Pill error={s.errors>0}>{s.errors?'Error':s.ended_at ? 'Ended' : 'Active'}</Pill></td><td className="mono">{s.transport}</td><td>{s.reason??'No data yet'}</td></tr>)}</tbody></table></TableScroll>{!query.value.items.length && <Empty title="No sessions yet">Connect an MCP client to start your first session.</Empty>}<div className="pagination"><button className="button secondary" disabled={!cursor} onClick={() => setCursor(undefined)}>Newest</button><button className="button secondary" disabled={!query.value.next_cursor} onClick={() => setCursor(query.value?.next_cursor ?? undefined)}>Older sessions<Glyph name="arrow-right" size={15}/></button></div></Panel>{d?.adoption&&<Card title="Sessions by client" sub="Who is holding the connections"><Donut label="Sessions by client" centre={compact.format(d.overview?.tiles.sessions.value??0)} sub="sessions" items={d.adoption.clients.map((c,i)=>({name:c.name,value:c.sessions,color:clientColor(c.name,i)}))}/></Card>}</div>}{selected && <SessionDrawer client={client} project={project.id} session={selected} onClose={() => setSelected(null)} />}</>;
}
export function Drawer({ title, children, onClose, mono = false }: { title: string; children: ReactNode; onClose: () => void; mono?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={`drawer ${mono ? 'drawer--tool' : ''}`} onCancel={onClose}><div className="drawer-header"><h2>{title}</h2><button className="icon-button" aria-label="Close details" onClick={onClose}><Glyph name="cross" size={20}/></button></div>{children}</dialog>;
}
function EventRows({ events }: { events: SignalEvent[] }) {
  return <div className="event-list">{events.map(e => <details className={`event-row ${(e.type === 'error' || e.attrs.is_error || e.attrs.level === 'error') ? 'has-error' : ''}`} key={e.id}><summary><span className="event-dot" /><time className="mono">{time(e.ts)}</time><span className="event-type mono">{e.type}</span><span className="event-tool mono">{e.attrs.message ?? e.attrs.error_message ?? e.attrs.tool ?? e.attrs.uri ?? e.attrs.prompt ?? e.attrs.method ?? e.attrs.name ?? e.client?.name ?? 'connection'}</span><span className="event-duration mono">{e.attrs.duration_ms != null ? `${e.attrs.duration_ms} ms` : '—'}</span><Icon name="chevron" size={14} target="button, summary"/></summary><pre>{JSON.stringify(e, null, 2)}</pre></details>)}</div>;
}
function EventDrawer({ client, project, tool, range, onClose }: { client: SignalsClient; project: string; tool: Tool; range: Range; onClose: () => void }) {
  const query = useQuery(async signal => {const [points,errors,events]=await Promise.all([client.toolTimeseries(project,tool.tool,range,signal),client.events(project,{tool:tool.tool,is_error:true},signal),client.events(project,{tool:tool.tool},signal)]);return {points,errors:errors.items,events:events.items};}, [client, project, tool.tool, range]);
  return <Drawer title={tool.tool} mono onClose={onClose}><div className="detail-metrics"><div><span>Calls</span><strong>{number.format(tool.calls)}</strong></div><div><span>Errors</span><strong>{tool.errors}</strong></div><div><span>p95</span><strong>{Math.round(tool.p95)} ms</strong></div></div>{query.value ? <><h3>Calls and errors · {range}</h3><ActivityChart points={query.value.points}/><h3>Latency · {range}</h3><ActivityChart points={query.value.points} latency/><h3>Recent errors</h3>{query.value.errors.length?<EventRows events={query.value.errors}/>:<p className="hint">No errors in retained activity.</p>}<h3>Recent activity</h3><EventRows events={query.value.events}/></> : <QueryState {...query} retry={query.reload} />}</Drawer>;
}
function CallerDrawer({client,project,caller,range,onClose}:{client:SignalsClient;project:string;caller:Caller;range:Range;onClose:()=>void}) {
  const query=useQuery(async signal=>{const[points,events]=await Promise.all([client.callerTimeseries(project,caller.id,range,signal),client.events(project,{caller:caller.id},signal)]);return{points,events:events.items};},[client,project,caller.id,range]);
  const networkHash = caller.kind === 'network' ? query.value?.events.find(event => event.caller?.ip_hash)?.caller?.ip_hash : undefined;
  return <Drawer title={caller.label} onClose={onClose}><dl className="details"><dt>Identity</dt><dd>{caller.kind}</dd>{networkHash && <><dt>Network hash</dt><dd className="mono">{networkHash}</dd></>}<dt>First seen</dt><dd>{date(caller.first_seen)} UTC</dd><dt>Last seen</dt><dd>{date(caller.last_seen)} UTC</dd><dt>Calls in this range</dt><dd>{number.format(caller.calls)}</dd><dt>Sessions</dt><dd>{caller.sessions}</dd><dt>Clients</dt><dd>{caller.clients.join(', ')}</dd></dl>{query.value?<><h3>Activity history · {range}</h3><ActivityChart points={query.value.points}/><h3>Recent activity</h3><EventRows events={query.value.events}/>{!query.value.events.length&&<p className="hint">No events remain inside raw retention.</p>}</>:<QueryState {...query} retry={query.reload}/>}<p className="hint">Network identities use a salted hash. Raw peer IP addresses are never stored.</p></Drawer>;
}
function SessionDrawer({ client, project, session, onClose }: { client: SignalsClient; project: string; session: Session; onClose: () => void }) {
  const [cursor,setCursor]=useState<string>();const [events,setEvents]=useState<SignalEvent[]>([]);
  const query = useQuery(signal => client.sessionEvents(project, session.session_id, signal, cursor), [client, project, session.session_id,cursor]);
  useEffect(()=>{if(query.value)setEvents(old=>[...old,...query.value!.items.filter(e=>!old.some(o=>o.id===e.id))]);},[query.value]);
  return <Drawer title={`${session.client_name ?? session.client?.name ?? 'Unknown'} session`} onClose={onClose}><p className="mono hint">{session.session_id}</p><dl className="details"><dt>Caller</dt><dd>{session.caller_label}</dd><dt>Transport</dt><dd>{session.transport}</dd><dt>Started</dt><dd>{date(session.started_at)} UTC</dd></dl><h3>Session timeline</h3>{client.timeline?<Timeline client={client} project={project} session={session.session_id}/>:<EventRows events={events}/>}{query.loading||query.error?<QueryState {...query} retry={query.reload}/>:null}{query.value?.next_cursor&&<button className="button secondary" onClick={()=>setCursor(query.value?.next_cursor??undefined)}>Load more events<Glyph name="arrow-down" size={15}/></button>}</Drawer>;
}
export function LiveScreen({ client, project }: ScreenProps) {
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState<'connected' | 'reconnecting'>('reconnecting');
  const [events, setEvents] = useState<SignalEvent[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (paused) return;
    const abort = new AbortController();
    setEvents([]); setError('');
    client.events(project.id, {}, abort.signal).then(page => setEvents(old => [...old, ...page.items.filter(e => !old.some(item => item.id === e.id))].slice(0, 200)), e => { if (!abort.signal.aborted) setError(e.message); });
    const unsubscribe = client.subscribe(project.id, e => setEvents(rows => [e, ...rows.filter(row => row.id !== e.id)].slice(0, 200)), setStatus);
    return () => { abort.abort(); unsubscribe(); };
  }, [client, project.id, paused]);
  const shown = events.filter(e => (!type || (type === 'errors' ? e.type === 'error' || e.attrs.is_error || e.attrs.level === 'error' : e.type === type)) && `${e.attrs.tool ?? ''} ${e.type} ${JSON.stringify(e.attrs)}`.toLowerCase().includes(search.toLowerCase()));
  const latest=events.reduce((m,e)=>Math.max(m,Date.parse(e.ts)),0);const rate=Array.from({length:40},(_,i)=>{const at=latest-(39-i)*1000;return {t:new Date(at).toISOString(),count:events.filter(e=>Date.parse(e.ts)>at-1000&&Date.parse(e.ts)<=at).length};});const kinds=[...new Set(events.map(e=>e.type))];
  return <><div className="grid"><Card span={4} title="Events per second" sub="Rolling 40 seconds"><div className="metric-sm">{rate.at(-1)?.count??0} <small>ev/s</small></div><MiniSparkline height={72} color="var(--chart-3)" label="Live event rate" values={rate.map(p=>p.count)}/></Card><Card span={4} title="Event mix" sub="Share of the last 200 events"><RankedBars label="Live event mix" items={kinds.map(name=>({name,value:events.filter(e=>e.type===name).length}))}/></Card><Card span={4} title="Errors in window" sub="Failed calls and transport errors"><div className="metric-sm">{events.filter(e=>e.type==='error'||e.attrs.is_error).length} <small>of {events.length}</small></div><MiniSparkline height={72} label="Live errors" color="var(--destructive)" values={rate.map(p=>events.filter(e=>Date.parse(e.ts)>Date.parse(p.t)-1000&&Date.parse(e.ts)<=Date.parse(p.t)&&(e.type==='error'||e.attrs.is_error)).length)}/></Card></div><div className="live-toolbar"><div className="live-state"><Pill error={!paused && status === 'reconnecting'}>{paused ? 'Paused' : status === 'connected' ? 'Streaming' : 'Reconnecting'}</Pill><span>{shown.length} events · latest 200</span></div><button className="button secondary" onClick={() => setPaused(p => !p)}>{paused ? <Icon name="play" size={16} target="button"/> : <Icon name="pause" size={16} target="button"/>}{paused ? 'Resume' : 'Pause'}</button></div><div className="view-toolbar"><SearchInput value={search} onChange={setSearch} placeholder="Search tools and messages…" /><select aria-label="Event type" value={type} onChange={e => setType(e.target.value)}><option value="">All event types</option><option value="errors">All errors</option>{['session.started', 'session.ended', 'mcp.initialize', 'tool.called', 'resource.read', 'prompt.get', 'mcp.request', 'log', 'error', 'custom'].map(t => <option key={t}>{t}</option>)}</select></div><Panel title={type === 'log' ? 'Log stream' : type === 'errors' || type === 'error' ? 'Recent errors' : 'Your server, in the moment'} subtitle="Expand an event to inspect its payload. Pause to hold the view steady.">{error && <p className="form-error" role="alert">{error}</p>}<EventRows events={shown} />{!shown.length && <Empty title="Listening for signals">New events will appear here as they arrive.</Empty>}</Panel></>;
}

function SettingsScreen({ client, project, onProjectChange, readOnly }: ScreenProps & { onProjectChange: (p: Project) => void; readOnly: boolean }) {
  const query = useQuery(signal => client.keys(project.id, signal), [client, project.id]);
  const [form, setForm] = useState(project);
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState('ingest');
  const [secret, setSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Key | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(project), [project]);
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); setMessage(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Request failed.'); } finally { setBusy(false); } }
  return <>{readOnly && <p className="notice">You have viewer access. An owner can change settings and manage keys.</p>}{error && <p className="form-error" role="alert">{error}</p>}{message && <p className="notice good" role="status">{message}</p>}<div className="settings-columns"><Panel title="Project settings" subtitle="Make this space yours"><form onSubmit={e => { e.preventDefault(); void run(async () => { const p = await client.updateProject(project.id, form); onProjectChange(p); setMessage('Project settings saved.'); }); }}><label className="field">Project name<input required maxLength={100} value={form.name} disabled={readOnly} onChange={e => setForm({ ...form, name: e.target.value })} /></label><label className="field">Raw event retention <span className="hint">1–365 days; summaries kept for 400 days.</span><input type="number" min="1" max="365" required value={form.retention_days} disabled={readOnly} onChange={e => setForm({ ...form, retention_days: Number(e.target.value) })} /></label><label className="field">Events per key, per minute<input type="number" min="1" max="10000000" required value={form.rate_events_per_min} disabled={readOnly} onChange={e => setForm({ ...form, rate_events_per_min: Number(e.target.value) })} /></label><label className="field">Bytes per key, per minute<input type="number" min="1" required value={form.rate_bytes_per_min} disabled={readOnly} onChange={e => setForm({ ...form, rate_bytes_per_min: Number(e.target.value) })} /></label><button className="button" disabled={busy || readOnly}>Save changes<Icon name="copied" size={15} target="button"/></button></form></Panel><Panel title="Create an API key" subtitle="A key is always scoped to this project"><form onSubmit={e => { e.preventDefault(); void run(async () => { const result = await client.createKey(project.id, label, scope === 'both' ? ['ingest', 'read'] : [scope]); setSecret(result.secret); setLabel(''); query.reload(); }); }}><label className="field">Key label<input required maxLength={100} placeholder="Production server" value={label} disabled={readOnly} onChange={e => setLabel(e.target.value)} /></label><label className="field">Permissions<select value={scope} disabled={readOnly} onChange={e => setScope(e.target.value)}><option value="ingest">Ingest — send events</option><option value="read">Read — query events</option><option value="both">Ingest and read</option></select></label><p className="hint">The secret is shown once. Store it in your server’s environment, then close this window.</p><button className="button" disabled={busy || readOnly}><Icon name="plus" size={16} target="button"/>Create key</button></form></Panel></div><Panel title="Project keys" subtitle="Revoked keys stop working immediately">{!query.value ? <QueryState {...query} retry={query.reload} /> : <TableScroll><table><thead><tr><th>Label</th><th>Key ID</th><th>Permissions</th><th>Last used</th><th>Status</th><th /></tr></thead><tbody>{query.value.map(k => <tr key={k.id}><td><span className="row-button"><Icon name="key" size={15} target="tr"/>{k.label}</span></td><td className="mono">sgk_{k.key_id}_…</td><td>{k.scopes.join(', ')}</td><td className="mono muted">{k.last_used_at ? date(k.last_used_at) : 'Never'}</td><td><Pill error={!!k.revoked_at}>{k.revoked_at ? 'Revoked' : 'Active'}</Pill></td><td><button className="icon-button destructive" aria-label={`Revoke ${k.label}`} disabled={readOnly || !!k.revoked_at || busy} onClick={() => setConfirm(k)}><Icon name="trash" size={15} target="button"/></button></td></tr>)}</tbody></table>{!query.value.length && <Empty title="No keys yet">Create an ingest key to connect your SDK.</Empty>}</TableScroll>}</Panel>{!readOnly && <UserManagement client={client} project={project.id} />}{secret && <Drawer title="Save your new key" onClose={() => setSecret(null)}><p>This secret is only shown here. Copy it before closing.</p><CopyBlock code={secret} /><button className="button" onClick={() => setSecret(null)}>I’ve saved it<Icon name="copied" size={16} target="button"/></button></Drawer>}{confirm && <Drawer title="Revoke this key?" onClose={() => setConfirm(null)}><p>Apps using <strong>{confirm.label}</strong> will immediately lose access.</p><div className="action-row"><button className="button secondary" onClick={() => setConfirm(null)}>Cancel</button><button className="button danger" disabled={busy} onClick={() => void run(async () => { await client.revokeKey(project.id, confirm.id); setConfirm(null); query.reload(); setMessage('Key revoked.'); })}>Revoke key</button></div></Drawer>}</>;
}

function UserManagement({client,project}:{client:SignalsClient;project:string}) {
  const query=useQuery(signal=>client.users(project,signal),[client,project]);
  const [email,setEmail]=useState(''); const [password,setPassword]=useState('');
  const [role,setRole]=useState<User['role']>('viewer'); const [busy,setBusy]=useState(false); const [message,setMessage]=useState(''); const [error,setError]=useState('');
  async function create(e:React.FormEvent) { e.preventDefault();setBusy(true);setError('');setMessage('');try{await client.createUser(project,email,password,role);setEmail('');setPassword('');setMessage('User created.');query.reload();}catch(e){setError(e instanceof Error?e.message:'Could not create user.');}finally{setBusy(false);} }
  return <Panel title="Workspace users" subtitle="Users can access every project in this tenant.">
    {query.value&&<TableScroll><table><thead><tr><th>Email</th><th>Role</th></tr></thead><tbody>{query.value.map(u=><tr key={u.id}><td>{u.email}</td><td><span className="neutral-pill">{u.role}</span></td></tr>)}</tbody></table></TableScroll>}
    {query.error&&<p className="form-error" role="alert">{query.error}</p>}
    <form onSubmit={e=>void create(e)} style={{paddingTop:24}}>
      <label className="field">New user email<input type="email" autoComplete="off" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label className="field">Initial password<input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <label className="field">Role<select value={role} onChange={e=>setRole(e.target.value as User['role'])}><option value="viewer">Viewer — view events and metrics</option><option value="owner">Owner — manage keys, settings, and users</option></select></label>
      {error&&<p className="form-error" role="alert">{error}</p>}{message&&<p className="notice good" role="status">{message}</p>}
      <button className="button secondary" disabled={busy}><Icon name="plus" size={15} target="button"/>Add user</button>
    </form>
  </Panel>;
}

export function CopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const copy = useCallback(async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setError(''); } catch { setError('Copy unavailable. Select and copy the text below.'); } }, [code]);
  return <div className="copy-block"><button className="icon-button" aria-label="Copy code" onClick={() => void copy()}>{copied ? <Icon name="copied" size={16} target="button"/> : <Glyph name="copy" size={16}/>}</button><pre>{code}</pre>{error && <span className="hint" role="status">{error}</span>}</div>;
}
export function SetupScreen({ingestUrl}:{ingestUrl:string}) {
  const [tab, setTab] = useState('python');
  const [sample] = useState(() => {
    const now = Date.now();
    return { ts: new Date(now).toISOString(), id: snippetId() };
  });
  const baseUrl = ingestUrl.replace(/\/v1\/events\/?$/, '');
  const batch = {schema_version:1, source:{sdk:'curl',sdk_version:'0',server_name:'demo',server_version:'0',instance_id:'i_demo'},sent_at:sample.ts,dropped:0,events:[{id:sample.id,ts:sample.ts,type:'custom',attrs:{name:'hello'}}]};
  const code = tab === 'curl' ? `curl -X POST "${ingestUrl}" \\
  -H "Authorization: Bearer $SIGNALS_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(batch)}'` : tab === 'node' ? `// npm install @mcpramen/signals
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Signals } from '@mcpramen/signals';
const signals = Signals.fromEnv();
const server = new McpServer({ name: 'my-server', version: '1.0.0' });
signals.instrument(server);
// Your Express app and MCP transport:
app.use(signals.express());
await server.connect(transport);` : `# pip install "mcpramen-signals[mcp]"
from mcp.server.mcpserver import MCPServer
from mcpramen_signals import Signals
signals = Signals.from_env()
mcp = MCPServer("my-server")
signals.instrument(mcp)
app = signals.asgi(mcp.streamable_http_app())`;
  return <div className="setup-page"><div className="setup-intro"><span className="setup-mark"><Icon name="live" size={30}/></span><h2>Give your MCP server a pulse.</h2><p>Connect your MCP server and start seeing what happens between your tools and the people using them.</p></div><Panel title="1. Create an ingest key" subtitle="In Settings, create a project key with ingest permission."><p>Set <code>SIGNALS_URL</code> to the collector base URL; the SDK appends <code>/v1/events</code>. Save the key secret as <code>SIGNALS_KEY</code>.</p><CopyBlock code={`export SIGNALS_URL="${baseUrl}"\nexport SIGNALS_KEY="sgk_…"`} /></Panel><Panel title="2. Connect your server" subtitle="Instrument before connecting the MCP transport."><div className="segmented" aria-label="Code language">{['python', 'node', 'curl'].map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'node' ? 'Node.js' : t === 'python' ? 'Python' : 'cURL'}</button>)}</div><CopyBlock code={code} /><p className="hint">Use your existing ASGI app or Express transport setup. For raw HTTP, use a current RFC3339 timestamp and a fresh UUIDv7 for each event.</p></Panel><Panel title="3. Follow the signal" subtitle="Open Overview for trends, or Live to watch events arrive."><p>Events are committed before they are acknowledged. Daily partitions keep storage manageable; summaries update every minute.</p></Panel></div>;
}
