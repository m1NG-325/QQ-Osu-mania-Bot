import { UserError } from './osu.js';
import { scoreRate } from './analysis.js';
import { hasMods } from './difficulty.js';
import { analyzeText, modStars, mapPerformance, danContribution } from './compute.js';
import { helpContent, helpText } from './help.js';
import { BeatmapAudio } from './audio.js';
import { timeBestArgument, recentBest } from './time-best.js';
import { recommendations } from './recommend.js';
import { beatmapView, viewArguments } from './beatmap-view.js';
import { downloadLane, SenderQueue, checkCancelled } from './runtime.js';
import {featureCommand} from './features.js';
import {recentScoreCompare} from './score-compare.js';

export const HELP = helpText(true);

export function parseCommand(text) {
  const ranged=text.trim().match(/^[!！]\s*(ps|bp)\s*([+-]?\d+(?:\.\d+)?)-([+-]?\d+(?:\.\d+)?)(?:\s+(.*))?$/i);
  if(ranged)return {action:ranged[1].toLowerCase(),argument:(ranged[4]||'').trim(),range:{start:Number(ranged[2]),end:Number(ranged[3])}};
  const counted=text.trim().match(/^[!！]\s*(ps|bp)\s+([^\s]+)条(?:\s+(.*))?$/i);
  if(counted)return {action:counted[1].toLowerCase(),argument:(counted[3]||'').trim(),count:/^[1-9]\d*$/.test(counted[2])?Number(counted[2]):NaN};
  const extra = text.trim().match(/^[!！]\s*(我的成绩|随机|练习|群榜|谱包|对比|周报|月报|记录|状态)(?=\s|$)\s*(.*)$/);
  if (extra) return { action: extra[1], argument: extra[2].trim() };
  const indexed=text.trim().match(/^[!！]\s*(bp|p)#([^\s]*)(?:\s+(.*))?$/i);
  if(indexed)return {action:indexed[1].toLowerCase(),argument:(indexed[3]||'').trim(),index:/^[1-9]\d*$/.test(indexed[2])?Number(indexed[2]):NaN};
  const recommend = text.trim().match(/^[!！]\s*推荐(?=\s|$)\s*(.*)$/);
  if(recommend)return {action:'recommend',argument:recommend[1].trim()};
  const timeBest = text.trim().match(/^[!！]\s*tbp(?=\s|#|$)\s*(.*)$/i);
  if (timeBest) return { action: 'tbp', argument: timeBest[1].trim() };
  const match = text.trim().match(/^[!！]\s*(bind|unbind|help|audio|au|bp|ps|gb|im|i|p|m|a|o|v)(?=\s|\d|$)\s*(.*)$/i);
  if (!match) return null;
  const action = match[1].toLowerCase();
  return { action: action === 'au' ? 'audio' : action, argument: match[2].trim() };
}

export function mapId(value) {
  if (/^\d+$/.test(value)) return value;
  const match = value.match(/^https?:\/\/(?:www\.)?osu\.ppy\.sh\/(?:b\/(\d+)|beatmaps\/(\d+)|beatmapsets\/\d+#(?:mania|osu|taiko|fruits)\/(\d+))\/?$/);
  if (match) return match[1] || match[2] || match[3];
  throw new UserError('请提供具体谱面 ID 或 osu! 谱面链接，例如 !m 100001。');
}

export class Bot {
  constructor({ api, bindings, demo = true, audio = new BeatmapAudio(), history, mapIndex }) {
    this.api = api; this.bindings = bindings; this.demo = demo;
    this.audio = audio;
    this.history = history;
    this.mapIndex = mapIndex;
    this.senders = new SenderQueue();
  }
  async run(text, sender = 'local', context={}) {
    return this.senders.run(sender, () => this.execute(text, sender, context), { signal: context.signal });
  }
  async execute(text, sender = 'local', context={}) {
    checkCancelled(context.signal);
    const command = parseCommand(text);
    if (!command) return { kind: 'text', text: '未识别命令。输入 !help 查看用法。' };
    const { action, argument, index, count, range } = command;
    if(['我的成绩','随机','练习','群榜','谱包','对比'].includes(action)){
      const result=await featureCommand(this,action,argument,sender,context);
      if(result)return {...result,demo:this.demo};
    }
    if(range&&(!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<1||range.end<range.start||range.end>(action==='bp'?200:100)))
      throw new UserError(`范围需满足 开始≤结束，且为 1–${action==='bp'?200:100} 的整数，例如 !${action} 10-30 玩家名。`);
    if(count!=null&&(!Number.isInteger(count)||count<1||count>(action==='bp'?200:100)))
      throw new UserError(`条数范围为 1–${action==='bp'?200:100}，例如 !${action} 20条 玩家名。`);
    if (['记录','周报','月报','对比'].includes(action)) {
      if (!this.history&&action!=='对比') throw new UserError('个人记录尚未启用。');
      const bound = this.bindings.get(sender);
      if (!bound) throw new UserError('先用 !bind 玩家名 绑定自己的查询对象。');
      const user = await this.api.user(bound);
      if (action === '记录') {
        if (!['开启','关闭'].includes(argument)) throw new UserError('用法：!记录 开启 或 !记录 关闭；仅保存以后查询到的成绩，关闭后保留已有记录。');
        checkCancelled(context.signal);
        await this.history.toggle(sender, argument === '开启');
        return {kind:'text',text:argument === '开启' ? '已开启你的查询记录；保留最近 90 天，不能补全过去历史，不影响其他人的设置。' : '已停止保存你的新查询记录，已有记录保留，不影响其他人。'};
      }
      if (action === '对比') {
        return {...await recentScoreCompare(this.api,this.history,user,mapId(argument),sender),demo:this.demo};
      }
      if (argument) throw new UserError(`用法：!${action}，查看当前绑定玩家的查询记录。`);
      return {...this.history.report(user, action==='周报'?7:30, sender), demo:this.demo};
    }
    if(index!=null&&(!Number.isInteger(index)||index<1||index>(action==='bp'?200:100)))
      throw new UserError(`${action==='bp'?'最佳成绩':'最近成绩'}序号范围为 1–${action==='bp'?200:100}，例如 !${action}#2 玩家名。`);
    if (action === 'help') return { kind: 'help', ...helpContent(this.demo), text: helpText(this.demo), demo: this.demo };
    if(action==='recommend'){
      const target=argument||this.bindings.get(sender);
      if(!target)throw new UserError('请先 !bind 你的玩家名，再发送 !推荐；也可直接 !推荐 玩家名。');
      const user=await this.api.user(target);
      return {...await recommendations(this.api,user),demo:this.demo};
    }
    if (action === 'tbp') {
      const { days, target: named } = timeBestArgument(argument);
      const target = named || this.bindings.get(sender);
      if (!target) throw new UserError('请先 !bind 你的玩家名，或发送 !tbp#7 玩家名。');
      const user = await this.api.user(target);
      const best = await this.api.bestScores(user.id);
      const queriedAt = new Date().toISOString();
      return { kind: 'timebest', user, days, scores: recentBest(best, days, Date.parse(queriedAt)), queriedAt, demo: this.demo };
    }
    if (action === 'v') {
      const options=viewArguments(argument),id=mapId(options.id),map=await this.api.map(id);
      const view=beatmapView(await this.api.rawMap(id),options);
      return {kind:'view',map,view,queriedAt:new Date().toISOString(),demo:this.demo};
    }
    if (action === 'audio') {
      const id = mapId(argument);
      if (this.demo) return { kind: 'text', text: '完整谱面音频仅在真实数据模式可用。' };
      const map = await this.api.map(id);
      if (map.beatmapset?.availability?.download_disabled) throw new UserError('此谱面的下载已被禁用，无法获取音频。');
      return { kind: 'audio', ...await downloadLane.run(async () => this.audio.get(map, await this.api.rawMap(id)), { signal: context.signal }) };
    }
    if (action === 'bind' && !argument) {
      const bound = this.bindings.get(sender);
      if (!bound) return { kind: 'text', text: '你还没有绑定。发送 !bind 你的osu玩家名，例如 !bind ExamplePlayer；也可直接 !i 玩家名 查询。' };
      const user = await this.api.user(bound);
      return { kind: 'text', text: `你当前绑定：${user.username}（${user.id}）。\n发送 !i 查看资料；!bind 新玩家名 可更换，!unbind 可解除。` };
    }
    if (action === 'unbind') {
      checkCancelled(context.signal);
      await this.bindings.remove(sender);
      return { kind: 'text', text: '已解除你的绑定，其他群友的绑定不受影响。' };
    }
    if (action === 'm' || action === 'gb' || action === 'a') {
      const parts = action === 'a' ? argument.split(/\s+/) : [argument];
      if (parts.length > 2) throw new UserError('用法：!a 谱面ID [倍速]，例如 !a 3773354 1.5。');
      const rate = parts[1] == null ? 1 : Number(parts[1]);
      if (action === 'a' && (!Number.isFinite(rate) || rate < .5 || rate > 2)) throw new UserError('倍速范围为 0.5–2.0。');
      const map = await this.api.map(mapId(parts[0]));
      if (action === 'a') {
        const analysis = await analyzeText(await this.api.rawMap(map.id), { rate });
        if(this.mapIndex)await this.mapIndex.add(map,analysis);
        return { kind: 'analysis', map, analysis, demo: this.demo };
      }
      if (action === 'm' && this.api.rawMap) {
        try {
          const raw = await this.api.rawMap(map.id);
          const [analysis, performance] = await Promise.allSettled([
            analyzeText(raw, { detailed: false }), mapPerformance(raw)
          ]);
          if (analysis.status === 'fulfilled') { map.analysis = analysis.value; map.density = analysis.value.density; if(this.mapIndex)await this.mapIndex.add(map,analysis.value); }
          else map.analysisUnavailable = true;
          if (performance.status === 'fulfilled') map.performance = performance.value;
        }
        catch { map.analysisUnavailable = true; }
      }
      if (action === 'm') return { kind: 'map', map, demo: this.demo };
      const url = map.beatmapset?.covers?.cover;
      if (!url) return { kind: 'text', text: this.demo
        ? '演示模式没有真实背景图。切换真实数据后，!gb 会返回谱面封面背景。'
        : '这张谱面暂时没有可用的封面背景。' };
      return { kind: 'background', url: /^[1-9]\d*$/.test(String(map.beatmapset?.id))
        ? `https://assets.ppy.sh/beatmaps/${map.beatmapset.id}/covers/fullsize.jpg` : url, demo: this.demo };
    }
    const target = argument || this.bindings.get(sender);
    if (!target) throw new UserError('先用 !bind 你的osu玩家名 绑定自己的查询对象，或直接输入 !i 玩家名。每个群友的绑定独立保存。');
    const user = await this.api.user(target);
    if (action === 'o') return { kind: 'avatar', user, demo: this.demo };
    if (action === 'bind') {
      checkCancelled(context.signal);
      await this.bindings.set(sender, String(user.id));
      return { kind: 'text', text: `你已绑定 ${user.username}（${user.id}）。\n现在发送 !i、!p 或 !bp 即可查询；其他群友可以各自绑定。${this.demo ? '\n当前为演示模式。' : ''}` };
    }
    if (action === 'im') {
      if (!this.demo) throw new UserError('谱师面板当前仅提供本地演示，真实谱师统计尚未接入。');
      return { kind: 'mapper', user, mapping: await this.api.mapper(user.id), demo: this.demo };
    }
    if (action === 'i') {
      const [best, recent] = await Promise.all([
        this.api.scores(user.id, 'best', 5), this.api.scores(user.id, 'recent', 5)
      ]);
      return { kind: 'profile', user, best, recent, demo: this.demo };
    }
    const single=action==='p'||index!=null;
    const requested=single?1:range?range.end-range.start+1:count??16,type=action==='bp'?'best':'recent';
    const offset=index!=null?index-1:range?range.start-1:0;
    const scores = await this.api.scores(user.id, type, Math.min(100,requested), offset);
    if(requested>100&&scores.length===100)scores.push(...await this.api.scores(user.id,type,requested-100,offset+100));
    if (!scores.length) return { kind: 'text', text: index==null?'没有查询到该玩家的 mania 成绩。':`没有查询到 ${user.username} 的${action==='bp'?'最佳':'最近'}第 ${index} 条 mania 成绩，以 osu! API 可返回的记录为准。` };
    if (single && scores[0].beatmap?.id) {
      const map = await this.api.map(scores[0].beatmap.id);
      if (hasMods(scores[0]) && this.api.rawMap) {
        try { map.modStars = await modStars(await this.api.rawMap(map.id), scores[0]); }
        catch { map.modStars = null; }
      }
      if (this.api.rawMap) {
        try {
          const unsupported = (scores[0].mods || []).some(mod => ['HR','EZ','DA','IN','HO'].includes(typeof mod === 'string' ? mod : mod.acronym));
          if (unsupported) throw new Error('Unsupported analysis mod');
          map.analysis = await analyzeText(await this.api.rawMap(map.id), { rate: scoreRate(scores[0]), detailed: false }); map.density = map.analysis.density;
          if(this.mapIndex)await this.mapIndex.add(map,map.analysis);
        }
        catch { map.analysisUnavailable = true; }
      }
      if ([4,7].includes(map.cs) && this.api.rawMap) {
        try { map.danContribution = await danContribution(await this.api.rawMap(map.id), {...scores[0],beatmap:map}); }
        catch { map.danUnavailable = true; }
      }
      scores[0] = { ...scores[0], beatmap: { ...scores[0].beatmap, ...map } };
    }
    return { kind: single ? 'score' : 'scores', user, scores, ...(!single?{requestedCount:requested,scoreStart:offset+1,...(range?{requestedRange:range}:{})}:{}), ...(index!=null?{scoreIndex:index,scoreType:action==='bp'?'best':'recent'}:{}),
      title: action === 'bp' ? 'BEST PERFORMANCE' : 'RECENT PLAYS', demo: this.demo };
  }
}
