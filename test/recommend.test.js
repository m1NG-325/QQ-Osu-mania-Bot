import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendMaps, recommendations } from '../src/recommend.js';
import { parseCommand, Bot } from '../src/bot.js';
import { OsuApi } from '../src/osu.js';
import { cardSvg } from '../src/cards.js';

const row=(id,extra={})=>({beatmapId:id,beatmapsetId:1000+id,title:'A & B',version:'4K',keys:4,status:'ranked',stars:5,
  speedBucket:'normal',recommendedMods:[],reason:'missing',estimatedPpGain:10,benchmarkPp:310,
  subjectPp:null,peerCount:12,peerSampleSize:100,bpm:180,lengthSec:120,...extra});
const snapshot=recs=>({status:'ready',userId:1,peerBand:{count:100},totalQualifying:recs.length,recs});
const apiFor=recs=>({recommendationSnapshot:async()=>snapshot(recs),rawMap:async()=>''});
const options={difficulty:async()=>4};

test('recommend supports binding and spaced names', async()=>{
  assert.deepEqual(parseCommand('！推荐 mugen neko'),{action:'recommend',argument:'mugen neko'});
  assert.equal(parseCommand('!推荐曲'),null);
  await assert.rejects(new Bot({api:{},bindings:{get:()=>null}}).run('!推荐'),/bind/);
});

test('peer recommendations mix Mods, distinguish lanes, rank weighted gain and exclude unsafe candidates',async()=>{
  const rows=[row(1),row(1,{speedBucket:'ht',recommendedMods:['HT'],reason:'improve',subjectPp:300,estimatedPpGain:25}),
    row(2,{clearRisk:true,estimatedPpGain:99}),row(3,{estimatedPpGain:0}),row(4,{status:'loved'}),
    ...Array.from({length:8},(_,i)=>row(i+10)),row(1)];
  const result=await recommendMaps(apiFor(rows),{id:1,username:'A & B'},[],options);
  assert.equal(result.items.length,6);
  assert.equal(result.items[0].gain,25);assert.deepEqual(result.items[0].mods,['HT']);
  assert.ok(result.items.some(item=>item.map.id===1&&!item.mods.length));
  assert.ok(!result.items.some(item=>[2,3,4].includes(item.map.id)));
  assert.equal(result.items[0].pp,310);assert.equal(result.items[0].accuracy,null);
  const svg=cardSvg(result);assert.match(svg,/A &amp; B/);assert.match(svg,/WEIGHTED GAIN/);
  assert.match(svg,/not additive/);assert.ok(!svg.includes('NaN'));
});

test('unavailable difficulty is left blank; bad identity, pending data and empty results do not invent recommendations',async()=>{
  const result=await recommendMaps(apiFor([row(1)]),{id:1},[],{difficulty:async()=>{throw Error('offline');}});
  assert.equal(result.items[0].stars,null);
  assert.match(cardSvg(result),/No BP/);
  await assert.rejects(recommendMaps(apiFor([]),{id:1}),/没有可信/);
  await assert.rejects(recommendMaps(apiFor([row(1)]),{id:2}),/不一致/);
  await assert.rejects(recommendMaps({recommendationSnapshot:async()=>({userId:1,status:'loading'})},{id:1}),/尚未准备/);
});

test('public peer endpoint receives no osu credentials, and service errors are user-facing',async()=>{
  const api=new OsuApi({clientSecret:'private',fetchImpl:async(url,init)=>{
    assert.match(url,/^https:\/\/api.mania-tracker.com\/api\/snapshots\/farm-helper\?user=1/);
    assert.equal(init.headers.Authorization,undefined);
    return new Response(JSON.stringify(snapshot([row(1)])));
  }});
  assert.equal((await api.recommendationSnapshot(1)).userId,1);
  await assert.rejects(api.recommendationSnapshot('../1'),/无效/);
  const offline=new OsuApi({fetchImpl:async()=>new Response('',{status:503})});
  await assert.rejects(offline.recommendationSnapshot(1),/暂时不可用/);
});

test('failed peer lookup is not cached',async()=>{
  let calls=0;
  const api={recommendationSnapshot:async()=>{calls++;throw Error('offline');}};
  await assert.rejects(recommendations(api,{id:1}));await assert.rejects(recommendations(api,{id:1}));
  assert.equal(calls,2);
});
