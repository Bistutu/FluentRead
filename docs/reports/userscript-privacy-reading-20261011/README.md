# CW userscript 隐私和临时阅读修复：正确性已验证，体积与浏览器验收仍阻塞

源码提交 `1a39eb1b1fb0c65766b61c7c0b66a0dfc2dfb0fa`，tree `05c5e75b7fdc115d0fea6202d771d5cf50588193`，父提交 `09bc5913ca239eadade50ffbdb7e731bda66d79a`。本轮在 CW 本地修复两个实际可达接口：SelectionTranslator 读取缺失的 `browser.extension` 会使 setup 抛错；ReadingPanel 经真实 client 调用缺失的 `runtime.connect`，无法完成阅读。正确性修复独立保留，没有用体积预算撤销功能或把接口填成假成功。

最终相关回归 **8 文件、427/427 PASS**；TypeScript/Vue、Chrome/Firefox 扩展构建、原 manifest verifier、文档构建通过。**GF、标准、standalone 三个原体积门禁均失败**，具体见下表。合成测试不是 Neo 或脚本管理器实测；本轮隔离 Neo extension 无痕启用与 localhost 浏览器验收 **未运行**。

## 隐私语义与可用范围

- shim 只解释词法 `GM_info` / `GM.info` 上自有、严格布尔的 `isIncognito`。缺失、错误类型、继承字段或 getter 抛错的别名不提供证据；另一别名仍可提供有效布尔。没有有效证据或两个有效别名冲突时保留 `undefined`。`browser.extension` 与 `chrome.extension` 同源；分派先快照三态，payload 自报身份不能替换可信 sender。
- 扩展 UI 原有 `=== true` 语义保持。userscript 在明确 false 时保留原词书路径；true 或 unknown 在词书 handler/数据库调用前拒绝持久化访问。没有恒定 false、URL/存储推断或新增 grant。
- [Violentmonkey 官方 GM 文档](https://violentmonkey.github.io/api/gm/)描述了布尔 `isIncognito`。本轮获取的 Tampermonkey 文档页面没有匹配字段，不能据此保证它提供相同元数据。官方页面抓取 SHA、时间和有限摘录见 [元数据收据](USERINTERFACE-GM-OFFICIAL-METADATA-FOLLOWUP.json)。实际管理器版本与普通/私密/缺字段路径未验收。
- 这里只限制词书/阅读持久化能力，没有宣称整个产品在 private/unknown 时不做任何配置或计数存储，也没有宣称同一特权脚本沙箱不可篡改。

## 实际临时阅读与原生行为

新增同沙箱成对端口，发送时 structuredClone、FIFO 微任务传递，terminal result 先于断连通知。服务端 owner 来自组合根且冻结；没有 DOM 消息桥、网络监听端口或持久化端口。未装配 owner 时明确报“阅读连接尚未就绪”，没有空 port。

slim/full 平台实际装配原共享 reading handler、stream adapter、Harness runtime、model gateway 和 loop。支持选中文本分析及卡片内追问，最多携带最近四轮问答历史；取消、超时、替换、ready 前取消、late result、config 模型变化和离页清理由真实接口处理。计数与无关 UI 变更不取消回答；URL 变化在后续 eligibility 检查拒绝，没有新增即时 SPA 导航监听器。pagehide 的原计数 flush 可保留消息 handler，同时独立关闭阅读端口和订阅。

阅读在普通、私密、unknown 三态均明确为临时能力：不装配 session store、memory reader 或 usage sink；拒绝 session/anchor 恢复、session CRUD 与 memory CRUD，返回明确理由。原始 sender 三态传给共享 runtime，未把 unknown 硬编码成 normal；共享 runtime 的原布尔默认参数没有改，安全边界来自此组合根没有持久化 reader/sink。

ReadingPanel 的 `persistenceSupported` 与隐私分开；默认 true 保留扩展原历史/笔记行为，userscript 显式 false。中途测试发现 Vue 缺省 boolean 会变为 false，已经改成 `withDefaults(..., {persistenceSupported:true})` 并保留原生回归。HTTP 页缺少 secure-context UUID 的真实 SFC 失败也已修复：owner 用本沙箱递增身份，UI 请求 ID 保留 UUID 优先及临时 fallback。不是安全授权令牌。

[共享合同收据](USERINTERFACE-UNCHANGED-CONTRACTS.json)证明 client、background handler、streamPort、Harness runtime/model gateway、原生 background runtime 与父提交逐字相同；loop/config store/WXT 的逐字绑定补充在 [来源和测试绑定](SOURCE-TEST-BINDING.json)。两个 SFC CSS 源文逐字相同，data 资源只有编译 scope ID 导致的 `data.css` 哈希变化，字节数不变，其余叶值相同。

## 可复核测试与失败记录

所有重阶段串行以 CPU target 60%、maxWorkers 1、concurrency 1 运行，pnpm 9.12.1、现有依赖、Node 26.11.1。资源 prepare 只允许两份固定资源写入，其余 stage 都核验源码未变。[STAGES.json](STAGES.json)保留精确命令、UTC、source/patch/log SHA、退出码；日志中的墙钟显示受本机 Node 时区影响，以 stage 的 UTC 为绑定时间。

| 验证 | 结果与边界 |
| --- | --- |
| 最终八文件合同/生命周期测试 | **427/427 PASS**；包含真实 shim、Vue SFC、client、成对端口、handler、Harness runtime/model gateway/loop；SDK streamText 受控 |
| architecture 全分组 | **33 文件、1712/1712 PASS**；运行后只改 vendor/vite/resources 和两份指南，运行时/测试源码与最终一致 |
| compile | PASS；最终测试/类型检查与 code commit 只差两份指南 |
| Chrome / Firefox build | 两者 PASS，精确最终 source snapshot |
| 原 extension manifest verifier | PASS，生成 manifest 绑定最终源码；WXT 配置、权限、CSP 未新增；不是 installed allow-incognito 证明 |
| docs:build | PASS，最终指南；本报告随后加入，`reports/**` 已被 VitePress 排除 |
| test:audit | PASS，654 文件、10904 静态 case；不是 10904 个用例执行通过 |
| 固定 vendor VM probe | 实际 SDK streamText + 合成 LanguageModel v3 输出通过；函数、Zod schema/tool 和 provider 构造通过；observed network/database calls 0 |

真实阅读 seam 测试保留 actual provider constructors，禁止 global/runtime fetch、GM、WebStorage 与 IndexedDB I/O并断言零观察调用。实际全局 config import 有预期的 storage-runtime-unavailable 初始化警告，在存储边界前失败；没有把这描述为“内部从未尝试配置初始化”。VM 与测试不证明真实 API、管理器沙箱、CDN 或浏览器 UI 通过。

失败日志原样保留，除绝对路径/ANSI 脱敏外不删改：

- baseline diagnostic 135/135 使用“期望旧异常”证明旧接口问题，不能算修复通过；SFC 正向 red 为 138 个中 2 fail，修正后的 privacy/UI red 为 180 个中 20 fail。
- 初次 privacy red 的 test patch 少括号造成解析失败，是夹具合并错误；后续修正后才得到语义 red。
- partial green 的 13 fail 包含八个同步 listener 夹具误用（改为原合同允许的 async response）、四个实际原生持久化默认值退化和一个尚未连接的 reading 路径。没有改原分派协议来迎合夹具。
- runtime preflight 的 17 fail 来自旧 config store mock 未提供新消费的 subscribeConfig，补齐 noop unsubscribe；HTTP SFC red 1 fail 与 unhandled UUID 异常则是真实实现缺陷，随后修复。
- 185 与 307 个中间 green 保留其各自源码绑定；最终以 427 个 green、来源差异清单和原门禁结论为准。

## 原体积门禁与固定资源

| 模式 | 实际文件 B | 原预算 B | 超额 B | 原 verifier |
| --- | ---: | ---: | ---: | --- |
| GF | 2,316,434 | 2,000,000 | **316,434** | FAIL |
| 标准 | 2,329,902 | 2,025,000 | **304,902** | FAIL |
| standalone | 3,883,153 | 3,600,000 | **283,153** | FAIL |

[全部成品 SHA 与退出码](USERINTERFACE-ALL-OUTPUT-GATES.json)。标准/standalone 的 Vite build exit 0 不代表原 verifier 通过。GF 正常 wrapper 通过原 vendor 三输入/资源一致性检查后，在原 size 断言失败；GF 后续 verifier 断言未运行。standalone 后续断言也未运行；标准 verifier 的子进程失败报告在日志中保留。没有增大预算、修改目标、绕过 wrapper/verifier、修改 package/lock 或删除完整产品行为。

GF SHA256 `b47c0cb5457ca920e35c695a77a671f5fbdeb26bceb328abc6fd36d6c8c75d19`。相对父报告，GF 主文件增加 68,569 B、vendor 增加 287,135 B、data 同字节但 CSS scope 哈希改变，三份资产合计 4,201,385 B，增加 355,704 B；标准增加 326,603 B，standalone 增加 309,113 B。真实阅读闭包的正确性没有为满足体积而撤销。

两份固定资源与入口同 commit `1a39eb1b…`，committed/tracked/built 相等：vendor 889,381 B，SHA `97043572b031723354cc35521f81e8a0da890c41f1b0fecf430a72fa6df00a39`；data 995,570 B，SHA `4f49c29957c9caf94674a52a698312a17ac36608524127919fe524617b935ddf`。[正常包装器收据](USERINTERFACE-GF-ORIGINAL-WRAPPER.json)记录 vendorEntry、vendor config 和 lock 的精确绑定。vendorEntry 本轮更新；不能说三个 guard 输入全部与父版本相同。

原元数据仍指向官方 `FluentRead/FluentRead@1a39eb1b…` CDN 路径；URL 未抓取，fork 推送不能证明官方资源已可用。没有用新路径或绕过上游 403 代替这一限制。

## 通用依赖测量与有限候选

新增 streamText/tool vendor 导出是实际阅读所需兼容面；GF 同时将精确 Zod、Anthropic、Google 根映射到固定 vendor。标准/standalone 保留其原打包边界；没有外置 Harness、UI、broker 或产品控制流。

[真实对照](GF-READING-GENERIC-ROOTS-DIAGNOSTIC.json)在相同 code/resource 下重建正常控制，结果与 wrapper 的 2,316,434 B / SHA 完全一致；再仅在内存撤销三个 generic external/global 映射，保留新的 AI streamText/tool vendor。counterfactual 主文件 3,149,736 B，因此三根合计净减少 **833,302 B**。这个差值是相同 vendor/data 的主文件测量，不是相邻旧版本收益、各包独立贡献、总资产最优或运行性能证明。默认 GF 成品和源文件未改变。

正常 [386 模块图](GF-READING-GENERIC-ROOTS.control.graph.json)与 [415 模块对照图](GF-READING-GENERIC-ROOTS.three-roots-inlined.graph.json)均为实际 Vite 输出，前者已精确绑定当前成品。386 图没有正 renderedLength 的 node_modules 代码；较大的 Selection、全文翻译、SettingsPanel、Config、broker 与 ReadingPanel 产品逻辑保留。renderedLength 是 JavaScript 字符，不是可删除 UTF8 B。

现有依赖版本与许可证声明为 ai 6.0.264 / Apache-2.0、Zod 3.25.76 / MIT、Anthropic 3.0.116 / Apache-2.0、Google 3.0.121 / Apache-2.0；provider-utils 两个既有版本 4.0.46 / 4.0.50 没有去重或升级。原 license notice 插件保持，部分已装包没有本地 LICENSE 时仍用原 repository fallback；这是 provenance 静态审计，不是完整许可证发布认证。

[有限元数据 screen](GF-FINITE-DATA-SCREEN-FOUR-BASELINE.json)仅绑定旧 375 模块基线：皮肤/字体 option literal 8,812 B、loading style option literal 4,438 B，gross 合计 13,250 B。当前对应源表仍相同，但替代 guard、资源增长与主文件净收益尚未测量，未应用，不能算当前缺口收敛。当前图复核没有证明足量安全的新边界，不能据此宣称已穷尽、SOTA、Pareto 或全局最小。

## 未运行与最小下一步

旧浏览器 runbook 的“launch is now disabled”源于原 sessions 完成和 owned cleanup，不是安装故障。本轮按后续指导只读核对原任务工件、精确临时 profile 的 Singleton 协调元数据及记录 PID：[lease 复核收据](USERINTERFACE-BROWSER-LEASE-READONLY.json)记录 13 个原任务 profile、221 个精确 PID；旧 lease 已过期且目录不存在，没有存活的旧 Singleton owner 或记录进程。没有读取 profile 内容或凭据，也没有全局进程扫描。这只能证明原任务的现场状态，不能证明其它 Pi/Recovery 任务释放。

原独占锁是 `<CW_WORKSPACE>/pr906-standalone-browser-close-20261011/BROWSER-EXCLUSIVE-LEASE`，只作用于该 evidence 目录，未建立与其它任务共用的登记。已经向上层请求 Pi/Recovery 当前共同遵守的协调记录路径、owner 和有效时间。原 extension helper 还会新开 `--browseros-cdp-port`；当前禁止新远控端口，因此没有复用它或绕过旧 launcher 的源码/lease/disabled guard。需要共同协调记录与符合无新增远控端口约束的本地验收流程，再建立新独占记录。本轮 **未启动 Neo、未启用 installed allow-incognito、未运行 localhost 浏览器验收**；已给出的限定无痕批准保留，不重复请求。

体积与资源下一步需在原 2 MB 门槛下证明较大等价收敛，并核实同 commit 官方资源可用性。不能把旧 userscript 会话当作本轮 extension incognito 证据，不能靠假 port、normal 隐私常量、删除 UI/阅读、改预算或新依赖解除阻塞。

本轮没有真实搜索/模型 API、付费调用、凭据变更、安装依赖、新增安全权限、远程控制端口、日常 profile、浏览器默认项或 Pi/Cua/Neo 安装动作。原 docs:check / Storybook 缺依赖问题来自前轮，本轮未重跑或安装修复，不作当前通过声明。#912 仍保留冻结 head `ee2c29bd5be95c2670ff2fa9ecc13985bbe85651`，main/语言 pin `25f5dca794848782f717493ce0e08545a0e57b35` 和 icon 184a 未更新。当前分支为 `fix/shared-retry-after-cooldown-20261009`，未将这轮代码跨推词典分支。

完整 source maps、成品与补丁留 CW evidence；本目录只发布选定脱敏日志和收据。[EVIDENCE-ORIGINS.json](EVIDENCE-ORIGINS.json)分开记录原文件和脱敏文件 SHA，helper 副本中 `<CW_WORKSPACE>` 等路径是审阅占位符，复现前需映射为本机路径。[MANIFEST.sha256](MANIFEST.sha256)覆盖除自身以外全部报告文件。此前审计候选文件按其原状态保存，最终应用、修正和执行状态以本报告及 SOURCE-TEST-BINDING / STAGES 为准；CODE-COMMIT 的 pushed:false 是源码 commit 冻结当时的历史状态。
