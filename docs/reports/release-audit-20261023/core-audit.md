# 核心、服务、供应商和平台审计

审计基线为 `0ad3d431b425d8e082f15acfce11de23a66b8cc1`。范围：`src/core`、`src/services`、`src/providers`、`src/platform`、`src/shared`。本子范围的可执行函数已完成逐函数阅读，验证仍在继续；不据此推导不存在缺陷或已经符合发布条件。逐文件进度以独立证据目录的 `review-ledger.json` 为准。AST 函数索引和语义审查分开记账，静态候选不等于死代码。

证据目录：`/Users/thinkstu/Desktop/copy/research/release-audit-20261023/core`。全局索引脚本位于该目录上级 `inventory.mjs`，输出包含源码 SHA、函数位置、导入导出和未使用候选。

## 扫描层级

基线范围共 373 个 TypeScript 文件、4,459 个函数节点（含回调/表达式）。339 文件完成全文与函数关系阅读，8 个大型目录完成全部函数体与依赖审阅但未逐字审校静态表，26 个无函数资源文件完成 imports、组合调用、数据 schema 与重复字面键检查。静态资源检查见 `static-contract-inspection.json`。这不是对所有语言文案与统计语料的母语准确性证明，也不是代码覆盖率。新增 requestDeadline 模块和本轮修改的函数另有定向回归。

## 已确认并修复

1. **未读 HTTP 响应与 clone 分支滞留。** 多个免费/传统供应商在失败时 drain `response.clone()`，可能读入整个错误正文且留下原始 tee 分支；其他路径直接抛错而不取消正文。统一复用 `cancelUnreadResponseBody`：不创建 clone，不等待可能永不结束的 cancel，处理同步异常和迟到 reject，正常已消费响应保持原状。响应 reader 已锁定时仍由持有 reader 的代码负责取消和释放。覆盖原生 AI 错误、OpenAI 成功响应归一化后废弃的原始分支、Google 429、ChatGPT 事件入口、模型下载、Drive/WebDAV 及传统/免费供应商。媒体组复用同一 helper 处理 PDF、HLS 等链路。
2. **配置观察者抛错改变已提交写入结果并阻止后续通知。** authority/historyRuntime 分别隔离同步观察者异常，不泄露配置到日志。真实写入、初始订阅和历史监听场景回归。
3. **翻译排队取消仍占用队列等待。** pending job 监听调用方 signal，取消时直接摘除并拒绝；已开始 provider 保持原有占位直到工作实际结束。client 单条、批次和视频入口均传递取消信号。
4. **免费服务较旧成功覆盖较新 429 冷却。** 健康状态 reset 绑定请求所见 generation，迟到成功不清除后续失败的冷却。
5. **配置水合等待脱离取消和请求总时限。** availability 入口建立不可枚举内部开始时间，使用与 broker 相同的初始预算解析等待水合；broker 按水合后最终服务配置计算同一开始时间的绝对截止时间。明确 remaining-budget 标记仍优先。真实 app runtime composition 用例验证水合耗时从 provider 可用预算扣除、永不 ready 的配置结束、迟到 ready 不派发。
6. **开启侧栏翻译时 nav/aside 直接文本仍遗漏。** inline run 结构排除判断现在接收 engine 的同一侧栏策略，全文发现和 hover resolve 均覆盖直接文本与段落并列场景。
7. **文档内联标记校验二次复杂度。** 原每个已配对 ID 都重新扫描全部 marker counts，改为一次建立 occurrence 表后查询。512 个内联标记与重复标记混合的真实校验测试保留完整性与拒绝缺失标记语义。

8. **Drive/WebDAV 超限 reader 取消卡住。** 超限路径原先 await reader.cancel，底层不结算时请求无法返回。统一 `cancelResponseReader` 发起取消并立即释放锁，吞掉清理同步异常与迟到 rejection；正常 EOF 只释放锁。两条真实 ReadableStream red 用例验证原缺陷。
9. **i18n 字典与读音语言别名误命中 Object 原型。** `constructor`、`toString` 等未知 key 原来会返回函数，读音 track 则可能抛异常。明确只读 own property，未知文案保留原 key、未知语言返回不支持；核心翻译/旧文案/读音入口有真实回归。
10. **开发 ChatGPT bridge 的水合与流取消无界。** pairing 存储读取现受同一次取消/15 秒预算保护，状态读取与 HTTP 共用截止；迟到 fetch 正文取消，SSE cancel 不等待底层永不结算的握手，并释放 reader 锁。公共构建仍保持套餐能力停用。
11. **界面字体下载资源遗漏。** HTTP/长度拒绝、切换后迟到 fetch 均取消未读正文；完成和失败均释放锁。实际流用例覆盖无界 cancel、同步 throw、迟到 reject、正常 EOF 和切换所有权，原 6 个失败已复现并转绿。
12. **站点名单重复解析。** 页面私有 matcher 在配置名单内容变化时更新索引，路由复用最近地址的基础域；纯函数存在性查询命中即停止。保留原地修改数组、同值新数组、禁用优先级、无效域名和全局自动翻译语义，测试位于 siteRules.test.ts。

## 死代码与测试精简

- 删除 `getCompositeTranslationProviderLabel`、`isUseCustomUrl` 及旧双语语言标签 helper；实际 UI 已使用 catalog/显式配置条件/`getUiLanguageDisplayLabel`。
- 删除仓库 `importMissing` 旧入口；历史存储迁移仍由 `configStorage.ensureMigrated → importMigrationSnapshotIfAuthorityMissing` 的原子 compare-and-set 负责，保留加密失败和迁移测试。
- 删除 `getRawRecord` 纯透传；原密文断言直接读取 repository 已公开的 database records，3 文件 72 测试通过。
- 删除只被测试调用的 `bm25Signal`、`explainRecord` 包装。检索生产入口 `rankRecords` 原本就一次解析查询并调用同一 BM25 算法；频次、上限、近期性、重要度、稳定排序和解释断言转到真实排序结果。删除不存在于生产调用的 avgLen 参数测试。
- 删除只被测试调用的 `speechTextSlices` 和旧算法单元测试。实际 `SpeechFollowText` 使用 `speechTextTokens`；保留 SelectionTranslator 真实进度、trim 偏移、富文本完整性和降级语音边界断言。以上两组清理 5 文件 477 测试通过。

- 删除测试专用 `createTranslationCore` 生产工厂，17 个测试迁到 tests/helpers/translationCore.ts，实际核心类和默认适配器保持同一入口；17 文件 611 通过。
- 删除仅测试使用的诊断 label/summary 包装，断言使用实际翻译 key 与语言解析器；2 文件 123 通过。
- 删除未在 registry 注册、无生产调用的 Lingva transport 与对应测试分支；保留历史 ID 迁移和图标别名兼容。Lingvanex 是另一条实际服务，未删除。5 文件 390 通过。
- 删除恒 false 的 `isUseAkSk` 及恒定断言，根任务同步移除不可达 UI；旧配置字段、凭据迁移和绑定规则保留。删除四条已无界面引用的旧 AK/SK 文案。
- `registerAllUiLanguageBundles` 移到测试 helper；构建期 JSON/扩展名称生成仍在生产 bundles 模块。三个仅为测试投影 source 列的函数删除，测试直接检查生产 rows，保留重复源行检测。
- 删除 config diff 的 `formatEndpoint` 单层透传。

