const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c]));
const f = (v, digits=0) => v==null ? '—' : Number(v).toLocaleString('en-US',{maximumFractionDigits:digits});
const cut = (v,n=40) => String(v??'—').length>n ? String(v).slice(0,n-1)+'…' : String(v??'—');
const t = (x,y,v,size=24,color='#f8f9fc',a='') => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" ${a}>${e(v)}</text>`;
const b = (x,y,v,size=36,color='#fff',a='') => t(x,y,v,size,color,`font-weight="700" ${a}`);
const label = (x,y,v,color='#b4bac7',a='') => b(x,y,v,17,color,`letter-spacing="2.6" ${a}`);
import { patternColors, patternGroup, groupedPatterns } from './patterns.js';
import { scoreClient } from './time-best.js';
import { danScale } from './dan-icons.js';
import { modIcons } from './mod-icons.js';
const end='text-anchor="end"',mid='text-anchor="middle"';
const central='dominant-baseline="central"';
// Lay out text boxes with the same gap above, between and below each line.
function textStack(y,h,sizes){
  const gap=(h-sizes.reduce((sum,size)=>sum+size,0))/(sizes.length+1);
  let cursor=y+gap;
  return sizes.map(size=>{const center=cursor+size/2;cursor+=size+gap;return center;});
}
const hasMods = s => (s.mods||[]).some(m=>!['NM','CL'].includes(typeof m==='string'?m:m.acronym));
const grade = rank => ({ X:'SS', XH:'SS', SSH:'SS', SH:'S' }[rank] || rank || '—');
const hidden = score => (score.mods||[]).some(mod=>(typeof mod==='string'?mod:mod.acronym)==='HD');
const silverGrade = score => ['S','SS'].includes(grade(score.rank)) && (hidden(score)||/H$/.test(score.rank||''));
const gradeColor = score => `url(#grade${silverGrade(score)?'Silver':({SS:'Gold',S:'Gold',A:'Green',B:'Blue',C:'Purple',D:'Red',F:'Gray'}[grade(score.rank)]||'Gray')})`;
function judgmentRatio(statistics){
  const max=statistics.perfect??statistics.count_geki??0;
  const great=statistics.great??statistics.count_300??0;
  return great>0?`${f(max/great,1)} : 1`:max>0?'∞ : 1':'—';
}
const speed = s => {
  const timeMod=(s.mods||[]).find(m=>['DT','NC','HT','DC'].includes(typeof m==='string'?m:m.acronym));
  if (!timeMod) return 1;
  const rate=typeof timeMod==='object'?Number(timeMod.settings?.speed_change):NaN;
  if (Number.isFinite(rate)&&rate>0) return rate;
  return ['HT','DC'].includes(typeof timeMod==='string'?timeMod:timeMod.acronym) ? .75 : 1.5;
};
const truncated = v => Math.floor(Number(v)*100+1e-8)/100;
const stars = v => v==null?'—':f(truncated(v),2);
const scoreValue = s => s.total_score??s.score;
const scoreTime = s => {
  const date=new Date(s.ended_at||s.created_at);
  return Number.isNaN(date.getTime())?'Time unavailable':new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(date)+' UTC+8';
};
const setOf = s => s.beatmapset||s.beatmap?.beatmapset||{};
const duration = s => s==null?'—':`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const pct = v => v==null?'—':`${truncated(v*100).toFixed(2)}%`;
const thin = (x,y,w) => `<path d="M${x} ${y} h${w}" stroke="#fff" stroke-opacity=".14"/>`;
const glass = (x,y,w,h,opacity=.45) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="#171b25" fill-opacity="${opacity}" stroke="#fff" stroke-opacity=".14" stroke-width="1.5"/>`;
function image(id,x,y,w,h,portrait=false,r=18,assets={},fit=portrait?'slice':'meet'){
  const clip=`clip_${x}_${y}_${w}_${h}`;
  const sw=assets[id]?.width||(id==='avatar'?256:1920),sh=assets[id]?.height||(id==='avatar'?256:1080);
  const view=portrait&&id==='art'?`${sw*.5885} 0 ${sw*.3646} ${sh*.8333}`:`0 0 ${sw} ${sh}`;
  return `<clipPath id="${clip}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/></clipPath><g clip-path="url(#${clip})"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#111723"/><svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="${view}" preserveAspectRatio="xMidYMid ${fit}"><use href="#${id}"/></svg></g>`;
}
function track(x,y,w,ratio,color='url(#accent)',h=9){
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h/2}" fill="#fff" opacity=".12"/><rect x="${x}" y="${y}" width="${w*Math.max(0,Math.min(1,Number(ratio)||0))}" height="${h}" rx="${h/2}" fill="${color}"/>`;
}
function starTracks(x,y,w,base,modified){
  const half=12,clip='star_track_clip';
  const width=value=>w*Math.max(0,Math.min(1,(Number(value)||0)/12));
  const strip=(value,lower)=>{
    const length=width(value),radius=Math.min(half,length/2),right=x+length;
    if(!length)return '';
    const path=lower
      ?`M${x} ${y+half} H${right} Q${right} ${y+half*2} ${right-radius} ${y+half*2} H${x+radius} Q${x} ${y+half*2} ${x} ${y+half} Z`
      :`M${x} ${y+half} Q${x} ${y} ${x+radius} ${y} H${right-radius} Q${right} ${y} ${right} ${y+half} Z`;
    return `<path d="${path}" fill="url(#${lower?'modStars':'baseStars'})"/>`;
  };
  return `<clipPath id="${clip}"><rect x="${x}" y="${y}" width="${w}" height="${half*2}" rx="${half}"/></clipPath><rect x="${x}" y="${y}" width="${w}" height="${half*2}" rx="${half}" fill="#fff" opacity=".12"/><g clip-path="url(#${clip})">${strip(base,false)}${modified==null?'':strip(modified,true)}</g>`;
}
const empty=(x,y,w,h)=>t(x+w/2,y+h/2,'No data available',24,'#b1b7c6',mid);
function chart(data,x,y,w,h,color='#8fb9ff',inverse=false,times=null){
  if(!data?.length)return empty(x,y,w,h);
  const low=Math.min(...data),high=Math.max(...data),range=high-low||1;
  const points=data.map((v,i)=>[x+(times?.length===data.length?(times[i]-times[0])/(times.at(-1)-times[0]||1):i/Math.max(1,data.length-1))*w,y+12+(inverse?(v-low)/range:1-(v-low)/range)*(h-24)]);
  let out='';for(let i=0;i<4;i++)out+=`<path d="M${x} ${y+i*h/3} h${w}" stroke="#fff" stroke-opacity=".09" stroke-dasharray="5 8"/>`;
  out+=`<path d="M${x} ${y+h} L${points.map(p=>p.join(' ')).join(' L')} L${x+w} ${y+h} Z" fill="${color}" fill-opacity=".12"/><polyline points="${points.map(p=>p.join(',')).join(' ')}" stroke="${color}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  return out;
}
function bars(data,x,y,w,h){
  if(!data?.length)return empty(x,y,w,h);const max=Math.max(...data,1),step=w/data.length;
  return data.map((v,i)=>`<rect x="${x+i*step}" y="${y+h-v/max*h}" width="${step-7}" height="${v/max*h}" rx="4" fill="${['#82b2f4','#90d9c5','#e8c27c'][i%3]}" opacity=".9"/>`).join('');
}
const patternColor = name => patternColors[patternGroup(name)] || 'none';
function timeline(a,x,y,w,h=18){
  return (a.patterns||[]).map(p => `<rect x="${x+p.time/a.length*w}" y="${y}" width="${Math.max(0,Math.min(15,a.length-p.time)/a.length*w-1)}" height="${h}" rx="3" fill="${patternColor(p.category)}"/>`).join('');
}
function patternLegend(x,y){
  return Object.entries(patternColors).map(([name,color],i)=>
    `<circle cx="${x+i*280+5}" cy="${y-6}" r="5" fill="${color}"/>`+t(x+i*280+18,y,name,16,'#c3cad7')
  ).join('');
}
function analysis(r){
  const a=r.analysis,m=r.map,set=m.beatmapset||{};
  let out=top(r,'Beatmap analysis')+b(64,224,cut(set.title,51),48)
    +t(64,258,cut(`${set.artist} · ${m.version} · ID ${m.id} · ${a.rate}×`,105),23,'#c5cedc')
    +b(1856,114,`Official base ${f(m.difficulty_rating,2)} ★`,28,'#edcd91',end);
  const names=['Sunny','Daniel','Azusa','Companella'];
  names.forEach((name,i)=>{
    const v=a.ratings[name],x=64+i*456;
    const size=v?.star!=null?43:27,ys=textStack(282,154,[17,size,22]);
    out+=glass(x,282,424,154)+label(x+24,ys[0],name.toUpperCase(),['#edcd91','#90d9c5','#ee93b1','#8fb9ff'][i],central)
      +b(x+24,ys[1],v?.star!=null?`${f(v.star,2)} ★`:name==='Companella'&&v?'MODEL ESTIMATE':'UNAVAILABLE',size,'#fff',central)
      +t(x+24,ys[2],cut(v?.label||'Unsupported chart / key count',36),22,'#c9d2df',central);
  });
  [['OBJECTS',f(a.notes),`${f(a.longNotes)} long notes`],['LN RATIO',pct(a.lnRatio),'Head count / objects'],['AVG DENSITY',f(a.avgNps,2)+' NPS','Note heads per second'],['PEAK DENSITY',f(a.peakNps,2)+' NPS','~1 s bins'],['CHORD ROWS',pct(a.chordRows/a.rows),`${f(a.chordRows)} / ${f(a.rows)} rows`],['TEMPO',f(m.bpm*a.rate,1)+' BPM',`${a.keys}K · ${duration(a.length)}`]].forEach(([name,v,sub],i)=>{out+=metric(64+i*304,464,272,130,name,v,sub,i===1?'#90d9c5':'#fff');});
  out+=glass(64,622,1180,236)+label(91,661,'NOTE DENSITY')+t(1214,661,'Note heads · LN tails excluded',19,'#b9c5d8',end)
    +chart(a.density,91,689,1125,120,'#8fb9ff')+t(91,836,'0:00',19,'#bcc8d8')+t(1214,836,duration(a.length),19,'#bcc8d8',end)
    +glass(1272,622,584,236)+label(1300,661,'KEY DISTRIBUTION');
  a.columnNotes.forEach((n,i)=>{
    const y=693+i*140/a.keys;
    out+=t(1300,y+17,`K${i+1}`,19,'#c8d2e0')+track(1350,y,365,n/Math.max(...a.columnNotes),'url(#accent)',12)+t(1826,y+15,f(n),19,'#fff',end);
  });
  out+=glass(64,886,866,310)+label(91,927,'ETTERNA MSD · SKILLSETS')+t(902,927,a.msd?`MinaCalc ${a.msd.etternaVersion} · 93% goal`:'Unsupported chart',18,'#c6cedc',end);
  const skills=['Overall','Stream','Jumpstream','Handstream','Stamina','JackSpeed','Chordjack','Technical'];
  if(a.msd)skills.forEach((name,i)=>{
    const x=92+i%2*414,y=972+Math.floor(i/2)*54,value=a.msd.values[name];
    out+=t(x,y,name,22,'#c8d2e2')+b(x+375,y,f(value,1),26,'#edcd91',end)+track(x,y+14,374,value/40,'#edcd91',6);
  });else out+=empty(91,946,810,210);
  out+=glass(958,886,898,310)+label(986,927,'DOMINANT PATTERNS')+t(1826,927,'Share of timeline · 15 s windows',18,'#c6cedc',end);
  groupedPatterns(a.patternSummary).forEach(([name,seconds],i)=>{
    const y=975+i*48;
    out+=t(987,y,cut(name,34),24,patternColor(name))+b(1825,y,pct(seconds/a.length),25,'#fff',end)+track(987,y+12,838,seconds/a.length,patternColor(name),5);
  });
  if(!a.patternSummary.length)out+=empty(986,946,838,210);
  out+=glass(64,1224,1792,270)+label(91,1265,'DIFFICULTY TIMELINE')+t(1826,1265,'Sunny strain · local pattern detector',19,'#c6cedc',end)
    +chart(a.strain.values,91,1286,1736,118,'#90d9c5',false,a.strain.times)+timeline(a,91,1420,1736,20)
    +patternLegend(91,1472)
    +t(1825,1472,`${a.patterns.length} windows · ${duration(a.length)}`,19,'#c6cedc',end);
  out+=t(64,1527,a.warnings.length?cut(a.warnings.join(' · '),115):'Community difficulty estimates · not official osu! stars or certified dan results',18,'#c4cddd');
  return out;
}
function metric(x,y,w,h,name,value,sub='',color='#fff'){
  const size=Math.min(value.length>15?36:48,(w-50)/Math.max(1,value.length*.57));
  const subSize=Math.min(20,(w-50)/Math.max(1,sub.length*.52));
  const ys=textStack(y,h,sub?[17,size,subSize]:[17,size]);
  return glass(x,y,w,h)+label(x+25,ys[0],name,'#b4bac7',central)+b(x+25,ys[1],value,size,color,central)+(sub?t(x+25,ys[2],sub,subSize,'#bfc7d6',central):'');
}
function stamp(r,height){
  return thin(64,height-62,1792)+label(64,height-29,'MANIA / GLASS')+t(1856,height-29,r.demo?'DEMO · SIMULATED DATA':'osu! public API',18,r.demo?'#edcf89':'#a9ddc9',end);
}
function top(r,title){
  const u=r.user;
  const queryLabel=r.kind==='score'
    ?`${r.scoreIndex!=null?`${r.scoreType==='best'?'BEST':'RECENT'} #${r.scoreIndex} · `:''}${scoreTime(r.scores[0])}`
    :r.demo?'SIMULATED PREVIEW':'LIVE QUERY';
  let out=label(64,50,'MANIA / '+title.toUpperCase())+t(1856,50,queryLabel,18,'#bac4d4',end);
  if(u){
    const name=cut(u.username,r.kind==='score'?20:24),stats=u.statistics||{},x=142+name.length*19+32;
    out+=image(r.assets?.avatar?'avatar':'art',64,76,58,58,true,29,r.assets)+b(142,106,name,30)
      +t(142,132,`${u.country_code||'—'} · ID ${u.id}`,18,'#bfc7d4');
    if(r.kind==='score'){
      const rank=value=>value==null?'—':`#${f(value)}`;
      const start=142+name.length*17+24,pp=`${f(stats.pp)} pp`,global=`Global ${rank(stats.global_rank)}`,country=`${u.country_code||'Country'} ${rank(stats.country_rank)}`;
      const size=Math.min(23,(1390-start)/Math.max(1,(pp.length+global.length+country.length+6)*.56));
      out+=`<text x="${start}" y="106" font-size="${size}"><tspan fill="#edcd91">${e(pp)}</tspan><tspan fill="#bfc7d4"> · </tspan><tspan fill="#a8c8fa">${e(global)}</tspan><tspan fill="#bfc7d4"> · </tspan><tspan fill="#90d9c5">${e(country)}</tspan></text>`;
    }else out+=t(x,106,`${f(stats.pp)} pp · Global #${f(stats.global_rank)} · ${u.country_code||'Country'} #${f(stats.country_rank)}`,22,'#c7d6ed');
  }
  else out+=b(64,114,'Beatmap details',31);
  return out+thin(64,158,1792);
}

