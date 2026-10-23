# 发布审计：主入口、userscript 与发布工程

状态：进行中。本页记录已取得的证据，不表示已满足全仓四维 100% 覆盖率，也不表示发布完成。

基线为 `0ad3d431b425d8e082f15acfce11de23a66b8cc1`。修改分支为 `codex/release-audit-20261023`，主工作区保持原样。任务从 2026-10-23 13:22（上海时间）开始，最晚 23:22 停止。详细日志位于工作区 `research/release-audit-20261023/`。

## 已修复与清理

- 缓存清理：合并并发 alarm 的清理任务，隔离同步抛错和异步失败，避免同一缓存重复遍历。6 个行为测试通过，模块四维覆盖率 100%。
- userscript HTTP：先决定传输路线，再读取 Request 正文；取消发生于正文读取前后均有一致语义，取消克隆流不等待宿主的取消确认。3 个旧实现失败用例，修复后 HTTP 100 个测试通过，模块四维 100%。
- userscript 配置通知：一个订阅者抛错不再阻断本地写入、删除和跨页通知；browser storage 适配器内部订阅者也隔离错误。相关 HTTP/storage/browser 回归通过。
- userscript 普通翻译：普通请求登记控制身份并允许取消，与输入框翻译保持相同的请求所有权边界；来源 URL 在请求创建时固定。6 个回归先失败，修复后相关 96 项通过。
- userscript 完整设置打开：异步 GM 打开失败不会再覆盖已关闭或后续成功打开的状态，3 个回归先失败。
- userscript 模型编辑：另一设置界面填满第 50 个模型后，已打开的新增表单提交会再次检查限额，保留原选择并给出已有的限额提示，避免选择不存在的模型。真实 DOM 回归先失败后通过。
- 网站规则设置：规则归一化结果按配置缓存，搜索复用规范行；删除模型层不再使用的 query 参数。真实 SFC 10 项、规则相关 35 项通过，该设置组件四维 100%。
- PopupSiteRule 与 ServiceIcon：增加真实组件消费者并补 ChatGPT 旧服务标识边界；相关组件达到四维 100%。删除 Popup 中未消费的快捷功能 icon 字段与字面值。
- 设置导航：`#constructor`、`__proto__` 等原型同名输入不会再取得继承对象并调用不存在的 `find`。单元及实际 Options 测试通过；生产 Edge 真实页面验证 `#constructor` 回退到 `#settings-general`。
- ChatGPT 设置反馈：未知语言和错误码仅查自己的字典键，避免继承原型成员。既有翻译/页面回归通过。
- 本机 ChatGPT bridge：SSE 完成、无效内容类型与 401 刷新路径不再等待可能永不结束的流取消；流 reader 释放。真实本机 HTTP/RSA 与 CLI 夹具 27 项通过，未调用真实 OAuth 账户；新增启动目录/端口失败、配对码更新、SIGINT/SIGTERM 退出锁释放测试。原生 Node V8 单独统计四模块函数 100%、S/L 99.52%、分支 81.20%，不混同 Vitest 全源统计。
- 删除从不成立的 AK/SK 表单分支，保留历史配置字段兼容性；生产 i18n 中删除无消费者反馈文案。测试专用语言注册和核心构造助手迁入 tests/helpers。
- userscript 的五份非英文远程语言包直接使用已发布固定提交的原始 JSON，避免删除生产死文案后生成无法下载的新文件名；保留运行期补充翻译。367 项相关测试通过，并用 git show 对固定提交内容逐字节核对。
- 两个统计面板：离开缓存页面时关闭清除确认框、释放由自己设置的 inert，并撤销旧查询/清除会话；旧成功、旧失败和迟到聚焦不能污染重新打开的页面。6 项真实 SFC 回归先失败，修复后该组共 47 项通过，包含真实表格、缓存上报/未上报、筛选、排序、分页、键盘、重试和配置快照交互。

## 测试工程

已将 userscript 设置面板 19 项、统计面板原有 16 项、Obsidian 插件 38 项、学习中心原有 23 项测试从独立 Vite SSR server / 匿名模板执行迁到正常 SFC import，保留原有行为断言与外部端口。这同时改善运行时间和源码覆盖归因。userscript 单组迁移后 1.28 秒完成，但单次结果不是稳定性能基准；该组件仍只有 S/L 83.23%、B 87.36%、F 29.78%，不能据此声称全覆盖。

Vue 验证归属门禁补充词法作用域内 const 组件别名追踪，允许真实 setup-only renderer，拒绝可变绑定、任意工厂、嵌套属性冒充与参数遮蔽。已进入严格覆盖的 16 个组件删除重复例外记录；纯 re-export 的翻译 public 入口不再列作独立可执行覆盖模块，其实现仍保留原覆盖要求。

