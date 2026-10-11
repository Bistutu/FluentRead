# 共享 Retry-After、取消隔离与 userscript 预算验证

同一供应商返回 429 或带有效 Retry-After 的 503 时，仅让当前请求退避仍会允许其它翻译请求继续派发。本分支把反馈接入共享调度池，让 broker 请求与 SDK 的真实重试共同等待，同时保留 SDK 的重试次数和总 deadline。输入框翻译在首次等待前固定可信 sender.tab 的普通、私密或未知状态；跨标签页同 ID 的取消互不影响，忽略 abort 的原始传输实际结束前继续持有并发槽，取消结果不进入缓存。

完整 Options 内联进 standalone 后，既有能力过滤只阻止显示，仍会把不可达模块打包。原成品 3,816,337 B 超出原 3,600,000 B 门禁。新增构建分支排除六个已不可用的设置加载器，复用 pako 2.1.0 解压专用入口，并无损压缩 tldts 的静态公开后缀表。最终 standalone 为 **3,589,855 B**，低于原门禁 **10,145 B**；标准版保持 **2,004,276 B**，余量 **5,724 B**。没有修改预算、依赖锁、资源 pin、权限或发布版本。

**两种最终 userscript 已在 Neo 的独立临时 profile 中通过 localhost 合成验收**：执行的是上述原 CLI 成品，浏览器内取回脚本的执行前后 SHA 均一致。覆盖 IIFE 初始化、真实 CommonJS 工厂、gzip 偏移/错误合约及设置交互；扩展无痕访问、真实供应商和 WebGPU 仍未验收。

## 最终源码与验证范围

源码提交：`3618398ba86436938747a32f4072857a9dae4db2`；树：`d13bc56a107cbd0c96f764b7d0f020528778ed5b`。整合基线：`9c1ed3ccf235ea4e860392bc215258390829a3d1`；冻结 main：`dc335c698c05d8a5d11dbaadacb598c0695894f8`。每份最终原 CLI 构建前后文件摘要一致，并逐文件核对到源码提交；文档提交单独记录。

| 成品 | 原预算 B | 实际 B | SHA256 |
| --- | ---: | ---: | --- |
| 标准 userscript | 2,010,000 | 2,004,276 | `4c65c5d613bebd31f01bc8b922b804ef8b061bc9d5b1440f7790fa22cd23c7a3` |
| standalone | 3,600,000 | 3,589,855 | `a98976e459defb4c770911b327297f437e9d2b19096317968a13cc9fdc5dbaf9` |

8 个文件的 **151 项不同定向用例通过**。首轮 149 项通过、2 项新测试失败：Vitest SSR 导出对象与 esbuild CommonJS 导出对象的枚举顺序不同。修正名称集合比较后，新文件 24 项通过；七项声明顺序、数组构造器、完整数组字节、字符串及 roots 的断言保留，其余 127 项对应源码未变。类型检查、测试审计、两种 userscript 原 CLI/verifier、Chrome/Firefox 构建及 manifest 核验通过。审计覆盖 643 文件、静态计数 10,669，不能当作全仓库运行数。

历史 606 项通过结果按 17 文件逐项去重，并给出各批日志、测试 blob 与生产树的对应。该阶段修复净增 21 项；相对旧分支同五文件实际净增 37，另 16 项继承 main。历史 standalone 构建树 `09be0311…` 到 `7f5b5b30…` 只改变测试，后者到 `9c1ed3cc…` 只改变文档；因此基线产物来源可以明确绑定。历史用例未整批重跑，也不自动证明新产物的浏览器运行。[逐文件核对](./test-binding-20261011.json) · [最终源码、原构建与成品回执](./standalone-validation-20261011.json)

## 设计与兼容性

六个 loader 分别是 WritingSettings、VideoLocalModelSettings、VideoSubtitleAppearanceSettings、ModelUsageDashboard、TranslationStatsDashboard 与 ContextMenuSettings。Options 的既有 userscript 路由已将前五项所在页面转为不可用页，右键菜单仍显示既有不可用提示；supported LocalTts、视频状态查询 relay 和配置迁移保持。Chrome/Firefox 继续走原 defineAsyncComponent 分支。Vue 源码变化会改变 scope/chunk hash，不能宣称扩展全部字节一致；两份 manifest 与基线逐字节相同。

