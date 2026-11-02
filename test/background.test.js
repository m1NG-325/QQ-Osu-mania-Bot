import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {BeatmapBackground,backgroundFilename,extractBackground} from '../src/background.js';
import {Bot} from '../src/bot.js';

const raw=(id,name)=>`osu file format v14\n[Metadata]\nBeatmapID:${id}\n[Events]\n//Background and Video events\n0,0,"${name}",0,0\n[HitObjects]\n`;
test('background selection reads Events, quoted commas and Windows paths, rejecting unsafe or absent filenames',()=>{
  assert.equal(backgroundFilename(raw(1,'images\\a,b.jpg')),'images/a,b.jpg');
  assert.equal(backgroundFilename(raw(1,'bg.png').replace('0,0,','Background,0,')),'bg.png');
  assert.throws(()=>backgroundFilename(raw(1,'../private.png')),/路径/);
  assert.throws(()=>backgroundFilename(raw(1,'C:\\private.png')),/路径/);
  assert.throws(()=>backgroundFilename(raw(1,'//host/private.png')),/路径/);
  assert.throws(()=>backgroundFilename(raw(1,'bg.svg')),/格式/);
  assert.throws(()=>backgroundFilename(raw(1,'bg.png').replace('0,0,','Video,0,')),/没有指定/);
});
test('two difficulties in one archive return their own original image, including relative folders and cache isolation',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'mania-background-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const first=await sharp({create:{width:32,height:24,channels:3,background:'#ee3322'}}).png().toBuffer();
  const second=await sharp({create:{width:40,height:30,channels:3,background:'#2266ee'}}).jpeg().toBuffer();
  const raws={1:raw(1,'a.png'),2:raw(2,'images\\B.JPG')};
  const archive=zipSync({'one.osu':strToU8(raws[1]),'a.png':first,'folder/two.osu':strToU8(raws[2]),'folder/images/b.jpg':second,'b.jpg':first});
  let calls=0;
  const background=new BeatmapBackground({directory,fetchImpl:async()=>{calls++;return new Response(archive);}});
  const map=id=>({id,beatmapset:{id:42}});
  const [a,b]=await Promise.all([background.get(map(1),raws[1]),background.get(map(2),raws[2])]);
  assert.deepEqual(a.buffer,first);assert.equal(a.mime,'image/png');assert.deepEqual(b.buffer,second);assert.equal(b.mime,'image/jpeg');
  const cached=await background.get(map(1),raws[1]);assert.deepEqual(cached.buffer,first);assert.equal(calls,2);
  const bot=new Bot({api:{map:async id=>map(id),rawMap:async id=>raws[id]},bindings:{},demo:false,background});
  const result=await bot.run('！gb 2');assert.equal(result.kind,'image');assert.deepEqual(result.buffer,second);
  const alias=await bot.run('！bg https://osu.ppy.sh/beatmapsets/42#mania/1');assert.deepEqual(alias.buffer,first);
  await assert.rejects(extractBackground(archive,1,'b.jpg'),/不一致/);
  await assert.rejects(extractBackground(archive,3,'a.png'),/缺少/);
});
test('outdated mirrors fall through, download-disabled maps never request a mirror, invalid image bytes never succeed',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'mania-background-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const png=await sharp({create:{width:16,height:16,channels:3,background:'#112233'}}).png().toBuffer();
  const text=raw(4,'bg.png'),archive=zipSync({'map.osu':strToU8(text),'bg.png':png}),urls=[];
  const background=new BeatmapBackground({directory,fetchImpl:async url=>{urls.push(url);return new Response(urls.length===1?zipSync({'old.osu':strToU8(raw(3,'bg.png')),'bg.png':png}):archive);}});
  const map={id:4,beatmapset:{id:42}};
  assert.deepEqual((await background.get(map,text)).buffer,png);assert.equal(urls.length,2);
  await assert.rejects(background.get({...map,beatmapset:{id:42,availability:{download_disabled:true}}},text),/禁用/);assert.equal(urls.length,2);
  const bad=new BeatmapBackground({directory,fetchImpl:async()=>new Response(zipSync({'map.osu':strToU8(raw(5,'bg.png')),'bg.png':strToU8('<html>not an image</html>')}))});
  await assert.rejects(bad.get({id:5,beatmapset_id:42},raw(5,'bg.png')),/无法.*背景/);
});
test('duplicate normalized background entries and excessive declared image sizes are rejected in the worker',async()=>{
  const text=raw(6,'bg.png');
  const duplicate=zipSync({'map.osu':strToU8(text),'bg.png':strToU8('first'),'BG.PNG':strToU8('second')});
  await assert.rejects(extractBackground(duplicate,6,'bg.png'),/重复/);
  const oversized=zipSync({'map.osu':strToU8(text),'bg.png':new Uint8Array(20*1024*1024+1)});
  await assert.rejects(extractBackground(oversized,6,'bg.png'),/20 MB/);
});
