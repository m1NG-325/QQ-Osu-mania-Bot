import { UserError } from './osu.js';
import { modStars } from './compute.js';

const caches = new WeakMap();
const reasons = { missing:'New mod / map', improve:'Improve score', stale:'Old BP', push:'Skill push' };

export async function recommendMaps(api, user, _best, { difficulty = modStars } = {}) {
  const snapshot = await api.recommendationSnapshot(user.id);
  if (Number(snapshot.userId) !== Number(user.id)) throw new UserError('推荐数据与查询玩家不一致，请稍后重试。');
  if (snapshot.status !== 'ready') throw new UserError('相近玩家推荐数据尚未准备好，请稍后再试。');
  const ids = new Set();
  const candidates = (snapshot.recs || []).filter(row => {
    const key = `${row.beatmapId}:${row.speedBucket}`;
    if (!Number.isSafeInteger(row.beatmapId) || row.beatmapId <= 0 || !Number.isSafeInteger(row.beatmapsetId)
      || !['ranked','approved'].includes(row.status) || !Number.isInteger(row.keys)
      || !Number.isFinite(row.benchmarkPp) || row.benchmarkPp <= 0
      || !Number.isFinite(row.estimatedPpGain) || row.estimatedPpGain <= 0
      || row.clearRisk === true || !reasons[row.reason] || !Array.isArray(row.recommendedMods)
      || row.recommendedMods.some(m => typeof m !== 'string' || !/^[A-Z0-9]{2,3}$/.test(m)) || ids.has(key)) return false;
    ids.add(key); return true;
  }).sort((a,b) => b.estimatedPpGain-a.estimatedPpGain).slice(0,6);
  if (!candidates.length) throw new UserError('当前没有可信的正收益推荐，暂不按星数随意补图。');
  const items = [];
  for (let offset=0;offset<candidates.length;offset+=3) {
    const batch = await Promise.all(candidates.slice(offset,offset+3).map(async row => {
      let stars = null;
      try { stars = await difficulty(await api.rawMap(row.beatmapId), { mods:row.recommendedMods, legacy_score_id:1 }); }
      catch { /* Keep the peer recommendation; omit unavailable mod difficulty. */ }
      return { map:{id:row.beatmapId,mode:'mania',cs:row.keys,status:row.status,
          difficulty_rating:row.stars,version:row.version,bpm:row.bpm,total_length:row.lengthSec,
          beatmapset:{id:row.beatmapsetId,title:row.title,artist:row.artist,creator:row.creator,
            covers:{cover:row.cover,'cover@2x':row.cover,list:row.listCover,'list@2x':row.listCover}}},
        mods:row.recommendedMods, stars:Number.isFinite(stars)?stars:null,
        pp:row.benchmarkPp, gain:row.estimatedPpGain, ownPp:row.subjectPp,
        otherPp:row.subjectOtherLanePp, otherMods:row.subjectOtherLaneSpeed,
        accuracy:row.pushTargetAccuracy == null ? null : row.pushTargetAccuracy*100,
        ownAccuracy:row.subjectAccuracy == null ? null : row.subjectAccuracy*100,
        source:reasons[row.reason], reason:row.reason, peers:row.peerCount, sampleSize:row.peerSampleSize };
    }));
    items.push(...batch);
  }
  return {kind:'recommend',user,profile:{peerCount:snapshot.peerBand?.count||0,
    source:'Mania Tracker',available:snapshot.totalQualifying||items.length},items,demo:false};
}

export async function recommendations(api,user,best) {
  let cache=caches.get(api);if(!cache){cache=new Map();caches.set(api,cache);}
  const key=String(user.id),hit=cache.get(key);
  if(hit&&Date.now()-hit.time<300000)return hit.promise;
  const promise=recommendMaps(api,user,best);
  cache.set(key,{time:Date.now(),promise});if(cache.size>32)cache.delete(cache.keys().next().value);
  try{return await promise;}catch(error){cache.delete(key);throw error;}
}
