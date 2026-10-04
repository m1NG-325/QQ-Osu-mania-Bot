# osu!mania QQ 查询机器人

[English usage and configuration guide](README.en.md)

第一次使用请阅读 [使用说明](USAGE.md)：安装、QQ 接入、群友指令、dan 参数和常见问题。

Node.js 机器人，通过 NapCat / OneBot 11 在 QQ 群查询 osu!mania 资料、成绩和谱面，生成图片卡片。当前版本 **1.0.0**。可先使用本地演示，无需 QQ 或 API 凭据。

## 安装与运行

需要 Node.js **22.9.0 或更高版本**，推荐维护中的 LTS。Windows 可使用 NapCat 接入 QQ；其他系统可先运行网页、测试和查询服务，NapCat 的安装方式请按其文档选择。

```sh
npm ci
npm test
npm start
```

打开 <http://127.0.0.1:3210>。默认是 demo 模式，图片标注模拟数据。项目不附带 QQ 登录文件、密钥、真实绑定、游玩记录或音频。

设置真实查询：复制 `.env.example` 为 `.env`，设置 `BOT_MODE=live`，填写在 [osu! 账号设置](https://osu.ppy.sh/home/account/edit) 创建的 OAuth 应用 `OSU_CLIENT_ID` 与 `OSU_CLIENT_SECRET`。此程序使用公开查询的 client credentials，不要求玩家 OAuth 登录。

`.env` 只留在本机。配置修改后重启服务。演示数据、绑定和历史与真实模式隔离。

## QQ 接入

先按 [NapCat 文档](https://doc.napneko.icu/) 安装并登录 QQ。本项目按 NapCat 与查询服务在同一台电脑设计，尤其是音频群文件上传。

1. NapCat 开启 HTTP 服务端，监听 `127.0.0.1:3000`，访问 token 对应 `ONEBOT_ACCESS_TOKEN`。
2. NapCat 开启 HTTP 客户端，上报 `http://127.0.0.1:3210/onebot/events`，token 对应 `ONEBOT_EVENT_TOKEN`。支持原始请求字节的 HMAC-SHA1 `X-Signature`，也支持 Bearer。
3. `.env` 设置 `ONEBOT_HTTP_URL=http://127.0.0.1:3000`、`QQ_ALLOWED_GROUPS` 为允许的群号列表、`QQ_ENABLED=true`。
4. 在允许的群发送 `！help` 或 `！bind ExamplePlayer`。

`QQ_GROUP_PREFIXES={"123456789":"#"}` 可给某个群使用独立命令头，其余群保留 `!` / `！`。这里只是示例群号。只响应白名单群，忽略私聊和自身消息；普通指令忽略 @其他人，dan 指令支持 @发图者选图。每人 3 秒冷却，最多 20 条 QQ 处理中消息。

`start-napcat.bat "NapCat 安装目录" "QQ.exe 完整路径"` 是 Windows Shell 发行包的可选启动助手，依赖其中的 `NapCatWinBootMain.exe`、`NapCatWinBootHook.dll`、`napcat.mjs` 等文件；不适用于每种 NapCat 安装包。推荐优先使用 NapCat 官方启动方式，启动助手不会替你安装 QQ 或完成扫码验证。

Windows 可运行 `powershell -ExecutionPolicy Bypass -File .\start.ps1`，进程退出后按 3–60 秒退避重试，避免重复占用端口。需要自动登录启动时自行添加计划任务，工作目录设为项目目录。`npm start` 是前台运行，不包含守护。QQ 登录过期仍需手动验证；端口已占用时启动助手会停止，不会结束已有程序。

## 指令

玩家名含空格时一般直接填写完整名字；多人对比使用括号包住含空格名字。谱面参数接受具体难度 ID 或 osu! 难度链接。

| 指令 | 功能 |
|---|---|
| `！bind 玩家名或ID` / `！bind` / `！unbind` | 设置、查看、解除默认查询对象；不认证账号归属 |
| `！i [玩家]` / `！o [玩家]` | 玩家资料 / 头像 |
| `！p [玩家]` / `！p#20 [玩家]` | 最近单条 / 指定第 1–100 条，包含未通过 |
| `！bp#2 [玩家]` | 指定第 1–200 条 BP |
| `！ps [玩家]` / `！bp [玩家]` | 最近 / 最佳列表，默认 16 条 |
| `！ps 10-30 [玩家]` / `！bp 30条 [玩家]` | 指定范围或条数；最近最多 100、最佳最多 200 |
| `！tbp#7 [玩家]` | 近 1–30 天打出的、当前仍在 Top 200 中的 BP；默认 30 天 |
| `！我的成绩 谱面ID [玩家]` | 此图保留成绩，最多显示 20 条；并非完整游玩历史 |
| `！对比 谱面ID` | 同图可获取的最新两次成绩；不足时合并接口保留成绩与自己的本地记录 |
| `！对比 PlayerA （Player B）` | 2–4 位玩家资料与 BP 样本对比 |
| `！群榜 谱面ID [mods]` | 当前群已绑定成员的同图榜；最多显示 50 条，mods 按条件分组 |
| `！推荐 [玩家]` | Mania Tracker 相近玩家推荐，最多 6 张 |
| `！随机 4k 5-6星 60-180秒 LN0-20%` | 从已分析索引按条件随机选图；可省略筛选项 |
| `！练习 jack [4k] [5-6星]` | 按 Jack / Stream / Tech / JHS / LN 找练习图；支持 4K / 7K |
| `！m 谱面ID` / `！谱包 谱面ID` | 谱面信息 / 同谱包所有难度与下载链接 |
| `！a 谱面ID [倍率]` | Sunny、MSD、键型、密度等本地分析；倍率 0.5–2.0 |
| `！v谱面ID [0:30-1:00] [x1.5] [z2] [sv]` | 音符长图、原谱时间范围、倍率标尺、1/2/3 倍放大、SV 侧栏 |
| `！gb 谱面ID` / `！au 谱面ID` | 官方背景 / 原始完整音频群文件 |
| `！记录 开启` / `！记录 关闭` | 仅设置发起人的记录偏好，不影响绑定同一玩家的其他人 |
| `！周报` / `！月报` | 仅统计自己保存的查询记录，不能补全过去历史 |
| `！状态` / `！help` | 队列状态 / 命令与算法说明 |

`！im` 仅在 demo 模式展示模拟谱师数据。公开 API 无法提供的成绩会明确提示，PP 缺失不补为零。群榜跨 Mods / 客户端的分数可能不具可比性；绑定不代表经过身份认证。

## 数据与算法

- 玩家资料、排名、PP、成绩取自 osu! 官方 API；stable / lazer 数据按接口字段展示。零准确率但判定有效时有标注的判定回退，不重算官方 PP。
- Mods 星数、无 Mod 的四档 PP 估算使用 `rosu-pp-js 4.0.1`，可能不同于 osu! 当前部署版本；不把倍率直接乘到原星数。
- Sunny、Mixed、Daniel、Azusa、Companella、Interlude 和 MinaCalc 来自内置 Mania Map Analyser。详细分析 MSD 使用 0.72.3、93% 目标；4K 段位模型使用 0.74.0。Companella 是模型段位标签。
- 7K 段位估算使用 Sunny RC / LN 档位表；4K 使用本地 Mixed/Sunny/Companella 与 MSD 近似。贡献曲线参考 [Mania Tracker 的公开代码](https://github.com/aleju03/mania-hub/blob/main/algorithms/player/dan-credit.ts)，不能当作正式玩家段位认证或完整网站算法复刻。
- LN 比例为长条物件数 / 全部物件数，不按持续时间加权。7K LN 分支门槛 37.5%，4K 米段排除门槛 70%；这些是当前实现的用途门槛，不是 osu! 官方统一面图定义。上游谱型分类另有 RC / Mix / LN 阈值。
- Dan ACC 使用 MAX 与 300 同为 300 权重的 stable 公式，可能与 lazer 显示准确率不同。不支持的 Mods、准确率/OD 不足、特殊结构等不会被硬填有效贡献。
- 谱型时间轴为每 15 秒的主导类型；Jack / Stream / Tech / JHS 筛选是有效键型时长占比 ≥15%，LN 筛选为物件占比 ≥37.5%。索引最多 3000 张，不是全站曲库。
- 预览按拍数等距，BPM/拍号改变会影响小节线；SV 只画侧栏，不模拟游戏中的实际滚动距离。倍率调整时间标尺，不重算预览标题的官方 NM 星数。
- 推荐会把玩家 ID 发给 Mania Tracker 公共接口，不向其发送 osu! 密钥。建议收益不能相加当作总收益。音频下载依赖 Nerinyan / catboy 镜像；不绕过明确禁用的下载。

## 并发、缓存与本地数据

不同发起人可并发；同一发起人按请求到达顺序执行查询与状态修改。普通查询 4、耗时查询 2、计算 Worker 2、音频下载 1、图片渲染 2 个并发。推荐计算也受 Worker 限制。超时后尚未开始的任务会取消；已开始的工作保持槽位直到结束，取消的绑定不会延后写回。

查询预算：普通 45 秒、音频 180 秒、群榜 300 秒；渲染最多等待 60 秒，群文件上传接口最多 120 秒。完整请求还有限时，等待超过 5 秒发送状态提示。正常音频首轮下载不会再被普通查询的 45 秒预算提前截断；排队过久或外部服务异常仍可超时。

`data/` 保存绑定、历史、索引、音频缓存；`output/` 保存日志和演示导出。两者均不提交。历史按发起人隔离，保留 90 天、全局最多 5000 行，关闭记录保留旧记录。旧历史迁移时保守保留已关闭偏好，无法确认归属的旧行只对本地查询开放。

绑定写入带 3 份恢复备份。查询缓存 10 秒；推荐 5 分钟；图片缓存最多 40 张 / 64 MB / 10 分钟。音频缓存最多 32 首 / 300 MB，谱包下载最多 100 MB、音频最多 30 MB；ZIP 解包在独立 Worker 中，10 秒限时。谱面分析最多 50000 物件、4 MB / 2 小时；预览最长 20000 像素。

日志只记录事件与错误类别，不记录命令、密钥或 QQ 消息正文。OneBot 每分钟检测接口可达性，可达不等于 QQ 在线。

## 自定义背景与素材许可

`PANEL_BACKGROUND_PATH` 可设置本地背景图片完整路径，留空使用原创 SVG 背景，重启生效。真实单图卡片优先使用官方谱面背景。自定义图片由使用者自行确保有权使用。

发布版使用 Noto Sans SC（SIL OFL 1.1）、原创 SVG 背景与段位徽章，合成谱面测试不包含真实歌曲。未附带原本机的 Torus、外部段位图片或真实谱面。Mod 图标来自 osu-web，保留其 AGPL-3.0 许可；内置算法保留各自 MIT 等许可。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [assets/README.md](assets/README.md)。自有代码采用 AGPL-3.0-only，第三方文件按各自条款。

## 发布前验证

```sh
npm ci
npm test
npm audit --omit=dev --registry=https://registry.npmjs.org
node scripts/verify-release.mjs
```

不要上传 `.env`、`data/`、`output/`、`node_modules/`、备份或候选目录。网页手工上传不会自动遵循 `.gitignore`；请使用发布清单。SHA-256 文件清单保存在 `RELEASE_MANIFEST.json`。Windows 与 Linux CI 配置在 `.github/workflows/test.yml`；添加配置不等于已通过 GitHub CI。

help 使用所有群通用版本：命令示例统一显示 `！`，使用 `#` 命令头的群按说明替换；dan 使用说明与大小、色散、切片、块状参数放在位于“自己的绑定”上方的独立说明框，对比示例为 `！对比 playerA （Player B）`。

## dan 图片／动画表情贴图

回复一张图片或动画表情，发送 `！dan kappa 75`；也可以在同一条消息里附图，或 `@发图的群友 ！dan epsilon`。依次优先使用回复图片、本条附图、被 @群友在本群最近 50 条消息中的最新图片；查不到时返回操作提示。支持 OneBot 消息数组与 CQ 字符串。QQ 内置的小表情若没有可下载的图片，需要先发送为图片或 GIF。

```text
！dan <段位> [大小] [色散] [切片] [块状]
！dan kappa
！dan 4kln3 60
！dan 7kstellium 75 0.8 0.3 0
！dan kappa 75 0 0 0
```

大小范围 50–125，默认 75。故障效果默认随段位变化；指定任一效果后，未指定的效果按 0 处理，效果可写 0–1 或 0–100。支持 4k、4kln、7k、7kln 和模糊段位拼写，以及 `！dankappa75` 等连写。沿用 `QQ_GROUP_PREFIXES`：命令头配置为 `#` 的群使用 `#dan kappa`。

合成程序及图标已放入 `vendor/dan-sticker/`。服务在首次出图时自动启动，监听本机随机端口，随机器人退出，无需另开终端。缓存位于 `data/dan-sticker/`，单独限制为最多 300 个文件；合成使用独立队列，不占普通查询队列。底图最大 20 MB，支持 PNG、JPEG、GIF、WebP、BMP；GIF 保留逐帧时长和循环次数，动画 PNG／WebP 输出为 GIF。

使用 dan 需要 Python 3、Pillow 和 NumPy。在 `.env` 的 `DAN_PYTHON` 填入安装了 Pillow 和 NumPy 的 Python 可执行文件完整路径；留空时程序探测可用环境，最终尝试 PATH 中的 `python`。安装依赖示例：

```powershell
python -m pip install -r vendor/dan-sticker/requirements.txt
```

修改后重启机器人。也可以直接在本机出图：

```powershell
node --env-file-if-exists=.env scripts/render-dan.mjs '！dan kappa 75' '底图.gif' 'output\成品.gif'
```

已验证：静态 PNG／WebP、GIF／动画 WebP、图片下载限制、参数错误、缓存复用，以及模拟 OneBot 的回复选图、自动 @、自定义群命令头、CQ 附图与图片回传。



## 英文缩写命令

原命令全部保留，英文缩写不区分大小写，并沿用本群命令头。缩写与原命令使用相同参数，成绩序号、范围和条数写法也相同。

| 原命令 | 英文缩写 |
|---|---|
| `我的成绩` | `ms` |
| `随机` | `rnd` |
| `练习` | `pr` |
| `群榜` | `lb` |
| `谱包` | `mp` |
| `对比` | `cmp` |
| `周报` | `wr` |
| `月报` | `mr` |
| `记录` | `rec` |
| `状态` | `st` |
| `推荐` | `rc` |
| `bind` | `b` |
| `unbind` | `ub` |
| `help` | `h` |
| `audio` | `au` |
| `i` | `ui` |
| `o` | `av` |
| `p` | `rs` |
| `ps` | `rsl` |
| `bp` | `bs` |
| `tbp` | `rb` |
| `im` | `mi` |
| `m` | `bm` |
| `a` | `an` |
| `v` | `pv` |
| `gb` | `bg` |
| `dan` | `dn` |

示例：`！cmp playerA （Player B）`、`！ms 谱面ID`、`！rsl 10-30 playerA`、`！bs#2 playerA`、`！rec on / off`、`@群友 ！dn epsilon`。使用 `#` 的群替换开头命令头。
