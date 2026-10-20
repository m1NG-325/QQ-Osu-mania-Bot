import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {cardForQQ} from '../src/qq-image.js';

test('QQ card encoding reduces large PNGs without resizing, leaves small images and JPEG alone',async()=>{
  const width=960,height=540,data=Buffer.alloc(width*height*3);let seed=12345;
  for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=seed>>>24;}
  const png=await sharp(data,{raw:{width,height,channels:3}}).png().toBuffer();
  assert.ok(png.length>512*1024);
  const output=await cardForQQ(png),meta=await sharp(output).metadata();
  assert.equal(meta.format,'jpeg');assert.equal(meta.width,width);assert.equal(meta.height,height);assert.ok(output.length<png.length);
  assert.strictEqual(await cardForQQ(output),output);
  const small=await sharp({create:{width:32,height:32,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
  assert.strictEqual(await cardForQQ(small),small);
});
