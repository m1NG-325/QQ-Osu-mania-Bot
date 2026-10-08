import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fourLnCredit,danAccuracy,danContribution,contributionFromChart,danLabel } from '../src/dan.js';
import { fourLnChart,fourLnVerdict } from '../src/four-ln.js';
import { danScale } from '../src/dan-icons.js';
import { cardSvg,renderCard } from '../src/cards.js';

// Original synthetic notes, no third-party chart or player data in the release.
function chart({body=350,od=8,holdShare=1}={}){
  return `osu file format v14\n[General]\nMode:3\n[Metadata]\nTitle:Synthetic releases\nVersion:4K test\n[Difficulty]\nCircleSize:4\nOverallDifficulty:${od}\n[TimingPoints]\n0,500,4,2,0,100,1,0\n[HitObjects]\n`+
    Array.from({length:640},(_,i)=>{
      const time=1000+i*180,lane=i%4,isHold=i%20<holdShare*20;
      return `${64+128*lane},192,${time},${isHold?128:1},0,${isHold?`${time+body}:`:''}0:0:0:0:`;
    }).join('\n');
}
const score={passed:true,mods:['CL'],legacy_score_id:1,beatmap:{cs:4,accuracy:8,difficulty_rating:3},statistics:{perfect:9700,miss:300}};

test('4K LN follows published 97% / 91% credit anchors, floor and 17th ceiling',()=>{
  for(const [acc,offset] of [[.91,-1.75],[.92,-1.5],[.93,-1.25],[.96,-.5075],[.97,0],[.98,0],[.985,.15],[.99,.3],[.995,.5],[.997,.7],[1,.7]]){
    assert.ok(Math.abs(fourLnCredit(10,acc)-(10+offset))<1e-10,`${acc}`);
  }
  assert.equal(fourLnCredit(10,.90999),null);
  assert.equal(fourLnCredit(10,NaN),null);
  assert.equal(fourLnCredit(10,1.01),null);
  assert.equal(fourLnCredit(.5,.91),.5);assert.equal(fourLnCredit(17.4,1),17.5);
  assert.ok(Math.abs(fourLnCredit(10,.969999)-10)<.001);
});

test('ScoreV2 uses 305 MAX and 300 great, never substitutes stable display accuracy',()=>{
  assert.equal(danAccuracy({...score,statistics:{perfect:500,great:500}},'ScoreV2'),605/610);
  assert.equal(danAccuracy({...score,statistics:{perfect:500,great:500}}),1);
  assert.equal(danAccuracy({...score,statistics:{},accuracy:1},'ScoreV2'),null);
  assert.equal(danAccuracy({...score,statistics:{perfect:-1}},'ScoreV2'),null);
  const old={...score,statistics:{count_geki:9700,count_miss:300}};
  assert.equal(danAccuracy(old,'ScoreV2'),.97);
  const c={keys:4,side:'LN',chart:10,playedOd:8};
  assert.equal(contributionFromChart(c,old).credited,10);
  assert.equal(contributionFromChart(c,{...old,is_lazer:true,legacy_score_id:null}).credited,10);
  assert.equal(contributionFromChart({...c,playedOd:6.9},old).credited,null);
  assert.equal(contributionFromChart(c,{...old,passed:false}).credited,null);
  assert.equal(contributionFromChart(c,{...old,mods:['EZ']}).credited,null);
  assert.equal(contributionFromChart(c,{...old,mods:['DA']}).credited,10);
});

test('effective releases route long holds to LN, tap-length holds and under-45% maps to rice',()=>{
  assert.equal(fourLnChart(chart({body:1}),{starRating:3}),null);
  assert.equal(fourLnChart(chart({holdShare:.4}),{starRating:3}),null);
  const full=fourLnChart(chart(),{starRating:3});
  assert.equal(full.side,'LN');assert.ok(Number.isFinite(full.chart));
  assert.equal(full.source,'ManiaTracker 4K LN low-band model');
  assert.equal(fourLnVerdict('LN 12 mid/high'),12.2);
  assert.equal(fourLnVerdict('< LN 5 mid'),4.5);
  assert.equal(fourLnVerdict('> LN 17 high'),17.5);
});

test('worker recomputes LN score, rates and OD separately from cached chart',async()=>{
  const raw=chart(),normal=await danContribution(raw,score);
  assert.equal(normal.side,'LN');assert.equal(normal.bar,.97);assert.equal(normal.currency,'ScoreV2');
  const lower=await danContribution(raw,{...score,statistics:{perfect:9000,miss:1000}});
  assert.equal(lower.chart,normal.chart);assert.equal(lower.credited,null);
  const fast=await danContribution(raw,{...score,mods:[{acronym:'DT',settings:{speed_change:1.25}}]});
  assert.equal(fast.rate,1.25);assert.equal(fast.side,'LN');assert.ok(fast.chart>=normal.chart);
  const da=await danContribution(raw,{...score,mods:[{acronym:'DA',settings:{overall_difficulty:6.9}}]});
  assert.equal(da.playedOd,6.9);assert.equal(da.credited,null);assert.equal(da.reason,'OD below 7');
  const validDa=await danContribution(raw,{...score,mods:[{acronym:'DA',settings:{overall_difficulty:7}}]});
  assert.equal(validDa.playedOd,7);assert.notEqual(validDa.credited,null);
  const lowOd=await danContribution(chart({od:6.5}),score);
  assert.equal(lowOd.reason,'OD below 7');
  const hr=await danContribution(chart({od:6.5}),{...score,mods:['HR']});
  assert.equal(hr.playedOd,6.462+.715*6.5);assert.notEqual(hr.credited,null);
  const rice=await danContribution(chart({body:1}),score);assert.equal(rice.side,'Rice');
});

test('numeric 4K LN 11–17 labels and assets never use the RC Greek ladder',async()=>{
  for(let n=1;n<=17;n++){
    assert.equal(danLabel(n,4,'LN'),String(n));
    for(const {file,name} of danScale(n,4,'LN').levels){
      assert.match(file,/^4-ln-\d+\.svg$/);assert.match(name,/^\d+$/);
      assert.match(await readFile(new URL('../assets/dan/'+file,import.meta.url),'utf8'),/<svg/);
    }
  }
  const credited=contributionFromChart({chart:12,keys:4,side:'LN',playedOd:8},score);
  const result={kind:'score',demo:true,scores:[{...score,beatmap:{...score.beatmap,id:100001,danContribution:credited},beatmapset:{title:'Synthetic releases'}}]};
  const svg=cardSvg(result);
  assert.match(svg,/LOCAL DAN · 4K LN/);assert.match(svg,/Dan ACC \(ScoreV2\) 97% · Bar 97%/);
  assert.doesNotMatch(svg,/NaN|undefined/);
  const png=await renderCard(result);assert.ok(png.length>10000);
});
