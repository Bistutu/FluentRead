<!--
 * @file docs/reports/progressive-reading-20261011.md
 * 文件职责：记录主动渐进阅读的交付范围、验证结果和证据边界。
 * 主要内容：说明四档帮助、明确掌握提示退场、页面所有权，以及针对性测试、构建和隔离浏览器验收。
 * 模块边界：只记录本次实现与可复验事实，不声称真人理解提升、在线翻译质量或未执行的平台运行时验证。
 -->

# 渐进阅读：2026-10-11

从 `origin/main` 的 `c8a06bb5fe0148f629ecaf60e70e5bf6ebb4f957` 开始，在 `codex/progressive-reading-20261011` 独立工作树实现；先整合主分支 `69d41e5e1050e5004d4656963d5105f24df9d8ed` 的网站规则和导航改动，再整合 `11860f3f2233155ff27765a51b27b9d6aeb5109e` 后复验。后一次整合联合保留渐进阅读只读提示合同、主分支视频收藏语境及来源纯函数，以及双方测试登记；Popup 布局与阅读 UI 不受冲突影响。没有修改参考仓库或复制参考实现，没有新增权限或依赖；新增两个可选的学习快捷键偏好，默认均不绑定。Popup 整合保留主分支的规则保存确认、忙碌状态和禁用中断，并在规则保存时阻止渐进阅读重复发起。

## 使用与行为

网页选择一个词、表达或正文段落后，点击 Popup 的「学习」；也可以先开启面板，再选择正文并点击「读取选中正文」。每段新原文从「只读原文」开始，可以自由切换短语提示、逻辑线索和完整双语。任何档位均可一步打开完整双语，无需学习反馈或逐级查看。

Popup 的「翻译」「局部」「学习」以 42px 高度紧凑同排，学习位于局部右侧。主按钮默认合并显示「翻译（⌥+T）」并保留加载状态，还原时改为「还原（⌥+T）」；读取实际设置并按平台显示，长组合只在悬停提示中完整展示，移除独立快捷键框与静态“A↔译”；“始终翻译此网站”和“在此网站禁用扩展”保留独立按钮，移除它们共同的外层框。仅选文或悬停不会自动触发渐进阅读。

学习快捷键默认为「未设置」，旧配置也保持无快捷键，通过点击入口打开。鼠标悬停或键盘聚焦入口显示用途、当前快捷键与「设置快捷键」入口，直达翻译设置的学习分区；录制自定义组合后才支持按键打开，清除后回到只点击。设置检查其他已启用动作的冲突，网页运行时在输入框、编辑区域、扩展面板、组合输入或重复按键中不接管；配置修改即刻生效，禁用/卸载取消监听。

以下 18.2 秒动图展示真实浏览器中的触发与操作：点「学习」打开空面板，拖选正文，点击「读取选中正文」，自由切换短语、逻辑和完整双语，最后关闭面板。若先选好了有效正文，再点入口会直接读取，可省去手动读取一步。

![渐进阅读实际操作动图](./progressive-reading-20261011/progressive-reading-demo.gif)

录制单独运行 `--record-demo`，使用本机测试正文和确定性翻译响应；Popup 在独立扩展测试标签中按实际 320px 宽度呈现，不是原生浏览器工具栏录屏。字幕和粉色指针是演示辅助，页面、选区和阅读面板为真实生产扩展行为。录制共有 91 帧、660×720、5 fps；28 次焦点采样未抢占前台，控制台错误为 0，学习记录未改变，自有浏览器和临时 profile 均已清理。[录制报告](./progressive-reading-20261011/demo-report.json) 与[帧时序](./progressive-reading-20261011/demo-timing.json) 单独保存，不计入下面的 21 项验收。

