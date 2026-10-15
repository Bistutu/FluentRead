# 翻译质量评测与改进

质量评测是维护者按需运行的离线报告，不向日常阅读界面增加面板，也不自动采集用户网页。它使用已有匿名 provider 的实际源码，保存每条原文、译文、配置、耗时、失败分类和源码哈希。只有显式 `--live` 才向服务发送语料。

## 样本与判定边界

语料在 `tests/fixtures/translation-quality/corpus.json`，格式和标注规则见同目录的 `schema.json`、`README.md`。初始 35 条全部是 Codex 编写的合成测试情境，覆盖技术文档、新闻、口语、论文及混合语言。**全部尚待人工核对，没有人工金标准译文。** 98 条语义要求等待人工判定，40 条自动规则只检查局部可观察信号。

自动结果使用 `signal-clear`、`flagged` 和 `needs-human-review`。规则没有发现疑点不代表语义正确；原文回显、否定反转或指代误解仍可能需要人工发现。报告不计算单一综合质量分，也不把代理阅读意见登记为人工审核。

`sourceContext` 是供后续上下文实验使用的独立证据。当前匿名 adapter 不消费篇章上下文，runner 不会偷偷把它拼进正文。完整源段和修复后的句界是本次实际发送的上下文范围。已有 AI 篇章证据、术语库及个人修正链仍由其原有测试和产品入口负责。

## 可复现运行

先按仓库锁文件安装依赖。每次使用新的输出目录，限定服务及样本；不得读取日常浏览器配置或凭据。MyMemory 暂不在 runner 中开放，以保留其较小匿名额度；豆包等遇到鉴权、配额、限流时会记录暂缓时间并停止后续请求。

```sh
node scripts/testing/run-resource-safe.mjs -- node scripts/quality/run.mjs \
  --live --providers microsoft,google,transmart \
  --samples tech-001,news-001,colloquial-001,academic-001,mixed-001 \
  --configuration explicit --repeat 1 --timeout-ms 15000 \
  --out /private/tmp/fluentread-quality-baseline
```

省略 `--samples` 执行整份语料，服务列表始终必须明确提供。`--configuration auto` 只改源语言设置为自动识别，保持正文和目标相同。`--repeat` 允许 1–3 次；按样本轮换服务起始顺序，所有请求串行执行。`--source-root` 可指向另一个干净检出，用相同工具装配旧版本 provider，检查源码哈希以确定差异。

对照运行增加 `--baseline <旧目录>/report.json`。启动时固定基线内容与 SHA256；只配对原文和要求完全相同、服务/配置/重复编号相同的记录。执行模式、配置及超时不一致时不作直接质量比较。报告保留新增/消失的规则信号、输出变化和耗时差，网络失败没有语义分数。

每条记录完成后原子写入 `report.json`，并生成可直接打开的 `report.html`。按 Ctrl+C 取消会保存已有记录；再次使用完全相同命令加 `--resume` 继续。恢复要求语料、provider 源码、runner/评分/报告工具、基线及运行选项哈希一致，防止混合不同算法。取消过的尝试及成本保留；暂缓记录在服务恢复时间后可追加尝试。已完成的失败结果保留，定向复测请用新输出目录。

正式运行同时保存 `tools/` 中的工具快照、锁文件和已编译 adapter 的 SHA256。提交保存 JSON 证据，HTML 是可再生的查看文件：

```sh
node scripts/quality/render.mjs <report.json> <report.html>
```

需要重放历史工具时，将该次 `tools/` 快照放回同版本检出的 `scripts/quality/`，再用记录中的源码哈希和选项运行；线上返回和延迟仍可能随服务变化。初次探索报告早于工具快照支持，其 `toolHashes`（若有）与源码哈希保留，但不能宣称具备与正式运行相同的工具归档完整性。

## 报告审阅

报告把疑点样本放在前面，提供服务、领域、配置、状态及正文搜索。每条记录可以展开原文、来源、上下文和全部要求。`/` 聚焦搜索，Escape 清空查询，筛选在同一报告刷新后保留；窄屏和系统深色主题均有对应布局。

“下载审阅表”只导出当前筛选的记录，所有人工判定初始为空。实际审核人逐项填入结论、证据、署名和时间；语料的人工核对状态与某次服务输出的人工审核是两套记录。发现误报时保留原报告，修正规则后以新版本重跑；发现真实问题时先加入定向回归，再修生产逻辑。

## 成本、失败和兼容性

- 请求数包含 provider 自身的尝试；输入字符是关联到 HTTP 尝试的评测原文 Unicode 码点数，不是实际线路正文或计费 token（鉴权、分块和重试可能不同）。未发 HTTP 的记录计为 0。匿名请求的货币成本未知，显示 `null`，不伪报零成本。
- 字节数统计 URL 查询、可计量请求体及实际消费的响应体，不含请求头、TLS，响应可能已经解压；无法测量的请求体显式标记未知。
- 分开记录供应商业务状态与实际 HTTP 状态。超时、网络断流、限流、拒绝访问、配额、请求不支持、内容响应异常和取消各自独立，不将其统计为语义错误。
- Node adapter 结果不代表扩展浏览器传输、真实 DOM、Firefox、Safari 或移动真机行为。production 界面和共享调用链须另用隔离浏览器验证。
- 不根据一次网络环境、未人工核验样本或平均耗时重排全体默认权重。本次只对明确反向的有道响应使用既有回退，保持其他文本的服务可用性。

## 专项验证与集成点

```sh
pnpm test tests/translationQualityEvaluation.test.ts tests/translationQualityReport.test.ts \
  tests/translationQualityTransport.test.ts tests/freeTextChunks.test.ts \
  tests/freeChineseWebProviders.test.ts
pnpm compile
```

生产浏览器审查入口为 `scripts/quality/review-browser.cjs`。需要显式传入 production 扩展目录、报告 HTML、Playwright 包目录和 `fluentread-browser-translation-test` 的 focus-safe helper。它只创建临时 Edge profile，在第二屏正常后台窗口里验证报告筛选/导出/刷新、长段落分块后的翻译—恢复—再次翻译、失败重试和页面卸载，保存截图与 JSON。响应夹具只证明操作和请求边界，不能冒充在线质量。

共享集成文件仅有 `src/providers/translation/freeTextChunks.ts`、`free-chinese-web.ts` 和测试登记 `tests/test-matrix.json`。provider 函数签名保持兼容；wrapper 默认启用句/词边界，仍遵守码点/UTF-16 预算及 FRTERM 完整性；长单词无法装入预算时仍允许硬切。没有网页 DOM 改动，没有参考仓库运行时依赖。分段证据中的短预算压力样本可能多一次请求，须结合真实长段落耗时与输出审阅。
