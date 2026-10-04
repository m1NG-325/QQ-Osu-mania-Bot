import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { glassSvg } from './glass-panels.js';
import { avatarSvg } from './avatar-card.js';
import { UserError } from './osu.js';
import { danScale } from './dan-icons.js';
import { beatmapViewSvg } from './beatmap-view.js';
import { compareSvg, reportSvg } from './review-cards.js';
import {featureSvg} from './feature-card.js';
import {profileCompareSvg} from './profile-compare-card.js';
import {renderLane,timedWork,checkCancelled} from './runtime.js';

// Register bundled fonts with the renderer without installing system fonts.
const { default: sharp } = await import('sharp');
const fontsReady = Promise.all(['Regular', 'Bold'].map(weight => sharp({ text: {
  text: '.', font: `Noto Sans SC ${weight === 'Bold' ? 'Bold' : ''} 12`,
  fontfile: fileURLToPath(new URL('../assets/fonts/NotoSansSC.ttf', import.meta.url)),
  rgba: true
} }).png().toBuffer()));
export const cardSvg = result => {
  if(result.kind==='view')return beatmapViewSvg(result);
  if(result.kind==='compare')return compareSvg(result);
  if(result.kind==='report')return reportSvg(result);
  if(result.kind==='feature')return result.variant==='profile-compare'?profileCompareSvg(result):featureSvg(result);
  return glassSvg(result);
};
const setOf = s => s.beatmapset || s.beatmap?.beatmapset || {};
let profileArtPromise;
const assetCache = new Map();
const danIconCache = new Map();
function danIcon(file){
  if(!danIconCache.has(file))danIconCache.set(file,readFile(new URL(`../assets/dan/${file}`,import.meta.url))
    .then(buffer=>sharp(buffer).trim().resize(96,96,{fit:'inside'}).png().toBuffer({resolveWithObject:true}))
    .then(({data,info})=>({data:`data:image/png;base64,${data.toString('base64')}`,width:info.width,height:info.height})));
  return danIconCache.get(file);
}

