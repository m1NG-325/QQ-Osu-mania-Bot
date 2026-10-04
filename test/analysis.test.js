import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeText, scoreRate } from '../src/analysis.js';
import { DemoApi } from '../src/demo.js';
import { Bot } from '../src/bot.js';
import { OsuApi } from '../src/osu.js';
import { renderCard, cardSvg } from '../src/cards.js';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';

test('real note parsing, LN/chord counts and rate scaling preserve density integral', async () => {
  const raw = await new DemoApi().rawMap();
  const normal = await analyzeText(raw, { detailed: false });
  const fast = await analyzeText(raw, { rate: 1.5, detailed: false });
  assert.equal(normal.notes, 1200);
  assert.equal(normal.longNotes, 75);
  assert.equal(normal.rows, 900);
  assert.equal(normal.chordRows, 300);
  assert.equal(normal.columnNotes.reduce((a,b)=>a+b,0), 1200);
  assert.ok(Math.abs(normal.density.reduce((a,b)=>a+b,0)*normal.length/normal.density.length - 1200)<1e-8);
  assert.equal(fast.length, normal.length / 1.5);
  assert.ok(Math.abs(fast.avgNps / normal.avgNps - 1.5)<1e-8);
  assert.ok(Math.abs(normal.patternSummary.reduce((a,[,s])=>a+s,0)-normal.length)<1e-8);
  assert.ok(normal.ratings.Sunny.star > 0 && normal.strain.values.every(Number.isFinite));
  assert.equal(scoreRate({mods:[{acronym:'DT',settings:{speed_change:1.75}}]}),1.75);
  assert.equal(scoreRate({mods:['HT']}),.75);
});

test('analysis command runs real engines, produces panel, and validates inputs', async () => {
  const bot = new Bot({api:new DemoApi(), bindings:{get:()=>null}});
  const result = await bot.run('!a 42 1.5');
  assert.equal(result.kind,'analysis');
  assert.equal(result.analysis.rate,1.5);
  assert.ok(result.analysis.msd.values.Overall > 0);
  assert.ok(result.analysis.ratings.Daniel.star > 0);
  assert.ok(result.analysis.ratings.Companella.label);
  const svg = cardSvg(result);
  assert.match(svg,/ETTERNA MSD/);
  assert.ok(!svg.includes('NaN') && !svg.includes('Infinity'));
  const metadata=await sharp(await renderCard(result)).metadata();
  assert.equal(metadata.width,1920); assert.equal(metadata.height,1640);
  const score=await bot.run('!p Demo Player');
  assert.ok(score.scores[0].beatmap.analysis.density.length);
  const api=new DemoApi();
  const originalScores=api.scores.bind(api);
  api.scores=async (...args)=>(await originalScores(...args)).map(s=>({...s,mods:['HR']}));
  const hr=await new Bot({api,bindings:{get:()=>null}}).run('!p Demo Player');
  assert.equal(hr.scores[0].beatmap.analysis,undefined);
  assert.equal(hr.scores[0].beatmap.analysisUnavailable,true);
  await assert.rejects(()=>bot.run('!a 42 0'), /倍速/);
  await assert.rejects(()=>bot.run('!a 42 nonsense'), /倍速/);
  const raw=await new DemoApi().rawMap();
  await assert.rejects(()=>analyzeText(raw.replace('Mode:3','Mode:0')),/mania/);
  assert.throws(()=>analyzeText('bad'),/文件/);
  assert.throws(()=>analyzeText(raw,{rate:3}),/倍速/);
});

test('raw beatmap fetch validates data and caches downloaded text', async () => {
  let calls=0;
  const raw=await new DemoApi().rawMap();
  const api=new OsuApi({fetchImpl:async()=>{calls++;return new Response(raw);}});
  assert.equal(await api.rawMap(42),raw); assert.equal(await api.rawMap(42),raw);
  assert.equal(calls,1);
  await assert.rejects(()=>api.rawMap('../secret'),/ID/);
  const invalid=new OsuApi({fetchImpl:async()=>new Response('<html>unavailable</html>')});
  await assert.rejects(()=>invalid.rawMap(42),/内容/);
});

test('7K LN score queries include real analysis and agree with the contribution ladder',async()=>{
  const raw=await readFile(new URL('./fixtures/synthetic-7k-ln.osu',import.meta.url),'utf8');
  const api=new DemoApi(),originalScores=api.scores.bind(api),originalMap=api.map.bind(api);
  api.rawMap=async()=>raw;
  api.map=async id=>({...await originalMap(id),cs:7,accuracy:8,version:'7K LN test',density:undefined});
  api.scores=async(...args)=>(await originalScores(...args)).map(score=>({...score,mods:[]}));
  const result=await new Bot({api,bindings:{get:()=>null}}).run('!p Demo Player');
  const map=result.scores[0].beatmap,a=map.analysis;
  assert.equal(a.keys,7);assert.equal(a.notes,3840);assert.ok(a.lnRatio>.8);
  assert.ok(a.density.length>100);assert.equal(a.columnNotes.reduce((sum,n)=>sum+n,0),a.notes);
  assert.ok(a.patterns.length>10);assert.ok(a.clusters.length>0);
  assert.ok(Math.abs(a.density.reduce((sum,n)=>sum+n,0)*a.length/a.density.length-a.notes)<1e-8);
  assert.match(a.ratings.Sunny.label,/LN /);
  assert.equal(map.danContribution.side,'LN');assert.ok(Number.isFinite(map.danContribution.chart));
  const svg=cardSvg(result);assert.match(svg,/BEATMAP ANALYSIS/);assert.match(svg,/LOCAL DAN · 7K LN/);
  assert.ok(!svg.includes('SCORE DETAILS'));assert.ok(!svg.includes('NaN'));
});
