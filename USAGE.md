# 使用说明

本说明适用于 osu!mania QQ bot v1.0.0。普通群友阅读「群里怎么用」即可；部署者从安装开始。方括号表示可选参数，不需要把括号一起发送。所有账号、群号示例均为虚构，占位内容必须换成你自己的配置。

## 1. 安装并查看演示

下载并解压发布包，在包含 `package.json` 的目录打开终端。安装 Node.js 22.9.0 或更高版本；使用 dan 贴图还需要 Python 3，以及 Pillow 和 NumPy。项目直接连接 NapCat / OneBot 11，不需要另外安装 NoneBot。

```sh
node --version
npm ci
npm start
```

在浏览器打开 <http://127.0.0.1:3210>。默认是演示模式，显示模拟数据；这一步不需要 QQ 登录或 osu! 密钥。终端按 Ctrl+C 停止。需要运行自检时先停止演示，再运行 `npm test`。

使用 dan 时，为准备使用的 Python 安装 Pillow 和 NumPy：

```sh
python -m pip install -r vendor/dan-sticker/requirements.txt
python -c "from PIL import Image; import numpy; print('Python dependencies OK')"
```

如果系统使用 `python3`，以上命令改用 `python3`，并将该可执行文件的完整路径填写到后面的 `DAN_PYTHON`。

## 2. 启用真实 osu! 查询

复制 `.env.example`，将副本命名为 `.env`。Windows PowerShell 可使用：

```powershell
Copy-Item .env.example .env
```

Linux / macOS 可使用 `cp .env.example .env`。不要覆盖已有配置。