隔离浏览器 lazy-sections 旧脚本错误地将网站规则开关当成全局启用开关，现改为检查两个受总开关控制的语言输入，并使用当前真实服务抽屉选择器。生产构建的设置挂载、导航、快速关闭持久化、连续写最终值、跨页同步与 Popup 抽屉重跑通过。

## 体积与构建证据

- 删除未使用的 vite-plugin-imagemin 开发依赖及对应 2,184 行锁文件依赖，其他版本锁定保持不变。
- 22 个 PNG/JPEG 无损优化：解码后 RGBA 与 ICC 内容一致，原始资源合计减少 19,197 字节；相同 deflate-6 条件减少 4,348 字节。
- ZIP 压缩等级 6 改为 9：基线相同 525 个文件的实际归档从 36,022,785 降至 35,887,947 字节，减少 134,838 字节；逐文件 SHA 和 ZIP 解压校验一致。一次本地压缩约 2.70 秒增至 4.62 秒，这是打包成本，不是运行期收益。
- 检查点 1 的 Chrome/Firefox 生产构建通过（约 84.14/84.15 MB 未压缩）。检查点 3 Chrome 冻结构建 29.2 秒通过；Firefox 复核进行中。最终冻结版本 ZIP、Greasy Fork 资源固定、文档与 Storybook 尚待最终复核。
- WASM 自定义段盘点已记录；没有为了减小文件而删除许可证、离线读音能力或运行期必要资源。

## 浏览器与覆盖率边界

浏览器使用临时 Edge profile，第二屏普通后台可见窗口，`macos-background-cdp` / `launchservices-no-foreground`，没有连接用户浏览器。DOM 探针的原生激活事件观察器未记录到测试浏览器激活；测试后关闭所属实例并清理临时 profile。

生产 DOM 探针确认四项 object-position 会被 Edge 计算为 `calc(100% - 10px) calc(100% - 5px)` 等形式；此证据交给媒体链路补齐解析与缩放回归。

36 站点受控矩阵首次因移动中的源码比构建更新而被 freshness 门禁拒绝。随后创建固定源码/哈希快照重新构建，取得若干 GitHub 等实际站点成功结果，但长英文的旧受控响应（仅在原文前加中文前缀）被真实错语种校验拒收，已停止该轮并修理夹具协议。不能把这轮失败直接判为生产回归，也不能把受控服务结果当作线上服务质量或可用性证明。

基线全源清单 1,142 文件的真实指标为 S/L 87.40%、F 82.89%、B 96.42%。目前大量 SFC 归因已经修复，但全局 100% 尚未达到。运行期间的第一次完整检查受到代码热修改缓存影响，并揭示了跨文件循环、文件行数门禁和真实 OpenStax PDF 几何问题；不能将混合快照作为发布通过证据。最终验收需在固定源码快照上重跑。


## 17:00 阶段增量证据（非最终验收）

- 学习中心删除逐例 Vite 服务与匿名 SFC 编译夹具，原 23 项全部保留，增加笔记编辑/分类/排序/容量、历史详情/失效/删除、错误重试、父导航事件，共 37 项通过。LearningCenter 四维 100%，正式加入严格覆盖并删除重复行为例外。其子组件 LearningMemoryManager 与 HarnessReadingHistory 的行和函数均 100%，分支分别 92.63% / 93.05%。
- Obsidian 38 项改为实际 main.ts 导入，仍模拟 Obsidian 应用 API，不声称真实宿主验收；main.ts 四维 100%，加入严格覆盖。
- 两个统计组件函数均 100%，最近一次行覆盖 99.38% / 99.88%、分支 89.47% / 91.77%；之后新增无缓存上报/空请求页和表格键盘用例通过，等待下一次合并覆盖结果。
- 普通 userscript 仅内联英文/中文页内实际能力所需文案，删除 document/translationStats 设置专属字典。移动 14,144 字节加载样式到正常 CSS 文件以使用已有 CSS 压缩；只移动内容，未重绘或删除样式。完整 standalone 的静态 JSON 使用已有 gzip 数据插件，8 组完整数组/对象、顺序与非目标源码等价测试通过；包含新增用例的 4 文件 374 项通过。
- Standalone 从 3,628,174 降到 3,598,840 字节，原 3,600,000 门槛通过，余量 1,160 字节。此值只适用于记录的构建，最终版本还需复核。
- 第二个全源固定快照：785 个测试文件，779 通过、6 失败；27,748 项通过、64 失败、6 跳过。全源 S/L 92.92%、F 83.18%、B 96.20%，严格 100% 未通过。文档旧 OPS 夹具、49J 临时 cwd、学习中心逐例 SSR、userscript 语言投影四类已在当前工作树分别修复并定向复验；不把定向通过替代新快照的完整复验。
- 浏览器安全：焦点保护错误使用明确退出码 86，单例不重试，矩阵中止余下分发并停止并行同组子进程。两项回归先失败，关联 520 项通过；修改 helper 后用原生激活事件监视器加真实 Options 页面验证，测试浏览器激活事件为零。检查点 2 矩阵已中止，17 个成功结果不足以验收整个矩阵。
- 检查点 3 包含 6,738 个哈希确认文件，Git 元数据采用独立 index，只读复用基线对象，避免旧快照共用 index 的范围错误。5 站点 10 条路径复测进行中。GitHub 时间保护、HTML BR 可见文本投影属于受控校验器修复，保留普通日期、缺失链接、删 BR、吞词空格负控；尚无最终站点通过结论。

