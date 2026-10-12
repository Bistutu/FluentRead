# SVG 图片解码修复（2026-10-12）

## 问题与根因

REA 的 [README_zh.md](https://github.com/morluto/rea/blob/main/README_zh.md) 中，`rea-investigation-flow.svg` 能在网页正常显示，但默认 PaddleOCR 图片翻译报 `The source image could not be decoded.`。原始 SVG 为 1774 × 887，3552 字节，SHA-256 为 `11c3bf39b8e17910d058bfeb1368bae0d97846b08c09dd5ca7a433fd6ee2d1e6`。

网页图片的跨域画布不可导出时，读取路径保留服务器的 SVG MIME 并返回 data URL。Offscreen 的 `Image` 预检已能解码并验证尺寸，且传入 `decodedImage`；默认 PaddleOCR Worker 桥接却只发送原始字符串。Worker 再以 `createImageBitmap(Blob)` 解码 SVG，触发浏览器原生错误。真实 Edge 中，无 MIME Blob 和 `image/svg+xml` Blob 均失败，补 MIME 不能解决此问题。

修复在默认 Worker 桥接处复用已预检的 SVG 图片，按原始尺寸绘制并通过现有异步编码器转为无损 PNG，再进入 Worker。编码取消、失败和成功均释放自有画布，保留借用原图供重绘；PNG、JPEG 和 WebP 继续直接转发。读取授权、字节与像素上限、消息协议和权限沿用现有实现。本次独立实现，未借鉴或修改参考仓库。

## 验证

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
