# 网页翻译稳定性维护

本维护集复用 `tests/browser-translation-cases.json` 的正文覆盖、保护区、交互和恢复契约。清单在 `scripts/site-translation/maintenance-cases.json`，不是新的站点适配注册表。修改站点选择器前先检查真实 DOM，不能把漏译节点排除后宣布通过。

| 站点 | 维护入口 | 主要场景 |
| --- | --- | --- |
| GitHub | `github-project-pr` | PR 标题、正文、列表、原生搜索对话框 |
| Hacker News | `hacker-news-8863` | 讨论正文、评论折叠与展开 |
| MDN | `mdn-javascript-guide` | 技术长文、章节与代码保护 |
| Wikipedia | `wikipedia-united-states` | 长文章、滚动、链接与公式 |
| Python | `python-tutorial-introduction` | 教程正文与代码块 |
| Rust | `rust-book-getting-started` | mdBook、行内代码和列表 |
| Go | `go-tutorial-getting-started` | 操作步骤、代码与命令 |
| Dart | `dart-language` | 导语、正文、导航保护 |
| Use The Index, Luke | `index-luke-preface` | #969 新反馈、SQL 代码和长段落 |
| NASA Science | `nasa-webb-news` | 新闻长文、主标题与搜索框 |

Mastodon 公开信息流使用下文独立入口补充原生分页与 SPA 操作，不混入这十站的通过计数。当天产物摘要、每站覆盖及历史失败见 [验收记录](../reports/web-stability-20261015/verification.json)。

## 运行

先在任务 worktree 生成生产扩展。使用工作区依赖工具返回的 Node 包目录，不硬编码带版本号的运行时路径。

```bash
pnpm build
node scripts/testing/run-resource-safe.mjs -- node scripts/run-site-translation-matrix.cjs \
  --profile maintenance --mode full --allow-network --background \
  --controlled-provider --stability-probes \
  --extension-dir .output/chrome-mv3 --playwright-root <Node包目录> \
  --focus-safe-helper scripts/testing/focus-safe-browser.cjs \
  --artifacts-dir <证据目录>
```

定位单站用 `--cases index-luke-preface` 替换 `--profile maintenance`；两者不能同时指定。省略 `--controlled-provider` 后使用全新临时配置的真实免费服务。普通改动选择相关站点，只有维护集验收才运行这十站，不自动扩大到全部矩阵。

`--controlled-provider` 只替换临时扩展后台的微软翻译传输响应，网页仍从原站加载；它不读取日常配置和凭据。报告必须标明受控响应，不能据此声称在线服务质量、可用性或时延通过。源码和生产产物发生变化后必须重新构建。

## 每站验收

- 按独立覆盖规则检查所有发现的正文节点、主标题和列表，不以“存在一个译文”代替正文覆盖。
- 保护区和原链接语义在翻译前后保持一致。记录代码、公式、表单、搜索框等站点特定保护边界。
- 翻译、完整恢复、再次翻译均通过；无同父重复译文和嵌套译文；恢复时原始文字和 HTML 可核对。
- 稳定性探针从第二轮已译状态开始，检查静置、同文 Text 节点替换、宿主移除译文、追加正文、恢复重译，以及停止后追加正文保持原文。
- 探针主动修改的是本次临时页面 DOM，报告明确标为 `controlled-host-mutations-on-live-page`。它不能代替网站自身的评论展开、无限滚动或 SPA 导航。原生操作应另有操作步骤、前后 URL/DOM、覆盖和截图证据。
- 区分停止会话后不再挂载译文、测试观察器已释放、浏览器关闭/profile 删除，以及产品内部所有监听器释放。这些是不同证据，不能互相替代。
- 外部 HTTP 错误、验证码、登录墙、选择器漂移和供应商失败分别保留。失败或 quarantine 站点不能计为 required 成功。

## 浏览器与界面

Edge 使用临时 profile、第二屏正常窗口和后台启动；不连接日常浏览器，不抢焦点，不调用 `bringToFront()`。报告保存 launch mode、focus policy、window placement、DOM 与原始截图。窄视口/触摸模拟必须注明是桌面浏览器模拟，不能标为移动真机通过。

Firefox 需安装本次 production MV2 产物到独立 profile，并执行实际操作。构建与清单验证只证明产物，不证明运行时。Safari、Android 和 iOS 需要各自环境证据；缺少设备时保留明确的待验收项。

其余环境按以下顺序补验，结果不能继承桌面模拟；已经完成的管理器与浏览器组合以验收记录为准：