function clientBadge(s){
  const client=scoreClient(s);
  if (!['Stable','Lazer'].includes(client)) return t(1856,114,'CLIENT UNKNOWN',18,'#c7ccd6',end);
  const a='text-anchor="end" font-weight="900" font-style="italic" letter-spacing="-1"';
  const word=client.toUpperCase(),gradient=client==='Lazer'?'clientLazer':'clientStable';
  return `<g aria-label="${word}" transform="translate(1848 114) rotate(-3)">`
    +t(0,4,word,49,'#646876',`${a} stroke="#646876" stroke-width="13" stroke-linejoin="round"`)
    +t(0,0,word,49,'#fff',`${a} stroke="#fff" stroke-width="10" stroke-linejoin="round"`)
    +t(0,0,word,49,`url(#${gradient})`,a)+`</g>`;
}
function scoreBeatmap(m,rate,assets={}){
  const d=m.danContribution;
  const danValue=value=>Number.isFinite(value)?value.toFixed(2):'—';
  const base=glass(1272,652,584,226)+label(1298,691,d?`LOCAL DAN · ${d.keys||4}K ${d.side==='LN'?'LN':'RICE'}`:'BEATMAP');
  const metadata=t(1298,857,`ID ${m.id||'—'} · ${cut(m.beatmapset?.creator,26)}`,17,'#c3cad7');
  if(!d)return base+b(1298,750,cut(m.version,33),26,'#fff')
    +t(1298,794,`${m.cs||'—'}K · ${m.status||'—'} · ${rate}×`,20,'#c3cad7')+metadata;
  let out=base
    +t(1298,728,'◇ CHART ESTIMATE',16,'#edcd91')+t(1508,728,'● YOUR CREDIT',16,'#8fb9ff')
    +b(1298,779,danValue(d.chart),46,'#edcd91')+t(1459,775,'→',29,'#c3cad7')+b(1508,779,danValue(d.credited),46,'#8fb9ff')
    +t(1298,802,d.label,16,'#c3cad7')+t(1508,802,d.creditedLabel,16,'#c3cad7')
    +t(1298,829,d.reason?cut(d.reason,49):`Dan ACC (Stable) ${f(d.accuracy*100,2)}% · Bar ${f((d.bar??.96)*100)}%`,16,d.reason?'#f78e9c':'#c3cad7')+metadata;
  if(d.credited!=null){
    const {lower,upper,levels}=danScale(d.chart,d.keys,d.side),pos=v=>807-(v-lower)/(upper-lower)*86;
    out+=`<path d="M1650 715v113" stroke="#fff" stroke-opacity=".1"/>`;
    out+=`<path d="M1806 713v105" stroke="#fff" stroke-opacity=".2"/>`;
    for(const {level,name,range} of levels){
      const y=pos(level);
      if(assets[`dan${level}`])out+=`<svg x="1663" y="${y-13}" width="32" height="26" viewBox="0 0 ${assets[`dan${level}`].width} ${assets[`dan${level}`].height}" preserveAspectRatio="xMidYMid meet"><use href="#dan${level}"/></svg>`;
      out+=t(1708,y,name,14,'#c3cad7')+t(1708,y+16,range,11,'#939bab')+`<path d="M1799 ${y}h14" stroke="#fff" stroke-opacity=".25"/>`;
    }
    out+=`<path d="M1806 ${pos(d.chart)}H1828V${pos(d.credited)}" fill="none" stroke="#8fb9ff" stroke-width="2"/>
      <path d="M1786 ${pos(d.chart)-5}l5 5-5 5-5-5z" fill="none" stroke="#edcd91"/><circle cx="1828" cy="${pos(d.credited)}" r="6" fill="#8fb9ff"/>`;
  }
  return out;
}
function score(r){
  const s=r.scores[0],m=s.beatmap||{},set=setOf(s),j=s.statistics||{},rate=speed(s);
  const client=scoreClient(s),title=cut(set.title,44),titleSize=Math.min(58,980/Math.max(1,title.length*.57));
  const resultYs=textStack(198,250,[17,134,20]);
  const modStarText=m.modStars==null?'— ★':`${stars(m.modStars)} ★`;
  const analysisLabel=m.analysis?.keys===7&&m.analysis.lnRatio>=.375
    ?m.analysis.ratings.Sunny.label.split('||').at(-1).trim():m.analysis?.ratings.Sunny.label;
  const modIconX=hasMods(s)?235:90+`${stars(m.difficulty_rating)} ★`.length*52*.52+14;
  const starPanel=glass(64,318,1280,130)+label(90,354,'BASE STAR RATING · WITHOUT MODS')
    +modIcons(s,modIconX,387,28,Math.max(40,342-modIconX))
    +(hasMods(s)
    ?b(90,382,`${stars(m.difficulty_rating)} ★`,40,'#edcd91',central)+starTracks(362,389,940,m.difficulty_rating,m.modStars)
      +b(90,430,modStarText,28,'#8fb9ff')
      +(m.modStars==null?t(1300,430,'Unavailable',19,'#a8c8fa',end):'')
      +t(1300,354,`${m.cs||'—'}K · ${m.status||'—'}`,19,'#cad5e7',end)
    :b(90,392,`${stars(m.difficulty_rating)} ★`,52,'#edcd91',central)+track(362,389,940,(m.difficulty_rating||0)/12,'url(#accent)',24)
      +t(1300,354,`${m.cs||'—'}K · ${m.status||'—'}`,19,'#cad5e7',end));
  const detail=m.analysis
    ?label(90,691,'BEATMAP ANALYSIS')+t(1216,691,`Sunny ${f(m.analysis.ratings.Sunny.star,2)} ★ · ${cut(analysisLabel,34)}`,20,'#edcd91',end)+chart(m.analysis.density,90,716,1127,80,'#90d9c5')+timeline(m.analysis,90,806,1127,17)+patternLegend(90,846)+t(90,866,`${f(m.analysis.avgNps,2)} NPS · LN ${pct(m.analysis.lnRatio)} · 15 s pattern windows`,16,'#c3cad7')
    :m.density?.length
    ?label(90,691,'NOTE DENSITY')+t(1216,691,r.demo?'DEMO CHART':'BEATMAP CHART',18,'#b4bdce',end)+chart(m.density,90,722,1127,126,'#90d9c5')
    :label(90,691,'SCORE DETAILS')+b(90,753,f(scoreValue(s)),49)+t(1216,753,client,28,'#90d9c5',end)+t(90,810,scoreTime(s),23,'#c3cad7')+modIcons(s,90,828,30,1000);
  let out=top(r,'Score')+b(64,234,title,titleSize)+t(64,279,cut(`${set.artist||'—'} · ${m.version||'—'}`,58),28,'#c7ccd6')
    +clientBadge(s)+label(1320,221,'SCORE','#b4bac7',end)
    +b(1320,270,f(scoreValue(s)),Math.min(46,264/Math.max(1,String(f(scoreValue(s))).length*.57)),'#fff',end)+starPanel
    +glass(1372,198,484,250,.34)+label(1614,resultYs[0],'RESULT','#b4bac7',`${mid} ${central}`)
    +b(1614,resultYs[1],grade(s.rank),134,gradeColor(s),`${mid} ${central}${/^X/.test(s.rank||'')?' font-style="italic"':''}`)+t(1614,resultYs[2],`${s.passed?'PASSED':'NOT PASSED'}${hidden(s)?' · HD':silverGrade(s)?' · HIDDEN':''}`,20,'#c8ceda',`${mid} ${central}`)
    +metric(64,476,282,148,'PERFORMANCE',s.pp==null?'—':`${f(s.pp,2)} pp`,s.pp==null?'Not provided by osu! API':'Official score value','#edcd91')
    +metric(366,476,282,148,'ACCURACY',pct(s.accuracy),`MAX : 300 = ${judgmentRatio(j)}`)
    +metric(668,476,282,148,'COMBO',`${f(s.max_combo)}x`,'Achieved combo')
    +metric(970,476,282,148,'BPM',`${f(m.bpm==null?null:m.bpm*rate,1)} BPM`,rate===1?'Original tempo':`${rate}× · Base ${f(m.bpm)} BPM`)
    +metric(1272,476,282,148,'LENGTH',duration(m.total_length==null?null:m.total_length/rate),`Base ${duration(m.total_length)}`)
    +metric(1574,476,282,148,'OD / HP',`${f(m.accuracy,1)} / ${f(m.drain,1)}`,'Base OD / HP')
    +glass(64,652,1180,226)+detail
    +scoreBeatmap({...m,beatmapset:set},rate,r.assets);
  const values=[j.perfect??j.count_geki??0,j.great??j.count_300??0,j.good??j.count_katu??0,j.ok??j.count_100??0,j.meh??j.count_50??0,j.miss??j.count_miss??0];
  const sum=values.reduce((a,v)=>a+v,0)||1;
  values.forEach((v,i)=>{const x=64+i*304;out+=glass(x,906,272,110)+label(x+20,937,['MAX','300','200','100','50','MISS'][i])+b(x+249,972,f(v),31,['#edcd91','#fff','#8fb9ff','#90d9c5','#edcd91','#f78e9c'][i],end)+track(x+20,990,232,v/sum,i===5?'#f78e9c':'url(#accent)',6);});
  return out;
}

