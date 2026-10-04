# QQ Osu!mania Bot — v1.0.0

[中文 README](README.md) · [中文使用说明](USAGE.md)

A Node.js bot for osu!mania player queries, score cards, beatmap analysis and previews, practice recommendations, and dan image stickers. QQ integration uses NapCat / OneBot 11 directly; NoneBot is not required. The web preview also works without QQ.

## Requirements

- Node.js **22.9.0 or newer** and npm.
- Python 3 with **Pillow and NumPy** for dan stickers.
- An osu! OAuth application for live queries.
- NapCat and a logged-in QQ account for group commands.

The automated test matrix covers Windows and Ubuntu with Node.js 22 and 24. Use NapCat's installation instructions for your operating system. Run NapCat and the bot on the same machine for the default setup, especially for audio group-file uploads.

## Quick start: preview first

Download and extract the release ZIP, or clone this repository. Open a terminal in the directory containing `package.json`:

```sh
npm ci
npm start
```

Open <http://127.0.0.1:3210>. The default `demo` mode uses simulated data and needs neither osu! credentials nor QQ. Press Ctrl+C in the terminal to stop the process. To run the checks, stop the server and run `npm test`.

For dan stickers, install the Python dependencies using the interpreter you will configure for the bot:

```sh
python -m pip install -r vendor/dan-sticker/requirements.txt
python -c "from PIL import Image; import numpy; print('Dependencies OK')"
```

If your interpreter is named `python3`, use that command instead and set its full executable path in `DAN_PYTHON`.

## Configure live osu! queries

Copy `.env.example` to `.env`. Keep existing local configuration if you are upgrading.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Linux / macOS:

```sh
cp .env.example .env
```

