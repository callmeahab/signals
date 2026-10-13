import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
const out='artifacts/v6';mkdirSync(out,{recursive:true});
const manifests=[];
for(let run=1;run<=4;run++){
 if(!(run===1&&process.env.STATIC_BASELINE==='1')){
 const child=spawn(process.execPath,['scripts/visual-qa.mjs'],{stdio:'inherit',env:process.env});
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
 assert.equal(code,0,`static run ${run}: visual gate failed`);
 }
 const hashes=Object.fromEntries(readdirSync('artifacts/v3').filter(name=>name.endsWith('.png')).sort().map(name=>[name,createHash('sha256').update(readFileSync(`artifacts/v3/${name}`)).digest('hex')]));
 writeFileSync(`${out}/static-${run}.json`,JSON.stringify(hashes,null,2));manifests.push(hashes);
 if(run>1)assert.deepEqual(hashes,manifests[0],`static run ${run} differs`);
 console.log(`Static capture run ${run}: ${Object.keys(hashes).length} PNGs${run>1?' byte-identical to run 1':''}.`);
}
console.log('Four serial static capture runs passed, including the full contrast/clip and unmasked drawer gates.');