function row(s,i,x,y,w,assets={}){
  const cover=assets[`score${i}`]?`score${i}`:'art',set=setOf(s);
  let out=image(cover,x,y,w,75,false,15,assets)+`<rect x="${x}" y="${y}" width="${w}" height="75" rx="15" fill="#131825" opacity=".65" stroke="#fff" stroke-opacity=".13"/>`
    +b(x+25,y+48,grade(s.rank),grade(s.rank).length>1?22:29,gradeColor(s))+b(x+79,y+31,cut(set.title,29),24)+t(x+79,y+58,pct(s.accuracy),19,'#bfc7d6')+modIcons(s,x+172,y+39,23,Math.max(80,w-320))
    +b(x+w-23,y+46,`${f(s.pp)} pp`,30,'#a8c8fa',end);
  return out;
}
function profile(r){
  const u=r.user,s=u.statistics||{},history=u.rank_history?.data;
  let out=label(64,48,'MANIA / PLAYER PROFILE')+t(1856,48,r.demo?'SIMULATED PREVIEW':'LIVE QUERY',18,'#bac4d4',end)
    +image(r.assets?.avatar?'avatar':'art',64,79,104,104,true,25,r.assets)+b(197,132,cut(u.username,24),54)+t(198,176,`${u.country_code||'—'} · ID ${u.id} · Lv.${s.level?.current??'—'}`,23,'#c4cbd7')
    +metric(1032,78,250,112,'WORLD RANK',`#${f(s.global_rank)}`,'','#a7c7fc')
    +metric(1306,78,250,112,'COUNTRY RANK',`#${f(s.country_rank)}`,'','#a7c7fc')
    +metric(1580,78,276,112,'TOTAL PP',f(s.pp),'','#edcd91')
    +glass(64,222,866,358)+label(91,262,'RANK HISTORY')+t(902,261,history?.length?`${history.length} days`:'No history',20,'#bbc5d5',end)
    +chart(history,130,293,770,227,'#99baff',true)
    +t(130,549,history?.length?`#${f(history[0])}`:'—',21,'#bec9dc')+t(900,549,`#${f(s.global_rank)} now`,21,'#bec9dc',end)
    +glass(958,222,898,358)+label(988,262,'STATISTICS');
  const cx=1139,cy=374,rad=88,circumference=2*Math.PI*rad;
  out+=`<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="17"/><circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="url(#accent)" stroke-width="17" stroke-linecap="round" stroke-dasharray="${circumference*(s.hit_accuracy||0)/100} ${circumference}" transform="rotate(-90 ${cx} ${cy})"/>`
    +b(cx,378,`${f(s.hit_accuracy,2)}%`,39,'#fff',mid)+label(cx,409,'ACCURACY','#b4bac7',mid);
  [['PLAY COUNT',f(s.play_count),'▶'],['PLAY TIME',s.play_time==null?'—':`${f(s.play_time/3600,1)} h`,'◷'],['TOTAL SCORE',f(s.total_score),'★'],['TOTAL HITS',f(s.total_hits),'◎'],['MAX COMBO',f(s.maximum_combo),'↔']].forEach(([name,v,icon],i)=>{
    const y=300+i*36;
    out+=`<circle cx="1287" cy="${y-7}" r="13" fill="#fff" fill-opacity=".12"/>`+t(1287,y-2,icon,16,'#c3cbd8',mid)
      +b(1316,y,name,18,'#c3cbd8','letter-spacing="1"')+b(1826,y,v,27,'#fff',end);
  });
  const g=s.grade_counts||{};
  const combined=(normal,hidden)=>g[normal]==null&&g[hidden]==null?null:Number(g[normal]||0)+Number(g[hidden]||0);
  out+=thin(988,482,835);
  [['SS',combined('ss','ssh'),'#e0e7f2'],['S',combined('s','sh'),'#edcd91'],['A',g.a,'#39db9b'],['B',g.b,'#8fb9ff'],['C',g.c,'#b59be4'],['D',g.d,'#f08197']].forEach(([rank,count,color],i)=>{
    const x=1057+i*140;
    out+=`<circle cx="${x}" cy="515" r="19" fill="${color}" fill-opacity=".1" stroke="${color}" stroke-opacity=".65" stroke-width="2.5"/>`
      +b(x,516,rank,20,color,`${mid} ${central}`)+b(x,558,f(count),23,'#fff',mid);
  });
  out+=glass(64,608,866,486)+label(93,650,'BEST PERFORMANCE')+t(901,650,'TOP 5',19,'#bfc7d6',end)
    +glass(958,608,898,486)+label(987,650,'RECENT PLAYS')+t(1827,650,'LAST 5',19,'#bfc7d6',end);
  (r.best||[]).slice(0,5).forEach((v,i)=>{out+=row(v,i,91,672+i*81,812,r.assets);});
  (r.recent||[]).slice(0,5).forEach((v,i)=>{const assets={...r.assets,[`score${i}`]:r.assets?.[`recent${i}`]};let item=row(v,i,985,672+i*81,844,assets);item=item.replaceAll(`#score${i}`,`#recent${i}`);out+=item;});
  if(!r.best?.length)out+=empty(91,672,812,360);if(!r.recent?.length)out+=empty(985,672,844,360);
  return out;
}

