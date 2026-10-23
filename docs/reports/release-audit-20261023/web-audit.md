# 网页翻译、阅读与学习链路审计

基线：`0ad3d431b425d8e082f15acfce11de23a66b8cc1`。工作目录：`FluentRead-release-audit-20261023`。审计与行为验证在隔离本地端口进行；本报告不把本地模拟结果称为真实站点、在线供应商或实体设备验收。

## 范围与审查口径

本子任务负责 `src/app/content`、`src/app/selection`，以及 full-page-translation、hover-translation、selection-translation、section-translation、input-translation、writing-assistant、floating-ball、reading-assistant、information-highlight、vocabulary、personal-corrections、glossary、paragraph-copy、page-notice、quick-translation、translation-center。

- 静态枚举：253 个 TS/Vue 源文件，基线 AST 共 4167 个函数，43052 行；另有 6 个 CSS 文件。零函数的协议和导出模块也包含在清单中。
- 语义审查：253 个文件的全部函数体已读取，并追踪其主要状态、异步所有权和资源释放；较大的 Vue 组件重点完整读取 setup 与模板事件对应关系。逐函数位置保留基线行号，当前修改以后以 SHA256 和 diff 核对。语义审查不等于运行覆盖，更不是“没有未知 bug”的证明。
- 行为验证：复用现有单元、功能与实际 Vue 生命周期夹具，针对确认问题先运行失败回归，再修复与验证。覆盖率报告仅声明实际参与计算的生产文件，不把 selected scope 的 100% 说成全仓库 100%。
- 清单与证据：`/Users/thinkstu/Desktop/copy/research/release-audit-20261023/web/review-ledger.json`（每个文件、每个基线函数及当前源码摘要）、`reviewed-files.txt`、各测试日志及覆盖率 JSON。清单生成入口为同目录 `update-ledger.py`。

追加范围：`model-usage`、`translation-stats`、`share-card`、`self-help/ui` 及 `src/ui`（ServiceIcon 由主任务负责）。这 36 个 TS/Vue 文件、527 个基线 AST 函数也已读完；独立清单为 `web/ui-extra-review-ledger.json`。服务目录中的供应商配额和外部网址未在本子任务做线上核验。

追加设置 UI 范围：排除主任务明确负责的 16 个文件后，共 70 个 TS/Vue 文件、1550 个基线函数条目，已逐函数读取并核对模板事件绑定。独立清单为 `web/settings-ui-review-ledger.json`；排除列表和当前源码摘要写入清单。本轮未把大型组件的 setup 验证称作完整真实浏览器验收。

## 已确认问题与修复

| 链路 | 根因与修复 | 回归证据 |
|---|---|---|
| 快捷配置 → 悬浮 → 松键触发 | 等待中的手势可继续使用已删除、禁用或修改的快捷方案。冻结方案和按键身份，派发前核对当前方案；有效服务、模型和继承配置也参与身份。 | `quick-tests.log`；配置变更、按键结束、重复移动与销毁回归 |
| 写作入口 → 异步保存 → 卸载 | 保存 finally 可在卸载后重建扫描任务；原 observer 不能跟随 body 替换或被页面移除的入口。增加 disposed 检查，观察文档与实际入口所有权，统一释放。 | `writing-coverage.log`；真实 WritingSurface 生命周期 14 项 |
| 全文 → 标题 → head/html 重建 | 标题观察器只绑定初始 head，替换后丢失更新，旧请求可能覆盖新标题。观察文档与根节点直接子项并重新绑定 head；不深扫 body。 | `title-baseline.log` 旧实现失败；`title-tests.log` 25 项 |
| 全文 → 恢复包装 → 再翻译 | 在“译文在前”设置下，可信克隆/脱离 wrapper 的修复与 synthetic remount 把译文移到了原文后面。保留 bilingualBeforeSource 顺序，恢复仍保留原节点身份。 | `remount-order-baseline.log` 3 项失败；`remount-order-tests.log` |
| 双语句子高亮 → 嵌套 ShadowRoot | 只观察 document，不会收到 shadow 内文字或外层 shadow host 的变化，留下失效范围。按当前来源的 composed 祖先链观察每个根，清空时释放。 | `sentence-shadow-baseline.log`；嵌套根变更、重建和卸载回归 |
| 信息高亮 → 状态查询 → release/dispose | 查询后端状态期间释放或卸载，迟到回复仍可能启动 worker。查询前后核对 disposed、signal、generation。 | `information-lifecycle-baseline.log` 3 项失败；`app-tests.log` |
| 消息取消与缓存消息 | runtime.sendMessage 同步抛错时会跳过本地拒绝或清理。先结束本地等待；远端取消做 best effort，缓存消息同步失败走现有错误响应。 | `app-tests.log`、`reading-viewport-tests.log` |
| Unicode 回退切片 | 无 Intl.Segmenter 时可能拆开国旗、CRLF、ZWJ 组合或在边界处越过预算。按回退字素边界选择结束位置，避免零进展。 | `grapheme-baseline.log`；`grapheme-tests.log` 71 项 |
| 阅读面板 → 材料代次查询 → 收藏/笔记 | 查询未完成时卸载或改变隐私状态，旧操作仍开始写入。使用 generation、当前来源/回答身份、active 与隐私共同判断；完成关联和反馈也核对。 | `reading-save-baseline.log` 4 项失败；`reading-save-tests.log` 36 项 |
| 划词 → 复制 → 关闭/卸载 | 剪贴板迟到成功会重新创建已清理的反馈计时器。捕获翻译代次，完成后核对代次和 disposed。 | `selection-vocabulary-baseline.log` 2 项失败；后续联合日志 |
| 词典/Edge TTS → HTTP 失败 → 回退 | 丢弃 404、限流与合成错误响应时未取消未读流。复用 platform 的 cancelUnreadResponseBody，失败不影响后续来源/音色。 | `selection-http-baseline.log` 3 项失败；`selection-storage-coverage.log` |
| 翻译中心 → 拖动 → 窗口失焦 | 收不到 pointerup 时保留 user-select:none 和拖动监听。blur 走同一撤销清理，卸载移除监听，不保存未完成排序。 | `comparison-drag-baseline.log` 1 项失败；`comparison-drag-tests.log` 23 项 |
| 材料捕获 → 继续阅读 | 可从开放 ShadowRoot 捕获原句，但恢复游标只遍历 light DOM。增加有界深度游标遍历嵌套开放根，复用同一个 observer 检查所有已发现根。 | `material-shadow-baseline.log` 1 项失败；`materialParagraphScan.test.ts` |
| 词书 → 仅本地朗读 → 合成失败 | 词书失败后无条件使用系统朗读，与仅本地模式不一致。统一在回退入口核对当前模式，清理播放并显示失败提示。 | `selection-vocabulary-baseline.log`；实际 VocabularyBook/CollectionEntry 模板 + 真实消息 handler/合成策略 |
| 收藏解释 → 保存 → A/B/A 条目切换 | 组件复用时旧草稿、busy 与迟到结果会串入新收藏。按 entry.id 同步重置草稿并递增代次；成功、错误和 finally 只更新所属代次，仍拒绝卸载后写 UI。 | `saved-explanation-race-baseline.log` 2 项失败；`reading-writing-ui-tests.log` |
| 阅读引文 → Vue prop 校验 | SFC 编译器把 indexed method 类型推断为 String，正常函数回调产生无效 prop 警告。改为显式函数类型，保持参数与返回协议。 | `reading-writing-ui-tests.log`；真实客户端定位、状态和回调验证 |
| 自定义快捷键 → 冲突配置变更 | 只监听快捷键字符串，业务校验函数及其响应式配置改变后提示与确认禁用不会刷新。watchEffect 跟踪当前校验依赖，录制过程中不覆盖输入反馈。 | `hotkey-validation-baseline.log` 1 项失败；`ui-extra-tests.log` |

