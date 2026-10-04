import { Worker } from 'node:worker_threads';
import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, extname } from 'node:path';
import { UserError } from './osu.js';

const MAX_ARCHIVE = 100 * 1024 * 1024, MAX_AUDIO = 30 * 1024 * 1024;
const types = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' };
const normalize = name => name.replace(/\\/g, '/').replace(/^\.\//, '');

export function audioFilename(raw) {
  const general = raw.replace(/^\uFEFF/, '').match(/^\[General\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  const name = normalize(general?.match(/^AudioFilename\s*:\s*(.+)$/m)?.[1]?.trim() || '');
  if (!name || name.startsWith('/') || name.split('/').includes('..') || name.includes(':') || !types[extname(name).toLowerCase()]) {
    throw new UserError('谱面没有可提取的音频文件。');
  }
  return name;
}

export async function extractAudio(archive, name) {
  if (!archive?.length || archive.length > MAX_ARCHIVE) throw new UserError('谱包为空或超过 100 MB 限制。');
  return new Promise((accept,reject)=>{
    const worker=new Worker(new URL('./audio-extract-worker.js',import.meta.url),{
      workerData:{archive,name},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:128}
    });
    let settled=false;
    const finish=(error,data)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();error?reject(new UserError(error)):accept(Buffer.from(data));};
    const timer=setTimeout(()=>finish('音频解包超时，谱包可能损坏。'),10000);
    worker.once('message',message=>finish(message.error,message.data));
    worker.once('error',()=>finish('音频解包失败，谱包可能损坏。'));
    worker.once('exit',()=>{if(!settled)finish('音频解包异常退出。');});
  });
}

export class BeatmapAudio {
  constructor({ directory = resolve('data/audio'), fetchImpl = fetch } = {}) {
    this.directory = directory; this.fetch = fetchImpl; this.pending = new Map();
  }
  async get(map, raw) {
    if (map.beatmapset?.availability?.download_disabled) throw new UserError('此谱面的下载已被禁用，无法获取音频。');
    const setId = map.beatmapset?.id || map.beatmapset_id;
    if (!/^[1-9]\d*$/.test(String(setId))) throw new UserError('没有找到该谱面的谱包。');
    const sourceName = audioFilename(raw), extension = extname(sourceName).toLowerCase();
    const key = createHash('sha256').update(`${setId}:${map.checksum || raw}:${sourceName}`).digest('hex');
    const path = resolve(this.directory, key + extension);
    const title = `${map.beatmapset?.artist || 'osu'} - ${map.beatmapset?.title || map.id}`;
    const name = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100) + extension;
    await mkdir(this.directory, { recursive: true });
    try { const data = await readFile(path); if (data.length && data.length <= MAX_AUDIO) return { path, name, title, mime: types[extension] }; } catch {}
    if (!this.pending.has(key)) this.pending.set(key, this.download(setId, sourceName, path).finally(() => this.pending.delete(key)));
    await this.pending.get(key);
    return { path, name, title, mime: types[extension] };
  }
  async download(setId, sourceName, path) {
    let audio;
    for (const url of [`https://api.nerinyan.moe/d/${setId}?nv=1`, `https://catboy.best/d/${setId}`]) {
      try {
        const response = await this.fetch(url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok || Number(response.headers.get('content-length')) > MAX_ARCHIVE) { await response.body?.cancel(); continue; }
        const chunks = []; let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > MAX_ARCHIVE) throw new UserError('谱包超过 100 MB 下载限制。');
          chunks.push(chunk);
        }
        audio = await extractAudio(Buffer.concat(chunks), sourceName);
        break;
      } catch { /* Try the other mirror; never substitute preview audio. */ }
    }
    if (!audio) throw new UserError('完整音频下载失败，谱包可能暂不可用或超过大小限制，请稍后重试。');
    await writeFile(path, audio);
    // Only remove generated cache files, keeping at most 300 MB and 32 songs.
    const entries = await Promise.all((await readdir(this.directory)).filter(n => /^[a-f0-9]{64}\.(mp3|ogg|wav|m4a)$/.test(n)).map(async n => ({ path: resolve(this.directory, n), ...await stat(resolve(this.directory, n)) })));
    entries.sort((a,b) => b.mtimeMs - a.mtimeMs);
    let bytes = 0;
    for (let i=0;i<entries.length;i++) { bytes += entries[i].size; if (i>=32 || bytes>300*1024*1024) await unlink(entries[i].path); }
  }
}
