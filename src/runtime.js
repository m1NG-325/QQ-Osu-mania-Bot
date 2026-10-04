import { UserError } from './osu.js';

export class Lane {
  constructor(limit, capacity = 20) { this.limit = limit; this.capacity = capacity; this.active = 0; this.waiting = []; }
  run(work, { signal } = {}) {
    if (signal?.aborted) return Promise.reject(new UserError('查询已取消。'));
    if (this.waiting.length >= this.capacity) return Promise.reject(new UserError('队列已满，请稍后重试。'));
    return new Promise((resolve, reject) => {
      const task = { work, resolve, reject, signal };
      task.abort = () => {
        const index = this.waiting.indexOf(task);
        if (index >= 0) { this.waiting.splice(index, 1); reject(new UserError('查询已取消。')); if (!this.active && !this.waiting.length) this.onIdle?.(); }
      };
      signal?.addEventListener('abort', task.abort, { once: true });
      this.waiting.push(task); this.drain();
    });
  }
  drain() {
    while (this.active < this.limit && this.waiting.length) {
      const task = this.waiting.shift(); this.active++;
      task.signal?.removeEventListener('abort', task.abort);
      Promise.resolve().then(() => { checkCancelled(task.signal); return task.work(); }).then(task.resolve, task.reject).finally(() => {
        this.active--; this.drain(); if (!this.active && !this.waiting.length) this.onIdle?.();
      });
    }
  }
  get status() { return { active: this.active, waiting: this.waiting.length, limit: this.limit }; }
}
export const queryLane = new Lane(4), heavyLane = new Lane(2), analysisLane = new Lane(2), downloadLane = new Lane(1, 8);
export const renderLane = new Lane(2);

// Separate senders can make progress concurrently; one sender's operations
// always commit in arrival order, including bindings and record preferences.
export class SenderQueue {
  constructor() { this.lanes = new Map(); }
  run(sender, work, options) {
    let lane = this.lanes.get(sender);
    if (!lane) {
      lane = new Lane(1); this.lanes.set(sender, lane);
      lane.onIdle=()=>{if(this.lanes.get(sender)===lane)this.lanes.delete(sender);};
    }
    return lane.run(work, options);
  }
}

export const queryBudget = action => action === 'audio' ? 180000 : action === '群榜' ? 300000 : 45000;
export const deliveryBudget = action => queryBudget(action) + 60000 + (action === 'audio' ? 120000 : 15000);
export function checkCancelled(signal) {
  if (signal?.aborted) throw new UserError('查询已取消。');
}
export async function timedWork(work, ms, parentSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal?.addEventListener('abort', abort, { once: true });
  if (parentSignal?.aborted) controller.abort();
  let onAbort;
  try {
    checkCancelled(controller.signal);
    const cancelled=new Promise((_,reject)=>{onAbort=()=>reject(new UserError('查询已取消。'));controller.signal.addEventListener('abort',onAbort,{once:true});});
    return await deadline(Promise.race([Promise.resolve().then(() => { checkCancelled(controller.signal); return work(controller.signal); }),cancelled]), ms);
  }
  finally { if(onAbort)controller.signal.removeEventListener('abort',onAbort);controller.abort(); parentSignal?.removeEventListener('abort', abort); }
}
export function deadline(promise, ms = 45000) {
  // Timeout only the caller; underlying work keeps its slot until it actually ends.
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new UserError('查询超过等待时限；后台任务仍受并发限制，请稍后重试。')), ms); })]).finally(() => clearTimeout(timer));
}
export class ResultCache {
  constructor({ ttl = 10000, capacity = 64, maxBytes = 64 * 1024 * 1024 } = {}) {
    Object.assign(this, { ttl, capacity, maxBytes }); this.entries = new Map(); this.bytes = 0;
  }
  remove(key) { const old = this.entries.get(key); if (old) this.bytes -= old.bytes; this.entries.delete(key); }
  async get(key, work) {
    const cached = this.entries.get(key);
    if (cached && cached.until > Date.now()) return structuredClone(await cached.promise);
    this.remove(key);
    const entry = { bytes: 0, until: Infinity };
    entry.promise = Promise.resolve().then(work).then(value => {
      if (this.entries.get(key) === entry) {
        const size = Buffer.byteLength(JSON.stringify(value)); entry.bytes = size; this.bytes += size; entry.until = Date.now() + this.ttl;
        while (this.entries.size > this.capacity || this.bytes > this.maxBytes) this.remove(this.entries.keys().next().value);
      }
      return value;
    }).catch(error => { if (this.entries.get(key) === entry) this.remove(key); throw error; });
    this.entries.set(key, entry);
    while (this.entries.size > this.capacity) this.remove(this.entries.keys().next().value);
    return structuredClone(await entry.promise);
  }
}
export function safeError(error) {
  return { name: /^[\w]+$/.test(error?.name || '') ? error.name : 'Error', code: /^[A-Z_0-9]+$/.test(error?.code || '') ? error.code : undefined };
}
