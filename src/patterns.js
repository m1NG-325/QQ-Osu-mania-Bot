export const patternColors = { Jack:'#ee93b1', Stream:'#8fb9ff', Tech:'#edcd91', JHS:'#90d9c5' };

export function patternGroup(name='') {
  if (/Break|Uncategorised|Unclassified/i.test(name)) return null;
  if (/Tech|Wildcard|WC/i.test(name)) return 'Tech';
  if (/jack/i.test(name)) return 'Jack';
  if (/Chord|Jump|Hand|JHS/i.test(name)) return 'JHS';
  if (/Stream|Trill/i.test(name)) return 'Stream';
  return 'Tech';
}

export function groupedPatterns(summary=[]) {
  const totals = new Map(Object.keys(patternColors).map(name=>[name,0]));
  for (const [name,seconds] of summary) {
    const group=patternGroup(name);
    if (group) totals.set(group,totals.get(group)+seconds);
  }
  return [...totals].sort((a,b)=>b[1]-a[1]);
}
