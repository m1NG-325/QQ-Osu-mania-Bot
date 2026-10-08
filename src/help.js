import { shortcutLabel } from './command-aliases.js';
export function helpContent(demo=false) {
  const players=[
    ['!我的成绩 谱面ID [玩家名]','最多显示 20 条保留成绩、Mods 和最高分；默认查自己'],
    ['!群榜 谱面ID [mods]','比较本群已绑定成员，最多 50 条；加 mods 按模组分组'],
    ['!对比 playerA （Player B）','比较 2–4 位玩家；含空格名字用（），支持英文括号'],
    ['!对比 谱面ID','按游玩时间对比同图最近两次；记录不足时标明可获取范围'],
    ['!周报 / !月报','统计最近 7 / 30 天查询记录，不能补全过去历史'],
    ['!记录 开启 / 关闭','按发起人设置；仅保存自己的查询记录，保留最多 90 天'],
    ['!状态','查看队列和服务运行状态'],
    ['!i [玩家名 / ID]','玩家资料、PP、排名、最好与最近成绩'],
    ['!o [玩家名 / ID]','获取玩家头像，附玩家名与国旗'],
    ['!p [玩家名 / ID]','最近一条成绩，包含未通过；附星数与键型分析'],
    ['!p#序号 [玩家名 / ID]','指定最近成绩，1–100；例：!p#20 playerA'],
    ['!ps [开始-结束] [玩家名 / ID]','最近成绩范围 1–100；例：!ps 10-30 playerA'],
    ['!bp [开始-结束] [玩家名 / ID]','最佳成绩范围 1–200；例：!bp 1-20 playerA'],
    ['!bp#序号 [玩家名 / ID]','指定最佳成绩，1–200；例：!bp#2 playerA'],
    ['!tbp#天数 [玩家名 / ID]','近 1–30 天新增 BP；例如 !tbp#7，默认 30 天']
  ];
  if(demo) players.push(['!im [玩家名 / ID]','谱师统计面板，仅演示模式可用']);
  const maps=[
    ['!dan 段位 [参数]','回复／附图，或 @发图的群友；例：!dan epsilon'],
    ['!随机 4k 5-6星','可加 60-180秒 LN0-20%；支持 4k / 7k'],
    ['!练习 jack [4k] [5-6星]','键型练习：jack / stream / tech / jhs / ln'],
    ['!谱包 谱面ID','同一谱包的所有难度、键数与下载链接'],
    ['!m 谱面ID / 链接','谱面信息、物件统计、密度与四档 PP 估算'],
    ['!a 谱面ID / 链接 [倍速]','详细谱面分析；倍速 0.5–2.0，默认 1.0'],
    ['!v 谱面ID [时间段] [倍率] [放大] [sv]','例：!v5069028 0:30-1:00 x1.5 z2 sv'],
    ['!推荐 [玩家名 / ID]','对比相近玩家推荐 6 张谱面，附提升方向与加权 PP 收益'],
    ['!gb 谱面ID / 链接','获取该谱面的完整背景图'],
    ['!audio 谱面ID / 链接','获取该难度使用的完整音频，发送为群文件'],
    ['!help','查看这张命令指南']
  ];
  const bindings=[['!bind 玩家名 / ID','绑定自己的默认查询玩家'],['!bind','查看当前绑定'],['!unbind','解除自己的绑定']];
  const notes=[
    '英文缩写与原命令等效，英文命令不区分大小写；记录可用 !rec on / !rec off。',
    '群里直接发送命令即可，无需 @；每人发送间隔至少 3 秒。',
    '方括号表示可选参数，不需要输入括号；省略玩家时使用自己的绑定。',
    '示例统一使用 ！；命令头为 # 的群请把开头换成 #，其他群兼容半角 !。',
    '谱面链接需指向具体难度；仅查询 osu!mania，绑定不验证账号所有权。',
    '序号从 1 开始；最近成绩包含未通过，可查条数以 osu! API 返回为准。'
  ];
  const dan=[
    '指令：!dan / !dn <段位> [大小] [色散] [切片] [块状]；方括号参数可省略。',
    '选图：回复／附带图片，或 @发图者；按回复 → 附图 → 被 @群友最近 50 条消息中的最新图片选取。',
    '4k 段位：数字 1–10 或 alpha–kappa；4kln 为 1–17。例：epsilon / 4kln3。',
    '7k / 7kln 段位：数字 0–10 或 gamma / azimuth / zenith / stellium；支持模糊拼写。',
    '大小：50–125，默认 75；100 表示图标适配底图，超过 100 会裁切边缘。',
    '色散：0–1 或 0–100，控制颜色通道分离；0 为关闭。',
    '切片：0–1 或 0–100，控制水平切片错位；0 为关闭。',
    '块状：0–1 或 0–100，控制块状撕裂和偏色；0 为关闭。',
    '三种效果均省略时按段位自动；指定任意一种后，未填的按 0 处理。效果只改变底图。',
    '效果大于 1 时按百分数计算，例如 80 = 0.8；输入顺序必须为大小、色散、切片、块状。',
    '示例：@群友 !dan epsilon；!dan 4kln3 60；!dan 7klnazimuth 75 80 30 0。',
    '关闭全部效果：!dan kappa 75 0 0 0。最大 20 MB，保留 GIF 动画；内置小表情请先转图片。'
  ];
  const algorithms=[
    '练习索引：实际谱面分析，按有效键型时长筛选；索引最多保留 3000 张，并非全站曲库。',
    '键型匹配：Jack / Stream / Tech / JHS 占比 ≥15%；LN 比例 ≥37.5%。',
    '谱面预览 SV：轨道旁蓝色表示减速、金色表示加速，下方为倍率范围；音符仍按拍数等距显示。',
    '数据来源：PP、排名与成绩取自 osu! API；谱面分析与段位贡献为本地估算。',
    '算法：Sunny；4K 使用混合估算与 Etterna 0.74.0；7K 使用 Sunny 米图 / LN 档位表。',
    '实现版本：v1.1.2；Sunny 为分析算法，估算结果不等同于官方认证段位。',
    '分类依据：4K LN ≥45% 且通过实际倍率 / OD 下的有效松手判定；7K LN ≥37.5%。',
    '准确率口径：4K LN 使用 ScoreV2（MAX 305）；RC / 7K LN 使用 Stable（MAX 300）。',
    '4K LN 贡献：基准97%、最低91%、OD≥7；短条可回退RC，异常谱面不计入。',
    '异常回退：API 准确率为零但判定有效时补算；不会据此改算官方 PP 或排名。'
  ];
  const common = text => text.replace(/(^|[\s（(：:；;、→])!(?=[A-Za-z\u4e00-\u9fff])/g, '$1！');
  const rows = values => values.map(([command,description]) => [common(shortcutLabel(command)),common(description)]);
  return {players:rows(players),maps:rows(maps),bindings:rows(bindings),notes:notes.map(common),dan:dan.map(common),algorithms,commandPrefix:'！'};
}

export function helpText(demo=false) {
  const {players,maps,bindings,notes,dan,algorithms}=helpContent(demo);
  return ['osu!mania 命令指南','首次使用：！bind 你的玩家名 → ！i / ！p / ！bp',
    ...[...players,...maps,...bindings].map(([command,description])=>`${command}  ${description}`),...notes,'dan 使用说明与可调参数',...dan,'算法与数据说明',...algorithms,
    ...(demo?['演示模式：数据全部为模拟数据。']:[])].join('\n');
}
