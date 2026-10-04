import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoApi } from '../src/demo.js';
import { Bot } from '../src/bot.js';
import { modStars, mapPerformance } from '../src/difficulty.js';
import { cardSvg } from '../src/cards.js';

test('full-map difficulty responds to DT, HT and custom speeds', async () => {
  const raw=await new DemoApi().rawMap();
  const nm=await modStars(raw,{mods:[]});
  const dt=await modStars(raw,{mods:['DT']});
  const ht=await modStars(raw,{mods:['HT']});
  const custom=await modStars(raw,{mods:[{acronym:'DT',settings:{speed_change:1.75}}]});
  assert.ok(ht < nm && nm < dt && dt < custom);
  assert.equal(await modStars(raw,{mods:['NC']}),dt);
});

test('map PP estimates decrease with accuracy and retain unavailable metadata', async () => {
  const api=new DemoApi();
  const values=await mapPerformance(await api.rawMap());
  assert.deepEqual(values.map(v=>v.accuracy),[100,99,98,96]);
  assert.ok(values.every(v=>Number.isFinite(v.pp)&&v.pp>0));
  assert.ok(values.slice(1).every((v,i)=>v.pp<values[i].pp));
  const result=await new Bot({api,bindings:{get:()=>null}}).run('!m 42');
  assert.equal(result.map.performance.length,4);
  assert.match(cardSvg(result),/PP ESTIMATE/);
  Object.assign(result.map,{count_circles:2424,count_sliders:2979,passcount:50,playcount:110,failtimes:{fail:[10],exit:[40]}});
  const svg=cardSvg(result);
  for(const value of ['2,424','2,979','55.13%','50.00%','10.00%','40.00%','110 plays']) assert.ok(svg.includes(value),value);
  assert.ok(!cardSvg(result).includes('NaN'));
});

test('score panel retains base stars and only adds a second row for mods', async () => {
  const api=new DemoApi(),baseScores=api.scores.bind(api);
  api.scores=async (...args)=>(await baseScores(...args)).map(s=>({...s,mods:[]}));
  const bot=new Bot({api,bindings:{get:()=>null}});
  const nm=await bot.run('!p Demo Player');
  assert.equal(nm.scores[0].beatmap.modStars,undefined);
  assert.ok(!cardSvg(nm).includes('WITH MODS</text>'));
  api.scores=async (...args)=>(await baseScores(...args)).map(s=>({...s,mods:[{acronym:'DT',settings:{speed_change:1.75}}]}));
  const dt=await bot.run('!p Demo Player');
  assert.ok(Number.isFinite(dt.scores[0].beatmap.modStars));
  assert.equal(dt.scores[0].beatmap.difficulty_rating,nm.scores[0].beatmap.difficulty_rating);
  assert.match(cardSvg(dt),/aria-label="DT 1.75×"/);
  assert.match(cardSvg(dt),/>1.75×<\/text>/);
  api.rawMap=async()=>{throw new Error('Offline');};
  const failed=await bot.run('!p Demo Player');
  assert.match(cardSvg(failed),/Unavailable/);
  assert.ok(!cardSvg(failed).includes('NaN'));
});

test('SS display and MAX to 300 ratio handle modern, legacy and zero judgments', async () => {
  const bot=new Bot({api:new DemoApi(),bindings:{get:()=>null}});
  const result=await bot.run('!p Demo Player');
  const s=result.scores[0];
  s.rank='X'; s.statistics={perfect:271,great:60};
  assert.match(cardSvg(result),/>SS<\/text>/);
  assert.match(cardSvg(result),/MAX : 300 = 4.5 : 1/);
  assert.ok(!cardSvg(result).includes('>X</text>'));
  s.rank='XH'; s.statistics={count_geki:465,count_300:41};
  assert.match(cardSvg(result),/fill="url\(#gradeSilver\)"[^>]*>SS<\/text>/);
  assert.match(cardSvg(result),/MAX : 300 = 11.3 : 1/);
  s.statistics={perfect:10,great:0};
  assert.match(cardSvg(result),/MAX : 300 = ∞ : 1/);
  s.statistics={perfect:0,great:0};
  assert.match(cardSvg(result),/MAX : 300 = —/);
});

test('grade colors distinguish each rank and Hidden silver grades without appending H', async () => {
  const result=await new Bot({api:new DemoApi(),bindings:{get:()=>null}}).run('!p Demo Player');
  const s=result.scores[0];
  s.mods=[];
  for(const [rank,color] of Object.entries({X:'Gold',S:'Gold',A:'Green',B:'Blue',C:'Purple',D:'Red',F:'Gray',XH:'Silver',SH:'Silver'})){
    s.rank=rank;
    assert.match(cardSvg(result),new RegExp(`fill="url\\(#grade${color}\\)"[^>]*>${rank==='X'||rank==='XH'?'SS':rank==='SH'?'S':rank}</text>`));
  }
  s.mods=[{acronym:'HD'}]; s.rank='S';
  assert.match(cardSvg(result),/fill="url\(#gradeSilver\)"[^>]*>S<\/text>/);
  assert.ok(cardSvg(result).includes('PASSED · HD'));
  s.rank='A';
  assert.match(cardSvg(result),/fill="url\(#gradeGreen\)"[^>]*>A<\/text>/);
});

test('stable Classic scores keep beatmap analysis and show the correct client badge', async () => {
  const api=new DemoApi(),baseScores=api.scores.bind(api);
  api.scores=async (...args)=>(await baseScores(...args)).map(s=>({...s,total_score:s.score,legacy_score_id:s.id,mods:[{acronym:'CL'}]}));
  const result=await new Bot({api,bindings:{get:()=>null},demo:false}).run('!p Demo Player');
  const s=result.scores[0];
  assert.ok(s.beatmap.analysis?.density.length);
  assert.equal(s.beatmap.modStars,undefined);
  let svg=cardSvg(result);
  assert.match(svg,/BEATMAP ANALYSIS/);
  assert.match(svg,/aria-label="STABLE"/);
  assert.match(svg,/fill="url\(#clientStable\)"/);
  assert.ok(!svg.includes('SCORE DETAILS'));
  assert.ok(!svg.includes('stroke="#ff0000"'));
  s.legacy_score_id=null;s.is_lazer=true;
  svg=cardSvg(result);
  assert.match(svg,/aria-label="LAZER"/);
  assert.match(svg,/fill="url\(#clientLazer\)"/);
  s.mods=[{acronym:'CL'},{acronym:'HT'}];
  const mixed=await new Bot({api:{...api,user:api.user.bind(api),map:api.map.bind(api),rawMap:api.rawMap.bind(api),scores:async()=>[s]},bindings:{get:()=>null}}).run('!p Demo Player');
  assert.ok(Number.isFinite(mixed.scores[0].beatmap.modStars));
  assert.ok(mixed.scores[0].beatmap.analysis?.density.length);
});
