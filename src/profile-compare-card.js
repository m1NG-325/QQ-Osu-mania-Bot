const e=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const text=(x,y,s,size=24,color='#f4f7ff',center=false)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}"${center?' dominant-baseline="central"':''}>${e(s)}</text>`;
const colors=['#8fbaff','#91dfcc','#e8bbec','#efd190'];
export function profileCompareSvg(r){
  const n=r.users.length,two=n===2,cell=(1792-300-(two?270:0))/n,origin=364,height=430+r.rows.length*78;
  let out=text(64,52,'MANIA / PLAYER COMPARISON',20,'#b7c8e3')+text(64,118,'玩家资料对比',44)+text(64,153,'osu!mania · 官方资料与当前 BP 样本',23,'#b7c8e3');
  r.users.forEach((u,i)=>{
    const x=origin+i*cell,c=colors[i],avatar=r.assets?.['player'+u.id];
    out+=`<rect x="${x}" y="182" width="${cell-16}" height="122" rx="20" fill="#122138" fill-opacity=".78" stroke="${c}" stroke-opacity=".45"/>`;
    out+=`<defs><clipPath id="compare-avatar-${i}"><circle cx="${x+56}" cy="243" r="34"/></clipPath></defs>`;
    out+=avatar?`<image x="${x+22}" y="209" width="68" height="68" href="${e(avatar.data)}" clip-path="url(#compare-avatar-${i})"/>`:`<circle cx="${x+56}" cy="243" r="34" fill="${c}" fill-opacity=".25"/>`;
    out+=text(x+108,231,u.username,n>2?22:28,c)+text(x+108,266,`${u.country_code||'—'} · ID ${u.id}`,18,'#b7c8e3');
  });
  out+=text(86,343,'指标',23,'#b7c8e3');
  if(two)out+=text(origin+cell*n+16,343,'差值（右 − 左）',22,'#b7c8e3');
  r.rows.forEach((row,j)=>{
    const y=364+j*78,m=r.comparisons[j],values=m.values.filter(Number.isFinite),comparable=m.comparable&&values.length===n;
    const target=comparable&&m.better?(m.better==='low'?Math.min(...values):Math.max(...values)):null;
    const tie=values.length>1&&values.every(v=>v===values[0]);
    out+=`<rect x="64" y="${y}" width="1792" height="68" rx="16" fill="#111e32" fill-opacity=".76"/>`+text(86,y+34,row[0],22,'#c9d4e5',true);
    r.users.forEach((u,i)=>{
      const x=origin+i*cell,value=m.values[i],lead=!tie&&target!=null&&value===target,c=colors[i];
      if(lead)out+=`<rect x="${x}" y="${y+4}" width="${cell-16}" height="60" rx="12" fill="${c}" fill-opacity=".12"/>`;
      out+=text(x+20,y+34,row[i+1],25,lead?c:'#f4f7ff',!(m.bar&&Number.isFinite(value)));
      if(m.bar&&Number.isFinite(value)){
        const maximum=j===3?100:Math.max(1,...values),w=cell-52;
        out+=`<rect x="${x+20}" y="${y+49}" width="${w}" height="6" rx="3" fill="#ffffff" fill-opacity=".12"/><rect x="${x+20}" y="${y+49}" width="${w*Math.max(0,Math.min(1,value/maximum))}" height="6" rx="3" fill="${c}"/>`;
      }
    });
    if(two){
      const delta=comparable?m.values[1]-m.values[0]:null,display=delta==null?(j===2&&!m.comparable?'不同地区':'—'):`${delta>0?'+':delta<0?'−':''}${Math.abs(delta).toLocaleString('en-US',{maximumFractionDigits:m.unit==='pp'||m.unit==='百分点'?2:0})}${m.unit==='百分点'?'%':' '+m.unit}`;
      out+=text(origin+cell*n+16,y+34,display,22,'#edd292',true);
    }
  });
  out+=text(64,height-35,'高亮表示该项领先；PP 条以本行最大值为满格，准确率条为 0–100%。',20,'#c4d1e5');
  out+=text(64,height-9,'地区排名仅对比同一地区；BP 使用当前前 100 条实际样本，样本不足时按实际数量统计。',18,'#b7c8e3');
  if(r.demo)out+=text(1440,height-8,'DEMO · SIMULATED DATA',16,'#edd292');
  const art=r.assets?.art;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="${height}"><defs><clipPath id="compare-clip"><rect width="1920" height="${height}" rx="26"/></clipPath></defs><g clip-path="url(#compare-clip)"><rect width="1920" height="${height}" fill="#111a2a"/>${art?`<image width="1920" height="${height}" href="${e(art.data)}" preserveAspectRatio="xMidYMid slice"/><rect width="1920" height="${height}" fill="#0d192c" fill-opacity=".6"/>`:''}<g font-family="Noto Sans SC, Segoe UI, Microsoft YaHei, sans-serif">${out}</g></g></svg>`;
}
