const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c]));

export function avatarSvg(user, assets = {}, demo = false) {
  const name = user.username || 'Unknown player';
  const size = Math.min(54, 510 / Math.max(1, [...name].length * .6));
  const avatar = assets.avatar
    ? `<image x="92" y="52" width="416" height="416" preserveAspectRatio="xMidYMid meet" href="${escape(assets.avatar.data)}"/>`
    : `<rect x="92" y="52" width="416" height="416" fill="#dbe4f5"/><text x="300" y="280" text-anchor="middle" font-size="100" fill="#65799d">${escape(name.slice(0,1))}</text>`;
  const flag = assets.flag
    ? `<image x="275" y="595" width="50" height="34" preserveAspectRatio="xMidYMid meet" href="${escape(assets.flag.data)}"/>`
    : `<text x="300" y="620" text-anchor="middle" font-size="22" fill="#d6e1f1">${escape(user.country_code || '—')}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="680" viewBox="0 0 600 680">
    <rect width="600" height="680" fill="#f1effc"/>
    ${assets.art?`<image width="600" height="680" href="${escape(assets.art.data)}" preserveAspectRatio="xMidYMid slice"/><rect width="600" height="680" fill="#111a2a" fill-opacity=".6"/>`:''}
    <rect x="77" y="41" width="446" height="446" fill="#d9d7e3"/>
    <rect x="80" y="40" width="440" height="440" fill="white"/>
    ${avatar}<g font-family="Noto Sans SC, Segoe UI, Microsoft YaHei, sans-serif">
    <text x="300" y="550" text-anchor="middle" font-size="${size}" fill="${assets.art?'#f4f7ff':'#08080c'}">${escape(name)}</text>
    ${flag}${demo ? '<text x="300" y="661" text-anchor="middle" font-size="14" fill="#787589">DEMO · SIMULATED DATA</text>' : ''}</g></svg>`;
}
