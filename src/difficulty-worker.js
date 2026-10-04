import { parentPort, workerData } from 'node:worker_threads';
import rosu from 'rosu-pp-js';

let map, attributes, calculator;
try {
  map = new rosu.Beatmap(workerData.raw);
  if (map.mode !== rosu.GameMode.Mania || map.nObjects > 50000 || map.isSuspicious()) throw new Error('Unsupported chart');
  calculator = new rosu.Difficulty(workerData.options);
  attributes = calculator.calculate(map);
  if (!Number.isFinite(attributes.stars)) throw new Error('Invalid stars');
  const performance = workerData.performance ? (Array.isArray(workerData.performance) ? workerData.performance : [100,99,98,96]).map(accuracy => {
    const builder = new rosu.Performance({ ...workerData.options, accuracy, misses: 0 });
    let result;
    try {
      result = builder.calculate(attributes);
      if (!Number.isFinite(result.pp)) throw new Error('Invalid PP');
      return { accuracy, pp: result.pp };
    } finally { result?.free(); builder.free(); }
  }) : undefined;
  parentPort.postMessage({ stars: attributes.stars, performance });
} catch { parentPort.postMessage({ error: 'Mods 难度计算暂不可用。' }); }
finally { attributes?.free(); calculator?.free(); map?.free(); }
