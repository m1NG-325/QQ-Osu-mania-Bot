import test from 'node:test';
import assert from 'node:assert/strict';
import { timeBestArgument, recentBest, scoreClient } from '../src/time-best.js';
import { Bot, parseCommand } from '../src/bot.js';
import { OsuApi } from '../src/osu.js';
import { cardSvg } from '../src/cards.js';

test('time best command accepts fullwidth prefix, preserves names and restricts days', () => {
  assert.deepEqual(parseCommand('！tbp#15 mugen neko'), { action: 'tbp', argument: '#15 mugen neko' });
  assert.deepEqual(timeBestArgument('#7 mugen neko'), { days: 7, target: 'mugen neko' });
  assert.deepEqual(timeBestArgument(''), { days: 30, target: '' });
  for (const value of ['#0','#31','#-7','#1.5','#7abc','#']) assert.throws(() => timeBestArgument(value));
  assert.equal(parseCommand('!tbpx'), null);
});

test('client labels use official modern score fields and support old scores', () => {
  assert.equal(scoreClient({ legacy_score_id: 123, build_id: null }), 'Stable');
  assert.equal(scoreClient({ legacy_total_score: 950000 }), 'Stable');
  assert.equal(scoreClient({ legacy_score_id: null, legacy_total_score: 0, build_id: 8936 }), 'Lazer');
  assert.equal(scoreClient({ is_lazer: true }), 'Lazer');
  assert.equal(scoreClient({ is_lazer: false }), 'Stable');
  assert.equal(scoreClient({ created_at: '2026-10-01', score: 950000 }), 'Stable');
  assert.equal(scoreClient({}), '—');
});

test('time filtering uses inclusive boundaries, modern and legacy timestamps and original BP positions', () => {
  const now=Date.parse('2026-10-02T12:00:00Z');
  const at=days => new Date(now-days*86400000).toISOString();
  const scores=[{ ended_at: at(31) }, { ended_at: at(7), created_at:at(31) }, { created_at:at(1) }, { ended_at:at(-1) }, {ended_at:'bad'}, { ended_at:at(0), passed:false }];
  assert.deepEqual(recentBest(scores,7,now).map(s=>s.bpRank),[2,3]);
  assert.deepEqual(recentBest(scores,1,now).map(s=>s.bpRank),[3]);
  const sheet=cardSvg({kind:'timebest',user:{username:'Demo'},days:30,scores:Array.from({length:140},(_,i)=>({bpRank:i+1})),queriedAt:new Date(now).toISOString()});
  assert.match(sheet,/height="8902"/);
  assert.equal((sheet.match(/>#[0-9]+<\/text>/g)||[]).length,140);
  assert.match(sheet,/>#140<\/text>/);
});

test('best lookup reads second page even if all first page dates are old and caches queries', async () => {
  const paths=[];const api=new OsuApi({});
  api.get=async path=> {paths.push(path);return path.includes('offset=100') ? [{ ended_at:new Date().toISOString() }] : Array.from({length:100},()=>({created_at:'2020-01-01T00:00:00Z'}));};
  const best=await api.bestScores(42);
  assert.equal(best.length,101);assert.equal(recentBest(best,30)[0].bpRank,101);
  await api.bestScores(42);assert.equal(paths.length,2);assert.match(paths[1],/offset=100/);
  const bot=new Bot({api:{user:async name=>({id:42,username:name}),bestScores:async()=>best},bindings:{get:()=> 'Bound Player'},demo:false});
  const result=await bot.run('!tbp#7');assert.equal(result.user.username,'Bound Player');assert.equal(result.scores[0].bpRank,101);
  assert.equal((await bot.run('!tbp#15 Other Player')).user.username,'Other Player');
  const empty=cardSvg({kind:'timebest',user:{id:42,username:'A & B'},days:7,scores:[],queriedAt:new Date().toISOString()});
  assert.match(empty,/No new best performances/);assert.match(empty,/A &amp; B/);
});
