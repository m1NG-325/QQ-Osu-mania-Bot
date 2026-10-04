import {UserError} from './osu.js';

export function playedTime(score){
  for(const value of [score.ended_at,score.created_at]){
    const time=Date.parse(value);
    if(Number.isFinite(time))return time;
  }
  return null;
}
export function latestPair(scores,mapId){
  const unique=new Map();
  for(const score of scores){
    if(String(score.beatmap?.id??score.beatmap_id)!==String(mapId)||playedTime(score)==null)continue;
    const key=score.id!=null?`id:${score.id}`:`play:${playedTime(score)}:${score.max_combo}:${score.total_score??score.legacy_total_score}:${JSON.stringify(score.mods||[])}`;
    if(!unique.has(key))unique.set(key,score);
  }
  return [...unique.values()].sort((a,b)=>playedTime(b)-playedTime(a)).slice(0,2).reverse();
}
export async function recentScoreCompare(api,history,user,mapId,sender='local'){
  const recent=await api.scores(user.id,'recent',100);
  let scores=latestPair(recent,mapId),source='recent';
  if(scores.length<2){
    const retained=(await api.mapScores(mapId,user.id)).map(s=>({...s,beatmap:{...s.beatmap,id:mapId}}));
    const saved=(history?.records ? history.records(user,sender) : (history?.rows||[]).filter(r=>r.userId===String(user.id)&&(r.sender===sender||!r.sender&&sender==='local'))).filter(r=>r.type==='score').map(r=>r.score);
    scores=latestPair([...recent,...retained,...saved],mapId);
    source='available';
  }
  if(scores.length<2)throw new UserError('这张谱面可获取的成绩不足两条，无法对比。最近记录、保留成绩和本地记录不等于完整游玩历史。');
  const map=await api.map(mapId);
  return {kind:'compare',user,map,source,scores:scores.map(s=>({...s,beatmap:map,beatmapset:map.beatmapset}))};
}