Create an OAuth application in your [osu! account settings](https://osu.ppy.sh/home/account/edit), then edit the local `.env`:

```dotenv
BOT_MODE=live
OSU_CLIENT_ID=your_application_id
OSU_CLIENT_SECRET=your_application_secret
```

Replace both placeholders. The bot uses the [client credentials grant](https://osu.ppy.sh/docs/index.html#client-credentials-grant) for public data; players do not need to share their passwords or login tokens. Save the file and restart the bot. Never commit or share `.env`.

## Connect QQ with NapCat

Install and log in to NapCat using its [official configuration guide](https://doc.napneko.icu/config/basic). Add the bot account to the groups you intend to enable. In NapCat's network configuration, create and enable:

| Connection | Settings | Purpose |
|---|---|---|
| HTTP server | Host `127.0.0.1`, port `3000`, a token | Accept API calls from the bot |
| HTTP client | URL `http://127.0.0.1:3210/onebot/events`, a token, message format `array` | Forward QQ events to the bot |

Set the HTTP server token as `ONEBOT_ACCESS_TOKEN` and the HTTP client token as `ONEBOT_EVENT_TOKEN`. These are separate from the NapCat WebUI login token. The bot accepts an HMAC-SHA1 `X-Signature` or a matching Bearer token for incoming events.

Example `.env` settings:

```dotenv
QQ_ENABLED=true
ONEBOT_HTTP_URL=http://127.0.0.1:3000
ONEBOT_ACCESS_TOKEN=your_http_server_token
ONEBOT_EVENT_TOKEN=your_http_client_token
QQ_ALLOWED_GROUPS=123456789,234567890
QQ_GROUP_PREFIXES={"123456789":"#"}
```

The group numbers above are fictional. Replace them with your own groups, separated by ASCII commas. An empty allowlist enables no groups. In this example, the first group uses `#`; the other group uses `！` and also accepts ASCII `!`. Prefix overrides belong in the bot's `.env`, not in NapCat's network prefix settings.

Restart the bot, then send `！help` in a normal group or `#help` in a prefix-overridden group. Private messages and messages outside the allowlist are ignored. Ordinary commands ignore mentions of other users; dan commands can mention the sender of an image.

If you change `PORT`, update NapCat's event URL too. The default loopback configuration does not need a public port. Remote or container-based NapCat deployments require their own network and file-path configuration; `127.0.0.1` always refers to the current machine or container.

## Configuration reference

| Variable | Meaning |
|---|---|
| `BOT_MODE` | `demo` for simulated data, `live` for osu! API data |
| `HOST`, `PORT` | Bot HTTP bind address and port; defaults `127.0.0.1:3210` |
| `OSU_CLIENT_ID`, `OSU_CLIENT_SECRET` | Your osu! OAuth application credentials |
| `QQ_ENABLED` | Set `true` to process permitted QQ group events |
| `ONEBOT_HTTP_URL` | NapCat HTTP API endpoint |
| `ONEBOT_ACCESS_TOKEN` | Token for outbound NapCat API calls |
| `ONEBOT_EVENT_TOKEN` | Token used to authenticate incoming events |
| `QQ_ALLOWED_GROUPS` | Comma-separated group allowlist |
| `QQ_GROUP_PREFIXES` | JSON object mapping group IDs to command prefixes |
| `DAN_PYTHON` | Full path to a Python executable with Pillow and NumPy; quote paths containing spaces |
| `PANEL_BACKGROUND_PATH` | Optional local background image you have permission to use; empty uses the bundled background |

Restart after changing configuration. A blank `DAN_PYTHON` lets the program probe an available environment and then try `python` on PATH; setting an explicit interpreter is more reliable.

## Commands for group members

Examples use fullwidth `！`. In a `#` group, replace only the initial prefix: `！bp#2` becomes `#bp#2`. English command names and shortcuts are case-insensitive. Square brackets describe optional arguments; do not type them.

Start by binding your default query target:

```text
！bind playerA
！i
！p
！bp
```

`！bind` shows your current binding; `！unbind` removes it. Bindings are independent for each sender and do not verify ownership of the osu! account. Most player queries accept a player name or ID at the end without changing your binding, for example `！ui Player B`.

| Task | Original command | English shortcut / example |
|---|---|---|
| Help / queue status | `help` / `状态` | `！h`, `！st` |
| Bind / unbind | `bind` / `unbind` | `！b playerA`, `！ub` |
| Player profile / avatar | `i` / `o` | `！ui`, `！av` |
| Latest score / recent score #20 | `p` | `！rs`, `！rs#20` |
| Recent score list / range | `ps` | `！rsl`, `！rsl 10-30` |
| Best scores / best score #2 | `bp` | `！bs`, `！bs#2` |
| Current Top 200 BP played in the last 7 days | `tbp` | `！rb#7` |
| Retained scores on one difficulty | `我的成绩` | `！ms 100001` |
| Compare two plays on the same difficulty | `对比` | `！cmp 100001` |
| Compare 2–4 player profiles | `对比` | `！cmp playerA （Player B）` |
| Bound members' scores on one difficulty | `群榜` | `！lb 100001` |
| Recommendations | `推荐` | `！rc` |
| Random map from the local index | `随机` | `！rnd 4k 5-6星` |
| Practice by pattern | `练习` | `！pr jack 4k 5-6星` |
| Beatmap information / mapset difficulties | `m` / `谱包` | `！bm 100001`, `！mp 100001` |
| Detailed analysis at a custom rate | `a` | `！an 100001 1.5` |
| Note preview | `v` | `！pv 100001 0:30-1:00 x1.5 z2 sv` |
| Background / complete audio file | `gb` / `audio` | `！bg 100001`, `！au 100001` |
| Enable / disable saved query history | `记录` | `！rec on`, `！rec off` |
| Weekly / monthly query report | `周报` / `月报` | `！wr`, `！mr` |
| Image / animated sticker | `dan` | `！dn kappa 75` |

`100001` is an example difficulty ID. Use the ID of a specific difficulty, not a mapset ID, or a difficulty URL such as `https://osu.ppy.sh/beatmaps/100001`. Recent queries cover up to 100 records and best-score queries up to 200. In a player comparison, put names containing spaces in parentheses; both `（Player B）` and `(Player B)` work. Other commands usually accept the full name directly.

Random and practice commands search the local analyzed index, not the entire osu! catalogue. Populate it by analyzing maps with `！an`. `rb` includes plays that are still in the current Top 200; it is not a complete historical BP log. Weekly/monthly reports cover saved queries, not every play. `im` / `mi` displays simulated mapper data in demo mode only. Output cards and most error messages currently remain in Chinese.

## Dan images and animations

Reply to an image, attach an image to the command, or mention its sender: `@image sender ！dn epsilon`. Selection priority is the replied image, then the attached image, then the mentioned member's newest image among the last 50 messages in the current group.

```text
！dn kappa
！dn 4kln3 60
！dn 7klnazimuth 75 80 30 0
！dn kappa 75 0 0 0
```

Format: `！dan <rank> [size] [chromatic] [slice] [block]`.

- **Rank:** 4K numbers 1–10 or alpha–kappa; 4K LN numbers 1–17; 7K / 7K LN numbers 0–10 or gamma / azimuth / zenith / stellium. Use `4kln`, `7k` or `7kln` prefixes as needed. Approximate spellings are supported.
- **Size:** 50–125, default 75. Larger values enlarge the sticker; above 100 may crop its edges.
- **Chromatic:** separate color channels to create colored ghosting.
- **Slice:** shift horizontal image strips.
- **Block:** local block tearing and color changes.

Effects accept 0–1 or 0–100: `0.5` and `50` mean the same strength; `0` disables the effect, while `1` or `100` is maximum. Omit all three effects for automatic settings based on rank. Once any effect is specified, omitted effects become zero. `！dn kappa 75 0 0 0` disables all glitch effects while retaining the sticker. Effects alter the base image, not the rank icon.

Supported inputs: PNG, JPEG, GIF, WebP and BMP, up to 20 MB. GIF animation is retained; animated PNG / WebP is output as GIF. Built-in QQ emoji without a downloadable image need to be resent as an image or GIF. The Python service starts automatically on first use and stops with the bot; no separate terminal is required. Adding a dan sticker does not certify a player's rank.

## Score cards and algorithm limits

PP, rankings and scores come from osu!'s API. Missing PP stays unavailable. An `S` grade and the pass flag are separate fields. Local contribution estimates may be omitted for failed plays, unsupported modifiers, missing judgments or excluded chart structures.

Sunny, MSD, official stars and local dan contribution are different metrics. Dan accuracy uses stable's 300-weighted judgments and may differ from lazer's displayed accuracy. The current 7K LN branch uses an LN-object ratio of at least 37.5%; 4K rice contribution is excluded at an LN ratio of at least 70%. These are implementation thresholds, not an official universal definition of an LN map. Full analysis notes and upstream links are in the Chinese README.

## Troubleshooting and operation

| Problem | What to check |
|---|---|
| No group reply | Bot process, NapCat login, enabled HTTP client, matching tokens, allowlist and the group's prefix |
| Only demo data | `BOT_MODE=live`, osu! credentials, then restart |
| Player query fails | Correct name/ID, valid credentials, access to osu!; wait when rate-limited |
| Queue or timeout message | Send `！st`; avoid repeatedly sending the same expensive query |
| Dan service fails to start | Install requirements with the exact interpreter configured in `DAN_PYTHON` |
| Dan cannot find an image | Reply directly to the image; mention-based lookup is limited to 50 messages |
| Audio upload fails | Mirror availability, group-file permissions, same-machine access and readable cache paths |
| Port already in use | Stop your duplicate instance or change `PORT` and the event URL together |
| QQ login expires | Reauthenticate in NapCat; process restarts cannot replace login verification |

`npm start` runs in the foreground. On Windows, `powershell -ExecutionPolicy Bypass -File .\start.ps1` restarts the bot after process exit with backoff; it does not create an operating-system startup task. The optional `start-napcat.bat` takes the NapCat installation directory and the full QQ executable path. It targets the Windows Shell package; use NapCat's official launcher for other installations.

When upgrading, stop the bot, back up your private `.env` and `data/` locally, replace application files, run `npm ci`, and restart. Do not replace local state with somebody else's runtime files. Keep backups out of the public repository.

## Privacy, verification and licensing

The public release contains example configuration and synthetic test charts. It excludes the author's QQ identifiers, real group IDs, credentials, bindings, computer identity, private installation paths, logs and caches. `.env`, `data/`, `output/`, `node_modules/`, backup folders and candidate builds are local-only. GitHub's manual upload UI does not enforce `.gitignore`.

To verify a checkout:

```sh
npm ci
npm test
node scripts/verify-release.mjs
npm audit --omit=dev --registry=https://registry.npmjs.org
```

`RELEASE_MANIFEST.json` records file sizes and SHA-256 hashes. The release ZIP has a separate `.sha256` file. File verification confirms release contents; it cannot guarantee perpetual availability of external services. Real QQ login and live network behavior depend on your deployment.

Original project code is AGPL-3.0-only. Fonts, algorithms and other third-party files keep their own terms. See [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [assets/README.md](assets/README.md). User-provided dan PNGs have no independently confirmed redistribution license; the root license does not grant rights to those images. Use only input images and custom backgrounds you have permission to use.
