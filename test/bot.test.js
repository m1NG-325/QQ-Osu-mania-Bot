import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bot, parseCommand, mapId } from '../src/bot.js';
import { DemoApi } from '../src/demo.js';
import { OsuApi } from '../src/osu.js';
import { renderCard, cardSvg, prepareImage } from '../src/cards.js';
import { groupCommand } from '../src/group-command.js';
const { default: sharp } = await import('sharp');

function memory() {
  const data = new Map();
  return { get: key => data.get(key), set: async (key, value) => data.set(key, value), remove: async key => data.delete(key) };
}
const makeBot = () => new Bot({ api: new DemoApi(), bindings: memory() });

test('commands preserve names, accept attached map IDs, reject unrelated messages', () => {
  assert.deepEqual(parseCommand('！ i Demo Player'), { action: 'i', argument: 'Demo Player' });
  assert.deepEqual(parseCommand('!gb4854853'), { action: 'gb', argument: '4854853' });
  assert.equal(parseCommand('!invalid'), null);
  assert.equal(parseCommand('hello'), null);
  assert.equal(mapId('https://osu.ppy.sh/beatmapsets/10#mania/42'), '42');
  assert.throws(() => mapId('https://example.com/42'));
});

test('binding is per sender and can be removed', async () => {
  const bot = makeBot();
  await assert.rejects(() => bot.run('!i'), /先用/);
  await bot.run('!bind Demo Player', 'a');
  assert.equal((await bot.run('!i', 'a')).kind, 'profile');
  await assert.rejects(() => bot.run('!i', 'b'));
  await bot.run('!unbind', 'a');
  await assert.rejects(() => bot.run('!i', 'a'));
});

test('group members keep distinct bindings and can query other players without changing them', async () => {
  const users = { Alice: { id: 11, username: 'Alice' }, Bob: { id: 22, username: 'Bob' } };
  const api = new DemoApi();
  api.user = async name => ({ ...await new DemoApi().user(), ...(users[name] || Object.values(users).find(user => String(user.id) === name)) });
  const bot = new Bot({ api, bindings: memory(), demo: false });
  await bot.run('!bind Alice', 'qq:1'); await bot.run('!bind Bob', 'qq:2');
  assert.equal((await bot.run('!i', 'qq:1')).user.id, 11);
  assert.equal((await bot.run('!i', 'qq:2')).user.id, 22);
  assert.equal((await bot.run('!i Bob', 'qq:1')).user.id, 22);
  assert.match((await bot.run('!bind', 'qq:1')).text, /Alice/);
  await bot.run('!unbind', 'qq:1');
  assert.equal((await bot.run('!i', 'qq:2')).user.id, 22);
  assert.match((await bot.run('!bind', 'qq:1')).text, /还没有绑定/);
  assert.ok(!(await bot.run('!help')).text.includes('!im'));
});

test('group commands accept mentions of this bot but ignore mentions of others', () => {
  const event = { self_id: 99, message: [{ type: 'at', data: { qq: '99' } }, { type: 'text', data: { text: ' !i Alice ' } }] };
  assert.equal(groupCommand(event), '!i Alice');
  assert.equal(groupCommand({ ...event, message: [{ type: 'at', data: { qq: '88' } }, ...event.message.slice(1)] }), '');
  assert.equal(groupCommand({ raw_message: '!help' }), '!help');
});

test('all card commands produce valid PNGs of the expected size', async () => {
  const bot = makeBot();
  for (const command of ['!i Demo Player', '!p Demo Player', '!ps Demo Player', '!bp Demo Player', '!m 42', '!im Demo Player']) {
    const result = await bot.run(command);
    const png = await renderCard(result);
    const metadata = await sharp(png).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 1920);
    assert.equal(metadata.height, result.kind === 'scores' ? 1450 : result.kind === 'map' ? 1670 : result.kind === 'score' ? 1102 : 1200);
    assert.equal(result.demo, true);
  }
  assert.equal((await bot.run('!gb 42')).kind, 'text');
});

test('panel text is escaped and unavailable charts are explicit', async () => {
  const bot = makeBot();
  const result = await bot.run('!i <script>test</script>');
  result.user.rank_history = null;
  const svg = cardSvg(result);
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(svg.includes('No data available'));
  const live = new Bot({ api: new DemoApi(), bindings: memory(), demo: false });
  await assert.rejects(() => live.run('!im Demo Player'), /仅提供本地演示/);
});