| 提示词 → 插入占位符 → 页面/模板切换 | nextTick 后未核对编辑对象，旧操作在卸载、配置替换、模板切换后仍抢焦点。复用设置操作身份，并检查当前文本与 editor。 | `settings-control-baseline.log` 3 项失败；`settings-control-coverage` |
| 信息高亮 → 快捷键校验 | 漏检输入框 Ctrl+Enter，且错误占用已关闭的圈选快捷键。核对实际启用状态并加入输入翻译快捷键。 | `info-hotkey-baseline.log`；`settings-control-info-tests.log` |
| WebDAV → 清除连接确认 | 全局确认返回后未核对页面存活、设置会话与连接 revision，旧确认仍会清除连接。绑定确认会话并使用确认前的连接版本；迟到结果不更新新 UI。 | `webdav-ui-baseline.log` 3 项失败；`settings-ui-tests.log` |
| 材料工作区 → 编辑笔记 → 切换/卸载 | `nextTick` 通过全局 ID 聚焦，可能抢走新材料或新页面焦点。改为自有 textarea ref，并复核组件存活、材料 ID 与编辑引用 ID。 | `material-focus-baseline.log` 两项失败；`material-dom-coverage.log` 27 项通过 |

## 性能与结构清理

1. 快捷悬浮鼠标移动按动画帧合并，首次同步处理、释放按键前刷新最后坐标；取消后不留旧帧，重复坐标不重复工作。
2. 写作上下文不再 clone 整个宿主页 DOM。用迭代游标读取有界原文，达到预算即停止；标题、评论、作者等沿用各自小预算，排除不可读与扩展节点，原 DOM 不变。
3. syntheticRemount 复用 bilingualRemountMatching 已有节点路径函数，删除两份重复实现；manpage wrapper 查找从循环 includes 改为单次 Set；modal 优先级一次计算比较，避免重复 getComputedStyle。
4. 词书复习日志使用 toArray 后执行一次带稳定 ID 排序，删除 sortBy 后再 sort 的重复排序。材料导入删除无 await 间隔的重复 busy 判断。
5. 可选 ECDICT 仍先检查严格字节预算和固定 SHA256。摘要匹配后无需每次再遍历 20000 行约 80000 个字段核验不可变形状；结构改由真实固定资产测试验证，运行时继续拒绝摘要错误、缺失/过大响应与损坏缓存。缓存存储失败不丢弃本次已校验词库。
6. 删除没有生产调用的 pageAvailability 自动翻译包装、selection 的冗余语言判断/旧阅读卡布局函数、sectionSourcePreview/describeSectionElement 及其独占常量；viewportStability 使用已存在的 DOM 类型工具；ReadingPanel 取消只交给 stream client，去掉重复 requestId/原始取消消息。
7. 删除的测试仅对应以上已删除旧 API 的 10 个断言，不删除关键产品行为。新增回归复用原测试文件；新增 WritingSurface 生命周期与 readingWritingUiBehavior 以及 settingsControlUiBehavior 三个文件均已向主任务登记。没有为凑覆盖率添加 ignore 或 skip。

8. state 的待处理布局检查点改用 WeakSet：原 removedNodes 集合仅写入从未读取，删除每 owner 的对象/Set 分配与移除节点滞留。删除已由前置分支排除的重复工件修复调用，以及同步维护状态/活动引用不变量下的冗余状态检查。26 文件联合验证翻译/恢复/重挂与控制元素，1236 用例通过。
9. GlossaryLibrarySelect 合并重复 i18n 注入；分享主题删除 8 个从未读取的 uiAccent 值；DiagnosticNotice 去掉未展示的 title 计算，保留 detail、摘要和所有动作。

10. 删除 CompositeTranslationFields 没有模板调用的 add 回调，以及 InterfaceSkinPreview 未读取的 skinLabel prop 和唯一调用处的重复文案计算。

11. 修正整合门禁发现的类型依赖循环：mutationObservation 的标记检查直接声明所需的最小结构，不再依赖高层 TranslationState；保留 viewportStability 的工具复用。模块边界 15 项、全文状态 130 项、视口 42 项共 187 项通过，未放宽架构规则。
12. 六个大型组件测试文件改为直接导入生产 SFC，删除逐用例创建 Vite SSR server 和匿名组件副本；独立 CSS 编译仍仅用于 scope 样式断言。保留原来的异步与几何断言，几何端口改写实际 ref 节点，不再用假的 ref 对象覆盖模板节点。材料与词书用实际 DOM 模板，新增搜索、分页、备份恢复、部分读取失败、删除撤销、主动复习和来源切换回归；CollectionEntry 也单独实际挂载验证父子事件契约。

## 验证与限制

所有测试通过资源安全 wrapper、指定文件运行；没有调用全目录裸 Vitest，中央测试配置由主任务维护；经主任务授权把 RemoteConfigSync/SiteAdaptationSettings 的 owner 登记为真实行为消费者。构建、全量覆盖率、类型检查与最终资源体积对照由主任务统一执行。

已取得的定向四维 100% 包括快捷悬浮及配置身份、WritingSurface 与写作上下文、标题、清理后纯函数/生命周期模块、信息高亮 runtime/消息端口、Unicode 回退、syntheticRemount 与句子高亮。其他定向覆盖如下：

| 实际计算范围 | 用例/测试文件 | 四维结果 | 证据 |
|---|---|---|---|
| 8 个阅读/写作小型 SFC：WritingChoices、WritingLanguagePicker、WritingPopover、WritingStyleEditor、SpeechFollowText、SentenceAnalysis、ReadingEvidence、SavedExplanation | 18 / 1 | 全部 100% | `reading-writing-ui-coverage` |
| Edge TTS、词典、ECDICT、材料段落扫描、词书仓库 | 301 / 11 | 全部 100% | `selection-storage-coverage` |
| CustomHotkeyInput、GlossaryLibrarySelect | 联合 212 / 4 | 两文件全部 100% | `ui-extra-coverage`（其中 themes 未由这组执行，单列如下） |
| 分享卡片 themes | 68 / 2 | 全部 100% | `share-theme-coverage` |
| 设置小型 SFC：ParagraphHandlingSettings、SelectionSettings、ReadingAssistanceSettings、ExcludedLanguageSettings、HarnessPromptSettings | 22 / 1（包括 WebDAV 回归） | 五文件全部 100% | `settings-control-coverage`；WebDavBackup 76.74% statements/lines、80.41% branches、52.94% functions，未声称全文件 100% |
| 正常 SFC 归因的划词、阅读、材料、词书（六文件联合） | 547 / 6 | 划词 S/L 91.59%、B 85.92%、F 84.12%；阅读 98.77/87.61/90.16%；材料 100/86.15/100%；词书 91.19/74.68/68.35%（顺序 S/L、B、F） | `large-sfc-coverage`；明确未达到全四维 100% |
| 阅读面板真实模板追加工具栏、历史与整句交互 | 69 / 2 | S/L/F 100%，B 88.70% | `reading-template-coverage`；比上行联合检查更晚，不覆盖其他组件 |
| 全文 state | 1236 / 26 | statements/lines 99.15%，functions 100%，branches 95% | `state-combined-coverage`；保留未执行防御分支，不声称 100% |

部分大型 Vue 夹具运行实际 setup 和生命周期，但并不提供可靠的完整 SFC 编译后覆盖计数，不能宣称这些 Vue 文件四维 100%。