短语提示合并少量本地多词表达、主动选中的短表达和现有收藏。收藏只投影最多 24 次命中的坐标、所请求目标语言的已有参考及保守掌握证据，不返回收藏地址、笔记、语境或学习日志。只有当前状态为 mastered、最新时间的日志均为 manual-mastered、时间与当前学习状态对应、原文与保存语境相同且没有跨源语言同词歧义时才自动收起。「仍需要帮助」可恢复这些提示；学习中心的显式变更沿用已有通知刷新提示。停留、滚动和模式切换不写学习状态。提示展示和查询保留阅读快照中的真实词面与大小写。

逻辑线索只引用否定、可能性、条件和适用范围的词面标记。表达翻译沿用当前服务及页面上下文开关，不保证判断当前义项；完整双语提供理解歧义的额外原文语境。原文、规则和已保存释义不会自动调用模型，表达或完整译文仅在用户请求时调用既有翻译客户端。

面板使用封闭 Shadow UI，不改写网页文字、链接或原生 Selection。只读快照排除表单、编辑区、代码、交互控件、隐藏和禁止翻译内容及扩展 UI。关闭面板清空会话、取消请求、停止正文观察并移除 UI；禁用和页面卸载进一步注销功能监听；原文变化清空旧结果并提示重新选择，迟到结果不得返回旧会话。精确匹配的已完成网页双语摘录可复用；同一阅读会话已取得的译文也直接复用。

无痕模式不读取学习库，用户脚本、原生 PDF 和 Thunderbird 不提供 Popup 入口。面板沿用 FluentRead 默认划词卡片的粉色品牌、白色表面和灰色分隔，支持亮色、深色与系统自动主题。长说明使用可聚焦的原生展开入口，保留原文与四档操作的优先级；不向宿主页面应用界面皮肤或下载字体。

## 验证

验证命令均限定为本次功能和受影响组合入口，未运行全量测试矩阵或全仓 coverage。

| 专项 | 结果 | 覆盖率边界 |
| --- | --- | --- |
| 提示规则与异步会话 | 36 tests 通过 | hints/session 四维均 100% |
| 原文所有权、内容生命周期与可选快捷键 | 22 tests 通过 | source/content 刷新后四维均 100% |
| 学习库只读提示与后台 handler | 27 tests 通过 | readingHints/handler 四维均 100% |
| Popup 页面动作及内容入口 coverage（整合前） | 9 文件、400 tests 通过 | pageActions/messageRuntime/learningFeatures 四维均 100%；上述模块整合后源码散列未变 |
| 最新主线整合后的阅读与词书兼容性 | 6 文件、86 tests 通过 | 本功能 77 项与视频语境 9 项 |
| 最新主线整合后的入口组合 | 9 文件、346 tests 通过 | 直接入口、Popup、生命周期；通用 49F 基线单列 |
| Popup 可见性 | 31 tests 通过 | 用户脚本、PDF 和 Thunderbird 门禁 |
| Popup 布局与学习帮助回归 | 90 tests 通过 | lifecycle、visibility 和 key information 三个限定文件 |
| 学习设置、配置与相关组件 | 8 文件、224 tests 通过 | 新建/旧配置、取消、清除、KeepAlive 与双向冲突 |
| 快捷键纯规则与设置协调 coverage | 117 tests 通过 | progressiveReading / useTranslationShortcutSettings 四维均 100% |
| 用户脚本构建隔离及语言契约 | 39 tests 通过 | public alias、空适配、不可达文案裁剪与固定资源 |
| 模块边界、源文件说明及验证所有权 | 963 tests 通过 | 3 个限定架构文件 |
| TypeScript/Vue 类型检查 | 通过 | pnpm compile |
| 测试归类审计 | 通过 | 669 文件、11,262 cases 的静态审计；不代表执行全套用例 |
| Chrome / Firefox 生产构建 | 均通过 | WXT 0.20.18；不是 Firefox 实机验收 |
| 用户脚本构建与 verifier | 均通过 | 2,048,450 bytes，最新主分支的既有预算 2,050,000 bytes；本功能未放宽预算 |
| 文档构建 | 通过 | VitePress 1.6.3 |
| 隔离真实 Edge 专项 | 21/21 通过 | 生产扩展、确定性本机 HTTP 响应 |

