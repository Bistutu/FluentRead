# CW GF 依赖边界收敛：发布预算仍阻塞

CW 本地源码提交 `1bd0776fa79e39dbf9f46aa7936fbe8da16c4e4c`，tree `42a2fe5ec930fae740d143c59a9d693db35ba2d9`，父提交 `f35d642dda4213b5d042be1982f45e3c4687d7e7`。只在 `fix/shared-retry-after-cooldown-20261009` 整理普通 fork 推送；没有更新 #912、main 冻结点或词典分支。

最终 GF 成品 **2,247,865 B**，SHA256 `74b100f3e213d88f9fa307e54e63fbacb17473871d111dcddca330694706c416`。原始上限仍为 **2,000,000 B**，超限 **247,865 B**。正常包装器通过 vendor 三输入和资源一致性检查后，在原始 verifier 的 size 断言失败；后续 verifier 断言未执行。没有发布通过、浏览器通过、SOTA、Pareto 或全局最小体积结论。

## 实际收敛与保留边界

| 固定 pin 正常构建 | 主文件 B | 相邻阶段净减少 B | 结果 |
| --- | ---: | ---: | --- |
| 上轮保留方案，80c9da44 pin | 2,349,380 | — | 超限 349,380 |
| GF HTTP(S) 统计旁路 | 2,280,915 | 68,465 | 超限 280,915 |
| 再拆分漫画偏好 normalizer | 2,269,584 | 11,331 | 超限 269,584 |
| 再加窄启动 facade 与加载动画明文 CSS，1bd0776f pin | 2,247,865 | 21,719（两项合计） | 超限 247,865 |

这轮额外减少主文件 **101,515 B**。三份资产合计由上轮 3,932,337 B 降至 **3,845,681 B**，额外减少 **86,656 B**。相对已刷新语言资源的历史基线 2,479,675 / 3,935,984 B，主文件减少 231,810 B、三资产减少 90,303 B。这些是文件字节变化，没有网络、解压、启动或交互性能测量。准备资源时的 localhost URL 成品仅是诊断，不能代替固定官方路径 pin 的正常构建数字。

- GF 元数据只匹配 HTTP(S)，原共享 runtime 只在扩展协议路径持久化模型使用与请求统计；实际 GF 图没有统计清理或面板调用。两个精确 repository alias 使用只导入类型的旁路端口，generation 为零且不读取事件、不建库。共享 runtime 的协议检查未改；扩展、标准与 standalone 保留原仓库。新增统计调用或协议需要重新审查。
- 四个漫画规则函数按原函数体移入 `mangaRules.ts`；原 public 路径保留再导出，Config 使用窄依赖。URL/选择器校验、去重、二十项上限、提前翻译和缓存边界不变；漫画网站目录与阅读器识别仍由原模块承担，未禁用功能。
- 启动仍先迁移配置，再以同一个 `Promise.all` 延迟加载。两个 facade 各只再导出三个原绑定，保持同一份配置实例和页面翻译实现；没有删除 store 历史、保存、凭据或内容功能。
- 只有 GF 精确路径的一个私有静态 CSS 常量初始化值引用 `inlineStyles.loadingIndicatorStyles`；完整原字符串 14,144 UTF8 B，SHA256 `dd1be4af297aa90a101a530a909cec21867fa8648fa98ee6da9757a4efc4ccfb`。全部动画、DOM/ShadowRoot、reduced-motion 与 fallback 代码逐字保留。原六份 CSS resolve 白名单不变，缺损/非字符串资源同步报错。标准、standalone 不执行这个 transform。

[实际图变化](GF-FOUR-CANDIDATES-GRAPH-CHANGES.json)绑定与正常包装器完全相同的最终 artifact SHA，模块 381→375。移除的是 GF 未消费的统计实现、漫画目录初始化和 config transfer 等依赖；最大的完整 UI/翻译模块继续保留。模块 renderedLength 是 JavaScript 字符，不能与 UTF8 净减少混算。[最终资源与守卫收据](GF-FOUR-CANDIDATES-FINAL-ARTIFACT.json)保存全部绑定。

## 验证与失败保留

