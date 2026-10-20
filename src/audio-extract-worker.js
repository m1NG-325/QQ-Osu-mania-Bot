import {parentPort,workerData} from 'node:worker_threads';
import {unzip} from 'fflate';
const maximum=30*1024*1024;
const normalize=name=>name.replace(/\\/g,'/').replace(/^\.\//,'');
try {
  let matches=0;
  const files=await new Promise((resolve,reject)=>unzip(workerData.archive,{filter(entry){
    if(normalize(entry.name)!==workerData.name)return false;
    if(entry.originalSize>maximum)throw Object.assign(new Error('音频超过 30 MB 限制。'),{code:'AUDIO_TOO_LARGE'});
    if(++matches>1||entry.originalSize<=0)throw Object.assign(new Error('谱面音频为空或重复。'),{code:'ARCHIVE_INVALID'});
    return true;
  }},(error,result)=>error?reject(error):resolve(result)));
  const data=Object.values(files)[0];
  if(!data?.length)throw Object.assign(new Error('谱包中没有找到该难度使用的音频。'),{code:'AUDIO_MISSING'});
  if(data.length>maximum)throw Object.assign(new Error('音频超过 30 MB 限制。'),{code:'AUDIO_TOO_LARGE'});
  parentPort.postMessage({data});
} catch(error) { parentPort.postMessage({error:'无法解包谱面音频，文件可能损坏、缺失或超出限制。',code:error.code||'ARCHIVE_INVALID'}); }
