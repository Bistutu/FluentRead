# DeepLX 默认直连验证

issue [#968](https://github.com/FluentRead/FluentRead/issues/968) 反馈默认公共 Worker 的共享额度容易耗尽。本次固定使用 MIT 授权的 `@deeplx/core@0.3.1`，默认配置先直连 DeepL，失败后才请求 `deeplx.1stg.me`。旧配置保存的默认公共 URL 同样升级到直连优先；自定义地址、多端点、代理与 Token 配置保持指定线路。

core 的 `x-fetch` 导入由精确限定导入方的 Vite 插件接入 `runtimeFetch`，扩展在后台执行，userscript 沿用 GM transport。显式 `skipWarm: true` 和 `credentials: omit`，GM 对应 `anonymous: true`；不读取 DeepL 登录会话。分块按 1500 UTF-16 单元保护代理对与术语标记，短多行文本整条请求；全部块成功才返回译文。直连失败时备用服务接收完整原文，沿用 8 秒单线路和 20 秒总预算。用户取消会终止读取、切块与回退。

## 针对性验证

- DeepLX、共享分块、core 构建边界、GM transport、中文语言映射、原生批量和架构检查：11 文件、1,380 用例通过（包含最终固定语言资源的 198 项专项）。
- DeepLX 配置、共享分块与新增 runtime adapter：statements / branches / functions / lines 均为 100%，仅统计这三个模块。
- 类型检查、Chrome MV3 / Firefox MV2 生产构建、清单验证与文档构建通过。userscript 体积增量使用同依赖独立主线构建对照，保留资源协议和执行检查。
- 界面本地化测试的旧 `Chrome内置AI翻译（当前浏览器不可用）` 校正源条目断言失败，在本次基点 `525108e86` 同样复现；未修改该无关条目。

## 生产浏览器

在 2026-10-14 至 15 日使用临时 Edge 生产扩展执行 `run-deeplx-direct-test.cjs --background --live`，8 项通过。默认直连成功时公共端点请求为零；429 才回退；长文本的实际分块长度为 1499 / 1500 / 102；取消信号真正到达 fetch 且未回退。真实 Control 悬浮操作得到 `[1,0,1]`，邻段始终 `[0,0,0]`，截图目检无重复译文。

唯一真实服务样本是 `The moon reflects sunlight.`，DeepL 直连返回“月亮反射阳光。”。其余响应使用仅存在于本次测试 worker 的确定性夹具；这不构成长期可用性或完整语义质量保证，也未覆盖 Firefox 实机或实际脚本管理器。

启动记录：`launchMode=macos-background-cdp`，`focusPolicy=launchservices-no-foreground`，`windowPlacement.mode=background-visible-no-focus`，第二屏正常窗口，`browserFrontmost=false`；焦点事件、页面异常与清理错误均为空。临时 profile 已删除。

本机证据目录：`research/deeplx-direct-968-20261014/`，包含 `report.json`、悬浮截图以及 `userscript-size/` 中的同依赖基线和候选体积对照。该目录位于工作区外层，不随仓库提交；`integrated-main/` 保存整合主分支 `e806feff0` 后的同范围复验。可用同一脚本重跑。