## 可复现性能证据

- `response-cleanup-benchmark.json`：64 个本地 1 MiB 429 流，baseline 读取 67,108,864 字节、64 次 clone、0 次源流取消；修复后 0 字节读取、0 clone、64 次取消。单次本地耗时 105.98 ms → 19.89 ms。此数据说明失败清理避免无用下载，不代表真实网络全链路提速比例。
- `inline-marker-benchmark.json`：2 次预热、7 次样本，中位数。2048 个 ID 的 Map 遍历项 4,200,448 → 8192，144.85 ms → 8.45 ms；512 个 ID 263680 → 2048，11.25 ms → 2.27 ms。两版输出一致；访问计数与计时分开执行，不将仪器开销算作优化收益。

## 主要验证证据

| 链路 | 证据 | 结果 |
| --- | --- | --- |
| 配置水合与总预算 | runtime-hydration-before-corrected.log / runtime-hydration-after.log | 真实 composition baseline 5 失败，修复后组合 266 通过 |
| deadline/availability 覆盖 | deadline-coverage-final.log / deadline-coverage/coverage-final.json | 3 文件 259 通过；两模块四维均 100% |
| 队列取消/client | queue-client-final.log | 4 文件 238 通过 |
| 旧成功/新冷却并发 | free-health-baseline-immutable.log / free-health-after.log | 不可变 baseline 1 失败；3 文件 85 通过 |
| native AI/OpenAI | native-ai-cleanup-before.log / native-ai-cleanup-after.log | baseline 12 失败；7 文件 313 通过 |
| Google 429 | google-cleanup-before.log / google-cleanup-after.log | baseline 超时；3 文件 75 通过 |
| ChatGPT 入口 | chatgpt-cleanup-after.log | 2 文件 45 通过 |
| 侧栏直接文本 | sidebar-inline-before.log / sidebar-inline-after.log | baseline 2 失败；3 文件 383 通过 |
| 文档标记 | inline-markers-after.log | 1 文件 29 通过 |

以上为定向结果，不能代替根任务统一执行的架构、完整回归、类型检查、构建和全局覆盖。历史 `free-health-before.log` 因排队执行时源码已改不能作为 red 证据，已用不可变 baseline 重跑并以上表文件为准。真实服务、在线账户、真实浏览器和设备验证未由本子任务执行。

## 补充验证与覆盖归因

| 链路 | 证据 | 结果 |
| --- | --- | --- |
| 云响应 reader 超限 | cloud-reader-before.log / cloud-reader-after.log | baseline 2 失败；修复后 3 文件通过 |
| i18n 原型 key | i18n-prototype-before.log | 真实旧实现失败 |
| bridge storage/status/SSE 与读音 | bridge-annotation-before.log / bridge-status-before.log / bridge-status-after.log | 旧实现分别 5、1 失败；最新 3 文件 150 通过 |
| 字体下载清理 | interface-font-cleanup-before.log / interface-font-cleanup-after.log | 旧实现 6 失败；2 文件 62 通过 |
| i18n 测试包装删减 | i18n-dead-helpers-after.log | 4 文件 169 通过 |
| 诊断提示 SFC 归因 | coverage-attribution-before.log / coverage-attribution-after.log | 同一 73 条行为测试：0 → 行/语句/函数 100%，分支 91.5% |
| 服务配置完整 SFC 归因 | service-attribution-full-after.log | 原 66 条测试通过：行/语句 88.17%，分支 77.73%，函数 60.71%；模板真实执行后函数分母增大 |
| Popup 完整 SFC 归因 | popup-attribution-after.log | 原 22 条测试通过：行/语句 73.75%，分支 70.82%，函数 37.5% |
| 设置主表单及子表单 SFC 归因 | sections-attribution-after.log | 原 67 条测试通过；主表单行/语句 85.37%，分支 82.80%，函数 41.93%；SettingsNumberInput 四维 100% |
| Options 完整 SFC 归因 | options-attribution-after.log | 54 条生产行为测试通过：行/语句 96.70%，分支 93.98%，函数 75%；移除 3 条仅验证已删除 SSR 夹具服务器的测试 |

覆盖归因改进只把已有真实执行从匿名编译转到 Vite 直接导入；没有增加镜像用例、覆盖率 ignore 或静态读取计数。上表明确保留未执行分支，不能把局部覆盖当作全源码 100%。


## 后续边界与重复计算验证

- Google 与 Qwen-MT 的语言 alias 字典只匹配自身项；此前 `constructor` 被序列化为 `null` 或丢失，`__proto__` 被序列化为对象。`provider-language-keys-before.log` 保留 4 个真实失败，`language-matching-after.log` 记录 4 文件 210 通过。
- 个人校订复用单次查询的 token 集合；原近似排序用例扩展到支持上限 1,000 条，仍只返回 5 个建议且不自动替换。`repeated-work-benchmark.json` 使用修改前不可变源码与当前生产模块、相同输入逐项对比：查询分词 1,000 → 1；9 组每组 5 次的本地 Node 中位 32.62ms → 15.94ms。不是浏览器端性能承诺。
- 语言补充检测复用整段统计评估，保留正字法、功能词、分句及重叠窗口反证；512 个前后样本等价，已有预检取消/缓存/混合语言回归通过。
- 删除 `getUiLanguageLabel` 的死七路 fallback（唯一调用者已有穷举字典）；未知输入仍回退中文。旧文案处理删除可证明不可能触发的正则空匹配与最终生成器空结果 fallback，新增复合文案空段与首尾空白验证。
- MAIN-world bridge 新增真实适配器 CustomEvent、开放/关闭 shadow 及 history 恢复验证。`core-boundaries-after.log` 记录 124 通过。
- 新增各原生 AI 的正文消费阶段取消、空最终文本/仅思考内容拒绝和智谱 optional-key 凭据切换验证。Google 删除仅初始化后立即替换的空 listener wrapper；Microsoft 删除共享 transport 已完成基数验证后的重复空结果判断，并统一 lease 透传。
- LinkeDOM 原 TreeWalker 未调用 acceptNode，导致浏览器大页 privacy filter 未真正执行。提取通用测试 DOM 端口，仅实现 whatToShow/skip/reject；userscript 原测试改用同一端口，browser 大页新增隐藏、表单、编辑器、自有节点剪枝断言。`context-and-microsoft-after.log`：5 文件 267 通过。

## 发布检查点后的补充验证