function scores(r){
  const rows=Math.ceil(r.scores.length/4),height=250+rows*300;let out=top(r,r.title?.startsWith('BEST')?'Best performances':'Recent plays');
  if(r.requestedCount!=null)out+=t(1856,174,`${r.requestedRange?`第 ${r.requestedRange.start}–${r.requestedRange.end} 条 · `:''}显示 ${r.scores.length} / 请求 ${r.requestedCount} 条`,19,'#c7d6ed',end);
  r.scores.forEach((s,i)=>{
    const x=64+i%4*456,y=194+Math.floor(i/4)*300,m=s.beatmap||{},set=setOf(s),id=r.assets?.[`score${i}`]?`score${i}`:'art';
    out+=glass(x,y,424,272,.47)+image(id,x+12,y+12,400,104,false,16,r.assets)
      +b(x+22,y+150,cut(set.title,25),27)+t(x+22,y+179,cut(m.version,31),20,'#bac7dc')
      +b(x+22,y+226,`${f(s.pp)} pp`,38,'#d3e1ff')+b(x+400,y+225,pct(s.accuracy),25,'#fff',end)
      +t(x+22,y+253,`${f(m.difficulty_rating,2)} ★`,20,'#edcd91')+modIcons(s,x+117,y+232,26,180)+t(x+400,y+253,`#${(r.scoreStart||1)+i} · ${grade(s.rank)}`,20,gradeColor(s),end);
  });return {out,height};
}

