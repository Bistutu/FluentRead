建议标题：fix: preserve shared retry cooldowns and frozen main compatibility

供应商返回 429 或带有效 Retry-After 的 503 后，单个 SDK 请求退避仍会让其它请求继续派发；取消调用者也可能在忽略 abort 的底层传输结束前归还并发槽。此分支把 broker 与真实 SDK attempts 接入既有共享调度池，保留重试次数和 deadline、connection probe 的原始 transport lease、实际配置模型计数路径及取消不缓存。输入翻译在首次等待前固定可信 sender 的普通、私密或未知状态，跨标签页同 ID 的取消继续隔离。

本次将官方 main `25f5dca794848782f717493ce0e08545a0e57b35` 合入源码 `ad21620f80d02729836dc77b3704ce0cf0f73dc7`（tree `acf60c2a721632b5956e544822b45a97877c0d0e`），保留 target-language/literal preflight、授权 popup、PDF 字体按需加载与 hover 改进。三个生产冲突仅在中文文件头，独立回归组合并为 28 项输入测试；81 个 broker/provider/HTTP 依赖与原 #906 字节相同。冻结 #912 的生产功能已复用，仅补齐两个 gzip 回归，不重复移植或关闭 PR。语言 pin 前进到经 740 个官方 Git 对象逐字核验的冻结 main，以覆盖旧 pin 缺失的五份资源；没有发布远程资源或更换依赖。

合并后 standalone 原成品 3,604,328 B 超出原门禁 4,328 B。仅对真实 ServiceIcon 消费者无损压缩完整静态 SVG 数据，实减 17,240 B，保留 38 服务、63 path、所有属性/顺序与完整 Lobe MIT。最终标准 2,018,735 B／2,025,000 B（余 6,265），standalone 3,587,088 B／3,600,000 B（余 12,912）；标准预算继承冻结 main，未进一步放宽，GF 原 2 MB 保留。标准产物在 SVG 改动前后字节相同。

验证：12 文件769项不同定向用例通过（762−44+51），类型检查、测试审计、原 userscript CLI/verifier、Chrome/Firefox 构建及 manifest 核验通过。native 构建到最终源码仅 userscript 构建配置与其测试两文件不同，相关输入未变，已有成功回执按来源复用；未把静态审计或历史批次算成新执行数。

Neo 0.51.0（Chrome/155.0.8309.26）九个隔离临时 profile 的 localhost 验收通过，原 IIFE 前后 SHA 一致，CommonJS 各6向量、gzip offset 输入24/30、各5错误合约、设置交互通过。standalone 实际七项 tldts 导出与22解析向量匹配，真实 Vue ServiceIcon/createApp 的38服务63path DOM属性匹配并全部卸载。外部 API 为零；所属进程/监听器/socket清理完成，启动开关已关闭。

每版3次无 API 包装的新进程采样，IIFE append 至设置/CSS就绪中位数标准195.0 ms、standalone213.1 ms；UI不同不能作同功能排名。另3次第一次真实 SVG 解码观察中位0.9 ms，含未量化包装器开销，bytes与inflate合计，低于精度的0 ms不代表免费。首个观察样本未在 import 前固定完整 helper 文件 SHA，版本边界明确保留，实际观察函数正文跨版本一致。没有未压缩浏览器对照、RSS、吞吐或缓存冷态证明。

Greasy Fork 仍被固定资源 lock、生成数据不一致及实际超出2 MB三项阻塞；直接Vite诊断2,486,441 B超486,441 B，不能当作原发布成功。扩展无痕、真实供应商/模型/搜索、下载/推理、原生Wayland/Cua、实际RTX5090 WebGPU、全仓库测试和coverage仍未运行。日常profile与权限未修改。完整来源、命令、失败、限制及原始样本见 ../main-compatibility-20261011/README.md 和 JSON 回执。

此文件是建议正文；外部 PR 正文未更新。
