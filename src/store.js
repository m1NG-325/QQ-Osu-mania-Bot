import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class Bindings {
  constructor(path, mode) { this.path = path; this.mode = mode; this.data = {}; this.writes = Promise.resolve(); }
  async load() {
    const valid = data => data && !Array.isArray(data) && typeof data === 'object' && Object.values(data).every(id => typeof id === 'string' && /^[1-9]\d*$/.test(id));
    let problem;
    for (const file of [this.path, `${this.path}.bak1`, `${this.path}.bak2`, `${this.path}.bak3`]) {
      try { const data = JSON.parse(await readFile(file, 'utf8')); if (!valid(data)) throw Error('Invalid bindings'); this.data = data; this.recovered = file !== this.path; return this; }
      catch (error) { if (error.code !== 'ENOENT') problem = error; }
    }
    if (problem) throw new Error('绑定文件及备份无法读取，请保留原文件后检查。');
    return this;
  }
  key(sender) { return `${this.mode}:${sender}`; }
  get(sender) { return this.data[this.key(sender)]; }
  async set(sender, id) { this.data[this.key(sender)] = id; await this.save(); }
  async remove(sender) { delete this.data[this.key(sender)]; await this.save(); }
  save() {
    const snapshot = JSON.stringify(this.data, null, 2);
    const next = this.writes.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(`${this.path}.tmp`, snapshot);
      if (!this.recovered) {
        for (let i = 3; i > 1; i--) { try { await copyFile(`${this.path}.bak${i-1}`, `${this.path}.bak${i}`); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
        try { await copyFile(this.path, `${this.path}.bak1`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      await rename(`${this.path}.tmp`, this.path);
      this.recovered = false;
    });
    this.writes = next;
    return next;
  }
}
