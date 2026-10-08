import { parentPort,workerData } from 'node:worker_threads';
import { OsuFileParser } from '../vendor/mania-analyser/js/parser/osuFileParser.js';
import { runMixedEstimatorFromText,applyCompanellaToMixedResult } from '../vendor/mania-analyser/js/estimator/mixedEstimator.js';
import { runSunnyEstimatorFromText } from '../vendor/mania-analyser/js/estimator/sunnyEstimator.js';
import { classifyCompanellaDifficulty } from '../vendor/mania-analyser/js/estimator/companellaEstimator.js';
import { rcLabelToNumeric } from '../vendor/mania-analyser/js/estimator/rcDifficultyFormat.js';
import { analyzeEtternaFromText } from '../vendor/mania-analyser/js/ett/index.js';
import { calculateInterludeStar } from '../vendor/mania-analyser/js/interlude/index.js';
import { sevenRiceVerdict,sevenLnVerdict } from './dan-ladders.js';
import { sevenRiceExclusion } from './seven-rice-gates.js';
import { fourLnChart } from './four-ln.js';

try{
  const {raw,rate,odFlag,starRating}=workerData,parser=new OsuFileParser(raw);parser.process();
  const p=parser.getParsedData();
  if(parser.status!=='OK'||parser.gameMode!=='3'||![4,7].includes(p.columnCount))throw Error('Native 4K/7K charts only');
  if(!p.noteStarts.length||p.noteStarts.length>50000||p.noteStarts.some(t=>!Number.isFinite(t)||t<0||t>7200000))throw Error('Invalid note data');
  if(p.columnCount===7){
    const isLn=p.noteTypes.filter(t=>(t&128)!==0).length/p.noteStarts.length>=.375;
    const reason=sevenRiceExclusion(p,rate,{allowLn:isLn});
    if(reason){parentPort.postMessage({result:{keys:7,rate,excluded:true,reason}});}
    else{
      const sunny=runSunnyEstimatorFromText(raw,{speedRate:rate},parser);
      const parts=String(sunny.estDiff).split('||');
      const chart=isLn?sevenLnVerdict(parts.at(-1)):sevenRiceVerdict(parts[0].trim());
      if(chart==null)parentPort.postMessage({result:{keys:7,rate,excluded:true,reason:'Outside 7K ladder'}});
      else parentPort.postMessage({result:{chart:Math.max(0,Math.round(chart*100)/100),keys:7,rate,side:isLn?'LN':'Rice',source:isLn?'Sunny 7K LN table':'Sunny 7K table',primary:null,reason:null}});
    }
  }else{
  const lnRatio=p.noteTypes.filter(t=>(t&128)!==0).length/p.noteStarts.length;
  const heads=new Map();let stacked=false;
  p.noteStarts.forEach((t,i)=>{const key=`${p.columns[i]}:${t}`,n=(heads.get(key)||0)+1;heads.set(key,n);if(n>=8)stacked=true;});
  const span=(Math.max(...p.noteStarts)-Math.min(...p.noteStarts))/1000;
  async function estimate(at){
    const msd=await analyzeEtternaFromText(raw,{musicRate:at,scoreGoal:.93,etternaVersion:'0.74.0'});
    if(!msd||msd.junkFile)throw Error('MSD unavailable');
    let mixed=runMixedEstimatorFromText(raw,{speedRate:at,enableAnalyzeLN:true,
      ...(span>300?{marathonCorrection:{durationS:span,ettValues:msd.values}}:{})},parser);
    const floorPinned=mixed.numericDifficultyHint==='roxy-meta-ridge-v3'&&Number.isFinite(Number(mixed.rawNumericDifficulty))&&Number(mixed.rawNumericDifficulty)<=-2.45;
    const lowEndSuspect=mixed.numericDifficultyHint==='azusa-rc-v1'&&mixed.numericDifficulty>=2&&Number.isFinite(mixed.debug?.sunnyNumeric)&&mixed.debug.sunnyNumeric<6.84;
    if(floorPinned||lowEndSuspect){
      const sunny=runSunnyEstimatorFromText(raw,{speedRate:at},parser);
      if(sunny.star<3)mixed={...sunny,actualEstimatorAlgorithm:'Sunny'};
    }
    const usedComp=!!mixed.mixedCompanellaPlan;
    if(usedComp){
      const comp=await classifyCompanellaDifficulty({msdValues:msd.values,
        interludeStar:await calculateInterludeStar(raw,at),sunnyStar:runSunnyEstimatorFromText(raw,{speedRate:at},parser).star});
      mixed=applyCompanellaToMixedResult(mixed,comp);
    }
    const text=String(mixed.estDiff).split('||')[0].trim();
    if(/Invalid|Unknown|^[<>]/.test(text))throw Error('Outside estimator range');
    let chart=Number.isFinite(mixed.numericDifficulty)?mixed.numericDifficulty:rcLabelToNumeric(text);
    if(mixed.actualEstimatorAlgorithm==='Daniel'&&Number.isFinite(mixed.numericDifficulty))chart-=.5;
    if(!Number.isFinite(chart))throw Error('No numeric estimate');
    const values=msd.values,primary=Object.entries({Jack:Math.max(values.JackSpeed,values.Chordjack),
      Speed:Math.max(values.Stream,values.Jumpstream,values.Handstream),Tech:values.Technical,Stamina:values.Stamina}).sort((a,b)=>b[1]-a[1])[0][0];
    return {chart,primary,usedComp,source:mixed.companellaCapsule||mixed.actualEstimatorAlgorithm||'Mixed'};
  }
  // LN identity uses native 0.72.3 Overall for its rating tiebreak; Companella
  // keeps the independent 0.74.0 input used by the existing RC branch.
  const identityMsd=lnRatio>=.45?await analyzeEtternaFromText(raw,{musicRate:rate,scoreGoal:.93,etternaVersion:'0.72.3'}):null;
  const ln=lnRatio>=.45?fourLnChart(raw,{rate,odFlag,starRating,overall:identityMsd?.junkFile?null:identityMsd?.values?.Overall},parser):null;
  if(ln){
    parentPort.postMessage({result:{...ln,reason:stacked?'Stacked note heads':ln.reason}});
  }else{
  const estimateAtRate=await estimate(rate);
  if(estimateAtRate.usedComp){
    for(const step of [.05,.1]){
      const lower=Math.round((rate-step)*100)/100;
      if(lower<.5)continue;
      const floor=await estimate(lower);
      if(floor.usedComp)estimateAtRate.chart=Math.max(estimateAtRate.chart,floor.chart);
    }
  }
  parentPort.postMessage({result:{...estimateAtRate,chart:Math.max(.5,Math.round(estimateAtRate.chart*100)/100),
    keys:4,rate,side:'Rice',reason:stacked?'Stacked note heads':null}});
  }
  }
}catch(error){parentPort.postMessage({error:error.message});}
