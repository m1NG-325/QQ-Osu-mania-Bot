import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {zipSync} from 'fflate';
import {setTimeout as delay} from 'node:timers/promises';
import {Bot} from '../src/bot.js';
import {History} from '../src/history.js';
import {Lane,SenderQueue,renderLane,analysisLane,queryBudget,timedWork} from '../src/runtime.js';
import {QueryService} from '../src/query-service.js';
import {recommendMaps} from '../src/recommend.js';
import {analyzeText} from '../src/compute.js';
import {renderCard} from '../src/cards.js';
import {DemoApi} from '../src/demo.js';
import {helpContent} from '../src/help.js';
const root=fileURLToPath(new URL('../',import.meta.url));

test('malformed ZIP64 rejects in bounded worker without blocking the caller',()=>{
  const zip=Buffer.from(zipSync({'a.mp3':Buffer.from('audio')}));
  const central=zip.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));zip.writeUInt32LE(0xffffffff,central+20);
  const end=zip.length-22,zip64=Buffer.alloc(56),locator=Buffer.alloc(20),eocd=Buffer.from(zip.subarray(end));
  zip64.writeUInt32LE(0x06064b50,0);zip64.writeBigUInt64LE(44n,4);zip64.writeUInt32LE(1,32);zip64.writeUInt32LE(1,40);zip64.writeUInt32LE(central,48);
  locator.writeUInt32LE(0x07064b50,0);locator.writeUInt32LE(end,8);locator.writeUInt32LE(1,16);
  eocd.writeUInt16LE(65535,8);eocd.writeUInt16LE(65535,10);eocd.writeUInt32LE(0xffffffff,16);
  const malformed=Buffer.concat([zip.subarray(0,end),zip64,locator,eocd]);
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict';import {extractAudio} from './src/audio.js'; await assert.rejects(extractAudio(Buffer.from('${malformed.toString('base64')}','base64'),'a.mp3'));`],{cwd:root,timeout:5000,encoding:'utf8',windowsHide:true});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);
});

test('slow binding then unbinding preserves order while other senders progress',async()=>{
  let bound,release;const started=Promise.withResolvers();
  const bindings={get:()=>bound,set:async(_,id)=>bound=id,remove:async()=>bound=undefined};
  const bot=new Bot({api:{user:async()=>{started.resolve();await new Promise(r=>release=r);return {id:1,username:'Test'};}},bindings});
  const bind=bot.run('!bind Test','qq:a');await started.promise;
  const unbind=bot.run('!unbind','qq:a');
  assert.equal((await bot.run('!help','qq:b')).kind,'help');release();await bind;await unbind;
  assert.equal(bound,undefined);await delay(0);assert.equal(bot.senders.lanes.size,0);
});

test('ordered query service computes the cache key after the preceding binding',async()=>{
  let target='Old';const bindings={get:()=>target,set:async(_,id)=>target=id,remove:async()=>{}};
  const seen=[];const api={user:async name=>{seen.push(name);return {id:['New','2'].includes(name)?'2':'1',username:name};},scores:async()=>[]};
  const service=new QueryService({bot:new Bot({api,bindings}),bindings});
  await service.run('!i','qq:a');
  const bind=service.run('!bind New','qq:a'),query=service.run('!i','qq:a');
  await bind;const result=await query;assert.equal(result.user.id,'2');
  // The newly bound API identifier was actually looked up, not a cached Old result.
  assert.deepEqual(seen,['Old','New','2']);
});

test('cancelled queued work never runs later and active slots remain occupied',async()=>{
  const lane=new Lane(1);let release,called=false;
  const held=lane.run(()=>new Promise(r=>release=r));await delay(0);
  await assert.rejects(timedWork(signal=>lane.run(()=>called=true,{signal}),5),/时限/);
  assert.equal(lane.waiting.length,0);assert.equal(lane.active,1);
  release();await held;await delay(0);assert.equal(called,false);assert.equal(lane.active,0);
});