- 13 个核心覆盖缺口的定向组合为 28 文件、1,087 条用例，通过记录见 `core-gaps-current.log`。该次组合行/语句 99.23%、分支 95.78%、函数 100%，未宣称四维全覆盖。`core/i18n/index`、`core/i18n/language`、shadow page bridge、DeepSeek、智谱、豆包在该组合达到四维 100%。
- Google 正文消费现覆盖超时后忽略取消的迟到正文、遵守取消的正文、调用方原始异常和 Unicode 数字实体边界。原生 AI 的 6 个迟到 JSON 用例改为真实 Response/ReadableStream，删除另一文件 5 个重复取消测试，97 条组合通过。没有通过复制 provider 实现构造覆盖率。
- Microsoft adapter 的数组/空项、不可变配置、显式 batch 优先级和物理调度槽均执行公开 adapter。原两个仅 transport 注入的迟到 header 测试改为完整 adapter → scheduler → transport，用真实迟到响应及永不结算的 cancel 验证释放时点；26 条通过，adapter 四维 100%，见 `microsoft-adapter-coverage.log`。
- 6 组服务目录/服务编辑/免费服务/模型图像/Popup 服务/Popup 子组件测试去掉匿名编译与每例 SSR server。315 条既有行为断言保留，增补同步权限异常和真实模板搜索/模型验证边界后 320 条通过，见 `service-popup-attribution-after.log`。该组 11 个组件行/语句 99.44%、分支 93.01%、函数 94.11%；未执行的模板回调仍按缺口报告。
- `popupAppLifecycle` 的 131 条原有完整生命周期用例改为真实 SFC 导入，保留 KeepAlive、诊断、页面/权限竞态、当前页字体、焦点与真实配置存储交接。另把 `popupActions` 的 3 条单函数源码抽取测试迁到真实组件，并删除该文件手写 AST/new Function 加载器；真实冲突用例使用合法独立组合键。6 文件 330 条通过，见 `popup-app-actions-migration.log`。PopupApp 行/语句 94.95%、分支 91.72%、函数 87.87%；PopupSiteRule 四维 100%。
- `settingsSectionsLifecycle` 67 条用例全部执行真实父模板，移除 render:null 与空节点 renderer，展示容器透传 slot；保持原有数值、懒加载、异步所有权及返回来源断言。主表单行/语句 86.23%、分支 84.59%、函数 41.93%；尚有模型/服务编辑处理缺少真实事件测试，见 `settings-sections-full-coverage.log`。
- 语言共享 harness、Selector、Onboarding 的旧手工编译迁为 Vite 正常导入，删除重复导入解析和源码 Transition 改写，以及历史对照实验专用源码替换钩子。4 组 127 条原有保存/回滚/外部更新/旧事件/焦点断言全部通过；真实加密 IndexedDB 和 store 组合保留。UiLanguageSelector 四维 100%，UiLanguageOnboarding 行/语句/函数 100%、分支 96.77%，见 `ui-i18n-real-module.log`。

### 检查点 2 子进程用例超时的根因

`implementationAudit49J` 的 spawn-error 测试在当前 worktree 328ms 通过，指定不可变检查点 2 源码后单独仍稳定 5,007ms 超时。测试还未启动待测坏命令，报告初始化的同步 `git status --porcelain` 已耗尽 5 秒：原 worktree 48ms，复制 Git 指针的快照 5,009ms 后 ETIMEDOUT。不是待测 `error`/`close` 收尾悬挂，也不是全量套件负载推断。

将该子进程/归档夹具的 `executePlan` 明确设为它自己临时目录 `{cwd: fixtureRoot}`，不改 runner 和 timeout。继续导入原检查点 2 runner，3 条公开编排测试（spawn 错误、非零退出、正常退出）887ms 全过，报告内容、锁释放和日志断言仍在。证据：`49j-isolated.log`、`49j-checkpoint-isolated.log`、`49j-checkpoint-fixed.log` 及最后目录内真实 child 退出收据。

## 设置数值归属的新缺陷与后续事件验证

- **高级重试数值的迟到事件覆盖新配置。** 实际 SettingsSections 模板的数值控件 change 在外部同步、分区切换、KeepAlive 停用/恢复或卸载后仍调用旧稳定处理器。重试次数、Key 恢复分钟、退避初始/最大等待会改写新草稿；未卸载的表单会继续提交。`settings-retry-ownership-before.log` 7/7 失败记录真实父模板与受控数值控件边界；不是复刻处理函数。
- 将已有 AI 超时操作身份扩为共享请求设置身份，覆盖同页 5 个值、配置对象、当前面板及生命周期；每个模板事件捕获当前身份，过期事件无副作用，当前事件仍可正常编辑。退避上下限一次原子提交，分钟和秒仍在确认时转换成毫秒。`settings-retry-ownership-after.log` 3 文件 198 通过，`settings-retry-boundaries-final.log` 主表单 100 用例通过，包含非法值拒绝、1–60 分钟规范化与上下限单次提交。
- 新增主表单真实子 emits 合约验证：编辑目标与默认翻译服务分离、当前目标显式设默认、内置/自定义模型增删和 Thinking、删除旧 custom 不误删 custom:1 的凭据与匿名偏好、删除组合后的功能引用清理。14 个厂商字段可见性与模型密钥作用域在当前父 props 上检查；不会用镜像 factory 代替生产计算。
- 删除 SettingsSections 未被任何生产/测试消费者读取的 `showMachine`、`model`、`showCustom`、`showCustomModel` 四个 computed；唯一调用的 `createServiceCompute` 和覆盖同别名的 `filteredServices` 包装删除，直接派生当前编辑服务。模型选择仍由 `useServiceModelOptions` 提供，默认服务保持 `config.service`。跨源码包括模板与 `compute[]` 检索无动态读取，4 文件 217 用例通过（`settings-dead-compute.log`）。
- 语言引导补充 KeepAlive 返回时外部控件已聚焦、键盘排队焦点前 DOM 脱离两条真实边界。`confirm` 不导出，唯一生产入口 `onboardingActions.confirm` 在同一同步调用中已执行 `current()`，两者之间无 await、外部调用或可重入 getter，因此删除内部重复 active guard，保留所有公共旧按钮/等待/重入保护测试。`ui-language-boundaries-final.log` 4 文件 129 用例通过，Selector 与 Onboarding 四维均 100%。
- Popup 新增首次引导的扩展/系统语言回退、ready 失败不保存、保存失败可重试、主题媒体更新、AI 与图片开关、独立悬浮方案概要及二维码真实事件。`popup-boundaries-final.log` 记录对应组合结果；文中全局覆盖仍以根任务不可变检查点为准。

### 延迟设置及父模板事件的追加核验

- **悬浮/划词延迟旧输入覆盖新配置。** 两个原稳定 change 处理器在外部同步后仍写入当前草稿；划词页离开、缓存停用/恢复和卸载也未撤销旧处理器。`settings-delay-ownership-before.log` 保存 5 个真实模板失败。分别复用现有 `useSettingsActionContext`，让字段、配置和页面身份改变后旧输入失效；改为确认时交接规范化值，避免直接 v-model 绕过校验。保留原有步长、0–2000ms 范围及清空恢复规则。`settings-delay-ownership-after.log` 2 文件 150 用例通过。
- 主表单新增真实父模板事件覆盖：通用服务/目标语言/显示模式，系统主题，暂停保留功能偏好，视频独立服务/源语种/词库，图片与圈选独立即时广播，写作服务继承，快捷方案列表，网站适配仅写局部补丁，保存失败再次编辑重试，以及自定义快捷键的真实 cancel→modelValue 关闭顺序。`settings-field-paths-final.log` 122 用例通过，主表单 L/S 98.8%、B 89.27%、F 98.96%；当时唯一未执行函数是浮球样式导航回调，随后补到原有导航用例，未新增空断言用例。
- Popup 的语言控件与抽屉关闭交接补入真实组件测试后，`popup-boundaries-final.log` 3 文件 203 用例通过，PopupApp L/S 98.59%、B 92.59%、F 100%。这说明全部登记函数已被执行，不代表每个分支或真实浏览器环境都已覆盖。
- `sixth-migration-compile.log` 当前工作树 `vue-tsc --noEmit` 退出 0；后续继续修改的来源应以根任务最终固定快照复验为准。

