// Both forms resolve to the same action before validation, queueing and dispatch.
export const COMMAND_SHORTCUTS = [
  ['我的成绩','ms'], ['随机','rnd'], ['练习','pr'], ['群榜','lb'],
  ['谱包','mp'], ['对比','cmp'], ['周报','wr'], ['月报','mr'],
  ['记录','rec'], ['状态','st'], ['推荐','rc'],
  ['bind','b'], ['unbind','ub'], ['help','h'], ['audio','au'],
  ['i','ui'], ['o','av'], ['p','rs'], ['ps','rsl'], ['bp','bs'],
  ['tbp','rb'], ['im','mi'], ['m','bm'], ['a','an'], ['v','pv'], ['gb','bg'], ['dan','dn']
];
const aliases = new Map(COMMAND_SHORTCUTS.map(([command,alias])=>[alias,command]));
const matcher = new RegExp(`^([!！]\\s*)(${[...aliases.keys()].sort((a,b)=>b.length-a.length).join('|')})(?=\\s|#|\\d|$)`, 'i');

export function normalizeCommand(text) {
  if (typeof text !== 'string') return '';
  let normalized = text.trim().replace(matcher, (_,prefix,alias)=>prefix+aliases.get(alias.toLowerCase()));
  normalized = normalized.replace(/^([!！]\s*)dn/i,'$1dan');
  normalized = normalized.replace(/^([!！]\s*记录\s+)(on|off)\s*$/i,(_,prefix,value)=>prefix+(value.toLowerCase()==='on'?'开启':'关闭'));
  return normalized;
}

export function shortcutLabel(command) {
  const names = new Map(COMMAND_SHORTCUTS);
  return command.replace(/!([a-z]+|[\u4e00-\u9fff]+)(#[^\s]+)?/gi,(whole,name,suffix='')=> {
    const alias=names.get(name.toLowerCase());
    return alias?`${whole} / !${alias}${suffix}`:whole;
  });
}
