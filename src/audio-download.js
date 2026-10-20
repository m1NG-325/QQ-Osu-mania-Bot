import { UserError } from './osu.js';

const MAX_ARCHIVE = 100 * 1024 * 1024;
const failure = (code) => Object.assign(new Error(code), { code });

// Fixed public mirrors receive only the beatmapset ID, never osu! or QQ credentials.
export async function downloadAudio(setId, sourceName, extract, fetcher) {
  const sources = [
    `https://dl.sayobot.cn/beatmaps/download/novideo/${setId}`,
    `https://osu.direct/api/d/${setId}`,
    `https://api.nerinyan.moe/d/${setId}?nv=1`,
    `https://catboy.best/d/${setId}`
  ];
  const failures = [];
  for (const url of sources) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        await response.body?.cancel();
        throw failure(response.status === 404 ? 'NOT_FOUND'
          : [403, 429].includes(response.status) ? 'RATE_LIMITED' : 'UNAVAILABLE');
      }
      if (Number(response.headers.get('content-length')) > MAX_ARCHIVE) {
        await response.body?.cancel(); throw failure('ARCHIVE_TOO_LARGE');
      }
      if (/text\/html|application\/(?:[\w.+-]*\+)?json/i.test(response.headers.get('content-type') || '')) {
        await response.body?.cancel(); throw failure('ARCHIVE_INVALID');
      }
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_ARCHIVE) throw failure('ARCHIVE_TOO_LARGE');
        chunks.push(chunk);
      }
      const archive = Buffer.concat(chunks);
      if (archive.length < 4 || archive.readUInt32LE(0) !== 0x04034b50) throw failure('ARCHIVE_INVALID');
      return await extract(archive, sourceName);
    } catch (error) {
      failures.push(error.code || 'UNAVAILABLE');
    }
  }
  if (failures.includes('AUDIO_TOO_LARGE')) throw new UserError('该谱面的完整音频超过 30 MB 限制，无法发送。');
  if (failures.includes('ARCHIVE_TOO_LARGE')) throw new UserError('下载源提供的谱包超过 100 MB 限制，无法提取音频。');
  if (failures.includes('AUDIO_MISSING')) throw new UserError('下载到的谱包缺少该难度指定的音频，镜像版本可能尚未同步，请稍后重试。');
  if (failures.every(code => code === 'NOT_FOUND')) throw new UserError('各下载源暂未收录此谱包，请稍后重试。');
  if (failures.every(code => ['RATE_LIMITED', 'NOT_FOUND'].includes(code))) throw new UserError('音频下载源暂时限流或拒绝访问，请稍后重试。');
  throw new UserError('完整音频下载失败，已尝试多个下载源；当前网络或镜像服务异常，请稍后重试。');
}