function timebest(r){
  const all=r.scores,rows=Math.max(1,Math.ceil(r.scores.length/5)),height=390+rows*304;
  const pp=all.map(s=>s.pp).filter(v=>v!=null&&Number.isFinite(Number(v))),acc=all.map(s=>s.accuracy).filter(v=>v!=null&&Number.isFinite(Number(v)));
  const ratings=all.map(s=>s.beatmap?.difficulty_rating).filter(v=>v!=null&&Number.isFinite(Number(v)));
  let out=top(r,'New best performances')+b(64,231,`NEW BEST · LAST ${r.days} DAYS`,43)
    +t(64,271,`${all.length} scores · Current Top 200`,23,'#c7d6ed')
    +t(64,307,`Updated ${scoreTime({ended_at:r.queriedAt})}`,18,'#bfc7d4');
  [['AVG PP',pp.length?`${f(pp.reduce((a,b)=>a+Number(b),0)/pp.length,2)} pp`:'—'],
    ['AVG ACCURACY',acc.length?pct(acc.reduce((a,b)=>a+Number(b),0)/acc.length):'—'],
    ['MAX BASE STARS',ratings.length?`${f(Math.max(...ratings),2)} ★`:'—']].forEach(([name,value],i)=>{out+=metric(1036+i*280,190,260,126,name,value,'',i===0?'#edcd91':'#a8c8fa');});
  if(!r.scores.length)out+=glass(64,350,1792,270)+t(960,492,'No new best performances in this period',30,'#c7d6ed',mid);
  r.scores.forEach((s,i)=>{
    const x=64+(i%5)*364,y=350+Math.floor(i/5)*304,map=s.beatmap||{},set=setOf(s),id=r.assets?.[`score${i}`]?`score${i}`:'art';
    const date=scoreTime(s).slice(0,10);
    out+=glass(x,y,336,282,.66)+image(id,x+8,y+8,320,148,false,16,r.assets,'slice')
      +`<rect x="${x+8}" y="${y+112}" width="320" height="44" fill="#111723" fill-opacity=".66"/>`
      +`<rect x="${x+16}" y="${y+16}" width="66" height="29" rx="14" fill="#e859a0"/><rect x="${x+238}" y="${y+16}" width="82" height="29" rx="14" fill="#111723" fill-opacity=".85"/>`
      +b(x+49,y+37,`#${s.bpRank}`,18,'#fff',mid)+b(x+312,y+37,`${stars(map.difficulty_rating)} ★`,18,'#edcd91',end)
      +b(x+21,y+144,`${f(s.pp,2)} pp`,25,'#edcd91')+b(x+312,y+144,grade(s.rank),25,gradeColor(s),end)
      +b(x+18,y+185,cut(set.title,25),23)+t(x+18,y+211,cut(set.artist,20),16,'#c7d6ed')
      +t(x+18,y+237,cut(map.version,26),18,'#c7d6ed')+t(x+318,y+211,pct(s.accuracy),18,'#edcd91',end)
      +modIcons(s,x+18,y+242,25,125)
      +t(x+318,y+263,`${scoreClient(s)} · ${date}`,16,'#bdc8d8',end);
  });
  return {out,height};
}