| 环境 | 安装与操作安排 | 必须保留的证据 |
| --- | --- | --- |
| Android Firefox 实机 | 使用移动端工程提供的兼容安装包；打开 SQL 教程、HN 和 Mastodon，触摸触发全文、滚动新增帖子、展开评论、恢复并再次翻译 | 设备/系统/浏览器/扩展版本、真实视口、触摸录屏、正文覆盖、保护区和恢复结果 |
| iOS/iPadOS Safari 实机 | 使用移动端工程的签名 Safari Web Extension，授予测试站点权限；在普通与横屏状态执行相同三站流程，并检查划词菜单与键盘 | 签名产物摘要、扩展启用状态、权限、横竖屏截图、译文/原文核对；模拟器单列 |
| macOS Safari | 使用独立测试 profile 与 Safari Web Extension 包，执行长文、公开信息流和网页卸载重开 | Safari 版本、安装来源、页面错误、恢复结果；不能以 Firefox MV2 代替 |
| userscript 管理器 | 在独立 profile 安装本次 userscript 及指定管理器；执行全文、停止、页面卸载及再次启用，重点检查失效订阅和 Shadow 样式清理 | 管理器名称/版本、脚本摘要、调用与清理结果；构建 verifier 单列 |

此任务不改签名、分发或移动入口。移动端工程验收其它提交时，应合入本分支后重建并对上述网页生命周期重验，不能把另一产物的设备结果直接记到本报告。

### 生产专项入口

以下命令同样需要资源保护包装器。所有浏览器脚本都限定新建临时 profile；路径参数使用本次 worktree 与证据目录。

```bash
# 划词入口：删除挂载节点、在途恢复、取消、失败重试、键盘、390px 深色
node scripts/testing/run-resource-safe.mjs -- node scripts/run-selection-trigger-test.cjs \
  --lifecycle-only --extension-dir .output/chrome-mv3 \
  --playwright-root <Node包目录> --artifacts-dir <划词证据目录>

# 原生 Mastodon 公开帖子：真实滚轮分页和同文档路由，不登录、不发帖
node scripts/testing/run-resource-safe.mjs -- node scripts/testing/run-web-native-feed-test.cjs \
  --allow-network --extension-dir .output/chrome-mv3 --playwright-root <Node包目录> \
  --artifacts-dir <动态站点证据目录>

# Firefox MV2：本机夹具与真实 SQL 教程，使用本地响应验证页面生命周期
node scripts/testing/run-resource-safe.mjs -- node scripts/testing/run-web-stability-firefox-test.cjs \
  --extension-dir .output/firefox-mv2 --artifacts-dir <Firefox证据目录> \
  --live --live-url https://use-the-index-luke.com/sql/preface \
  --live-selector '#article p' --live-protected '#article pre, #article code'
```

Firefox 使用当前安装版本的 Marionette 协议，并把所需系统访问环境变量仅传给本次新进程；不会修改全局 Firefox 配置。报告核对真实监听 PID、临时 profile、前台激活事件和关闭后的进程状态。窗口尺寸与实际内容视口分别记录，`focus:false` 切换自动化目标后仍须选中确切测试标签，不能把后台标签遗留的旧视口当成窄屏通过。

`run-web-mutation-lifecycle-test.cjs` 运行原创页面的不同规则/相同规则路由、ShadowRoot 卸载重插、保护区变化、恢复重译和样式生命周期。它通过真实快捷键、生产扩展和垃圾回收证据检查资源释放；此页面属于夹具，不计入真实站点数量。脚本的 `--help` 显示所需扩展、Playwright、focus-safe helper 与证据参数。

每份实站成功结果记录产物摘要和清理状态；维护矩阵汇总写入 `matrix-report.json`。静置探针当前使用 `contractVersion: 2`，包括动态副本的保护子树、全部后代译文数量、译文属性变化与原 owner 临时移除。旧版报告不能替代这些新增断言。

## 修复与集成边界

本项拥有网页候选、DOM 挂载、mutation/路由观察、划词入口生命周期与对应验证。文档阅读器、学习工作区、全局首次使用由其他工程维护。共享接口保持现有配置消息、全文快捷键和翻译请求协议；测试配置与测试登记文件是并行集成时的冲突热点。

#969 的 GitHub 旧版窗口变化重放已有产品修复，本项集成其既有两次测试提交并重新验证，不将旧修复标为新实现。该 issue 的 SQL 教程反馈独立核验。#956 描述不足，挂载节点被宿主删除的修复不代表已确认反馈者的根因。