pako 深入口保留完整 inflate、校验和、UTF-8、字典及串接路径。tldts 插件仅处理锁定包中七项字面量导出，拒绝调用、spread、越界、稀疏数组、类型或构造器变化及非法语法；同步恢复原 Uint8Array/Uint16Array、原顺序、字符串和两个根索引，解析算法及包入口不改。标准版使用既有固定依赖，Greasy Fork 不启用后缀表转换。原模块 ID 保留，最终完整许可前缀与组合对照逐字节一致，含 pako、tldts 与 Lobe MIT。

## 实构建对照与取舍

E1–E5 分别从同一 `9c1ed3cc` 基线应用一个独立补丁。E5 是组合实验，不把前四项收益机械相加。E6 从 E5 加入无损后缀表压缩；E7 在最终 E6 生产源码上仅改变构建期编码器选择。每项数值均来自原 CLI 的实际成品，失败门禁保留。

| 实验 | 假设 | standalone B | 相对 3,816,337 B | 原门禁 |
| --- | --- | ---: | ---: | --- |
| E1 | pako 解压入口单项 | 3,790,045 | −26,292 | 失败 |
| E2 | 两个视频 loader 单项 | 3,791,035 | −25,302 | 失败 |
| E3 | 两个统计 loader 单项 | 3,723,302 | −93,035 | 失败 |
| E4 | 写作与右键菜单 loader 单项 | 3,793,796 | −22,541 | 失败 |
| E5 | 完整兼容组合 | 3,649,279 | −167,058 | 失败 |
| E6 | E5 + tldts 静态表压缩 | 3,589,855 | −226,482 | 通过、保留 |
| E7 | E6 + 逐资产构建期最小编码器 | 3,589,795 | −226,542 | 通过、未保留 |

E6 相对 E5 省 59,424 B；完整产物再以 gzip level9 编码却增加 425 B（1,424,767→1,425,192 B），且启动时新增同步表还原。这是安装尺寸门禁与传输/初始化成本的取舍，浏览器初次解码观察和暖态重放结果见下节；内存与未压缩浏览器对照尚未测量。首次 E6 原型因错误地把 TypeScript 的 JS 上下文 flags 与 Const 做严格相等比较而拒绝构建；修正为位判断后通过，该失败不计为独立优化。

E7 实测标准版与 standalone 各省 60 B，不假设运行时分派成本。九份 gzip 经 zlib/pako 解码同序、同 SHA；精确归一化后的非数据源码未逐字节相同，首次差异是标识符改名，因此不声称完整源码恒等证明。选择保留单编码器，减少四种构建编码路径的维护成本。[静态比较与失败边界](./encoder-static-comparison-20261011.json)

每个构建只有一次 elapsed/RSS 样本，不能据此排名延迟、吞吐或内存性能。上述有限实验没有证明全局最优或全面 Pareto 优势；下方历史五个 gzip 参数表是 literal 反事实计算，不属于 E1–E7 的实构建数。

## 当前成品的浏览器验收与时序

验收使用 Neo `browserclaw/v0.51.0`（CDP `Chrome/155.0.8309.26`），浏览器二进制 SHA 及每次原始回执摘要见 [浏览器证据](./browser-validation-20261011.json)。测试 checkout 为 `0904b33c90417f5098f26fcf1b1be2f04eee5970`，相对源码 `3618398b` 的变化仅在文档；原成品未改写。每次独立临时 HOME/XDG/profile、可见的私有 Xvfb 页面、内存 GM 和 localhost 白名单，结束后只清理所属进程、socket 与短期 loopback CDP。11 次成功会话均无外部模型/API 请求，无残留所属进程/监听器；日常 profile、浏览器及权限未修改。这不是 GNOME 原生 Wayland、Cua 或扩展无痕路径的测试。

