import test from 'node:test';
import assert from 'node:assert/strict';
import { riceCredit,sevenLnCredit,danAccuracy,contributionFromChart,danContribution } from '../src/dan.js';
import {DemoApi} from '../src/demo.js';
import {cardSvg} from '../src/cards.js';
import {readFile} from 'node:fs/promises';
import {danLabel} from '../src/dan.js';
import {danScale} from '../src/dan-icons.js';
import {sevenRiceExclusion} from '../src/seven-rice-gates.js';

const sample={passed:true,accuracy:.9709,mods:['HT'],legacy_score_id:1,statistics:{perfect:7647,great:3998,good:569,ok:59,meh:27,miss:35},beatmap:{accuracy:7.5}};
test('rice credit reproduces screenshot judgments and 8.57 → 8.65',()=>{
  const accuracy=danAccuracy(sample);
  assert.ok(Math.abs(accuracy-.976773408998784)<1e-12);
  assert.equal(Number(riceCredit(8.57,accuracy).toFixed(2)),8.65);
  assert.equal(riceCredit(8.57,.96),8.57);
  assert.ok(Math.abs(riceCredit(8.57,.91)-7.07)<1e-12);
  assert.equal(riceCredit(8.57,.90),null);
  assert.equal(riceCredit(8.57,1),10.07);
  assert.equal(riceCredit(8.57,1,true),9.32);
});
test('latest judgments are recomputed even when chart rating is cached, and unknown lazer judgments are not inferred',()=>{
  const chart={chart:8.57,primary:'Stamina',source:'Mixed',side:'Rice'};
  const high=contributionFromChart(chart,sample);
  const lower=contributionFromChart(chart,{...sample,statistics:{perfect:90,miss:10}});
  assert.ok(high.credited>8.57);assert.equal(lower.credited,null);
  assert.equal(contributionFromChart(chart,{...sample,passed:false}).credited,null);
  assert.equal(contributionFromChart(chart,{...sample,beatmap:{accuracy:5}}).credited,null);
  assert.equal(danAccuracy({...sample,legacy_score_id:null,is_lazer:true,statistics:{}}),null);
  assert.equal(danAccuracy({...sample,statistics:{perfect:-1}}),null);
  const svg=cardSvg({kind:'score',demo:true,scores:[{...sample,beatmap:{...sample.beatmap,danContribution:high},beatmapset:{title:'Sample'}}]});
  assert.match(svg,/LOCAL DAN/);assert.match(svg,/8.65/);assert.ok(!svg.includes('NaN'));
});
test('local estimator runs without a website and respects custom playback rate',async()=>{
  const raw=await new DemoApi().rawMap();
  const slow=await danContribution(raw,{...sample,mods:['HT']});
  const normal=await danContribution(raw,{...sample,mods:[]});
  assert.ok(Number.isFinite(slow.chart));assert.ok(Number.isFinite(normal.chart));
  assert.equal(slow.rate,.75);assert.equal(normal.rate,1);
  const failed=await danContribution(raw,{...sample,passed:false});assert.equal(failed.credited,null);
  await assert.rejects(danContribution(raw.replace('CircleSize:4','CircleSize:6'),sample),/4K\/7K/);
});

test('synthetic 7K rice follows its own ladder and recalculates score credit',async()=>{
  const raw=await readFile(new URL('./fixtures/synthetic-7k-rice.osu',import.meta.url),'utf8');
  const score={passed:true,mods:['CL'],beatmap:{cs:7,accuracy:8},statistics:{perfect:1729,great:778,good:117,ok:22,meh:8,miss:25}};
  const result=await danContribution(raw,score);
  assert.equal(result.keys,7);assert.ok(Number.isFinite(result.chart));assert.equal(result.credited,result.chart);
  assert.equal(result.label,danLabel(result.chart,7));assert.equal(result.currency,'Stable');assert.equal(result.bar,.96);
  const better=await danContribution(raw,{...score,statistics:{perfect:2679}});
  assert.equal(better.credited,Math.min(14.5,result.chart+1.5));
  const ht=await danContribution(raw,{...score,mods:['HT']});
  assert.ok(ht&&ht.chart<result.chart);assert.equal(ht.rate,.75);
  assert.equal(await danContribution(raw,{...score,mods:['DA']}),null);
  assert.equal(await danContribution(raw,{...score,passed:false}),null);
  const [header,objects]=raw.split('[HitObjects]');
  const lnRaw=header+'[HitObjects]'+objects.split(/\r?\n/).map(line=>{
    if(!/^\d+,\d+,\d+,/.test(line))return line;
    const fields=line.split(',');fields[3]='128';fields[5]=`${Number(fields[2])+1000}:0:0:0:0:`;return fields.join(',');
  }).join('\n');
  const ln=await danContribution(lnRaw,score);
  assert.equal(ln.side,'LN');assert.equal(ln.bar,.95);
  assert.equal(danLabel(11,7),'Gamma');assert.equal(danLabel(12,7),'Azimuth');
  assert.equal(danLabel(14,7),'Stellium');assert.equal(danLabel(0,7),'0');
  assert.equal(danScale(11,7).levels[1].file,'7-gamma.svg');
  assert.equal(danScale(0,7).levels.at(-1).file,'7-0.svg');
  const kyu=contributionFromChart({chart:.4,keys:7}, {...score,statistics:{perfect:95,miss:5}});
  assert.equal(kyu.bar,.95);assert.equal(kyu.credited,.4);
  // A 7K Jack takes the complete bonus; the half bonus belongs to 4K.
  assert.equal(riceCredit(3.8,1,true,{keys:7}),5.3);
});

