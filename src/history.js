import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { UserError } from './osu.js';
import {latestPair} from './score-compare.js';

export class History {
  constructor(path) { this.path = path; this.rows = []; this.enabled = new Set(); this.disabled=new Set(); this.legacyDisabled=new Set(); this.writes = Promise.resolve(); }
  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8')); this.rows = data.rows || [];
      if (!Array.isArray(this.rows)) throw new Error('Invalid history');
      if (data.version >= 3) {
        this.enabled = new Set(data.enabled || []); this.disabled = new Set(data.disabled || []);
        this.legacyDisabled = new Set(data.legacyDisabled || []);
      } else {
        // Keep old opt-outs as conservative defaults; only the sender's own
        // explicit preference may override them. Never transfer global authority.
        const oldEnabled=new Set(data.enabled || []);
        this.legacyDisabled=new Set(data.disabled||[...new Set(this.rows.map(r=>String(r.userId)))].filter(id=>!oldEnabled.has(id)));
      }
    }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this;
  }
  save() {
    const data = JSON.stringify({ version:3,enabled: [...this.enabled],disabled:[...this.disabled],legacyDisabled:[...this.legacyDisabled],rows: this.rows });
    this.writes = this.writes.catch(() => {}).then(async () => { await mkdir(dirname(this.path), { recursive: true }); await writeFile(this.path + '.tmp', data); await rename(this.path + '.tmp', this.path); });
    return this.writes;
  }
  async toggle(sender, enabled) {
    if (typeof sender !== 'string' || !sender) throw new Error('History preference needs a sender');
    const id=sender;
    if (enabled) {this.enabled.add(id);this.disabled.delete(id);}
    else {this.enabled.delete(id);this.disabled.add(id);}
    await this.save();
  }
  isEnabled(sender, user) {
    return !this.disabled.has(sender) && (this.enabled.has(sender) || !this.legacyDisabled.has(String(user.id)));
  }
  async capture(result, sender='local') {
    if (!result.user || !this.isEnabled(sender, result.user)) return;
    const profile = result.user.statistics || {};
    const now = new Date().toISOString();
    const scores = [...(result.scores || []), ...(result.best || []), ...(result.recent || [])];
    for (const score of scores) {
      const identity = `${sender}:${result.user.id}:${score.id || `${score.beatmap?.id}:${score.ended_at || score.created_at}`}`;
      if (!this.rows.some(row => row.identity === identity)) {
        const compact = Object.fromEntries(['id','accuracy','max_combo','pp','mods','statistics','ended_at','created_at','rank','passed','total_score','legacy_total_score','legacy_score_id','is_lazer'].map(key=>[key,score[key]]));
        compact.beatmap = Object.fromEntries(['id','cs','version','difficulty_rating'].map(key=>[key,score.beatmap?.[key]]));
        compact.beatmapset = Object.fromEntries(['title','artist','creator'].map(key=>[key,score.beatmapset?.[key] ?? score.beatmap?.beatmapset?.[key]]));
        this.rows.push({ identity, sender, userId: String(result.user.id), observedAt: now, type: 'score', score: compact });
      }
    }
    const last = this.rows.findLast(row => row.sender === sender && row.userId === String(result.user.id) && row.type === 'profile');
    if (!last || now.slice(0, 10) !== last.observedAt.slice(0, 10) || profile.pp !== last.pp) this.rows.push({ sender, userId: String(result.user.id), observedAt: now, type: 'profile', pp: profile.pp ?? null, globalRank: profile.global_rank ?? null });
    const cutoff = Date.now() - 90 * 86400000;
    this.rows = this.rows.filter(row => Date.parse(row.observedAt) >= cutoff).slice(-5000);
    await this.save();
  }
  records(user, sender='local') {
    return this.rows.filter(row => row.userId === String(user.id) && (row.sender === sender || !row.sender && sender === 'local'));
  }
  report(user, days, sender='local') {
    const rows = this.records(user,sender).filter(row => Date.parse(row.observedAt) >= Date.now() - days * 86400000);
    const profiles = rows.filter(row => row.type === 'profile');
    return { kind: 'report', user, days, profiles, scores: rows.filter(row => row.type === 'score').map(row => row.score), observedFrom: rows[0]?.observedAt || null,recordingEnabled:this.isEnabled(sender,user) };
  }
  compare(user, mapId, sender='local') {
    const rows = this.records(user,sender).filter(row => row.type === 'score' && String(row.score.beatmap?.id) === String(mapId));
    const scores=latestPair(rows.map(row=>row.score),mapId);
    if (scores.length < 2) throw new UserError('此谱面还没有两次带游玩时间的查询记录。开启记录后，查询不同的两次成绩即可对比。');
    return { kind: 'compare', user, source:'available',scores };
  }
}