两版各通过 MD5/SHA256 的 6 个固定 CommonJS 向量；标准 8 份、standalone 9 份实际 gzip 逐份在 byteOffset 0、3、17 的浏览器 Uint8Array 上验证，共 24/27 个输入，并比对 5 个损坏/截断错误合约。功能文档强制 `DecompressionStream` 与全局 pako 缺失，调用原成品捕获的函数；冷启动文档保留原生 DecompressionStream。两版均可打开、导航、关闭和重开设置，保留页面 hash。standalone 的图片、视频、写作、统计四个不可用页以及右键菜单提示均无误导表单；支持的划词语音区保留 8 个控件，但未触发模型下载、音频或推理。圈选与模型使用量别名未直接点击。

standalone 初始化后还从同一原 IIFE 的真实词法绑定取得七项 tldts 导出，核对四个 typed array 的构造器及长度 622/623/10216/10216、完整字符串与根索引 617/621；七项完整规范 JSON 为 116,078 B，SHA `b9bc8ae20f317a2317cdd1cd82737cda61fb71556298f36da16261bb8964a3b2`，与锁定原包一致。实际内联 getDomain 的 22 个普通、多级、私有、通配/例外、Unicode/punycode、IP、无效及业务选项向量全部匹配原包；仅纯字符串解析，无域名网络请求。该结果证明所测导出与向量，不是全输入空间的等价证明。

每种模式保留 3 次全新浏览器进程/profile/document 的未加 API 包装器采样，计时在 Debugger.enable 之前结束。下表从 IIFE append 开始，不包含浏览器进程启动；标准先从 localhost 加载 6 个固定依赖。settings/CSS 就绪要求真实设置 shadow style 与已解码 CSS，早期 bootstrap 布尔值不作为完成标记。

| 未加包装器的冷启动指标 | 标准中位数（范围）ms | standalone 中位数（范围）ms |
| --- | ---: | ---: |
| IIFE script load | 60.5（58.5–61.2） | 164.2（158.2–171.7） |
| 注册四个菜单 | 75.0（72.8–76.3） | 180.0（174.8–189.7） |
| 设置就绪 | 187.8（185.8–190.2） | 207.2（201.7–218.1） |
| 设置和 shadow CSS 就绪 | 192.2（190.0–195.0） | 210.6（205.8–222.3） |

标准的轻量设置与 standalone 完整 Options 不同，不能用两列作同功能延迟排名。只建立浏览器进程/profile/document 的新鲜性，未证明 OS/V8/磁盘缓存冷态，也未测整页翻译完成、RSS 或吞吐。最初两个计时夹具错误地等待禁用翻译时不会出现的 document 样式节点，记录失败并排除；按成功功能回执改为真实设置 shadow style，没有改变生产代码或功能门禁。

后缀表暖态重放使用实际捕获的 production inflate，但自行重放 JSON/typed constructors：3 个新进程各预热 3 次、保留 15 次，合计 45 个样本不是 45 个独立进程。合并中位数为 base64→bytes 1.4 ms、inflate 0.7 ms、JSON.parse 0.1 ms、重放字段 0 ms、总计 **2.2 ms（2.0–2.6）**。真实七项导出与 22 个解析向量在独立功能检查中验证，重放本身不证明实际模块构造器时间。

另用 3 个新进程观察原 IIFE 第一次自然表解码：包装 native atob、JSON.parse 与两个 typed-array 构造器，按实际解析数组身份定位四次构造，原脚本 SHA 不变。atob 至第四构造完成的中位数 **4.7 ms（4.4–4.7）**，其中 bytes 实体化加真实 inflate 为 4.5 ms（4.2–4.5），JSON.parse 0.2 ms；atob 与四次构造显示 0 ms，表示低于时钟精度，不是免费。观察器有未量化开销，三个标量赋值未计时；这些样本没有替代上表的未加包装器冷启动结果。没有 E5 未压缩浏览器控制组，不能把启动差异归因于表压缩，更不能据此宣称全面 Pareto 优势。

## 复现

使用报告源码提交的干净 checkout、Node 26.7.0、pnpm 9.12.1 和冻结 lock（Vite 5.4.19、WXT 0.20.18）。完整 checkout 应包含固定资源 Git 对象；浅克隆缺少图标对象时仅补取 `184a3d74f61b9d2a8d47080787f7e0180b98414d`，语言资源 pin `cf1941d43f406bb5118952066da5f9399400dd37` 不变。

