import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowRight, BookOpen, ChevronDown, CircleHelp, Code2, KeyRound, LayoutDashboard, LogOut, Menu, Moon, Radio, Settings2, Sun, Users, X, Zap } from 'lucide-react';
import { SignalsDashboard, type Project, type Range, type Screen, type User } from '@mcpramen/signals-ui';
import '@fontsource-variable/manrope';
import '@fontsource-variable/unbounded';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
// The standalone app also owns the document theme and shell/login controls.
// The package stylesheet is scoped for components embedded in another app.
import '../../../packages/ui/src/styles.css';
import './shell.css';
import { auth, client } from './client';
import { demoClient, demoProject } from './demo';

const isDemo = import.meta.env.VITE_DEMO === '1';
const nav: {id:Screen; label:string; icon:typeof Activity; description:string}[] = [
  {id:'overview',label:'Overview',icon:LayoutDashboard,description:'The pulse of your MCP server.'},
  {id:'tools',label:'Tools',icon:Code2,description:'See what gets called, and how it performs.'},
  {id:'callers',label:'Callers',icon:Users,description:'Get to know the people behind the connections.'},
  {id:'sessions',label:'Sessions',icon:Activity,description:'Follow a connection from hello to goodbye.'},
  {id:'live',label:'Live',icon:Radio,description:'Every event, as it happens.'},
  {id:'settings',label:'Settings',icon:Settings2,description:'Keys, retention, and the settings that make this yours.'},
  {id:'setup',label:'Setup',icon:BookOpen,description:'From a quiet server to your first signal.'},
];
function getScreen():Screen {const value=location.hash.slice(1);return nav.some(n=>n.id===value)?value as Screen:'overview';}
function Logo(){return <span className="brand"><span className="brand-mark"><Activity size={23} strokeWidth={2.5}/></span><span>signals<span className="brand-dot">.</span></span></span>;}
function App(){
  const [screen,setScreen]=useState<Screen>(getScreen);
  const [range,setRange]=useState<Range>('24h');
  const [dark,setDark]=useState(()=>localStorage.getItem('signals-theme')==='dark'||(!localStorage.getItem('signals-theme')&&matchMedia('(prefers-color-scheme: dark)').matches));
  const [mobile,setMobile]=useState(false);
  const [account,setAccount]=useState<{user:User;projects:Project[]}|null>(isDemo?{user:{id:'demo',email:'you@northwind.dev',role:'owner'},projects:[demoProject]}:null);
  const [projectId,setProjectId]=useState('');
  const [ready,setReady]=useState(isDemo);
  const [loginError,setLoginError]=useState('');
  useEffect(()=>{document.documentElement.classList.toggle('dark',dark);localStorage.setItem('signals-theme',dark?'dark':'light');},[dark]);
  useEffect(()=>{const listener=()=>{setScreen(getScreen());setMobile(false);};window.addEventListener('hashchange',listener);return()=>window.removeEventListener('hashchange',listener);},[]);
  useEffect(()=>{if(!isDemo)auth.me().then(setAccount).catch(()=>{}).finally(()=>setReady(true));},[]);
  const navigate=(s:Screen)=>{location.hash=s;setScreen(s);setMobile(false);};
  const selected=account?.projects.find(p=>p.id===projectId)??account?.projects[0];
  async function logout(){try{await auth.logout();setAccount(null);}catch(e){setLoginError(e instanceof Error?e.message:'Could not sign out.');}}
  if(!ready)return <div className="login-page"><Logo/><p>Connecting to Signals…</p></div>;
  if(!account)return <Login onLogin={setAccount} error={loginError}/>;
  const current=nav.find(n=>n.id===screen)!;
  return <div className="app-shell"><a className="skip-link" href="#main">Skip to content</a>{mobile&&<button className="nav-scrim" aria-label="Close navigation" onClick={()=>setMobile(false)}/>}
    <aside className={`sidebar ${mobile?'open':''}`}><div className="sidebar-brand"><Logo/><button className="icon-button mobile-close" aria-label="Close navigation" onClick={()=>setMobile(false)}><X size={20}/></button></div><div className="brand-byline">MCP OBSERVABILITY</div>
      <div className="project-picker"><span className="project-icon"><Zap size={18}/></span><label><span>Project</span><select aria-label="Select project" value={selected?.id??''} onChange={e=>setProjectId(e.target.value)}>{account.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><ChevronDown size={14}/></div>
      <nav aria-label="Primary"><div className="nav-caption">WORKSPACE</div>{nav.slice(0,5).map(n=><a key={n.id} href={`#${n.id}`} aria-current={screen===n.id?'page':undefined}><n.icon size={19}/>{n.label}{n.id==='live'&&<i className="live-dot"/>}</a>)}<div className="nav-divider"/>{nav.slice(5).map(n=><a key={n.id} href={`#${n.id}`} aria-current={screen===n.id?'page':undefined}><n.icon size={19}/>{n.label}</a>)}</nav>
      <div className="sidebar-bottom"><div className="collector-status"><span className="signal-dot"/><div><strong>{isDemo?'Demo workspace':'Collector connected'}</strong><span>{isDemo?'Explore with sample events':'Your data. Your infrastructure.'}</span></div></div><div className="account"><span className="account-avatar">{account.user.email.slice(0,1).toUpperCase()}</span><div><strong>{account.user.email.split('@')[0]}</strong><span>{account.user.role}</span></div><button className="icon-button" aria-label={dark?'Use light theme':'Use dark theme'} onClick={()=>setDark(v=>!v)}>{dark?<Sun size={17}/>:<Moon size={17}/>}</button>{!isDemo&&<button className="icon-button" aria-label="Log out" onClick={()=>void logout()}><LogOut size={17}/></button>}</div></div>
    </aside><div className="main-shell"><header className="topbar"><div><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={()=>setMobile(true)}><Menu size={20}/></button><span className="breadcrumb">Workspace<span>/</span><strong>{current.label}</strong></span></div><div className="topbar-right">{isDemo&&<span className="demo-badge">Demo data</span>}<button className="icon-button" aria-label="Open setup guide" onClick={()=>navigate('setup')}><CircleHelp size={19}/></button></div></header>
      <main id="main"><div className="page-heading"><div><div className="eyebrow"><span className="signal-dot"/>SIGNALS / {selected?.slug??'WORKSPACE'}</div><h1>{current.label}<span className="heading-dot">.</span></h1><p>{current.description}</p></div>{['overview','tools','callers'].includes(screen)&&<div className="range-control" aria-label="Time range">{(['24h','7d','30d'] as Range[]).map(r=><button key={r} aria-pressed={range===r} onClick={()=>setRange(r)}>{r==='24h'?'24 hours':r==='7d'?'7 days':'30 days'}</button>)}</div>}{screen==='overview'&&<button className="button secondary live-button" onClick={()=>navigate('live')}><Radio size={16}/>Go live<ArrowRight size={15}/></button>}</div>
        {selected?<SignalsDashboard key={selected.id} client={isDemo?demoClient:client} project={selected} screen={screen} range={range} onNavigate={navigate} readOnly={account.user.role==='viewer'} onProjectChange={p=>setAccount({...account,projects:account.projects.map(old=>old.id===p.id?p:old)})}/>:<div className="empty-state"><KeyRound size={32}/><h2>No projects yet</h2><p>Create a project using the Signals CLI or admin API, then refresh this page.</p></div>}
        <footer className="app-footer"><span>Keep an eye on the signal.</span><span>Signals v0.1 <span>·</span> Self hosted</span></footer>
      </main></div></div>;
}
function Login({onLogin,error}:{onLogin:(a:{user:User;projects:Project[]})=>void;error:string}){
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [message,setMessage]=useState(error);const [busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');try{onLogin(await auth.login(email,password));}catch(e){setMessage(e instanceof Error?e.message:'Could not sign in.');}finally{setBusy(false);}}
  return <main className="login-page"><Logo/><div className="login-card"><span className="eyebrow">WELCOME BACK</span><h1>Follow the signal<span className="heading-dot">.</span></h1><p>Sign in to your MCP observability workspace.</p><form onSubmit={e=>void submit(e)}><label className="field">Email<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="field">Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{message&&<p className="form-error" role="alert">{message}</p>}<button className="button" disabled={busy}>{busy?'Signing in…':'Sign in'}<ArrowRight size={16}/></button></form></div><p className="hint">Your events stay on your infrastructure.</p></main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