### 跨模块独立复审

- **统计确认框旧事件操作新会话。** 独立复核 root 的失活/迟到回复修复后，两种统计页的旧 DOM 确认、取消、遮罩 click 与 Escape 在失活后重开时仍能调用稳定处理器。旧确认实际发出新的 reset，其他旧事件会关闭当前确认框并解除背景 inert。`stats-dialog-session-before.log` 8/8 失败。将既有 resetRevision 改为响应式会话版本，模板直接以 `:onClick`/`:onKeydown` 绑定捕获身份的动作，避免 Vue 对 `@click="actions.close"` 生成动态读取新动作的缓存包装；保留遮罩 self 与当前失败重试行为。`stats-dialog-session-after.log` 55 用例通过（47 原有 + 8 回归）。这是新增发现，不把 root 原有迟到 Promise 修复误记为本轮发现。
- **userscript 错误分派未知类型消息。** 普通翻译 fallback 原来只检查 `origin`，未知 typed 消息也会进入 provider，与扩展后台的无 type 协议不一致。标准/完整脚本均真实复现；现在要求非数组、自有 origin 且无自有 type。有效无 type 请求继续走共享 registry，SPA 后取消仍归属首次上下文。`userscript-typed-origin-before.log` 两个适配器失败，`userscript-typed-origin-final.log` 脚本平台、完整设置与扩展翻译 handler 3 文件 90 用例通过。
- Popup 删除只有单一内部调用的 `setImageTranslatorEnabled` 透传；图片按钮只在能力存在时渲染，能力变更同步使 drawerContext 失效，动作可直接翻转偏好。圈选同理删除永不可达的重复能力提示，保留快捷键冲突验证。能力变化→旧按钮失效→新按钮恢复、冲突阻止启用但允许关闭均通过真实组件断言。`popup-cleanup-final.log` 208 用例通过，PopupApp L/S 99.58%、B 93.51%、F 100%；没有把测试专用私有调用作为不可达分支覆盖。
- 最终主表单导航回调纳入原有业务导航断言后，`settings-events-final.log` 160 用例通过，SettingsSections L/S 98.8%、B 89.29%、F 100%。仍有编译目标与防御分支缺口，四维全覆盖没有达成。


### 写作面板真实工作流与迟到 UI 结果

- 四个可复现的异步归属缺陷：旧偏好保存失败写入新 session；隐藏再打开仍被旧保存锁住，且旧 finally 能释放后续保存；复制时编辑草稿后旧复制完成仍提示当前正文已复制；旧设置打开失败污染新会话。`writing-ui-ownership-before.log` 4 条真实 SFC 回归失败，保留旧源码作对照。偏好保存增加独立 revision，并绑定面板生命周期/生成/session；隐藏、切换及卸载立即释放旧锁。复制反馈另检查当前实际输出文本，设置打开异常只归属当前操作。
- 在原有 `implementationAudit49B` 真实 runtime-dom 消费者追加完整路径，而未再写一份镜像实现：起草与流式元信息、停止后不完整稿、失败保稿和按编辑稿重试、五版本上限、风格只保存一次并保留未提交要求、输出语言翻译与旧版本语言、重写引用、独立参考翻译失败/重试、双语插入、空正文/凭据失败/连接同步失败、分层 Escape、输入法组合键、菜单焦点和键盘循环、复制失败与插入失败。
- LinkeDOM 将 HTMLElement 识别为普通 Object，导致 Vue ref 代理节点与原生 event.target 不同；夹具只在创建 DOM 时 markRaw，恢复真实浏览器的节点恒等性。未改生产身份判断，未调用私有 setup 状态。
- `writing-menu-feedback-coverage.log` 两文件 83 用例通过；WritingPanel 行/语句 100%、函数 92.98%、分支 87.37%，WritingChoices、WritingLanguagePicker、WritingStyleEditor 四维 100%。`writing-final-compile.log` 当时工作树类型检查通过；后续新增菜单测试的 `writing-menu-compile.log` 仅两处其他 owner 测试类型错误，已转交，仍以最终固定快照为准。
- S4 中两个核心严格覆盖缺口已通过真实入口收敛：个人修正新增只有标点的候选与正常查询不建议的断言；Harness 私有 explainPreparedRecord 的 now 已由唯一调用 rankRecords 一次性传入，删除永不到达的第二层时钟 fallback，并收紧私有参数类型。既有公开排名测试明确确认每批仅读一次时钟。`remaining-core-gap-coverage.log` 42 用例通过，两文件四维 100%，未删除可达防御或忽略源码。


### S6 冻结前：配置恢复、WebDAV 和服务字段

- 配置恢复测试从自建 Vite/匿名模板执行迁为正常 SFC 导入，仅将组件导入的 nextTick 作为受控调度端口，Dialog 与夹具继续使用真实 Vue 调度。原 138 条公开恢复/焦点/重复确认断言全部保留；补历史对比切换和不可解析时间/未知语言兼容后 140 条通过。删除已无生产对应入口的历史 MessageBox 夹具与兼容包装。`config-restore-migration-final.log` 为最终迁移结果。
- WebDAV 在现有真实父 SFC 测试里通过 RemoteConfigSync 公共 client 端口验证 status、prepare、prepareDelete：准备前后重读连接，账号不一致、连接清除、读取失败均取消预览；取消失败不遮蔽原读取错误。补 HTTP 明文连接的显式同意、对话框关闭清除密码、当前账号同步时间隔离。无生产更改。`backup-ui-coverage-final.log` 324 条组合通过，ConfigManagement F100/L99.49/B93.19，WebDavBackup F100/L100/B92；尚不能列为四维 100。
- **服务输入控件迟到写错配置。** 真实 ServiceConfiguration 父模板的代理 update 回调在服务切换、替换 config、隐藏、KeepAlive 停用和卸载后仍写入当前配置，`service-field-ownership-before.log` 5/5 失败。改成直接绑定捕获上下文的字段动作；领域、配置、模型、页签与活跃身份变化使旧输入失效，标量与服务 map 另验证字段/容器快照，防止同对象外部水合被旧输入覆盖。覆盖代理、云凭据/区域、模型 Thinking、认证方式、两家账户区域/计费、厂商凭据与端点、提示词、JSON headers/body、MyMemory 联系邮箱和密钥轮换，保留当前控件正常操作。
- `service-field-contracts-final.log` 90 条通过；后续增加 Chrome 初始化/检测器下载/翻译器进度/验证/结束后迟到进度的实际连接按钮路径。提示词同步的 47 条测试迁为正常 SFC 导入，保留全部原有归属断言并删历史 MessageBox 镜像夹具，测试执行由此前约 21 秒降为 231ms（单次本机测量，非产品运行时指标）。`service-prompt-real-coverage.log` 91+47=138 条通过，ServiceConfiguration F94.91/L95.31/B83.43。没有为补齐防御分支调用不可达私有函数。
- WritingPanel 后续补齐当前菜单和返回/关闭工作流，`writing-full-function-coverage.log` 86 条通过，WritingPanel F100/L100/B88.01，三个子编辑器四维 100。先前 83 用例和函数 92.98% 是较早检查点。
- 对 root 精简的 platformFull 独立逐分支对照 S5：Full 先处理带 section 打开、模型用量、单词本和单/批配置 CAS，其余共用 compact handler。初始 sender 捕获、每实例共享 input/ordinary registry、消息拒绝、权威快照 watch 与 dispose 顺序保持。未发现去重引入的语义回退；未将原来 dispose 不终止已发出的 provider 宣称为本次新问题。

