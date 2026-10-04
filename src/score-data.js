// Fallback for API records with judgments but uninitialised aggregate values.
export function repairScore(score) {
  const result = { ...score };
  const j = score.statistics || {};
  const counts = [j.perfect ?? j.count_geki, j.great ?? j.count_300,
    j.good ?? j.count_katu, j.ok ?? j.count_100, j.meh ?? j.count_50,
    j.miss ?? j.count_miss].map(value => value ?? 0);
  const valid = counts.every(value => Number.isFinite(value) && value >= 0);
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (valid && total > 0 && !(Number.isFinite(score.accuracy) && score.accuracy > 0 && score.accuracy <= 1)) {
    const stable = Number(score.legacy_total_score) > 0 || Number(score.legacy_score_id) > 0
      || score.is_lazer === false || (score.created_at && score.score != null && score.total_score == null);
    // Stable MAX and 300 share the accuracy weight; lazer MAX is worth 305.
    const perfectWeight = stable ? 300 : 305;
    const [perfect, great, good, ok, meh] = counts;
    result.accuracy = (perfectWeight * perfect + 300 * great + 200 * good + 100 * ok + 50 * meh) / (perfectWeight * total);
    result.accuracySource = 'judgments';
  }
  if (!(Number(score.total_score) > 0) && Number(score.legacy_total_score) > 0) {
    result.total_score = Number(score.legacy_total_score);
  }
  return result;
}
