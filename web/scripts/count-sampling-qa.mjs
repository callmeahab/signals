import assert from 'node:assert/strict';
import { checkCounts } from './count-sampling.mjs';
const run = ({ frames = [0,50,100,150,200,250,300,350,400,450,500,550,600,650,700], samples = [[0,'0'],[300,'5'],[700,'10']], duration = 640, text = '10' } = {}) => {
 const errors = [];
 checkCounts('sampler unit', { frames, tiles: [{ label:'Calls', start:50, delay:130, duration, target:'10', text }], series:samples.map(([at,text])=>({label:'Calls',at,text})) }, [{label:'Calls',delay:130}], (ok,message)=>{if(!ok)errors.push(message);});
 return errors;
};
assert.deepEqual(run(), []);
assert.deepEqual(run({frames:[0,700],samples:[[700,'10']]}), [], 'late low-fps samples may miss zero and intermediate steps');
assert(run({samples:[[0,'0'],[700,'10']]}).some(e=>e.includes('2 steps')), 'healthy sampling must see a climb');
assert(run({samples:[[0,'1'],[300,'5'],[700,'10']]}).some(e=>e.includes('expected zero')));
assert(run({frames:[0,700],duration:300}).some(e=>e.includes('schedule')));
assert(run({frames:[0,700],samples:[[0,'0'],[300,'9'],[500,'5'],[700,'10']]}).some(e=>e.includes('monotonic')));
assert(run({frames:[0,700],text:'9'}).some(e=>e.includes('terminal')));
console.log('Count sampling guards passed: low fps only relaxes observations, never schedules, monotonicity or terminal values.');