async function profileArtwork() {
  profileArtPromise ||= readFile(process.env.PANEL_BACKGROUND_PATH || new URL('../assets/default-background.svg', import.meta.url))
    .then(buffer => prepareImage(buffer));
  return profileArtPromise;
}
async function remoteImage(url, avatar = false) {
  if (!url) return null;
  let parsed; try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:' || !['assets.ppy.sh', 'a.ppy.sh', 'flagcdn.com'].includes(parsed.hostname)) return null;
  const key = `${avatar}:${url}`;
  if (assetCache.has(key)) return assetCache.get(key);
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return null;
    let length = 0; const chunks = [];
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 6 * 1024 * 1024) return null;
      chunks.push(chunk);
    }
    const data = await prepareImage(Buffer.concat(chunks), avatar ? 256 : 1920);
    assetCache.set(key, data);
    if (assetCache.size > 64) assetCache.delete(assetCache.keys().next().value);
    return data;
  } catch { return null; }
}
async function beatmapBackground(set) {
  if (/^[1-9]\d*$/.test(String(set.id))) {
    const full = await remoteImage(`https://assets.ppy.sh/beatmaps/${set.id}/covers/fullsize.jpg`);
    if (full) return full;
  }
  return remoteImage(set.covers?.['cover@2x'] || set.covers?.cover);
}
export async function prepareImage(buffer, size = 1920) {
  const { data, info } = await sharp(buffer).rotate().resize(size, size, {
    fit: 'inside', withoutEnlargement: true
  }).jpeg({ quality: 84 }).toBuffer({ resolveWithObject: true });
  return { data: `data:image/jpeg;base64,${data.toString('base64')}`, width: info.width, height: info.height };
}
export function singleMapCard(result){
  return ['score','map','analysis','view','compare'].includes(result.kind)
    ||result.kind==='feature'&&['map-scores','group-board','random-map','practice-map'].includes(result.variant);
}
export function renderCard(result, {signal}={}) {
  return timedWork(inner => renderLane.run(async () => {
    checkCancelled(inner);const image=await renderCardNow(result);checkCancelled(inner);return image;
  },{signal:inner}),60000,signal);
}
async function renderCardNow(result) {
  await fontsReady;
  if(result.kind==='report')return sharp(Buffer.from(cardSvg({...result,assets:{art:await profileArtwork()}}))).png().toBuffer();
  if(result.kind==='feature'&&!singleMapCard(result)&&result.variant!=='profile-compare'){
    return sharp(Buffer.from(cardSvg({...result,assets:{cover:await profileArtwork()}}))).png().toBuffer();
  }
  if(result.kind==='compare'){
    const set=result.map?.beatmapset||setOf(result.scores?.at(-1)||{});
    const art=(result.demo?null:await beatmapBackground(set))||await profileArtwork();
    return sharp(Buffer.from(cardSvg({...result,assets:{art}}))).png().toBuffer();
  }
  if(result.kind==='feature'&&result.variant==='profile-compare'){
    const assets={art:await profileArtwork()};
    if(!result.demo)await Promise.all(result.users.map(async user=>{
      const avatar=await remoteImage(user.avatar_url,true);
      if(avatar)assets[`player${user.id}`]=avatar;
    }));
    return sharp(Buffer.from(cardSvg({...result,assets}))).png().toBuffer();
  }
  if(result.kind==='feature'&&singleMapCard(result)){
    const cover=result.demo?null:await beatmapBackground(result.map.beatmapset);
    const assets={cover:cover||await profileArtwork()};
    if(result.variant==='group-board'&&!result.demo){
      const users=[...new Map(result.entries.map(item=>[item.user.id,item.user])).values()];
      for(let i=0;i<users.length;i+=4)await Promise.all(users.slice(i,i+4).map(async user=>{
        const avatar=await remoteImage(user.avatar_url||(/^[1-9]\d*$/.test(String(user.id))?`https://a.ppy.sh/${user.id}`:null),true);
        if(avatar)assets[`player${user.id}`]=avatar;
      }));
    }
    return sharp(Buffer.from(cardSvg({...result,assets}))).png().toBuffer();
  }
  if (['compare','report','feature'].includes(result.kind)) return sharp(Buffer.from(cardSvg(result))).png().toBuffer();
  if (result.kind === 'avatar') {
    const assets = {art:await profileArtwork()};
    if (!result.demo) {
      const country = result.user.country_code;
      const [avatar, flag] = await Promise.all([
        remoteImage(result.user.avatar_url),
        /^[A-Z]{2}$/.test(country || '') ? remoteImage(`https://flagcdn.com/w80/${country.toLowerCase()}.png`) : null
      ]);
      if (!avatar) throw new UserError('玩家头像暂时无法获取，请稍后重试。');
      assets.avatar = avatar; if (flag) assets.flag = flag;
    }
    return sharp(Buffer.from(avatarSvg(result.user, assets, result.demo))).png().toBuffer();
  }
  const assets = { art: await profileArtwork() };
  const contribution=result.kind==='score'?result.scores?.[0]?.beatmap?.danContribution:null;
  if(contribution?.credited!=null){
    await Promise.all(danScale(contribution.chart,contribution.keys,contribution.side).levels.map(async ({level,file})=>{
      assets[`dan${level}`]=await danIcon(file);
    }));
  }
  if (!result.demo) {
    const avatar = await remoteImage(result.user?.avatar_url, true);
    if (avatar) assets.avatar = avatar;
    const cover = singleMapCard(result)?await beatmapBackground(result.map?.beatmapset || setOf(result.scores?.[0] || {})):null;
    if (cover) assets.cover = cover;
    const recommended = result.items?.map(item=>({beatmap:item.map,beatmapset:item.map.beatmapset}));
    const groups = [['score', recommended || result.best || result.scores || []], ['recent', result.recent || []]];
    for (const [prefix, scores] of groups) {
      const batch = result.kind === 'timebest' ? 8 : 4;
      for (let offset = 0; offset < scores.length; offset += batch) {
        await Promise.all(scores.slice(offset, offset + batch).map(async (score, i) => {
          const asset = await remoteImage(setOf(score).covers?.cover);
          if (asset) assets[`${prefix}${offset + i}`] = asset;
        }));
      }
    }
  }
  const image = sharp(Buffer.from(cardSvg({ ...result, assets })));
  // Long sheets use JPEG to keep the single QQ upload reasonably small.
  return ['timebest','view'].includes(result.kind)||(result.kind==='scores'&&result.scores.length>16) ? image.jpeg({ quality: 90, mozjpeg: true }).toBuffer() : image.png().toBuffer();
}
