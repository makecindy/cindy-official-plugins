# Cindy Chrome 商店素材

[English](README.md)

本目录保存 **2026-10-30** 随 Chrome 扩展 **0.4.60** 提交的商店资料。
在本地打开 [index.html](index.html)，可预览中英文图片、介绍和宣传图。
素材位于仓库文档目录，不会进入 `my-browser/` 插件安装包。

## 实际上传清单

| 文件                                | 用途                                           | 尺寸       |
| ----------------------------------- | ---------------------------------------------- | ---------- |
| `assets/store-icon-128.png`         | 沿用 Cindy Chrome 插件图案，适配留白的商店图标 | 128 × 128  |
| `screenshots/en-1.png` … `en-5.png` | 全球通用截图，按编号顺序上传                   | 1280 × 800 |
| `assets/promo-small.png`            | 小型宣传图                                     | 440 × 280  |
| `assets/promo-marquee.png`          | 顶部宣传图                                     | 1400 × 560 |
| `copy/global-description.txt`       | 实际提交的介绍，英文在前、简体中文在后         | 文本       |

本次后台只有一套全球通用资料栏，最多放五张截图。五张 `zh-CN` 图片是本地化备选，
**并未额外上传**。`copy/` 保留分语言的可编辑介绍；`*-summary.txt` 是后续 manifest
更新时可采用的短介绍建议，**本次未上传**。扩展包内的图标和 manifest 保持原状。

[`submission.json`](submission.json) 保存历史提交记录：2026-10-30 07:25 UTC 确认待审核，
勾选通过后自动发布，当时线上版本为 0.4.22。该记录不代表实时审核状态。
[`asset-manifest.json`](asset-manifest.json) 记录 PNG 尺寸、SHA-256 和实际上传清单。
私人账号信息和后台原始回执不入仓。合并本目录不会向 Chrome 商店上传或提交审核。

## 素材来源

- 图标：沿用 `my-browser/assets/icon-source/plugin.svg` 与 `my-browser/assets/icon.png`，
  在 `assets/` 留存源文件。商店图标将图案缩至 96 × 96，四边各留 16 像素透明区域。
- 第 1、3 张：实际扩展 UI，配原创示例文章与预设本地译文。`source/` 保留原始界面输入图；
  `build.mjs --capture-ui` 保留示例数据和采集步骤。没有连接 Cindy 或 AI 服务，也没有创建任务。
- 第 2 张：明确标注的示例指令，不声称任务已执行。
- 第 4 张：AI 生成的原创太空小猫与煎饼，手工排版双语字幕及通用播放器，并标明示意画面。
  原画为 `assets/video-space-breakfast.png`；内置图像生成工具的提示词保存在
  `source/video-generation-prompt.txt`。不包含旧版的第三方视频画面。
- 第 5 张：实际扩展选项 UI，以本地模拟状态展示可选权限未开启。

原始界面使用提交 `2bf3f8227d5dbfde81788424ab1a1d09dbf91aeb` 中的扩展 0.4.60。
提审前已比对八个相关 UI 源文件与上传 ZIP 一致。这是视觉与素材验证，不代表浏览器任务
或模型输出的端到端测试。素材遵循仓库既有许可证及商标约定。

## 渲染与校验

需要 Node.js 22 或更高版本；本地渲染工具通过 lockfile 固定 `playwright-core`。

```sh
cd docs/chrome-web-store
npm ci
npx playwright-core install chromium
npm run verify
npm run render
```

默认使用归档的界面输入图，写入仓库已忽略的 `.build/chrome-web-store/`，不覆盖这里的
已提交图片。输出还包含十张截图、两张宣传图对应的可编辑 HTML。文案与预览页在本目录，
版式文字和样式在 `build.mjs`。已有 Chromium 时，可把 `CHROME_EXECUTABLE_PATH` 指向其
可执行文件，代替安装配套浏览器。

需要用当前源码重新采集示例 UI 时，显式执行：

```sh
npm run render -- --capture-ui
```

`EXTENSION_SOURCE` 可指定另一份 checkout 的 `my-browser/extension`。采集会直接使用
指定源码，新版扩展可能改变布局或行为；要复用原 UI，请使用上面记录的提交。渲染依赖系统字体，
本次上传图使用 macOS 的 SF/PingFang；换平台或字体可能改变像素和换行。重新生成后，检查
中英文版式，再决定是否替换归档图片或上传。

`npm run verify` 校验归档 PNG 的哈希、尺寸、上传颜色格式、上传清单及本地预览链接。
主动更换素材后，同步更新 manifest 哈希及新资料的提交记录。历史事实保留日期，不能暗示
已经重新获得审核批准。

尺寸参考：[Chrome 应用商店图片规范](https://developer.chrome.com/docs/webstore/images)。