尚未做真实在线服务、真实任意站点、实体 Safari/移动设备、原生浏览器 TTS 与原生窗口失焦的人工验收。Shadow DOM 支持仅限可访问的开放根；回退 Unicode 分段覆盖常见组合，未声称完整实现全部 UAX #29 规则。报告列出的性能优化以减少操作与预算回归为依据，未提供虚构的毫秒或百分比提速。

本子任务未读取或借用参考仓库代码。图片、离线模型与压缩发布体积由并行资源审计及主任务产物报告统一统计；本子任务只减少网页代码与重复运行操作，不把源码减少量等同于最终 ZIP 减少量。

## 并行修复交叉审阅

另外对主任务 17 个变更文件进行独立 diff 与调用契约复核，涵盖缓存维护、导航、站点设置、userscript 传输/取消/旧设置会话/模型容量复验，以及 ChatGPT bridge/OAuth 响应释放。未确认新的回归。逐路径当前 SHA 和审查契约见 `web/root-cross-review-ledger.json`，结论见 `web/root-cross-review.md`。此部分属于变更交叉审阅，不与上述逐文件全函数审查合并计数。

五份 userscript 远程语言 JSON 已与固定提交 `f804e1b39dbd3313c8bdae9738ebd69a51ad2074` 逐字节核对，文件名摘要均一致（`root-pin-check.json`）；未把本地 Git 对照称为 CDN 在线可用性验证。


## 受控站点测试协议修复

真实站点矩阵使用的受控微软响应原本是“测试译文：”加原文。当前生产语言校验正确拒绝长英文回显，因此这类响应不能用于证明网页翻译链完成。本子任务用真实 `translateMicrosoftTextsWithTransport` 与 `isClearlyWrongLanguageResponse` 写出旧实现失败回归（`controlled-provider-baseline.log`），未改动生产 validator。

受控服务现将正文的 UTF-8 字节逐个映射到基本汉字区，保留空白、完整行内槽、HTML 标签及实体字面值。它是与原文一一绑定、可反算的测试占位文本，不是中文语义翻译，也不是通过附加重复汉字掩盖残留。测试报告明确记录 `utf8-han-v1`；编码长度随原文增长，不能把其排版或时延等同真实供应商输出。

原生信息流、Kagi 与通用站点脚本同步改为核对完整原文归属。逐槽响应合并后必须完整反算对应原文，漏槽、换源、多余正文和旧前缀回显均拒绝；保护子树通过原标签、文本与 href 配对。通用脚本在每次悬浮译文、首次全文和再次全文完成后检查，Kagi 还核对动态标题、原生导航、按钮和闭合 ShadowRoot 的来源。恢复阶段保持原恢复断言，不要求存在译文。

`siteTranslationStability`、`browserFocusSafety`、`siteTranslationMatrixConcurrency` 共 307 项通过，包含真实微软转义/解码、实体数量、槽标记、Unicode 反算及负控；JS 语法检查和 `vue-tsc --noEmit` 通过。证据为 `controlled-provider-regression.log`、`controlled-provider-compile.log`。真实站点矩阵由主任务在固定快照上重跑；本地测试不替代真实 DOM 兼容性，也不提供供应商质量证明。


## 设置页正常 SFC 归因与交互补充

把 quickProfileSettingsLifecycle、localTranslationModelSettingsLifecycle、promptEditorLifecycle、interfaceSettingsLifecycle 的逐用例 SSR server/匿名编译副本改为正常生产 SFC 导入，保留已有 125 个断言。PromptTemplateEditor 与 InputTranslationSettings 共用消费者，因此一并归因；没有改生产类型来迁就夹具。ImplementationAudit49F 仅迁移最后一组 TranslationStyleSettings 的 i18n 实际 DOM 消费者，其他 76 项保持原逻辑。LocalTranslationModel 保留真实后台处理链，Vue 事件拦截只用来验证旧句柄。

InterfaceSettings/PopupLayoutEditor 新增真实模板的皮肤与字体选择、缓存清除确认、模块显示、键盘重排、方向不同的拖放、Escape/dragend 清理及焦点回归。新增 remoteSiteSettingsLifecycle 19 项实际 DOM 回归覆盖远程敏感配置同意、合并选择、分页与恢复方向、删除精确口令、账户切换和卸载后的迟到预览、状态/持久化失败重试，以及站点规则新建、非法主机、编辑撤销、脏表单离开、文件导入竞态、失败保存重试、内置规则覆盖、导出 URL 释放。

六文件完整组合 **223 项通过**（`settings-final-group.log`），`vue-tsc --noEmit` 通过（`settings-final-compile.log`）。这组修改以恢复真实源码归因和有意义的用户边界为目的，没有把匿名组件执行数冒充生产 SFC 覆盖率；实际定向结果如下，均按 statements/lines、branches、functions 顺序：

| SFC | S/L | B | F | 证据目录 |
|---|---:|---:|---:|---|
| QuickTranslationProfiles | 99.81% | 93.54% | 100% | quick-profile-current-coverage |
| LocalTranslationModelSettings | 100% | 83.33% | 100% | local-model-current-coverage |
| InputTranslationSettings | 97.26% | 88.65% | 100% | input-prompt-current-coverage |
| PromptTemplateEditor | 100% | 90.36% | 100% | input-prompt-current-coverage |
| InterfaceSettings | 100% | 96.02% | 96.15% | interface-current-coverage |
| PopupLayoutEditor | 94.33% | 83% | 100% | interface-current-coverage |
| TranslationStyleSettings | 100% | 87.12% | 100% | style-controls-coverage |
| RemoteConfigSync | 99.68% | 83.18% | 88.09% | remote-site-coverage |
| SiteAdaptationSettings | 99.58% | 92.80% | 100% | remote-site-coverage |

这批没有达到全四维 100%，保留真实剩余缺口；相关测试和 Vue 导入入口已登记给主任务。

## 受控协议的真实 DOM 投影补充

S2 固定快照暴露了受控测试工具的进一步差异，未修改冻结快照或生产校验器：

- 日期/计时器只在原 DOM 有 time/role=timer 保护证据时保留；净化后的 custom element 仅允许整段 Text 精确配对。普通正文、错日期、日期加额外正文和缺失日期仍失败。
- 受控 encoder 增加 `__FRTERM_...__` 完整占位符保留。实际 protectGlossaryText → Microsoft 转义传输 → restore 回归证明 © 等受保护字面符号恰好恢复一次，删除/复制/伪造 token 仍由生产校验拒绝。
- 原 DOM 中最外层 MathML/KaTeX 作为单个保护骨架，去掉辅助 annotation/assistive MathML 后核对可见排版文本；内部 aria-hidden 排版不能当隐藏正文删掉。实际 snapshot → renderer → inspector 回归覆盖该差异；错公式或缺失公式仍失败。
- 源码投影依据连接中的元素 computed display/visibility，不从脱离页面的克隆推断 CSS。主任务真实 ar5iv `checkpoint2-dom-focus-probes.json` 与 `ar5iv-original-dom.html` 已确认卷期子元素 visibility:hidden；没有按标题或“Volume”文本特判。可见装饰或样式证据不可读时的遗漏仍失败。
- URL/域名只在真实 a[href] 且整段为标识符时作为原样骨架，文字及 href 必须同时匹配。新增负控发现旧 Text fallback 会绕过 href 匹配，现带 href 或公式禁止这种降级；普通链接正文原样返回继续失败。

`controlled-projection-regression.log` 记录 **315 项通过**（50 个站点稳定性、251 个浏览器焦点、14 个矩阵控制）；Node 语法检查通过。该结果证明受控归属工具的约束，不等同真实服务翻译质量或整轮站点兼容性通过。


