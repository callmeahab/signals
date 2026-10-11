import { spawn, spawnSync } from 'node:child_process';
import { cp, copyFile, mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const run=(cmd,args,cwd)=>{const result=spawnSync(cmd,args,{cwd,stdio:'inherit',env:process.env});if(result.status!==0)throw new Error(`${cmd} exited ${result.status}`);};
const port=Number(process.env.SIGNALS_NEXT_PORT??23331);
const fixture=resolve('../examples/next-host');
const scratch=resolve('artifacts/next-host');await mkdir(scratch,{recursive:true});
const pack=await mkdtemp(join(scratch,'signals-ui-pack-'));
const host=join(pack,'host');
const tarball=join(pack,'signals-ui.tgz');
try {
run('bun',['run','build:ui'],process.cwd());
run('bun',['pm','pack','--filename',tarball],resolve('packages/ui'));
await mkdir(host);
await cp(join(fixture,'app'),join(host,'app'),{recursive:true});
for(const file of ['package.json','bun.lock','next.config.mjs','tsconfig.json'])await copyFile(join(fixture,file),join(host,file));
const manifest=JSON.parse(await readFile(join(host,'package.json'),'utf8'));
manifest.dependencies['@mcpramen/signals-ui']=`file:${tarball}`;
await writeFile(join(host,'package.json'),JSON.stringify(manifest,null,2)+'\n');
run('bun',['install','--lockfile-only'],host);
run('bun',['install','--frozen-lockfile'],host);
run('bun',['run','build'],host);
const server=spawn(process.execPath,[join(host,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{cwd:host,stdio:'inherit'});
try{let ready=false;for(let n=0;n<100;n++){if(server.exitCode!==null)throw new Error('Next host exited');try{ready=(await globalThis.fetch(`http://127.0.0.1:${port}`)).ok;}catch{ready=false;}if(ready)break;await delay(100);}if(!ready)throw new Error('Next host not ready');process.env.SIGNALS_NEXT_URL=`http://127.0.0.1:${port}`;run(process.execPath,['scripts/next-host-qa.mjs'],process.cwd());}finally{server.kill('SIGTERM');await new Promise(resolve=>{if(server.exitCode!==null)return resolve();server.once('exit',resolve);});}

} finally { await rm(pack,{recursive:true,force:true}); }
