"use client";
import { useState } from 'react';
import { SignalsDashboard, type Screen, type Project } from '@mcpramen/signals-ui';
import { demoClient, demoProject } from './fixture';
const screens:Screen[]=['overview','tools','callers','sessions','live','settings','setup'];
export default function Page(){const [screen,setScreen]=useState<Screen>('overview');const [project,setProject]=useState<Project>(demoProject);return <><nav className="host-screen-controls">{screens.map(s=><button key={s} onClick={()=>setScreen(s)}>{s}</button>)}</nav><SignalsDashboard client={demoClient} project={project} screen={screen} range="24h" onNavigate={setScreen} onProjectChange={setProject}/></>;}