```bash
pnpm install --frozen-lockfile
export FLUENTREAD_TEST_CPU_TARGET=60
export FLUENTREAD_TEST_MAX_WORKERS=1
export FLUENTREAD_TEST_CONCURRENCY=1
pnpm test tests/userscriptTldtsData.test.ts tests/userscriptCompression.test.ts tests/userscriptViteConfig.test.ts tests/settingsUiArchitecture.test.ts tests/browserCapabilities.test.ts tests/userscriptPlatform.test.ts tests/userscriptUnsupportedCapabilities.test.ts tests/siteRules.test.ts
pnpm compile
pnpm test:audit
pnpm test:userscript
pnpm test:userscript:standalone
pnpm build
pnpm build:firefox
pnpm verify:extension-manifests
pnpm docs:build
```

CPU 60%是资源保护器的协作目标，非 OS 硬配额。E1–E5 的独立补丁位于 [experiments](./experiments/README.md)，基线均为 `9c1ed3cc`；E7 补丁基于最终源码 `3618398b`。每次从对应干净基线只应用一个补丁，执行 `pnpm test:userscript:standalone`；E1–E5 的原 verifier 预期失败。源码/成品 SHA 应随实验记录，不调高预算。JSON 保留原 CLI 日志摘要，完整原始日志与成品不随本报告发布。历史公开副本中的设备路径以 `<checkout>/` 或 `<evidence>/` 脱敏，原件与副本 SHA 见 [脱敏索引](./historical-path-redaction-20261011.json)；CSS 控制组完整成品也未发布，历史 CSS 数值不能称为一键可复现。

## 未完成范围

扩展安装/无痕权限开关及 localhost 扩展验收、真实供应商/模型/搜索、模型下载与推理、原生 Wayland/Cua、RTX5090 WebGPU、Greasy Fork 构建/verifier及全仓库测试未执行；旧失败继续按原提交记载。浏览器公开 JSON 含逐次样本、原始回执 SHA 与方法；完整本地 harness、原始日志、成品及临时 profile 未发布，因此浏览器测量不是一条命令可复现的基准。PR 建议正文保存在 [PR-body.suggested.md](./PR-body.suggested.md)，外部正文未更新。

---

## 历史：646849ad 阶段的 main 整合与标准预算修复（2026-10-11）

定向测试与构建对应代码：`646849ad8207092842905da2610ac39311ea329c`，树 `7f5b5b3038f17e8b1890d047ee2dd29e40d209dc`。本轮只合入冻结的 main `dc335c698c05d8a5d11dbaadacb598c0695894f8`，没有追逐更新的 main。四处实际冲突已解决；输入框处理器保留 main 的请求标识校验、共享取消注册、配置就绪及 provider 返回后的取消检查，在首次等待前从可信 sender.tab 快照三态隐私，同一个 request 先附 glossary/privacy 再附不可枚举 control。原生批处理配置、恢复和真实 attempt 的 quota/transport lease 保留。

17 个文件的 **606 项不同定向用例通过**；该阶段修复净增 21 项；相对旧分支同五个测试文件净增 37 项，另 16 项继承 main。新增范围覆盖可信普通/私密/unknown、等待前隐私快照、跨 tab 同 ID 取消隔离、忽略 abort 的原始传输持槽/不缓存、三出口 CommonJS policy 与既有视频状态查询协议。类型检查、测试审计（642 文件、静态计数 10,664）、Chrome/Firefox 构建、manifest 核验及标准原 CLI/verifier 通过。审计计数不是全仓库执行结果。首轮缺少浅克隆中的固定图标 Git 对象，补取同一不可变提交后验证通过；资源 pin 未改。仅按冻结 lock 的 SHA512 补齐 fontkit 1.1.1，不运行安装脚本，不改共享依赖树或锁文件。

标准实际成品 **2,004,276 B**，SHA256 `4c65c5d613bebd31f01bc8b922b804ef8b061bc9d5b1440f7790fa22cd23c7a3`，原 **2,010,000 B** 预算余量 **5,724 B**。同一整合版本的真实对照如下，静态 gzip 参数保持原 pako level 9：

