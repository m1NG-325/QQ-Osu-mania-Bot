import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import sharp from 'sharp';

test('HTTP preview and isolated mock OneBot dispatch', { timeout: 120000 }, async t => {
  const sent = [];
  async function waitSent(count) {
    const expires=Date.now()+15000;
    while(sent.length<count&&Date.now()<expires)await delay(50);
    assert.ok(sent.length>=count, `Expected ${count} command replies within 15 seconds`);
  }
  const stickerBase = await sharp({create:{width:96,height:96,channels:4,background:'#314159'}}).png().toBuffer();
  const imageDir = await mkdtemp(join(tmpdir(), 'onebot-test-'));
  const imageFile = join(imageDir, 'image.png');
  await writeFile(imageFile, stickerBase);
  t.after(() => rm(imageDir, { recursive: true, force: true }));
  const fakeOnebot = http.createServer(async (req, res) => {
    if (req.url === '/get_image') {
      for await (const _chunk of req) {}
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({retcode:0,data:{file:imageFile}})); return;
    }
    if(req.url==='/sticker-base') { res.writeHead(200,{'Content-Type':'image/png'});res.end(stickerBase);return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    if(req.url==='/get_group_msg_history') {
      const args=JSON.parse(raw);assert.equal(args.count,50);
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({retcode:0,data:{messages:[{group_id:args.group_id,user_id:456,time:100,message:[{type:'image',data:{file:'trusted-image-id'}}]}]}}));return;
    }
    if(req.url==='/get_msg') {
      assert.equal(JSON.parse(raw).message_id, 777);
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({retcode:0,data:{group_id:123456789,message:[{type:'image',data:{file:'trusted-image-id'}}]}}));return;
    }
    const responseBody=JSON.parse(raw);
    const notice=(responseBody.message||[]).some(segment=>segment.type==='text'&&segment.data?.text==='正在查询或等待分析；耗时任务与普通查询分开处理，请勿重复发送。');
    if(req.url==='/send_group_msg'&&!notice)sent.push({ path: req.url, authorization: req.headers.authorization, body: responseBody });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', retcode: 0 }));
  });
  fakeOnebot.listen(0, '127.0.0.1'); await once(fakeOnebot, 'listening');
  t.after(() => new Promise(resolve => fakeOnebot.close(resolve)));
  const reserve = http.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/server.js', import.meta.url))], {
    env: { ...process.env, RELEASE_APPROVED:'true', BOT_MODE: 'demo', HOST: '127.0.0.1', PORT: String(port), QQ_ENABLED: 'true',
      ONEBOT_HTTP_URL: `http://127.0.0.1:${fakeOnebot.address().port}`, ONEBOT_ACCESS_TOKEN: 'mock-outbound',
      ONEBOT_EVENT_TOKEN: 'mock-inbound', QQ_ALLOWED_GROUPS: '42,123456789',QQ_GROUP_PREFIXES:'{"123456789":"#"}' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/status`)).ok) { ready = true; break; } } catch {}
    await delay(100);
  }
  assert.ok(ready, 'server starts');
  assert.equal((await fetch(base)).status, 200);
  const command = await fetch(`${base}/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: '!p Demo Player' }) });
  const result = await command.json();
  assert.equal(result.kind, 'image'); assert.equal(result.demo, true);
  const image = await fetch(base + result.image);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual([...new Uint8Array(await image.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const help = await fetch(`${base}/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command: '!help' }) });
  const helpResult = await help.json();
  assert.equal(helpResult.kind, 'image', 'help renders through the image reply route');
  assert.equal((await fetch(base + helpResult.image)).headers.get('content-type'), 'image/png');
  assert.equal((await fetch(`${base}/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: '{}' })).status, 403);
  const event = { post_type: 'message', message_type: 'group', self_id: 999, user_id: 123, group_id: 42, message_id: 1,
    message: [{ type: 'at', data: { qq: '999' } }, { type: 'text', data: { text: ' !help' } }] };
  const post = (data, token = 'mock-inbound') => fetch(`${base}/onebot/events`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(data) });
  assert.equal((await post(event, 'wrong')).status, 401);
  const signedPost = (raw, signedRaw = raw, token = 'mock-inbound') => fetch(`${base}/onebot/events`, {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      'X-Signature': `sha1=${createHmac('sha1', token).update(signedRaw).digest('hex')}` }, body: raw
  });
  const rawEvent = JSON.stringify(event);
  assert.equal((await signedPost(rawEvent, rawEvent, 'wrong')).status, 401);
  assert.equal((await signedPost(rawEvent + ' ', rawEvent)).status, 401, 'signature covers exact request bytes');
  const heartbeat = JSON.stringify({ post_type: 'meta_event', note: '中文' });
  assert.equal((await signedPost(heartbeat)).status, 200, 'UTF-8 signed events accepted');
  await post({ ...event, group_id: 43 });
  assert.equal((await signedPost(rawEvent)).status, 200); await post(event);
  await waitSent(1);
  await delay(150);
  assert.equal(sent.length, 1, 'only allowed, authenticated, non-duplicate events dispatch');
  assert.equal(sent[0].path, '/send_group_msg');
  assert.equal(sent[0].authorization, 'Bearer mock-outbound');
  assert.equal(sent[0].body.group_id, 42);
  assert.deepEqual(sent[0].body.message[0], { type: 'at', data: { qq: '123' } });
  assert.match(sent[0].body.message.find(segment => segment.type === 'image').data.file, /^base64:\/\/iVBOR/);
  const custom={...event,group_id:123456789,user_id:456,message_id:2,message:[{type:'text',data:{text:'!bind'}}]};
  await post(custom);await delay(100);assert.equal(sent.length,1,'old prefix ignored in overridden group');
  await post({...custom,message_id:3,message:[{type:'text',data:{text:'#bind'}}]});
  await waitSent(2);
  assert.equal(sent.length,2);assert.equal(sent[1].body.group_id,123456789);
  const text=sent[1].body.message.filter(s=>s.type==='text').map(s=>s.data.text).join('');
  assert.match(text,/#bind/);assert.ok(!text.includes('!bind'));
  const dan = {...event,group_id:123456789,user_id:789,message_id:4,message:[{type:'reply',data:{id:'777'}},{type:'at',data:{qq:'456'}},{type:'text',data:{text:'#dan alpha 75 0 0 0'}}]};
  assert.equal((await post(dan)).status,200);
  await waitSent(3);
  assert.equal(sent.length,3,'dan reply with another-user auto-at dispatches');
  const danFile=sent[2].body.message.find(segment=>segment.type==='image').data.file;
  const danBuffer=Buffer.from(danFile.replace(/^base64:\/\//,''),'base64');
  assert.equal((await sharp(danBuffer).metadata()).width,96);
  assert.ok(!danBuffer.equals(stickerBase),'generated sticker is returned through OneBot');
  await post({...dan,user_id:790,message_id:5,message:[{type:'text',data:{text:'#dan kappa'}}]});
  await waitSent(4);
  assert.match(sent[3].body.message.filter(s=>s.type==='text').map(s=>s.data.text).join(''),/#dan.*附带|附带.*图片/);
  await post({...dan,group_id:42,user_id:791,message_id:6,message:`[CQ:image,url=http://127.0.0.1:${fakeOnebot.address().port}/sticker-base]!dan beta 50`});
  await waitSent(5);
  assert.match(sent[4].body.message.filter(s=>s.type==='text').map(s=>s.data.text).join(''), /QQ 图片/, 'untrusted CQ URLs are rejected');
  await post({...dan,group_id:42,user_id:792,message_id:7,message:[{type:'at',data:{qq:'456'}},{type:'text',data:{text:'！dn epsilon'}}]});
  await waitSent(6);
  assert.ok(sent[5].body.message.some(s=>s.type==='image'),'@image sender with fullwidth dan triggers without a reply');
});
