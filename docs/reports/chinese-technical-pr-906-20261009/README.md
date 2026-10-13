# 技术中文重复翻译回归（2026-10-09）

反馈页面：[PR #906](https://github.com/FluentRead/FluentRead/pull/906)。此 PR 的评论正文是复现素材，本次修复不替代它的 HTTP 重试改动。

## 根因与修复

中文技术段落中的小写术语和操作符表达式被当成外语正文，导致可信中文被判成混合语言并发出同目标翻译请求。新增规则要求同句中文证据、代码/缩写/字段或表达式锚点及局部中文技术句架，且限制表达式长度与每项词数。普通英文句子、功能词、引用、明确要求解释的外语以及其他语言继续翻译。

行内 `code` 原本不参加文本提取，会丢失技术锚点；现在仅语言预检可读取同候选内无汉字的行内代码，隐藏、禁止翻译、代码块、计时器和其他候选仍隔离。发送和渲染使用原有受保护槽，代码不会提交或覆盖。字段名后的 DOM 空白不会让 `Key 集合` 丢失中文句架。代码中的中文也不会替可译英文或纯汉字日文提供中文正文证据。

标准 userscript 基线已接近包体积预算。将既有 45 条功能词字符串提取为纯数据，用现有 gzip/pako 管线无损压缩；所有原始字符串、Set 建立顺序及语言行为不变，未更改依赖、资源地址或预算。Greasy Fork 保留明文数据，扩展直接使用明文模块。

## 验证范围

- 语言识别、脚本/别名、真实 franc-min 语料、共享客户端/文本槽、全文运行时、Chrome 检测及 userscript 资源/压缩专项：16 文件、1,739 项通过。覆盖同目标零请求、相邻英文仍请求、简繁/其他目标、恢复/再译、动态改写、取消/重试，以及四段原文的真实 `code`/`strong` DOM。
- 16 文件、1,442 项 core 覆盖率专项通过；`identify.ts`、`chinese.ts`、`lexicon.ts`、`functionWordData.ts`、`dom.ts` 的 statements/branches/functions/lines 均为 100%。
- 新功能词数据与 `origin/main` 的 45 条原始字符串及构造顺序逐项相等；真实 pako round-trip、Unicode/空字符串/代理对、可执行语句拒绝和精确白名单检查通过。
- 基于 `b077d878f2e0970b71b4c775d41c4681dfd6c911` 完成类型检查、Chrome MV3、Firefox MV2、标准 userscript 构建和 userscript verifier；标准 userscript 为 **1,963,619 字节**，低于该上游基线已有的 1,964,000 字节预算。本次未改预算文件。
- 测试审计、模块边界、中文文件头与浏览器焦点安全检查已执行。覆盖率清单把 `transcription.worker.ts` 同时列为组装豁免和业务覆盖的既有失败，已在原始 `51b0f87a7b020b1f037a721c3b7e65af73c23b23` 归档中复现。此基线的 userscript 固定语言资源 commit 也缺少日文资源；后续主分支已修正固定 commit。本次未修改这些无关路径。

覆盖率复现：`pnpm exec vitest run --coverage --config docs/reports/chinese-technical-pr-906-20261009/coverage.config.ts`。

## 真实浏览器专项

生产 Chrome MV3 在临时 Edge profile 中执行。启动模式为 `macos-background-cdp`，焦点策略为 `launchservices-no-foreground`；第二屏可见正常尺寸窗口，`browserFrontmost=false`。不连接日常浏览器 profile，完成后删除临时 profile。

四段普通文本及交替 `code`/`strong` 两种结构，均验证中文目标下 Control 悬浮和 Alt+T 全文的零中文请求、零译文节点与原始 DOM 保持；相邻英文悬浮请求计数 `[1,0,1,0]`、全文 `[1,0,1]`；动态中文改为英文后重新请求；切英文目标后四段中文正常请求且可完整恢复。控制台无错误。

复现命令（路径参数按本机替换）：

```sh
node scripts/testing/run-chinese-translation-test.cjs --technical-pr-906 \
  --extension-dir .output/chrome-mv3 \
  --playwright-root <Node包目录> \
  --focus-safe-helper <focus-safe-browser.cjs路径> \
  --artifacts-dir <证据目录>
```

可审计结果：[浏览器摘要](./browser-summary.json)、[完整请求与交互报告](./browser/report.json)。PNG/HTML 与初次失败诊断仅保存在本地证据目录，未提交为仓库资源。

页面和 OpenAI 兼容服务均为本地回环夹具；结果证明生产扩展的判断与请求链路，不代表在线供应商质量、GitHub 实时页面完整验收或 Firefox 实机验证。未使用参考仓库实现。