### S7：统计仓库按消费初始化与 userscript 代码裁剪

- 共享翻译 runtime 原本只在真实扩展协议写入统计，但翻译统计的 captureGeneration 未遵守相同边界，且两个仓库导入时立即构造数据库。单独加入 `BROWSER` 编译期判断仍无法移除 top-level `new` 副作用，实际 Vite 模块图证实两个完整仓库及聚合仍保留。
- 两个仓库改成同步惰性 getter；只在实际消费时构造，后续同步/并发消费者取得同一实例。删除无消费者的 `modelUsageDb` 导出，全部后台、写作、阅读、连接测试和完整脚本消费者改用 getter。数据库名称、版本 1→2、事件保留、写队列和 clear generation 原实现不变。
- 共享 broker 组合根按 userscript 编译期能力省略可选统计依赖；broker 原有未注入时不采集、代次 0 的契约保留。扩展仍检查 chrome/moz/safari 扩展协议，HTTPS 与无 location 不构造仓库。新增真实 provider→broker→composition 用例覆盖以上入口、实际 usage/请求统计记录，以及公开缓存管理的水合失败告警、清理和查询重试。
- `stats-lazy-coverage-final.log`：10 文件 179 条通过；`app/translation/runtime.ts`、两个统计仓库四维均 100%。`stats-lazy-compile.log` 类型检查退出 0，后续构建测试的最终类型结果见 `stats-bundle-compile.log`。
- `stats-shake-summary.json` 保存完整实际主入口的 `write:false` Vite 构建模块图：compact 移除两仓库和两个聚合模块，standalone 保留真实模型用量管理仓库与聚合，仅移除请求统计仓库。原四模块共 **60,648 rendered 字符**，不是压缩产物字节差；工作树并行变化，未把总包大小差当作本改动独立收益。
- 同时保留可重复的真实 Vite 契约用例，使用生产源 runtime、仓库、聚合和 full handler，仅外置不相关网络/配置端口；compact/standalone/扩展三种构建均验证 moduleIds，另验证同名文件与 `?raw` 查询不被误处理。无 no-op 仓库、无虚假 PURE 注释、无 vendor 产品代码转移。
- `review-ledger.json` 更新当前文件 SHA，并单独标记本轮额外逐消费者语义复审。当前 hash 不会自动把 AST 或静态目录审查升级为逐函数审查；373 个基线文件/4,459 个函数节点口径保持不变。


### Userscript 阅读持久化：GM 隔离与并发边界

由 web 子任务通过真实 ReadingPanel 按钮复现原 userscript 缺失 runtime.connect；恢复同页阅读协议时，本子任务负责新增 `userscript/readingStorage.ts`，提供既有 HarnessSessionStore 与 LearningMemoryStore 接口。会话字段、turn 字段、学习笔记校验与三十天过期规则复用生产模块，不在网页自己的 IndexedDB 或 localStorage 中存储阅读正文。其余连接、生成器和 UI 修复归 web/root；本节不把他们的工作记为本子任务实现。

- 每次 turn 或笔记更新写入唯一 GM 操作键；没有整包覆盖。独立 turn、独立笔记可合并；同项更新按观察到的逻辑时钟及操作 ID 确定性择新。笔记首次进入的逻辑顺序随编辑保留，最终投影按此顺序去重并限制 200 条，系统时钟回退不会把已确认的 199 条旧笔记挤出。
- 删除和清空写入持久标记。每条数据仅携带写入时观察到、对当前数据实际适用的标记集合；读取时缺少适用标记的旧写入不显示。写入后再读一次，遇到期间删除/清空则删除本次数据并拒绝提交。笔记删除还保存 kind/content 的 SHA-256 指纹，使另一个标签迟到提交的相同内容不能换 ID 复活；标记不保留笔记明文。删除之后明确重新添加使用新代次，正常允许。
- 读取按 session ID 选择相关 GM 键；保存一个会话不读取其他会话正文。过期、被替代或已失效正文只清理当前已经读取的快照键，不删除并发新增键。历史 streaming 状态仅在返回值中显示 stopped，不改写另一个标签正在生成的记录。web 的 runtime 在非隐私初始化成功后触发一次全会话 prune，后续公开读写继续清理各自范围。
- privateContext 初始化不读 GM，所有持久化入口拒绝操作；无后台 GM listener、无额外 dispose 要求。未知版本、坏字段或键与内容不匹配的数据被忽略，外部命名空间不被删除。默认端口直接使用现有 GM 存储适配，不改现有扩展数据库版本或迁移。

**实际边界：** GM 不提供跨标签事务或锁，本实现不承诺线性一致性。两个标签竞争最后一个名额时，若各自确认前都未观察到对方，双方可能都短暂收到成功；最终列表仍最多 200 条，按确定性初始顺序保留。同步会话 generation 捕获使用当前已知删除标记；外部清空刚发生但尚未读取时，首次保存会保守返回 false，刷新标记后的新请求可正常保存。逐键读取也不是原子快照，另一个标签在 list/get 之间压缩旧键时，本次读取可能暂时缺少刚被替代的项目，后续读取收敛。

持久删除标记永久保留，以阻止休眠标签旧写入复活；频繁删除/清空会增加元数据与读取投影成本；笔记持久 fence 仅包含全局清空、当前笔记 ID 删除及相同内容指纹删除，无关笔记删除不再增加每次保存正文体积。200 条是可见笔记上限，不是无限历史元数据的容量保证。正文清理是尽力而为：清理失败不把已经完成的正常保存误报为失败；写入者崩溃留下的失效正文在后续读取/prune 时回收。仍有效但因并发重复或容量投影暂时不可见的操作不会被当作过期记录删除，以免不完整快照误删其他标签的数据。这些边界不能用局部覆盖率消除，也没有声明 GM 支持强事务。

`reading-storage-coverage-final.log`：33 条真实公开接口测试全部通过，新增存储模块语句/分支/函数/行均 100%。用两个独立 factory 共享受控 GM 端口验证并发保存、迟到提交、删除/清空、相同内容换 ID、200 条边界、时钟回退、损坏记录、默认真实 GM API 适配和隐私零访问；未调用私有投影函数来造覆盖率。该数字只对应新增模块，不能替代整个仓库的全源码覆盖或真实脚本管理器验收。

随后与扩展真实 IndexedDB 会话仓库、会话流式持久化和学习笔记仓库组合回归，4 文件 60 条全部通过（`reading-storage-related-final.log`）。这证明共享字段/过期契约的本地回归，不等同于真实跨标签 GM 管理器事务保证。