## S3 后续归属边界与网页断言复核

GitHub 无 role 的 `relative-time`、`time-ago`、`local-time` 是现有 GitHub adapter 明确保护的元素。受控归属读取现在只在 github.com 上依据这些 DOM 标签保留原样时间槽；实际 core snapshot 的三种标签回归以及普通 span/其它站点的负控证明该规则不按日期文字放行。LearnOpenGL 原段落含 BR，textContent 会漏掉换行；受控来源与输出投影现在读取 Text 和显式 BR，而非全局删除空白。真实 whole-block serialization → provider → applyTranslationsToSnapshot → renderer 测试保持字词内部空格，删 BR、吞字词分隔仍失败。

S3 LearnOpenGL 第二轮的 forbidden nav 失败另有独立原因：原始签名显示导航正文完全相同（1133 字符）、owned/translated 后代均为零、导航与全部链接身份仍有效；唯一结构增量来自第 9 个直属 child `#lefteighttenthad` 的 Ezoic 113 广告，增加空 Google 广告容器及自身 display/query 属性。逐字段差异原证据保存为 `web/learnopengl-nav-failure.json`。测试只把原有第 7 个 `#leftfourthtenthad` 和这个第 9 个空广告槽作为原生不透明内部：槽必须处于精确 URL/位置、保持同一节点与外层属性、不包含正文、链接或扩展产物。导航其它拓扑、文本、属性和全部链接/祖先身份仍严格核对；不把整个 nav 标为可变。第二槽新增 1 个原生更新正例和 8 个损坏负控。

最新 `controlled-full-current-regression.log`：Harness 264、焦点安全 251、来源归属 54、矩阵控制 14，共 **583 项通过**。S3 冻结快照保持不变，生产浏览器的新快照复验由主任务执行。本节没有声称 Bambu 全文 readiness 超时已解决。

## 划词真实模板事件与通知归属补充

实际模板点击发现两条设置反馈问题：配置 AI 讲解的迟到失败会在关闭、卸载或更换选区后重建提示（旧实现 3 红）；收藏“查看”/本地朗读“设置”在后台拒绝时立即清空原提示，并且消息拒绝未捕获（旧实现 2 红）。前者绑定选区及请求身份，后者合并两个重复函数为 `openNoticeSettings`，只处理当前通知的成功/失败，捕获同步和异步消息失败并保留重试入口；成功清理提示计时器，过期、卸载和更新后的通知不被迟到响应覆盖。

进一步增加实际客户端事件：词典重试、中文辅助释义显隐、原文/译文复制、分享、阅读动作与引文定位/清理端口、四种语音路径的完成/错误/旧音频回调隔离、前后跳转、可信鼠标悬停延迟与取消、原生复制不拦截或清除选区，以及 Control 释放后新选区必须再次显式触发。子阅读组件和浏览器音频仍为边界端口，不冒充真实浏览器媒体播放。

`selection-latest-coverage.log` **447 项全部通过**；实际 SelectionTranslator 归因 **193/193 functions 100%，statements/lines 95.50%，branches 88.89%**。剩余防御/平台分支继续如实保留，没有覆盖忽略、skip 或放宽门禁。失败与修复证据为 `selection-settings-baseline.log`、`selection-notice-baseline.log`、`selection-notice-regression.log` 等。

站点规则表单追加完整高级字段往返、导入替换/超限与读取错误、目录分页/筛选/检查 ID 及草稿冲突交互后，19 个 SFC 用例与 21 个编辑模型用例共 40 项通过（`remote-site-ui.log`）。纯编辑模型已验证整个规则包，因此让成功结果直接携带已校验 pack，表单提交不再对同一 JSON 重复解析和重复校验选择器；模型四维 100%，SiteAdaptationSettings 见上表。Remote/Site 的真实行为 ownership 和 Prompt 透明 SFC 分支映射经 **21 项 ownership 门禁**验证（`vue-ownership-regression.log`）。


样式设置在真实 SFC 模板上追加两条完整工作流：颜色/字体/字号上下限与空输入恢复、预览主题与类别、非法 CSS 提示、恢复默认；独立保存两个样式、只更新当前快照、删除与重新选择、空名称禁用。颜色子控件是发出实际 input 事件的受控端口，父模板四处 v-model、真实 SegmentedControl 与预览保持实际代码。6 项 owned-i18n 与样式交互共同通过，样式 S/L/F 已达 100%，B 87.12%。

PromptTemplateEditor 两个直接赋 selection 的旧断言改为原生 textarea select 事件，保持原有容量和连续插入断言。输入翻译新增实际双提示词输入、默认值/恢复按钮、连按间隔重置和当前 popover 事件；38 项通过，两个 SFC 的 functions 均 100%，其它指标见上表。6 个设置测试加站点 Harness 的阶段性整合为 493 项通过（`settings-harness-current.log`，在新增第38个 prompt 用例之前）；该检查时 `vue-tsc --noEmit` 通过（`current-compile-1719.log`）。

## S4 真站失败的分类与修复

S4 的受控归属失败进一步证明，归属核验必须尊重生产槽边界，不能用宽松的子串或空白全删除比对：

- Ubuntu `apt(8)` 的 b/i 命令文字属于既有 Ubuntu manpage adapter 的 literalTokens；只有精确站点、`/manpages/<suite>/man[0-9].../*.html` 和 `#manpage-content section.Sh` 上下文符合时，才按原标签/完整文本及祖先链接 href 配对。改命令、改链接、普通粗体正文、其它主机和普通 Ubuntu 页面仍失败。实际 core snapshot→renderer 回归在旧 oracle 下失败，修复后 55 项稳定性测试通过（`ubuntu-attribution-baseline.log`、`ubuntu-attribution-regression.log`）。
- GitHub 中文槽、MkDocs 链接内 strong 账号名和 roadmap 独立 `+90k` 都被生产规则原样保留。新的 oracle 读取投影后的完整 Text 节点，Node 侧从同一源码树临时编译并调用实际 `shouldSkipTranslationForTarget`、`isNonTranslatableLiveData`、`isIdentifierLikeText` 纯函数，不另写一套中文猜测。只有符合该政策且整个 Text 精确匹配、标识符链接 href 相同的槽才按唯一顺序标记配对；最终仍逐字节反算所有编码文本并比较完整源文。未知英文、数字句子、无链接账号、错链接、错值、交换原样槽和缺少编码响应均不能因此放行。旧实现三个实际快照用例全红，当前 59 项全部通过（`s4-preserved-text-baseline.log`、`s4-preserved-text-regression.log`）。这只修测试归属，不改生产语言校验。
- Wikipedia 页面已滚至 180633.5/180715 像素（剩余 81.5 像素），却先触发固定 320 步限制。滚动预算现根据实测页面高度和每步尺寸计算，仍保持连续视口步进、最多 2048 步、12 次无进展即失败以及底部连续稳定确认。实际滚动函数的 300000 像素页面、途中增高、滚动卡住和无限增高四个回归分别验证可完成、可追随和有界失败；未放宽 provider 或 readiness 超时（`long-page-scroll-baseline.log`、`long-page-scroll-regression.log`）。

Bambu 单独的原生 instrumented run（主任务执行）在 `browser/bambu-checkpoint4-instrumented/full-first-readiness-failure.json` 留下直接证据：正文 p 可见，但唯一可见 `#truste-consent-track` 带 `role=dialog`、`aria-modal=true` 和 `data-trustarc-focus-trapped=true`，当前焦点在其中的 Cookie Notice 链接，正文不属于该对话框。真实按钮是 Cookie Settings / Accept All / Reject All；旧 case 等待的 OK 已不存在。此处属于测试准备契约过时：只将该 case 的准备动作改为 Reject All，在隔离 profile 中通过可信点击拒绝非必要 cookie、等待按钮隐藏后才开始正文流程；不改生产 modal 判定。真实模态检测单测复现同一非居中几何，确认对话框关闭前约束正文、关闭后恢复正文扫描资格。新单次浏览器复验仍由主任务在新的冻结工具/产物上进行，不能把这次诊断失败记为通过。

