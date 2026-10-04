import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Lane,ResultCache,deadline,safeError} from '../src/runtime.js';
import {Bindings} from '../src/store.js';
import {History} from '../src/history.js';
import {beatmapView,viewArguments,beatmapViewSvg} from '../src/beatmap-view.js';
import {DemoApi,demoUser,demoScores} from '../src/demo.js';
import {compareSvg,reportSvg} from '../src/review-cards.js';
import {setTimeout as delay} from 'node:timers/promises';

test('blocked heavy work does not block normal lane and capacity holds across timeouts',async()=>{
  const heavy=new Lane(1),normal=new Lane(2);let release;
  const work=heavy.run(()=>new Promise(resolve=>{release=resolve;}));
  await delay(0);assert.equal(await normal.run(()=>42),42);
  await assert.rejects(deadline(work,5),/时限/);assert.equal(heavy.active,1);
  release();await work;await delay(0);assert.equal(heavy.active,0);
});
test('shared results deduplicate, expire, stay within bytes and prevent mutation leakage',async()=>{
  const cache=new ResultCache({ttl:5,maxBytes:40});let calls=0;
  const work=async()=>{calls++;await delay(1);return {n:1};};
  const [a,b]=await Promise.all([cache.get('same',work),cache.get('same',work)]);
  a.n=99;assert.equal(b.n,1);assert.equal(calls,1);
  await delay(7);await cache.get('same',work);assert.equal(calls,2);
  await cache.get('big',()=>({n:'x'.repeat(100)}));assert.ok(cache.bytes<=40);
});
test('corrupt binding primary is recovered without overwriting good backup',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mania-review-')),path=join(dir,'bindings.json');
  const store=await new Bindings(path,'demo').load();await store.set('a','10001');await store.set('b','10002');
  await writeFile(path,'corrupt');const recovered=await new Bindings(path,'demo').load();
  assert.equal(recovered.get('a'),'10001');await recovered.set('c','10003');
  assert.equal(JSON.parse(await readFile(path+'.bak1','utf8'))['demo:a'],'10001');
});
test('view range clips holds, zoom changes geometry, rate changes time labels and SV stays explicit',async()=>{
  const raw=(await new DemoApi().rawMap()).replace('0,333.333,4','0,333.333,4');
  const args=viewArguments('100001 0:01-0:05 x1.5 z2 sv'),v=beatmapView(raw,args);
  assert.equal(v.laneWidth,28);assert.equal(v.beatsPerStrip,8);assert.equal(v.rate,1.5);
  assert.ok(v.notes.every(n=>n.time>=1000&&n.end<=5000));
  assert.throws(()=>viewArguments('1 0:40-0:20'),/晚于/);assert.throws(()=>viewArguments('1 z4'),/支持/);
  const svg=beatmapViewSvg({view:v,map:{id:1},queriedAt:new Date().toISOString()});assert.ok(!svg.includes('NaN'));
});
test('history defaults on, deduplicates, persists and compares only same-map observations',async()=>{
  const path=join(await mkdtemp(join(tmpdir(),'mania-history-')),'history.json'),h=await new History(path).load();
  const one={...demoScores[0],id:1,beatmap:{id:44}},two={...one,id:2,accuracy:.995};
  await h.capture({user:demoUser,scores:[one]});assert.equal(h.rows.filter(r=>r.type==='score').length,1);
  await h.toggle('local',true);await h.capture({user:demoUser,scores:[one]});await h.capture({user:demoUser,scores:[one,two]});
  const loaded=await new History(path).load();assert.equal(loaded.compare(demoUser,44).scores.length,2);assert.equal(loaded.report(demoUser,7).scores.length,2);
  assert.throws(()=>loaded.compare(demoUser,99),/两次/);
  await loaded.toggle('local',false);await loaded.capture({user:demoUser,scores:[{...two,id:3}]});assert.equal(loaded.report(demoUser,7).scores.length,2);
  const closed=await new History(path).load();await closed.capture({user:demoUser,scores:[{...two,id:3}]});assert.equal(closed.report(demoUser,7).scores.length,2);
  await closed.toggle('local',true);await closed.capture({user:demoUser,scores:[{...two,id:3}]});assert.equal(closed.report(demoUser,7).scores.length,3);
});
test('comparison and empty report explain missing data, and logs reject credential content',()=>{
  const svg=compareSvg({user:demoUser,scores:[{...demoScores[0],pp:null},demoScores[1]]});
  assert.ok(svg.includes('同条件提升'));assert.ok(!svg.includes('NaN'));
  assert.match(reportSvg({user:demoUser,days:7,profiles:[],scores:[]}),/尚无记录/);
  assert.deepEqual(safeError({name:'Error',code:'ENETDOWN',message:'Bearer secret'}),{name:'Error',code:'ENETDOWN'});
});

test('old history migration preserves opted-out recorded users and enables new users by default',async()=>{
  const path=join(await mkdtemp(join(tmpdir(),'mania-history-migrate-')),'history.json');
  const score={...demoScores[0],id:31};
  await writeFile(path,JSON.stringify({enabled:['2'],rows:[{userId:'1',type:'score',score,observedAt:new Date().toISOString()}]}));
  const h=await new History(path).load();
  assert.equal(h.report({id:1},7).recordingEnabled,false);
  await h.capture({user:{id:1},scores:[{...score,id:32}]});assert.equal(h.rows.length,1);
  await h.capture({user:{id:3},scores:[{...score,id:33}]});assert.equal(h.report({id:3},7).scores.length,1);
  const loaded=await new History(path).load();assert.equal(loaded.report({id:1},7).recordingEnabled,false);
  assert.equal(loaded.report({id:3},7).recordingEnabled,true);
});

test('score comparison colours improvements and regressions and accepts help artwork',()=>{
  const old={accuracy:.95,pp:100,max_combo:300,statistics:{perfect:100,great:50,good:20,ok:10,meh:5,miss:3}};
  const current={accuracy:.96,pp:90,max_combo:400,statistics:{perfect:110,great:40,good:15,ok:8,meh:5,miss:6}};
  const svg=compareSvg({user:demoUser,scores:[old,current],assets:{art:{data:'data:image/png;base64,TEST'}}});
  assert.match(svg,/href="data:image\/png;base64,TEST"/);
  assert.match(svg,/fill="#94ddcd"[^>]*>\+1%<\/text>/);
  assert.match(svg,/fill="#f39aaf"[^>]*>-10 pp<\/text>/);
  assert.match(svg,/fill="#f39aaf"[^>]*>\+3<\/text>/);
  assert.match(svg,/fill="#94ddcd"[^>]*>-5<\/text>/);
  assert.ok(!svg.includes('百分点'));
  const missing=compareSvg({user:demoUser,scores:[{...old,pp:null},current]});
  assert.ok(!missing.includes('NaN'));assert.ok(!missing.includes('— pp'));
});
