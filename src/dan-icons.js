import { danName } from './dan-ladders.js';

export function danScale(value,keys=4,side='Rice'){
  const center=Math.max(keys===7?1:2,Math.min(keys===7?13:19,Math.round(value)));
  return {
    lower:center-1.5,
    upper:center+1.5,
    levels:[center+1,center,center-1].map(level=>({
      level,
      name:danName(level,keys),
      file:keys===7?`7-${side==='LN'?'ln-':''}${danName(level,keys).toLowerCase()}.svg`:`${danName(level,keys).toLowerCase()}.svg`,
      range:`${level-.5}–${level+.5}`
    }))
  };
}