当前工具组合 `s4-browser-contract-regression.log` 记录 Harness 270、focus 252、受控归属 59、modalPriority 15，共 **596 项通过**。固定 S4 全矩阵被真实前台焦点守门中止；已执行与未执行、工具与产品失败由主报告分别记录，本报告不把部分矩阵覆盖算作整体通过。焦点 helper 修复与原生监视归主任务负责。


核心请求链独立交叉复审记录为 `web/core-cross-review-ledger.json`，含 10 个当前文件哈希与精确范围。重点检查共享入口到 broker 的绝对预算、非枚举 symbol、配置水合前后取消、pending 队列索引及 listener 清理、运行中 lease、免费线路旧成功与新冷却的代次关系、HTTP 原响应与 reader 的非阻塞释放；未发现新的已确认回归。该项是改动与调用契约复审，不宣称重新逐函数阅读整个 broker/client 或执行所有平台传输路径。S4 矩阵并发控制另 14 项通过（`s4-browser-matrix-control-regression.log`），与上节合计 610 项。

设置补充第 2 轮：QuickTranslationProfiles 接入实际 CustomHotkeyInput 子组件，验证预设冲突会随其它方案和默认入口更新即时变化，只有当前合法选择才能保存；另补删除后的相邻/添加按钮焦点、启停、术语、旧目标语言和自定义默认模型往返。LocalTranslationModelSettings 通过真实后台 handlers 执行状态失败后的刷新、下载暂停/继续以及显式取消试译后再试译，取消的迟到结果不能结束新任务。InterfaceSettings/PopupLayoutEditor 通过实际移动按钮、页签按钮和对话框 v-model 关闭流程验证交互。共 **97 项通过**（`settings-controls-final-group.log`）；`current-compile-1800.log` 类型检查通过。

同时删除 Interface 测试中不再使用的 legacy Promise 对话框 mock/回退状态，删除 `if (!state.fontClearActions) return` 静默跳过，将原本始终为零的历史 mock 调用数断言替换为当前确认身份不被重复创建、清理未启动的真实状态断言。没有减少有效生命周期检查。Quick、Local、PopupLayoutEditor 的函数均达 100%，其它维度真实值见表；定向覆盖命令因剩余分支或行未达 100% 正确返回阈值失败，不能把 97 个行为用例通过写成四维全通过。


## S5 后续验证与 S6 冻结交接

生词本新增实际行菜单、管理菜单、筛选分页、导出、收藏笔记、主动复习及朗读生命周期，确认一处生产问题：收到有效 `progress` 事件时把所有非空播放状态都当终态，第一条进度即清除“停止朗读”按钮与活动请求身份。现只在 `ended`/`stopped` 清理；匹配进度保持播放，旧请求结束事件不影响当前朗读。实际模板点击→公共消息事件回归先红后绿（`vocabulary-progress-baseline.log`），48 项生命周期与 6 项公共 TTS 用例全部通过，VocabularyBook 当前 S/L 99.48%、B 87.86%、F 100%。音频、系统朗读、浏览器消息为受控边界，不声称原生媒体验收；取消删除、播放拒绝和缺失条目等剩余分支如实保留。

句子高亮样式通过真实 TranslationColorField、UiSelect 和预览模板补颜色/透明度/线型/粗细、CSS 合法性、快照保存/更新/删除、ID 冲突重试、容量、主题及卸载监听。`sharedUiComponentsLifecycle` 共 105 项通过，SentenceHighlightStyleSettings S/L/F 100%、B 95.95%。悬浮球已有 15 项生命周期改为直接导入生产 SFC，删除匿名编译、转译和 `new Function` 装配；保留自定义 DOM renderer 与外部几何/焦点端口。新增悬停延迟/取消、漫画状态与鼠标空闲收起、键盘焦点、位置同步和触屏取消后，共 19 项加 40 项公开入口用例通过；FloatingBall S/L 99.78%、B 92.08%、F 100%。两组定向覆盖因剩余维度不足 100% 正确以阈值失败退出，没有改阈值或忽略行。

S5 GitHub 时间节点位于真实链接内，净化器删除 `relative-time` 标签但保留同链接内的完整 Text。oracle 现在允许有保护来源证据的整段 Text 配对，同时必须保留完全相同的祖先 href；错链接、去链接、改日期、仅前缀匹配仍失败。真实 snapshot→renderer 回归旧 oracle 失败，当前 344 项通过（`github-s5-baseline.log`、`github-s5-regression.log`）。这没有放行普通日期正文。

S5 Wikipedia 的 sourceHtml 出现辅助跳转文字；生产已有严格的绝对/固定定位、overflow 裁剪、0/1px 宽高和完全闭合 clip 联合判定，oracle 此前仅检查 display/visibility。现按同一可观察几何契约投影，实际生产 snapshot 的 rect(0)、rect(1) 和 inset(50%) 三种回归先红后绿；静态定位、普通 overflow、非闭合裁剪、正文尺寸、部分裁剪以及样式不可读均继续拒绝遗漏。主任务只读原生复核这次未出现该辅助节点，因此不能声称已现场确认其裁剪样式，须由 S6 全文复测验证。

S5 Rust 的滚动探针错误地用 body/html 最大 scrollHeight 作为窗口范围。原生只读 `browser/checkpoint5-dom-boundaries.json` 确认实际 `document.scrollingElement` 是 HTML，高度/clientHeight 均 816，scrollTo(10000) 后仍 0，唯一独立滚动容器为侧栏。测试工具改读实际 scrollingElement 的 scrollHeight/clientHeight/scrollTop，显式指定容器仍优先；同时覆盖水平滚动条导致 clientHeight 小于 innerHeight 的最后一段不可遗漏。5 个新增反例在旧实现失败，当前 Harness 272 + Stability 63 = 335 项通过（`s5-clip-scroll-baseline.log`、`s5-clip-scroll-regression.log`）；保留卡住和无限增长失败，不提高次数或时限绕过。

主任务 S5 原生串行复验已确认 Bambu 的拒绝 cookie 准备后完整“翻译→恢复→再翻译”通过，证据在 `browser/sites-checkpoint-5-focused/bambu-dual-nozzles-full/result.json`。主任务另外记录本轮 9 条路径 6 条通过，其余 GitHub/Wikipedia/Rust 属于上述工具边界，不能以本地工具修复替代新一轮浏览器通过。S6 固定快照和 72 条路径的最终状态由主报告统一记录。

性能证据限定为可复查的操作/预算：写作上下文面对 15000 字符的首片段及其后 15000 字符节点，验证无 cloneNode 且预算耗尽后不再读取后者样式（`writingEditors.test.ts`、`writing-context-tests.log`）；快捷悬浮验证同一帧合并、松键刷新与取消帧；词库保持字节上限与固定摘要后删除重复结构扫描。没有给出未经基准测量的耗时百分比或 ZIP 收益。新增静态源码哈希只用于整合对比，后续并行修改仍以对应 owner 的审查与验证为准。

整合复验 `s6-web-checkpoint-tests.log`：8 个明确指定测试文件、567 项全部通过（实际命令 exit 0）。含词书 54、共享 UI 105、悬浮球与公开入口 59，以及站点 Harness/归属/矩阵控制 349；其中已涵盖最近夹具类型修正和正常 SFC 迁移。该轮是本地确定性整合，不是 S6 浏览器矩阵结果。

