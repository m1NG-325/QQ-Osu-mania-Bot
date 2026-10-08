import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validNoteData } from '../src/beatmap-limits.js';
import { downloadDanImage } from '../src/dan-sticker.js';
import { Worker } from 'node:worker_threads';

test('malformed holds and lanes are rejected before analysis', async () => {
  const good = { columnCount: 4, noteStarts: [100], noteEnds: [300], columns: [0], noteTypes: [128] };
  assert.ok(validNoteData(good));
  for (const end of [NaN, Infinity, 99, 7200001]) assert.equal(validNoteData({ ...good, noteEnds: [end] }), false);
  for (const column of [NaN, -1, 4, 0.5]) assert.equal(validNoteData({ ...good, columns: [column] }), false);
  for (const worker of ['dan-worker.js', 'analysis-worker.js']) {
    const raw = 'osu file format v14\n[General]\nMode:3\n[Difficulty]\nCircleSize:4\nOverallDifficulty:7\n[TimingPoints]\n0,500,4,2,0,100,1,0\n[HitObjects]\n64,192,100,128,0,999999999:0:0:0:0:\n';
    const result = await new Promise((resolve, reject) => {
      const task = new Worker(new URL('../src/' + worker, import.meta.url), { workerData: { raw, rate: 1, odFlag: 7 } });
      task.once('message', resolve); task.once('error', reject);
    });
    assert.ok(result.error, worker);
  }
});

test('dan downloads block private hosts, deceptive domains and unsafe redirects', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response('x'); };
  for (const url of ['http://127.0.0.1/secret', 'http://169.254.169.254/', 'http://192.168.1.1/',
    'https://qpic.cn.attacker.test/', 'https://multimedia.nt.qq.com.cn.attacker.test/', 'https://attackerqpic.cn/', 'https://user:pass@gchat.qpic.cn/', 'https://gchat.qpic.cn:8080/']) {
    await assert.rejects(downloadDanImage({ data: { url } }, { fetcher }), /QQ 图片/);
  }
  assert.equal(calls, 0);
  await assert.rejects(downloadDanImage({ data: { url: 'https://gchat.qpic.cn/a' } }, {
    fetcher: async (_url, options) => {
      assert.equal(options.redirect, 'manual'); calls++;
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
    }
  }), /QQ 图片/);
  assert.equal(calls, 1);
  let redirects = 0;
  const image = await downloadDanImage({ data: { url: 'https://gchat.qpic.cn/a' } }, {
    fetcher: async () => ++redirects === 1
      ? new Response(null, { status: 302, headers: { location: 'https://multimedia.nt.qq.com/b' } })
      : new Response('image')
  });
  assert.equal(image.toString(), 'image');
});

test('NapCat QQ NT com.cn image URLs work directly and after a validated redirect', async () => {
  const url = 'https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=synthetic';
  for (const initial of [url, 'https://gchat.qpic.cn/image']) {
    const visited = [];
    const image = await downloadDanImage({ data: { url: initial } }, {
      fetcher: async (target, options) => {
        visited.push(target);
        assert.equal(options.redirect, 'manual');
        return target === url ? new Response('qq-image')
          : new Response(null, { status: 302, headers: { location: url } });
      }
    });
    assert.equal(image.toString(), 'qq-image');
    assert.equal(visited.at(-1), url);
  }
});
