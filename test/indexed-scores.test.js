import test from 'node:test';
import assert from 'node:assert/strict';
import {Bot,parseCommand} from '../src/bot.js';
import {OsuApi} from '../src/osu.js';
import {helpContent} from '../src/help.js';
import {cardSvg} from '../src/cards.js';

test('indexed score syntax retains spaced names, fullwidth prefix and ordinary command meanings',()=>{
  assert.deepEqual(parseCommand('！P#20 Mugen Neko'),{action:'p',argument:'Mugen Neko',index:20});
  assert.deepEqual(parseCommand('!bp#2'),{action:'bp',argument:'',index:2});
  assert.deepEqual(parseCommand('!p 20'),{action:'p',argument:'20'});
  assert.equal(parseCommand('!ps#2'),null);
});

test('indexed queries use one score at the correct offset, enrich the selected map and validate limits before lookup',async()=>{
  const calls=[];
  const api={user:async name=>({id:7,username:name}),
    scores:async(id,type,limit,offset)=>{
      calls.push([id,type,limit,offset]);
      if(offset===19)return [];
      return [{id:100+offset,passed:true,mods:[],beatmap:{id:1000+offset},statistics:{}}];
    },map:async id=>({id,cs:7,version:`Selected ${id}`})};
  const bot=new Bot({api,bindings:{get:sender=>sender==='bound'?'Bound Player':null},demo:false});
  const second=await bot.run('!bp#2','bound');
  assert.equal(second.kind,'score');assert.equal(second.scores[0].id,101);
  assert.equal(second.scores[0].beatmap.version,'Selected 1001');
  assert.equal(second.scoreIndex,2);assert.equal(second.scoreType,'best');
  assert.match(cardSvg(second),/BEST #2/);
  assert.deepEqual(calls.at(-1),[7,'best',1,1]);
  const empty=await bot.run('!p#20 Mugen Neko');
  assert.match(empty.text,/Mugen Neko.*最近第 20 条/);
  assert.deepEqual(calls.at(-1),[7,'recent',1,19]);
  await bot.run('!bp#200 Bound Player');assert.deepEqual(calls.at(-1),[7,'best',1,199]);
  await bot.run('!p#100 Bound Player');assert.deepEqual(calls.at(-1),[7,'recent',1,99]);
  const count=calls.length;
  for(const cmd of ['!p#0 x','!p#-2 x','!p#2.5 x','!p#101 x','!bp#201 x','!p#wat x','!p# x'])await assert.rejects(bot.run(cmd),/序号范围/);
  assert.equal(calls.length,count);
  await assert.rejects(bot.run('!p#2','unbound'),/绑定/);
  await bot.run('!bp Bound Player');assert.deepEqual(calls.at(-1),[7,'best',16,0]);
});

test('API offset and expanded help guide expose numbered score queries',async()=>{
  const api=new OsuApi({});api.get=async path=>path;
  assert.equal(await api.scores(7,'recent',1,19),'users/7/scores/recent?mode=mania&limit=1&include_fails=1&offset=19');
  const svg=cardSvg({kind:'help',...helpContent(false),demo:false});
  assert.match(svg,/！p#20 playerA/);assert.match(svg,/！bp#2 playerA/);
  const height=Number(svg.match(/height="(\d+)"/)[1]);
  assert.ok(height>1700);assert.match(svg,/序号从 1 开始/);
});