顶层内容脚本和 frame 追加公开入口验证：通过真实 hotkeyRuntime 的可信键盘事件切换 QQ/网易/嵌入正文的顶层会话，再由实际 frameSession 跟随最新模型、scope/profile、恢复和 BFCache 授权；消息同步失败撤销工具，重新授权后可重试。顶层真实 feature registry 验证同时启用公开挂载入口、单个挂载失败隔离/重试、关闭清理，以及 Thunderbird 能力否定。两文件共 95 项通过（`content-runtime-coverage.log`），当前定向组合为 runtime S/L96.33/B84.94/F84，embeddedFrameRuntime 94.89/80.32/90.47，qqMailFrameRuntime 99/88.70/97.05；未直接调用内部 setup 函数填计数。`current-compile-1848.log` 已等待命令完成，类型检查 exit 0。

另受并行复核请求，先确认一项 userscript 既有阅读入口缺陷（后续修复见下一节）：SelectionTranslator 保留已启用的阅读偏好与入口，但实际 ReadingPanel 的“词性与句法”点击经过真实 streamReading 和真实 userscript/browser 后显示 `runtime.connect is not a function`。测试按用户期望断言不存在该错误，实际 exit 1；可重放差异在 `web/userscript-reading-reproduction.patch`，完整当时消费者在同目录 reproduction.test.ts，日志为 `userscript-reading-public-baseline.log`。该临时红测验证后从工作树撤回，未隐藏为 skip，也未为冻结版本制造测试失败。原有 Selection userscript 用例只断言 UI 与配置，没有执行真实 transport，不能据其绿色声明该能力可用。

同页传输的最小实现可复用 streamPort、reading handler 和 Harness runtime，但还需要持有端口、取消/断开、配置及页面代次和消息身份契约；目前 platform/platformFull 也缺少 fluentReadHarness 消息路由。完整阅读记录和学习记忆不能直接移植扩展私有 IndexedDB：userscript 的宿主页 origin 与跨站共享 GM 存储边界不同，必须另做明确存储决策。这是当时的实现成本与边界分析；主任务随后授权保留阅读能力并完成以下修复。

## 油猴阅读公共链路与轻量生成修复

实际工具栏点击的红复现之后，保留既有阅读能力，补全 userscript 的 `fluentReadHarness` 消息和 `fluentReadHarnessStream` 端口。端口在同一脚本私有闭包中配对并克隆消息，不经过宿主 DOM 的公开消息总线；连接只接受登记名称，替换 owner 会关闭旧端口，监听器异常不会留下资源。页面身份由组合根签发，消息中的 sender 无权覆盖；路由、BFCache 隐藏、最终 pagehide、停用、站点禁用和有效模型配置变化都会取消旧任务，迟到事件不能更新当前阅读卡。

初始化只在首次阅读请求时加载，等待配置及存储 ready，失败后可重试；退出清理 config/window/document 订阅及端口。真实历史会话、追问、笔记保存和记忆召回继续使用共享 reading handler、conversation、session/memory handler 与 Harness loop。存储采用 core 子任务实现的 GM 不可变操作键和清除代次，不使用宿主 IndexedDB；跨标签不同 turn/笔记不会整包覆盖。初始化后维护过期会话，但不执行会中断其它标签流的全局 recover。已知 manager 提供的 GM_info/GM.info 隐私标志会使历史及记忆拒绝持久化，不能据此宣称所有未知 manager 都可被识别为私密上下文。

直接复用 SDK 生成器的初始诊断产物增加约 568 KB，因此主任务把原 native 生成逻辑、纯模型配置、可见文本过滤与只读工具 schema 拆为共享端口。userscript 精确 alias 该生成端口到 `readingGeneration.ts`：提示词、授权、引用校验、工具次数和会话语义保持共享，只由轻量 fetch/SSE 适配 OpenAI 兼容、Claude、Gemini 和 B站匿名讲解。该实现复用现有端点、鉴权、Key 轮转、错误脱敏及用量归一化，不把阅读请求送入普通翻译提示词。

生成端口以真实 ReadableStream 和锁定版本 SDK 比较实际请求：工具 schema、系统及历史消息、签名推理、Gemini 空文本签名/字符串参数、Gemini 3 缺签名兼容、Claude 并行工具结果合并均有可重放证据。握手拒绝允许换 Key，已收到正文的流错误不重放；所有尝试合并为一次生成统计并计入完整持续时间。读取上限为 4 MiB，SSE CR/LF/多行 data/EOF 均按事件边界消费；取消立即释放 reader，不等待可能挂起的远端 cancel 握手，同一已读 chunk 内的后续更新也被丢弃。无效流、缺失完成原因、错误工具参数和 B站截断不被当作成功。

错误处理有一项明确差异：HTTP 非成功响应保留状态、响应头、请求 ID 与 Retry-After，并立即取消未读 body；轻量端不读取 provider JSON 内的详细解释，因此不能宣称错误文案与 native SDK 完全等价。用量中服务未报告的缓存/推理 token 保持未知，不为了字段完全相等伪造为零。测试仅控制外部模型网络，不是在线供应商或脚本管理器验收。

`userscript-reading-stability-final.log` 的第一轮为 6 文件、166 项（生成50、公共runtime20、GM存储33、真实ReadingPanel34、模块边界15、矩阵控制14），随后新增同 chunk 取消边界。GM 存储由 core 独立完成 33 条与四维100%；native 六模块由主任务完成124条与四维100%。media 独立执行 SDK wire parity，修复前后证据在 `media/reading-parity-probe-before-claude-fix.json` 与 `media/reading-parity-probe-results.json`。当前定向生成/运行时覆盖率仍需最终重算，不能把局部函数100或测试通过称为全源四维100。

包体以最终发布文件字节数为准：轻量端接线后的第一次诊断 standalone 为 3,641,566 bytes，曾比 3,600,000 上限多 41,566 bytes。该诊断已被主任务/media 的静态数据 Base85 编码构建替代：最终实际 3,592,434 bytes，原有门禁验证通过（`standalone-reading-base85.log`），4文件330条集成用例覆盖 codec、真实Vite插件与原始图片完整还原。只对压缩后的静态 CSS/JSON/图片字节换编码，保留内容和许可，不压缩执行源码或删除阅读功能。Base85降低的是原始脚本大小；Vite报告 gzip 约1.675 MB略增，不能宣称压缩后的网络体积下降。Vite中间显示值不代表最终发布文件大小。

## S6 SQLite 归属工具缺口

S6 的 SQLite 全文输出保留了 `select-stmt:` 旁的 hide 按钮文字。实际 core 的 sqlite-docs 规则在 sqlite.org/www.sqlite.org 的 `/lang*`、`/syntax/*`、`/c3ref/*`、`/docs.html` 继承 documentation 的 button 保护，renderer 为安全删除按钮标签但保留其完整 Text。旧 oracle 未识别这个站点保护合同，真实 core→snapshot→renderer 回归按完整归属断言先失败（`sqlite-button-baseline.log`）。修复只为同样精确主机及路径认可来源 button；外站、非文档路径、改成普通 span、删改标签文字或遗漏相邻普通正文仍失败。当前 Stability64 + Harness272 共336项通过，实际 exit0（`sqlite-button-regression.log`）；没有全站豁免交互元素，也未改生产 validator 或不可变 S6 快照。

