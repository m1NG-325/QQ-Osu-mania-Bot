import {OsuFileParser} from '../vendor/mania-analyser/js/parser/osuFileParser.js';
import {UserError} from './osu.js';

export function viewArguments(argument) {
  const [id, ...parts] = argument.split(/\s+/);
  const options = { id, rate: 1, zoom: 1, sv: false };
  for (const part of parts) {
    if (/^\d+:\d{2}-\d+:\d{2}$/.test(part)) {
      const times=part.split('-').map(v=>{const [m,s]=v.split(':').map(Number);if(s>59)throw new UserError('时间秒数应为 00–59。');return (m*60+s)*1000;});
      if(times[1]<=times[0])throw new UserError('结束时间必须晚于开始时间。');
      [options.from,options.to]=times;
    } else if (/^x[\d.]+$/i.test(part)) options.rate=Number(part.slice(1));
    else if (/^z[\d.]+$/i.test(part)) options.zoom=Number(part.slice(1));
    else if (part.toLowerCase()==='sv') options.sv=true;
    else throw new UserError('用法：!v谱面ID [0:30-1:00] [x1.5] [z2] [sv]。时间范围使用原谱时间。');
  }
  if(!Number.isFinite(options.rate)||options.rate<.5||options.rate>2)throw new UserError('倍率 x 为 0.5–2.0。');
  if(![1,2,3].includes(options.zoom))throw new UserError('放大 z 支持 1、2、3。');
  return options;
}
export function beatmapView(raw,options={}){
  if(!raw.startsWith('osu file format')||Buffer.byteLength(raw)>4*1024*1024)throw new UserError('谱面文件无效或超过 4 MB。');
  const parser=new OsuFileParser(raw);parser.process();const p=parser.getParsedData();
  if(parser.status!=='OK'||parser.gameMode!=='3'||!Number.isInteger(p.columnCount)||p.columnCount<1||p.columnCount>10)throw new UserError('谱面预览仅支持原生 osu!mania 谱面。');
  if(!p.noteStarts.length||p.noteStarts.length>50000)throw new UserError('谱面预览最多支持 50000 个音符。');
  let notes=p.noteStarts.map((time,i)=>({time,end:(p.noteTypes[i]&128)?p.noteEnds[i]:time,column:p.columns[i],hold:!!(p.noteTypes[i]&128)}));
  if(notes.some(n=>!Number.isFinite(n.time)||!Number.isFinite(n.end)||n.time<0||n.end<n.time||n.end>7200000||n.column<0||n.column>=p.columnCount))throw new UserError('谱面音符数据无效或超过 2 小时。');
  const from=options.from??0,to=options.to??7200000,rate=options.rate??1,zoom=options.zoom??1;
  notes=notes.filter(n=>n.end>=from&&n.time<to).map(n=>({...n,clippedHead:n.time<from,time:Math.max(from,n.time),end:Math.min(to,n.end)}));
  if(!notes.length)throw new UserError('指定时间段没有音符。');
  let section='',timing=[],sv=[];
  for(const line of raw.split(/\r?\n/)){
    const text=line.trim();if(text.startsWith('[')){section=text;continue;}
    if(section!=='[TimingPoints]'||!text||text.startsWith('//'))continue;
    const parts=text.split(','),time=Number(parts[0]),beatLength=Number(parts[1]),meter=Number(parts[2]||4);
    if(options.sv&&Number(parts[6]??1)===0&&Number.isFinite(time)&&Number.isFinite(beatLength)&&beatLength<0)sv.push({time,value:-100/beatLength});
    if(options.sv&&Number(parts[6]??1)===1&&Number.isFinite(time))sv.push({time,value:1});
    if(Number(parts[6]??1)===1&&Number.isFinite(time)&&Number.isFinite(beatLength)&&beatLength>=10&&beatLength<=60000)timing.push({time,beatLength,meter:Number.isInteger(meter)&&meter>0&&meter<=16?meter:4});
  }
  timing.sort((a,b)=>a.time-b.time);
  timing=timing.filter((point,i)=>point.time!==timing[i+1]?.time);
  if(!timing.length)timing=[{time:0,beatLength:500,meter:4}];
  timing[0].beat=0;timing[0].measure=1;
  for(let i=1;i<timing.length;i++){
    const previous=timing[i-1];
    timing[i].beat=previous.beat+(timing[i].time-previous.time)/previous.beatLength;
    timing[i].measure=previous.measure+Math.ceil((timing[i].beat-previous.beat)/previous.meter-1e-9);
  }
  const beatAt=time=>{
    let low=0,high=timing.length;
    while(low<high){const mid=(low+high)>>1;if(timing[mid].time<=time)low=mid+1;else high=mid;}
    const point=timing[Math.max(0,low-1)];return point.beat+(time-point.time)/point.beatLength;
  };
  const first=Math.min(...notes.map(n=>n.time)),last=Math.max(...notes.map(n=>n.end));
  const beatsPerStrip=16/zoom,laneWidth=14*zoom;
  const startBeat=Math.floor(beatAt(first)/beatsPerStrip)*beatsPerStrip,endBeat=beatAt(last);
  const strips=Math.max(1,Math.floor((endBeat-startBeat)/beatsPerStrip)+1),columns=Math.floor(1824/(p.columnCount*laneWidth+(options.sv?42:26)));
  const rowPitch=options.sv?582:558,height=332+Math.ceil(strips/columns)*rowPitch;
  if(height>20000)throw new UserError('谱面过长，完整预览超过单张图片的尺寸范围。');
  // Keep the effective SV at a cropped range's beginning, and collapse timing
  // points that only change sample/volume settings. Last point at a time wins.
  sv.sort((a,b)=>a.time-b.time);
  sv=sv.filter((p,i)=>p.time!==sv[i+1]?.time);
  sv=sv.filter((p,i,all)=>!i||Math.abs(p.value-all[i-1].value)>1e-8).map(p=>({...p,beat:beatAt(p.time)}));
  const initial=sv.findLast(p=>p.beat<=startBeat);
  sv=options.sv?[{time:first,beat:startBeat,value:initial?.value??1},...sv.filter(p=>p.beat>startBeat&&p.beat<=endBeat)]:[];
  return {keys:p.columnCount,notes:notes.map(n=>({...n,beat:beatAt(n.time),endBeat:beatAt(n.end)})),timing,startBeat,endBeat,strips,columns,height,first,last,beatsPerStrip,laneWidth,rate,zoom,rowPitch,sv};
}

