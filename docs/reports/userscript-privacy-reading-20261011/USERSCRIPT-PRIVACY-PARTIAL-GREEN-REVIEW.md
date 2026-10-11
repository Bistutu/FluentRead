# 隐私接口定向回归失败复核

状态：仅依据现有源码、日志与本地 Vue 实现静态复核；候选 delta 未应用，未运行测试/构建/浏览器。

现有日志是 180 项中 167 pass / 13 fail。SelectionTranslator 生命周期的 124 项全部通过；四个新增 Selection 隐私 gate 没有失败。十三项实际分为：新 metadata dispatch 8 项，ReadingPanel 旧持久化路径 4 项，缺失 connect 能力 1 项。

1. 新 metadata 夹具监听器返回同步普通对象。现有 shim 只接收同步 sendResponse、Promise 返回值、return true 后异步响应；同步普通对象被忽略。因此 getter 通过但 response 是 undefined，并不表明 tri-state 生产错误。最小测试 delta 将监听器标为 async，让 Promise 走真实既有分派逻辑，仍保留全部隐私值与 payload 伪造断言。
2. ReadingPanel 新 persistenceSupported 是 optional Boolean prop，Vue 缺省会把它归为 false，当前 `!== false` 反而关闭了扩展默认记录/笔记能力。本地 runtime-core 的 `isAbsent && !hasDefault` 分支确实将 Boolean 值设为 false（位置、源码 SHA 与摘录见 JSON）。这是真实默认行为风险，不能仅在 fixture 设置 true 掩盖。生产 delta 用 `withDefaults(..., {persistenceSupported: true})`，明确恢复扩展默认；userscript 显式传 false 仍保持禁止。现有首个扩展测试补 canPersistReading=true 断言，保留原历史、恢复、笔记与临时阅读 false 用例。
3. connect 的一项是真实未实现能力，仍待独立修复。本 delta 不改变它或弱化失败断言。

交付 `USERSCRIPT-PRIVACY-PARTIAL-GREEN.production-delta.patch` 与 `.fixture-delta.patch`，逐文件精确 before/candidate SHA 在 JSON。根线程应先核对基准再应用、重跑原四个 suite。未声明候选 green。
