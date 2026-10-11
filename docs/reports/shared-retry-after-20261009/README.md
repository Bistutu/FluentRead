## 2026-10-11 冻结 main 整合与标准预算修复

已验收代码：`646849ad8207092842905da2610ac39311ea329c`，树 `7f5b5b3038f17e8b1890d047ee2dd29e40d209dc`。本轮只合入冻结的 main `dc335c698c05d8a5d11dbaadacb598c0695894f8`，没有追逐更新的 main。四处实际冲突已解决；输入框处理器保留 main 的请求标识校验、共享取消注册、配置就绪及 provider 返回后的取消检查，在首次等待前从可信 sender.tab 快照三态隐私，同一个 request 先附 glossary/privacy 再附不可枚举 control。原生批处理配置、恢复和真实 attempt 的 quota/transport lease 保留。

17 个文件的 **606 项不同定向用例通过**；新增净 21 项，覆盖可信普通/私密/unknown、等待前隐私快照、跨 tab 同 ID 取消隔离、忽略 abort 的原始传输持槽/不缓存、三出口 CommonJS policy 与既有视频状态查询协议。类型检查、测试审计（642 文件、静态计数 10,664）、Chrome/Firefox 构建、manifest 核验及标准原 CLI/verifier 通过。审计计数不是全仓库执行结果。首轮缺少浅克隆中的固定图标 Git 对象，补取同一不可变提交后验证通过；资源 pin 未改。仅按冻结 lock 的 SHA512 补齐 fontkit 1.1.1，不运行安装脚本，不改共享依赖树或锁文件。

标准实际成品 **2,004,276 B**，SHA256 `4c65c5d613bebd31f01bc8b922b804ef8b061bc9d5b1440f7790fa22cd23c7a3`，原 **2,010,000 B** 预算余量 **5,724 B**。同一整合版本的真实对照如下，静态 gzip 参数保持原 pako level 9：

| 实构建 | 字节 | 相对前一步 |
| --- | ---: | ---: |
| A：原 CommonJS auto | 2,010,415 | — |
| B：标准出口 strictRequires=true | 2,010,759 | +344 |
| C：排除既不可达图片/圈选设置及两个 UI re-export | 2,004,276 | −6,483 |

strict 的 344 B 是确定性正确性成本。死 UI 修正净省 6,483 B，组合相对 A 净省 6,139 B，均为本轮实测，不套用 #912 历史的 6,487 B。仅三个父级 loader 做 userscript 构建分支，AreaTranslationSettings 组件、模板及扩展加载分支保留。CSS 叶规则 1,278→1,018；保留规则逐字节、按祖先 at-rule 与原顺序不变。删除范围含不可达 UI 及其在标准版唯一带入的共享布局组件；基础设置与划词样式保留。两种扩展 manifest 字节不变；选项块名称和作用域样式发生变化，不宣称全部扩展产物二进制一致。[CSS 静态审查](./css-review-20261011.json)

同一最终标准输入的五个不同 gzip 候选如下。当前 pako9 复现只算 baseline；诊断与最终输入复验仍算五轮。以下完整输出数值由同一产物仅替换静态 gzip literal 精确计算，属于反事实，不是五次原构建：

| 轮 | 假设/候选 | 相对 C 字节 | 保留/淘汰理由 |
| --- | --- | ---: | --- |
| R1 | 恢复原 catalog/CSS zlib9 路径 | +8 | 当前大小轴没有收益；时间/内存未知 |
| R2 | 六受控资产 pako9 memLevel9 | +124 | 当前大小轴无收益，增加参数选择 |
| R3 | 六受控资产 pako9 FILTERED | +19,172 | 大小增加，运行成本未知 |
| R4 | 六受控资产 zlib9 windowBits13 | +40,224 | 大小增加，窗口成本未测 |
| R5 | 逐资产选择上述最小 base64 | −60 | 未计分派代码及维护成本；不为有限收益加入混合分支 |

全部候选经本机 zlib 与 pako 解码，decoded SHA 一致。最终八份 gzip 输入中只 CSS 改变，另七项未变；没有把旧 CSS 或旧 +56 B 诊断转移为新测量。五轮测量树为 `a24199c6…`；随后补视频状态协议 relay，在最终树重建出的标准产物完整字节/SHA 与 C 相同，故按精确产物和输入复用五轮，旧源码相等断言不套到新增 relay 的源码。[候选及逐资产数据](./gzip-candidates-20261011.json) · [可复现只读测量脚本](./measure-gzip-candidates-20261011.mjs)

