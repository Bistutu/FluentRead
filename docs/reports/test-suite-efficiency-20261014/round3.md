# 测试执行效率第三轮优化

第三轮以 `7678ca357` 为固定基线，最终方案保留纯编译缓存、分类缓存与确定性事件等待，使用原内置 V8 覆盖率配置。生产源码、依赖、覆盖源文件清单及四项 100% 门槛保持不变。

- inline SFC helper 按绝对路径、完整源码与全部编译选项复用不可变代码、导入列表和诊断，缓存最多 32 项；源码变化立即失效。七份套件的 223 个展开用例、886 条原断言保留，18 组真实编译产物与原实现逐字一致。
- 两份本地模型套件将已执行组件图限制在每次挂载内，重新执行模块并创建独立状态、端口和 DOM。这是隔离强化，不将其归因为速度提升。
- 架构分类缓存仅保存完整源码、固定选项与冻结的两个布尔结果。相同审计输入的转译次数从 1,451 降到 811，AST 解析从 2,891 降到 1,623；分类及 uncovered/invalid 集合一致，原 16 个用例、22 条断言不变。
- owned browser 的 93 个所有权用例只将 detach 启动轮询替换为逐夹具事件；保留原 mock、断言、真实身份核验、TERM/KILL 等待期限及资源清理边界。

最终完整验收通过 697 份测试文件、22,698 个用例（原 22,695 个加 helper 三项契约），零失败、零跳过。统一入口内的五份原生 Node 文件继续运行原 57 个用例，检查完整 TAP、零失败、零跳过及实际进程退出；原用例按名称、文件及 Counter 重复次数完整核对。663 份覆盖源码逐份要求 statements/lines/functions/branches 的 covered 等于 total、skipped 为零，四项均为 100%；statements/lines 为 85,996/85,996，functions 为 6,188/6,188，branches 总数为 49,495。最终检查记录：类型检查、测试审计和文档构建通过。具体计数、输入哈希及原始计时见 [第三轮验证数据](./round3-validation.json)。

| 最终方案对照 | 基线 | 优化版 | 观测结果 |
| --- | ---: | ---: | ---: |
| 一次完整覆盖率命令 | 1052.20 s | 1065.22 s | 慢1.2% |
| 九份文件、332 个用例，三轮命令中位数 | 70.16 s | 63.61 s | 快9.3% |

专项顺序为 AB / BA / AB（A 为固定基线，B 为最终方案），每次使用新 Vitest 进程、单 worker 与串行文件执行。本轮全量耗时增加约 13 秒，未证实进一步提升全量回归速度。重点组的三对计时显示局部提速；全量单对计时只代表本机观测；第二轮记录的 7.7% 同样是单对观测，不能当作后续回归的保证。

未保留自定义覆盖采集实验：其早期全量耗时为 1,145.350 s，基线为 1,052.199 s；随后在同一根目录、固定 286 个用例的两对受控测试中，内置 V8 中位数为 149.065 s，自定义为 155.318 s，变慢约 4.2%。负面计时纳入验证数据，实验源码及原始日志保留在本地临时证据目录，最终内置 V8 原配置逐字恢复，最终计时不混入这些已撤回版本。

复验时从固定基线与最终提交分别创建检出，使用相同依赖和有效 `.wxt` 配置，顺序执行。真实 PDF 输入沿用 [第二轮记录](./round2.md) 中的两份原始论文及相同 SHA-256；省略输入会跳过外部语料用例，不能用于完整验收。

```sh
FLUENTREAD_TEST_MAX_WORKERS=1 FLUENTREAD_TEST_CONCURRENCY=1 \
FLUENTREAD_ATTENTION_PDF=/path/to/papers/1706.03762v7.pdf \
FLUENTREAD_PDF_CORPUS=/path/to/papers \
pnpm test:coverage --reporter=default --reporter=json --outputFile=/path/to/full-tests.json

FLUENTREAD_TEST_MAX_WORKERS=1 FLUENTREAD_TEST_CONCURRENCY=1 \
pnpm run test tests/serviceConfigurationLifecycle.test.ts tests/learningCenterLifecycle.test.ts \
tests/vocabularyTtsPageCancellationRuntime.test.ts tests/fullPageTranslationProgress.test.ts \
tests/implementationAudit49F.test.ts tests/localModelSettingsLifecycle.test.ts \
tests/localTranslationModelSettingsLifecycle.test.ts tests/ownedBrowserClose.test.ts \
tests/architecture/verificationOwnership.test.ts \
--reporter=default --reporter=json --outputFile=/path/to/focused-tests.json
```

共享机器的负载与调度不能完全控制；计时不证明某个改动单独贡献了全部差异。本轮证据范围是确定性测试与覆盖率，没有新增真实浏览器、线上翻译服务或产品发布构建验收。
