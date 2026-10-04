import { readFileSync } from 'node:fs';

const metadata = JSON.parse(readFileSync(new URL('../assets/mods/metadata.json', import.meta.url), 'utf8'));
const colours = { System:'#ffcc22', DifficultyReduction:'#b3ff66', DifficultyIncrease:'#ff6666', Conversion:'#8c66ff', Automation:'#66ccff', Fun:'#ff66ab' };
const shape = readFileSync(new URL('../assets/mods/shape.svg', import.meta.url), 'utf8');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const data = svg => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const tint = (svg, colour) => svg.replace(/(fill|stroke)="(?!none)[^"]*"/g, (_, attribute) => `${attribute}="${colour}"`);
const icons = new Map();
for (const [acronym, info] of Object.entries({...metadata, NM:{name:'No Mod',type:'System'}})) {
  let glyph;
  try { glyph = readFileSync(new URL(`../assets/mods/${acronym}.svg`, import.meta.url), 'utf8'); }
  catch (error) { if(error.code==='ENOENT') continue; throw error; }
  const colour = colours[info.type] || colours.System;
  // The website uses a linear-sRGB blend of 10% category colour with black.
  const linear = value => value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4;
  const srgb = value => value <= .0031308 ? value*12.92 : 1.055*value**(1/2.4)-.055;
  const foreground = '#'+[1,3,5].map(i=>Math.round(srgb(linear(parseInt(colour.slice(i,i+2),16)/255)*.1)*255).toString(16).padStart(2,'0')).join('');
  icons.set(acronym, data(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="84" viewBox="0 0 120 84"><image width="120" height="84" href="${data(tint(shape,colour))}"/><image width="120" height="84" href="${data(tint(glyph,foreground))}"/></svg>`));
}

export function modIcons(score, x, y, height=28, maxWidth=500, align='start') {
  const mods = score.mods?.length ? score.mods : ['NM'];
  const entries = mods.map(mod => {
    const acronym = typeof mod==='string' ? mod : mod.acronym;
    const settings = typeof mod==='object' ? mod.settings||{} : {};
    const details = Object.entries(settings).filter(([,value])=>value!=null).map(([key,value])=>key==='speed_change'?`${value}×`:`${metadata[acronym]?.setting_labels?.[key]||key}: ${value}`).join(', ');
    const width = height*10/7;
    const caption = icons.has(acronym) ? details : [acronym,details].filter(Boolean).join(' ');
    return {acronym,caption,width:width+(caption?caption.length*height*.32+height*.25:0)};
  });
  const total = entries.reduce((sum,entry)=>sum+entry.width+height*.15,0)-height*.15;
  const scale = Math.min(1,maxWidth/Math.max(1,total));
  let cursor=0;
  const out = entries.map(({acronym,caption,width})=>{
    const title=[acronym,caption].filter(Boolean).join(' ');
    const icon=icons.get(acronym);
    const result=`<g aria-label="${escape(title)}"><title>${escape(metadata[acronym]?.name||acronym)}${caption?' · '+escape(caption):''}</title>${icon?`<image x="${cursor}" width="${height*10/7}" height="${height}" href="${icon}"/>`:''}${caption?`<text x="${cursor+(icon?height*10/7+height*.25:0)}" y="${height*.76}" font-size="${height*.65}" fill="#cad5e7">${escape(caption)}</text>`:''}</g>`;
    cursor+=width+height*.15;
    return result;
  }).join('');
  const left=align==='center'?x-total*scale/2:x+(align==='end'?maxWidth-total*scale:0);
  const top=y+height*(1-scale)/2;
  return `<g transform="translate(${left} ${top}) scale(${scale})">${out}</g>`;
}
