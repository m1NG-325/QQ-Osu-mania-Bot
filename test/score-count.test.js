import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Bot,parseCommand} from '../src/bot.js';
import {DemoApi,demoScores} from '../src/demo.js';
import {renderCard,cardSvg} from '../src/cards.js';
import sharp from 'sharp';

test('list counts preserve single-index commands and numeric player IDs',()=>{
  assert.deepEqual(parseCommand('！ps 20条 Mugen Neko'),{action:'ps',argument:'Mugen Neko',count:20});
  assert.deepEqual(parseCommand('!bp 30条'),{action:'bp',argument:'',count:30});
  assert.deepEqual(parseCommand('!bp#2'),{action:'bp',argument:'',index:2});
  assert.deepEqual(parseCommand('!ps 27672571'),{action:'ps',argument:'27672571'});
});
test('counted lists page at 100, use bindings, keep a one-item list and reject bounds before API calls',async()=>{
  const calls=[],api=new DemoApi();
  api.scores=async(id,type,limit,offset)=>{calls.push([type,limit,offset]);return Array.from({length:limit},(_,i)=>({...demoScores[i%20],id:offset+i+1}));};
  const bot=new Bot({api,bindings:{get:()=> 'Demo Player'}});
  const result=await bot.run('!bp 200条');assert.equal(result.scores.length,200);assert.equal(result.kind,'scores');
  assert.deepEqual(calls,[['best',100,0],['best',100,100]]);
  await bot.run('！ps 100条');assert.deepEqual(calls.at(-1),['recent',100,0]);
  const one=await bot.run('!ps 1条');assert.equal(one.kind,'scores');assert.equal(one.scores.length,1);
  const total=calls.length;
  for(const cmd of ['!ps 101条','!bp 201条','!ps 0条','!bp -1条','!ps 2.5条'])await assert.rejects(bot.run(cmd),/条数范围/);
  assert.equal(calls.length,total);
});
test('short results show actual count and large lists render as a single JPEG',async()=>{
  const bot=new Bot({api:new DemoApi(),bindings:{get:()=> 'Demo Player'}});
  const result=await bot.run('!bp 30条');assert.equal(result.scores.length,20);assert.equal(result.requestedCount,30);
  assert.match(cardSvg(result),/显示 20 \/ 请求 30 条/);
  const metadata=await sharp(await renderCard(result)).metadata();assert.equal(metadata.format,'jpeg');assert.equal(metadata.height,1750);
});
test('inclusive ranges use correct offsets across pages and keep original positions',async()=>{
  assert.deepEqual(parseCommand('！bp 10-30 Mugen Neko'),{action:'bp',argument:'Mugen Neko',range:{start:10,end:30}});
  const calls=[],api=new DemoApi();
  api.scores=async(id,type,limit,offset)=>{calls.push([type,limit,offset]);return Array.from({length:limit},(_,i)=>({...demoScores[i%20],id:offset+i+1}));};
  const bot=new Bot({api,bindings:{get:()=> 'Demo Player'}});
  const result=await bot.run('!bp 10-30');assert.equal(result.kind,'scores');assert.equal(result.scores.length,21);
  assert.deepEqual(calls.at(-1),['best',21,9]);assert.match(cardSvg(result),/#10 ·/);assert.match(cardSvg(result),/#30 ·/);
  await bot.run('！ps 20-20');assert.deepEqual(calls.at(-1),['recent',1,19]);
  calls.length=0;await bot.run('!bp 10-130');assert.deepEqual(calls,[['best',100,9],['best',21,109]]);
  const length=calls.length;for(const cmd of ['!bp 30-10','!ps 0-20','!bp 1-201','!ps 10-101','!bp 1.5-20'])await assert.rejects(bot.run(cmd),/范围需满足/);
  assert.equal(calls.length,length);
});
