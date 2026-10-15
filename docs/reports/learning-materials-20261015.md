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

## 验证范围与结果

| 范围 | 证据 |
| --- | --- |
| 材料领域、迁移、客户端与后台 | 38 项专项；六责任模块 statements / branches / functions / lines 均 100% |
| 来源采集、文章定位、视频识别与内容生命周期 | 52 项专项；四责任模块四维均 100% |
| 文档组合根与 PDF 阅读器 | 150 项全部通过，包括异步组件延迟加载、文件切换、PDF 页码、DOCX/EPUB 重解析 |
| 材料 UI、学习中心、视频学习与架构 | 直接受影响专项通过；相关组合批次 209 项通过，后续文档与 UI 批次单独复验，不累加为全量数字 |
| UI 行为、验证归属与源码注释 | 1102 项通过（材料 UI 9、学习中心 18、模块边界 15、归属 20、源码注释 1040） |
| 类型及产物 | `pnpm compile`、Chrome/Firefox production 构建、userscript 构建与 verifier、manifest verifier、测试审计、文档构建 |
| 生产 Edge | 16 个材料操作场景通过；临时 profile，第二屏可见但不抢前台；页面 console/error 为 0，清理确认成功 |

十个可执行责任模块的覆盖率汇总与源码摘要在 [verification.json](./learning-materials-20261015/verification.json)。生产逐项结果在 [browser-report.json](./learning-materials-20261015/browser-report.json)。另有 [文档按钮尺寸与中心遮挡检查](./learning-materials-20261015/document-control-verification.json)，记录桌面及 390px 的真实边界和点击命中。

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

可追加 `--documents-only true` 仅检查文档保存、恢复和原文件校验。脚本只操作本次临时浏览器及合成内容，结束后清理临时 profile，不提交含原文的备份文件。

## 未覆盖项

本次没有运行全量回归、真实翻译供应商、真实 YouTube/X 站点、Firefox 运行时、Safari、移动真机或用户人工验收。YouTube/X 身份与多媒体匹配、无痕边界由确定性 DOM／sender／客户端测试覆盖；这些结果不能代替相应实站或浏览器验证。Firefox 证据仅为构建与 manifest 检查。生产问答 fixture 只证明权威记录读取、展示和材料清空时的保留，不证明在线模型生成链路。