当前工作树 `reading-final-compile.log` 的完整 `vue-tsc --noEmit` 退出 0。独立读取 root 拆分的 generation/modelConfig/visibleStream/readContext 全源及 runtime/modelGateway 调用 diff，确认扩展 SDK 消费、工具输入约束、配置身份与脱敏保持原契约；没有发现拆分造成的新阻塞。该结论不是对在线 provider 的验收。


root 独立复审后进一步缩小笔记持久 fence：原实现把全部笔记删除标记复制到每次保存正文；改为只保存 global clear、当前 note ID、同 kind/content 指纹对应的标记，与读取侧实际有效性条件完全一致。公开 generation 协议及保存前后完整删除集合比较保持原样，任何并发删除仍能拒绝迟到保存。新增两条共享 GM 回归在旧实现均失败（`reading-memory-fence-before.log`），验证 20→120 条无关删除仍改变公开代次，但新正文 fence 为空，序号增长之外的单条正文大小差小于 10 字符；并验证相关 ID、重复内容及 clear 标记全部保留，明确重建与编辑正常。最新 `reading-memory-fence-after.log`：4 文件 62 条全部通过，其中新模块 35 条，四维覆盖仍 100%。


### S6 真实站点失败的独立归因

- SQLite 完整源文 oracle 失败来自站点保护规则未被测试识别：sqlite-docs 的 documentation profile 明确保护 button；实际 snapshot 保留 hide，净化器解包为 Text，而 oracle 当作漏译正文。已把精确 host/path、完整文字配对修法及外站/错路径/普通 span/改词/漏槽负控交给 web，不扩大通用控件豁免。
- NASA hover 在 S6 原产物上稳定复现标题第二次恢复失败。外部只读测量记录相同 target 的鼠标与 Control 协议调用成功，但页面没有收到最后一组输入事件；无 pageerror、失焦、隐藏或选区。三次成功 provider 请求属于前序正文两次和标题首次，不能据此推断恢复又翻译。尚不能把该失败归因到产品 restore，因此未修改生产恢复逻辑或放宽断言，也没有将此站点计为通过。完整证据与测量器首轮保存时机错误均在 `nasa-hover-attribution.md` 交代。
- NASA 测量采用 fluentread-browser-translation-test 技能要求的临时 Edge、第二屏正常窗口及不抢焦点 helper：macos-background-cdp / launchservices-no-foreground / background-visible-no-focus / browserFrontmost=false，三次焦点记录均无违规。使用受控微软响应，只能验证 DOM 生命周期，不是在线供应商质量证明。


### 恢复预览的独立复审与真实修复

独立读取 LocalDataManagement、活跃上下文和现有 49C 行为用例，并核对锁定 Vue 3.5.13 的模板编译结果。一级文件/粘贴来源对话框已经正确捕获本次操作归属；二级导入预览仍用全局当前状态确认、取消和更新可见性，旧控件回调可在关闭重开、active 离开返回及 KeepAlive 返回后操作当前预览，甚至未经当前确认写入数据。新增 9 条真实 SFC 公开 render 回调回归在旧实现全部失败（local-import-preview-before.log）。

修复为预览动作捕获本次 close 身份、待导入对象和活跃 revision，三个入口均核对归属。已经接受的导入仍完成领域写入，旧完成/关闭回调不会影响新窗口。另删除 openRestoreSource 内紧跟同义 return guard 的重复条件，无 await、外部调用或可重入访问位于两次判断之间。49C 与 configRestoreOwnership 共 316 条通过；最终精简后 49C 176 条通过，LocalDataManagement 语句/函数/行 100%、分支 94.24%。该组件其余分支缺口如实保留，不把局部修复称为全仓库 100%。完整类型检查与差异证据见 local-import-preview-compile.log、local-import-preview-fix.patch。

补审台账中 5 处摘要变化：runtime-feedback 删除无运行期消费者的旧 live 捕获文案，两个 OpenAI 执行器仅更新构建归属注释，两处 harness 调用抽取与已独立复核的相同源码一致。保存 S6→当前精确差异 latest-cross-review-delta.patch 后更新摘要，未将简单刷新摘要当作语义审查。再次核对 memoryFence 的适用类别与 latestData 完全一致，完整标记集合仍用于 generation 和提交后失效，没有因减小正文 fence 丢失相关删除/清空保护。

root 随后指出隐藏 file input 的 change 仍缺少本次 chooser 归属。本子任务补两条真实输入事件回归：关闭 A 后打开来源 B 或预览 B，再递送 A 的公开 onChange 与旧 DOM change，旧实现确实启动 file.text（local-import-file-before.log）。输入框现按来源/活跃 revision 的 Symbol key 重建，使用 :onChange 直接绑定捕获归属的 readFile，读取入口补来源可见性校验。不是仅在文件读完后丢弃结果，失效事件在开始读取前即被拒绝。最终 local-import-file-after.log 为 49C 178 + configRestoreOwnership 140 = 318 条通过；完整 vue-tsc 退出 0，两个修改文件 diff check 通过。两轮共 11 条新增回归均保存先红后绿证据。最终组件覆盖为语句/函数/行 100%、分支 93.83%；新增入口前置保护令部分旧防御路径不再由这些公开流程到达，未人工调用私有函数或忽略代码来掩盖缺口。

### S8 全量结果与冻结前补充验证

S8 全源运行退出 1：789 个测试文件中 787 通过、2 失败；28,486 条通过、3 条失败、6 条条件跳过，共 28,495 条，耗时 1,137.11 秒。三条失败分别为本地恢复控件改为归属回调后遗留的源码文本断言、Vue 消费者与严格覆盖例外的登记冲突、7 个已有严格覆盖模块仍留在旧豁免分类。日志没有第四条新功能测试失败。后续定向修复不能把这次 S8 全量运行改称通过；当前工作树复验又发现 DownloadProgress 消费者登记问题，已交主任务处理，与 S8 失败清单分开记录。

S8 的 1,151 份源码覆盖报告保持完整分母：语句/行 **162,555 / 166,658（97.53%）**，函数 **11,706 / 13,152（89.00%）**，分支 **86,177 / 89,026（96.79%）**。仍缺 4,103 条语句/行、1,446 个函数和 2,849 个分支，194 个文件存在至少一项缺口。生成 vendor 占其中 1,300 个函数缺口，自有源码占 146 个；其中 42 个文件没有 AST 函数体，但 V8 报告仍存在函数占位。S8 显式严格清单 828 个文件中，只有 readingGeneration 的 5 个分支和 readingRuntime 的 4 个分支未满；全源四维 100% 目标仍未达到。精确范围、逐文件缺口和失败分类见证据目录的 `checkpoint8-global-gap-summary.json`，没有通过缩小分母或降低阈值改变结论。

冻结前只增加真实外部端口和控件测试，以下结果属于 S8 之后的补充验证，生产源码 SHA 均与 S8 相同：

