import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Bot} from '../src/bot.js';
import {DemoApi,demoMap,demoScores} from '../src/demo.js';
import {MapIndex,filters} from '../src/map-index.js';
import {modsKey,comparePlayers} from '../src/features.js';
import {renderCard,cardSvg} from '../src/cards.js';
import sharp from 'sharp';

test('own map scores use binding, distinguish speed settings, preserve missing scores and API errors',async()=>{
  const api=new DemoApi(),bot=new Bot({api,bindings:{get:()=> '10001'}});
  const calls=[];api.mapScores=async(m,u)=>{calls.push([m,u]);return demoScores.slice(0,2);};
  const r=await bot.run('！我的成绩 123');assert.equal(r.kind,'feature');assert.equal(r.rows.length,2);assert.deepEqual(calls,[[123,10001]]);assert.match(r.notes[0],/不等于完整/);
  assert.notEqual(modsKey({mods:[{acronym:'DT',settings:{speed_change:1.2}}]}),modsKey({mods:[{acronym:'DT',settings:{speed_change:1.5}}]}));
  api.mapScores=async()=>[];assert.equal((await bot.run('!我的成绩 123')).kind,'text');
  api.mapScores=async()=>{throw new Error('API unavailable');};await assert.rejects(bot.run('!我的成绩 123'),/API unavailable/);
});
test('group board queries only current members, includes all bindings and excludes failed plays',async()=>{
  const api=new DemoApi(),calls=[],bindings=new Map(Array.from({length:13},(_,i)=>[`qq:${i+1}`,String(100+i)]));
  bindings.set('qq:999','999');api.user=async id=>({id,username:'Player '+id});
  api.mapScores=async(m,id)=>{calls.push(id);return [{...demoScores[0],total_score:Number(id)*100},{...demoScores[1],total_score:9999999,passed:false}];};
  const bot=new Bot({api,bindings}),context={groupId:'42',members:Array.from({length:13},(_,i)=>({user_id:i+1}))};
  const r=await bot.run('!群榜 123','qq:1',context);assert.equal(calls.length,13);assert.ok(!calls.includes('999'));assert.equal(r.rows.length,13);assert.equal(r.rows[0][2],'11,200');
  await assert.rejects(bot.run('!群榜 123'),/群内/);
  api.mapScores=async()=>[{...demoScores[0],mods:[]},{...demoScores[1],mods:['HT']}];
  assert.equal((await bot.run('!群榜 123 mods','qq:1',context)).rows.length,26);
  api.mapScores=async()=>Array.from({length:5},(_,i)=>({...demoScores[i],mods:[{acronym:'DT',settings:{speed_change:1+i*.1}}]}));
  const limited=await bot.run('!群榜 123 mods','qq:1',context);
  assert.equal(limited.rows.length,50);assert.equal(limited.rows[49][0],'#50');assert.match(limited.notes.at(-1),/65.*50/);
  assert.deepEqual(limited.columns,['名次','玩家','分数','准确率','PP']);assert.match(limited.rows[0][3],/\(Stable\)/);
  const svg=cardSvg({...limited,assets:{cover:{data:'data:image/png;base64,AAAA'},player100:{data:'data:image/png;base64,BBBB'}}});
  assert.ok(!svg.includes('综合榜'));assert.match(svg,/player-clip-/);assert.match(svg,/href="data:image\/png;base64,BBBB"/);
});