test('cancelling a slow bind prevents late persistence after the caller times out',async()=>{
  let persisted=false,release;const started=Promise.withResolvers();
  const bot=new Bot({api:{user:async()=>{started.resolve();await new Promise(r=>release=r);return {id:1,username:'Test'};}},bindings:{get:()=>null,set:async()=>persisted=true}});
  const controller=new AbortController();
  const bind=bot.run('!bind Test','qq:a',{signal:controller.signal});await started.promise;controller.abort();release();
  await assert.rejects(bind,/取消/);assert.equal(persisted,false);
});

test('audio survives a slow first download within its larger action budget',async()=>{
  const service=new QueryService({bot:{run:async()=>{await delay(60);return {kind:'audio',name:'test.mp3'};}},bindings:{get:()=>null},budget:action=>queryBudget(action)/1000});
  assert.equal((await service.run('!au 1')).kind,'audio');
  await assert.rejects(service.run('!help'),/时限/);
});

test('recording preferences and saved rows are isolated by sender and persist',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'mania-release-history-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'history.json'),history=await new History(path).load(),user={id:1,username:'Test'};
  const result={user,scores:[{id:1,beatmap:{id:3},ended_at:new Date().toISOString()}]};
  await history.toggle('qq:a',false);await history.capture(result,'qq:a');await history.capture(result,'qq:b');
  assert.equal(history.report(user,7,'qq:a').scores.length,0);assert.equal(history.report(user,7,'qq:b').scores.length,1);
  await history.toggle('qq:b',true);const loaded=await new History(path).load();
  assert.equal(loaded.isEnabled('qq:a',user),false);assert.equal(loaded.isEnabled('qq:b',user),true);
  assert.equal(loaded.records(user,'local').length,0);
});

test('recommendations share the same two-worker budget as other analysis',async()=>{
  const api=new DemoApi();const raw=await api.rawMap();api.rawMap=async()=>raw;
  let peak=0;const timer=setInterval(()=>peak=Math.max(peak,analysisLane.active),1);
  try {await Promise.all([recommendMaps(api,await api.user('A')),recommendMaps(api,await api.user('B')),analyzeText(raw,{detailed:false})]);}
  finally{clearInterval(timer);}
  assert.equal(peak,2);await delay(0);assert.equal(analysisLane.active,0);
});

test('rendering respects the shared two-slot lane and cancels queued renders',async()=>{
  let releaseA,releaseB;
  const a=renderLane.run(()=>new Promise(r=>releaseA=r)),b=renderLane.run(()=>new Promise(r=>releaseB=r));await delay(0);
  await assert.rejects(timedWork(signal=>renderCard({kind:'help',...helpContent(true),demo:true},{signal}),5),/时限/);
  assert.equal(renderLane.active,2);assert.equal(renderLane.waiting.length,0);
  releaseA();releaseB();await Promise.all([a,b]);await delay(0);
  const image=await renderCard({kind:'help',...helpContent(true),demo:true});assert.ok(image.length>1000);
});

test('custom background configuration affects the rendered pixels in a fresh process',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'mania-release-art-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'background.svg');await writeFile(path,'<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1200"><rect width="1920" height="1200" fill="#ff0000"/></svg>');
  const source=`import {renderCard} from './src/cards.js';import {helpContent} from './src/help.js';import sharp from 'sharp';const b=await renderCard({kind:'help',...helpContent(true),demo:true});const p=await sharp(b).extract({left:1000,top:20,width:1,height:1}).raw().toBuffer();console.log(JSON.stringify([...p]));`;
  const run=env=>spawnSync(process.execPath,['--input-type=module','-e',source],{cwd:root,env:{...process.env,...env},timeout:15000,encoding:'utf8',windowsHide:true});
  const normal=run({PANEL_BACKGROUND_PATH:''}),custom=run({PANEL_BACKGROUND_PATH:path});
  assert.equal(normal.status,0,normal.stderr);assert.equal(custom.status,0,custom.stderr);assert.notEqual(normal.stdout,custom.stdout);
});