阅读链路最终补充：用同一个公开生成端口分别跑 native SDK 与轻量实现，发现显式 JSON `null` 工具参数在轻量端被 `?? {}` 误变成合法空对象；原 SDK 保留 null 交给共享校验。5 种无效输入的对照仅 null 失败（`userscript-reading-null-parity-baseline.log`）。最小修复区分缺省 undefined 与显式 null，避免重复实现 schema；实际公共 client→私有端口→轻量 SSE→共享工具执行回归确认只发出一轮模型请求并返回可重试失败。生成83、runtime22、GM存储35、ReadingPanel34 共174条组合通过，类型检查 exit0（`userscript-reading-null-fixed.log`、`userscript-reading-current-compile.log`）。随后只新增公共拒绝与 GM 读取期间导航两条测试，生产保持冻结。

新增轻量链路不只分层单测：`userscript-reading-light-public.log` 确认公开阅读请求实际经过轻量 SSE 端口、共享会话和 GM 存储，完全未调用 mocked SDK；取消公开 handle 会取消真实 Response.body 并释放 reader 锁。当前新两模块完整函数语义清单为74个，哈希和逐函数定位位于 `web/userscript-reading-review-ledger.json`；其它适配文件以明确改动范围交叉复审，不加入已逐函数阅读的全文件数。

最终本地交接：`userscript-reading-final-combined.log` 为4文件176项、实际exit0；`userscript-reading-release-coverage.log` 的141项归因检查也是exit0，生产两模块 statements/lines/functions 均100%，branches 分别为 readingGeneration **98.73%**、readingRuntime **95.12%**。后续将 GM 导航竞态夹具精确定位到已有 `memory-save` 操作的实际读取，避免被后台 session prune 读取混淆；24项全部通过（`userscript-reading-memory-race-final.log`）。`userscript-reading-release-compile.log` 类型检查实际exit0。此覆盖命令用于报告实际指标，未启用中央strict门禁；不能将其exit0表述为四维100或全仓门禁通过，残余防御与不可达分支仍保留。

所有本子任务生产文件已冻结，最后生产改动仅为显式null工具参数保真；后续只更新报告、证据与测试。普通 userscript 的最终体积、Greasy Fork、完整浏览器矩阵和总报告验收由主任务在S7固定快照中统一进行，standalone预算通过不代表其它产物均通过。

## S7 固定快照构建验收与末轮差异复审

主任务完成 Chrome 初次构建后，本子任务在 `candidate-checkpoint-7` 中顺序执行 Firefox ZIP（含源码档）、Safari build、Edge ZIP、Chrome ZIP、Thunderbird XPI、Safari check/verify、manifest 强制 Chrome/Firefox 归档检查、主工程类型检查、docs/storybook 类型检查及完整构建/产物校验。15个步骤均实际exit0，状态、命令、PID和日志记录在 `checkpoint7-web-build-results.json`。另补 Safari ZIP，再对六个归档执行CRC32以及全部文件的原始字节对照，组合命令exit0；结果在 `checkpoint7-archive-byte-verification.json`。安装包的文件集合与构建目录完全相同；Firefox源码档按既有排除规则生成，归档中全部1913文件与S7快照逐字节一致。

S7准确字节数：Chrome 35,889,270；Edge 35,888,734；Firefox 35,889,880；Safari 35,843,860；Thunderbird 36,032,891；Firefox源码档49,832,096。每个归档的SHA256及解压条目摘要一并保存，不能用另一次重建的ZIP时间戳差异冒充源码变化。Safari工具链检查通过，但本轮未签名、安装或执行真实设备验收。主任务确认S7属于中间快照，后续LocalData新修复须由S8重新绑定，不以S7构建替代最终版本。

审查台账末轮校准实际复核了四个变化文件：ModelUsageDashboard、TranslationStatsDashboard的确认会话闭包、异步查询/清除代次、同步失活及inert释放；UiLanguageOnboarding删除重复确认守卫后的唯一同步入口；translationLoadingIndicator的CSS抽出及原样注入/adopt/fallback调用链。未发现新的已确认问题。抽出CSS与原模板正文在仅去掉新文件头注释和边缘空白后，14142字符完全一致。`ui-extra-review-ledger.json` 保留旧哈希reviewHistory，并明确记录“原全函数审查＋完整后续delta及受影响调用链复审”，不是盲盖当前哈希；独立记录为 `web/ui-extra-checkpoint7-delta-review.json`。

## S8 固定快照构建与同输入压缩对照

`candidate-checkpoint-8` 的同一验收流程扩为17个独立步骤（包括SafariZIP与六归档核对），全部实际exit0；详见 `checkpoint8-web-build-results.json` 与 `checkpoint8-archive-byte-verification.json`。本轮Chrome、Edge、Firefox、Safari、Thunderbird、Firefox源码档的准确字节数分别为35,889,225、35,888,776、35,889,834、35,843,900、36,032,839、49,832,183。所有安装归档文件集合和字节均与对应S8目录完全一致，源码档1913文件也与快照逐字节一致。主任务原生浏览器矩阵从独立的527文件Chrome复制运行，本次重建没有改写该浏览器的加载目录。

为区分压缩设置与整批实现变化，在正式构建结束后用相同527个文件、相同固定ZIP时间戳、相同JSZip版本顺序生成level6/9控制包。两者以及正式level9归档均通过CRC与内容SHA256一致性校验。level6为36,024,047 bytes，level9为35,889,225 bytes，同输入减少134,822 bytes（0.3743%）；生成耗时这次为6.02秒与10.51秒。这是并行发布检查期间的单次打包观测，只说明本次更高压缩等级的打包成本，不是插件运行速度基准。

原始基线同输入level6/9分别为36,022,785与35,887,947 bytes（基线自身的level9收益134,838 bytes）。S8正式包相对基线level6减少133,560 bytes，相对基线level9增加1,278 bytes；未压缩文件总量从84,159,016降到84,126,600 bytes。整体差异包含代码、清单和资源变化，不能全部归功于图片优化；文件名哈希改变也不等于新增功能数量。全部控制ZIP、正式ZIP和基线SHA256及逐项变化保存在 `checkpoint8-compression-comparison.json`，正式发布包未被控制实验覆盖。

S8冻结内容的docs与Storybook构建和校验已通过。本节及最终验收状态属于构建完成后的报告追加，没有重新构建整个文档站；生产文件保持冻结。真实站点、服务和设备的最终验收范围由主报告分别记录，构建成功不代替这些检查。

## S8 浏览器中止归因与 S9 前公共入口补充

S8 串行72路径在焦点保护中止前共21通过、1普通失败、1焦点中止、49未运行。LearnOpenGL 悬浮在翻译前的页面合同等待超时：h1/h2/p 已存在，但必需的数学 script 未出现，未生成任何译文；不能据此认定翻译实现失败。随后该站全文两轮104个译文包装均通过。Qt悬浮及全文均通过，清理和临时profile删除已确认，原生焦点违规均为空。

真正的exit86来自 MkDocs 悬浮，原生监视捕获了所属 Edge 进程激活，随后保护逻辑停止矩阵；最后截图与激活相隔约367ms，只能建立时间关系，不能认定哪一个动作或用户操作造成激活。没有重新启动浏览器或自动重试，现存日志、焦点报告、截图和待运行清单保留。只读归因及证据哈希在 `web/s8-browser-readonly-diagnosis.json`。

S8全源覆盖指出 `src/app/content/runtime.ts` 有8个尚未执行的组合回调。补充了3个公开联动场景：runtime消息经真实字体控制器安装样式并发出通知，停用时撤销；真实Ctrl+Enter经输入控制器发送请求，配置代次变化取消迟到响应，新目标能写回，停用后拒绝新请求；真实悬浮和信息高亮热键执行当前页面许可、后端评分和停用清理。被测runtime及这些生产控制器没有mock，只为浏览器DOM布局、CSS Highlight、Shadow UI和外部后台提供确定性端口；无须新增生产封装或修改门禁。