test('own score card limits sorted records to 20, separates combo before score and uses map artwork with evenly spaced compact columns',async()=>{
  const api=new DemoApi(),bot=new Bot({api,bindings:{get:()=> '10001'}});
  api.mapScores=async()=>Array.from({length:25},(_,i)=>({...demoScores[0],total_score:1000+i,max_combo:200+i}));
  const r=await bot.run('!我的成绩 123');
  assert.equal(r.rows.length,20);assert.equal(r.scores.length,20);assert.equal(r.rows[0][6],'1,024');assert.equal(r.rows[0][5],'224×');
  assert.deepEqual(r.columns,['#','Mods','客户端','准确率','PP','连击','分数']);assert.match(r.notes[0],/25.*20/);
  const svg=cardSvg({...r,assets:{cover:{data:'data:image/png;base64,AAAA'}}});
  assert.match(svg,/href="data:image\/png;base64,AAAA"/);assert.match(svg,/feature-blur/);
  assert.match(svg,/x="286" y="294"[^>]*>Lazer<\/text>/);
  const headers=[...svg.matchAll(/<text x="([\d.]+)" y="234"/g)].map(m=>Number(m[1]));
  for(let i=3;i<headers.length;i++)assert.ok(Math.abs((headers[i]-headers[i-1])-222.4)<1e-6);
  const info=await sharp(await renderCard(r)).metadata();assert.equal(info.width,1440);
});
test('profile compare accepts quoted names and numeric IDs; mapset suppresses disabled download',async()=>{
  const api=new DemoApi(),bot=new Bot({api,bindings:{get:()=>null}});
  const r=await bot.run('!对比 "Demo Player" Other');assert.deepEqual(r.columns,['项目','Demo Player','Other']);assert.equal(r.rows.length,9);
  assert.deepEqual(comparePlayers('（Demo Player） (Other Player) ExamplePlayer'),['Demo Player','Other Player','ExamplePlayer']);
  assert.deepEqual(comparePlayers('（Demo Player）（Other Player）'),['Demo Player','Other Player']);
  assert.deepEqual((await bot.run('！对比 （Demo Player） (Other Player)')).columns,['项目','Demo Player','Other Player']);
  assert.throws(()=>comparePlayers('（Demo Player'),/未闭合/);assert.throws(()=>comparePlayers('（） ExamplePlayer'),/填写玩家名/);
  assert.equal((await bot.run('!对比 10001 10002')).kind,'feature');
  const set=await api.mapset(10000);
  api.mapset=async()=>({...set,id:2559951});
  assert.deepEqual((await bot.run('!谱包 123')).links,[
    'https://osu.ppy.sh/beatmapsets/2559951','https://catboy.best/d/2559951',
    'https://osu.direct/api/d/2559951','https://txy1.sayobot.cn/beatmaps/download/novideo/2559951'
  ]);
  api.mapset=async()=>({...set,availability:{download_disabled:true}});
  const maps=await bot.run('!谱包 123');assert.equal(maps.rows.length,6);assert.equal(maps.links.length,1);
  const metadata=await sharp(await renderCard(r)).metadata();assert.equal(metadata.width,1920);assert.ok(metadata.height>1000);
});
test('practice index persists actual classification, filters every bound and excludes modified analyses',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'mania-index-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'index.json'),index=await new MapIndex(path).load();
  await index.add(demoMap,{rate:1,length:168,lnRatio:.1,patternSummary:[['Jack',30],['Stream',70]]});
  await index.add({...demoMap,id:2},{rate:1.5,length:100,lnRatio:0,patternSummary:[]});assert.equal(index.rows.size,1);
  const loaded=await new MapIndex(path).load(),api={searchMaps:async()=>[]};
  assert.equal((await loaded.pick(api,filters('jack 4k 5-6星 100-200秒 LN0-20%',true))).map.id,demoMap.id);
  await assert.rejects(loaded.pick(api,filters('7k 5-6星')),/没有符合/);
  for(const s of ['4k 6-5星','LN0-101%','3k','60-20秒'])assert.throws(()=>filters(s));
});

test('comparison shows signed differences, handles lower ranks and avoids cross-country ranking comparisons',async()=>{
  const api=new DemoApi(),get=api.user.bind(api);
  api.user=async name=>{const user=await get(name),left=name==='Left';return {...user,country_code:left?'CN':'HK',statistics:{...user.statistics,pp:left?1000:1200,global_rank:left?500:400,hit_accuracy:left?98:97.5}};};
  const bot=new Bot({api,bindings:{get:()=>null}}),r=await bot.run('!对比 Left Right');
  assert.equal(r.rows[0][1],'1,000 pp');assert.equal(r.rows[1][1],'#500');
  const svg=cardSvg(r);assert.match(svg,/\+200 pp/);assert.match(svg,/−100 名/);assert.match(svg,/−0.5%/);assert.match(svg,/不同地区/);assert.ok(!svg.includes('NaN'));
  assert.match(svg,/fill="#91dfcc" fill-opacity=".12"/);assert.match(svg,/fill="#8fbaff" fill-opacity=".12"/);
  const four=await bot.run('!对比 Left Right Third Fourth');assert.equal(four.users.length,4);
  const info=await sharp(await renderCard(four)).metadata();assert.equal(info.width,1920);assert.ok(!cardSvg(four).includes('差值（右'));
});