| 实构建 | 字节 | 相对前一步 |
| --- | ---: | ---: |
| A：原 CommonJS auto | 2,010,415 | — |
| B：标准出口 strictRequires=true | 2,010,759 | +344 |
| C：排除既不可达图片/圈选设置及两个 UI re-export | 2,004,276 | −6,483 |

strict 的 344 B 是确定性正确性成本。死 UI 修正净省 6,483 B，组合相对 A 净省 6,139 B，均为本轮实测，不套用 #912 历史的 6,487 B。仅三个父级 loader 做 userscript 构建分支，AreaTranslationSettings 组件、模板及扩展加载分支保留。CSS 叶规则 1,278→1,018；保留规则逐字节、按祖先 at-rule 与原顺序不变。删除范围含不可达 UI 及其在标准版唯一带入的共享布局组件；基础设置与划词样式保留。两种扩展 manifest 字节不变；选项块名称和作用域样式发生变化，不宣称全部扩展产物二进制一致。[CSS 静态审查](./css-review-20261011.json)

同一最终标准输入的五个不同 gzip 候选如下。pako9 是比较对照。以下完整输出数值由同一产物仅替换静态 gzip literal 精确计算，属于反事实，不是五次原构建：

| 轮 | 假设/候选 | 相对 C 字节 | 保留/淘汰理由 |
| --- | --- | ---: | --- |
| R1 | 恢复原 catalog/CSS zlib9 路径 | +8 | 当前大小轴没有收益；时间/内存未知 |
| R2 | 六受控资产 pako9 memLevel9 | +124 | 当前大小轴无收益，增加参数选择 |
| R3 | 六受控资产 pako9 FILTERED | +19,172 | 大小增加，运行成本未知 |
| R4 | 六受控资产 zlib9 windowBits13 | +40,224 | 大小增加，窗口成本未测 |
| R5 | 逐资产选择上述最小 base64 | −60 | 此阶段只有 literal 计算；构建期实现的实际对照见本报告 E7 |

全部候选经本机 zlib 与 pako 解码，decoded SHA 一致。最终八份 gzip 输入中只 CSS 改变，另七项未变；没有把旧 CSS 或旧 +56 B 诊断转移为新测量。五轮测量树为 `a24199c6…`；随后补视频状态协议 relay，在最终树重建出的标准产物完整字节/SHA 与 C 相同，故按精确产物和输入复用五轮，旧源码相等断言不套到新增 relay 的源码。[候选及逐资产数据](./gzip-candidates-20261011.json) · [可复现只读测量脚本](./measure-gzip-candidates-20261011.mjs)

这些结果支持保留简单 pako9 路径及本轮标准预算修正。编码时间、RSS、浏览器解码、运行延迟/吞吐和混合实现成本仍未知；scheduler 算式与 graph 许可未在本轮独立消融，不分别归功旧组合 1,645 B。没有判断任何方面达到极限，也没有证明全面 SOTA/Pareto；这五个静态参数方案不是实构建实验或最优性证明。

Standalone 首次真实构建暴露 video state-query 在 adapter 中缺 relay，已补既有协议并加入真实无 mock 回归。修复后完整构建 **3,816,337 B**，SHA256 `f851133b9d68edfa945557fcd25e8848cdd31cfa205190027a67c64b85dcb9e2`；原 verifier 因 **3,600,000 B** 预算失败，超 **216,337 B**。这是该提交的历史基线，不代表本报告开头的最终版本；不把全部超限归于本 PR。

本轮未执行当前产物真实浏览器 IIFE/CJS、真实供应商/模型/搜索、GPU/WebGPU、GF 构建/verifier或全仓库测试。不同 SHA 的旧浏览器证据不作为当前成品验收。全部本机重负载共享 resource-safe：CPU 目标 60%、worker 1、并发 1；未改凭据、用户 profile、能力/安全设置或 release 版本。[源码/阶段/产物绑定与限制](./integration-20261011.json)

以下历史记录对应各自提交与产物，不能作为最终版本的验证结果。

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

