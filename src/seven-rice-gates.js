// Structural gates for the 7K Sunny ladder: hold share, stacked heads and
// the whole-chart vibro thresholds published by Mania Tracker.
export function sevenRiceExclusion(p,rate,{allowLn=false}={}){
  const count=p.noteStarts.length;
  if(!allowLn&&p.noteTypes.filter(t=>(t&128)!==0).length/count>=.375)return 'LN chart';
  const columns=Array.from({length:7},()=>[]),rows=new Map(),heads=new Map();
  for(let i=0;i<count;i++){
    const time=p.noteStarts[i],column=p.columns[i],key=`${column}:${time}`;
    if(!Number.isInteger(column)||column<0||column>=7)return 'Invalid column';
    const stack=(heads.get(key)||0)+1;heads.set(key,stack);
    if(stack>=8)return 'Stacked note heads';
    columns[column].push(time);
    if(!rows.has(time))rows.set(time,new Set());rows.get(time).add(column);
  }
  let total=0,fast=0,longest=0,burstRuns=0,burstGaps=0;
  for(const column of columns){
    column.sort((a,b)=>a-b);
    let run=0,burst=0;
    const flush=()=>{if(burst>=8){burstRuns++;burstGaps+=burst;}burst=0;};
    for(let i=1;i<column.length;i++){
      const gap=(column[i]-column[i-1])/rate;if(gap<=0)continue;total++;
      if(gap<=92){fast++;run++;longest=Math.max(longest,run);}else run=0;
      if(gap<=100)burst++;else flush();
    }
    flush();
  }
  if(count>=300&&longest>=24&&fast/total>=.25)return 'Sustained vibro';
  if(count>=200&&burstRuns>=4&&burstGaps/total>=.2)return 'Burst vibro';
  const times=[...rows.keys()].sort((a,b)=>a-b);
  let start=0,walls=0;
  for(let i=0;i<times.length;i++){
    while(times[i]-times[start]>1000*rate)start++;
    if(count>=200&&i-start+1>=65)return 'Row spam';
    if(i>0&&(times[i]-times[i-1])/rate<=70&&rows.get(times[i]).size>=6&&rows.get(times[i-1]).size>=6)walls++;
  }
  if(count>=200&&walls/Math.max(1,times.length-1)>=.02)return 'Chord-wall vibro';
  return null;
}
