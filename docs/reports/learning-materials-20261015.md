# 学习材料工作区验收（2026-10-15）

文章、文档和视频现在可以按原始来源组织收藏原句、阅读问答、学习笔记与个人笔记，并从材料继续阅读。原有收藏与复习、阅读记录、长期笔记仍由各自仓库管理，学习中心默认仍打开收藏栏目。本次使用 FluentRead 自有 WXT、Vue、TypeScript 架构实现，未复制或修改参考仓库。

## 身份、数据与恢复

- 文章保留语义查询和 SPA 路由，移除追踪参数；同一来源去重，同名不同来源不合并。YouTube 与 X 使用具体视频／帖子媒体身份，不把时间线当作视频来源。
- 文档使用原文件内容指纹；PDF 按页、DOCX 按部分与阅读页、EPUB 按章节恢复。文件记录丢失后可重新选择原件；同名异内容文件不会覆盖材料。重解析只用唯一原句匹配更新定位，歧义明确提示。
- 已有收藏按可信语境来源建立材料索引，不改写词条、复习记录或原备份。没有可信来源的旧问答／笔记仍留在原栏目，不猜测归属。
- 来源地址替换保留稳定材料 ID 与旧地址别名，冲突明确拒绝。引用只保存权威记录 ID 和可选原句，材料库不复制问答答案或长期笔记正文。
- 清空推进持久代次，迟到采集、文件读取与导入不能复活旧数据；单条笔记删除与旧编辑竞争独立处理。归档材料不会被阅读位置更新重新激活，界面在忙碌期间收到跨页变更后补刷新。
- 材料不进入配置同步。显式材料备份包含来源、原句、主题和个人笔记；导入校验并报告新增、更新、跳过计数。无痕客户端发送前及后台来源边界均拒绝读写。

集成入口与字段合同见[维护说明](../maintainers/learning-materials.md)。

## 后续 CI 复核与当前状态

首轮生产验收之后，PR 的首次 CI 暴露七个失败测试文件：`selectionTranslatorLifecycle`、`contentRuntimeLifecycle`、`readingPanelStreamingResize`、`documentBatchComponent`、`implementationAudit48K`、`sentenceActionsMount` 与 `i18n`。前六个涉及新增公共入口、组合根或材料消息端口的夹具尚未跟进；相关修复保留原有文档队列、流式展示、手动滚动、恢复和取消断言，并增加真实公共材料端口的行为检查。

`i18n` 是实际本地化回归，不能归为夹具问题：同一测试在 main 基线 90 项通过，当前改动首次扫描产生 390 条未本地化记录。随后为六种非中文界面（en-US、ja-JP、ko-KR、fr-FR、ru-RU、es-ES）各补 134 条静态映射和六类动态模板，覆盖数量、页码、时间与导入汇总，保留真实数字，并验证不会改写用户正文。