export function svSegments(points,start,end){
  let value=points.findLast(p=>p.beat<=start)?.value??1,cursor=start;const segments=[];
  for(const p of points){if(p.beat<=start)continue;if(p.beat>=end)break;segments.push({start:cursor,end:p.beat,value});cursor=p.beat;value=p.value;}
  segments.push({start:cursor,end,value});return segments.filter(s=>s.end>s.start);
}

const escape=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const text=(x,y,value,size=20,colour='#fff',align='start')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${colour}" text-anchor="${align}">${escape(value)}</text>`;
const cut=(s,n)=>String(s??'—').length>n?String(s).slice(0,n-1)+'…':String(s??'—');
export function beatmapViewSvg(result){
  const {view:v,map:m}=result,set=m.beatmapset||{},laneWidth=v.laneWidth||14,stripWidth=v.keys*laneWidth,gap=1824/v.columns,beats=v.beatsPerStrip||16;
  const px=512/beats,stripHeight=512;
  const location=i=>({x:48+(i%v.columns)*gap+24,y:300+Math.floor(i/v.columns)*(v.rowPitch||558)});
  let out='';
  const background=result.assets?.cover||result.assets?.art;
  if(background)out+=`<image width="1920" height="248" href="${escape(background.data)}" preserveAspectRatio="xMidYMid slice"/>`;
  out+='<rect width="1920" height="248" fill="#111723" fill-opacity=".55"/>';
  out+=text(48,45,'MANIA / BEATMAP VIEW',19,'#bfc9dc')+text(1872,45,new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'medium'}).format(new Date(result.queriedAt))+' UTC+8',18,'#d0d9e8','end');
  out+=text(48,104,cut(set.title,66),44)+text(48,148,cut(`${set.artist||'—'} · ${m.version||'—'}`,95),26,'#cdd7e7');
  out+=text(48,198,`${v.keys}K · ${m.difficulty_rating==null?'—':Number(m.difficulty_rating).toFixed(2)} ★ · OD ${m.accuracy??'—'} / HP ${m.drain??'—'} · ${set.creator||'—'} · ID ${m.id}`,22,'#edcd91');
  out+=text(1872,228,`${v.rate||1}× · Zoom ${v.zoom||1} · Blue: LN${v.sv?.length?' · SV side rail: blue <1× / gold >1× (beat spacing unchanged)':''}`,18,'#bfc9dc','end');
  for(let i=0;i<v.strips;i++){
    const {x,y}=location(i),start=v.startBeat+i*beats;
    out+=`<rect x="${x}" y="${y}" width="${stripWidth}" height="${stripHeight}" fill="#202632"/>`;
    for(let k=0;k<=v.keys;k++)out+=`<path d="M${x+k*laneWidth} ${y}v${stripHeight}" stroke="#fff" stroke-opacity=".13"/>`;
    for(let beat=0;beat<=beats;beat++)out+=`<path d="M${x} ${y+stripHeight-beat*px}h${stripWidth}" stroke="#fff" stroke-opacity=".06"/>`;
    for(const [j,point] of v.timing.entries()){
      const next=v.timing[j+1]?.beat??Infinity;
      if(next<=start||point.beat>=start+beats)continue;
      const first=point.beat+Math.max(0,Math.ceil((start-point.beat)/point.meter-1e-9))*point.meter;
      // Each timing point only owns its forward segment; each strip owns
      // [start,start+16). Never extrapolate later BPMs into earlier strips.
      for(let beat=first;beat<start+beats-1e-9&&beat<next-1e-9;beat+=point.meter){
        const yy=y+stripHeight-(beat-start)*px;
        const number=point.measure+Math.round((beat-point.beat)/point.meter);
        out+=`<path d="M${x} ${yy}h${stripWidth}" stroke="#fff" stroke-opacity=".3"/><g data-measure="${number}" data-beat="${beat}">`+text(x-5,yy+3,number,10,'#aeb9cb','end')+'</g>';
      }
    }
    const point=v.timing.findLast(p=>p.beat<=start)||v.timing[0];
    const seconds=Math.max(0,Math.floor((point.time+(start-point.beat)*point.beatLength)/1000/(v.rate||1)));
    out+=text(x,y+stripHeight+23,`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`,12,'#8fb9ff');
  }
  for(const n of v.notes){
    const first=Math.max(0,Math.floor((n.beat-v.startBeat)/beats)),last=Math.min(v.strips-1,Math.floor((n.endBeat-v.startBeat)/beats));
    for(let i=first;i<=last;i++){
      const {x,y}=location(i),base=v.startBeat+i*beats,nx=x+n.column*laneWidth+1;
      const from=Math.max(n.beat,base),to=Math.min(n.endBeat,base+beats);
      if(n.hold&&to>from)out+=`<rect x="${nx+2}" y="${y+stripHeight-(to-base)*px}" width="${laneWidth-6}" height="${(to-from)*px}" fill="#78bddb" fill-opacity=".68"/>`;
      if(!n.clippedHead&&n.beat>=base&&n.beat<base+beats)out+=`<rect x="${nx}" y="${y+stripHeight-(n.beat-base)*px-2}" width="${laneWidth-2}" height="3.5" rx=".6" fill="${n.hold?'#9ddfff':n.column%2?'#f2acbd':'#f1f4fa'}"/>`;
    }
  }
  if(v.sv?.length)for(let i=0;i<v.strips;i++){
    const {x,y}=location(i),start=v.startBeat+i*beats,segments=svSegments(v.sv,start,start+beats),rail=x+stripWidth+4;
    out+=`<g data-sv-rail="${i}"><rect x="${rail}" y="${y}" width="10" height="512" rx="3" fill="#293240"/>`;
    for(const s of segments){
      const colour=s.value<.999?'#83baff':s.value>1.001?'#e4bc73':'#8eaaa9';
      const width=3+Math.min(7,Math.abs(Math.log2(Math.max(.001,s.value)))*2);
      out+=`<rect x="${rail}" y="${y+stripHeight-(s.end-start)*px}" width="${width}" height="${(s.end-s.start)*px}" fill="${colour}"/>`;
    }
    const values=segments.map(s=>s.value),lo=Math.min(...values),hi=Math.max(...values);
    const fmt=n=>n<.01?n.toPrecision(1):n>=100?n.toFixed(0):n.toFixed(2).replace(/\.?0+$/,'');
    out+=text(x+stripWidth/2,y+stripHeight+39,`${fmt(lo)}${Math.abs(hi-lo)>.001?'–'+fmt(hi):''}×`,10,'#c2bda9','middle')+'</g>';
  }
  out+=text(48,v.height-22,`${v.notes.length.toLocaleString('en-US')} objects · ${v.strips} strips · ${beats.toFixed(1)} beats per strip · Original map range; timestamps at ${v.rate||1}×`,18,'#bfc9dc');
  if(result.demo)out+=text(1560,v.height-22,'DEMO · SIMULATED DATA',16,'#edcd91');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="${v.height}"><rect width="1920" height="${v.height}" fill="#151b25"/><g font-family="Noto Sans SC, Segoe UI, Microsoft YaHei, sans-serif">${out}</g></svg>`;
}
