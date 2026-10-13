import assert from 'node:assert/strict';
import { recordProjectRead, projectStatus } from '../apps/dashboard/src/project-status.ts';
const originalFetch=globalThis.fetch;
const location=Object.getOwnPropertyDescriptor(globalThis,'location');
Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'http://127.0.0.1:23336'}});
try {
 const {request}=await import('../apps/dashboard/src/client.ts');
 const overview='/projects/status-qa/analytics/overview?range=7d';
 recordProjectRead(overview,false,{tiles:{active_users:{value:2}}});
 for(const code of [400,404,429]){
  globalThis.fetch=async()=>globalThis.Response.json({message:'Request rejected'},{status:code});
  await assert.rejects(request('/projects/status-qa'),error=>error.status===code);
  assert.equal(projectStatus('status-qa',false),'healthy','a validation or rate-limit response marked the collector unreachable');
 }
 for(const code of [401,403,500,503]){
  globalThis.fetch=async()=>globalThis.Response.json({message:'Unavailable'},{status:code});
  await assert.rejects(request('/projects/status-qa'),error=>error.status===code);
  assert.equal(projectStatus('status-qa',false),'error');
 }
 globalThis.fetch=async()=>globalThis.Response.json({tiles:{active_users:{value:0}}});
 await request(overview);assert.equal(projectStatus('status-qa',false),'warn');
 globalThis.fetch=async()=>{throw new Error('Network unavailable');};
 await assert.rejects(request('/projects/status-qa'));assert.equal(projectStatus('status-qa',false),'error');
 globalThis.fetch=async()=>globalThis.Response.json({tiles:{active_users:{value:2}}});
 await request(overview);assert.equal(projectStatus('status-qa',false),'healthy');
 assert.equal(projectStatus('status-qa',false,'24h'),'warn');
 console.log('Project status QA passed: existing reads drive active/quiet/error states; validation, missing resources and rate limits do not falsely mark the collector unreachable; auth, server and network failures do; recovery and range scoping work.');
} finally {
 globalThis.fetch=originalFetch;
 if(location)Object.defineProperty(globalThis,'location',location);else delete globalThis.location;
}