| 验证 | 结果 / 范围 |
| --- | --- |
| 最终十文件相关回归 | **540/540 PASS**，含真实 Vue 客户端模板与受控 DOM/消息端口；不是 Neo 浏览器实测 |
| 完整 architecture 分组 | **1703/1703 PASS**，33 文件 |
| 新 mangaRules 严格 V8 覆盖率 | statements/branches/functions/lines **100/100/100/100**；只测新模块，完整原仓库 strict 清单与门槛未削弱 |
| TypeScript/Vue compile | 最终源码 PASS |
| Chromium / Firefox 扩展 build | 两者 PASS；与最终源码仅 49F 测试文件不同，生产源码逐项相同 |
| test:audit | PASS，654 文件、10887 静态 case；不是全套执行结果 |
| 标准 userscript 原 verifier | **2,003,299 B / 2,025,000 B PASS**，SHA `ee39bb09847c1869204c79765f5f94be46696993e5059d059798e9feae123a15` |
| standalone 原 verifier | **3,574,040 B / 3,600,000 B PASS**，SHA `bd31d89d88bb69caed8563b0ccf1097619e8d76e395b9dc8d5989e3f57084307` |
| GF 正常包装器 | **FAIL：超限 247,865 B**；之后的 verifier assertions 未运行 |

所有重阶段 CW 串行、CPU target60 / worker1 / concurrency1，使用既有 pnpm9/Node/dependencies，未安装 Storybook 或新依赖。[阶段账本](stages.json)记录 UTC、完整源码快照 digest、patch digest、原日志 SHA、命令和退出码；[源码绑定](source-binding.json)、[构建源码对应](FOUR-CANDIDATES-SOURCE-VERIFICATION-BINDING.json)说明所有版本边界。Vitest 终端时间是本机时区显示，UTC 以账本为准。

两次真实失败保留在 receipts：初次 compile 发现新增 VM 测试返回类型缺失，补齐显式 string 后复验通过；扩展回归最初 101/102，49F 仍假设旧 pin17，而刷新 pin 已有19。测试现在分别验证真实19表的完整 roundtrip/引用/不变性，以及明确合成的旧17表 delta（新增两条、GitHub 更新、旧对象不变），最终540例通过。没有只抬旧断言或删掉 delta 覆盖。

## 剩余阻塞与未运行

GF 发布预算仍未闭合，按授权流程，**隔离 Neo extension 无痕启用和 localhost 合成验收未运行**；此阶段没有新浏览器进程。旧 Neo userscript 九次会话绑定旧 SHA，不能代替本轮成品、更不能代替 extension incognito。后续真实验收还需有效协调 lease 和相同源码/成品绑定；不复用过期租约。

[重复逻辑审查](GF-LOGIC-CONSOLIDATION-REVIEW.md)没有找到足量安全等价候选覆盖缺口。凭据比较/配置 patch 比较、配置 clone 与 broker 单/批路径有自有属性、敏感键、NaN、版本、取消或微任务语义差别；本轮不直接合并。Config field define 的旧成品跨度8698 B也不等于可移除量。UI control 重复的早期静态跨度不足以证明净减少或 DOM/焦点/样式等价，本轮未应用该原型。这是有限审计结论，不代表没有其它方案。

静态审计还记录了已有 userscript 可达风险：SelectionTranslator 直接读 `browser.extension.inIncognitoContext`，当前 userscript shim 无该字段；ReadingPanel 使用 `runtime.connect`，shim 未提供。没有通过删除这些 UI 缩量，也没有把静态观察说成真实浏览器失败或修复通过；后续验收前需按正确隐私语义复核/修复。

新资源固定于同一个 `1bd0776f…` commit：data995570 B / SHA `c6cc74bb1c3e3f0be2a6919c45ed2fb40dfda17a7a8a9c46683b72f956a7a40e`；vendor602246 B / SHA `8fa608295f4e3479c9c70a1181ee008944c85b19d1c3bd542f7062e91898fc38`。committed/tracked/built 三方逐字相同。包锁、package、正常包装器和三个原 verifier 与35362160逐字相同；vendor 三输入与资源 commit 逐字相同，vendorEntry 保留80c9da44的版本；目标es2018、原预算和许可证不变。正常元数据仍指向官方 `FluentRead/FluentRead@1bd0776f…` 路径，fork 推送不能证明该官方 CDN 已可取得；URL没有抓取，官方资源可用性仍未核验，不绕过上游403。

本轮未重跑 docs/Storybook；上一轮缺少 Storybook 安装的 docs:check / storybook:build 问题独立保留，未安装依赖来消除它。报告受 VitePress `reports/**` 排除，不更改网站页面。没有调用真实搜索/模型API、修改凭据、安全权限、profile、默认浏览器或新 MCP；没有改变Pi/Cua/Neo安装。#912 head 仍为 `ee2c29bd5be95c2670ff2fa9ecc13985bbe85651`。

最小下一步仍是基于当前375模块图继续证明较大行为等价收敛；在原 GF 门槛通过前，浏览器验收与发布保持阻塞。完整大成品和完整快照留 CW evidence 目录；这里仅保存脱敏日志、SHA与审计收据。原始文件 SHA 与发布脱敏文件 SHA 分开记录。
