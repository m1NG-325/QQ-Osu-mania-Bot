import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {beatmapView,beatmapViewSvg,svSegments} from '../src/beatmap-view.js';
import {Bot,parseCommand} from '../src/bot.js';
import {DemoApi} from '../src/demo.js';
import {renderCard} from '../src/cards.js';
import {helpText} from '../src/help.js';

test('preview command accepts attached IDs and fullwidth prefix, renders a single JPEG',async()=>{
  assert.deepEqual(parseCommand('！v5069028'),{action:'v',argument:'5069028'});
  const bot=new Bot({api:new DemoApi(),bindings:{get:()=>null}});
  const r=await bot.run('!v https://osu.ppy.sh/beatmapsets/2387779#mania/5166606');
  assert.equal(r.kind,'view');assert.equal(r.view.keys,4);assert.equal(r.view.notes.length,1200);
  const metadata=await sharp(await renderCard(r)).metadata();
  assert.equal(metadata.format,'jpeg');assert.equal(metadata.width,1920);assert.equal(metadata.height,r.view.height);
  assert.match(helpText(),/！v5069028/);
  await assert.rejects(()=>bot.run('!v bad'),/ID/);
});

test('BPM changes preserve beat positions and holds cross strip boundaries without dropping heads',async()=>{
  const original=await new DemoApi().rawMap();
  const header=original.split('[HitObjects]')[0].replace(/\[TimingPoints\][\s\S]*?(?=\[|$)/,'[TimingPoints]\n0,500,4,2,1,100,1,0\n8000,250,3,2,1,100,1,0\n\n');
  const raw=header+'[HitObjects]\n64,192,7500,128,0,9000:0:0:0:0:\n192,192,8250,1,0,0:0:0:0:\n';
  const v=beatmapView(raw);assert.equal(v.notes[0].beat,15);assert.equal(v.notes[0].endBeat,20);assert.equal(v.notes[1].beat,17);
  assert.equal(v.strips,2);assert.equal(v.timing[1].meter,3);
  const svg=beatmapViewSvg({view:v,map:{beatmapset:{}},queriedAt:'2026-10-03T00:00:00Z'});
  assert.equal((svg.match(/fill="#78bddb"/g)||[]).length,2);
  assert.equal((svg.match(/rx="\.6"/g)||[]).length,2);
  const markers=[...svg.matchAll(/data-measure="(\d+)" data-beat="([\d.]+)"/g)].map(match=>[Number(match[1]),Number(match[2])]);
  assert.deepEqual(markers,[[1,0],[2,4],[3,8],[4,12],[5,16],[6,19],[7,22],[8,25],[9,28],[10,31]]);
  assert.equal(new Set(markers.map(([,beat])=>beat)).size,markers.length);
  assert.ok(!svg.includes('>b17</text>'));
  assert.ok(!svg.includes('NaN'));
  assert.throws(()=>beatmapView(raw.replace('Mode:3','Mode:0')),/mania/);
  assert.throws(()=>beatmapView('bad'),/文件/);
});

test('dense SV uses separate rails, keeps crop state and timing resets without obscuring notes',async()=>{
  const original=await new DemoApi().rawMap();
  const points=['0,500,4,2,1,100,1,0','500,-200,4,2,1,100,0,0','600,-200,4,2,1,80,0,0','1200,-50,4,2,1,100,0,0','1500,500,4,2,1,100,1,0','2000,-10000,4,2,1,100,0,0'];
  const raw=original.replace(/\[TimingPoints\][\s\S]*?(?=\[HitObjects\])/,'[TimingPoints]\n'+points.join('\n')+'\n');
  const v=beatmapView(raw,{sv:true,from:1000,to:5000});
  assert.equal(v.sv[0].value,1);assert.ok(!v.sv.some(p=>p.time===600));
  assert.equal(v.sv.find(p=>p.time===2000).value,.01);
  const cropped=beatmapView(raw,{sv:true,from:8500,to:10000});assert.equal(cropped.sv[0].value,.01);
  const segments=svSegments([{beat:0,value:.5},{beat:2,value:2},{beat:4,value:1}],1,4);
  assert.deepEqual(segments,[{start:1,end:2,value:.5},{start:2,end:4,value:2}]);
  const svg=beatmapViewSvg({view:v,map:{id:1},queriedAt:'2026-10-03T00:00:00Z'});
  assert.equal((svg.match(/data-sv-rail=/g)||[]).length,v.strips);assert.ok(!svg.includes('stroke-dasharray="3 3"'));assert.ok(!svg.includes('>SV '));assert.ok(!svg.includes('NaN'));
  assert.equal(v.notes.length,beatmapView(raw,{from:1000,to:5000}).notes.length);
});
