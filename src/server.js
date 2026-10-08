import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID, timingSafeEqual, createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { DemoApi } from './demo.js';
import { OsuApi, UserError } from './osu.js';
import { Bindings } from './store.js';
import { Bot, parseCommand } from './bot.js';
import { renderCard } from './cards.js';
import { groupCommand,groupPrefixes,prefixReply } from './group-command.js';
import { onebotCall, sendAudio } from './onebot.js';
import { queryLane, heavyLane, analysisLane, downloadLane, renderLane, ResultCache, deliveryBudget, timedWork, checkCancelled, safeError } from './runtime.js';
import { QueryService } from './query-service.js';
import { History } from './history.js';
import { logEvent } from './telemetry.js';
import {MapIndex} from './map-index.js';
import { DanService, isDanCommand, handleDanMessage, DAN_HELP, stickerLane } from './dan-sticker.js';

const mode = process.env.BOT_MODE || 'demo';
if (!['demo', 'live'].includes(mode)) throw new Error('BOT_MODE must be demo or live');
const host = process.env.HOST || '127.0.0.1';
if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('本地演示只支持监听回环地址。');
const port = Number(process.env.PORT || 3210);
const api = mode === 'demo' ? new DemoApi() : new OsuApi({
  clientId: process.env.OSU_CLIENT_ID, clientSecret: process.env.OSU_CLIENT_SECRET
});
const bindings = await new Bindings(resolve('data/bindings.json'), mode).load();
const history = await new History(resolve(mode==='demo'?'data/history-demo.json':'data/history.json')).load();
const mapIndex=await new MapIndex(resolve(mode==='demo'?'data/map-index-demo.json':'data/map-index.json')).load();
const bot = new Bot({ api, bindings, demo: mode === 'demo', history, mapIndex });
const danService = new DanService();
const cache = new ResultCache();
const apiCache = new ResultCache({ttl:10000,capacity:64,maxBytes:16*1024*1024});
if (mode === 'live') { const get = api.get.bind(api); api.get = path => apiCache.get(path, () => get(path)); }
const queries = new QueryService({bot,bindings,history,cache});
const run = (command,sender='local',context={}) => isDanCommand(command) ? Promise.resolve({kind:'text',text:DAN_HELP}) : parseCommand(command)?.action==='状态'
  ? Promise.resolve({kind:'text',text:`osu!mania bot v1.1.2\n运行 ${Math.floor(process.uptime())} 秒\n查询：${queryLane.active}/4，等待 ${queryLane.waiting.length}\n分析：${analysisLane.active}/2，等待 ${analysisLane.waiting.length}\n渲染：${renderLane.active}/2，等待 ${renderLane.waiting.length}\n音频：${downloadLane.active}/1，等待 ${downloadLane.waiting.length}\n记录开关仅影响发起人；可用 !记录 关闭 停止保存。`})
  : queries.run(command,sender,context);
