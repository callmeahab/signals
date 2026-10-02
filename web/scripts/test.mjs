import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const port=Number(process.env.SIGNALS_TEST_UI_PORT??3330);
const base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','apps/dashboard/vite.config.ts','--host','127.0.0.1','--port',String(port)],{env:{...process.env,VITE_DEMO:'1'},stdio:'pipe'});
server.stdout.on('data',data=>process.stdout.write(data));server.stderr.on('data',data=>process.stderr.write(data));
try {
  let ready=false;for(let n=0;n<100;n++){if(server.exitCode!==null)throw new Error('Test Vite server exited');try{ready=(await globalThis.fetch(base)).ok;}catch{ready=false;}if(ready)break;await delay(100);}if(!ready)throw new Error('Test UI server did not start');
  const test=spawn(process.execPath,['scripts/visual-qa.mjs'],{stdio:'inherit',env:{...process.env,BASE_URL:base}});
  const status=await new Promise((resolve,reject)=>{test.on('error',reject);test.on('exit',resolve);});if(status!==0)throw new Error(`Browser checks failed (${status})`);
}finally{server.kill('SIGTERM');}