证据：`root-ui-coverage/`、`root-ui-userscript-current.log`、`chatgpt-bridge-node-coverage/`、`chatgpt-bridge-node-coverage-native.log`、`checkpoint2-global-coverage.log`、`browser/checkpoint2-dom-focus-probes.json`、`browser/sites-checkpoint-3-focused-native/`。均位于任务证据目录。未参考其他项目代码。


## 17:30 阶段增量证据（非最终验收）

- userscript 设置面板新增真实控件操作：基础/页面/请求限制、输入翻译独立服务、六类连接参数、后备顺序、模型新增/删除/重复/保留标识、Thinking 与自定义请求。39 项通过，实际 SettingsPanel 函数 100%、S/L 99.01%、B 94.75%；不是仅凭模板源码断言计为覆盖。
- 页面“翻译/恢复”动作原先拒绝会产生未处理 Promise，且等待期间可重复点击。两项回归先失败，加入等待状态与可重试错误反馈；旧操作在编辑、保存、恢复默认或卸载后不能关闭当前编辑器或覆盖新反馈，另六项生命周期回归通过。
- 学习中心、两个统计面板、Obsidian 与 userscript 五组共 319 项通过。LearningCenter 与 Obsidian 四维 100%；ModelUsage 行 99.89%、函数 100%、分支 90.34%，TranslationStats 行/函数 100%、分支 91.82%；学习子组件仍有分支缺口。
- 检查点 3 Chrome、Firefox、文档、Storybook 构建通过；文档和 Storybook 组合产物校验通过。普通 userscript 实际 2,112,523 字节，原 2,125,100 字节门槛通过，余量 12,577 字节。
- 检查点 3 原生浏览器 5 站点 10 路径共 7 通过：五站悬浮均通过，ar5iv/Steam 全文通过；GitHub 时间元素与 LearnOpenGL BR/动态广告槽的受控协议归属问题已补正负控，Bambu 全文首段等待仍在取证。
- 检查点 4 在 17:14 固定 6,743 个哈希文件，Chrome 构建 28.8 秒通过。全源四维 100% 门禁与 36 站点 72 路径矩阵正在运行，尚无完整通过结论。该快照已知包含后来修正的测试类型签名，不能作为最终发布快照。

新增证据：`root-ui-controls-coverage.log`、`root-ui-coverage/`、`userscript-settings-model-flows.log`、`userscript-page-action-lifecycle.log`、`browser/sites-checkpoint-3-focused-native/`、`checkpoint4-global-coverage.log`、`browser/sites-checkpoint-4/`。

## 19:30 阶段增量证据（非最终验收）

