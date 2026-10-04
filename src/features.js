import {UserError} from './osu.js';
import {mapId} from './bot.js';
import {filters} from './map-index.js';
import {scoreClient} from './time-best.js';
const num=(n,d=0)=>Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:d}):'—';
const acc=n=>Number.isFinite(n)?(n*100).toFixed(2)+'%':'—';
const value=s=>s.total_score||s.legacy_total_score||s.score||0;
export function modsKey(s){return (s.mods||[]).map(m=>typeof m==='string'?m:m.acronym+(m.settings?JSON.stringify(m.settings,Object.keys(m.settings).sort()):'')).filter(m=>m!=='CL'&&m!=='NM').sort().join('+')||'NM';}
const best=scores=>scores.filter(s=>s.passed!==false).sort((a,b)=>value(b)-value(a)||((b.pp??0)-(a.pp??0)))[0];
const base=(title,subtitle,columns,rows,extra={})=>({kind:'feature',title,subtitle,columns,rows,...extra});
function sameMapScores(scores,map){return scores.map(s=>({...s,beatmap:map,beatmapset:map.beatmapset}));}
export function comparePlayers(argument){
  const names=[],pairs={'（':'）','(':')','"':'"',"'":"'"};let at=0;
  while(at<argument.length){
    if(/\s/.test(argument[at])){at++;continue;}
    const close=pairs[argument[at]];
    if(close){
      const end=argument.indexOf(close,at+1);
      if(end<0)throw new UserError('玩家名的括号未闭合；例如 !对比 （Player A） ExamplePlayer。');
      const name=argument.slice(at+1,end).trim();
      if(!name)throw new UserError('括号内请填写玩家名。');
      names.push(name);at=end+1;
    }else{
      const name=argument.slice(at).match(/^\S+/)[0];
      names.push(name);at+=name.length;
    }
  }
  return names;
}
export async function featureCommand(bot,action,argument,sender,context={}){
  const api=bot.api;
  if(action==='随机'||action==='练习'){
    if(!bot.mapIndex)throw new UserError('谱面索引尚未加载。');
    const f=filters(argument,action==='练习'),row=await bot.mapIndex.pick(api,f),map=row.map;
    return base(action==='随机'?'随机练习谱面':`${f.pattern} 键型练习`,`${f.keys}K · 从 ${bot.mapIndex.rows.size} 张已分析谱面中筛选`,['曲名 / 难度','星数','时长 / LN'],[[`${map.beatmapset?.title||'—'}\n${map.version}`,num(map.difficulty_rating,2)+' ★',`${map.total_length??Math.round(row.length)} 秒 / ${acc(row.lnRatio)}`]],{map,variant:action==='随机'?'random-map':'practice-map',notes:[`谱面 ID ${map.id} · NM 条件，星数为官方字段`,`Jack / Stream / Tech / JHS 以有效键型时长占比 ≥15% 为匹配条件；LN ≥37.5%。`],links:[`https://osu.ppy.sh/beatmaps/${map.id}`]});
  }
  if(action==='我的成绩'){
    const [id,...name]=argument.split(/\s+/),target=name.join(' ')||bot.bindings.get(sender);
    if(!target)throw new UserError('先 !bind ExamplePlayer，或 !我的成绩 谱面ID 玩家名。');
    const map=await api.map(mapId(id));if(map.mode!=='mania')throw new UserError('仅支持 osu!mania 谱面。');
    const user=await api.user(target),scores=sameMapScores(await api.mapScores(map.id,user.id),map);
    if(!scores.length)return {kind:'text',text:`${user.username} 在这张谱面没有接口可返回的成绩。未上架谱面或未提交记录可能无法查询。`};
    const top=best(scores);
    const shown=scores.sort((a,b)=>value(b)-value(a)).slice(0,20);
    return base(`${user.username} · 此图成绩`,`${map.beatmapset?.title} · ${map.version}`,['#','Mods','客户端','准确率','PP','连击','分数'],shown.map((s,i)=>[String(i+1),modsKey(s),scoreClient(s),acc(s.accuracy),num(s.pp,2),`${num(s.max_combo)}×`,num(value(s))]),{variant:'map-scores',map,user,scores:shown,notes:[`接口返回 ${scores.length} 条保留成绩，显示 ${shown.length} 条（最多 20 条）；不等于完整游玩历史。`,`最高分：${top?`${num(value(top))} · ${modsKey(top)} · ${acc(top.accuracy)}`:'没有通过成绩'}`],links:[`https://osu.ppy.sh/beatmaps/${map.id}`]});
  }
  if(action==='谱包'){
    const map=await api.map(mapId(argument)),set=await api.mapset(map.beatmapset_id||map.beatmapset?.id);
    const modes={osu:'osu!',taiko:'太鼓',fruits:'接水果',mania:'mania'};
    return base(set.title,`${set.artist} · ${set.creator} · 谱包 ID ${set.id}`,['难度 / ID','模式 / 键数','星数'],(set.beatmaps||[]).sort((a,b)=>(a.mode||'').localeCompare(b.mode||'')||a.difficulty_rating-b.difficulty_rating).map(m=>[`${m.version}\nID ${m.id}`,`${modes[m.mode]||m.mode}${m.mode==='mania'?` / ${m.cs}K`:''}`,num(m.difficulty_rating,2)+' ★']),{variant:'mapset',notes:[set.availability?.download_disabled?'官方已禁用下载。':'下载镜像：catboy.best / osu.direct / 小夜（无视频）。'],links:[`https://osu.ppy.sh/beatmapsets/${set.id}`,...(set.availability?.download_disabled?[]:[`https://catboy.best/d/${set.id}`,`https://osu.direct/api/d/${set.id}`,`https://txy1.sayobot.cn/beatmaps/download/novideo/${set.id}`])]});
  }
  if(action==='群榜'){
    if(!context.groupId||!Array.isArray(context.members))throw new UserError('请在群内使用 !群榜 谱面ID；需要读取当前群成员列表。');
    const [id,...options]=argument.split(/\s+/),grouping=options.some(s=>['mods','Mods','分组'].includes(s));
    if(options.some(s=>!['mods','Mods','分组'].includes(s)))throw new UserError('用法：!群榜 谱面ID [mods]。');
    const map=await api.map(mapId(id));if(map.mode!=='mania')throw new UserError('仅支持 osu!mania 谱面。');
    const users=[...new Set(context.members.map(member=>bot.bindings.get(`qq:${member.user_id}`)).filter(Boolean))];
    if(!users.length)return {kind:'text',text:'本群成员还没有绑定 osu! 玩家。先发送 !bind 玩家名。'};
    const selected=users,items=[];let failed=0;
    for(let i=0;i<selected.length;i+=2)await Promise.all(selected.slice(i,i+2).map(async id=>{try{const user=await api.user(id),scores=await api.mapScores(map.id,id);if(grouping){const groups=new Map();for(const s of scores){const key=modsKey(s)+' / '+scoreClient(s);const previous=groups.get(key);if(s.passed!==false&&(!previous||value(s)>value(previous)))groups.set(key,s);}for(const [group,s]of groups)items.push({user,s,group});}else{const s=best(scores);if(s)items.push({user,s,group:''});}}catch{failed++;}}));
    items.sort((a,b)=>a.group.localeCompare(b.group)||value(b.s)-value(a.s));
    const entries=items.slice(0,50);
    return base('同图群友榜',`${map.beatmapset?.title} · ${map.version}`,['名次','玩家','分数','准确率','PP'],entries.map((item,i)=>[`#${i+1}`,item.user.username+(grouping?'\n'+item.group:''),num(value(item.s)),`${acc(item.s.accuracy)} (${scoreClient(item.s)})`,`${num(item.s.pp,2)} pp`]),{variant:'group-board',map,entries,notes:[`本群绑定 ${users.length} 位；已查 ${selected.length} 位；接口失败 ${failed} 位。`,`同组按分数降序；不同 Mods / 客户端的分数条件可能不同。`,...(items.length>50?[`共有 ${items.length} 条上榜记录，图片展示排序后的前 50 条。`]:[])],links:[`https://osu.ppy.sh/beatmaps/${map.id}`]});
  }
  if(action==='对比'&&!/^\d+$/.test(argument)&&!/^https?:/.test(argument)){
    const names=comparePlayers(argument);
    if(names.length<2||names.length>4)throw new UserError('用法：!对比 玩家A 玩家B，最多 4 位；含空格的玩家名用（）。例如 !对比 （Player A） ExamplePlayer。');
    const users=await Promise.all(names.map(name=>api.user(name))),bps=await Promise.all(users.map(user=>api.scores(user.id,'best',100,0)));
    const metrics=[['总 PP',u=>Number.isFinite(u.statistics?.pp)?num(u.statistics.pp,2)+' pp':'—'],['全球排名',u=>Number.isFinite(u.statistics?.global_rank)?'#'+num(u.statistics.global_rank):'—'],['地区排名',u=>`${u.country_code||'—'} #${num(u.statistics?.country_rank)}`],['准确率',u=>u.statistics?.hit_accuracy==null?'—':num(u.statistics.hit_accuracy,2)+'%'],['游玩次数',u=>num(u.statistics?.play_count)]];
    const rows=metrics.map(([name,fn])=>[name,...users.map(fn)]);
    const comparisons=['pp','global_rank','country_rank','hit_accuracy','play_count'].map((key,i)=>({values:users.map(u=>u.statistics?.[key]??null),unit:['pp','名','名','百分点','次'][i],better:i===1||i===2?'low':i===4?null:'high',bar:i===0||i===3,comparable:i!==2||users.every(u=>u.country_code===users[0].country_code)}));
    for(const [lo,hi]of [[1,10],[11,50],[51,100]]){
      const averages=bps.map(scores=>{const values=scores.slice(lo-1,hi).map(s=>s.pp).filter(Number.isFinite);return values.length?values.reduce((n,v)=>n+v,0)/values.length:null;});
      rows.push([`BP ${lo}–${hi} 平均 PP`,...averages.map(n=>n==null?'—':num(n,2)+' pp')]);
      comparisons.push({values:averages,unit:'pp',better:'high',bar:true,comparable:true});
    }
    rows.push(['BP 样本数',...bps.map(scores=>num(scores.length))]);
    comparisons.push({values:bps.map(s=>s.length),unit:'条',better:null,bar:false,comparable:true});
    return base('多人资料对比','osu!mania · 官方资料与当前 BP 样本',['项目',...users.map(u=>u.username)],rows,{variant:'profile-compare',users,comparisons,notes:['BP 分布按当前前 100 条分段统计，样本不足时只使用实际返回值。']});
  }
  return null;
}