这些结果支持保留简单 pako9 路径及本轮标准预算修正。编码时间、RSS、浏览器解码、运行延迟/吞吐和混合实现成本仍未知；scheduler 算式与 graph 许可未在本轮独立消融，不分别归功旧组合 1,645 B。没有判断任何方面达到极限，也没有证明全面 SOTA/Pareto；五轮候选不是最优性证明。

Standalone 首次真实构建暴露 video state-query 在 adapter 中缺 relay，已补既有协议并加入真实无 mock 回归。修复后完整构建 **3,816,337 B**，SHA256 `f851133b9d68edfa945557fcd25e8848cdd31cfa205190027a67c64b85dcb9e2`；原 verifier 因 **3,600,000 B** 预算失败，超 **216,337 B**。没有测量当前 standalone 对照，因此不推断旧构建失败或把全部超限归于本 PR。该门禁保留，#906 保持 draft；未复制 #912 其余设置裁剪/pako 包装方案重复执行。

本轮未执行当前产物真实浏览器 IIFE/CJS、真实供应商/模型/搜索、GPU/WebGPU、GF 构建/verifier或全仓库测试。不同 SHA 的旧浏览器证据不作为当前成品验收。全部本机重负载共享 resource-safe：CPU 目标 60%、worker 1、并发 1；未改凭据、用户 profile、能力/安全设置或 release 版本。PR Ready/正文权限边界仍由父线程处理，不绕过 integration FORBIDDEN。[源码/阶段/产物绑定与限制](./integration-20261011.json)

以下历史报告原字节保留，其提交、预算和失败项属于各自旧证据。

---

## 2026-10-10 整合说明

本次已解决与 main 的合并冲突。浏览器和真实服务尚未验收，#906 继续保持草稿。

已验收代码提交：`0529ccda6f85e973f216d0fcdef2db7d87cf96bd`。合入的 main：`f1af6300b240ce65d00d36dec37ab50742197044`。

483 个相关用例最终通过：首轮 448 项通过，补齐旧测试 mock 缺少的下载进度查询导出后 8 项通过，另有 27 项 AI SDK 回归通过。隐私断言没有修改。类型检查、测试审计及标准版原始构建和验证器也通过。

标准成品为 **1,963,830 字节**，SHA256：`52efce1564b29046484988ba3b884931e35f7ce76011da76d808d01e01025d8a`。保留 main 原有 **1,965,000 字节**预算，余量 **1,170 字节**。

本轮未重跑 standalone/GF 完整构建及验证器、全仓库测试、扩展或文档构建，也未运行真实浏览器、供应商、模型或搜索验收。下方旧报告及其 standalone/GF 超限、固定资源记录属于旧提交 `18e049003bffab6d2bd49220c48b569b0a70856e` 和原基线的历史证据，不是本次合并后的新测量。本段只补充已完成的验证说明，没有重新构建。

---

# 共享 Retry-After 冷却 · 2026-10-09

真实 HTTP 429 和带有效 Retry-After 的 503 反馈到既有 scheduler，broker 请求与 SDK 的真实重试共同等待；SDK 保留重试所有权、次数和总 deadline。429 缺省/无效头复用首次 2 秒退避，503 无有效头以及 401/403 不增加共享冷却。数字秒、HTTP-date 和 retry-after-ms 的等待上限为 7 天，仍受调用者 deadline 限制。

SDK 外层逻辑任务不计并发/速率，真实 attempt 在既有 global、service、model+service 池中各计一次。非 SDK 直接传输与连接测试在外层计数。summary、single、batch 的 pending 摘要隔离实际端点、有效 Key 集合、轮换/恢复设置与可信隐私；真实 transport 使用本次选择的 Key，成功缓存规则保持原状。可信 sender.tab.incognito 区分普通/私密；无 tab 或无明确布尔元数据保持 unknown，后台自身状态和 payload 不决定发送者隐私。

## Doubao Seed 与 probe 原始传输修复

本轮从 98e88a90489b39e9a6be8e2c71019daeaa297e23 接续。Doubao registry wrapper 用 currentConfiguredModel（包括 modelOverride 与自定义模型）选择 Seed Responses adapter；服务级 isAiSdk('doubao') 却把该直接 adapter 当成 SDK，取消外层计数，而它没有内部 scheduleAttempt。因此 cap=1/3 出现 2/4 个未结束传输。