| 后续专项 | 已确认结果与日志 |
| --- | --- |
| 组合根与句子操作夹具 | `implementationAudit48K`、`sentenceActionsMount` 共 46 项通过；`/private/tmp/fluentread-material-composition-after.log` |
| 学习中心设置入口 | `backgroundFeatureHandlers` 55 项通过，含 `materials` 实际导航与非法参数拒绝；`openOptionsHandler` 四维 100%；`/private/tmp/fluentread-material-options-handler-20261015.log` |
| 文档队列与阅读面板 | `documentBatchComponent`、`readingPanelStreamingResize` 共 47 项通过；新增收藏、会话和学习笔记仅在成功保存后关联，以及来源不进入模型请求；`/private/tmp/fluentread-material-ci-fixtures-20261015.log` |
| 内容与划词生命周期 | `contentRuntimeLifecycle`、`selectionTranslatorLifecycle` 共 271 项通过；`/private/tmp/fluentread-material-content-selection-after.log` |
| 本地化资源与动态数字 | `i18n`、`i18nMaterials` 共 95 项通过；`/private/tmp/fluentread-material-i18n-accepted-strict.log` |
| 视频字幕面板与材料关联 | `videoSentenceLearningComponent` 33 项通过（原 20 项加 13 项），执行真实材料 begin/complete/client，仅替代边界传输；`/private/tmp/fluentread-material-video-association-accepted.log` |
| userscript 固定资源引用 | `userscriptViteConfig` 188 项通过，保留旧 Greasy Fork 投影断言并校验当前五份资源与固定提交完全一致；`/private/tmp/fluentread-material-userscript-resource-pin-tests.log` |
| OptionsApp 多语言品牌响应性 | CI 中 Chrome 用例约 5.1s 超过默认 5s；主分支／任务分支同名用例对照均通过，未复现功能回归。仅这组三平台用例使用 10s 局部时限，全部断言和清理时限保留；完整文件 45 项通过，`/private/tmp/fluentread-material-options-brand-accepted.log` |
| 当前严格覆盖率范围 | 最终受影响计划包含 209 个测试文件及十六个严格责任模块；十六模块已按专项验证 statements / branches / functions / lines 均为 100%，汇总见 verification.json |

上述批次范围不同，不累加为全量测试总数。原生恢复提示已按显示时的界面语言翻译，来源专项 55 项通过，包含三类英文提示与关闭操作。实际 Vue 模板专项还检查原文保护边界、来源类型、页码、本地文件和默认问答标题；本地化与材料界面组合 104 项通过。最终架构、源码注释和验证归属 1076 项通过，测试审计登记 731 个文件、13195 个静态登记用例。

完成审计补齐了此前视频字幕面板中材料端口被空回调替代的直接行为证据：成功收藏和问答保留原视频来源、原句、时间、采集时间与代次及权威记录 ID；换句后的迟到收藏仍归原句，关闭后的迟到结果、问答停止、失败、缺 ID 和无痕环境不产生错误关联。该补验只改测试，不改变生产源码或已核验的构建产物。

最终源码的类型检查、Chrome/Firefox production 构建、userscript 构建与 verifier、manifest 检查及文档构建通过；userscript 的五份内容寻址语言资源已重新生成并保留旧资源。随后 CI 日志发现语言文件名更新后仍指向不包含新文件的旧提交；固定引用已改为首次包含新资源的 `50e59c08290b47af8ea0d91c9d8403a8841c304f`，没有放宽精确文件名或字节比对。userscript 已重新构建和校验；五个固定提交的 GitHub 原始资源均 HTTP 200，完整字节、内容哈希与本地一致，见[远程资源核对](./learning-materials-20261015/userscript-resource-verification.json)。这次仅改 userscript 构建引用与对应测试，不改变已验收的扩展 UI 和恢复逻辑。远程 CI 状态以 PR 当前提交的检查记录为准，本文不把失败或被新提交取消的 CI 当作通过。

## 首轮验证范围与结果（后续修复前）

下表和随后截图记录首次交付阶段的证据，供保留与比较；它们不证明上节后续改动已经重新通过同样的全部检查。

| 范围 | 证据 |
| --- | --- |
| 材料领域、迁移、客户端与后台 | 38 项专项；六责任模块 statements / branches / functions / lines 均 100% |
| 来源采集、文章定位、视频识别与内容生命周期 | 52 项专项；四责任模块四维均 100% |
| 文档组合根与 PDF 阅读器 | 150 项全部通过，包括异步组件延迟加载、文件切换、PDF 页码、DOCX/EPUB 重解析 |
| 材料 UI、学习中心、视频学习与架构 | 直接受影响专项通过；相关组合批次 209 项通过，后续文档与 UI 批次单独复验，不累加为全量数字 |
| UI 行为、验证归属与源码注释 | 1102 项通过（材料 UI 9、学习中心 18、模块边界 15、归属 20、源码注释 1040） |
| 类型及产物 | `pnpm compile`、Chrome/Firefox production 构建、userscript 构建与 verifier、manifest verifier、测试审计、文档构建 |
| 生产 Edge | 16 个材料操作场景通过；临时 profile，第二屏可见但不抢前台；页面 console/error 为 0，清理确认成功 |

