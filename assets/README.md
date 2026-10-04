# 发布版素材

- `default-background.svg`：项目原创渐变与线条背景，AGPL-3.0-only。
- `dan/*.svg`：项目原创文字/几何段位徽章，AGPL-3.0-only；不是外部网站原版徽章。
- `fonts/NotoSansSC.ttf`：Noto Sans SC 变量字体，来自 Google Fonts 官方仓库；SIL Open Font License 1.1，完整许可在 `fonts/OFL.txt`。使用前不需安装到系统。
- `mods/`：osu-web SVG 图形与 Mod 元数据，AGPL-3.0；来源及许可保留在该目录。

Noto 字体下载路径：https://github.com/google/fonts/tree/main/ofl/notosanssc 。发布包以文件 SHA-256 固定本次下载内容，见 `RELEASE_MANIFEST.json`。

Torus、原本机插画及外部段位图片不包含在发布版中。运行时获取的官方玩家头像和谱面封面不作为发布素材打包。`PANEL_BACKGROUND_PATH` 支持用户自行指定本地图片。
