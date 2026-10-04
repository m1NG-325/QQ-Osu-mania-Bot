import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { scoreRate } from './analysis.js';
import { scoreClient } from './time-best.js';
import { danName } from './dan-ladders.js';

const cache=new Map();
const acronym=m=>typeof m==='string'?m:m.acronym;
const above=[[0,0],[.25,0],[.675,.2],[.75,.7],[.875,1.1],[1,1.5]];
const below=[[0,0],[.2,-.5075],[.8,-1.25],[1,-1.5]];
const lnBelow=[[0,0],[1/3,-1.25],[2/3,-1.5],[1,-1.75]];
function interpolate(points,x){
  for(let i=1;i<points.length;i++)if(x<=points[i][0]){
    const [a,b]=points[i-1],[c,d]=points[i];return b+(d-b)*Math.max(0,(x-a)/(c-a));
  }
  return points.at(-1)[1];
}
export function danLabel(value,keys=4){
  if(!Number.isFinite(value))return '—';
  const n=Math.max(keys===7?0:1,Math.min(keys===7?14:20,Math.round(value))),delta=value-n;
  const suffix=delta<-.3?'--':delta<-.1?'-':delta<=.1?'':delta<=.3?'+':'++';
  return danName(n,keys)+suffix;
}
export function riceCredit(chart,accuracy,jack=false,{keys=4,bar=.96}={}){
  if(!Number.isFinite(chart)||!Number.isFinite(accuracy)||accuracy<bar-.05-1e-9||accuracy>1)return null;
  const delta=accuracy-bar;
  const offset=delta<0?interpolate(below,Math.min(1,-delta/.05)):interpolate(above,Math.min(1,delta/Math.max(1-bar,.04)))*(keys===4&&jack?.5:1);
  return Math.max(keys===7?0:.5,Math.min(keys===7?14.5:20.5,chart+offset));
}
export function sevenLnCredit(chart,accuracy){
  const bar=.95,window=.03;
  if(!Number.isFinite(chart)||!Number.isFinite(accuracy)||accuracy<bar-window-1e-9||accuracy>1)return null;
  const delta=accuracy-bar;
  const offset=delta<0?interpolate(lnBelow,Math.min(1,-delta/window)):interpolate(above,Math.min(1,delta/(1-bar)));
  return Math.max(2.5,Math.min(14.5,chart+offset));
}
export function danAccuracy(score){
  const j=score.statistics||{},values=[j.perfect??j.count_geki,j.great??j.count_300,j.good??j.count_katu,j.ok??j.count_100,j.meh??j.count_50,j.miss??j.count_miss];
  if(values.some(v=>v!=null&&(!Number.isFinite(v)||v<0)))return null;
  const [max,great,good,ok,meh,miss]=values.map(v=>v??0),total=max+great+good+ok+meh+miss;
  if(total)return (300*(max+great)+200*good+100*ok+50*meh)/(300*total);
  // Rice uses stable's 300-weighted accuracy. Lazer display accuracy cannot substitute for it.
  return scoreClient(score)==='Stable'&&Number.isFinite(score.accuracy)?score.accuracy:null;
}
export function contributionFromChart(chart,score){
  if(chart.excluded)return null;
  const keys=chart.keys||4,isLn=keys===7&&chart.side==='LN',bar=isLn||keys===7&&chart.chart<1?.95:.96;
  const accuracy=danAccuracy(score),mods=(score.mods||[]).map(acronym);
  let reason=chart.reason;
  if(score.passed!==true)reason='Not passed';
  else if(mods.some(m=>!['CL','NM','HD','FI','MR','DT','NC','HT','DC','NF','SD','PF'].includes(m)))reason='Unsupported Mods';
  else if(score.beatmap?.accuracy!=null&&score.beatmap.accuracy<(isLn?5:5.5))reason=`OD below ${isLn?5:5.5}`;
  else if(accuracy==null)reason='Judgments unavailable';
  const credited=reason?null:isLn?sevenLnCredit(chart.chart,accuracy):riceCredit(chart.chart,accuracy,chart.primary==='Jack',{keys,bar});
  if(!reason&&credited==null)reason=`Dan accuracy below ${Math.round((bar-(isLn?.03:.05))*100)}%`;
  if(keys===7&&reason)return null;
  return {...chart,accuracy,credited,label:danLabel(chart.chart,keys),creditedLabel:danLabel(credited,keys),reason:reason||null,bar,currency:'Stable'};
}
export async function danContribution(raw,score){
  if(!raw.startsWith('osu file format')||Buffer.byteLength(raw)>4*1024*1024)throw Error('Invalid beatmap');
  const rate=scoreRate(score);
  if(rate<.5||rate>2)throw Error('Unsupported rate');
  const key=createHash('sha256').update(raw).update(String(rate)).digest('hex');
  let promise=cache.get(key);
  if(!promise){
    promise=new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./dan-worker.js',import.meta.url),{workerData:{raw,rate},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:384}});
      let settled=false;
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();error?reject(Error(error)):resolve(value);};
      const timer=setTimeout(()=>finish('Dan calculation timed out'),25000);
      worker.once('message',r=>finish(r.error,r.result));worker.once('error',()=>finish('Dan worker failed'));
      worker.once('exit',()=>{if(!settled)finish('Dan worker stopped');});
    });
    cache.set(key,promise);if(cache.size>32)cache.delete(cache.keys().next().value);
    promise.catch(()=>cache.delete(key));
  }
  return contributionFromChart(await promise,score);
}
