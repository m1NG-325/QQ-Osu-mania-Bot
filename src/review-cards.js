import { modIcons } from './mod-icons.js';
import {playedTime} from './score-compare.js';
const e=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const f=(n,d=0)=>Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:d}):'—';
const pct=n=>Number.isFinite(n)?(n*100).toFixed(2)+'%':'—';
const t=(x,y,s,size=25,c='#f4f7ff',anchor='start')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${c}" text-anchor="${anchor}">${e(s)}</text>`;
const box=(x,y,w,h)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="#222e43" stroke="#41506b"/>`;
function document(body,height,width=1920,art=null,footer='本地查询记录 · 仅统计已保存的成绩'){return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><clipPath id="review-clip"><rect width="${width}" height="${height}" rx="30"/></clipPath></defs><g clip-path="url(#review-clip)"><rect width="${width}" height="${height}" fill="#111a2a"/>${art?`<image width="${width}" height="${height}" href="${e(art.data)}" preserveAspectRatio="xMidYMid slice"/><rect width="${width}" height="${height}" fill="#111a2a" fill-opacity=".6"/>`:''}<g font-family="Segoe UI, Microsoft YaHei, sans-serif">${body}${t(64,height-32,footer,19,'#aebed6')}</g></g></svg>`;}
const stats=s=>{const j=s.statistics||{};return [j.perfect??j.count_geki,j.great??j.count_300,j.good??j.count_katu,j.ok??j.count_100,j.meh??j.count_50,j.miss??j.count_miss];};
export function compareSvg(result){
  const [old,current]=result.scores;
  const columnWidth=1072/4,newerX=64+columnWidth*1.5,olderX=64+columnWidth*2.5;
  const difference=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)?b-a:null;
  const changes=[difference(old.accuracy,current.accuracy),difference(old.pp,current.pp),difference(old.max_combo,current.max_combo),...stats(old).map((v,i)=>difference(v,stats(current)[i]))];
  const color=(delta,lower=false)=>delta==null||delta===0?'#b9c9e0':(lower?delta<0:delta>0)?'#94ddcd':'#f39aaf';
  const signed=(n,d=0)=>n==null?'—':`${n>0?'+':''}${f(n,d)}`;
  const recent=result.source==='recent';
  const date=s=>{const time=playedTime(s);return time==null?'时间未知':new Date(time+8*3600000).toISOString().slice(0,19).replace('T',' ');};
  let out=t(64,55,'MANIA / SCORE COMPARE',22,'#8cafff')+t(64,117,`${result.user.username} · ${recent?'最近两次成绩对比':'可获取记录对比'}`,38)+t(64,161,(current.beatmapset?.title||'同一谱面').slice(0,55),26,'#b4c3dd');
  const summary=[['准确率变化',changes[0]==null?'—':signed(changes[0]*100,2)+'%',color(changes[0])],['PP 变化',signed(changes[1],2)+(changes[1]==null?'':' pp'),color(changes[1])],['连击变化',signed(changes[2])+(changes[2]==null?'':'×'),color(changes[2])],['MISS 变化',signed(changes[8]),color(changes[8],true)]];
  summary.forEach(([name,value,c],i)=>{const x=64+i*272;out+=`<rect x="${x}" y="197" width="256" height="112" rx="22" fill="#122032" fill-opacity=".8" stroke="${c}" stroke-opacity=".35"/>`+t(x+18,234,name,20,'#bdcce2')+t(x+128,282,value,31,c,'middle');});
  out+=t(newerX,337,'较新一次',23,'#94ddcd','middle')+t(olderX,337,'较早一次',23,'#8fbaff','middle')+t(1108,353,'变化',23,'#b4c3dd','end');
  out+=t(newerX,363,date(current),18,'#b4c3dd','middle')+t(olderX,363,date(old),18,'#b4c3dd','middle');
  const rows=[['准确率',pct(old.accuracy),pct(current.accuracy),Number.isFinite(old.accuracy)&&Number.isFinite(current.accuracy)?`${current.accuracy>=old.accuracy?'+':''}${((current.accuracy-old.accuracy)*100).toFixed(2)} 个百分点`:'—'],['PP',f(old.pp,2),f(current.pp,2),Number.isFinite(old.pp)&&Number.isFinite(current.pp)?`${current.pp>=old.pp?'+':''}${f(current.pp-old.pp,2)} pp`:'—'],['最大连击',f(old.max_combo),f(current.max_combo),Number.isFinite(old.max_combo)&&Number.isFinite(current.max_combo)?`${current.max_combo>=old.max_combo?'+':''}${f(current.max_combo-old.max_combo)}`:'—']];
  const a=stats(old),b=stats(current);
  ['MAX','300','200','100','50','MISS'].forEach((name,i)=>rows.push([name,f(a[i]),f(b[i]),Number.isFinite(a[i])&&Number.isFinite(b[i])?`${b[i]>=a[i]?'+':''}${f(b[i]-a[i])}`:'—']));
  rows.forEach(([name,a,b,d],i)=>{const y=377+i*64,delta=changes[i],c=i===4?'#b9c9e0':color(delta,i>=5);if(i===0)d=delta==null?'—':signed(delta*100,2)+'%';if(i===1){a=old.pp==null?'—':a+' pp';b=current.pp==null?'—':b+' pp';}if(i===2){a=old.max_combo==null?'—':a+'×';b=current.max_combo==null?'—':b+'×';}out+=box(64,y,1072,56).replace('fill="#222e43"','fill="#122032" fill-opacity=".78"')+t(92,y+37,name,24)+t(newerX,y+37,b,29,'#fff','middle')+t(olderX,y+37,a,29,'#8fbaff','middle')+t(1108,y+37,d,24,c,'end');});
  out+=t(92,993,'MODS',23)+modIcons(current,newerX,969,32,180,'center')+modIcons(old,olderX,969,32,180,'center');
  out+=t(64,1044,'绿色：改善 · 红色：下降 · 灰色：持平或仅数量变化',20,'#bdcce2');
  out+=t(64,1083,'变化＝较新 − 较早（时间为 UTC+8）；Mods 不同时不代表同条件提升。',20,'#e8c886');
  const footer=recent?'数据来源：官方最近 100 条记录（含失败），筛选此谱面最新两条。':'最近记录不足：合并接口保留成绩与本地记录，无法保证是最后两次游玩。';
  return document(out,1150,1200,result.assets?.art,footer);
}
export function reportSvg(result){
  const panel=(...args)=>box(...args).replace('fill="#222e43"','fill="#122032" fill-opacity=".64"');
  const profiles=result.profiles,first=profiles[0],last=profiles.at(-1),delta=profiles.length>=2&&Number.isFinite(first.pp)&&Number.isFinite(last.pp)?last.pp-first.pp:null;
  let out=t(64,62,'MANIA / OBSERVED HISTORY',22,'#8cafff')+t(64,133,`${result.user.username} · ${result.days===7?'周报':'月报'}`,44);
  out+=t(64,182,`最近 ${result.days} 天 · 仅统计启用后查询到的记录，不代表全部游玩`,24,'#b4c3dd');
  const values=[['已保存成绩',f(result.scores.length)+' 条'],['总 PP 变化',delta==null?'样本不足':`${delta>=0?'+':''}${f(delta,2)} pp`],['资料快照',f(profiles.length)+' 次']];
  values.forEach(([name,value],i)=>{out+=panel(64+i*608,220,576,145)+t(91+i*608,268,name,23,'#b4c3dd')+t(91+i*608,329,value,42,i===1?'#94ddcd':'#fff');});
  out+=panel(64,395,1792,260)+t(91,447,'总 PP 记录',26);
  const valid=profiles.filter(p=>Number.isFinite(p.pp));
  if(valid.length>=2){const lo=Math.min(...valid.map(p=>p.pp)),hi=Math.max(...valid.map(p=>p.pp)),points=valid.map((p,i)=>`${112+i*1680/(valid.length-1)},${610-(p.pp-lo)/Math.max(1,hi-lo)*115}`).join(' ');out+=`<polyline points="${points}" fill="none" stroke="#94ddcd" stroke-width="5"/>`+t(112,639,valid[0].observedAt.slice(0,10),17,'#b4c3dd')+t(1792,639,valid.at(-1).observedAt.slice(0,10),17,'#b4c3dd','end');}
  else out+=t(91,541,'积累至少两次资料快照后，显示变化曲线。',27,'#b4c3dd');
  out+=t(64,713,'最近保存的成绩',28);
  result.scores.slice(-4).reverse().forEach((s,i)=>{const y=746+i*89;out+=panel(64,y,1792,77)+t(91,y+47,(s.beatmapset?.title||'谱面').slice(0,42),25)+t(1225,y+47,pct(s.accuracy),28,'#fff','end')+t(1580,y+47,s.pp==null?'PP 未提供':f(s.pp,2)+' pp',27,'#e8c886','end')+modIcons(s,1630,y+25,28,180);});
  if(!result.observedFrom)out+=t(91,812,result.recordingEnabled===false?`记录已关闭。发送 ${result.commandPrefix||'!'}记录 开启，再查询成绩。`:'尚无记录。默认已开启记录，查询成绩后开始积累。',27,'#b4c3dd');
  if(result.demo)out+=t(64,1150,'示例数据 · 仅展示周报布局，未写入真实历史',23,'#e8c886');
  return document(out,1230,1920,result.assets?.art);
}
