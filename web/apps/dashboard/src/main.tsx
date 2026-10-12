import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { SignalsDashboard, type Project, type Range, type Screen, type User } from '@mcpramen/signals-ui';
import '@fontsource-variable/urbanist';
import '@fontsource/krona-one';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '../../../packages/ui/src/styles.css';
import './shell.css';
import { auth, client } from './client';
import { demoClient, demoProject, truncatedDemoProject } from './demo';

const isDemo = import.meta.env.VITE_DEMO === '1';
const nav: {id:Screen;label:string;description:string}[] = [
 {id:'overview',label:'Overview',description:'The big picture. From first connection to lasting value.'},
 {id:'adoption',label:'Adoption',description:'Who shows up, who comes back, and who you can actually name.'},
 {id:'tools',label:'Tools',description:'Every tool, from discovery to delivery.'},
 {id:'reliability',label:'Reliability',description:'Keep your promises. Know where to look.'},
 {id:'sessions',label:'Sessions',description:'One conversation at a time, replayed in order.'},
 {id:'callers',label:'Callers',description:'The identities behind your server’s activity.'},
 {id:'cost',label:'Cost',description:'What a tool call costs the context window.'},
 {id:'protocol',label:'Protocol',description:'What the handshake agreed, and what nobody is using yet.'},
 {id:'live',label:'Live',description:'Every event, as it happens.'},
 {id:'setup',label:'Setup',description:'Point a server at this project.'},
 {id:'settings',label:'Settings',description:'Targets, alerts and the assumptions behind every number.'},
];
function getScreen():Screen {const value=location.hash.slice(1);return nav.some(n=>n.id===value)?value as Screen:'overview';}
function Logo(){return <span className="brand"><svg  xmlns="http://www.w3.org/2000/svg" viewBox="0 0 925 84" role="img" aria-label="mcpramen"><path fill="#FBC118" d="M0 1H175A87.5 82 0 0 1 0 1Z"/><path fill="currentColor" transform="translate(212.96 74)" d="M10.04 0L10.04-70.40L24.32-70.40L49.91-44.73L75.49-70.40L89.77-70.40L89.77 0L75.49 0L75.49-50.63L49.91-25.99L24.32-50.63L24.32 0L10.04 0ZM107.38-35.63L107.38-35.63Q107.38-43.15 110.21-49.66Q113.05-56.17 118.44-60.96Q123.82-65.76 131.59-68.51Q139.36-71.26 149.18-71.26L149.18-71.26Q157.78-71.26 164.96-69.52Q172.15-67.79 178.32-64.23L178.32-64.23L171.74-53.42Q169.90-54.64 167.49-55.58Q165.08-56.53 162.35-57.18Q159.63-57.83 156.72-58.19Q153.82-58.55 150.98-58.55L150.98-58.55Q144.13-58.55 138.77-56.87Q133.41-55.18 129.74-52.14Q126.07-49.10 124.16-44.88Q122.24-40.67 122.24-35.63L122.24-35.63Q122.24-30.40 124.22-26.03Q126.20-21.67 129.97-18.49Q133.73-15.31 139.15-13.53Q144.58-11.76 151.43-11.76L151.43-11.76Q154.54-11.76 157.60-12.21Q160.66-12.66 163.52-13.44Q166.38-14.23 169.04-15.34Q171.70-16.44 173.99-17.75L173.99-17.75L180.57-6.94Q174.80-3.24 167.24-1.15Q159.67 0.95 151.16 0.95L151.16 0.95Q140.30 0.95 132.11-1.87Q123.91-4.68 118.41-9.62Q112.92-14.55 110.15-21.24Q107.38-27.93 107.38-35.63ZM198.13 0L198.13-70.40L235.25-70.40Q243.36-70.40 249.30-68.64Q255.25-66.89 259.17-63.58Q263.08-60.27 265.00-55.49Q266.91-50.72 266.91-44.73L266.91-44.73Q266.91-39.10 265.02-34.32Q263.13-29.55 259.23-26.06Q255.34-22.57 249.39-20.61Q243.45-18.65 235.34-18.65L235.34-18.65L212.41-18.69L212.41 0L198.13 0ZM212.41-31.03L235.61-31.03Q239.66-31.03 242.70-32.00Q245.74-32.97 247.79-34.75Q249.84-36.53 250.86-39.07Q251.87-41.62 251.87-44.73L251.87-44.73Q251.87-50.99 247.79-54.48Q243.72-57.97 235.61-57.97L235.61-57.97L212.41-57.97L212.41-31.03ZM284.34 0L284.34-70.40L320.15-70.40Q328.26-70.40 334.20-68.71Q340.15-67.02 344.07-63.82Q347.99-60.63 349.90-56.03Q351.81-51.44 351.81-45.63L351.81-45.63Q351.81-41.71 350.87-38.17Q349.92-34.64 347.96-31.66Q346.00-28.69 343.03-26.37Q340.06-24.05 336.05-22.52L336.05-22.52L351.36 0L333.89 0L320.65-20.00L320.24-20.00L298.62-20.04L298.62 0L284.34 0ZM298.62-32.38L320.51-32.38Q324.56-32.38 327.60-33.33Q330.64-34.28 332.69-35.99Q334.74-37.70 335.76-40.15Q336.77-42.61 336.77-45.63L336.77-45.63Q336.77-51.53 332.72-54.75Q328.66-57.97 320.51-57.97L320.51-57.97L298.62-57.97L298.62-32.38ZM361.50 0L394.56-70.40L409.69-70.40L443.74 0L428.74 0L423.11-11.85L381.99-11.85L376.54 0L361.50 0ZM387.44-23.60L417.48-23.60L402.26-55.58L387.44-23.60ZM456.58 0L456.58-70.40L470.86-70.40L496.44-44.73L522.02-70.40L536.30-70.40L536.30 0L522.02 0L522.02-50.63L496.44-25.99L470.86-50.63L470.86 0L456.58 0ZM558.19 0L558.19-70.40L618.14-70.40L618.14-57.88L572.47-57.88L572.47-43.83L612.92-43.83L612.92-32.07L572.47-32.07L572.47-12.48L619.09-12.48L619.09 0L558.19 0ZM636.70 0L636.70-70.40L650.97-70.40L694.84-47.43L694.84-70.40L709.12-70.40L709.12 0L694.84 0L694.84-32.29L650.97-55.13L650.97 0L636.70 0Z"/></svg><span className="brand-separator"/><span className="brand-app">Signals</span></span>;}
function App(){
  const [screen,setScreen]=useState<Screen>(getScreen);
  const navRef=useRef<HTMLElement>(null);

  const [range,setRange]=useState<Range>('7d');
  const [dark,setDark]=useState(()=>localStorage.getItem('signals-theme')==='dark'||(!localStorage.getItem('signals-theme')&&matchMedia('(prefers-color-scheme: dark)').matches));
  const [mobile,setMobile]=useState(false);
  const [account,setAccount]=useState<{user:User;projects:Project[]}|null>(isDemo?{user:{id:'demo',email:'you@northwind.dev',role:'owner'},projects:[demoProject,truncatedDemoProject]}:null);
  useEffect(()=>{const nav=navRef.current;if(!nav)return;let frame=0;let disposed=false;const measure=()=>{if(disposed)return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const active=nav.querySelector<HTMLElement>('[aria-current=page]');const thumb=nav.querySelector<HTMLElement>('.nav-thumb');if(active&&thumb){const left=active.offsetLeft,width=active.offsetWidth;thumb.style.transform=`translateX(${left}px) scaleX(${width})`;}});};const observer=new ResizeObserver(measure);observer.observe(nav);void document.fonts.ready.then(measure);measure();return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();};},[screen,account]);
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
  return <div className="app-shell"><a className="skip-link" href="#main">Skip to content</a>
    <header className="topbar"><div className="topbar-inner"><a className="brand-link" href="#overview" aria-label="mcpramen Signals overview"><Logo/></a><nav ref={navRef} className={mobile?'open':''} aria-label="Primary"><span className="nav-thumb"/>{nav.filter(n=>n.id!=='callers').map(n=><a key={n.id} href={`#${n.id}`} aria-current={screen===n.id?'page':undefined}>{n.label}{n.id==='live'&&<i className="signal-dot"/>}</a>)}</nav><button className="icon-button" aria-label={dark?'Use light theme':'Use dark theme'} onClick={()=>setDark(v=>!v)}>{dark?<Sun size={17}/>:<Moon size={17}/>}</button><button className="icon-button mobile-menu" aria-label={mobile?'Close navigation':'Open navigation'} onClick={()=>setMobile(v=>!v)}>{mobile?<X size={19}/>:<Menu size={19}/>}</button></div></header>
    <main id="main"><div className="workspace-strip"><select aria-label="Select project" value={selected?.id??''} onChange={e=>setProjectId(e.target.value)}>{account.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><span className="demo-badge"><i className="signal-dot"/>{isDemo?'Demo workspace':'Collector connected'}</span>{!isDemo&&<button className="icon-button" aria-label="Log out" onClick={()=>void logout()}><LogOut size={17}/></button>}</div>
      <div className="page-heading"><div><div className="eyebrow">SIGNALS / {selected?.slug??'WORKSPACE'}</div><h1>{current.label}</h1><p>{current.description}</p></div>{!['settings','setup','live'].includes(screen)&&<div className="range-control" aria-label="Time range"><span className="range-thumb" style={{transform:`translateX(${(['24h','7d','30d','90d'].indexOf(range))*100}%)`}}/>{(['24h','7d','30d','90d'] as Range[]).map(r=><button key={r} aria-pressed={range===r} onClick={()=>setRange(r)}>{r==='24h'?'24 hours':r==='7d'?'7 days':r==='30d'?'30 days':'90 days'}</button>)}</div>}</div>
      {selected?<SignalsDashboard key={selected.id} client={isDemo?demoClient:client} project={selected} screen={screen} range={range} onNavigate={navigate} readOnly={account.user.role==='viewer'} onProjectChange={p=>setAccount({...account,projects:account.projects.map(old=>old.id===p.id?p:old)})}/>:<div className="empty-state"><p>Create a project using the Signals CLI to get started.</p></div>}
      <footer className="app-footer"><span>mcpramen / Signals</span><span>Your data. Your infrastructure.</span></footer>
    </main></div>;

}
function Login({onLogin,error}:{onLogin:(a:{user:User;projects:Project[]})=>void;error:string}){
  const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [message,setMessage]=useState(error);const [busy,setBusy]=useState(false);
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setMessage('');try{onLogin(await auth.login(email,password));}catch(e){setMessage(e instanceof Error?e.message:'Could not sign in.');}finally{setBusy(false);}}
  return <main className="login-page"><Logo/><div className="login-card"><span className="eyebrow">WELCOME BACK</span><h1>Follow the signal<span className="heading-dot">.</span></h1><p>Sign in to your MCP observability workspace.</p><form onSubmit={e=>void submit(e)}><label className="field">Email<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label className="field">Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{message&&<p className="form-error" role="alert">{message}</p>}<button className="button" disabled={busy}>{busy?'Signing in…':'Sign in'}<ArrowRight size={16}/></button></form></div><p className="hint">Your events stay on your infrastructure.</p></main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
