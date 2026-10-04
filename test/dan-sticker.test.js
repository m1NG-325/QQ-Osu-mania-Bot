import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDanCommand, messageSegments, pickDanImage, downloadDanImage, handleDanMessage, DanService } from '../src/dan-sticker.js';
import { groupCommand } from '../src/group-command.js';

test('dan triggering, CQ decoding and reply image priority', async () => {
  for (const text of ['!dan kappa', '！ dan7kstellium', '!dankappa75']) assert.ok(isDanCommand(text));
  for (const text of ['dan kappa', '今天 dan 了吗', '!p 123']) assert.ok(!isDanCommand(text));
  assert.equal(messageSegments('[CQ:image,file=x,url=https://example.test/a?a=1&amp;b=&#91;x&#93;&#44;c]')[0].data.url, 'https://example.test/a?a=1&b=[x],c');
  const image = { type: 'image', data: { url: 'https://example.test/attached.gif' } };
  const original = { type: 'image', data: { url: 'https://example.test/reply.gif' } };
  const event = { group_id: 42, self_id: 999, message: [{ type: 'reply', data: { id: '-123' } }, image, { type: 'text', data: { text: '#dan kappa' } }] };
  assert.equal(groupCommand(event, { 42: '#' }), '!dan kappa');
  const call = async (action, body) => { assert.equal(action, 'get_msg'); assert.equal(body.message_id, -123); return { group_id: 42, message: [original] }; };
  assert.equal(await pickDanImage(event, call), original);
  assert.equal(await pickDanImage(event, async () => { throw new Error(); }), image);
  assert.equal(await pickDanImage(event, async () => ({ group_id: 99, message: [original] })), image);
  assert.equal((await pickDanImage({ raw_message: '[CQ:reply,id=123][CQ:image,file=own]' }, async () => ({ message: '[CQ:image,file=reply]' }))).data.file, 'reply');
});

test('dan missing input, image resolution and download bounds', async () => {
  assert.match((await handleDanMessage({}, '!dan')).text, /用法/);
  await assert.rejects(handleDanMessage({}, '!dan kappa'), /附带图片/);
  let requested;
  const bytes = await downloadDanImage({ data: { file: 'qq-image-id' } }, {
    call: async (action, args) => { assert.equal(action, 'get_image'); assert.equal(args.file, 'qq-image-id'); return { url: 'https://example.test/image' }; },
    fetcher: async url => { requested = url; return new Response('image'); }
  });
  assert.equal(requested, 'https://example.test/image'); assert.equal(bytes.toString(), 'image');
  await assert.rejects(downloadDanImage({ data: { url: 'file:///arbitrary' } }), /无法获取/);
  await assert.rejects(downloadDanImage({ data: { url: 'https://example.test/image' } }, { fetcher: async () => new Response('x', { headers: { 'content-length': String(21 * 1024 * 1024) } }) }), /太大/);
  await assert.rejects(downloadDanImage({ data: { url: 'https://example.test/image' } }, { fetcher: async () => new Response('expired', { status: 404 }) }), /下载失败/);
});

test('dan @sender picks their newest group image and keeps explicit image priority', async () => {
  const image = url => ({type:'image',data:{url}});
  const event = {group_id:42,self_id:999,time:200,message:[{type:'at',data:{qq:'456'}},{type:'text',data:{text:'！dan epsilon'}}]};
  assert.equal(groupCommand(event), '');
  assert.equal(groupCommand(event,{}, {allowOtherAt:true}), '！dan epsilon');
  const newest = image('https://example.test/new.gif');
  const call = async (action,body) => {
    assert.equal(action,'get_group_msg_history');assert.deepEqual(body,{group_id:42,count:50});
    return {messages:[
      {group_id:42,user_id:456,time:100,message:[image('https://example.test/old.gif')]},
      {group_id:42,user_id:456,time:180,message:[newest]},
      {group_id:43,user_id:456,time:190,message:[image('https://example.test/other-group.gif')]},
      {group_id:42,user_id:457,time:195,message:[image('https://example.test/other-user.gif')]},
      {group_id:42,user_id:456,time:210,message:[image('https://example.test/future.gif')]}
    ]};
  };
  assert.equal(await pickDanImage(event,call),newest);
  const attached=image('https://example.test/attached.gif');
  assert.equal(await pickDanImage({...event,message:[...event.message,attached]},async()=>{throw new Error('should not fetch history');}),attached);
  await assert.rejects(pickDanImage(event,async()=>({messages:[]})),/最近 50 条/);
  await assert.rejects(pickDanImage({...event,message:[...event.message,{type:'at',data:{qq:'457'}}]},call),/只 @一位/);
  await assert.rejects(pickDanImage(event,async()=>{throw new Error();}),/直接回复/);
});

test('actual Python service renders PNG, WebP and animated GIF with cache and errors', { timeout: 120000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dan-sticker-test-'));
  const service = new DanService({ cacheDir: directory });
  t.after(async () => { service.close(); await rm(directory, { recursive: true, force: true }); });
  const base = await sharp({ create: { width: 160, height: 100, channels: 4, background: '#1a2438' } }).png().toBuffer();
  const png = await service.render('!dn alpha 75 0 0 0', base);
  assert.equal(png.mime, 'image/png');
  assert.equal((await sharp(png.buffer).metadata()).width, 160);
  assert.ok(!png.buffer.equals(base), 'sticker changes the supplied image');
  assert.deepEqual((await service.render('!dan alpha 75 0 0 0', base)).buffer, png.buffer, 'cache returns the same image');
  const webp = await service.render('！dan 7kstellium 60 0 0 0', await sharp(base).webp().toBuffer());
  assert.equal(webp.mime, 'image/webp');
  const gif = await sharp({ create: { width: 96, height: 192, channels: 4, background: '#123456', pageHeight: 96 } })
    .composite([{ input: await sharp({ create: { width: 96, height: 96, channels: 4, background: '#654321' } }).png().toBuffer(), top: 96, left: 0 }])
    .gif({ delay: [70, 130], loop: 2 }).toBuffer();
  const animated = await service.render('!dan 4kln3 50', gif);
  assert.equal(animated.mime, 'image/gif');
  const metadata = await sharp(animated.buffer, { animated: true }).metadata();
  assert.equal(metadata.pages, 2); assert.deepEqual(metadata.delay, [70, 130]); assert.equal(metadata.loop, 2);
  const animatedWebp = await sharp(gif, { animated: true }).webp().toBuffer();
  const webpResult = await service.render('!dan beta', animatedWebp);
  assert.equal(webpResult.mime, 'image/gif');
  assert.equal((await sharp(webpResult.buffer, { animated: true }).metadata()).pages, 2);
  await assert.rejects(service.render('!dan not-a-rank 75', base), /不认识/);
  await assert.rejects(service.render('!dan alpha 10', base), /50/);
  await assert.rejects(service.render('!dan alpha 75 0 0 0 extra', base), /参数太多/);
  await assert.rejects(service.render('!dan alpha', Buffer.from('not an image')), /图片/);
});
