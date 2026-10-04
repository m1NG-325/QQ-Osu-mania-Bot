import { repairScore } from './score-data.js';
export class UserError extends Error {}

export class OsuApi {
  constructor({ clientId, clientSecret, fetchImpl = fetch }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetch = fetchImpl;
    this.expiresAt = 0;
  }
  async token() {
    if (!this.clientId || !this.clientSecret) {
      throw new UserError('请先在 .env 中填写 OSU_CLIENT_ID 和 OSU_CLIENT_SECRET，再重启服务。');
    }
    if (this.accessToken && Date.now() < this.expiresAt) return this.accessToken;
    if (!this.tokenPromise) {
      this.tokenPromise = (async () => {
        const response = await this.fetch('https://osu.ppy.sh/oauth/token', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: this.clientId, client_secret: this.clientSecret,
            grant_type: 'client_credentials', scope: 'public' }),
          signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) throw new UserError('osu! 接口认证失败，请检查应用 ID 和密钥。');
        const data = await response.json();
        this.accessToken = data.access_token;
        this.expiresAt = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
        return this.accessToken;
      })().finally(() => { this.tokenPromise = null; });
    }
    return this.tokenPromise;
  }
  async get(path) {
    const response = await this.fetch(`https://osu.ppy.sh/api/v2/${path}`, {
      headers: { Authorization: `Bearer ${await this.token()}`, Accept: 'application/json', 'x-api-version': '20220705' },
      signal: AbortSignal.timeout(15000)
    });
    if (response.status === 404) {const error=new UserError('没有找到这个玩家或谱面，请检查名称或 ID。');error.status=404;throw error;}
    if (response.status === 429) throw new UserError('osu! 查询太频繁，请稍后再试。');
    if (response.status === 401) this.expiresAt = 0;
    if (!response.ok) throw new UserError(`osu! 接口暂时不可用（${response.status}）。`);
    return response.json();
  }
  user(name) { return this.get(`users/${encodeURIComponent(name)}/mania`); }
  async scores(id, type, limit = 10, offset = 0) {
    const scores = await this.get(`users/${id}/scores/${type}?mode=mania&limit=${limit}&include_fails=1${offset ? `&offset=${offset}` : ''}`);
    return Array.isArray(scores) ? scores.map(repairScore) : scores;
  }
  async bestScores(id) {
    this.bestCache ||= new Map();
    const cached = this.bestCache.get(String(id));
    if (cached && Date.now() - cached.time < 60000) return cached.promise;
    const promise = (async () => {
      const first = await this.scores(id, 'best', 100);
      // Best scores are sorted by PP, so old dates on page one cannot end the search.
      return first.length < 100 ? first : first.concat(await this.scores(id, 'best', 100, 100));
    })();
    this.bestCache.set(String(id), { time: Date.now(), promise });
    if (this.bestCache.size > 32) this.bestCache.delete(this.bestCache.keys().next().value);
    try { return await promise; } catch (error) { this.bestCache.delete(String(id)); throw error; }
  }
  map(id) { return this.get(`beatmaps/${id}`); }
  mapset(id) { return this.get(`beatmapsets/${id}`); }
  async mapScores(mapId,userId) {
    try {const data=await this.get(`beatmaps/${mapId}/scores/users/${userId}/all?ruleset=mania&legacy_only=0`);return (data.scores||[]).map(repairScore);}
    catch(error){if(error.status===404)return [];throw error;}
  }
  async searchMaps(query) {
    const data=await this.get(`beatmapsets/search?m=3&s=ranked&sort=favourites_desc&q=${encodeURIComponent(query)}`);
    return (data.beatmapsets||[]).flatMap(set=>(set.beatmaps||[]).filter(map=>map.mode==='mania'&&!map.convert).map(map=>({...map,beatmapset:{...set,beatmaps:undefined}})));
  }
  async recommendationSnapshot(id) {
    if (!/^[1-9]\d*$/.test(String(id))) throw new UserError('玩家 ID 无效。');
    try {
      // Public third-party endpoint; no osu! OAuth credentials are sent here.
      const response=await this.fetch(`https://api.mania-tracker.com/api/snapshots/farm-helper?user=${id}&limit=30`, {
        headers:{Accept:'application/json'}, signal:AbortSignal.timeout(25000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body=await response.text();
      if (body.length>2*1024*1024) throw new Error('Response too large');
      return JSON.parse(body);
    } catch { throw new UserError('Mania Tracker 推荐服务暂时不可用，请稍后再试。'); }
  }
  async rawMap(id) {
    if (!/^[1-9]\d*$/.test(String(id))) throw new UserError('谱面 ID 无效。');
    this.rawCache ||= new Map();
    const cached = this.rawCache.get(String(id));
    if (cached && Date.now() - cached.time < 10 * 60 * 1000) return cached.raw;
    const response = await this.fetch(`https://osu.ppy.sh/osu/${id}`, {
      redirect: 'error', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new UserError(`无法下载谱面文件（${response.status}）。`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) throw new UserError('谱面文件超过分析大小限制。');
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
    if (!raw.startsWith('osu file format')) throw new UserError('下载到的内容不是有效谱面文件。');
    this.rawCache.set(String(id), { raw, time: Date.now() });
    if (this.rawCache.size > 16) this.rawCache.delete(this.rawCache.keys().next().value);
    return raw;
  }
}
