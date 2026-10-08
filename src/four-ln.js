import { parseManiaBeatmap } from '../vendor/mania-tracker-ln/js/chart/beatmap.js';
import { chartIsLn } from '../vendor/mania-tracker-ln/js/dan-estimator/ln-effective.js';
import { resolveChartLnIdentity } from '../vendor/mania-tracker-ln/js/classification/ln-identity.js';
import { extractDanFeatures } from '../vendor/mania-tracker-ln/js/dan-estimator/features.js';
import { estimateLnDan } from '../vendor/mania-tracker-ln/js/dan-estimator/ln.js';
import { detectLnVibro } from '../vendor/mania-tracker-ln/js/vibro/detection.js';
import { runSunnyEstimatorFromText } from '../vendor/mania-analyser/js/estimator/sunnyEstimator.js';

export function fourLnVerdict(text){
  const m=String(text).trim().match(/^(?:([<>])\s+)?LN (\d+) (low|mid\/low|mid|mid\/high|high)$/i);
  if(!m||Number(m[2])<1||Number(m[2])>17)return null;
  return Number(m[2])+(m[1]==='<'?-.5:m[1]==='>'?.5:({low:-.4,'mid/low':-.2,mid:0,'mid/high':.2,high:.4})[m[3].toLowerCase()]);
}

// Same played-OD conversion as ManiaTracker's LeoBlack adapter.
export function playedOd(fileOd,flag){
  if(flag==='HR')return 6.462+.715*fileOd;
  if(flag==='EZ')return -20.761+2.566*fileOd;
  return Number.isFinite(flag)?flag:fileOd;
}

export function fourLnChart(raw,{rate=1,odFlag,starRating=0,overall=null}={},parser=null){
  const map=parseManiaBeatmap(raw),od=playedOd(map.od,odFlag);
  if(map.keyCount!==4)return null;
  const identity=resolveChartLnIdentity(map,{rate,od,overall});
  if(!chartIsLn(4,{lnRatio:identity.holdRatio,lnEffectiveRatio:identity.lnEffectiveRatio}))return null;
  // ManiaTracker uses the full-chart Sunny LN table, not the windowed analysis label.
  const sunny=runSunnyEstimatorFromText(raw,{speedRate:rate,odFlag,enableAlwaysShowLNDifficulty:true},parser);
  const text=String(sunny.estDiff).split('||').at(-1).trim();
  let chart=fourLnVerdict(text),source='Sunny 4K LN table';
  if(chart==null||text.startsWith('<')){
    const features=extractDanFeatures(map,{starRating},rate);
    const low=estimateLnDan(map,{starRating},features.metrics,Math.max(0,starRating)*Math.pow(rate,.7),features.durationMs,rate);
    if(low){chart=low.rawDan;source='ManiaTracker 4K LN low-band model';}
  }
  if(!Number.isFinite(chart))throw Error('Outside 4K LN estimator range');
  return {chart:Math.max(.5,Math.min(17.5,Math.round(chart*100)/100)),keys:4,rate,side:'LN',source,primary:null,
    playedOd:od,lnRatio:identity.holdRatio,lnEffectiveRatio:identity.lnEffectiveRatio,
    lnRatingIdentity:identity.lnRatingIdentity,reason:detectLnVibro(map,rate)?'LN vibro':null};
}
