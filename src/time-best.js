import { UserError } from './osu.js';

export function scoreClient(score) {
  if (Number(score.legacy_score_id) > 0 || Number(score.legacy_total_score) > 0) return 'Stable';
  if (typeof score.is_lazer === 'boolean') return score.is_lazer ? 'Lazer' : 'Stable';
  if (Object.hasOwn(score, 'legacy_score_id') || score.build_id != null) return 'Lazer';
  if (score.total_score != null) return 'Lazer';
  if (score.created_at && score.score != null) return 'Stable';
  return '—';
}

export function timeBestArgument(argument) {
  const match = argument.match(/^(?:#(\d+)(?=\s|$))?\s*(.*)$/);
  if (!match || (!match[1] && argument.startsWith('#'))) throw new UserError('用法：!tbp#7 [玩家名 / ID]，天数为 1–30 的整数。');
  const days = match[1] == null ? 30 : Number(match[1]);
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new UserError('最多查询近 30 天；请输入 1–30 的整数，例如 !tbp#7。');
  return { days, target: match[2].trim() };
}

export function recentBest(scores, days, now = Date.now()) {
  const since = now - days * 86400000;
  return scores.map((score, i) => ({ ...score, bpRank: i + 1 }))
    .filter(score => {
      const played = Date.parse(score.ended_at || score.created_at);
      return Number.isFinite(played) && played >= since && played <= now && score.passed !== false;
    });
}