function recommend(r){
  const p=r.profile,items=r.items,height=650+items.length*158;
  let out=top(r,'Recommendations')+b(64,228,'PERSONAL BEATMAP RECOMMENDATIONS',43)
    +t(64,272,`Similar-player comparison · Mixed Mods · ${p.source} · Top ${items.length} of ${p.available} candidates`,23,'#c7d6ed');
  [['RECOMMENDED',`${items.length} maps`,'#a8c8fa'],['BEST SINGLE-MAP GAIN',`+${f(Math.max(...items.map(item=>item.gain)),2)} pp`,'#edcd91'],['PEER SAMPLE',`${f(p.peerCount)} players`,'#90d9c5']].forEach(([name,value,color],i)=>{out+=metric(64+i*604,304,580,120,name,value,'',color);});
  const tableHeight=56+items.length*158;
  out+=glass(64,452,1792,tableHeight,.69)+label(90,491,'#')+label(190,491,'BEATMAP / REASON')+label(1100,491,'KEYS / MODS')+label(1322,491,'DIFFICULTY')+label(1530,491,'YOUR SCORE')+label(1828,491,'WEIGHTED GAIN','#b4bac7',end);
  items.forEach((item,i)=>{
    const y=508+i*158,m=item.map,set=m.beatmapset||{},asset=r.assets?.[`score${i}`]?`score${i}`:'art';
    if(i)out+=thin(90,y,1738);
    out+=b(93,y+82,String(i+1).padStart(2,'0'),30,'#c3cbd8')+image(asset,158,y+27,164,100,false,16,r.assets,'slice')
      +b(346,y+51,cut(set.title,43),27)+t(346,y+82,cut(m.version,49),21,'#c7d6ed')
      +t(346,y+109,cut(`${set.artist||'—'} · ${set.creator||'—'}`,49),18,'#bfc7d4')
      +t(346,y+136,`ID ${m.id} · ${item.source} · ${item.peers}/${item.sampleSize} peers`,17,'#90d9c5')
      +b(1100,y+66,`${m.cs}K`,30,'#a8c8fa')+modIcons({mods:item.mods},1100,y+80,26,185)
      +b(1322,y+66,`${item.stars == null ? '—' : f(item.stars,2)} ★`,30,'#edcd91')+t(1322,y+99,`NM ${f(m.difficulty_rating,2)} ★`,18,'#bfc7d4')
      +t(1322,y+129,`${f(m.bpm)} BPM · ${duration(m.total_length)}`,16,'#bfc7d4')
      +b(1530,y+66,item.ownPp == null ? 'No BP' : `${f(item.ownPp,1)} pp`,27,'#fff')
      +t(1530,y+99,item.ownAccuracy == null ? 'For these Mods' : `${f(item.ownAccuracy,2)}% ACC`,17,'#bfc7d4')
      +t(1530,y+129,item.accuracy == null ? '' : `Target ${f(item.accuracy,2)}%`,16,'#90d9c5')
      +b(1828,y+66,`+${f(item.gain,2)} pp`,30,'#ed9fc0',end)+t(1828,y+99,`Target ${f(item.pp,1)} pp`,17,'#bfc7d4',end);
  });
  out+=t(64,height-90,'Source: Mania Tracker · Gains estimate account PP after weighting; individual gains are not additive.',18,'#c7d6ed');
  return {out,height};
}

