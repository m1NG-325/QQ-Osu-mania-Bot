const fourNames=['Alpha','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Theta','Iota','Kappa'];
const sevenNames=['Gamma','Azimuth','Zenith','Stellium'];
export function danName(level,keys=4){
  return level<=10?String(level):(keys===7?sevenNames:fourNames)[level-11];
}
export function sevenRiceVerdict(text){
  const m=String(text).match(/^(Regular (\d+)|Regular (Gamma|Azimuth|Zenith|Stellium)) (low|mid\/low|mid|mid\/high|high)$/i);
  if(!m)return null;
  const level=m[2]!=null?Number(m[2]):11+sevenNames.findIndex(n=>n.toLowerCase()===m[3].toLowerCase());
  return level+({low:-.4,'mid/low':-.2,mid:0,'mid/high':.2,high:.4})[m[4].toLowerCase()];
}
export function sevenLnVerdict(text){
  const match=String(text).trim().match(/^(?:([<>])\s+)?LN (\d+|Gamma|Azimuth|Zenith|Stellium) (low|mid\/low|mid|mid\/high|high)$/i);
  if(!match)return null;
  const level=/^\d+$/.test(match[2])?Number(match[2]):11+sevenNames.findIndex(name=>name.toLowerCase()===match[2].toLowerCase());
  if(level<3||level>14)return null;
  return level+(match[1]==='<'?-.5:match[1]==='>'?.5:({low:-.4,'mid/low':-.2,mid:0,'mid/high':.2,high:.4})[match[3].toLowerCase()]);
}
