import { mkdir, writeFile } from 'node:fs/promises';
import { Bot } from '../src/bot.js';
import { DemoApi } from '../src/demo.js';
import { renderCard } from '../src/cards.js';

const bot = new Bot({ api: new DemoApi(), bindings: { get: () => null } });
await mkdir(new URL('../output/', import.meta.url), { recursive: true });
for (const [name, command] of [['score', '!p Demo Player'], ['profile', '!i Demo Player'], ['bests', '!bp Demo Player'], ['mapper', '!im Demo Player']]) {
  await writeFile(new URL(`../output/${name}-panel.png`, import.meta.url), await renderCard(await bot.run(command)));
  console.log(`${name}-panel.png`);
}
