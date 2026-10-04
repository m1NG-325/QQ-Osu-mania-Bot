// All identities and scores below are fictional fixtures.
export const demoUser = {
  id: 10001, username: 'Demo Player', country_code: 'CN',
  rank_history: { data: Array.from({ length: 90 }, (_, i) => Math.round(15400 - i * 32 + Math.sin(i / 7) * 240)) },
  rank_highest: { rank: 11742, updated_at: '2026-09-12T12:00:00Z' },
  monthly_playcounts: Array.from({ length: 24 }, (_, i) => ({ start_date: `202${i < 12 ? 5 : 6}-${String(i % 12 + 1).padStart(2, '0')}-01`, count: Math.round(400 + Math.sin(i) * 220 + i * 23) })),
  beatmap_playcounts_count: 2846, replays_watched_counts: 21, user_achievements: Array.from({ length: 64 }, (_, i) => ({ achievement_id: i + 1 })),
  statistics: {
    pp: 4286.35, global_rank: 12345, country_rank: 856,
    hit_accuracy: 98.67, play_count: 18642, play_time: 658800,
    level: { current: 96, progress: 42 }, maximum_combo: 2841,
    total_hits: 12647290, ranked_score: 2386541208, total_score: 49781642519,
    grade_counts: { ssh: 12, ss: 38, sh: 64, s: 226, a: 417 }
  }
};

export const demoMap = {
  id: 100001, mode: 'mania', cs: 4, difficulty_rating: 5.42,
  version: '4K / Demo difficulty', bpm: 180, total_length: 168,
  hit_length: 155, accuracy: 8, drain: 7, max_combo: 1842,
  status: 'ranked', count_circles: 1320, count_sliders: 261,
  density: Array.from({ length: 40 }, (_, i) => Math.round(15 + Math.abs(Math.sin(i * .38)) * 58 + Math.sin(i * 1.3) * 10)),
  beatmapset: {
    id: 10000, title: 'Neon Skyline', artist: 'Demo Artist',
    creator: 'Demo Mapper', covers: {}
  }
};

export const demoScores = Array.from({ length: 20 }, (_, i) => ({
  id: 200001 + i, pp: +(328.64 - i * 8.17).toFixed(2),
  accuracy: +(0.9921 - i * 0.0008).toFixed(4),
  score: 986421 - i * 3921, max_combo: 1632 - i * 23,
  rank: i < 5 ? 'S' : 'A', passed: true,
  mods: i % 3 === 0 ? ['DT'] : [],
  created_at: new Date(Date.UTC(2026, 9, 1, 12, 0) - i * 3600000).toISOString(),
  statistics: { count_geki: 1100 - i, count_300: 182 + i, count_katu: 21,
    count_100: 5, count_50: 1, count_miss: 3 },
  beatmap: { ...demoMap, id: demoMap.id + i,
    difficulty_rating: +(5.42 - i * 0.06).toFixed(2),
    beatmapset: undefined },
  beatmapset: { ...demoMap.beatmapset,
    title: ['Neon Skyline', 'Crystal Rain', 'After Midnight', 'Blue Horizon'][i % 4] }
}));

export class DemoApi {
  async rawMap() {
    const objects = [];
    for (let i=0;i<900;i++) {
      const time=1000+i*125, col=i%4, x=64+col*128;
      objects.push(`${x},192,${time},${i%12===0?128:1},0,${i%12===0?`${time+100}:`:''}0:0:0:0:`);
      if(i%3===0)objects.push(`${64+(col+2)%4*128},192,${time},1,0,0:0:0:0:`);
    }
    return `osu file format v14\n[General]\nMode:3\n[Metadata]\nTitle:Neon Skyline (Demo)\nArtist:Demo\nCreator:Demo\nVersion:4K\n[Difficulty]\nCircleSize:4\nOverallDifficulty:8\n[TimingPoints]\n0,333.333,4,2,0,100,1,0\n[HitObjects]\n${objects.join('\n')}\n`;
  }
  async user(name) { return { ...demoUser, username: !name || /^\d+$/.test(name) ? demoUser.username : name }; }
  async scores(_id, type, limit = 10, offset = 0) {
    return demoScores.slice(offset, offset+limit);
  }
  async bestScores() { return demoScores; }
  async recommendationSnapshot(id) {
    return {status:'ready',userId:id,peerBand:{count:20},totalQualifying:6,
      recs:Array.from({length:6},(_,i)=>({beatmapId:110000+i,beatmapsetId:11000+i,title:'Demo practice',
        artist:'Demo',creator:'Demo',version:'4K demo',keys:4,status:'ranked',stars:5,
        recommendedMods:i%2?[]:['HT'],speedBucket:i%2?'normal':'ht',bpm:180,lengthSec:168,
        reason:i%2?'push':'improve',benchmarkPp:340-i*5,subjectPp:320-i*5,estimatedPpGain:15-i,
        subjectAccuracy:.97,pushTargetAccuracy:.975,peerCount:10,peerSampleSize:20}))};
  }
  async map(id) { return { ...demoMap, id: Number(id) }; }
  async mapScores() { return demoScores.slice(0,3); }
  async mapset(id) { return {...demoMap.beatmapset,id:Number(id),beatmaps:demoScores.slice(0,6).map(s=>s.beatmap)}; }
  async searchMaps() { return [{...demoMap}]; }
  async mapper() {
    return { followers: 128, ranked: 12, pending: 4, graveyard: 23,
      favourites: 482, plays: 186420,
      genres: [{ label: 'Electronic', count: 14 }, { label: 'Anime', count: 7 }, { label: 'Rock', count: 4 }, { label: 'Other', count: 3 }],
      languages: [{ label: 'Japanese', count: 16 }, { label: 'English', count: 8 }, { label: 'Instrumental', count: 4 }],
      difficulties: [1, 2, 4, 9, 14, 8, 3, 1], lengths: [2, 6, 10, 13, 8, 3, 2, 1],
      maps: demoScores.slice(0, 6), activities: ['Published Neon Skyline', 'Updated Crystal Rain', 'Guest difficulty: After Midnight'] };
  }
}
