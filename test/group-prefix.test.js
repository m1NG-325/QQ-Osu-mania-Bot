import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupCommand,groupPrefixes,prefixReply} from '../src/group-command.js';
import {parseCommand} from '../src/bot.js';
import {helpContent} from '../src/help.js';
import {cardSvg} from '../src/cards.js';
const prefixes=groupPrefixes('{"123456789":"#"}');
const event=(text,group='123456789')=>({group_id:group,self_id:999,message:[{type:'text',data:{text}}]});

test('only configured group requires # and commands retain ranges, names and fullwidth syntax',()=>{
  for(const input of ['#help','#ps 10-30 ExamplePlayer','#v5069028','#对比 （Player A） ExamplePlayer'])assert.deepEqual(parseCommand(groupCommand(event(input),prefixes)),parseCommand('!'+input.slice(1)));
  assert.equal(groupCommand(event('!help'),prefixes),'');assert.equal(groupCommand(event('！help'),prefixes),'');
  assert.equal(groupCommand(event('聊天 #help'),prefixes),'');
  assert.equal(groupCommand(event(' !help ','42'),prefixes),'!help');
  assert.equal(groupCommand(event('！ps 1-20','42'),prefixes),'！ps 1-20');
  assert.equal(parseCommand(groupCommand(event('#help','42'),prefixes)),null);
  const mentioned=event(' #help');mentioned.message.unshift({type:'at',data:{qq:'999'}});
  assert.equal(groupCommand(mentioned,prefixes),'!help');
  mentioned.message[0].data.qq='other';assert.equal(groupCommand(mentioned,prefixes),'');
  assert.equal(groupCommand({group_id:'123456789',raw_message:'#help'},prefixes),'!help');
});
test('help is common to all groups while error examples keep the active prefix',()=>{
  const original={kind:'help',...helpContent(false)};
  const help=prefixReply(original,'#');
  assert.deepEqual(help,original);
  assert.deepEqual(help,prefixReply(original,'！'));
  assert.deepEqual(help,prefixReply(original));
  const svg=cardSvg(help);
  assert.ok(svg.includes('！bind'));assert.ok(svg.includes('！对比 playerA （Player B）'));
  assert.ok(svg.includes('命令头为 # 的群'));assert.ok(!svg.includes('本群命令头'));
  assert.ok(svg.includes('dan 使用说明与可调参数'));
  assert.equal(help.notes.filter(note=>note.startsWith('dan')).length,0);
  for(const parameter of ['大小：50–125','色散：0–1','切片：0–1','块状：0–1'])assert.ok(help.dan.some(note=>note.includes(parameter)));
  assert.equal(prefixReply({kind:'text',text:'先 !bind 玩家名，或 !我的成绩 谱面ID；osu!mania'},'#').text,'先 #bind 玩家名，或 #我的成绩 谱面ID；osu!mania');
  assert.equal(prefixReply({kind:'map',map:{title:'!Title'}},'#').map.title,'!Title');
  for(const raw of ['[]','null','{"bad":"#"}','{"42":" "}'])assert.throws(()=>groupPrefixes(raw));
});
