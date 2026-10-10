# 体积、设置同步与图片悬浮优化（2026-10-10）

本轮在独立工作树 `FluentRead-performance-experience-20261010`、分支 `codex/performance-experience-20261010` 完成。先冻结 `a95a9f9e0` 作对照，优化提交为 `a2bc0415c`；随后合入 `55d1219bd` 的阅读恢复与导出改进，单独执行集成验证。未修改参考项目，也未借用参考实现。

## 改动与测量

| 改动 | 优化前 | 优化后 | 口径 |
| --- | ---: | ---: | --- |
| 设置外部回写的完整草稿序列化 | 54 次 | 2 次 | 执行真实 SettingsSections 组件，按草稿对象计数 |
| 设置页启动的完整配置序列化 | 53 次 | 7 次 | 真实生产扩展、五次独立文档，每次结果一致 |
| 图片未命中/隐藏时位置读取 | 4,000 次 | 1,000 次 | 1,000 张图、四层嵌套容器，精确生产函数 |
| 图片多重叠时位置读取 | 1,000 次 | 2 次 | 第二个命中即可确认歧义，返回值仍为 null |
| 皮肤单选组 Tab 停靠点 | 14 个 | 1 个 | 真实生产扩展，方向键和 Home/End 保持焦点与选择一致 |

设置保存继续使用同步 watcher。仅在外部权威配置的一批赋值期间暂停 getter，恢复时保留水合 guard；不延迟用户编辑，关闭页前仍同步交接完整补丁链。归一化与序列化异常、卸载迟到通知、嵌套编辑以及立即关页均有针对性回归。

图片位置与显隐缓存仅存在于一次命中检查内。后续帧重新读取，不把旧位置、显隐或重叠状态沿用到新图片；不穿透弹窗，不扩大祖先扫描范围。图片设置和阅读记录管理分别通过独立 `ui/public.ts` 出口加载，避免设置组件的 Vue 样式副作用进入网页脚本；设置界面继续使用原组件。

## 冻结版本体积对照

| 产物 | 基线 | 优化后 | 减少 |
| --- | ---: | ---: | ---: |
| Chrome 构建目录全部文件 | 61,630,454 B | 61,341,848 B | 288,606 B（0.468%） |
| 网页 content CSS | 189,144 B | 94,143 B | 95,001 B（50.2%） |
| 支持站点 frame CSS | 99,773 B | 55,864 B | 43,909 B（44.0%） |
| 邮箱 frame CSS | 99,773 B | 55,864 B | 43,909 B（44.0%） |

优化后的三个内容脚本样式均不再包含 `manga-settings`、`image-ocr` 或 `harness-history`。AI/OCR 引擎与功能保持原有打包方式。上表使用同一锁文件和构建参数，属于 `a95a9f9e0 → a2bc0415c` 的优化，不混入后来主分支的 PDF 字体和其他功能成本。

集成 `55d1219bd` 后，另从该提交导出干净源码快照并使用相同依赖重建基线：Chrome 全部文件为 **67,375,068 → 67,086,447 B**，减少 **288,621 B（0.428%）**。这个对照包含最新主分支新增的 PDF 字体和导出能力，不能与上表的旧基线直接比较来归因本轮优化。

启动采样中，设置页 ready 中位数为 359.5 → 312.4 ms，网页为 228.0 → 228.4 ms；设置页脚本时间和堆内存没有稳定下降。样本只描述本机五次打开，运行期间存在其他任务的资源竞争，不能把这些时间当作跨设备提升保证。结论以确定的操作数和实际产物字节数为主。

## 验证范围

- 真实组件、IME、同步退出和失败恢复回归通过；单独检查图片悬浮入口组的命中、歧义、布局变化、关闭与卸载。
- 架构边界检查确保新 UI 出口保留设置消费者，Userscript 空能力入口继续提供原运行契约。
- 冻结优化和集成最新主分支后，Chrome、Firefox、Userscript 生产构建均通过；最终 Userscript verifier、Chrome/MV3 与 Firefox/MV2 manifest 验证、类型检查与文档构建通过。
- 最终集成针对性测试为 10 文件 / 219 项通过；另有图片悬浮组 12 项和真实配置关闭交接 1 项通过，合计 232 项。分类审计为 634 文件 / 10,275 个声明用例，无违规分类或跳过。这不是全量执行结果。
- 真实 Edge 使用临时 profile 和本地网页，在第二屏正常可见窗口后台启动：`macos-background-cdp`、`launchservices-no-foreground`、`background-visible-no-focus`，前台检查为 `browserFrontmost:false`。
- 皮肤方向键、Home/End、首尾循环、单一 Tab 入口、立即关闭后重开保存、外部配置同步、浅深色和 390px 无横向溢出通过。测试只操作本次临时配置。

原始图片运行时整文件测试存在 16 个漫画预合成/缓存用例失败；未优化的基线也复现同样 16 个失败。这些不是本轮新增的悬浮命中回归。没有运行全量测试，没有验证 Firefox 实机、在线翻译供应商、所有站点或低端设备。

## 复核入口

```sh
pnpm test tests/settingsSectionsLifecycle.test.ts tests/interfaceSettingsLifecycle.test.ts tests/settingsCompositionAutosave.test.ts tests/translationShortcutSettings.test.ts tests/settingsUiArchitecture.test.ts
pnpm test -- tests/imageTranslationRuntime.test.ts -t '图片入口独立开关与右键身份'
node scripts/testing/run-startup-performance.cjs --kinds options,content --runs 5 --extension-dir .output/chrome-mv3 --artifacts-dir /private/tmp/fluentread-startup
node scripts/testing/run-interface-skin-keyboard-test.cjs --extension-dir .output/chrome-mv3 --artifacts-dir /private/tmp/fluentread-skin
node scripts/testing/analyze-bundle-size.mjs .output/chrome-mv3 /path/to/baseline-chrome
```

原始构建、计数与浏览器报告位于本机 `/private/tmp/fluentread-performance-experience-20261010/`；组件计数说明位于 `/Users/thinkstu/Desktop/copy/research/performance-experience-20261010/ux-verification.json`。截图经过人工检查；窄屏截图必须滚动到皮肤组，不能用其他设置区域代替该组的布局证据。

## 后续候选

`defuddle/full` 的数学与 Markdown 依赖被多个内容脚本重复打包，但直接换基础包会改变标题、列表和表格上下文。后续应先建立真实脱敏 HTML 语料和结构对照，再评估精简；本轮保留正文提取语义。frame CSS 的剩余重复资源仍遵循 WXT 同名入口路径，未直接删掉文件或改变资源引用。