broker 的局部 SDK 路由谓词现在使用同一配置模型与 isDoubaoSeedTranslationModel。它同时决定 quotaScope、外层 countConcurrency 和 countRate。customBody.model 不参与协议选择；普通 Doubao SDK 仍由真实 attempt 计数。实际 registry→wrapper→adapter 的 14 项合成用例覆盖 cap=1/3、配置模型、override、自定义模型及 body-model 冲突；原始传输故意忽略 abort，取消后仍持槽，settle 后才派发下一条，实际峰值不超 cap，取消不写缓存。

直接连接测试的 30 秒 abort 会令 SDK uncounted attempt 的等待者先拒绝，但原始 runtimeFetch 可继续运行。旧 probe lease 只持有 adapter operation，因而在 raw 未结束时提前归还槽。现在连接测试在 schedule 的外层 lease 内构建 symbol scheduler context，传入窄可选 transportLease；adapter 创建 raw promise 后立即 holdUntil(raw)，再 await。broker 不传该字段，其 counted attempt 仍自行等待 raw settle。这是一个已证明的实际消费者；没有机械恢复上一批无消费者的泛用 lease 分支。

global、service、model+service 三种 cap=1 桶，分别测试首次 raw 与首次429后第二次 raw：probe 调用者在30秒收到超时，健康B在60秒预算内继续等待，raw未settle前无B网络派发，settle后恢复，峰值1且不写缓存。最终有效红例是 **14失败、6普通SDK对照通过**，83个旧用例未在该 targeted 红例中执行；修复后 **111/111聚焦用例通过**：[原始红例](./seed-probe-red.json)、[原始绿例](./seed-probe-green.json)。最初错误夹具的非匹配SDK端点、错自定义模型字面量以及导入转换失败均不作有效红例。所有网络由严格合成URL白名单的 runtimeFetch 夹具接管，没有调用供应商。

上一批9项 mixed probe 测试验证的是排队 broker 的完成/取消/deadline，与本轮 probe 自身超时后的 raw 持槽不同；不能把上一批91项契约冒充已覆盖本轮新边界。旧 counted/uncounted FIFO 互锁修复与真实注册 messageRuntime 隐私修复继续保留：[mixed probe 红例](./mixed-probe-red.json)、[隐私红例](./message-runtime-red.json)。

## 标准 userscript 的最小体积修正

功能修复后标准产物为1961638字节。随后仅合并已有 scheduler 的入队初始化与等价 wake 最小值计算、复用已安装 pako level9 编码静态 JSON/CSS、令图标许可跟随实际 SVG 模块图。完整出口仍保留 Lobe MIT 许可全文；轻量标准/GreasyFork 没有该 SVG 表。原图标、SVG JSON、许可文件与远程固定资源未改，未压缩可执行源码或增加依赖。

组合实测标准为 **1959993字节**，净减少1645，原1960000上限剩 **7字节**。此余量很窄，不保证其他工具链产物。7份嵌入gzip静态数据的解压内容多重集与未修改8467基线逐字节一致，实际嵌入base64合计仅减少48字节；静态候选中未进入标准图的理论编码收益不冒充最终包收益：[体积修正](./minimal-size-change.json)、[静态内容一致](./static-data-equality.json)。

此前SVG字符表压缩已撤出#906，仍仅是CW本地独立候选，没有新建公开PR。历史standalone收益17468字节不作为本次标准体积方案：[历史SVG实测](./svg-size-comparison.json)。上一批泛用lease调用审计与组合187字节收益是98e88历史记录，本轮建立了新的probe实际消费者：[历史调用点审计](./provider-lease-call-audit.json)、[历史Occam实测](./occam-size.json)。

## 构建许可路径修复与当前模块图证据

389a3f1独审发现：generateBundle左侧normalizePath(id)，右侧resolve(root, ...)未规范化，Windows原生反斜杠路径与Vite规范化模块ID不等，standalone实际含SVG却会漏附Lobe许可。现在仅给右侧增加同一个normalizePath，不改变翻译、scheduler或静态gzip逻辑。

新增8项回归执行真实generateBundle handler：POSIX、Windows Vite正斜杠、Windows原生反斜杠以及query ID，各含SVG/无SVG；原实现3个Windows含SVG反例失败、5个对照通过，修复后的整份配置测试28/28通过。Windows路径端口按锁定Vite5.4.19的slash+posix.normalize行为模拟，没有声称在Windows操作系统上构建，也没有只传wrapper布尔值代替实际判定：[红例](./license-path-red.json)、[绿例](./license-path-green.json)、[本次验证](./license-path-validation.json)。

