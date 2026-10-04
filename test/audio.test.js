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
    assert.equal(urls.length, 2); assert.match(urls[1], /catboy/);
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
