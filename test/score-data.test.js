import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairScore } from '../src/score-data.js';
import { OsuApi } from '../src/osu.js';
import { cardSvg } from '../src/cards.js';

test('uninitialised stable API aggregates recover from judgments and legacy score', async () => {
  const raw = { accuracy: 0, total_score: 0, legacy_total_score: 624535, legacy_score_id: 0,
    passed: true, rank: 'D', statistics: { perfect: 1506, great: 949, good: 325, ok: 93, meh: 30, miss: 100 },
    beatmap: { id: 3865212, cs: 7 }, beatmapset: { title: 'Practice' } };
  const api = new OsuApi({ fetchImpl: async () => ({ ok: true, json: async () => [raw] }) });
  api.token = async () => 'fixture';
  const [fixed] = await api.scores(1, 'recent');
  assert.equal(fixed.accuracy, 812300 / 900900);
  assert.equal(fixed.total_score, 624535);
  assert.equal(raw.accuracy, 0);
  const svg = cardSvg({ kind: 'score', scores: [fixed], demo: false });
  assert.ok(svg.includes('90.16%'));
  assert.ok(svg.includes('624,535'));
});

test('valid accuracy is preserved and unavailable or all-miss data stays honest', () => {
  assert.equal(repairScore({ accuracy: .987, statistics: { perfect: 1 } }).accuracy, .987);
  assert.equal(repairScore({ accuracy: 0, statistics: { miss: 3 } }).accuracy, 0);
  assert.equal(repairScore({ accuracy: null }).accuracy, null);
  assert.equal(repairScore({ accuracy: 0, statistics: { perfect: -1 } }).accuracy, 0);
  assert.equal(repairScore({ accuracy: 0, is_lazer: true, statistics: { perfect: 1, great: 1 } }).accuracy, 605 / 610);
});
