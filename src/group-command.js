// Accept plain commands or an @ of this bot, without reacting to @ other users.
export function groupCommand(event,prefixes={}, {allowReplyAt=false,allowOtherAt=false}={}) {
  const raw=String(event.raw_message ?? event.message ?? '');
  const hasReply=Array.isArray(event.message)?event.message.some(segment=>segment?.type==='reply'):/\[CQ:reply,/.test(raw);
  if (!allowOtherAt&&!(allowReplyAt&&hasReply)) {
    if (Array.isArray(event.message)&&event.message.some(segment => segment?.type === 'at' && String(segment.data?.qq) !== String(event.self_id))) return '';
    if (!Array.isArray(event.message)&&[...raw.matchAll(/\[CQ:at,qq=([^,\]]+)/g)].some(match=>match[1]!==String(event.self_id)))return '';
  }
  const text=(Array.isArray(event.message)?event.message.filter(segment => segment?.type === 'text').map(segment => typeof segment.data?.text === 'string' ? segment.data.text : '').join(''):raw.replace(/\[CQ:[^\]]*\]/g,'').replace(/&#91;/g,'[').replace(/&#93;/g,']').replace(/&#44;/g,',').replace(/&amp;/g,'&')).trim();
  const prefix=prefixes[String(event.group_id)];
  return prefix?(text.startsWith(prefix)?'!'+text.slice(prefix.length):''):text;
}

export function groupPrefixes(raw='{}'){
  const value=JSON.parse(raw);
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.entries(value).some(([id,prefix])=>!/^\d+$/.test(id)||typeof prefix!=='string'||!prefix||prefix.length>8||/\s/.test(prefix)))throw new Error('QQ_GROUP_PREFIXES 需为群号到命令头的 JSON 对象。');
  return value;
}
export function prefixReply(result,prefix){
  if(result.kind==='help')return result;
  if(!prefix)return result;
  const replace=text=>typeof text==='string'?text.replace('支持半角 ! 和全角 ！',`本群命令头为 ${prefix}`).replace(/(^|[\s（(：:；;、])([!！])(?=[A-Za-z\u4e00-\u9fff])/g,(_,before)=>before+prefix):text;
  const visit=value=>Array.isArray(value)?value.map(visit):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,visit(v)])):replace(value);
  if(result.kind==='text')return {...result,text:replace(result.text)};
  return {...result,commandPrefix:prefix};
}
