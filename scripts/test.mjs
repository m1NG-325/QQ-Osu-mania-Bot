import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=(await readdir(new URL('../test/',import.meta.url))).filter(file=>file.endsWith('.test.js')).map(file=>fileURLToPath(new URL(`../test/${file}`,import.meta.url)));
const child=spawn(process.execPath,['--test','--test-concurrency=1',...files],{cwd:root,stdio:'inherit',windowsHide:true});
child.on('error',()=>{process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