- 第六份快照固定 6,743 个文件，静态清单为 1,142 个文件、21,046 个 AST 函数节点。Chrome、Firefox、Safari 生产构建以及类型、文档、Storybook、清单、Thunderbird 和 Safari 静态检查均通过。Safari 实体设备验收仍未运行。
- S6 全源覆盖为语句/行 97.40%（161,440/165,744）、函数 87.97%（11,479/13,048）、分支 96.65%（84,742/87,676）。其完整测试在受限环境运行，27,991 通过、252 失败、6 跳过；其中 246 项原生 HTTP/CLI/进程失败在获准的原生环境用 8 文件 451 项定向复验全部通过，另 6 项属于旧夹具断言并已修正。不能合并这些结果声称 S6 全量通过。
- userscript storage 的对象默认值错误地把已保存的 null 当作缺失值，现以 undefined/Map.has 区分缺失，保留 null、false、0 与空字符串；98 项公开 storage/API 测试通过，storage 与 browser 两模块在该轮四维 100%。此后新增阅读流端口，最终覆盖仍需重新统计。
- 实际 Options 客户端 57 项、Writing/Harness 设置 40 项、远程网站设置 21 项通过，新增测试从真实模板和公开外部控件端口操作。Options、Writing、Harness 组件函数均 100%；远程设置仍有 2 个函数缺口，不伪称四维全覆盖。
- 备份页真实粘贴 JSON 路径发现旧预览事件可在页面停用再返回后打开预览。新增用例先取得 2 个旧实现失败，随后将输入、选择文件、关闭和预览回调绑定当前活跃恢复对话框。164 项相关测试通过；LocalDataManagement 函数 100%、行/语句 99.37%、分支 87.38%。删除没有调用者省略参数的默认聚焦回调，不增加覆盖率忽略。
- 阅读生成端口拆分保持原生扩展 SDK 行为，独立适配脚本传输。共享 runtime、modelGateway、generation、modelConfig、visibleStream、readContext 六模块共 124 项通过、四维均 100%；read_context 校验另与实际已安装 Zod strict schema 对照 254 个输入。媒体审查对 16 个移动函数逐 token 核对相同，并独立检查两处调用改动。
- 独立审读了脚本阅读存储所有函数。其每次写使用单独 GM 操作键，GC 仅删除已读取快照中的旧正文，永久墓碑防止迟到写复活；33 项测试四维 100%。GM 不提供跨页事务，名额并发可能短暂各自成功但最终投影不超过 200，墓碑随删除次数增长，不能把本页队列当作跨页线性一致性保证。
- 第六份快照真实 Options/Popup 17 项通过，控制台无错误、原生激活事件为零。36 站点/72 路径矩阵仍在收尾：已确认 GitHub 建连中断、Product Hunt 403 与 SQLite 受保护按钮的测试协议差异，另有 NASA 悬浮恢复失败在调查。失败保留原始证据，不删除或改为跳过。

新增证据：`candidate-checkpoint-6-global-coverage/`、`checkpoint6-native-prerequisites.log`、`local-paste-owned-{red,coverage}.log`、`harness-generation-coverage/`、`core/reading-storage-coverage-final.log`、`browser/sites-checkpoint-6/`、`browser/lazy-checkpoint6/`。当前轻量阅读传输和脚本体积正在最终复验，上述定向结果不等同最终发布验收。

## 20:45 阶段增量证据（非最终验收）

- S8 固定 6,756 个源文件哈希，789 个测试文件中 787 通过、2 失败；28,486 项通过、3 失败、6 条外置 PDF 条件跳过。全源 S/L97.53%（162,555/166,658）、F89.00%（11,706/13,152）、B96.79%（86,177/89,026），四维 100% 未通过。三条失败是过期模板断言及验证归属登记，当前已定向修正，尚待 S9 全量确认。
- S8 Chrome 与另外 17 项顺序发布构建/清单/归档/类型/文档检查全部通过，六份 ZIP/XPI 全文件 CRC/SHA 一致。普通脚本 1,857,226 字节、standalone 3,592,912 字节通过原门槛，GF 2,916,980 字节仍失败。相同 527 文件 level6→9 减少134,822 字节；正式包相对旧基线 level6 减少133,560 字节、相对旧基线 level9 增加1,278 字节，不混淆压缩参数与源码变化。
- S8 浏览器 72 路径中 21 通过、LearnOpenGL 悬浮在翻译前站点/夹具契约未就绪、MkDocs 悬浮记录所属进程实际激活并由保护中止，余49未执行。未自动重试；只有归属与时序证据，不能确定激活触发者。S6 的无违规记录不能抵消后续事件。
- 最新恢复文件输入和预览归属均经旧实现失败再验证，LocalDataManagement 的 11 条新增竞态已纳入318项组合。远程同步补真实首次同步方向返回和删除短语确认/重开清空，23项通过，RemoteConfigSync/SiteAdaptation 函数均100%。
- 收藏条目中 act 只有掌握/删除两个调用者，学习入口直接发事件；删除未用 study 分支。新增实际 CollectionEntry→SavedExplanation 编辑、取消、保存并传回更新与脚注学习/删除合同；另补缓存清空单飞、失败重试、离页成功不再读统计和两个容量输入同补丁。三文件207项通过，两个目标组件函数均100%；CollectionEntry S/L100，缓存S/L96.87%，分支仍未100。
- 本轮只读审阅 CollectionEntry 完整源码及调用点，并将当前SHA与旧记录并存。七份台账核对S8自有1,149源码均有当前匹配；生成vendor的3,044 AST函数体未宣称人工全体逐函数审阅。

证据：`checkpoint8-global-coverage.log`、`checkpoint8-global-gap-summary.json`、`checkpoint8-{web,media}-build-results.json`、`checkpoint8-compression-comparison.json`、`web/s8-browser-readonly-diagnosis.json`、`root-final-ui-controls.log`、`root-final-ui-coverage/`。S9将启用可取得原始输入的PDF条件用例；缺少Harness原件及两份旧布局时仍明确记为未执行，不制造替代输入。
