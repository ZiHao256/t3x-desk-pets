# Desk pets（桌宠）

Pixel pets for the current agent stand on the composer and react to the thread state; each subagent sends its own pet to work alongside. Choose a pet per agent and edit the pet library.

输入框上沿站着当前 agent 的像素宠物，跟着会话状态动；子代理各派一只到旁边干活。每个 agent 用哪只、宠物库都能自己改。

An extension for [T3 Code Extensions](https://github.com/ZiHao256/t3code-extensions), an unofficial extension host for [T3 Code](https://github.com/pingdotgg/t3code). Install it in Settings → Extensions → Browse, or paste `https://github.com/ZiHao256/t3x-desk-pets` into the URL field there. "Check for updates" offers this repository's latest release, installed after you confirm.

[T3 Code Extensions](https://github.com/ZiHao256/t3code-extensions) 的扩展。在 设置 → 扩展 →“浏览”里安装，或者把 `https://github.com/ZiHao256/t3x-desk-pets` 粘贴到那里的链接框。“检查更新”取本仓库的最新 Release。

## Requirements / 依赖

`apiVersion` 2: needs a T3 Code Extensions host that supports it. Older hosts refuse to install this version.

只依赖宿主提供的 `host` 接口（`apiVersion` 2），旧版宿主会拒绝安装。

## Development / 开发

- `npm test` runs the tests (Node 22+, no dependencies). 运行测试，不依赖 npm 包。
- To try changes: Settings → Extensions → Add local extension, pick this folder, then click refresh on its card after each edit. 试改动：设置 → 扩展 →“添加本地扩展”选本仓库目录，改完点卡片上的刷新。

## Sprite sheet / 精灵图格式

8 列 × 11 行，每格 192×208（整张 1536×2288），和 Codex 桌宠的图集格式一致：

| 行 | 动作 | 行 | 动作 |
|---|---|---|---|
| 0 | 待机 | 6 | 等待 |
| 1 / 2 | 向右 / 向左跑 | 7 | 运行中 |
| 3 | 挥手 | 8 | 审阅 |
| 4 | 跳 | 9–10 | 16 个方向的看向帧（0° 朝上顺时针） |
| 5 | 失败 | | |

宠物定义（`pets.js` 里的条目，设置里添加的宠物也用这些字段）：`name`、`scale`（0.5–2）、`pixelFx`（粒子用像素方块）、`smooth`（非像素画）、`badgeBottom`（子代理 “+N” 徽标高度）、`vars` / `darkVars`（`--t3x-pet-*`、`--t3x-sub-*` CSS 变量，用来校准落地位置和粒子颜色，见 `pets.css` 的默认值）。自带的 Codex 风格宠物由 `tools/codex_atlas.py` 用代码逐帧画出。

## Release / 发版

1. Change the code, bump `version` in `plugin.json`, run `npm test`, and commit. 改代码和 `plugin.json` 的 `version`，跑测试，提交。
2. Tag that commit `v<version>`, push it with the tag, and publish a GitHub release ("check for updates" reads the latest release). 在这个提交上打 `v<version>` 标签，连标签一起推送并发布 Release（“检查更新”看的是最新 Release）。

## License

MIT

The Clawd and Moffy sprites are the author's own non-commercial fan pixel art; the characters belong to their respective owners (Clawd is Anthropic's Claude mascot) and are not covered by the MIT license. Open an issue to request removal.

Clawd、Moffy 精灵图是作者自己绘制的同人像素形象，仅供非商业使用；角色形象归原权利方所有（Clawd 是 Anthropic 的 Claude 吉祥物），不在 MIT 授权范围内。如有异议请开 issue，会撤下。
