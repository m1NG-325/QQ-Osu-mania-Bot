import {test} from 'node:test';
import assert from 'node:assert/strict';
import {COMMAND_SHORTCUTS,normalizeCommand} from '../src/command-aliases.js';
import {parseCommand,Bot} from '../src/bot.js';
import {DemoApi} from '../src/demo.js';
import {groupCommand} from '../src/group-command.js';
import {isDanCommand,handleDanMessage} from '../src/dan-sticker.js';

test('all shortcut actions preserve original arguments and group prefixes',()=>{
  for(const [command,alias] of COMMAND_SHORTCUTS){
    const argument=command==='记录'?'开启':'123 （Player B）';
    assert.deepEqual(parseCommand(`！${alias.toUpperCase()} ${argument}`),parseCommand(`!${command} ${argument}`),alias);
    const normalized=groupCommand({group_id:42,message:[{type:'text',data:{text:`#${alias} ${argument}`}}]}, {42:'#'});
    assert.deepEqual(parseCommand(normalized),parseCommand(`!${command} ${argument}`),`#${alias}`);
  }
  for(const [alias,canonical] of [['rs#20 playerA','p#20 playerA'],['bs#2 playerA','bp#2 playerA'],['rsl 10-30 playerA','ps 10-30 playerA'],['bs 20条 playerA','bp 20条 playerA'],['rb#7 playerA','tbp#7 playerA'],['pv123 0:30-1:00 x1.5','v123 0:30-1:00 x1.5']])
    assert.deepEqual(parseCommand('!'+alias),parseCommand('!'+canonical));
  assert.deepEqual(parseCommand('!rec ON'),parseCommand('!记录 开启'));
  assert.deepEqual(parseCommand('!rec off'),parseCommand('!记录 关闭'));
  assert.equal(parseCommand('!hannah'),null);assert.equal(parseCommand('普通聊天 cmp playerA'),null);
  assert.equal(normalizeCommand('!dnkappa75'),'!dankappa75');
  assert.ok(isDanCommand('！DN epsilon'));
});

test('shortcuts bind, query help and unbind through the actual bot',async()=>{
  const values=new Map();
  const bindings={get:sender=>values.get(sender),set:async(sender,value)=>values.set(sender,value),remove:async sender=>values.delete(sender)};
  const bot=new Bot({api:new DemoApi(),bindings});
  await bot.run('！b Demo Player','alias-test');assert.ok(values.get('alias-test'));
  assert.equal((await bot.run('！h','alias-test')).kind,'help');
  await bot.run('！ub','alias-test');assert.equal(values.has('alias-test'),false);
  assert.match((await handleDanMessage({},'！dn')).text,/用法/);
});
