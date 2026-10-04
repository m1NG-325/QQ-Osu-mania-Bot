import {test} from 'node:test';
import assert from 'node:assert/strict';
import {latestPair,recentScoreCompare} from '../src/score-compare.js';
import {History} from '../src/history.js';
import {Bot} from '../src/bot.js';
const score=(id,day,extra={})=>({id,beatmap:{id:44},ended_at:`2026-10-${day}T10:00:00Z`,...extra});
const user={id:1,username:'Test'};

test('latest pair uses play time, not score order, insertion order or observation time',()=>{
  const input=[score(4,'04',{total_score:100}),score(2,'02',{total_score:500}),score(3,'03'),score(1,'01'),score(4,'04'),score(5,'05',{beatmap:{id:55}}),score(6,'06',{ended_at:'invalid'})];
  assert.deepEqual(latestPair(input,44).map(s=>s.id),[3,4]);
  const h=new History('unused');
  h.rows=input.map(s=>({userId:'1',type:'score',observedAt:'2026-10-07',score:s}));
  assert.deepEqual(h.compare(user,44).scores.map(s=>s.id),[3,4]);
  assert.deepEqual(latestPair([score(1,'01'),score(2,'02',{ended_at:null,created_at:'2026-10-03T10:00:00Z'})],44).map(s=>s.id),[1,2]);
});
test('map comparison refreshes recent plays including failed runs without needing saved history',async()=>{
  const api={user:async()=>user,scores:async(id,type,limit)=>{
    assert.equal(id,1);assert.equal(type,'recent');assert.equal(limit,100);
    return [score(1,'01'),score(3,'03',{passed:false}),score(2,'02')];
  },map:async()=>({id:44,beatmapset:{id:22,title:'Test map'}}),mapScores:async()=>{throw new Error('retained scores should not be needed');}};
  const bot=new Bot({api,bindings:{get:()=> 'Test'},demo:false});
  const result=await bot.run('!对比 44');
  assert.equal(result.source,'recent');assert.deepEqual(result.scores.map(s=>s.id),[2,3]);
  assert.equal(result.scores[1].passed,false);assert.equal(result.scores[1].beatmapset.id,22);
});
test('incomplete recent history is labelled and merges deduplicated retained and saved dates',async()=>{
  const api={scores:async()=>[score(3,'03')],mapScores:async()=>[score(1,'01'),score(2,'02'),score(3,'03')],map:async()=>({id:44})};
  const history={rows:[{userId:'1',type:'score',score:score(4,'04')},{userId:'2',type:'score',score:score(5,'05')}]};
  const result=await recentScoreCompare(api,history,user,44);
  assert.equal(result.source,'available');assert.deepEqual(result.scores.map(s=>s.id),[3,4]);
  await assert.rejects(recentScoreCompare({...api,scores:async()=>[],mapScores:async()=>[]},null,user,44),/不足两条/);
  await assert.rejects(recentScoreCompare({...api,scores:async()=>{throw new Error('API unavailable');}},history,user,44),/API unavailable/);
});
