import {modIcons} from './mod-icons.js';
import {scoreClient} from './time-best.js';
const fit=(s,width)=>{let used=0,out='';for(const c of s){used+=/[^\u0000-\u00ff]/.test(c)?23:13;if(used>width)return out+'…';out+=c;}return out;};
const modSettings=s=>(s.mods||[]).filter(m=>typeof m==='object').flatMap(m=>Object.entries(m.settings||{}).map(([k,v])=>k==='speed_change'?v+'×':k==='adjust_pitch'?'Pitch '+(v?'ON':'OFF'):k+': '+v)).join(' · ');
const e=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const text=(x,y,s,size=24,color='#e9f0ff')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${e(s)}</text>`;
export function featureSvg(r){
  const rows=r.rows,columns=r.columns,own=r.variant==='map-scores',board=r.variant==='group-board',width=own?1440:1920,contentWidth=width-128,cell=contentWidth/columns.length,rowHeight=own?72:board?60:86,height=340+Math.max(1,rows.length)*rowHeight+(r.notes?.length||0)*35+(r.links?.length||0)*30;
  const translucent=['random-map','practice-map','mapset'].includes(r.variant);
  const widths=own?[60,140,...Array(5).fill((contentWidth-200)/5)]:board?[70,...Array(4).fill((contentWidth-70)/4)]:columns.map(()=>cell),positions=widths.map((_,i)=>86+widths.slice(0,i).reduce((a,b)=>a+b,0));
  let out=text(64,54,'MANIA / '+r.title,21,'#91b7ff')+text(64,126,r.title,43)+text(64,175,String(r.subtitle||'').slice(0,104),24,'#b4c4dd');
  columns.forEach((c,i)=>out+=text(positions[i],234,c,23,'#91dccb'));
  if(!rows.length)out+=text(86,308,'没有可显示的成绩。',26);
  rows.forEach((row,i)=>{const y=254+i*rowHeight;out+=`<rect x="64" y="${y}" width="${contentWidth}" height="${rowHeight-9}" rx="16" fill="${own||board?'#101b2d':'#223049'}" fill-opacity="${translucent?0.64:own||board?0.78:1}"/>`;row.forEach((value,j)=>{if(board&&j===1){
    const user=r.entries[i].user,avatar=r.assets?.['player'+user.id],xx=positions[1],yy=y+6;
    out+='<defs><clipPath id="player-clip-'+i+'"><rect x="'+xx+'" y="'+yy+'" width="40" height="40" rx="20"/></clipPath></defs>';
    out+=avatar?'<image x="'+xx+'" y="'+yy+'" width="40" height="40" href="'+e(avatar.data)+'" clip-path="url(#player-clip-'+i+')"/>':'<circle cx="'+(xx+20)+'" cy="'+(yy+20)+'" r="20" fill="#364c6c"/>'+text(xx+12,yy+27,user.username?.[0]||'?',22);
    String(value).split('\n').slice(0,2).forEach((line,k,lines)=>out+=text(xx+54,y+(lines.length===1?34:21)+k*23,fit(line,widths[1]-86),k?18:23,k?'#aebfd9':'#f0f4ff'));return;
  }if(j===(own?1:0)&&r.scores?.[i]){const s=r.scores[i];out+=own?modIcons({...s,mods:(s.mods||[]).map(m=>typeof m==='string'?m:{acronym:m.acronym})},positions[1],y+18,28,widths[1]-20)+(modSettings(s)?text(positions[1],y+58,modSettings(s).slice(0,20),11,'#aebfd9'):'')+(s.passed===false?text(positions[1],y+58,'未通过',14,'#ed91a6'):''):modIcons(s,86,y+8,28,cell-44)+text(86,y+63,scoreClient(s)+(s.passed===false?' · 未通过':''),21,'#aebfd9');return;}String(value??'—').split('\n').slice(0,2).forEach((line,k)=>out+=text(positions[j],y+(own?40:board?34:31)+k*28,fit(line,widths[j]-((own||board)&&j===0?24:64)),23,k?'#aebfd9':'#f0f4ff'));});});
  const bottom=280+Math.max(1,rows.length)*rowHeight;
  (r.notes||[]).forEach((s,i)=>out+=text(64,bottom+i*35,s,21,'#e7c88b'));
  (r.links||[]).forEach((s,i)=>out+=text(64,bottom+(r.notes?.length||0)*35+i*30,s,20,'#91b7ff'));
  if(r.demo)out+=text(width-460,height-22,'DEMO · SIMULATED DATA',18,'#e7c88b');
  const background=r.assets?.cover;
  const art=background?`<defs><clipPath id="feature-clip"><rect width="${width}" height="${height}" rx="26"/></clipPath><filter id="feature-blur"><feGaussianBlur stdDeviation="3"/></filter></defs><g clip-path="url(#feature-clip)"><image width="${width}" height="${height}" href="${e(background.data)}" preserveAspectRatio="xMidYMid slice" filter="url(#feature-blur)"/><rect width="${width}" height="${height}" fill="#091320" fill-opacity=".64"/></g>`:'';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="26" fill="#111a2a"/>${art}<g font-family="Segoe UI, Microsoft YaHei, sans-serif">${out}</g></svg>`;
}
