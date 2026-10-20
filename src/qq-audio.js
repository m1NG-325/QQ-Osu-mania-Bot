import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, stat, open, rename, unlink, readdir } from 'node:fs/promises';
import { resolve, extname, basename } from 'node:path';
import { Lane } from './runtime.js';
import { UserError } from './osu.js';

const limit = 30 * 1024 * 1024;
const conversions = new Lane(1, 8);
const check = signal => { if (signal?.aborted) throw new UserError('音频转换已取消。'); };

async function isMp3(path) {
  try {
    const info = await stat(path);
    if (info.size < 12 || info.size > limit) return false;
    const file = await open(path, 'r');
    try { const header = Buffer.alloc(12); await file.read(header, 0, 12, 0); return header.toString('ascii', 0, 3) === 'ID3' || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0); }
    finally { await file.close(); }
  } catch { return false; }
}

async function convert(ffmpeg, source, target, signal) {
  check(signal);
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-protocol_whitelist', 'file,pipe', '-f', 'ogg', '-i', source,
    '-map', '0:a:0', '-vn', '-sn', '-dn', '-map_metadata', '-1',
    '-c:a', 'libmp3lame', '-b:a', '192k', '-ac', '2', '-ar', '48000',
    '-threads', '2', '-f', 'mp3', target];
  await new Promise((accept, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: 'ignore', shell: false });
    let failure, closed = false;
    const stop = error => { if (!closed) { failure ||= error; child.kill(); } };
    const abort = () => stop(new UserError('音频转换已取消。'));
    const timer = setTimeout(() => stop(new UserError('OGG 转 MP3 超时，请稍后重试。')), 90000);
    const monitor = setInterval(async () => {
      try { if ((await stat(target)).size > limit) stop(new UserError('转换后的 MP3 超过 30 MB 限制，无法发送。')); } catch {}
    }, 500);
    const cleanup = () => { closed = true; clearTimeout(timer); clearInterval(monitor); signal?.removeEventListener('abort', abort); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.once('error', error => {
      cleanup();
      reject(new UserError(error.code === 'ENOENT'
        ? 'OGG 转 MP3 需要 FFmpeg，请配置 AUDIO_FFMPEG 后重启 bot。' : '无法启动音频转换，请检查 FFmpeg 配置。'));
    });
    child.once('close', code => {
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0) reject(new UserError('OGG 转 MP3 失败，音频可能损坏或格式不受支持。'));
      else accept();
    });
  });
}

export async function audioForQQ(audio, { directory = resolve('data/audio-mp3'), ffmpeg = process.env.AUDIO_FFMPEG || 'ffmpeg', signal } = {}) {
  check(signal);
  if (extname(audio.path).toLowerCase() !== '.ogg') return audio;
  const source = resolve(audio.path), info = await stat(source);
  if (!info.isFile() || !info.size || info.size > limit) throw new UserError('原音频为空或超过 30 MB 限制，无法转换。');
  const key = createHash('sha256').update(`${source}:${info.size}:${info.mtimeMs}:mp3-lame-192k-v1`).digest('hex');
  const path = resolve(directory, key + '.mp3');
  const result = { ...audio, path, name: basename(audio.name, extname(audio.name)) + '.mp3', mime: 'audio/mpeg' };
  return conversions.run(async () => {
    check(signal);
    await mkdir(directory, { recursive: true });
    if (await isMp3(path)) return result;
    const temporary = resolve(directory, key + '.' + randomUUID() + '.tmp');
    try {
      await convert(ffmpeg, source, temporary, signal);
      check(signal);
      if (!await isMp3(temporary)) throw new UserError('转换后的 MP3 无效或超过 30 MB 限制，无法发送。');
      await rename(temporary, path);
    } finally { await unlink(temporary).catch(() => {}); }
    const entries = await Promise.all((await readdir(directory)).filter(name => /^[a-f0-9]{64}\.mp3$/.test(name))
      .map(async name => ({ path: resolve(directory, name), ...await stat(resolve(directory, name)) })));
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    let bytes = 0;
    for (let i = 0; i < entries.length; i++) {
      bytes += entries[i].size;
      if (i >= 32 || bytes > 300 * 1024 * 1024) await unlink(entries[i].path);
    }
    return result;
  }, { signal });
}