test('7K stacked and vibro charts keep ordinary score cards without a contribution panel',()=>{
  const notes={noteStarts:Array.from({length:100},(_,i)=>i*180),columns:Array.from({length:100},(_,i)=>i%7),noteTypes:Array(100).fill(1)};
  assert.equal(sevenRiceExclusion(notes,1),null);
  assert.equal(sevenRiceExclusion({...notes,noteTypes:Array.from({length:100},(_,i)=>i<38?128:1)},1),'LN chart');
  assert.equal(sevenRiceExclusion({...notes,noteStarts:Array(100).fill(0),columns:Array(100).fill(0)},1),'Stacked note heads');
  const vibro={noteStarts:Array.from({length:350},(_,i)=>i*80),columns:Array(350).fill(0),noteTypes:Array(350).fill(1)};
  assert.equal(sevenRiceExclusion(vibro,1),'Sustained vibro');
  const excluded=contributionFromChart({keys:7,excluded:true,reason:'LN chart'},sample);
  assert.equal(excluded,null);
  const svg=cardSvg({kind:'score',demo:true,scores:[{...sample,beatmap:{cs:7,version:'LN',danContribution:excluded},beatmapset:{title:'Sample'}}]});
  assert.ok(!svg.includes('LOCAL DAN'));assert.ok(!svg.includes('CHART ESTIMATE'));
  assert.match(svg,/BEATMAP/);
});

test('synthetic 7K LN selects the LN branch, icons and credit curve',async()=>{
  const raw=await readFile(new URL('./fixtures/synthetic-7k-ln.osu',import.meta.url),'utf8');
  const score={passed:true,mods:['CL'],beatmap:{cs:7,accuracy:5},statistics:{perfect:9500,miss:500}};
  const result=await danContribution(raw,score);
  assert.ok(Number.isFinite(result.chart));assert.equal(result.side,'LN');assert.equal(result.bar,.95);
  assert.equal(result.credited,result.chart);assert.equal(result.label,danLabel(result.chart,7));
  const better=await danContribution(raw,{...score,statistics:{perfect:9900,miss:100}});
  assert.ok(Math.abs(better.credited-Math.min(14.5,result.chart+.86))<1e-10);
  const slow=await danContribution(raw,{...score,mods:['HT']});
  assert.ok(slow&&slow.chart<result.chart);assert.equal(slow.side,'LN');
  for(const [accuracy,offset] of [[.95,0],[.9625,0],[.98,.164705882352941],[.99,.86],[1,1.5],[.949,-.125],[.945,-.625],[.94,-1.25],[.93,-1.5],[.92,-1.75]]){
    assert.ok(Math.abs(sevenLnCredit(9.2,accuracy)-(9.2+offset))<1e-10, String(accuracy));
  }
  assert.equal(sevenLnCredit(9.2,.9199),null);
  assert.equal(await danContribution(raw,{...score,beatmap:{cs:7,accuracy:4.9}}),null);
  assert.equal(await danContribution(raw,{...score,mods:['EZ']}),null);
  assert.equal(danScale(11,7,'LN').levels[1].file,'7-ln-gamma.svg');
  for(let level=0;level<=14;level++)for(const {file} of danScale(level,7,'LN').levels){assert.ok((await readFile(new URL('../assets/dan/'+file,import.meta.url),'utf8')).includes('<svg'));}
  const svg=cardSvg({kind:'score',demo:true,scores:[{...score,beatmap:{...score.beatmap,danContribution:result},beatmapset:{title:'Synthetic LN'}}]});
  assert.match(svg,/LOCAL DAN · 7K LN/);assert.match(svg,/Dan ACC \(Stable\) 95% · Bar 95%/);
});