- 远程同步与站点适配：23 条控件测试和 38 条设置架构检查共 61 条通过。新增两条验证返回同步方向选择后必须重选、最终只提交新确认方向，以及错误/正确删除确认词按 Enter 均不删除、关闭重开清空确认词和详情状态。按锁定 Element Plus 的真实 afterLeave 顺序补齐测试端口的 closed→update:modelValue(false) 回执，复用现有关闭用例；未直接调用组件私有方法。RemoteConfigSync 的语句/行 99.68%、函数 100%、分支 83.87%；SiteAdaptationSettings 的语句/行 99.58%、函数 100%、分支 92.80%。证据为 `core/remote-final-controls*`。
- 本地翻译 worker：18 条测试通过，语句/行/函数 100%（18 / 18 函数），分支 108 / 110（98.18%）。新增实际 Worker 消息触发 Hunyuan 初始化的用例，由原生模型库端口使用收到的四级 logger，验证 debug/log/warn/error 不泄露诊断内容且正常返回译文。未 mock 自有 worker。剩余两处分支分别是已通过消息协议校验后的私有 translate 重复输入防御，以及只会抛本 realm TypeError 的解析器之非 Error 兜底；没有构造结构化克隆无法传递的 getter 来触达它们，也没有为指标删除生产防御。现有验证归属保持不变，不宣称已经达到严格四维 100%。证据为 `core/local-worker-coverage-final.log` 和 `core/local-worker-final-coverage/`。
- Userscript 阅读：generation 84 条、runtime 25 条，共 109 条通过。补充固定匿名 Bilibili 忽略无效无关请求头的配置边界，以及真实 sendMessage 历史查询在初始化等待期间遇到导航后拒绝旧请求、新路由查询正常的生命周期边界。两个模块语句/行/函数均 100%；generation 分支 98.98%，runtime 分支 96.34%。剩余 **7** 处分支：同步 JSON 解析与回调之间没有原生异步插口的 abort 检查、由外层条件已保证非空的 partialArgs fallback、两处只接收内部赋值 capture 回调的异常隔离、真实主页面 location 存在的两处 fallback，以及内部生成 sender 必有 tab.url 的 fallback。真实用户统计回调失败由外层隔离且已有测试；未替换 JSON.parse、伪造无 location 页面或调用私有 capture 填充数字。逐项位置和语义见 `core/reading-final-public-gaps-review.json`。

上述补充的完整 vue-tsc 类型检查均退出 0，修改测试的 diff check 通过。它们不替代 S9 全量验收。下一轮全量计划启用已具备资源的 4 个真实 PDF 条件；2 个 Harness 条件仍保留跳过。此处仅记录主任务的运行计划，不预先宣称 S9 结果或真实模型/设备验收完成。

### S10 冻结：GM 最终修复与源码绑定复核

本节更新前文阅读存储的初始实现结论。最终跨标签复审确实发现：GM 写入已可见但确认回调尚未返回时，另一个标签可能据此清理旧正文；随后无关删除令写入方回滚新正文，造成已确认笔记丢失。因此，前文“写入后删除本次数据并拒绝提交”的笔记协议不能作为发布结论。web 负责实现最终修复，本子任务只读交叉审查并提供独立公开接口时序验证。

最终笔记先写不可见的准备记录，复验删除代次、重复内容与当前 200 条上限后，再发布自包含的 v2 正文；发布后不因迟到确认失败或无关删除物理回滚。最多一份已确认旧正文保护并发编辑冲突，回退记录保留来源标记、不抢占其他主正文的去重位置。明确删除仍按目标 ID 生效；已有多个可见确认 ID 使用相同内容时，不写会误伤其他 ID 的广泛内容墓碑。清理只以稳定提交或适用墓碑为依据，五分钟过期的准备副本不影响仍在内存中的完整提交候选。

独立验证继续发现并推动修复了三种关联时序：迟到编辑的回退正文挤掉第三条已确认笔记；删除其中一条同内容笔记误伤另一 ID 的回退正文；删除共享内容赢家后，回退来源丢失再次挤掉第三条笔记。最终 SHA `508fb8ea2ddffba068381cd646cb72e7569a45211cca1aca04dfec69de291364` 上，14 条公开 factory 交错全部通过。没有 mock 自有存储模块；真实模块只通过注入的异步 GM 端口运行，不访问网络或浏览器。独立红证据保留在 `core/final-gm-protocol-probe-4f88-red.json`，最终时序和结论见 `core/final-gm-protocol-probe.json`、`core/final-gm-storage-independent-review.json`。

已读取 owner 的最终测试输出：存储模块 50 条通过，语句/行 347/347、函数 33/33、分支 371/371，四维均 100%；与阅读 runtime/generation 组合为 159 条通过。该局部结果不替代整个仓库的四维覆盖目标。额外用真实旧版公开接口创建 200 条约 2,000 字符的记录，再由新版公开 list 执行投影和清理：五次中位 2.96 ms，每次 1 次列键、200 次读取、0 次删除。此测量使用 Node 内存端口与 structuredClone，只说明本地处理成本，不代表实际脚本管理器的磁盘或跨进程延迟。

GM 仍不提供跨标签原子事务，永久墓碑会随历史增长，极端并发下允许暂时重复内容以保全已确认 ID。v1 阅读适配器是本次审计的未发布草案，旧草案标签须刷新；列举的 legacy 清理防护不等于支持任意新旧版本同时写入。可见 200 条、每条至多一个旧正文和准备记录清理，也不等于无限历史的总存储容量有界。

S10 冻结对应提交 `e2bc77814b6a5de0f976dd6ee2c2656f08335aef`。独立重算 1,151 个源码文件的 SHA-256 和 Git blob，全部匹配冻结清单与该提交；S9→S10 唯一生产源码差异正是上述 GM 文件，完整差异已再次阅读。七份审查台账的输入哈希、记录数量和每条当前源码证明均匹配：1,149 个自有文件无遗漏、无过期摘要；自有 AST 为 18,208 个函数节点、18,206 个函数体。其余两个生成资源继续仅作来源/许可/导出契约审查，vendor 的 3,044 个函数体不宣称人工逐函数审阅。全清单为 21,252 个 AST 函数节点、21,250 个函数体、218,849 行、0 个解析诊断。

严格保留审查层级：971 份函数体审阅、8 份函数体审阅但静态文案选择性读取、144 份无可执行 AST 函数的源码审阅、26 份静态契约审阅，以及 2 份生成资源契约审阅。覆盖配置与 S9 相同；台账完整性不是运行时覆盖率 100% 或无 bug 的证明。最终全量结果由主任务另行记录。独立绑定证据见 `core/checkpoint10-independent-review.json`；本轮未修改生产代码、未运行浏览器。


### S11 最终冻结与全文公开链路补测

S9 剩余自有 V8 函数缺口经逐项分类为 121 个条目：80 个 `(empty-report)` 占位和 41 个普通映射函数，后者分布在 24 个文件中。占位项不能当作真实未测业务函数，Vue 编译回调也不能直接等同于源码 AST 函数；没有因执行次数为零删除生产适配器或构建钩子。本轮没有新确认的产品 bug 或死函数，完整候选与后续行为建议见 `core/checkpoint9-real-function-gap-followup.json`。

在现有 `fullPageVisibilityScheduling.test.ts` 增加两条有独立可观察结果的公开链路测试：

- 全文翻译启动后才挂载 open ShadowRoot，通过真实 DOM `fluentread-open-shadow-root` 事件触发发现，断言请求原文和译文 DOM；恢复原文后再挂载新的 ShadowRoot、派发同一事件，断言没有新请求且保持原文。
- 三个相同原文段落按 IntersectionObserver 通知依次进入，前两段共用一次会话译文；调用公开 `invalidateFullPageTranslationSessionCache` 后第三段发出新请求并显示新译文，前两段已经显示的译文保留。