const cards = new Map();
const audioFiles = new Map();
const qqEnabled = process.env.QQ_ENABLED === 'true';
const allowedGroups = new Set((process.env.QQ_ALLOWED_GROUPS || '').split(',').map(s => s.trim()).filter(Boolean));
const prefixes=groupPrefixes(process.env.QQ_GROUP_PREFIXES||'{}');
if (qqEnabled && (!process.env.ONEBOT_EVENT_TOKEN || !process.env.ONEBOT_ACCESS_TOKEN || !allowedGroups.size)) {
  throw new Error('启用 QQ 前，请填写两个 OneBot token 和 QQ_ALLOWED_GROUPS。');
}
const seen = new Set();
const cooldown = new Map();
let pending = 0;
let connection = { eventAt:null, checkedAt:null, available:null };
if(qqEnabled){
  const timer=setInterval(async()=>{
    try { await onebotCall('get_status',{});connection={...connection,checkedAt:new Date().toISOString(),available:true}; }
    catch(error){connection={...connection,checkedAt:new Date().toISOString(),available:false};await logEvent('onebot_connection_failed',safeError(error));}
  },60000);timer.unref();
}
let imageBytes=0;
function storeImage(path,image) {
  cards.set(path,{image,expires:Date.now()+10*60*1000});imageBytes+=image.length;
  while(cards.size>40||imageBytes>64*1024*1024){const key=cards.keys().next().value;imageBytes-=cards.get(key).image.length;cards.delete(key);}
}

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}
async function rawBody(request) {
  const chunks = []; let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 65536) throw new UserError('请求内容过大。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function parseBody(raw) {
  try {
    const value=JSON.parse(raw.toString('utf8'));
    if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('Invalid body');
    return value;
  } catch { throw new UserError('请求需要合法 JSON 对象。'); }
}
async function body(request) {
  return parseBody(await rawBody(request));
}
function secureEqual(a, b) {
  const aa = Buffer.from(a || ''); const bb = Buffer.from(b || '');
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
async function sendQQ(event, result, signal) {
  checkCancelled(signal);
  if (result.kind === 'audio') {
    try { await sendAudio(event, result, {signal}); }
    catch { checkCancelled(signal); await sendQQ(event, { kind: 'text', text: '音频已获取，但群文件上传失败，请检查机器人是否有上传群文件的权限。' },signal); }
    return;
  }
  let message;
  if (result.kind === 'text') message = [{ type: 'text', data: { text: result.text } }];
  else if (result.kind === 'background') message = [{ type: 'image', data: { file: result.url } }];
  else if (result.kind === 'image' && Buffer.isBuffer(result.buffer)) message = [{ type: 'image', data: { file: `base64://${result.buffer.toString('base64')}` } }];
  else message = [{ type: 'image', data: { file: `base64://${(await renderCard(result,{signal})).toString('base64')}` } }];
  if(result.links?.length)message.push({type:'text',data:{text:'\n'+result.links.join('\n')}});
  message.unshift({ type: 'at', data: { qq: String(event.user_id) } }, { type: 'text', data: { text: '\n' } });
  checkCancelled(signal);
  await onebotCall('send_group_msg', { group_id: event.group_id, message },{signal});
}

const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (request.method === 'GET' && pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' https:; connect-src 'self'; frame-ancestors 'none'" });
      return response.end(await readFile(new URL('../public/index.html', import.meta.url)));
    }
    if (request.method === 'GET' && pathname === '/api/status') {
      return json(response, 200, { mode, qqEnabled, version:'1.1.2', connection, uptime:Math.floor(process.uptime()), rssMB:Math.round(process.memoryUsage().rss/1024/1024), queues:{query:queryLane.status,heavy:heavyLane.status,analysis:analysisLane.status,audio:downloadLane.status,render:renderLane.status,sticker:stickerLane.status},cacheBytes:cache.bytes,imageBytes, bound: Boolean(bindings.get('local')) });
    }
    if (request.method === 'GET' && pathname.startsWith('/audio/')) {
      const audio = audioFiles.get(pathname);
      if (!audio) return json(response, 404, { error: '音频已过期，请重新查询。' });
      let data;
      try { data = await readFile(audio.path); } catch { return json(response, 404, { error: '音频缓存已清理，请重新查询。' }); }
      response.writeHead(200, { 'Content-Type': audio.mime, 'Content-Length': data.length,
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(audio.name)}`, 'Cache-Control': 'no-store' });
      return response.end(data);
    }
    if (request.method === 'GET' && pathname.startsWith('/cards/')) {
      const stored = cards.get(pathname);
      if (!stored || stored.expires<Date.now()) { if(stored){imageBytes-=stored.image.length;cards.delete(pathname);} return json(response, 404, { error: '图片已过期，请重新查询。' }); }
      response.writeHead(200, { 'Content-Type': pathname.endsWith('.jpg') ? 'image/jpeg' : 'image/png', 'Cache-Control': 'no-store' });
      return response.end(stored.image);
    }
    if (request.method === 'POST' && pathname === '/api/command') {
      if (!request.headers['content-type']?.startsWith('application/json')) return json(response, 415, { error: '需要 application/json。' });
      const origin = request.headers.origin;
      if (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`].includes(origin)) {
        return json(response, 403, { error: '只接受本地页面请求。' });
      }
      const data = await body(request);
      if (typeof data.command !== 'string' || data.command.length > 300) throw new UserError('命令为空或过长。');
      return await timedWork(async signal => {
      const result = await run(data.command,'local',{signal});
      if (result.kind === 'audio') {
        const url = `/audio/${randomUUID()}`;
        audioFiles.set(url, result);
        if (audioFiles.size > 40) audioFiles.delete(audioFiles.keys().next().value);
        return json(response, 200, { kind: 'audio', url, name: result.name, title: result.title });
      }
      if (['profile', 'score', 'scores', 'map', 'mapper', 'analysis', 'help', 'avatar', 'timebest', 'recommend','view','compare','report','feature'].includes(result.kind)) {
        const path = `/cards/${randomUUID()}.${['timebest','view'].includes(result.kind)||(result.kind==='scores'&&result.scores.length>16) ? 'jpg' : 'png'}`;
        const image=await renderCard(result,{signal});checkCancelled(signal);storeImage(path,image);
        return json(response, 200, { kind: 'image', image: path, demo: result.demo, ...(result.links?{links:result.links}:{}) });
      }
      return json(response, 200, result);
      }, deliveryBudget(parseCommand(data.command)?.action));
    }
    if (request.method === 'POST' && pathname === '/onebot/events') {
      if (!qqEnabled) return json(response, 503, { error: 'QQ 接入未启用。' });
      const raw = await rawBody(request);
      const signature = `sha1=${createHmac('sha1', process.env.ONEBOT_EVENT_TOKEN).update(raw).digest('hex')}`;
      const signed = secureEqual(request.headers['x-signature'], signature);
      const bearer = secureEqual(request.headers.authorization, `Bearer ${process.env.ONEBOT_EVENT_TOKEN}`);
      if (!signed && !bearer) return json(response, 401, { error: 'Unauthorized' });
      const event = parseBody(raw);
      connection.eventAt=new Date().toISOString();
      if (event.post_type !== 'message' || event.message_type !== 'group' ||
          String(event.user_id) === String(event.self_id) || !allowedGroups.has(String(event.group_id))) return json(response, 200, {});
      let command = groupCommand(event,prefixes);
      if (!command) {
        const replyCommand = groupCommand(event,prefixes,{allowOtherAt:true});
        if (isDanCommand(replyCommand)) command = replyCommand;
      }
      if ((!parseCommand(command) && !isDanCommand(command)) || command.length > 300) return json(response, 200, {});
      const id = `${event.group_id}:${event.message_id}`;
      const sender = `qq:${event.user_id}`;
      if (seen.has(id) || Date.now() - (cooldown.get(sender) || 0) < 3000 || pending >= 20) return json(response, 200, {});
      seen.add(id); if (seen.size > 1000) seen.delete(seen.values().next().value);
      cooldown.set(sender, Date.now());
      if (cooldown.size > 1000) cooldown.delete(cooldown.keys().next().value);
      pending++;
      (async () => {
        const waitNotice=setTimeout(()=>sendQQ(event,{kind:'text',text:'正在查询或等待分析；耗时任务与普通查询分开处理，请勿重复发送。'}).catch(error=>logEvent('wait_notice_failed',safeError(error))),5000);
        try {
          await timedWork(async signal => {
            const context={groupId:String(event.group_id),signal};
            if(parseCommand(command)?.action==='群榜')context.members=await onebotCall('get_group_member_list',{group_id:event.group_id},{signal});
            const result = isDanCommand(command) ? await handleDanMessage(event,command,{service:danService,call:(action,body)=>onebotCall(action,body,{signal})}) : await run(command,sender,context);
            await sendQQ(event,prefixReply(result,prefixes[String(event.group_id)]),signal);
          },isDanCommand(command)?180000:deliveryBudget(parseCommand(command)?.action));
        }
        catch (error) { await sendQQ(event,prefixReply({ kind: 'text', text: error instanceof UserError ? error.message : '查询失败，请稍后重试。' },prefixes[String(event.group_id)])); }
        finally { clearTimeout(waitNotice); }
      })().catch(error => logEvent('qq_reply_failed',safeError(error))).finally(() => { pending--; });
      return json(response, 200, {});
    }
    json(response, 404, { error: 'Not found' });
  } catch (error) {
    if (!(error instanceof UserError)) await logEvent('request_failed',safeError(error));
    json(response, error instanceof UserError ? 400 : 502, {
      error: error instanceof UserError ? error.message : '查询失败，请检查网络或配置后重试。'
    });
  }
});
server.requestTimeout = 30000;
server.on('error', error => { logEvent('startup_failed',safeError(error)); console.error(`启动失败：${error.code}`); process.exitCode = 1; });
server.listen(port, host, () => {logEvent('service_started');console.log(`Mania bot v1.1.2 (${mode}) → http://127.0.0.1:${port}`);});