用只读Vite observer记录真实生产entry.moduleIds与entry.modules，未改bundle。当前标准492个模块中SVG相关筛选为空，实际不附该许可；standalone1216个模块包含serviceBrandPaths.json及ServiceIcon，完整Lobe MIT许可字节存在。两份Linux产物与389a3f1逐字节一致：标准1959993、SHA256 7ee7ff35d769ed383dfe1bfbf9983af1414414748fdb1a0bcaf7f940eac36ec5；standalone3797330、SHA256 e174bc76a8bd80c67bcd66de323b7324f091f40b6bd504d196abb64aec584a5e。原标准verifier通过，类型与测试审计通过。

旧standard-svg-dependency中的1961932记录与旧standard-module-attribution已被本次实际图记录替换，每份明确绑定最终产物SHA/字节和当前配置源码SHA：[标准实际模块图](./standard-svg-dependency.json)、[standalone实际模块图](./standalone-svg-dependency.json)、[当前模块归因](./standard-module-attribution.json)。归因的renderedLength仍是未压缩tree-shaken值，不作为可相加的minified收益。此前pako解压字节一致与scheduler语义验证由389a3f1证据复用，功能源文件完全未改，不重新跑1690大套件或未变基线；本段之后的1690/覆盖数据明确指389a3f1已完成验证。

## 验证与剩余阻塞

389a3f1候选57个相关测试文件 **1690/1690通过**；本次仅改构建路径判定，相关功能源文件未变。9个原严格范围内模块（包括本轮改变的connectionTest）statements/branches/functions/lines均 **100%**；SDK adapter、areaRuntime和messageRuntime整文件原本不在该范围，实际改变路径已执行，不声称其整文件100%。TypeScript、测试审计、Chrome/Firefox构建和原标准userscript verifier通过：[测试范围](./affected-tests.json)、[覆盖率](./coverage-summary.json)、[源码SHA256](./source-sha256.json)、[阶段记录](./validation.json)。

| 产物 | 未修改8467基线字节 | 当前候选字节 | 本PR新增字节 | 原上限 | 基线超限 | 候选超限 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 标准 userscript | 1959494 | 1959993 | 499 | 1960000 | 0 | 0 |
| standalone | 3795702 | 3797330 | 1628 | 3600000 | 195702 | 197330 |
| GreasyFork source | 2320196 | 2322749 | 2553 | 2000000 | 320196 | 322749 |

同checkout、同Node26.7.0/pnpm9.12.1/Vite5.4.19、原锁文件的未修改8467基线已经测量并核实原标准入口/只读归因hook SHA一致；本轮复用该未变证据，不重新跑基线。历史标准1959450记录与实测差44字节，单列而不替代实测。[当前产物字节/SHA](./size-attribution.json)。

standalone builder生成产物，但原体积verifier失败；GreasyFork Vite阶段生成产物，外层固定资源检查及原体积verifier失败。这些门禁在8467基线已失败，本PR新增字节另列。当前生成fluentread-data.v1.js SHA256仍为34bcb22e60894c88d3b45f4b23c3c6e1c03d1e21614a23caf896ad7333140951，与基线完全一致；固定资源缺少既有document.pdfReading键。未执行--prepare-resources、替换固定资源/URL或提高budget：[基线资源差异](./baseline-resource-diff.json)。

既有broker取消/超时、raw-inflight cap1/cap3、速率/FIFO、pending与普通/私密/unknown隔离契约保留。implementationAudit48A只修正过时Bilibili DNR断言，精确规则、保留外部42、hydration与无fetch对照继续通过。

30种子原始重放是10675历史证据，最终相关套件复验同一契约，未重复未变基线。历史B0/B1-C为60/120成功、270 HTTP attempts、180次冷却内额外A派发；C为120/120、150、0，健康B时序/状态/17511实际UTF-8 body字节一致：[B0](./replay-B0.json)、[B1-C](./replay-B1-C.json)、[C](./replay-C.json)。载荷字节不等同token计费，不证明真实供应商性能。此前消融亦仅标为10675历史记录：[消融](./ablations.json)、[饱和红例](./saturation-red.json)。

#906保持draft，standalone/GreasyFork体积及固定资源门禁、独立审计尚阻塞ready。全部在CW用原资源保护器串行运行，CPU目标60%、worker1、并发1；未新增依赖/权限/环境，真实模型/搜索API调用0，Recovery所有窗口和进程未操作。真实供应商、GPU/WebGPU测试未运行。
