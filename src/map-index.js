import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomInt} from 'node:crypto';
import {UserError} from './osu.js';
import {groupedPatterns} from './patterns.js';
import {analyzeText} from './compute.js';

export function filters(argument,practice=false){
  const out={keys:4,stars:[0,15],length:[0,7200],ln:[0,1]};
  const parts=argument.trim().split(/\s+/).filter(Boolean);
  if(practice){out.pattern=({jack:'Jack',stream:'Stream',tech:'Tech',jhs:'JHS',ln:'LN'})[parts.shift()?.toLowerCase()];if(!out.pattern)throw new UserError('用法：!练习 jack / stream / tech / jhs / ln [4k或7k] [5-6星]。');}
  for(const part of parts){
    let match;
    if((match=part.match(/^([47])k$/i)))out.keys=Number(match[1]);
    else if((match=part.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)星$/)))out.stars=match.slice(1).map(Number);
    else if((match=part.match(/^(\d+)-(\d+)秒$/)))out.length=match.slice(1).map(Number);
    else if((match=part.match(/^ln(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%$/i)))out.ln=match.slice(1).map(n=>Number(n)/100);
    else throw new UserError('筛选格式：4k / 7k、5-6星、60-180秒、LN0-20%；例如 !随机 4k 5-6星 60-180秒 LN0-20%。');
  }
  if([out.stars,out.length,out.ln].some(([a,b])=>a>b)||out.stars[1]>15||out.length[1]>7200||out.ln[1]>1)throw new UserError('筛选范围无效；星数 0–15、时长 0–7200 秒、LN 0–100%。');
  return out;
}
const matches=(row,f)=>row.map.cs===f.keys&&row.map.difficulty_rating>=f.stars[0]&&row.map.difficulty_rating<=f.stars[1]&&(row.map.total_length??row.length)>=f.length[0]&&(row.map.total_length??row.length)<=f.length[1]&&row.lnRatio>=f.ln[0]&&row.lnRatio<=f.ln[1]&&(!f.pattern||(f.pattern==='LN'?row.lnRatio>=.375:row.patterns[f.pattern]>=.15));
export class MapIndex {
  constructor(path){this.path=path;this.rows=new Map();this.writes=Promise.resolve();this.pending=new Map();}
  async load(){try{for(const row of JSON.parse(await readFile(this.path,'utf8')).slice(-3000))this.rows.set(String(row.map.id),row);}catch(e){if(e.code!=='ENOENT')throw e;}return this;}
  save(){const data=JSON.stringify([...this.rows.values()]);this.writes=this.writes.catch(()=>{}).then(async()=>{await mkdir(dirname(this.path),{recursive:true});await writeFile(this.path+'.tmp',data);await rename(this.path+'.tmp',this.path);});return this.writes;}
  async add(map,a){
    if(![4,7].includes(map.cs)||map.convert||a.rate!==1)return;
    const summary=groupedPatterns(a.patternSummary),total=summary.reduce((n,[,v])=>n+v,0);
    const compact=Object.fromEntries(['id','beatmapset_id','mode','cs','difficulty_rating','total_length','version','bpm','accuracy','drain','status','url'].map(k=>[k,map[k]]));
    compact.beatmapset=Object.fromEntries(['id','title','artist','creator'].map(k=>[k,map.beatmapset?.[k]]));
    this.rows.set(String(map.id),{map:compact,length:a.length,lnRatio:a.lnRatio,patterns:Object.fromEntries(summary.map(([k,v])=>[k,total?v/total:0])),indexedAt:new Date().toISOString()});
    while(this.rows.size>3000)this.rows.delete(this.rows.keys().next().value);await this.save();
  }
  async ensure(api,f){
    const query=`keys=${f.keys} stars>=${f.stars[0]} stars<=${f.stars[1]} length>=${f.length[0]} length<=${f.length[1]}`;
    if(!this.pending.has(query)){
      const promise=(async()=>{
        const maps=(await api.searchMaps(query)).filter(m=>m.cs===f.keys&&m.difficulty_rating>=f.stars[0]&&m.difficulty_rating<=f.stars[1]);
        const unseen=maps.filter(m=>!this.rows.has(String(m.id)));
        for(let i=unseen.length-1;i>0;i--){const j=randomInt(i+1);[unseen[i],unseen[j]]=[unseen[j],unseen[i]];}
        const candidates=unseen.slice(0,12);
        for(let i=0;i<candidates.length;i+=2)await Promise.all(candidates.slice(i,i+2).map(async map=>{try{await this.add(map,await analyzeText(await api.rawMap(map.id),{detailed:false}));}catch{}}));
      })().finally(()=>this.pending.delete(query));this.pending.set(query,promise);
    }
    await this.pending.get(query);
  }
  async pick(api,f){
    let rows=[...this.rows.values()].filter(row=>matches(row,f));
    if(!rows.length){await this.ensure(api,f);rows=[...this.rows.values()].filter(row=>matches(row,f));}
    if(!rows.length)throw new UserError(`当前索引（${this.rows.size} 张）没有符合条件的谱面。可放宽星数、时长或 LN 范围；日常谱面查询会持续补充索引。`);
    return rows[randomInt(rows.length)];
  }
}