function pie(items,cx,cy,r){
  if(!items?.length)return empty(cx-r,cy-r,r*2,r*2);
  const sum=items.reduce((n,v)=>n+v.count,0)||1;let angle=-Math.PI/2;
  return items.map((v,i)=>{const endAngle=angle+v.count/sum*Math.PI*2,p1=[cx+Math.cos(angle)*r,cy+Math.sin(angle)*r],p2=[cx+Math.cos(endAngle)*r,cy+Math.sin(endAngle)*r];const out=`<path d="M${cx} ${cy} L${p1.join(' ')} A${r} ${r} 0 ${endAngle-angle>Math.PI?1:0} 1 ${p2.join(' ')} Z" fill="${['#8fb9ff','#90d9c5','#edcd91','#b59be4'][i%4]}" fill-opacity=".85"/>`;angle=endAngle;return out;}).join('')+`<circle cx="${cx}" cy="${cy}" r="${r*.62}" fill="#1c2030" fill-opacity=".85"/>`;
}
function mapper(r){
  const m=r.mapping;let out=top(r,'Mapper')+b(64,232,'Mapping overview',53)+t(64,276,'Genre, activity and difficulty at a glance.',26,'#c2cad8');
  [['Ranked',m.ranked],['Pending',m.pending],['Followers',m.followers],['Plays',m.plays]].forEach(([name,v],i)=>{out+=metric(64+i*456,312,424,131,name.toUpperCase(),f(v));});
  out+=glass(64,471,574,302)+label(92,513,'GENRE')+pie(m.genres,210,632,90)
    +glass(666,471,574,302)+label(694,513,'LANGUAGE')+pie(m.languages,812,632,90)
    +glass(1268,471,588,302)+label(1296,513,'DIFFICULTY DISTRIBUTION')+bars(m.difficulties,1296,550,532,178)
    +glass(64,801,876,300)+label(92,843,'POPULAR BEATMAPS')
    +glass(968,801,888,300)+label(996,843,'RECENT ACTIVITY');
  [m.genres,m.languages].forEach((items,col)=>items.forEach((v,i)=>{out+=t(342+col*602,567+i*43,`${v.label} · ${v.count}`,22,'#d2dbea');}));
  m.maps.slice(0,3).forEach((v,i)=>{out+=row(v,i,92,864+i*72,820,r.assets);});
  m.activities.slice(0,3).forEach((v,i)=>{out+=b(996,890+i*70,cut(v,52),27)+t(996,919+i*70,'Demo activity',19,'#b5bfcd');});
  return out;
}
function map(r){
  const m=r.map,set=m.beatmapset||{},id=r.assets?.cover?'cover':'art';let out=top(r,'Beatmap')
    +image(id,64,194,588,494,false,24,r.assets)+b(700,262,cut(set.title,36),49)+t(700,304,cut(set.artist,44),28,'#c8d1df')+t(700,350,cut(m.version,54),25,'#c8d1df');
  [['Stars',`${f(m.difficulty_rating,2)} ★`],['Key / Mode',`${m.cs}K / ${m.mode}`],['BPM',f(m.bpm)],['Length',duration(m.total_length)]].forEach(([name,v],i)=>{out+=metric(700+i%2*594,387+Math.floor(i/2)*155,562,130,name.toUpperCase(),v,'',i===0?'#edcd91':'#fff');});
  const holds=m.count_sliders??m.analysis?.longNotes;
  const objects=m.count_circles!=null&&holds!=null?m.count_circles+holds:m.analysis?.notes;
  const singles=m.count_circles??(objects!=null&&holds!=null?objects-holds:null);
  [['OD',f(m.accuracy,1)],['HP',f(m.drain,1)],['AR',f(m.ar,1)],['NOTES',f(singles)],['HOLD NOTES',f(holds)],['LN RATIO',objects>0?pct(holds/objects):'—']].forEach(([name,v],i)=>{
    out+=metric(64+i*304,720,272,130,name,v,'',i===5?'#90d9c5':'#fff');
  });
  const genres={1:'Unspecified',2:'Video game',3:'Anime',4:'Rock',5:'Pop',6:'Other',7:'Novelty',9:'Hip hop',10:'Electronic',11:'Metal',12:'Classical',13:'Folk',14:'Jazz'};
  const languages={1:'Other',2:'English',3:'Japanese',4:'Chinese',5:'Instrumental',6:'Korean',7:'French',8:'German',9:'Swedish',10:'Spanish',11:'Italian',12:'Russian',13:'Polish',14:'Unspecified'};
  const mapper=(m.owners||[]).map(owner=>owner.username).filter(Boolean).join(' / ')||set.creator||'—';
  out+=glass(64,878,1000,264)+label(92,918,'MAP INFORMATION')
    +t(92,957,cut(`Host: ${set.creator||'—'} · Mapper: ${mapper}`,76),23,'#fff')
    +t(92,992,`Genre: ${genres[set.genre_id]||'—'} · Language: ${languages[set.language_id]||'—'}`,22,'#c8d1df')
    +t(92,1027,cut(`Source: ${set.source||'—'}`,74),22,'#c8d1df')
    +t(92,1062,`Status: ${m.status||'—'} · BID ${m.id} · SID ${set.id||m.beatmapset_id||'—'}`,22,'#c8d1df');
  const tagText=`Tags: ${set.tags||'—'}`,tagLines=[];
  let remaining=tagText;
  while(remaining&&tagLines.length<3){
    const limit=remaining.length>90?remaining.lastIndexOf(' ',90):remaining.length;
    const length=limit>0?limit:90;
    tagLines.push(tagLines.length===2?cut(remaining,90):remaining.slice(0,length));
    remaining=remaining.slice(length).trimStart();
  }
  tagLines.forEach((line,i)=>{out+=t(92,1090+i*21,line,18,'#bfcada');});
  const fail=m.failtimes?.fail,exit=m.failtimes?.exit;
  const sum=a=>a?.reduce((total,v)=>total+v,0);
  const failed=sum(fail),quit=sum(exit),passed=m.passcount;
  const sample=passed!=null&&failed!=null&&quit!=null?passed+failed+quit:0;
  out+=glass(1092,878,764,264)+label(1120,918,'PLAY OUTCOMES')
    +t(1828,918,`${f(m.playcount)} plays · ${f(passed)} clears`,19,'#bfcada',end);
  [['Pass',passed,'#90d9c5'],['Fail / retry',failed,'#edcd91'],['Quit',quit,'#ee93b1']].forEach(([name,count,color],i)=>{
    const x=1120+i*244;
    out+=t(x,960,name,20,'#c8d1df')+b(x,996,sample?pct(count/sample):'—',28,color)+track(x,1012,214,sample?count/sample:0,color,7);
  });
  if(fail?.length&&exit?.length){
    const values=fail.map((n,i)=>n+(exit[i]||0)),maximum=Math.max(...values,1),step=708/values.length;
    values.forEach((n,i)=>{
      const h=n/maximum*53,fh=fail[i]/maximum*53;
      out+=`<rect x="${1120+i*step}" y="${1097-h}" width="${Math.max(1,step-1)}" height="${h}" fill="#ee93b1"/><rect x="${1120+i*step}" y="${1097-fh}" width="${Math.max(1,step-1)}" height="${fh}" fill="#edcd91"/>`;
    });
  }
  out+=t(1120,1124,'Share of clears + recorded fails / exits · timeline',17,'#bfcada');
  out+=glass(64,1170,1792,252)+label(92,1212,'NOTE DENSITY')
    +t(1828,1212,`Active ${duration(m.hit_length)} / total ${duration(m.total_length)} · ${f(objects)} objects`,22,'#bfcada',end)
    +chart(m.density,92,1238,1736,158,'#90d9c5');
  (m.performance||[100,99,98,96].map(accuracy=>({accuracy,pp:null}))).forEach(({accuracy,pp},i)=>{
    out+=metric(64+i*456,1450,424,130,`${accuracy}% · PP ESTIMATE`,pp==null?'—':`${f(pp)} pp`,'NM · zero misses · rosu-pp','#edcd91');
  });
  return out;
}

