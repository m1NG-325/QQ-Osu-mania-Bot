import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { scoreRate } from './analysis.js';

const cache = new Map();
export const hasMods = score => (score.mods || []).some(m => !['NM','CL'].includes(typeof m === 'string' ? m : m.acronym));

export function modStars(raw, score) {
  return calculate(raw, score, false);
}
export function mapPerformance(raw) {
  return calculate(raw, { mods: [] }, true);
}
export function performanceProjection(raw, score, accuracy) {
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100) return Promise.reject(new Error('Invalid accuracy'));
  return calculate(raw, score, [accuracy]);
}
function calculate(raw, score, performance) {
  if (!raw.startsWith('osu file format') || Buffer.byteLength(raw) > 4 * 1024 * 1024) return Promise.reject(new Error('Invalid beatmap'));
  const options = {
    mods: (score.mods || []).map(m => typeof m === 'string' ? m : { acronym: m.acronym, ...(m.settings ? { settings: m.settings } : {}) }),
    ...((score.mods || []).some(m => ['DT','NC','HT','DC'].includes(typeof m === 'string' ? m : m.acronym)) ? { clockRate: scoreRate(score) } : {}),
    lazer: score.total_score != null && !score.legacy_score_id
  };
  const key = createHash('sha256').update(raw).update(JSON.stringify({options,performance})).digest('hex');
  if (cache.has(key)) return cache.get(key);
  const result = new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./difficulty-worker.js', import.meta.url), {
      workerData: { raw, options, performance }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128 }
    });
    let settled = false;
    const finish = (error, stars) => {
      if (settled) return; settled = true; clearTimeout(timer); worker.terminate();
      if (error) reject(new Error(error)); else resolve(stars);
    };
    const timer = setTimeout(() => finish('Difficulty timed out'), 10000);
    worker.once('message', r => finish(r.error, Array.isArray(performance) ? { stars: r.stars, performance: r.performance } : performance ? r.performance : r.stars));
    worker.once('error', () => finish('Difficulty worker failed'));
    worker.once('exit', () => { if (!settled) finish('Difficulty worker stopped'); });
  });
  cache.set(key, result);
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  result.catch(() => cache.delete(key));
  return result;
}