`content-runtime-public-links.log` 的52项全部通过，`content-runtime-public-compile.log` 类型检查实际exit0。定向 `content-runtime-public-coverage/coverage-summary.json` 确认该入口函数为50/50（100%），语句及行均为214/218（98.16%），分支88/101（87.12%）；这是该测试文件单独执行的精确范围，不声称全仓或该模块四维100。测试将在S9快照中纳入，S8固定产物不被追写。

## S9 后 GM 存储独立复审与必要修复

末轮独立复审发现可复现的数据丢失：A编辑已确认笔记，GM已存新版但确认回执尚未返回；B读取新版并清理旧正文，再删除另一条无关笔记；A因删除代次变化回滚新版，使从未被删除的笔记新旧正文都消失。跨ID同时编辑为相同内容也有同类回滚丢失。真实公开API探针在 `web/final-gm-storage-race-probe.json`，正式原实现37项中新增2项失败的证据在 `web/gm-confirmation-race-red.log`，并未用私有函数或伪造模块代替被测存储。

修复将不可见的 `memory-pending` 准备副本与不可回滚的v2正文提交分开，二次验证代次、重复和已知200项限制后再发布；提交后即使回执失败也不删除已发布正文。准备副本不参与旧正文GC，过期清理不影响写入者持有的候选。跨ID内容冲突最多保留一份已确认前值，回退身份不会占用其他主正文的去重位置，也不会被其他ID的内容墓碑删除；明确删除自己的ID和清空仍严格生效。普通顺序编辑只保留一个正文操作及一层前值，不积累正文版本链。独立审查又发现并修复“回退抢占第三个已确认ID”和“删除同内容另一ID误伤回退”的边界；修前14时序中的红例保留于 `core/final-gm-protocol-probe-4f88-red.json`，最终14条均通过。

最终源码SHA256为 `508fb8ea2ddffba068381cd646cb72e7569a45211cca1aca04dfec69de291364`。正式存储50项、公共阅读runtime25项、轻量生成84项共159项通过，实际exit0；存储定向覆盖为语句/行347/347、函数33/33、分支371/371，四维100。该文件全部96个AST函数节点的语义复审已加入 `web/userscript-reading-review-ledger.json`；AST节点数与V8计数口径不同。旧数据读取测试中200条、每条约2000字符，5次内存异步GM端口观测中位2.96ms，每次200次get、1次list、0次remove；这不是实际脚本管理器I/O性能基准。

GM仍不提供跨标签CAS，200项并发投影不承诺线性一致，墓碑增长仍是已知边界。v1只是本轮未发布草案，不承诺与草案标签全面混跑兼容；v2隔离和保守GC防止旧解析器物理清理新正文，最终验收应刷新旧草案页面。以上修复需进入新的S10构建，S9包、站点结果和覆盖不能充作修复后的发布验收。完整结论与证据哈希见 `web/final-gm-storage-cross-review.json`。

## S10 构建与归档最终验收

固定S10快照（基于 `e2bc77814b6a5de0f976dd6ee2c2656f08335aef`）顺序执行Chrome构建及此前17步，18项全部实际exit0；同输入ZIP6/9对照也exit0。安装包最终字节数为Chrome35,889,242、Edge35,888,774、Firefox35,889,838、Safari35,843,840、Thunderbird36,032,845。五种安装包的全部解压文件与S9逐字节相同，符合本次新增修复仅在userscript存储内的范围；最终脚本产物由主任务另行汇总。

Firefox源码档在构建后只移除快照工具创建的 `audit-snapshot.json`，不修改任何仓库源码或安装包。原1913条归档（49,831,991 bytes）另存证据，净化后1912条、49,501,566 bytes。其余每个文件与原档和S10快照逐字节相同，CRC及强制归档清单再次实际exit0；未发现其它相同类型工具元数据，也没有检出文本源码中的本次E/R绝对路径。该后处理仅清除审计工具附带信息，不能计作插件安装包优化收益。

S10 Chrome同527文件、固定时间戳、同JSZip版本的level6/9分别为36,024,071与35,889,242 bytes，减少134,829 bytes（0.3743%）；本次生成耗时约6.15秒与10.59秒。正式包相对原基线level6减少133,543 bytes，相对原基线level9增加1,295 bytes，未压缩总量减少32,436 bytes。完整归档SHA、源档后处理前后SHA、18项日志SHA及压缩口径在 `checkpoint10-web-acceptance-summary.json`。本轮没有启动浏览器，构建成功不代替真实站点或设备验收。本节属于S10文档站构建后的报告追加，未重建整个文档站。


## S11 最终固定候选构建验收

最终验收对象是 `candidate-checkpoint-11`，精确基于 `c2d128c6349baf1c19108e40f99c9ae5d5ee01f0`。Chrome完整构建、Firefox/Edge/Chrome/Safari归档、Thunderbird打包、Safari工具链与清单、主工程/docs/Storybook类型检查、docs/Storybook完整构建及产物检查、六归档字节检查，共18项全部实际exit0。另行执行的净化后CRC/逐文件字节、强制归档清单和同输入压缩对照也均exit0。所有1151份生产源码在构建前后均与S10 SHA256一致；6756文件快照变化仅涉及已明确的测试与报告，不包含生产修改。

最终归档字节数为Chrome **35,889,242**、Edge **35,888,770**、Firefox **35,889,838**、Safari **35,843,840**、Thunderbird **36,032,845**、Firefox源码档 **49,501,566**。六档均通过CRC，安装包全部文件集合与对应S11构建目录完全相同，源码档1912文件与S11快照逐字节一致。源码档后处理仅移除工具生成的 `audit-snapshot.json`：原档49,832,001 bytes及其SHA另存证据，仓库源码和安装包未改变；检查未发现其它同类工具元数据或文本源码中的本次E/R绝对路径。该净化是源档交付处理，不能计作插件安装包节省。

源码相同不代表构建字节完全相同。Firefox、Safari、Thunderbird及净化后源码档内容与S10相同；Chrome和Edge各仅 `background.js` 增加44 bytes。只读分析定位到CryptoJS MD5从立即初始化变为带幂等标记的CommonJS require包装，内部3108-byte算法函数体逐字节相同，并伴随压缩局部符号重命名。锁定Vite 5.4.19的自动CommonJS包装实现与此现象相符，但本轮未追踪具体构建顺序原因；忽略标识符拼写的AST结构比较仅为诊断，不能充作整体运行语义等价证明。S11以自己的归档SHA验收，不复用S10字节哈希或浏览器结论。详见 `checkpoint11-background-md5-diagnostic.json` 与 `checkpoint11-installation-content-delta.json`。

S11 Chrome同527文件、固定时间戳与同JSZip版本的level6/9为36,024,058与35,889,242 bytes，同输入减少 **134,816 bytes（0.3742%）**。本次顺序生成耗时约5.75秒与10.71秒，仅是并行检查期间的打包观测。正式包相对原基线level6减少133,543 bytes，相对原基线level9增加1,295 bytes；未压缩文件总量84,126,624 bytes，相对基线减少32,392 bytes。整体变化包含代码、清单、资源及构建转换，不能全部归因于图片优化或压缩等级。

18项日志、六档SHA256、净化前后SHA、源码等价与构建差异证据统一绑定在 `checkpoint11-web-acceptance-summary.json`。没有启动浏览器，也未进行真实设备安装或Safari签名验收；此前真实站点证据仍仅属于其各自固定产物。本节为S11文档站构建后的报告追加，未重建整个文档站。后续远端main变化及其冲突未合入此精确候选，不将该候选描述为最新main验收。
