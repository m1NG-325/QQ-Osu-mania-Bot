import {test} from 'node:test';
import assert from 'node:assert/strict';
import {singleMapCard,renderCard} from '../src/cards.js';
import {DemoApi} from '../src/demo.js';
import {Bot} from '../src/bot.js';
import sharp from 'sharp';

test('single-map cards use map art and all lists, reports and set cards use help art',()=>{
  for(const kind of ['score','map','analysis','view','compare'])assert.equal(singleMapCard({kind}),true);
  for(const kind of ['scores','profile','help','timebest','recommend','mapper','avatar','report'])assert.equal(singleMapCard({kind}),false);
  for(const variant of ['map-scores','group-board','random-map','practice-map'])assert.equal(singleMapCard({kind:'feature',variant}),true);
  for(const variant of ['mapset','profile-compare'])assert.equal(singleMapCard({kind:'feature',variant}),false);
});
test('recent and best lists share the help background without downloading a map canvas',async()=>{
  const bot=new Bot({api:new DemoApi(),bindings:{get:()=> 'ExamplePlayer'}});
  const recent=await bot.run('!ps'),best=await bot.run('!bp');
  const a=await sharp(await renderCard(recent)).extract({left:1700,top:50,width:100,height:50}).raw().toBuffer();
  const b=await sharp(await renderCard(best)).extract({left:1700,top:50,width:100,height:50}).raw().toBuffer();
  assert.deepEqual(a,b);
});
