import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { resolve, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { onebotCall } from './onebot.js';
import { Lane } from './runtime.js';
import { UserError } from './osu.js';

const MAX_BYTES = 20 * 1024 * 1024;
export const stickerLane = new Lane(1, 8);
export const DAN_HELP = '用法：!dan <段位> [大小] [色散] [切片] [块状]\n回复图片／动画表情、随指令附图，或 @发图的人使用他最近发的图片。\n例如：@群友 !dan epsilon / !dan kappa 75 / !dan 4kln3 60\n大小 50–125，默认 75；效果 0–1 或 0–100。指定任一效果后，其余默认为 0。';

export function isDanCommand(text) { return /^\s*[!！]\s*dan/i.test(text || ''); }

const decodeCQ = value => value.replace(/&#91;/g, '[').replace(/&#93;/g, ']').replace(/&#44;/g, ',').replace(/&amp;/g, '&');
export function messageSegments(message) {
  if (Array.isArray(message)) return message;
  return [...String(message || '').matchAll(/\[CQ:([^,\]]+)((?:,[^\]]*)?)\]/g)].map(match => ({
    type: match[1], data: Object.fromEntries(match[2].slice(1).split(',').filter(Boolean).map(pair => {
      const equal = pair.indexOf('='); return [pair.slice(0, equal), decodeCQ(pair.slice(equal + 1))];
    }))
  }));
}

function firstImage(message) {
  return messageSegments(message).find(segment => segment?.type === 'image' && (segment.data?.url || segment.data?.file));
}

export async function pickDanImage(event, call = onebotCall) {
  const message = event.message ?? event.raw_message;
  const reply = messageSegments(message).find(segment => segment?.type === 'reply');
  if (reply?.data?.id != null) {
    try {
      const original = await call('get_msg', { message_id: Number(reply.data.id) });
      // Only consume replies from the current group.
      if (original?.group_id == null || String(original.group_id) === String(event.group_id)) {
        const image = firstImage(original?.message ?? original?.raw_message);
        if (image) return image;
      }
    } catch { /* A current-message image can still be used. */ }
  }
  const attached = firstImage(message);
  if (attached) return attached;
  const targets = [...new Set(messageSegments(message).filter(segment => segment?.type === 'at')
    .map(segment => String(segment.data?.qq || '')).filter(id => id && id !== String(event.self_id)))];
  if (!targets.length) return null;
  if (targets.length !== 1 || !/^\d+$/.test(targets[0])) throw new UserError('请只 @一位发图的群友，或直接回复要处理的图片。');
  let history;
  try { history = await call('get_group_msg_history', { group_id: event.group_id, count: 50 }); }
  catch { throw new UserError('暂时无法读取被 @群友的图片，请直接回复那张图片后发送 !dan epsilon。'); }
  const messages = Array.isArray(history?.messages) ? history.messages : [];
  const candidates = messages.filter(item => (item?.group_id == null || String(item.group_id) === String(event.group_id))
    && String(item.user_id ?? item.sender?.user_id) === targets[0]
    && (!event.time || !item.time || Number(item.time) <= Number(event.time)));
  candidates.sort((a,b) => Number(b.time || 0) - Number(a.time || 0) || Number(b.message_seq || 0) - Number(a.message_seq || 0));
  for (const item of candidates) {
    const image = firstImage(item.message ?? item.raw_message);
    if (image) return image;
  }
  throw new UserError('本群最近 50 条消息里没有找到被 @群友的图片，请回复那张图片或让对方重新发图。');
}

