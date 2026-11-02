import {parentPort,workerData} from 'node:worker_threads';
import {unzip} from 'fflate';
import {posix} from 'node:path';
import {backgroundFilename,backgroundPath} from './background.js';

const unpack=filter=>new Promise((accept,reject)=>unzip(workerData.archive,{filter},(error,files)=>error?reject(error):accept(files)));
try {
  let total=0,count=0;
  const maps=await unpack(entry=>{
    if(!/\.osu$/i.test(entry.name))return false;
    if(entry.originalSize>4*1024*1024 || (total+=entry.originalSize)>16*1024*1024 || ++count>256)throw Error('谱包中的谱面文件超出限制。');
    return true;
  });
  const matches=Object.entries(maps).filter(([,data])=>{
    const raw=Buffer.from(data).toString('utf8');
    const metadata=raw.match(/^\[Metadata\][ \t]*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1]||'';
    return metadata.match(/^BeatmapID\s*:\s*(\d+)\s*$/m)?.[1]===String(workerData.mapId);
  });
  if(matches.length!==1)throw Error('谱包中缺少该难度或存在重复难度。');
  const [mapName,mapBytes]=matches[0],name=backgroundFilename(Buffer.from(mapBytes).toString('utf8'));
  if(name!==workerData.filename)throw Error('下载源的谱面背景与当前难度不一致。');
  const wanted=backgroundPath(posix.join(posix.dirname(backgroundPath(mapName)),name)).toLowerCase();
  let found=0;
  const images=await unpack(entry=>{
    let normalized;try{normalized=backgroundPath(entry.name).toLowerCase();}catch{return false;}
    if(normalized!==wanted)return false;
    if(++found>1||entry.originalSize<=0||entry.originalSize>20*1024*1024)throw Error('背景图片为空、重复或超过 20 MB 限制。');
    return true;
  });
  const data=Object.values(images)[0];
  if(!data?.length||data.length>20*1024*1024)throw Error('谱包中没有找到该难度指定的背景图片。');
  parentPort.postMessage({data});
}catch(error){parentPort.postMessage({error:error.message||'无法解包谱面背景。'});}
