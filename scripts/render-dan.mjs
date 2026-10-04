import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { DanService } from '../src/dan-sticker.js';

const [command, input, output] = process.argv.slice(2);
if (!command || !input || !output) {
  console.error('用法：npm run dan -- "!dan kappa 75" "底图.gif" "成品.gif"');
  process.exitCode = 1;
} else {
  const service = new DanService();
  try {
    const result = await service.render(command, await readFile(resolve(input)));
    const suffix = { 'image/gif': '.gif', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/bmp': '.bmp' }[result.mime];
    const path = resolve(output.replace(/\.(gif|png|jpe?g|webp|bmp)$/i, '') + suffix);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, result.buffer);
    console.log(`已生成：${path} (${result.buffer.length} bytes)`);
  } catch (error) {
    console.error(error.message); process.exitCode = 1;
  } finally { service.close(); }
}