async function boundedBody(response, limit = MAX_BYTES) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); throw new UserError('图片太大，最大支持 20 MB。');
  }
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > limit) throw new UserError('图片太大，最大支持 20 MB。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function downloadDanImage(image, { call = onebotCall, fetcher = fetch } = {}) {
  let url = image.data.url;
  if (!url && /^https?:\/\//i.test(image.data.file || '')) url = image.data.file;
  if (!url && image.data.file) {
    try {
      const resolved = await call('get_image', { file: image.data.file });
      url = resolved?.url;
      // Local paths are accepted only from the authenticated OneBot API.
      if (!url && isAbsolute(resolved?.file || '')) {
        if ((await stat(resolved.file)).size > MAX_BYTES) throw new UserError('图片太大，最大支持 20 MB。');
        const buffer = await readFile(resolved.file);
        if (buffer.length > MAX_BYTES) throw new UserError('图片太大，最大支持 20 MB。');
        if (!buffer.length) throw new UserError('收到的图片为空，请重新发送。');
        return buffer;
      }
    } catch (error) {
      if (error instanceof UserError) throw error;
      throw new UserError('无法获取这张图片，请重新发送图片／动画表情后再试。');
    }
  }
  if (!/^https?:\/\//i.test(url || '')) throw new UserError('无法获取这张图片，请重新发送图片／动画表情后再试。');
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('download failed');
    const buffer = await boundedBody(response);
    if (!buffer.length) throw new UserError('收到的图片为空，请重新发送。');
    return buffer;
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('图片下载失败或已过期，请重新发送图片后再试。');
  }
}

export class DanService {
  constructor({ python = process.env.DAN_PYTHON, cacheDir = resolve('data/dan-sticker') } = {}) {
    const bundled = resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
    this.python = python || (existsSync(bundled) ? bundled : 'python');
    this.cacheDir = cacheDir;
    this.child = null; this.starting = null;
    this.onExit = () => this.close();
    process.once('exit', this.onExit);
  }
  async start() {
    if (this.starting) return this.starting;
    this.starting = new Promise((accept, reject) => {
      const token = randomBytes(24).toString('hex');
      const child = spawn(this.python, ['-u', fileURLToPath(new URL('../vendor/dan-sticker/service.py', import.meta.url))], {
        env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', DAN_CACHE_DIR: this.cacheDir, DAN_SERVICE_TOKEN: token },
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
      });
      this.child = child;
      child.stdin.on('error', () => {});
      let ready = false, output = '';
      const timer = setTimeout(() => { child.kill(); reject(new UserError('dan 合成服务启动超时，请检查 Python 和 Pillow。')); }, 15000);
      child.stderr.on('data', () => {});
      child.once('error', () => { clearTimeout(timer); reject(new UserError('无法启动 dan 服务，请配置 DAN_PYTHON，并安装 Pillow。')); });
      child.once('exit', () => {
        clearTimeout(timer);
        if (this.child === child) { this.child = null; this.starting = null; }
        if (!ready) reject(new UserError('dan 服务启动失败，请为配置的 Python 安装 Pillow。'));
      });
      child.stdout.on('data', chunk => {
        if (ready) return;
        output += chunk.toString();
        const line = output.split('\n')[0];
        if (!output.includes('\n')) return;
        try {
          const { port } = JSON.parse(line);
          if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
          ready = true; clearTimeout(timer);
          accept({ url: `http://127.0.0.1:${port}`, token });
        } catch { child.kill(); reject(new UserError('dan 服务启动返回异常。')); }
      });
    });
    try { return await this.starting; }
    catch (error) { this.starting = null; throw error; }
  }
  async render(text, buffer) {
    const { url, token } = await this.start();
    const endpoint = new URL('/cmd', url); endpoint.searchParams.set('text', text);
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Dan-Token': token }, body: buffer, signal: AbortSignal.timeout(90000) });
      if (!response.ok) throw new UserError((await response.text()).slice(0, 1000).trim() || 'dan 合成失败。');
      const mime = response.headers.get('content-type');
      if (!/^image\/(gif|png|jpeg|webp|bmp)$/.test(mime || '')) throw new Error('invalid image response');
      return { kind: 'image', buffer: await boundedBody(response), mime };
    } catch (error) {
      if (error instanceof UserError) throw error;
      throw new UserError('dan 图片合成失败或超时，请换一张较小的图片后重试。');
    }
  }
  close() {
    process.removeListener('exit', this.onExit);
    this.child?.stdin.end(); this.child?.kill();
    this.child = null; this.starting = null;
  }
}

export async function handleDanMessage(event, command, { call = onebotCall, service, fetcher = fetch } = {}) {
  if (/^\s*[!！]\s*dan\s*$/i.test(command)) return { kind: 'text', text: DAN_HELP };
  return stickerLane.run(async () => {
    const image = await pickDanImage(event, call);
    if (!image) throw new UserError('请随 !dan 指令附带图片／动画表情，或回复一张图片。');
    const buffer = await downloadDanImage(image, { call, fetcher });
    return service.render(command, buffer);
  });
}
