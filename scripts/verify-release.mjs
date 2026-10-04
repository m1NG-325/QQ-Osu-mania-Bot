import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,relative} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const ignored=new Set(['.git','node_modules','data','output','.npm-cache','backups','__pycache__']);
const folders=new Set(['src','test','scripts','public','vendor','assets','.github']);
const rootFiles=new Set(['.gitattributes','.gitignore','.env.example','package.json','package-lock.json','README.md','README.en.md','USAGE.md','LICENSE','THIRD_PARTY_NOTICES.md','RELEASE_NOTES.md','RELEASE_MANIFEST.json','start.ps1','start-napcat.bat']);
const files=[],excluded=[];
async function walk(dir){
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name),name=relative(root,path).replaceAll('\\','/');
    if(entry.isSymbolicLink())throw new Error('Unexpected symlink: '+name);
    if(ignored.has(entry.name)||entry.name.startsWith('candidate-')||entry.name.startsWith('.env')&&name!=='.env.example'||name.startsWith('test/fixtures/private')||/\.(log|bak\d*)$/.test(entry.name)){excluded.push(name);continue;}
    if(dir===root&&!folders.has(entry.name)&&!rootFiles.has(entry.name))throw new Error('Unexpected root entry: '+name);
    if(entry.isDirectory())await walk(path);else if(name!=='RELEASE_MANIFEST.json'){
      const data=await readFile(path);
      files.push({path:name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
    }
  }
}
await walk(root);files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
const runtimeEntries=excluded.filter(name=>name!=='.git');
if(process.argv.includes('--clean')&&runtimeEntries.length)throw new Error('Clean upload directory contains excluded entries: '+runtimeEntries.join(', '));
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8')),lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
if(pkg.version!==lock.version||pkg.version!==lock.packages[''].version)throw new Error('Package versions differ');
if(pkg.dependencies.fflate!=='0.8.3'||lock.packages['node_modules/fflate'].version!=='0.8.3')throw new Error('Unexpected ZIP dependency version');
if(Object.values(lock.packages).some(p=>p.resolved&&!p.resolved.startsWith('https://registry.npmjs.org/')))throw new Error('Unexpected dependency registry');
for(const required of ['LICENSE','THIRD_PARTY_NOTICES.md','assets/fonts/OFL.txt','assets/mods/LICENCE','vendor/mania-analyser/LICENSE'])if(!files.some(f=>f.path===required))throw new Error('Missing notice: '+required);
const manifest={version:pkg.version,files};
if(process.argv.includes('--write'))await writeFile(join(root,'RELEASE_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
else {
  const expected=JSON.parse(await readFile(join(root,'RELEASE_MANIFEST.json'),'utf8'));
  if(JSON.stringify(expected)!==JSON.stringify(manifest))throw new Error('Release files differ from manifest; inspect changes before using --write');
}
console.log(`Verified ${files.length} publishable files, version ${pkg.version}; ${excluded.length} runtime/private entries excluded.`);
