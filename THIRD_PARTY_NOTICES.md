# 第三方来源与许可

自有代码及原创 SVG/合成测试数据采用 AGPL-3.0-only，根目录 `LICENSE` 为完整文本。以下第三方文件不因根许可证而改变其许可：

| 组件 | 来源 | 许可位置 |
|---|---|---|
| Mod SVG 与元数据 | https://github.com/ppy/osu-web / osu! 网站资源 | `assets/mods/LICENCE`、`assets/mods/README.md`（AGPL-3.0） |
| Noto Sans SC | https://github.com/google/fonts/tree/main/ofl/notosanssc | `assets/fonts/OFL.txt`（SIL OFL 1.1） |
| Mania Map Analyser | https://github.com/LeoBlackMT/osumania_map_analyser | `vendor/mania-analyser/LICENSE`、`NOTICE.md`（MIT） |
| Etterna / MinaCalc | https://github.com/etternagame/etterna | `vendor/mania-analyser/LICENSE-Etterna`（MIT） |
| ONNX Runtime | https://github.com/microsoft/onnxruntime | `vendor/mania-analyser/LICENSE-ONNXRuntime`（MIT） |
| simfile-parser | https://github.com/noahm/simfile-parser，v0.9.0 | `vendor/mania-analyser/js/parser/vendor/simfile-parser/NOTICE.md`（MIT，含本地补丁说明） |

NPM 依赖由 `package-lock.json` 固定版本、下载地址与 integrity；安装后各包保留其自身许可证，包括 fflate、Sharp、rosu-pp-js 和 onnxruntime-common。

原内置分析代码只记录下载日期，无法可靠回溯当时的上游 commit；因此不编造 commit 标识。发布包使用 `RELEASE_MANIFEST.json` 的 SHA-256 固定实际携带的每个源码、WASM、ONNX 与字体文件，既保留上游说明，也使本次发布内容可以核对。后续升级应同时更新来源版本和清单。

背景及原有替代段位徽章是本次新绘制的 SVG，测试谱面为确定性公式生成，不携带原来的真实谱面文件、歌曲音频、账号绑定、私有配置或查询截图。测试中的曲名、用户名样例不表示真实成绩或身份认证。

官方网页、头像、封面、谱面与第三方镜像服务均为运行时来源，未随本发布包再分发。各平台的名称及标识仍属于原权利人；本项目不宣称官方关联。

`vendor/dan-sticker/` 为此次用户提供的 dan 合成程序及 67 个 PNG 贴图，作为独立功能保留，卡片内原有原创 SVG 徽章继续使用。该目录说明记录本地修改；提供的文件未附独立许可证，根目录许可证不用于推定这些 PNG 的授权，素材权利仍属于原权利人。Pillow 为安装时依赖，不随发布包携带。

ManiaTracker 4K LN 模型：`vendor/mania-tracker-ln/`，MIT，copyright 2026 aleju03；来源及固定commit见目录内NOTICE.md，原始TS与编译JS均保留。4K LN徽章`assets/dan/4-ln-*.svg`采用用户提供的素材，来源与许可情况见`assets/dan/4K_LN_SOURCES.md`，不宣称其为本项目原创。
