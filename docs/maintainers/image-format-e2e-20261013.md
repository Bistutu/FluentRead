# 五种图片格式完整流程验证（2026-10-13）

## 结果与修复

WebP、GIF、BMP、AVIF 和 ICO 的图片识别、线上翻译、译图、文字对照、恢复原图及缓存重显完成验证。真实生产扩展在隔离 Edge 中运行 PaddleOCR 和 Tesseract，各 18 项，共 **36/36 通过**。

基线发现 Tesseract 的透明白字缺陷：WebP、AVIF 漏掉 `Hello` 和格式名称等文字，GIF 报“没有识别到图片文字”。相同原图由同源 Canvas 读取为 PNG 后也复现，不能仅在非 PNG 格式分支修复。PaddleOCR 同样本正常。

`ocrRuntime.ts` 现在在独占识别画布上复用 `flattenOcrAlpha`，按可见前景亮度合成对比底色；透明 PNG 与其他格式共用这条路径。仅识别副本改变，借用原图继续供透明译图重绘。不透明原尺寸 PNG 仍使用原编码，不增加 PNG 编码；增加的 Canvas/alpha 检查受既有 4096 边长、600 万像素预算限制，并在推理前释放。已铺不透明留白的圈选画布继续原行为，避免额外回读；本次没有扩展圈选截图或其他引擎策略。

## 覆盖范围

| 格式 | PaddleOCR | Tesseract | 样本与读取路径 |
| --- | ---: | ---: | --- |
| WebP | 5 | 5 | 不透明与透明白字分别跨域/同源，两帧动画跨域 |
| GIF | 5 | 5 | 不透明与透明白字分别跨域/同源，两帧动画跨域 |
| BMP | 2 | 2 | 不透明，跨域与同源 |
| AVIF | 4 | 4 | 不透明与透明白字，跨域与同源 |
| ICO | 2 | 2 | 六个尺寸 entry 的 ICO，浏览器选择 256 × 256，跨域与同源 |

跨域原图画布确实受污染，后台分别收到 `image/webp`、`image/gif`、`image/bmp`、`image/avif`、`image/x-icon`。同源原图画布可读取，后台收到 `image/png`。模型推理、译图和可信鼠标点击都经过真实扩展链路，未模拟 OCR 或翻译响应。

每项均检查：

- 识别到完整夹具短句；仅允许大小写、空白、标点差异，不忽略错字或漏字。真实 OCR 原文完整保留，部分 Paddle WebP 仍会多插词内空格，这不是准确率保证。
- 每个识别段落都有对应的中文译文且与原文不同，文字面板原文对照与译图实际一致。
- 输出 PNG 的自然尺寸保持一致，源图与译图 RGBA 实际发生变化；透明背景探针 alpha 为 0，动画输出背景与首帧一致。
- 译图时原图隐藏，恢复时原始可见性、尺寸、`src`、`currentSrc` 和 URL 完整恢复。
- 译图数量 `[1, 0, 1]`；缓存重显不新增 OCR 调度或翻译请求，最终只有一份译图，页面无异常。

线上翻译使用 Google，最终有 12 个真实成功 HTTP 请求；其余段落精确命中同一临时配置内已成功的真实译文缓存，报告记录来源，未把缓存命中冒充新网络调用。Paddle 的三个模型与生产声明的 SHA-256/尺寸一致；Tesseract 英语模型从生产 jsDelivr 地址取得，解压后 5,199,098 字节，SHA-256 `5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747`，Node 与浏览器双重核查后仅预置到临时模型缓存。Tesseract 首次仍通过正常语言准备 UI 验证引擎。

## 代码验证与证据

- `imageOcrRuntime.test.ts` 63 项通过；旧源码在新增 8 个 PNG/WebP/GIF/AVIF 深浅透明输入用例中全部失败。新增回归覆盖源所有权、像素读写/编码失败、取消与重试，不透明 PNG 原编码透传及圈选既有留白。
- 四个 OCR/像素/编码专项文件共 126 项通过，`ocrRuntime.ts`、`ocrPixels.ts`、`mangaOcr.ts`、`imageEncoding.ts` 的 statements、branches、functions、lines 均为 100%。
- 九个相关 Offscreen、读取授权、安全契约、推理/OCR Worker/客户端及架构文件共 1186 项通过，其中 979 项为源文件头检查；测试归类审计通过。这是针对性回归，不是全量回归。
- TypeScript/Vue 类型检查、Chrome/Firefox/用户脚本生产构建、用户脚本 verifier、文档构建，以及浏览器脚本 Node 语法检查通过。没有升级依赖、改变权限、版本或发布产物。
- 独立审查生产根修、资源和取消边界、测试断言、实际译图后，未发现可行动问题。本次未借鉴或修改参考项目。

浏览器为 Edge 131.0.2903.147；自动生成临时 profile，`launchMode=macos-background-cdp`、`focusPolicy=launchservices-no-foreground`，正常 1280 × 900 窗口在第二屏，`windowPlacement.mode=background-visible-no-focus`、`browserFrontmost=false`。最终复用一个测试页顺序导航，656 次精确测试进程前台 PID 检查无违规，结束后关闭实例并清理 profile。

正式证据目录：`/private/tmp/fluentread-image-format-e2e-root-20261012/final-matrix/`。`report.json` 记录全部 36 项及截图、RGBA 对比、读取 MIME、原文/译文、真实服务请求、缓存来源、焦点和清理信息；每项子目录包含译图、文字面板和切换截图。

修复后生产 JavaScript SHA-256：`bc7adb33f254c5af9dd962a516bcdba09315591e7c57ba827ff963a1efa0084b`。

基线证据保留在同级 `baseline-matrix-3/`（27/30，三项真实透明 Tesseract 失败）和 `baseline-transparent-canvas/`（三项透明 PNG 路径失败）。前期 `google-smoke/` 的隐藏 style 等待错误，以及 `baseline-matrix/`、`baseline-matrix-2/` 的准备提示点击或前台焦点守卫中断属于测试工具问题，均停止并清理，不算产品失败或通过。脚本改为可信坐标输入、单页复用及持续焦点检查后完成最终矩阵。

本次使用原创二进制夹具页面和真实线上翻译，不是任意网站或任意复杂图片的准确率验证；未验证 Firefox 实际运行、TIFF/HEIC/JPEG2000，或模型按需下载/CDN 长期可靠性。模型缓存预置不模拟推理。

## 复跑

`scripts/testing/image-format-fixtures/manifest.json` 固定十个原创二进制样本的 MIME、尺寸、帧数和 SHA-256，共约 457 KiB。附生成器和说明；运行测试不依赖 Python。通过工作区依赖工具获取 Node、Playwright 目录，传入浏览器测试技能的 focus-safe helper：

```sh
<bundled-node> scripts/testing/run-image-format-flow-test.cjs \
  --extension-dir .output/chrome-mv3 \
  --playwright-root <bundled-node-packages> \
  --focus-safe-helper <browser-test-skill>/scripts/focus-safe-browser.cjs \
  --fixtures all \
  --engines paddle,tesseract \
  --path-modes cross-origin,canvas \
  --service google \
  --models-dir <verified-paddle-models-directory> \
  --language-dir <real-eng-traineddata-directory> \
  --artifacts-dir <unique-evidence-directory>
```

省略模型目录时走生产准备流程；线上服务不可用时测试会失败并保留原因。可通过 `--fixtures baseline` 或按名称筛选样本、`--engines` 和 `--path-modes` 运行相关子集，不默认扩大为全站点矩阵。
