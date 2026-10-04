import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { UserError } from './osu.js';

const cache = new Map();
export function scoreRate(score) {
  const mod = (score.mods || []).find(m => ['DT','NC','HT','DC'].includes(typeof m === 'string' ? m : m.acronym));
  const value = Number(mod?.settings?.speed_change);
  return Number.isFinite(value) && value > 0 ? value : mod ? ['HT','DC'].includes(typeof mod === 'string' ? mod : mod.acronym) ? .75 : 1.5 : 1;
}
export function analyzeText(raw, { rate = 1, detailed = true } = {}) {
  if (!Number.isFinite(rate) || rate < .5 || rate > 2) throw new UserError('倍速范围为 0.5–2.0，例如 !a 3773354 1.5。');
  if (!raw.startsWith('osu file format') || Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new UserError('谱面文件无效或超过 4 MB。');
  const key = createHash('sha256').update(raw).update(`${rate}:${detailed}`).digest('hex');
  if (cache.has(key)) return cache.get(key);
  const pending = new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analysis-worker.js', import.meta.url), {
      workerData: { raw, rate, detailed }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 384 }
    });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer); worker.terminate();
      if (error) reject(new UserError(error)); else resolve(result);
    };
    const timer = setTimeout(() => finish('谱面分析超时，请尝试其他谱面。'), 25000);
    worker.once('message', data => finish(data.error, data.result));
    worker.once('error', () => finish('谱面分析器暂时不可用。'));
    worker.once('exit', () => { if (!settled) finish('谱面分析器异常退出。'); });
  });
  cache.set(key, pending);
  if (cache.size > 32) cache.delete(cache.keys().next().value);
  pending.catch(() => cache.delete(key));
  return pending;
}