额外组合初查发现 `tests/implementationAudit48A.test.ts` 的 1 个既存请求头期望失败：HEAD 的 Bilibili 内置 Origin-removal 规则与同一 HEAD 测试的 `addRules=[]` 期望不一致。该测试和请求头 runtime 在本分支均未修改；本次不修复范围外规则、不将该测试计作通过。最终入口 coverage 排除 48A，依靠直接覆盖消息入口的测试验证上述三个模块。

整合 `11860f3f2` 后，含通用 49F 的入口组合为 417 通过、3 失败（总计 420）。失败均为未改动的 `implementationAudit49F.test.ts` 中 pinned-data virtual catalog consumer：共用 VM 重复声明 `catalog`，报 `Identifier 'catalog' has already been declared`。在独立 `git archive` 主分支副本、同一依赖版本下只运行这三个用例，复现同样的 3 个失败；其余 71 项跳过。[主分支基线日志](./progressive-reading-20261011/49f-main-baseline.log) 保留准确结果。该问题不计作通过，也未修改范围外测试或目录压缩逻辑；移除整个通用 49F 文件后的直接入口组合为 9 文件、346 项通过。归档副本仅补 WXT 生成 compiler 配置，主分支源码与测试未改动。

```sh
pnpm test tests/progressiveReading.test.ts tests/progressiveReadingSource.test.ts tests/progressiveReadingContent.test.ts tests/vocabularyReadingHints.test.ts tests/vocabularyBackgroundHandler.test.ts
pnpm test tests/popupFeatureVisibility.test.ts tests/userscriptViteConfig.test.ts tests/userscriptUnsupportedCapabilities.test.ts
pnpm test tests/popupAppLifecycle.test.ts tests/popupFeatureVisibility.test.ts tests/popupKeyInformation.test.ts
pnpm test tests/progressiveReadingHotkey.test.ts tests/progressiveReadingSettingsLifecycle.test.ts tests/translationShortcutSettings.test.ts
pnpm test tests/popupPageActionsOwnership.test.ts tests/contentMessageRuntime.test.ts tests/sentenceActionsMount.test.ts tests/implementationAudit48K.test.ts tests/implementationAudit49F.test.ts tests/contentTrustBoundary.test.ts tests/contentRuntimeLifecycle.test.ts tests/popupAppLifecycle.test.ts tests/popupFeatureVisibility.test.ts
pnpm test tests/architecture/moduleBoundaries.test.ts tests/architecture/sourceFileHeaders.test.ts tests/architecture/verificationOwnership.test.ts
pnpm test:audit
pnpm compile
pnpm build
pnpm build:firefox
pnpm build:userscript
pnpm docs:build
```

新可执行模块已登记 coverage 所有权；加入学习配置纯规则的严格清单与两份测试的唯一归类。专项以 `--coverage.include` 分别限定 `hints.ts`、`session.ts`、`source.ts`、`content.ts`、词书 `domain/readingHints.ts` 与后台 handler，以及三个受影响入口模块，逐模块检查四维 100%，不降低现有阈值。用户脚本在构建期排除渐进阅读注册和消息分支，并以既有 alias 机制隔离 Vue 面板；沿用整合后主分支的体积预算，本功能未放宽预算。

最新主分支整合没有改变先前九个模块的源码散列。这次补充快捷键后，source/content 与快捷键纯规则、设置协调模块重新取得四维 100%；其余七个未改源码模块的原 coverage 证据继续单列保留。86 项阅读/词书与 346 项直接入口属于上次主线整合结果；本轮新增设置 224 项、内容 22 项、Popup 90 项及用户脚本 39 项独立记录，不把它们相加为互不重叠的总数。