test('osu API reuses token, encodes names, and queries mania', async () => {
  const calls = [];
  const api = new OsuApi({ clientId: '1', clientSecret: 'test-only', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => url.endsWith('/oauth/token') ? { access_token: 'fixture', expires_in: 3600 } : { id: 1 } };
  } });
  await Promise.all([api.user('Test Player'), api.user('Test Player')]);
  await api.scores(1, 'recent', 10);
  assert.equal(calls.filter(c => c.url.endsWith('/oauth/token')).length, 1);
  assert.ok(calls.some(c => c.url.endsWith('users/Test%20Player/mania')));
  assert.ok(calls.some(c => c.url.includes('mode=mania&limit=10&include_fails=1')));
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer fixture');
  assert.equal(calls.at(-1).options.headers['x-api-version'], '20220705');
});

test('lazer score uses official accuracy, total score, custom speed and modern judgments', () => {
  const score = { id: 7610121186, accuracy: .962888, total_score: 839915, legacy_total_score: 0,
    score: 0, max_combo: 284, pp: null, passed: true, rank: 'S',
    ended_at: '2026-10-02T08:23:19Z', mods: [{ acronym: 'DT', settings: { speed_change: 1.75 } }],
    statistics: { perfect: 542, great: 335, good: 48, ok: 6, meh: 1, miss: 8 },
    beatmap: { difficulty_rating: 2.75783, bpm: 190, total_length: 123, cs: 4, status: 'ranked' },
    beatmapset: { title: 'Meaning', artist: 'Shiena Nishizawa', creator: '[GraveChaos]' } };
  const result = { kind: 'score', scores: [score], demo: false };
  const svg = cardSvg(result);
  for (const expected of ['839,915','96.28%','DT 1.75×','332.5 BPM','1:10','2.75 ★','2026-10-02 16:23:19 UTC+8','Not provided by osu! API','aria-label="LAZER"']) assert.ok(svg.includes(expected), expected);
  assert.ok(!svg.includes('96.93%'));
  assert.ok(!svg.includes('No data available'));
  assert.ok(cardSvg({ ...result, scores: [{ ...score, total_score: 0, score: 839915 }] }).includes('>0</text>'), 'real zero total score is retained');
  assert.ok(cardSvg({ ...result, scores: [{ ...score, mods: ['HT'] }] }).includes('142.5 BPM'), 'legacy speed mods remain supported');
});

test('wide covers and portrait assets keep their original ratio without forced enlargement', async () => {
  for (const [width,height] of [[1000,280],[300,900]]) {
    const buffer=await sharp({create:{width,height,channels:3,background:'#778899'}}).png().toBuffer();
    const asset=await prepareImage(buffer);
    assert.equal(asset.width,width); assert.equal(asset.height,height);
    const bot=makeBot(); const result=await bot.run('!p Demo Player');
    result.assets={cover:asset};
    const svg=cardSvg(result);
    assert.ok(svg.includes(`viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice"`), 'background fills canvas proportionally');
    const mapSvg=cardSvg({kind:'map',map:result.scores[0].beatmap,assets:{cover:asset}});
    assert.ok(mapSvg.includes(`viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"`), 'map thumbnail retains whole image');
    assert.ok(mapSvg.includes(`preserveAspectRatio="xMidYMid slice"><use href="#cover"`), 'map canvas uses the beatmap background');
  }
});

test('score background prefers full artwork and falls back when it is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const sample = await sharp({create:{width:640,height:360,channels:3,background:'#123456'}}).jpeg().toBuffer();
  const calls=[];
  globalThis.fetch=async url=>{
    calls.push(String(url));
    if(String(url).includes('/987654322/')&&String(url).endsWith('fullsize.jpg')) return new Response(null,{status:404});
    return new Response(sample,{headers:{'Content-Type':'image/jpeg'}});
  };
  try {
    const bot=makeBot();
    for(const id of [987654321,987654322]) {
      const result=await bot.run('!p Demo Player');result.demo=false;
      result.scores[0]={...result.scores[0],beatmapset:{...result.scores[0].beatmapset,id,covers:{cover:`https://assets.ppy.sh/beatmaps/${id}/covers/cover.jpg`}}};
      await renderCard(result);
    }
    assert.ok(calls.includes('https://assets.ppy.sh/beatmaps/987654321/covers/fullsize.jpg'));
    assert.ok(calls.indexOf('https://assets.ppy.sh/beatmaps/987654322/covers/fullsize.jpg')<calls.indexOf('https://assets.ppy.sh/beatmaps/987654322/covers/cover.jpg'));
  } finally {globalThis.fetch=originalFetch;}
});

test('API handles missing credentials, unknown users, and rate limits', async () => {
  await assert.rejects(() => new OsuApi({}).user('a'), /OSU_CLIENT_ID/);
  for (const [status, expected] of [[404, /没有找到/], [429, /太频繁/]]) {
    const api = new OsuApi({ clientId: '1', clientSecret: 'test', fetchImpl: async url => url.endsWith('/oauth/token')
      ? { ok: true, json: async () => ({ access_token: 'fixture', expires_in: 3600 }) }
      : { ok: false, status } });
    await assert.rejects(() => api.user('a'), expected);
  }
});
