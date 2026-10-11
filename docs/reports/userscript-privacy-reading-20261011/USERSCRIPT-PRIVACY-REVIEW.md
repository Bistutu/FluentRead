# Userscript 隐私接口修复候选

状态：只读审计与未应用补丁。没有运行测试、构建、浏览器、脚本管理器或真实 API；没有修改仓库。源码基准提交：`09bc5913ca239eadade50ffbdb7e731bda66d79a`，逐文件基准/候选 SHA256 见补丁绑定 JSON。

## 已确认的路径和问题

`userscript/main.ts:60–65` 装配同页平台与 content；`src/app/content/runtime.ts:164–168` 在 userscript 上也挂载划词组件；content runtime 把实际 `SelectionTranslator` 交给 Vue UI。其 setup 第 424 行直接访问 `browser.extension.inIncognitoContext`，但 `userscript/browser.ts` 没有 `extension`。这是可达的缺接口路径，本次未通过运行复现。

第二处风险是 `platformFull.ts:121` 把词书请求的 sender 隐私硬编码为 false。Selection UI 对未知状态也不能以普通模式处理。现有 `translationPrivacyContext` 已有 `boolean | undefined` 合同：false 是明确普通，true 是明确私密，undefined 保留未知；输入框在首次 await 前快照，broker 使用该值隔离 pending/quota 身份。

## 最小候选

- browser shim 增加 `getUserscriptPrivacyContext()` 与 `browser.extension` / `chrome.extension` 同一 getter。仅解释词法 GM_info / GM.info 上自有、严格布尔的 isIncognito。缺失、非对象、仅继承字段、非布尔、别名冲突或 getter 抛错均为 undefined。未使用 unsafeWindow、页面 URL、存储或 message 自报字段。
- 消息分派在监听器循环前快照一次，把三态附到合成 sender.tab。输入平台 context 的 getter 延续原 URL-based cancel owner；现有输入 handler 仍在首次 await 前快照。slim/full fallback 将相同三态附到可信 glossary symbol。
- Selection 扩展分支保持 `=== true`；userscript 分支用 `!== false` 限制词书读写和历史 UI。这里的 boolean 是 UI 限制，不把 unknown 冒充真实 private quota。
- 完整平台在任何词书 handler/数据库调用前拒绝 private/unknown。明确 false 仍走既有 handler 验证、查询及写入。扩展后台词书合同没有改动。

生产补丁涉及五个文件；测试补丁追加三个既有 suite，拟新增 22 个展开案例：metadata 9，实际 Vue setup/词书行为 4，slim/full typed/fallback 首次等待与伪造隔离 6，完整词书 gate 2，明确普通模式读写 1。已有扩展普通/私密测试保留。patch 是供审核的候选，未声明已通过。

## 全部直接隐私消费者与范围

精确 file/line/source/SHA 清单在 JSON。userscript 真正相关的是 Selection 的查词书/保存、ReadingPanel private prop，以及同页 platform typed/fallback/完整词书入口。content reencounter 有 `capabilities.browser !== userscript` 的短路，并有 vocabulary content public alias；writing 也由 capabilities 排除。messageRuntime、writingRuntime、harnessRuntime 与 reading memory/session handlers 是扩展后台装配，userscript main 不装配这些后台 runtime。它们保留现有行为，不能把本次修复描述为扩展后台隐私重构。

## 元数据支持证据与未验证项

仓库 globals.d.ts 是自定义 GM 方法声明，当前没有 GM_info/GM.info 或隐私元数据类型。已查看的依赖没有官方 Tampermonkey/Greasemonkey 类型；任务内已知合成 harness 仅设置 script/scriptHandler，未设置 isIncognito。这种旧夹具必须归为 unknown，不能当作普通窗口证据。

本次未联网读取官方资料，未建立跨管理器字段或无新增 grant 的官方保证。候选新增的 optional boolean 本地声明只描述兼容输入形态。根线程仍需核对支持管理器实际版本的官方元数据字段、可用性与 grant 语义；不提供该字段的管理器安全降级为 unknown，翻译本身仍可用，词书/历史持久化 UI 被限制。不能通过补一个恒定 false 去恢复功能。

## 验收与限制

先由根线程运行三个受影响现有 suite，以及既有输入框、installed listener、retry-after quota/cancel 回归；再做 compile、四类输出构建/验证和 metadata/alias 审计。真实管理器验收须使用已授权隔离 profile，分别验证明确普通、私密与无字段路径；不能复用旧成品 SHA 或只含 scriptHandler 的合成夹具作为支持证明。

本次不改变权限、grants、网络端点、共享缓存、配置或计数持久化策略；不声称全产品“私密/未知不落盘”，也不声称同一特权沙箱内元数据不可被篡改。GF 预算与尺寸收益不是此正确性修复的取舍条件。

补丁与绑定收据：

- `USERSCRIPT-PRIVACY.production.patch`（SHA `62b76137c1e320f6c7303389c314ea3768c4ac91564e332f9a7b89d2b8fd6fca`）
- `USERSCRIPT-PRIVACY.tests.patch`（SHA `eb7bcb798af79d6bb22345a03bf74befa5273be59534abdcb7f163386d4df23b`）
- 各自 `.binding.json` 包含逐文件 before/candidate SHA256，应用前应核对基准。
