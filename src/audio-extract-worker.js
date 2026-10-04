import {parentPort,workerData} from 'node:worker_threads';
import {unzip} from 'fflate';
const maximum=30*1024*1024;
const normalize=name=>name.replace(/\\/g,'/').replace(/^\.\//,'');
try {
  let matches=0;
  const files=await new Promise((resolve,reject)=>unzip(workerData.archive,{filter(entry){
    if(normalize(entry.name)!==workerData.name)return false;
    if(++matches>1||entry.originalSize<=0||entry.originalSize>maximum)throw new Error('音频为空、重复或超过 30 MB 限制。');
    return true;
  }},(error,result)=>error?reject(error):resolve(result)));
  const data=Object.values(files)[0];
  if(!data?.length||data.length>maximum)throw new Error('谱包中没有找到该难度使用的音频。');
  parentPort.postMessage({data});
} catch { parentPort.postMessage({error:'无法解包谱面音频，文件可能损坏、缺失或超出限制。'}); }