在提交 98e88a90489b39e9a6be8e2c71019daeaa297e23 中，Doubao registry wrapper 用 currentConfiguredModel（包括 modelOverride 与自定义模型）选择 Seed Responses adapter；服务级 isAiSdk('doubao') 却把该直接 adapter 当成 SDK，取消外层计数，而它没有内部 scheduleAttempt。因此 cap=1/3 出现 2/4 个未结束传输。

broker 的局部 SDK 路由谓词现在使用同一配置模型与 isDoubaoSeedTranslationModel。它同时决定 quotaScope、外层 countConcurrency 和 countRate。customBody.model 不参与协议选择；普通 Doubao SDK 仍由真实 attempt 计数。实际 registry→wrapper→adapter 的 14 项合成用例覆盖 cap=1/3、配置模型、override、自定义模型及 body-model 冲突；原始传输故意忽略 abort，取消后仍持槽，settle 后才派发下一条，实际峰值不超 cap，取消不写缓存。

直接连接测试的 30 秒 abort 会令 SDK uncounted attempt 的等待者先拒绝，但原始 runtimeFetch 可继续运行。旧 probe lease 只持有 adapter operation，因而在 raw 未结束时提前归还槽。现在连接测试在 schedule 的外层 lease 内构建 symbol scheduler context，传入窄可选 transportLease；adapter 创建 raw promise 后立即 holdUntil(raw)，再 await。broker 不传该字段，其 counted attempt 仍自行等待 raw settle。连接测试是 transportLease 的实际消费者。

global、service、model+service 三种 cap=1 桶，分别测试首次 raw 与首次429后第二次 raw：probe 调用者在30秒收到超时，健康B在60秒预算内继续等待，raw未settle前无B网络派发，settle后恢复，峰值1且不写缓存。最终有效红例是 **14失败、6普通SDK对照通过**，83个旧用例未在该 targeted 红例中执行；修复后 **111/111聚焦用例通过**：[原始红例](./seed-probe-red.json)、[原始绿例](./seed-probe-green.json)。最初错误夹具的非匹配SDK端点、错自定义模型字面量以及导入转换失败均不作有效红例。所有网络由严格合成URL白名单的 runtimeFetch 夹具接管，没有调用供应商。

历史9项 mixed probe 测试验证的是排队 broker 的完成/取消/deadline，与本轮 probe 自身超时后的 raw 持槽不同；不能把该91项契约冒充已覆盖本轮新边界。旧 counted/uncounted FIFO 互锁修复与真实注册 messageRuntime 隐私修复继续保留：[mixed probe 红例](./mixed-probe-red.json)、[隐私红例](./message-runtime-red.json)。

## 标准 userscript 的最小体积修正

功能修复后标准产物为1961638字节。随后仅合并已有 scheduler 的入队初始化与等价 wake 最小值计算、复用已安装 pako level9 编码静态 JSON/CSS、令图标许可跟随实际 SVG 模块图。完整出口仍保留 Lobe MIT 许可全文；轻量标准/GreasyFork 没有该 SVG 表。原图标、SVG JSON、许可文件与远程固定资源未改，未压缩可执行源码或增加依赖。

组合实测标准为 **1959993字节**，净减少1645，原1960000上限剩 **7字节**。此余量很窄，不保证其他工具链产物。7份嵌入gzip静态数据的解压内容多重集与未修改8467基线逐字节一致，实际嵌入base64合计仅减少48字节；静态候选中未进入标准图的理论编码收益不冒充最终包收益：[体积修正](./minimal-size-change.json)、[静态内容一致](./static-data-equality.json)。

SVG字符表压缩不属于该阶段生产实现。历史standalone收益17468字节不作为本次标准体积方案：[历史SVG实测](./svg-size-comparison.json)。历史泛用lease调用审计与组合187字节收益是98e88历史记录，本轮建立了新的probe实际消费者：[历史调用点审计](./provider-lease-call-audit.json)、[历史Occam实测](./occam-size.json)。

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

该历史提交的 standalone/GreasyFork 体积与固定资源门禁失败。该历史验证采用资源保护器串行运行，CPU目标60%、worker1、并发1；真实模型/搜索API调用0。真实供应商、GPU/WebGPU测试未运行。
