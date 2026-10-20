import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { BeatmapAudio, audioFilename, extractAudio } from '../src/audio.js';
import { sendAudio } from '../src/onebot.js';
import { Bot, parseCommand } from '../src/bot.js';

const raw = 'osu file format v14\n[General]\nAudioFilename: music/song.ogg\nMode: 3\n[Metadata]\nTitle: Test';
test('audio selects exact difficulty filename, caches original bytes and rejects disabled downloads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mania-audio-'));
  try {
    const bytes = Buffer.from('complete audio fixture');
    const archive = zipSync({ 'music/song.ogg': bytes, 'other.mp3': Buffer.from('wrong song') });
    assert.equal(audioFilename(raw), 'music/song.ogg');
    assert.deepEqual(await extractAudio(archive, audioFilename(raw)), bytes);
    assert.throws(() => audioFilename(raw.replace('music/song.ogg', '../song.ogg')));
    await assert.rejects(extractAudio(archive, 'missing.mp3'));
    let calls = 0;
    const audio = new BeatmapAudio({ directory: dir, fetchImpl: async () => { calls++; return new Response(archive); } });
    const map = { id: 123, checksum: 'hash', beatmapset: { id: 42, title: 'Test', artist: 'Artist' } };
    const result = await audio.get(map, raw);
    assert.deepEqual(await readFile(result.path), bytes);
    await audio.get(map, raw); assert.equal(calls, 1);
    await assert.rejects(audio.get({ ...map, beatmapset: { ...map.beatmapset, availability: { download_disabled: true } } }, raw));
    const bot = new Bot({ api: { map: async () => map, rawMap: async () => raw }, bindings: {}, demo: false, audio });
    assert.equal((await bot.run('！audio123')).kind, 'audio');
    assert.equal(parseCommand('!audio 123').action, 'audio');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('audio tries second mirror when first returns an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mania-audio-'));
  try {
    const urls = [];
    const audio = new BeatmapAudio({ directory: dir, fetchImpl: async url => {
      urls.push(url); return urls.length === 1 ? new Response('down', { status: 503 }) : new Response(zipSync({ 'music/song.ogg': Buffer.from('audio') }));
    } });
    await audio.get({ id: 123, beatmapset_id: 42 }, raw);
    assert.equal(urls.length, 2); assert.match(urls[0], /sayobot/); assert.match(urls[1], /osu\.direct/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('QQ audio uses group file upload and reports failed uploads', async () => {
  const requests = [];
  const server = http.createServer(async (req,res) => {
    let raw = ''; for await (const c of req) raw += c;
    requests.push({ action: req.url, body: JSON.parse(raw), token: req.headers.authorization });
    res.end(JSON.stringify({ retcode: requests.length === 1 ? 0 : 1 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const audio = { path: join(tmpdir(), 'original.mp3'), name: 'Artist - Song.mp3' };
    const options = { url: `http://127.0.0.1:${server.address().port}`, token: 'mock' };
    await sendAudio({ group_id: 42 }, audio, options);
    assert.deepEqual(requests[0], { action: '/upload_group_file', body: { group_id: 42, file: audio.path, name: audio.name }, token: 'Bearer mock' });
    await assert.rejects(sendAudio({ group_id: 42 }, audio, options));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('audio recovers from missing and disconnected mirrors without leaking credentials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mania-audio-'));
  try {
    let calls = 0;
    const bytes = Buffer.from('complete original audio');
    const audio = new BeatmapAudio({ directory: dir, fetchImpl: async (_url, options) => {
      assert.equal(options.headers?.Authorization, undefined);
      assert.ok(options.signal instanceof AbortSignal);
      calls++;
      if (calls === 1) return new Response('missing', { status: 404 });
      if (calls === 2) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
      return new Response(zipSync({ 'music/song.ogg': bytes }));
    } });
    const map = { id: 123, beatmapset_id: 42 };
    const [a, b] = await Promise.all([audio.get(map, raw), audio.get(map, raw)]);
    assert.equal(a.path, b.path); assert.equal(calls, 3);
    assert.deepEqual(await readFile(a.path), bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('audio skips HTML challenges and oversized bodies, cancelling rejected downloads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mania-audio-'));
  try {
    let calls = 0, cancelled = false;
    const audio = new BeatmapAudio({ directory: dir, fetchImpl: async () => {
      calls++;
      if (calls === 1) return new Response('<html>challenge</html>', { headers: { 'Content-Type': 'text/html' } });
      if (calls === 2) return new Response(new ReadableStream({ cancel() { cancelled = true; } }),
        { headers: { 'Content-Length': String(100 * 1024 * 1024 + 1) } });
      return new Response(zipSync({ 'music/song.ogg': Buffer.from('original') }));
    } });
    const result = await audio.get({ id: 123, beatmapset_id: 42 }, raw);
    assert.equal((await readFile(result.path)).toString(), 'original');
    assert.equal(calls, 3); assert.ok(cancelled);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('audio errors distinguish missing archives, limits, missing tracks and network failures', async () => {
  const oversizedTrack = Buffer.from(zipSync({ 'music/song.ogg': Buffer.from('x') }));
  const central = oversizedTrack.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  oversizedTrack.writeUInt32LE(30 * 1024 * 1024 + 1, central + 24);
  for (const [response, expected] of [
    [() => new Response('missing', { status: 404 }), /暂未收录/],
    [() => new Response('busy', { status: 429 }), /限流/],
    [() => new Response('x', { headers: { 'Content-Length': String(100 * 1024 * 1024 + 1) } }), /100 MB/],
    [() => new Response(oversizedTrack), /30 MB/],
    [() => new Response(zipSync({ 'other.ogg': Buffer.from('wrong') })), /缺少该难度指定的音频/],
    [() => { throw new TypeError('fetch failed'); }, /网络或镜像服务异常/]
  ]) {
    const dir = await mkdtemp(join(tmpdir(), 'mania-audio-'));
    try {
      const audio = new BeatmapAudio({ directory: dir, fetchImpl: async () => response() });
      await assert.rejects(audio.get({ id: 123, beatmapset_id: 42 }, raw), expected);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});
