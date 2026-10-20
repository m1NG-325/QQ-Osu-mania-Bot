import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { audioForQQ } from '../src/qq-audio.js';
import { sendAudio } from '../src/onebot.js';

const ffmpeg = process.env.AUDIO_FFMPEG || 'ffmpeg';
const available = spawnSync(ffmpeg, ['-version'], { windowsHide: true, stdio: 'ignore' }).status === 0;
const pcm = path => {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', path,
    '-map', '0:a:0', '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1'], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0);
  return result.stdout.length / 4;
};

test('non-OGG uploads stay unchanged and pre-cancelled calls fail', async () => {
  const original = { path: '/unused/original.mp3', name: 'original.mp3' };
  assert.equal(await audioForQQ(original), original);
  await assert.rejects(audioForQQ(original, { signal: AbortSignal.abort() }), /取消/);
});

test('OGG becomes playable MP3 without truncating audio, caches and uploads as mp3', { skip: !available }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mania-mp3-'));
  let server;
  try {
    const source = join(dir, 'original.ogg');
    const generated = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'sine=frequency=440:duration=1.2:sample_rate=48000', '-c:a', 'libvorbis', source], { windowsHide: true });
    assert.equal(generated.status, 0);
    const audio = { path: source, name: 'Test song.ogg', mime: 'audio/ogg' };
    const options = { directory: join(dir, 'converted'), ffmpeg };
    const [first, second] = await Promise.all([audioForQQ(audio, options), audioForQQ(audio, options)]);
    assert.equal(first.path, second.path); assert.equal(first.name, 'Test song.mp3'); assert.equal(first.mime, 'audio/mpeg');
    assert.equal((await readFile(first.path)).toString('ascii', 0, 3), 'ID3');
    const streams = spawnSync(ffmpeg, ['-hide_banner', '-i', first.path], { encoding: 'utf8', windowsHide: true }).stderr;
    assert.match(streams, /Audio: mp3/); assert.doesNotMatch(streams, /Video:/);
    const duration = streams.match(/Duration: (\d+):(\d+):([\d.]+)/);
    assert.ok(duration);
    assert.ok(Math.abs(Number(duration[1])*3600 + Number(duration[2])*60 + Number(duration[3]) - 1.2) < .2, 'MP3 duration matches the full audio');
    assert.ok(Math.abs(pcm(first.path) - pcm(source)) < 4800, 'full audio duration retained within codec padding');
    const before = (await stat(first.path)).mtimeMs;
    await audioForQQ(audio, options);
    assert.equal((await stat(first.path)).mtimeMs, before);
    let upload;
    server = http.createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      upload = JSON.parse(body); res.end(JSON.stringify({ retcode: 0 }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await sendAudio({ group_id: 42 }, audio, { url: `http://127.0.0.1:${server.address().port}`, token: 'mock' });
    assert.equal(upload.name, 'Test song.mp3'); assert.match(upload.file, /\.mp3$/);
    assert.equal((await readFile(upload.file)).toString('ascii', 0, 3), 'ID3');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('missing FFmpeg and invalid OGG never get disguised as successful MP3', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mania-mp3-'));
  try {
    const source = join(dir, 'bad.ogg'); await writeFile(source, 'not ogg');
    const audio = { path: source, name: 'bad.ogg' };
    await assert.rejects(audioForQQ(audio, { directory: dir, ffmpeg: join(dir, 'missing-ffmpeg') }), /需要 FFmpeg/);
    if (available) await assert.rejects(audioForQQ(audio, { directory: dir, ffmpeg }), /MP3 失败/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