在 [osu! 账号设置](https://osu.ppy.sh/home/account/edit) 创建 OAuth 应用，将应用的 Client ID 和 Client Secret 填入 `.env`：

```dotenv
BOT_MODE=live
OSU_CLIENT_ID=填入你自己的应用ID
OSU_CLIENT_SECRET=填入你自己的应用密钥
```

这里只使用 [client credentials 授权](https://osu.ppy.sh/docs/index.html#client-credentials-grant) 查询公开数据，不需要玩家交出密码或登录令牌。保存并重新运行 `npm start`。查询失败时先检查模式与应用凭据；不要将 `.env` 发给别人排查。

## 3. 接入 QQ 群

按 [NapCat 官方文档](https://doc.napneko.icu/config/basic) 安装 NapCat 并登录机器人 QQ，加入你准备使用的群。建议 NapCat 和 bot 在同一台机器运行，特别是音频群文件功能。

在 NapCat 的网络配置中创建并启用两个连接：

| 连接 | 配置 | 用途 |
|---|---|---|
| HTTP 服务端 | `127.0.0.1:3000`，设置 token | bot 调用 NapCat 发消息 |
| HTTP 客户端 | 上报地址 `http://127.0.0.1:3210/onebot/events`，设置 token，消息格式选择 array | NapCat 把群消息送给 bot |

这两个 token 可以分别设置；不要把 NapCat WebUI 登录 token 当成这里的 token。HTTP 服务端 token 对应 `ONEBOT_ACCESS_TOKEN`，HTTP 客户端 token 对应 `ONEBOT_EVENT_TOKEN`。

在自己的 `.env` 填写：

```dotenv
QQ_ENABLED=true
ONEBOT_HTTP_URL=http://127.0.0.1:3000
ONEBOT_ACCESS_TOKEN=填入HTTP服务端token
ONEBOT_EVENT_TOKEN=填入HTTP客户端token
QQ_ALLOWED_GROUPS=123456789,234567890
QQ_GROUP_PREFIXES={"123456789":"#"}
```

这里两个群号都是虚构示例。`QQ_ALLOWED_GROUPS` 用英文逗号分隔；留空时不会响应任何群。示例第一个群使用 `#`，第二个群使用 `！`，也兼容半角 `!`。命令头配置属于 bot 的 `.env`，不是 NapCat 的网络 prefix 设置。

保存后重启 bot，在普通群发送 `！help`，在配置为 `#` 的群发送 `#help`。只在白名单群响应，不处理私聊。普通查询不要 @其他人；dan 可 @发图者选图。

如果修改了 bot 的 `PORT`，NapCat 上报地址也要同步修改。保持本机监听即可；默认配置不需要开放公网端口。不同机器、容器或远程 NapCat 不能直接照搬 `127.0.0.1` 和本地音频路径。

## 4. 群里怎么用

本说明及帮助图片统一用 `！`。在 `#` 群只替换命令开头，例如 `！bp#2` 改成 `#bp#2`，中间的 `#2` 不变。

先绑定默认查询对象：

```text
！bind playerA
！i
！p
！bp
```

`！bind` 查看自己的绑定，`！unbind` 解除绑定。每个群友独立绑定；绑定仅设置默认查询对象，不证明你拥有这个 osu! 账号。多数玩家查询可在末尾写其他玩家名，不会改变绑定，例如 `！i Player B`。

| 想做什么 | 命令示例 |
|---|---|
| 看帮助、队列状态 | `！help`、`！状态` |
| 资料、头像 | `！i`、`！o` |
| 最新成绩、最近第20条 | `！p`、`！p#20` |
| 最近成绩列表、指定范围 | `！ps`、`！ps 10-30` |
| BP列表、第二条BP | `！bp`、`！bp#2` |
| 最近7天打出的、仍在当前Top200中的BP | `！tbp#7` |
| 此图成绩、此图两次成绩对比 | `！我的成绩 100001`、`！对比 100001` |
| 多人资料对比 | `！对比 playerA （Player B）` |
| 已绑定群友的同图榜 | `！群榜 100001` |
| 推荐、随机选图 | `！推荐`、`！随机 4k 5-6星` |
| 按键型找练习图 | `！练习 jack 4k 5-6星` |
| 谱面信息、谱包难度列表 | `！m 100001`、`！谱包 100001` |
| 本地分析、1.5倍分析 | `！a 100001`、`！a 100001 1.5` |
| 音符预览、范围与放大 | `！v100001`、`！v100001 0:30-1:00 x1.5 z2 sv` |
| 背景、完整音频 | `！gb 100001`、`！au 100001` |
| 本地记录开关、报告 | `！记录 开启`、`！记录 关闭`、`！周报`、`！月报` |

`100001` 是格式示例，实际请填写具体难度 ID（不是谱包 ID），也可使用具体难度链接，例如 `https://osu.ppy.sh/beatmaps/100001`。最近成绩最多100条，BP最多200条。含空格的玩家名通常直接填写；多人对比用括号包住含空格名字。完整参数和算法限制见 [README](README.md)。

推荐依赖外部服务；随机与练习从本地已分析索引选取，不是全站随机。索引为空时先使用 `！a` 分析一些谱面。周报、月报只统计开启记录后实际保存的查询，无法补全过去游玩历史。

## 5. dan 图片和动画表情

dan 是给图片叠加段位图标和故障特效的工具，不是段位认证。选图有三种方式：回复图片后发命令、同一条命令附图，或 `@发图者 ！dan epsilon`。优先使用回复图片，其次本条附图，最后被 @群友在本群最近50条消息中的最新图片。

```text
！dan kappa
！dan 4kln3 60
！dan 7klnazimuth 75 80 30 0
！dan kappa 75 0 0 0
```

格式为 `！dan 段位 [大小] [色散] [切片] [块状]`：

| 参数 | 意思 |
|---|---|
| 段位 | 4K：1–10、alpha–kappa；4K LN：1–17；7K / 7K LN：0–10、gamma / azimuth / zenith / stellium；可加 `4kln`、`7k`、`7kln` 前缀 |
| 大小 | 50–125，默认75；100铺满底图，超过100会裁掉边缘 |
| 色散 | 颜色分离、彩色重影 |
| 切片 | 图片横条左右错位 |
| 块状 | 局部方块撕裂和偏色 |

效果可写0–1或0–100：`0.5`等于`50`，`0`关闭，`1`或`100`最大。全部效果省略时随段位自动设置；只填一个效果后，其他未填效果为0。`！dan kappa 75 0 0 0` 只叠图标，关闭全部故障效果。效果改变底图。

支持 PNG、JPEG、GIF、WebP、BMP，底图最多20 MB。GIF保留动画；动画PNG / WebP输出为GIF。QQ内置小表情没有可下载图片时，请先转成图片或GIF发送。

部署者在 `.env` 的 `DAN_PYTHON` 指定安装了 Pillow 和 NumPy 的 Python 完整路径；含空格的路径可用双引号包住。留空时程序会探测可用环境，最终尝试 PATH 中的 `python`。首次出图自动启动合成服务，无需另开终端。

## 6. 如何看成绩卡

PP来自官方接口，缺失时显示横线，不补成0。星数、Sunny、MSD和本地段位贡献是不同指标。`S` 是成绩等级，是否通过看独立的通过字段。贡献使用本地算法估算，未通过、判定不足、特殊谱面或不支持的参数可能不显示；不能当作正式认证。

LN比例按长条物件数占比计算，不按长条持续时间。当前7K LN分支门槛为37.5%；这些是实现门槛，不是统一的官方面图定义。完整算法说明见 README 的「数据与算法」。

## 7. 常见问题

| 情况 | 检查顺序 |
|---|---|
| 群里完全不回复 | bot终端是否运行 → NapCat是否登录 → HTTP客户端是否启用 → 两边token是否一致 → 群白名单 → 本群命令头 |
| 网页是模拟数据 | 将 `BOT_MODE` 改为 `live`，配置osu!凭据并重启 |
| 玩家查询报错 | 名字 / ID是否正确、凭据是否有效、网络是否可访问osu!；限流时稍后重试 |
| 指令提示排队或超时 | 耗时指令受并发限制，先看 `！状态`，不要连续重复发送 |
| dan启动失败 | 检查 `DAN_PYTHON` 指向的解释器，并用同一个解释器安装Pillow 和 NumPy |
| dan找不到图片 | 直接回复图片重试；被@者的图片须在本群最近50条消息中 |
| 音频上传失败 | 检查镜像网络、群文件权限、NapCat和bot是否同机、缓存文件路径能否访问 |
| 端口占用 | 停止自己启动的重复实例，或同时修改 `PORT` 与NapCat上报地址 |
| QQ登录过期 | 在NapCat重新登录；进程自动重启不能代替扫码验证 |

Windows需要进程退出后自动重启时，可用 `powershell -ExecutionPolicy Bypass -File .\start.ps1`；它不负责开机启动。`npm start` 为前台进程。更换配置后需要重启，保留自己的 `.env` 与 `data/`，不要覆盖成别人发布包里的数据。

## 8. 文件与隐私

`.env` 存配置与密钥；`data/` 存绑定、历史、索引和缓存；`output/` 存日志和导出图片；`node_modules/` 是本机安装依赖。它们均不属于GitHub发布内容，也不要放入故障截图或issue。发布包只包含示例配置，没有作者的QQ、真实群号、账号绑定、电脑用户名或本机安装路径。

帮助他人排查时只提供错误类别、软件版本和脱敏步骤。关闭记录只停止继续保存，不会自动删除旧数据。素材来源和许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；自定义背景和输入图片请使用有权使用的素材。