两条用例均正常 import 生产 runtime，使用真实 CandidateCore 和源文快照，不读取或改写私有 fullPageSession，不注入手工候选状态，也不直接调用私有事件处理器。既有 LinkeDOM harness 仍替代浏览器布局/观察器、网络 client、译文展示辅助函数以及部分 core public facade（包括空 getOpenShadowRoots 夹具）；因此本结果验证实际 runtime 的发现、请求缓存与生命周期组合，不代表原生浏览器、真实 provider 或完整生产展示器验收。观察器登记断言仅作补充，主要断言为可观察的请求次数及 DOM 内容。

定向两条通过；随后 `fullPageVisibilityScheduling` 416 条与 `contentMessageRuntime` 96 条共 **512 条全部通过**，`pnpm compile` 和 `git diff --check` 均退出 0。证据为 `core/final-fullpage-public-behavior-targeted.log`、`core/final-fullpage-public-behavior-regression.log`、`core/final-fullpage-public-behavior-compile.log`。该两条测试不产生可推算的最终全仓覆盖百分比，仍以主任务全量报告为准。

最终 S11 源码快照对应提交 `c2d128c6349baf1c19108e40f99c9ae5d5ee01f0`。独立重算 1,151 个源码文件的 SHA-256 与 Git blob，全部匹配该提交与 inventory；S10→S11 **生产源码差异为零**，两个中央 Vitest 配置也未变化。新增测试文件的 SHA 同时匹配该提交与上述 512 条通过证据。七份审查台账的输入 SHA、记录数和逐条证明均可追溯：1,149 个自有文件当前摘要全部匹配，missing/stale/integrationOnly/source mismatch 为零，3 条历史 superseded 记录单独保留。

审查层级仍为 971 份函数体审阅、8 份函数体审阅但静态文案选择性读取、144 份无可执行 AST 函数的源码审阅、26 份静态契约审阅、2 份生成资源契约审阅。自有 AST 为 18,208 个函数节点、18,206 个函数体；全量为 21,252 个节点、21,250 个函数体、218,849 行、0 个解析诊断。生成 vendor 的 3,044 个函数体仍不声称逐函数人工审阅，静态文案也不声称全部母语/视觉验收。独立证明见 `core/checkpoint11-independent-review.json`。本轮没有修改生产代码或覆盖门槛，没有启动浏览器；审查台账完整不等于全源四维覆盖 100% 或无 bug 保证。


### 冻结后的主线漂移：S11 不覆盖新主线

14:25 UTC 远程主线已推进至 `f2885bc93fcc54feecb602ce337009bd8ea79029`，包含 PR #1055（阅读请求与动态生命周期）及 PR #1054（UI 层级与视觉调整）；S11 仍是从原基线 `0ad3d431b425d8e082f15acfce11de23a66b8cc1` 派生的独立候选 `c2d128c6349baf1c19108e40f99c9ae5d5ee01f0`。本子任务只读 Git 对象与主任务 merge-tree 输出，没有合并、重置或修改生产/测试。

原基线→新主线共改变 102 个文件，其中生产路径 39 个（20 Vue、7 TypeScript、12 CSS），测试 24 个。与本审计同时修改 29 个路径：12 个生产路径和 17 个测试。26 个现有 AST 清单文件的新主线字节与 S11 不同，另新增 `SettingsDisclosure.vue`；新 CSS 也不在既有运行源码 AST 计数之中。这些变更不能借用 S11 的旧摘要、逐函数审查或覆盖率结果。主任务只读 merge-tree 报告 12 个内容冲突（6 个生产路径、6 个测试），不冲突的文件也不等于已经完成语义整合。

需要明确保留的整合边界：

- 新主线增加 Markdown 链接目标边界识别、input value/type/name 动态资格恢复，以及独立冷却根的公平重扫/唤醒调度；S11 未包含这些实现。双方的 client 三处取消信号转发在执行逻辑上相同，但 queue 使用不同的等待项所有权与监听清理实现，必须保留两侧回归再决定一致实现。
- 新增原生 details 折叠组件、始终挂载的设置表单、文档校订器首次请求才挂载、主动作/通知层级以及 popup/皮肤变化，会改变控件存在性、焦点、隐藏表单和旧事件归属。S11 的 stale-callback 修复与上游新 UI 断言需要一起验证。
- 上游部分新测试仍基于原有 compileVueFixture/new Function/ssrLoadModule 方式；S11 已将相关消费者迁到正常 SFC import。不能整文件取一侧而丢失另一侧行为断言或重新丢失真实覆盖归因。
- 上游重新投影旧文案来维持远端词典；S11 已直接绑定五份已发布 JSON。整合需要保持固定资源内容/哈希和脚本运行时补充文案契约，不可因冲突处理使远程资源失效。
- 上游将普通 userscript 体积门槛由 **2,125,100** 提至 **2,127,100** 字节，而 S11 保持前者。该工具文件没有双方冲突，仍可能在未来干净合并时静默改变验收标准；本次不得借此宣称原体积要求通过。

精确文件交集、Git blob 与差异证据见 `core/new-main-overlap-files.json`、`core/new-main-code-and-test.patch`、`core/new-main-integration-review.json`。这次工作是整合风险定位，没有重新语义审阅全部上游改动，也没有在新主线运行测试或构建。**S11 不是 f2885bc9 新主线或未来合并结果的验收**；整合后须重新生成当前 SHA 审查范围、运行全量与构建验证，并报告真实门槛结果。


### S11 本地与远程 CI 用例计数差异核验

对照本地完整日志与 GitHub job `120466005680` 的未截断日志，双方均包含相同的 789 个测试文件，784 个文件的通过/跳过/总数完全相同。远程不是少执行两个测试文件，也不是 PDF 数量动态展开造成总数变化。

唯一总数差异来自 `ownedBrowserClose.test.ts`：本地 100 条、Ubuntu CI 98 条。其公开进程关闭用例按 `literalTemporaryRoots` 参数化；macOS 保留当前系统 tmpdir、`/tmp`、`/private/tmp` 三个不同字面路径，CI 仅一项，因此总数差 2。另四个真实 PDF 条件用例（NASA 导出、公报扫描、Attention 版面及完整论文目录）在本地运行，在 CI 各跳过一条，各文件总数保持不变；两条 Harness 条件在双方均跳过。

计数完整闭合：本地 28,526 通过 − 2 条平台展开 − 4 条 PDF 条件 = CI 28,520 通过；跳过 2 + 4 = 6；总数 28,528 − 2 = 28,526。CI 仍因 readingRuntime 分支 96.38% 和 readingGeneration 分支 98.98% 未达严格 100% 而失败，此结论不能与本地全源分母混用。

原始 CI 日志、789 文件逐项差分和源代码条件保留在 `core/remote-ci-checkpoint11-full-job.log`、`core/remote-ci-checkpoint11-complete-counts.log`、`core/final-ci-local-count-comparison.json`；原日志 SHA-256 为 `ad53fe78c0e60dc82cff68a952c2d5c53711b7dbba2d4894bd9257f8a46f53ce`。此前仅含 410 个文件的截断日志不足以归因，最终说明基于完整日志，不是根据环境条件猜测。本轮未修改测试或生产代码。
