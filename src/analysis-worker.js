import { validNoteData } from './beatmap-limits.js';
import { parentPort, workerData } from 'node:worker_threads';
import { OsuFileParser } from '../vendor/mania-analyser/js/parser/osuFileParser.js';
import { runSunnyEstimatorFromText } from '../vendor/mania-analyser/js/estimator/sunnyEstimator.js';
import { runSunnyWindowEstimatorFromText } from '../vendor/mania-analyser/js/estimator/sunnyWindowEstimator.js';
import { runDanielEstimatorFromText } from '../vendor/mania-analyser/js/estimator/danielEstimator.js';
import { runAzusaEstimatorFromText } from '../vendor/mania-analyser/js/estimator/azusaEstimator.js';
import { classifyCompanellaDifficulty } from '../vendor/mania-analyser/js/estimator/companellaEstimator.js';
import { analyzeEtternaFromText } from '../vendor/mania-analyser/js/ett/index.js';
import { calculateInterludeStar } from '../vendor/mania-analyser/js/interlude/index.js';
import { parseOsuManiaFromText } from '../vendor/mania-analyser/js/parser/patternOsuParser.js';
import { createChart } from '../vendor/mania-analyser/js/patterns/chart.js';
import { fromChart } from '../vendor/mania-analyser/js/patterns/summary.js';

const compact = r => ({ star: Number.isFinite(r.star) ? r.star : null, label: r.estDiff,
  source: r.actualEstimatorAlgorithm, lnStar: r.lnStar });
const sample = (array, max = 360) => array.length <= max ? Array.from(array)
  : Array.from({ length: max }, (_, i) => array[Math.round(i * (array.length - 1) / (max - 1))]);

try {
  const { raw, rate, detailed } = workerData;
  const parser = new OsuFileParser(raw); parser.process();
  if (parser.status !== 'OK' || parser.gameMode !== '3') throw new Error('只支持原生 osu!mania 谱面，或谱面文件无有效音符。');
  const p = parser.getParsedData();
  if (!Number.isInteger(p.columnCount) || p.columnCount < 1 || p.columnCount > 10 || !p.noteStarts.length)
    throw new Error('谱面键数或音符数据无效。');
  if (!validNoteData(p))
    throw new Error('谱面超出分析范围（最多 50000 音符、2 小时）。');
  const options = { speedRate: rate, withGraph: true, enableAnalyzeLN: true };
  const sunny = runSunnyEstimatorFromText(raw, options, parser);
  const ratings = { Sunny: compact(sunny) }, warnings = [];
  const safe = async (name, fn) => {
    try { return await fn(); } catch { warnings.push(`${name} unavailable`); return null; }
  };
  // The windowed LN estimator belongs to the 4K branch. Native 7K uses the
  // same full-chart Sunny and 7K interval table as its contribution estimate.
  const ln = p.columnCount===4 ? await safe('LN', () => runSunnyWindowEstimatorFromText(raw, options, parser)) : null;
  if (ln) ratings.Sunny = compact(ln);
  const start = Math.min(...p.noteStarts), end = Math.max(...p.noteStarts, ...p.noteEnds);
  const length = Math.max(.001, (end - start) / 1000 / rate);
  const bins = Math.min(360, Math.max(1, Math.ceil(length)));
  const density = Array(bins).fill(0), columnNotes = Array(p.columnCount).fill(0);
  for (let i = 0; i < p.noteStarts.length; i++) {
    density[Math.min(bins - 1, Math.floor((p.noteStarts[i] - start) / rate / 1000 / length * bins))]++;
    columnNotes[p.columns[i]]++;
  }
  for (let i = 0; i < bins; i++) density[i] /= length / bins;
  const longNotes = p.noteTypes.filter(t => (t & 128) !== 0).length;
  const rows = new Map();
  for (const time of p.noteStarts) rows.set(time, (rows.get(time) || 0) + 1);
  const chordRows = [...rows.values()].filter(n => n > 1).length;
  const patterns = [], totals = {};
  const fullChart = await safe('Patterns', () => parseOsuManiaFromText(raw));
  let patternReport = null;
  if (fullChart) {
    patternReport = await safe('Patterns', () => fromChart(fullChart));
    // Same open-source detector on each non-overlapping 15 s window. Tags may overlap;
    // the timeline displays the detector's dominant category, not note percentages.
    const windowMs = 15000 * rate;
    for (let offset = start; offset <= end; offset += windowMs) {
      const notes = fullChart.Notes.filter(n => n.Time >= offset && n.Time < offset + windowMs);
      let category = 'Break';
      if (notes.length >= 4) {
        const report = fromChart(createChart(fullChart.Keys, notes, fullChart.BPM, fullChart.SV));
        category = report.Category;
      }
      patterns.push({ time: (offset - start) / 1000 / rate, category });
      totals[category] = (totals[category] || 0) + Math.min(15, Math.max(0, (end - offset) / 1000 / rate));
    }
  }
  let msd = null;
  if (detailed) {
    if (p.columnCount === 4) {
      const daniel = await safe('Daniel', () => runDanielEstimatorFromText(raw, options, parser));
      if (daniel) ratings.Daniel = compact(daniel);
      const azusa = await safe('Azusa', () => runAzusaEstimatorFromText(raw, { ...options, withGraph: false }, parser));
      if (azusa && Number.isFinite(azusa.star) && azusa.actualEstimatorAlgorithm !== 'Sunny') ratings.Azusa = compact(azusa);
    }
    msd = await safe('MinaCalc', () => analyzeEtternaFromText(raw, { musicRate: rate, scoreGoal: .93, etternaVersion: '0.72.3' }));
    if (msd && !msd.junkFile && p.columnCount === 4) {
      const interlude = await safe('Interlude', () => calculateInterludeStar(raw, rate));
      if (interlude != null) {
        const comp = await safe('Companella', () => classifyCompanellaDifficulty({ msdValues: msd.values, interludeStar: interlude, sunnyStar: sunny.star }));
        if (comp) ratings.Companella = { star: null, label: comp.estDiff };
      }
    }
  }
  parentPort.postMessage({ result: {
    rate, keys: p.columnCount, notes: p.noteStarts.length, longNotes, lnRatio: longNotes / p.noteStarts.length,
    length, chordRows, rows: rows.size, columnNotes, density, avgNps: p.noteStarts.length / length,
    peakNps: Math.max(...density), ratings, warnings, msd: msd && !msd.junkFile ? msd : null,
    strain: { times: sample(sunny.graph.times).map(t => (t - start / rate) / 1000), values: sample(sunny.graph.values) },
    patterns, patternSummary: Object.entries(totals).sort((a,b) => b[1] - a[1]),
    category: patternReport?.Category || 'Uncategorised',
    clusters: (patternReport?.Clusters || []).slice(0, 5).map(c => ({ name: c.Pattern, bpm: c.BPM * rate, subtypes: c.SpecificTypes, amount: c.Amount }))
  } });
} catch (error) { parentPort.postMessage({ error: error.message }); }
