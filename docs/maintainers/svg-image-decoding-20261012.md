# SVG 解码、透明文字与 JPEG 方向修复（2026-10-12）

## 问题与根因

REA 的 [README_zh.md](https://github.com/morluto/rea/blob/main/README_zh.md) 中，`rea-investigation-flow.svg` 能在网页正常显示，但默认 PaddleOCR 图片翻译报 `The source image could not be decoded.`。原始 SVG 为 1774 × 887，3552 字节，SHA-256 为 `11c3bf39b8e17910d058bfeb1368bae0d97846b08c09dd5ca7a433fd6ee2d1e6`。

网页图片的跨域画布不可导出时，读取路径保留服务器的 SVG MIME 并返回 data URL。Offscreen 的 `Image` 预检已能解码并验证尺寸，且传入 `decodedImage`；默认 PaddleOCR Worker 桥接却只发送原始字符串。Worker 再以 `createImageBitmap(Blob)` 解码 SVG，触发浏览器原生错误。真实 Edge 中，无 MIME Blob 和 `image/svg+xml` Blob 均失败，补 MIME 不能解决此问题。

修复在默认 Worker 桥接处复用已预检的 SVG 图片，按原始尺寸绘制并通过现有异步编码器转为无损 PNG，再进入 Worker。编码取消、失败和成功均释放自有画布，保留借用原图供重绘；PNG、JPEG 和 WebP 继续直接转发。读取授权、字节与像素上限、消息协议和权限沿用现有实现。本次独立实现，未借鉴或修改参考仓库。

## 首轮 SVG 验证

- 新增 11 个默认 Worker 路径用例；旧源码在其中 8 个 SVG 用例失败、3 个位图用例通过。修复后的 `mangaOcr.test.ts` 共 31 项通过。
- OCR 桥接和异步编码专项共 44 项通过；`mangaOcr.ts`、`imageEncoding.ts` 的 statements、branches、functions、lines 均为 100%。
- 图片 Offscreen、读取授权、安全契约、推理 Worker/客户端、模块边界和文件头的 8 个相关测试文件共 1146 项通过；测试归类审计通过。这是针对性验证，不是全量回归。
- TypeScript/Vue 类型检查、Chrome 和 Firefox 生产构建、用户脚本构建及 verifier、文档构建通过。版本号保持 0.0.37。
- 实际 README DOM 确认原图已加载，原始 SVG 在真实 Offscreen 图片元素中解码和 PNG 编码成功；SVG Blob 位图解码复现原生错误。
- GitHub 页面随后多次返回 503，完整流程改用相同 SVG 字节的跨域页面夹具。原图画布确实受污染，后台收到 `image/svg+xml`，因此测试经过真实 SVG 回退路径。默认 PaddleOCR 使用 SHA-256 与生产声明一致的真实本地模型，在临时扩展缓存内预置；OCR 推理没有模拟。
- 图片流程识别到 `REA investigation flow`、`Follow-up question`、`2. Inspect & trace` 等文字，输出 PNG 尺寸保持 1774 × 887。原图/译图切换计数为 `[1, 0, 1]`，再次显示不新增翻译请求，原图地址和页面地址保持一致，最终只有一个译层，页面无异常。
- 翻译 transport 使用确定性 Google 响应；未验证线上翻译质量、模型 CDN 下载可靠性或 Firefox 实际运行。
- 视觉检查仍见少量既有原字边缘残留；`1.Ask` 被已有标识符过滤保留。这些不阻止解码和切换，但本次证据不代表 OCR 或背景修补质量完美。

隔离 Edge 使用自动创建的临时 profile：`launchMode=macos-background-cdp`、`focusPolicy=launchservices-no-foreground`、`windowPlacement.mode=background-visible-no-focus`、`screenIndex=1`、`browserFrontmost=false`。测试窗口位于第二块屏幕可用区域，前台应用 PID 前后相同，结束后关闭测试实例并清理临时 profile。

生产 JavaScript 资产 SHA-256：`c3fdfe626e060cbf9bbb72d71e0a176438681f6fb3ea5f05564ea963c699f3d5`。

本次本地证据：

- 原始解码探针：`/private/tmp/fluentread-svg-image-decode-root-browser-probe-baseline/report.json`
- 真实 OCR 与切换：`/private/tmp/fluentread-svg-image-decode-root-browser-flow-seeded-fixed-final/report.json`
- 译图：同目录 `translated-bitmap.png`
- 原文对照：同目录 `03-text-comparison.png`

## 复跑

脚本 `scripts/testing/run-svg-image-translation-test.cjs` 默认只测指定 REA 图片。通过工作区依赖工具取得 Node 和 Playwright 包目录，并传入浏览器测试技能的 focus-safe helper。使用 `--fixture-svg <原始 SVG 文件>` 规避 GitHub 临时不可用；使用 `--models-dir <真实模型目录>` 预置经过双重哈希校验的模型，减少无关下载等待。省略这两个参数可检查实际 README 页面和在线模型准备。

```sh
<bundled-node> scripts/testing/run-svg-image-translation-test.cjs \
  --extension-dir .output/chrome-mv3 \
  --playwright-root <bundled-node-packages> \
  --focus-safe-helper <browser-test-skill>/scripts/focus-safe-browser.cjs \
  --fixture-svg <original-svg-file> \
  --models-dir <verified-real-models-directory> \
  --artifacts-dir <unique-evidence-directory>
```

## 合并前的格式补查

审查追加发现并修复两处相关问题：

- PaddleOCR 的 RGB 张量忽略 alpha，透明背景上的黑字与透明像素都变成黑色，原生产包实际识别为空。现在只在 OCR 独占像素上按可见前景的 alpha 加权亮度选择对比底色：深色前景用白底，浅色前景用黑底。完全透明的隐藏 RGB 不参与选择，半透明边缘正确合成；不透明输入只扫描 alpha，不读取 RGB、不修改或写回像素。复用已有像素回读，不复制整图，原图及译图未修补区域保留透明度。
- Tesseract.js 的 EXIF 读取只匹配前 500 字节中的 Big Endian Orientation 标签。直接调用本地 SDK 已确认同为 Orientation=6 时，正常 Big Endian 返回 6，Little Endian 或较晚标签返回 1。原始 JPEG 直接进入内核可能与浏览器预检及重绘方向不同。现在 JPEG/JPG 与其他非 PNG 格式一样借用浏览器已解码像素转 PNG；自然尺寸、缩放坐标、借用原图所有权、取消和重试沿用现有实现。PNG 仍可直接透传。

补查证据与结果：

- 真实 Edge 的 29 个解码样本覆盖 PNG、JPEG、WebP、GIF、BMP、AVIF、ICO、大小写/charset/百分比编码/viewBox-only/foreignObject SVG、透明深浅文字、动画以及 EXIF JPEG。浏览器支持的位图均可在 DOM 和 Worker 解码；SVG 均可经 DOM/Canvas 转 PNG，原始 SVG Blob 位图解码仍失败。TIFF、JPEG2000 在 DOM 解码即失败，属于该浏览器的格式能力边界，不声称支持。
- 小端 EXIF=6 JPEG 的原像素为 320 × 160，浏览器及 Worker 位图均为纠正方向后的 160 × 320；Tesseract 内核方向缺陷由实际 SDK 调用与回归测试验证，未声称进行了真实 Tesseract 模型端到端实验。
- 同一生产消息链路的六组真实 PaddleOCR 对照覆盖 PNG/SVG 的不透明、透明黑字及透明白字。旧包透明黑字两组失败，其他四组成功；修复包六组均识别 `Hello reader`，输出 320 × 160 PNG，四组透明输入的输出角落 alpha 均为 0。模型仍经 SHA-256 校验，翻译 transport 为确定性响应；该六组测试不包含悬浮 UI。
- 修复包重新完成原始 REA SVG 的悬浮入口、文字面板、PNG 译图及 `[1, 0, 1]` 原图切换；识别/翻译输入 14 项，缓存重显没有重复请求，原图 URL/src 不变，页面无异常。此轮仍使用原始 SVG 跨域夹具，不声称真实 GitHub 页面端到端通过。
- 动画 GIF/WebP/APNG/AVIF 在实际 Offscreen 未挂载 Image 和页面附着/未附着 Image 的多次 Canvas 采样均与 Worker 首帧一致，未复现识别与重绘帧错位，不改写动画处理路径。
- 四个 OCR/编码/像素测试文件共 110 项通过；`mangaOcr.ts`、`ocrRuntime.ts`、`ocrPixels.ts`、`imageEncoding.ts` 四维覆盖率均为 100%。旧源码在新增 JPEG 回归中 8 项失败，39 项其他用例通过；新增像素算法的 15 项测试覆盖深浅文字、半透明、空白、阈值、颜色权重及不透明输入零写入。
- 九个相关 Offscreen、授权、安全契约、OCR/推理 Worker/客户端及架构测试文件共 1186 项通过，其中 979 项为源文件头检查；测试归类审计通过。这些仍是针对性验证。
- TypeScript/Vue 类型检查、Chrome/Firefox 生产构建、用户脚本构建及 verifier、文档构建通过；没有升级依赖、改变权限或版本。

补查生产 JavaScript 资产 SHA-256：`f1835876233e5babc2f7fcc00501f7b7287f216f0572ec295f9975fe506511c9`。

证据目录：`/private/tmp/fluentread-svg-image-decode-root-format-review-20261012/`，包含 `report.json`、`animation-report.json`、`paddle-baseline/report.json`、`paddle-fixed/report.json` 和 `rea-final/report.json`。所有实验均使用第二屏背景正常窗口与独立临时 profile，报告记录焦点策略，结束后关闭并清理测试实例。本次仍未借鉴或修改参考仓库；未验证 Firefox 实际运行、线上翻译质量或模型 CDN 可靠性。
