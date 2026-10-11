建议标题：fix: share provider retry cooldowns and preserve userscript budgets

供应商返回 429 或带有效 Retry-After 的 503 后，单个 SDK 请求退避仍允许其它请求继续派发；取消调用者也可能在忽略 abort 的底层传输结束前归还并发槽。此改动将服务反馈接入既有共享调度池，保留 SDK 重试次数和 deadline，使 broker 与真实 SDK attempts 共同等待。Doubao Seed 的直接 adapter 使用实际配置模型选择计数路径，连接 probe 的 transportLease 延续到原始传输 settle；取消结果不缓存。

输入框处理器在首次等待前快照可信 sender.tab 的普通、私密或未知状态，再附同一请求的隐私/glossary及不可枚举 control。保留 main 的请求 ID 校验和取消注册；跨标签页相同 ID 的取消隔离。

standalone 完整 Options 的能力过滤原本只阻止显示，仍打包不可达设置。六个 userscript loader 增加构建分支，pako 使用同版本解压入口，tldts 的七项静态导出经严格字面量白名单无损还原。扩展保留原 loader 分支，标准/GF 不启用后缀表插件；依赖锁、资源 pin、许可、权限、版本和原预算保持。

最终源码 `3618398ba86436938747a32f4072857a9dae4db2`（tree `d13bc56a107cbd0c96f764b7d0f020528778ed5b`）的标准成品 2,004,276 B、standalone 3,589,855 B，分别低于原预算 5,724/10,145 B。原 CLI 输入逐文件绑定到该提交；完整 SHA、对照补丁、复现命令及失败项见本目录 README 和 standalone-validation-20261011.json。

验证：本次 8 文件151项不同定向用例最终通过，含24项真实后缀表逐字恢复/错误输入拒绝；类型检查、测试审计、两种 userscript 原构建/verifier、Chrome/Firefox构建及manifest核验通过。历史606项结果单独按17文件、日志及Git blob核对，不与本次执行数机械相加。E1–E5 是同基线独立实构建，E6填补剩余门禁缺口；E7实际仅省60 B，选择保留单编码器。后缀表压缩使整体gzip传输大小增加425 B，初始化与表解码的有限样本已测；RSS、未压缩浏览器控制组与缓存冷态未测。

Neo 0.51.0（Chrome/155.0.8309.26）的临时 profile localhost 验收通过：两种原 IIFE 执行前后 SHA 一致，CommonJS 固定向量各6项、gzip offset 输入24/27项、错误合约各5项及设置交互通过。standalone 实际七项后缀表导出完整字节与22个域名解析向量一致，不可用设置提示及保留语音控件通过。每版3次未加包装器的新进程采样，IIFE append 至设置/CSS就绪中位数为标准192.2 ms、standalone210.6 ms；UI不同，不能作同功能排名。表暖态重放45个样本中位数2.2 ms；另3次首次自然解码观察为4.7 ms，含未量化native包装器开销，0 ms构造结果受计时精度限制。原始样本、绑定与夹具失败记录见 browser-validation-20261011.json。

扩展无痕 localhost 验收、真实供应商/模型/搜索、模型下载/推理、原生Wayland/Cua、RTX5090 WebGPU、GF构建或全仓库测试仍未运行；日常profile/权限未修改。完整本地浏览器harness未发布；新profile不证明OS/V8/磁盘缓存冷态，没有E5浏览器控制组、RSS或完整性能比较，不宣称全局最优或全面Pareto优势。

此文件是建议正文；外部 PR 正文未更新。