浏览器专项命令：

```sh
node scripts/run-progressive-reading-test.cjs \
  --extension-dir .output/chrome-mv3 \
  --playwright-root <本机 Playwright 包目录> \
  --focus-safe-helper scripts/testing/focus-safe-browser.cjs \
  --artifacts-dir /private/tmp/fluentread-progressive-reading-final
```

专项使用自有临时 Edge profile、第二屏后台正常窗口和生产扩展。真实输入通过 CDP 操作，持续采样焦点，结束后关闭自有浏览器并删除临时 profile。服务端响应是本机确定性 HTTP 夹具；Popup 在测试标签中替换 active-tab 查询并捕获关闭动作，其余页面与后台路由真实执行。

验收覆盖 Popup 入口与 320px / 400px 三按钮同排操作、渐进阅读在局部右侧、无静态“A↔译”和网站规则外框、原生正文拖选与宿主 HTML 保留、四档自由切换、多词表达、明确掌握退场和恢复、熟词异语境仍有帮助、词面逻辑线索、一步完整双语、同会话译文复用、Tab/Enter/Escape、390px 滚动控件可达、宿主链接和按钮、DOM 替换、延迟请求关闭重开、总开关禁用恢复及页面卸载。

最终专项另有三组学习快捷键验收：默认无绑定的悬停/聚焦说明与设置深链，真实录制保存后关闭重开与 Popup 提示同步，按键幂等打开、输入/编辑区让行及清除后立即不响应；设置与开启原文面板未请求翻译，也未写学习记录。还检查 320px / 400px Popup 中长组合的完整悬停提示与缩写主按钮文字、宿主 DOM 不变的纯 history.pushState 路由切换与迟到请求取消。报告记录 57 次焦点采样，`launchMode=macos-background-cdp`、`focusPolicy=launchservices-no-foreground`、`windowPlacement.mode=background-visible-no-focus`、第二屏 normal 可见窗口及 `browserFrontmost=false`；控制台错误为 0，自有浏览器已关闭且临时 profile 已删除。品牌 UI 复验额外断言真实 `color-scheme`、亮暗表面和正文对比度（约 16.27 / 12.97）、自动主题跟随，以及键盘展开词面说明；新增四档面板截图，共 14 张。

![学习入口悬停说明与快捷键设置](./progressive-reading-20261011/popup-learning-help.png)

![学习快捷键默认未绑定](./progressive-reading-20261011/learning-settings-default.png)

可审阅证据：[浏览器报告](./progressive-reading-20261011/report.json)、[验证摘要](./progressive-reading-20261011/verification.json)。截图逐项复核布局、文本及焦点可达性：

| 模式截图 | 用户可以做什么 |
| --- | --- |
| [只读原文](./progressive-reading-20261011/panel-original.png) | 先尝试阅读选中的正文与段落上下文 |
| [短语提示](./progressive-reading-20261011/panel-phrases.png) | 查看本地/收藏参考，恢复已收起的熟悉提示，按需查询表达 |
| [逻辑线索](./progressive-reading-20261011/panel-logic.png) | 查看原文中的否定、可能性、条件、范围词，并展开词面说明 |
| [完整双语](./progressive-reading-20261011/panel-bilingual.png) | 直接对照原文与完整译文 |

![320px Popup 缩写按钮与长组合悬停提示](./progressive-reading-20261011/popup-320-long-hotkey.png)

![桌面完整双语与宿主原文选区](./progressive-reading-20261011/desktop-bilingual.png)

![390px 键盘直达完整双语](./progressive-reading-20261011/390-keyboard-bilingual.png)

网页已有双语 artifact 的精确复用本次由单元合同验证，未做浏览器专项验收。Firefox 只验证编译和生产构建；未验证 Firefox 实机、真实服务的义项/翻译质量、真人理解率或真实移动设备。