覆盖率汇总与源码摘要的统一归档入口为 [verification.json](./learning-materials-20261015/verification.json)，生产逐项归档入口为 [browser-report.json](./learning-materials-20261015/browser-report.json)。归档保留首轮与后续专项的范围，当前十六模块覆盖率及最终源码、构建产物摘要另行记录。另有 [文档按钮尺寸与中心遮挡检查](./learning-materials-20261015/document-control-verification.json)，记录桌面及 390px 的真实边界和点击命中。

生产验收运行真实扩展后台、内容脚本、Vue 界面、IndexedDB、文件解析和播放器。生成的素材包括本地 HTTP 文章、12 秒 MP4、三页 PDF、90 段 DOCX 和双章节 EPUB。验证以下连续操作：

1. 规范地址去重与同名不同来源；主题、笔记、独立未保存草稿。
2. 原文段落恢复、刷新后位置更新、片段失效后的恢复提示。
3. 视频恢复至 3 秒，实际播放后暂停并保存新时间。
4. 菜单、编辑、窄屏返回的键盘焦点；390px 深色材料界面，以及 PDF、DOCX、EPUB 的窄屏工具栏。
5. 归档／恢复；导出、清空、导入私密备份。
6. 通过真实后台读取收藏、问答和长期笔记，清空材料后原仓库记录仍存在。问答内容使用明确的合成会话 fixture，不调用模型。
7. 词书和 AI 均关闭时独立保存文档。
8. PDF 第 2 页恢复；移除文件记录、拒绝同名错文件、重选原件恢复。
9. DOCX 第 2 页确实显示第 81–90 段；EPUB 第 2 章确实显示对应标题与原文，均在新页面恢复后检查指纹与 DOM。

人工逐张检查截图，关注原文与继续阅读主次、主题信息、深色对比、窄屏溢出、文档工具栏和恢复提示。代表截图：

- [材料详情](./learning-materials-20261015/material-detail-desktop.png)
- [390px 深色](./learning-materials-20261015/material-detail-dark-390.png)
- [PDF 续读](./learning-materials-20261015/document-resumed-page-2.png)
- [DOCX 续读](./learning-materials-20261015/material-docx-resumed-page-2.png)
- [EPUB 续读](./learning-materials-20261015/material-epub-resumed-chapter-2.png)

验收修复了异步 PDF 阅读器尚未加载时提前消费恢复请求的问题：保留待恢复材料，等公开阅读器引用就绪后再定位，并以文档身份与调用代次约束晚到回调。代码复核发现的默认开关门控、焦点恢复、归档笔记编辑和跨页归档刷新问题也已修复并专项复验。

## 后续来源范围的生产复验

注册及组合根调整后，单独运行 `--sources-only true` 完成十一项。该次运行使用实际生产扩展、隔离 Edge、第二屏可见且不抢前台；`consoleErrors` 为空，`cleanupConfirmed` 为 true。[十一项来源复验报告及截图](./learning-materials-20261015/source-followup/report.json)保留原始证据路径 `/private/tmp/fluentread-material-registration-production/report.json`，完整命令与输出在 `/private/tmp/fluentread-material-registration-production.log`。

十一项包含管理菜单键盘操作、规范地址去重、主题与独立草稿、文章定位、刷新位置跟踪、视频时间、失效片段提示、390px 深色界面、归档恢复、私密备份，以及权威学习记录的读取和独立清空。此范围不运行 PDF、DOCX、EPUB 的文档恢复用例。先前完整十六项与文档专选五项是后续修改前的独立记录，不能与这十一项合计为同一版本的生产验收。