function help(r){
  const extra=Math.max(0,Math.max(r.players.length,r.maps.length)-4)*88;
  const notesHeight=Math.max(260,131+Math.max(0,r.notes.length-1)*43),algorithms=r.algorithms||[];
  const algorithmHeight=algorithms.length?100+algorithms.length*43:0;
  const dan=r.dan||[],danHeight=dan.length?100+dan.length*43:0;
  const height=1400+extra+notesHeight-260+(algorithms.length?algorithmHeight+28:0)+(dan.length?danHeight+28:0);
  let out=label(64,50,'MANIA / COMMAND GUIDE')+t(1856,50,r.demo?'DEMO MODE':'osu!mania · QQ',18,'#bac4d4',end)
    +b(64,130,'osu!mania 命令指南',52)+t(64,174,'查玩家、查成绩、查谱面，一张图快速上手。',25,'#c7d6ed')
    +glass(64,210,1792,138,.55)+label(92,248,'QUICK START');
  const prefix=r.commandPrefix||'!';
  [['01','绑定自己',`${prefix}bind 你的玩家名`],['02','查最近成绩',`${prefix}p`],['03','直接查其他玩家',`${prefix}i 玩家名 / ID`]].forEach(([number,name,command],i)=>{
    const x=92+i*590;
    out+=b(x,297,number,36,'#90d9c5')+t(x+65,286,name,23,'#c7d6ed')+b(x+65,321,command,29);
  });
  const group=(x,title,rows)=>{
    let content=glass(x,376,880,432+extra,.55)+b(x+28,421,title,29);
    rows.forEach(([command,description],i)=>{
      const y=467+i*88;
      content+=b(x+28,y,command,27,'#a8c8fa')+t(x+28,y+33,description,22,'#d0d7e3');
      if(i<rows.length-1)content+=thin(x+28,y+50,824);
    });
    return content;
  };
  out+=group(64,'玩家与成绩',r.players)+group(976,'谱面与分析',r.maps);
  const danY=836+extra;
  if(dan.length){
    out+=glass(64,danY,1792,danHeight,.55)+b(92,danY+43,'dan 使用说明与可调参数',29);
    dan.forEach((note,i)=>{out+=t(92,danY+88+i*43,'•  '+note,23,'#d0d7e3');});
  }
  const danOffset=dan.length?danHeight+28:0;
  const bindingY=836+extra+danOffset,notesY=1044+extra+danOffset;
  out+=glass(64,bindingY,1792,180,.55)+b(92,bindingY+43,'自己的绑定',29)
    +t(1828,bindingY+43,'每个群友独立保存，互不影响。',22,'#c7d6ed',end);
  r.bindings.forEach(([command,description],i)=>{
    const x=92+i*590;
    out+=b(x,bindingY+95,command,28,'#a8c8fa')+t(x,bindingY+136,description,23,'#d0d7e3');
  });
  out+=glass(64,notesY,1792,notesHeight,.55)+b(92,notesY+43,'使用说明',29)
    +t(1828,notesY+43,`例：${prefix}m 5688756     ${prefix}a 5688756 1.5`,22,'#90d9c5',end);
  r.notes.forEach((note,i)=>{out+=t(92,notesY+88+i*43,`•  ${note}`,23,'#d0d7e3');});
  if(algorithms.length){
    const algorithmY=notesY+notesHeight+28;
    out+=glass(64,algorithmY,1792,algorithmHeight,.55)+b(92,algorithmY+43,'算法与数据说明',29);
    algorithms.forEach((note,i)=>{out+=t(92,algorithmY+88+i*43,`•  ${note}`,23,'#d0d7e3');});
  }
  return {out,height};
}

export function glassSvg(r){
  let height=1200,out;
  if(r.kind==='timebest'){const result=timebest(r);height=result.height;out=result.out;}
  else if(r.kind==='recommend'){const result=recommend(r);height=result.height;out=result.out;}
  else if(r.kind==='help'){const result=help(r);height=result.height;out=result.out;}else if(r.kind==='analysis'){height=1640;out=analysis(r);}else if(r.kind==='score'){height=1102;out=score(r);}else if(r.kind==='profile')out=profile(r);else if(r.kind==='scores'){const result=scores(r);height=result.height;out=result.out;}else if(r.kind==='mapper')out=mapper(r);else if(r.kind==='map'){height=1670;out=map(r);}else throw new Error('Unsupported card');
  const images=Object.entries(r.assets||{}).map(([id,asset])=>`<image id="${e(id)}" width="${asset.width||(id==='avatar'?256:1920)}" height="${asset.height||(id==='avatar'?256:1080)}" href="${e(asset.data||asset)}"/>`).join('');
  const background=r.assets?.cover&&['score','analysis','map'].includes(r.kind)?'cover':'art';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="${height}" viewBox="0 0 1920 ${height}"><defs>${images}
    <linearGradient id="accent"><stop stop-color="#8fb9ff"/><stop offset="1" stop-color="#90d9c5"/></linearGradient>
    <linearGradient id="baseStars"><stop stop-color="#80ddc8"/><stop offset="1" stop-color="#ffd080"/></linearGradient>
    <linearGradient id="modStars"><stop stop-color="#81b7ff"/><stop offset="1" stop-color="#fa8ebe"/></linearGradient>
    <linearGradient id="clientStable"><stop stop-color="#51c9ee"/><stop offset="1" stop-color="#6683cf"/></linearGradient>
    <linearGradient id="clientLazer"><stop stop-color="#ff493b"/><stop offset="1" stop-color="#ffbd22"/></linearGradient>
    ${Object.entries({Gold:['#fff176','#ffc857'],Silver:['#ffffff','#aebdce'],Green:['#57f0c3','#25cf7b'],Blue:['#4fd4ff','#4684ff'],Purple:['#b296ff','#a755ec'],Red:['#ff9494','#e85982'],Gray:['#d0d3da','#8b929f']}).map(([name,colors])=>`<linearGradient id="grade${name}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient>`).join('')}
    <linearGradient id="shade" x2="1" y2="1"><stop stop-color="#090e19" stop-opacity=".64"/><stop offset=".6" stop-color="#131726" stop-opacity=".39"/><stop offset="1" stop-color="#080e1c" stop-opacity=".75"/></linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="3"/></filter>
    <clipPath id="canvas"><rect width="1920" height="${height}" rx="28"/></clipPath></defs>
    <g clip-path="url(#canvas)"><rect width="1920" height="${height}" fill="#111723"/><g filter="url(#soft)">${image(background,0,0,1920,height,false,0,r.assets,'slice')}</g><rect width="1920" height="${height}" fill="url(#shade)"/>
    <g font-family="Noto Sans SC, Segoe UI, Microsoft YaHei, sans-serif">${out}${stamp(r,height)}</g></g></svg>`;
}
