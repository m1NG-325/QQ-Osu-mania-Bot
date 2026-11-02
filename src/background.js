import { Worker } from 'node:worker_threads';
import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, extname } from 'node:path';
import sharp from 'sharp';
import { UserError } from './osu.js';
import { archiveSources } from './audio-download.js';

const MAX_IMAGE = 20 * 1024 * 1024, MAX_ARCHIVE = 100 * 1024 * 1024;
const types = {jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp'};
export function backgroundPath(name) {
  name = name.replaceAll('\\','/').replace(/^(?:\.\/)+/,'');
  if (!name || name.length > 1024 || name.startsWith('/') || /[:\x00-\x1f]/.test(name) || name.split('/').some(p=>!p||p==='.'||p==='..'))
    throw new UserError('谱面背景文件路径无效。');
  return name;
}
export function backgroundFilename(raw) {
  const events = raw.replace(/^\uFEFF/,'').match(/^\[Events\][ \t]*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1] || '';
  for (const line of events.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:0|Background)\s*,\s*[^,]+\s*,\s*(?:"((?:[^"]|"")*)"|([^,]+))\s*(?:,|$)/i);
    if (!match) continue;
    const name=backgroundPath((match[1]??match[2]).replaceAll('""','"').trim());
    if (!/\.(?:jpe?g|png|gif|webp)$/i.test(name)) throw new UserError('该难度的背景图片格式暂不支持。');
    return name;
  }
  throw new UserError('该难度的谱面文件没有指定背景图片。');
}
export async function extractBackground(archive, mapId, filename) {
  if (!archive?.length || archive.length > MAX_ARCHIVE) throw new UserError('谱包为空或超过 100 MB 限制。');
  return new Promise((accept,reject)=>{
    const worker=new Worker(new URL('./background-worker.js',import.meta.url),{
      workerData:{archive,mapId,filename},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:128}
    });
    let settled=false;
    const finish=(error,data)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();error?reject(new UserError(error)):accept(Buffer.from(data));};
    const timer=setTimeout(()=>finish('背景解包超时，谱包可能损坏。'),10000);
    worker.once('message',m=>finish(m.error,m.data));
    worker.once('error',()=>finish('背景解包失败，谱包可能损坏。'));
    worker.once('exit',()=>{if(!settled)finish('背景解包异常退出。');});
  });
}
async function imageResult(buffer, name) {
  if (!buffer.length || buffer.length > MAX_IMAGE) throw new UserError('背景图片为空或超过 20 MB 限制。');
  let metadata;
  try {metadata=await sharp(buffer,{limitInputPixels:40000000}).metadata();}
  catch {throw new UserError('谱包中的背景图片无效或尺寸过大。');}
  if (!types[metadata.format] || !metadata.width || !metadata.height) throw new UserError('谱包中的背景图片格式不支持。');
  return {buffer,mime:types[metadata.format],name};
}
export class BeatmapBackground {
  constructor({directory=resolve('data/backgrounds'),fetchImpl=fetch}={}) {this.directory=directory;this.fetch=fetchImpl;this.pending=new Map();}
  async get(map,raw) {
    if(map.beatmapset?.availability?.download_disabled) throw new UserError('此谱面的下载已被禁用，无法提取难度背景。');
    const setId=map.beatmapset?.id||map.beatmapset_id;
    if(!/^[1-9]\d*$/.test(String(setId))||!/^[1-9]\d*$/.test(String(map.id)))throw new UserError('没有找到该难度所属的谱包。');
    const name=backgroundFilename(raw),key=createHash('sha256').update(`${setId}:${map.id}:${raw}`).digest('hex');
    const path=resolve(this.directory,key+extname(name).toLowerCase());
    await mkdir(this.directory,{recursive:true});
    try {return await imageResult(await readFile(path),name);}catch{}
    if(!this.pending.has(key))this.pending.set(key,this.download(setId,map.id,name,path).finally(()=>this.pending.delete(key)));
    return this.pending.get(key);
  }
  async download(setId,mapId,name,path) {
    for(const url of archiveSources(setId)) {
      try {
        const response=await this.fetch(url,{signal:AbortSignal.timeout(30000)});
        if(!response.ok || Number(response.headers.get('content-length'))>MAX_ARCHIVE || /text\/html|application\/(?:[\w.+-]*\+)?json/i.test(response.headers.get('content-type')||'')) {
          await response.body?.cancel();continue;
        }
        const chunks=[];let size=0;
        for await(const chunk of response.body){size+=chunk.length;if(size>MAX_ARCHIVE){await response.body.cancel?.().catch(()=>{});throw new Error('Archive too large');}chunks.push(chunk);}
        const result=await imageResult(await extractBackground(Buffer.concat(chunks),mapId,name),name);
        await writeFile(path,result.buffer);
        const entries=await Promise.all((await readdir(this.directory)).filter(n=>/^[a-f0-9]{64}\.(?:jpe?g|png|gif|webp)$/.test(n)).map(async n=>({path:resolve(this.directory,n),...await stat(resolve(this.directory,n))})));
        entries.sort((a,b)=>b.mtimeMs-a.mtimeMs);let bytes=0;
        for(let i=0;i<entries.length;i++){bytes+=entries[i].size;if(i>=32||bytes>150*1024*1024)await unlink(entries[i].path).catch(()=>{});}
        return result;
      }catch{/* An outdated mirror can lack this difficulty or its background. */}
    }
    throw new UserError('无法从下载源提取该难度的背景，谱包可能尚未同步或下载源暂不可用，请稍后重试。');
  }
}