该次来源复验位于本地化修复之前。本地化修改使用下面单独记录的最终生产专项验收。

## 最终英文生产专项

`--localization-only true` 在修复后的 Chrome production 包上完成四项：英文界面及原用户文字、390px 材料详情、网页原生恢复提示及关闭、文档材料保存及窄屏中心点击命中。标题“阅读材料”、原句“材料已整理。”及笔记“全部材料已清空。”刻意与词典键相同，均保留原文；界面说明实际翻译为英文。

六张原始截图已复核。英文文档按钮在 390px 下为 x=8、y=86、宽 123.53125、高 30 CSS px，中心命中按钮；无横向溢出。第二屏隔离 Edge 未进入前台，页面 console/error 为 0，临时 profile 清理成功。此专项没有重复运行之前的 PDF/DOCX/EPUB 完整恢复矩阵。

[四项报告](./learning-materials-20261015/localization/report.json) · [英文材料详情](./learning-materials-20261015/localization/material-detail-en.png) · [390px 详情](./learning-materials-20261015/localization/material-detail-en-390.png) · [英文恢复提示](./learning-materials-20261015/localization/article-recovery-notice-en.png) · [英文文档窄屏](./learning-materials-20261015/localization/document-material-en-390.png)

## 重跑

先安装锁定依赖，再使用仓库资源安全入口。日常只运行本次直接相关范围，不调用全量回归。

```sh
pnpm test -- tests/materialRepository.test.ts tests/materialClient.test.ts tests/materialSource.test.ts tests/materialWorkspaceLifecycle.test.ts tests/learningCenterLifecycle.test.ts tests/documentAppLifecycle.test.ts tests/pdfReaderLifecycle.test.ts tests/videoSentenceLearningHost.test.ts tests/videoSentenceLearningComponent.test.ts tests/architecture/moduleBoundaries.test.ts tests/architecture/verificationOwnership.test.ts tests/architecture/sourceFileHeaders.test.ts
pnpm compile
pnpm build
pnpm build:firefox
pnpm build:userscript
node scripts/verify-userscript-build.mjs
node scripts/testing/verify-extension-manifests.mjs
pnpm test:audit
pnpm docs:build
```

生产专项（填写本机 Playwright 包目录和 ffmpeg 路径；产物目录应使用新目录）：

```sh
node scripts/testing/run-resource-safe.mjs -- node scripts/testing/run-material-workspace-test.cjs \
  --extension-dir .output/chrome-mv3 \
  --playwright-root /path/to/node_modules \
  --artifacts-dir /private/tmp/fluentread-material-review \
  --ffmpeg-path /path/to/ffmpeg
```

可追加 `--documents-only true` 仅检查文档保存、恢复和原文件校验。来源专项使用以下独立命令：

```sh
node scripts/testing/run-resource-safe.mjs -- node scripts/testing/run-material-workspace-test.cjs \
  --extension-dir .output/chrome-mv3 \
  --playwright-root /path/to/node_modules \
  --artifacts-dir /private/tmp/fluentread-material-sources-review \
  --ffmpeg-path /path/to/ffmpeg \
  --sources-only true
```

本地化范围可将上述最后一个参数替换为 `--localization-only true`。三种限定范围不能同时指定；不加范围参数才执行完整材料验收。脚本只操作本次临时浏览器及合成内容，结束后清理临时 profile，不提交含原文的备份文件。

## 未覆盖项

本次没有运行全量回归、真实翻译供应商、真实 YouTube/X 站点、Firefox 运行时、Safari、移动真机或用户人工验收，也没有运行真实无痕浏览器会话。YouTube/X 身份与多媒体匹配、无痕边界由确定性 DOM／sender／客户端测试覆盖；这些结果不能代替相应实站或浏览器验证。Firefox 证据仅为构建与 manifest 检查。生产问答 fixture 只证明权威记录读取、展示和材料清空时的保留，不证明在线模型生成链路。
