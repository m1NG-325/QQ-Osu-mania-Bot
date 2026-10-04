import { mkdir, stat, rename, appendFile } from 'node:fs/promises';
let writes = Promise.resolve();
export function logEvent(event, fields={}) {
  // Only whitelist metadata, never URLs, headers, command text or error messages.
  const row = JSON.stringify({at:new Date().toISOString(),event,name:fields.name,code:fields.code})+'\n';
  writes = writes.catch(()=>{}).then(async()=>{
    await mkdir('output',{recursive:true});
    try { if((await stat('output/events.ndjson')).size>256*1024){
      for(let i=2;i>=0;i--){try{await rename(i?`output/events.ndjson.${i}`:'output/events.ndjson',`output/events.ndjson.${i+1}`);}catch(error){if(error.code!=='ENOENT')throw error;}}
    }}catch(error){if(error.code!=='ENOENT')throw error;}
    await appendFile('output/events.ndjson',row);
  });
  return writes.catch(()=>console.error('写入诊断日志失败。'));
}
