import {resolve} from 'node:path';
import {OsuApi} from '../src/osu.js';
import {MapIndex,filters} from '../src/map-index.js';
const api=new OsuApi({clientId:process.env.OSU_CLIENT_ID,clientSecret:process.env.OSU_CLIENT_SECRET});
const index=await new MapIndex(resolve('data/map-index.json')).load();
for(const query of ['4k 5-6星','4k 6-7星','7k 5-6星']){
  await index.ensure(api,filters(query));
  console.log(query, 'indexed:',index.rows.size);
}
console.log('patterns:',Object.fromEntries(['Jack','Stream','Tech','JHS'].map(k=>[k,[...index.rows.values()].filter(r=>r.patterns[k]>=.15).length])));
