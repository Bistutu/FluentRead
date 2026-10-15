# 移动端与 Safari 验收记录（2026-10-15）

本项从 `fa431a845`（PR #993 已合并）独立实现，分支 `codex/mobile-safari-product-20261015`。Issue #969 的正文嵌入稳定性由独立任务负责；本项不改全文候选、调度或站点适配算法。Issue #992 的原反馈为 iOS YouTube 系统全屏无字幕、竖屏字幕居中，未给出浏览器与安装渠道，因此不把桌面夹具结果当作报告者环境已修复。

## 实现与边界

| 路径 | 变更 | 需要证明的行为 |
| --- | --- | --- |
| 网页翻译 | 触屏悬浮球完整 44px 命中区；VisualViewport、安全区与恢复定位；拖动时保留布局并按主体偏移跟手；pointer 与兼容 click 去重、辅助技术 click-only 入口 | 翻译、恢复、重译、加载取消、迟到结果、拖动和刷新 |
| 页内快捷面板 | 按实际可见边界夹边并重新协商 iframe 尺寸；关闭释放视口观察 | 软键盘偏移、横屏、深色、关闭与重建 |
| 网页进度 | 可见视口与安全区内定位、限制尺寸、内部滚动；触屏操作 44px | 加载、错误、重试、隐藏、后台恢复和卸载；保持现有会话限定回调 |
| 划词 | 触摸稳定等待、系统句柄调整、长按菜单和 pointercancel；44px 入口与操作；正文原生滚动；安全区与可见视口缓存 | 图标按下不丢选区、关闭不重新出现、软键盘、切换、来源失效、刷新与卸载 |
| 划词恢复 | 分别保存 Selection 文本与 Range 指纹 | 跨段文本序列化不同不误关闭；原文实际改变才清理 |
| 视频内联字幕 | YouTube/X 复用实际视频画幅几何，小播放器按可见控件留底距；移动双语合并显示；四边安全区 | 竖屏底部、横屏、控件显隐、模式切换、后台恢复 |
| 系统原生全屏 | 复用原时间轴与已缓存译文生成原生 TextTrack；空轨、平台错误、退出、禁用和换视频恢复原轨状态；明确系统样式与挂起限制 | 浏览器真实 TextTrack 接口与模拟 webkit 事件；iOS AVKit 仍必须实机验收 |
| Safari 交付 | WXT 0.20.18 Safari MV2、Safari 26 门槛；显式 UTF-8 非持久后台页；最终产物与完整资源校验；Apple 单/双平台包装与中英安装指引 | 生成和编译可复现；语言配置可保存；不签名发布、不把包装当运行验收 |

没有新增独立翻译实现。触摸和字幕均继续通过已有配置、服务与生命周期接入。未复制或借鉴外部参考项目代码。

## 官方依据与现有能力核实

- [Mozilla 的 FluentRead 商店页](https://addons.mozilla.org/en-US/firefox/addon/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB/) 在本次核查时明确标示可用于 Firefox Android。这不等于本次开发包已完成 Android 设备验证。
- [Microsoft 移动策略](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-mobile-policies)说明 Android 扩展可受管理策略限制；具体目录和安装按钮仍需当前浏览器确认。
- Safari Userscripts 的核心网页/划词入口和 Via 既有说明继续保留；userscript 不提供扩展的视频字幕运行时，新原生全屏提示不进入其固定语言资源。
- [Apple Safari 扩展说明](https://developer.apple.com/safari/extensions/)及[包装工具文档](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)用于未签名包装流程。
- [MDN 官方兼容数据](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/declarativeNetRequest.json)记录现有请求隔离所需的 `initiatorDomains`/`requestMethods` 从 Safari 26 开始支持。本项保留限制条件，不对旧 Safari 放宽来源范围。
- [WebKit 的内联视频说明](https://webkit.org/blog/6784/new-video-policies-for-ios/)区分网页内播放与系统全屏；网页 DOM 字幕不能直接覆盖系统播放器。原生轨桥接不保证平台样式或后台持续翻译。

## 验证状态

本地验证限定改动与直接影响范围。首轮 GitHub CI 因 `package.json` 新增 Safari 命令，被既有 planner 归为共享测试配置变更，自动执行全部 730 个测试文件；这不是本地专项范围。CI 的改动模块覆盖率均为 100%，但三个原本未改的测试文件失败：Linux 不存在 `/private/tmp`、Vue renderer 引用未声明入口，以及单个 PDF 导入用例超过默认 5 秒。已在 `cd55bc55c` 作最小测试修复，95 项定向检查通过；[Ubuntu 复验](https://github.com/FluentRead/FluentRead/actions/runs/38700538192)完整通过：730 文件、24,092 项通过及 4 项既有跳过，改动模块四维覆盖率 100%，类型和构建步骤也通过。该轮尚不包含后续 UTF-8 与原生指引修改。PDF 的本地超时未复现，仅增加该用例的 15 秒有界预算，保留全部进度与取消断言。

| 验证 | 结果与范围 |
| --- | --- |
| 类型检查 | `pnpm compile` 通过 |
| 最终集成专项 | 10 文件、1,436 项通过，含 1,028 条文件头规则；其余覆盖模块边界、验证归属、真实 Vue 行为、浮层尺寸协商、字幕运行时与划词生命周期 |
| 平台/文案合约 | Safari manifest/包装/容器专项 42 项通过，浏览器能力 13 项通过；userscript 构建配置与固定语言资源投影专项通过 |
| 严格覆盖率 | VisualViewport、新原生轨桥接及既有 popup/core/字幕缓存/人工字幕 6 个受影响模块四维均 100%（分别限定模块执行） |
| Vue 行为归属 | 悬浮球与全文进度组件迁出冻结债务，真实 SFC setup/模板消费者分别 10 和 5 项通过 |
| 网页触摸与浮层 | `floating-progress/report.json`：14 项通过，含加载、取消迟到结果、44px 目标、拖动、刷新、深色 popup、可见视口夹具及卸载 |
| 划词 | `selection-final/report.json`：8 项通过，含真实生产 UI、可信 CDP 触摸/DOM Range、320px 深色、键盘偏移夹具、后台和刷新清理 |
| 网页结果状态 | `progress-status/report.json`：12 项通过，含失败重试、取消、恢复、隐藏、390px 深色失败面板；三个操作目标宽高均不小于 44px |
| 视频 | 生产原生轨资源事件、内联/横屏、菜单与恢复 10 项通过；所有 13 个可见按钮不小于 44×44，时间标签独立成行，最终证据为 `video-complete/report.json` |
| 构建 | Chrome、Firefox、Safari MV2、userscript 均通过，userscript verifier 通过；具体资源身份见 `verification.json` |
| 文档与审计 | `pnpm docs:build`、`pnpm test:audit` 和 `git diff --check` 通过；审计发现 730 个已归类文件不代表已执行全量 |

上述 Edge 浏览器专项使用 production 扩展、自有临时 profile、第二屏正常后台窗口、焦点监测与 owned-close 清理；翻译响应及页面受控。正式 UTF-8 修复后的 Chrome、Firefox、userscript 完整资源摘要与这些既有产物一致。CDP 触摸输入、DOM Range、VisualViewport/生命周期夹具不替代原生长按、系统键盘或移动真机。真实 Simulator Safari 的单独证据见下文。

本地原始证据根目录：`research/mobile-safari-20261015/`（工作区层级）。失败轮次保留在各自目录，最终通过轮次另存，不覆盖失败证据。与本报告并列的 [verification.json](./verification.json) 记录源码摘要、构建身份和证据索引；`validation/` 保存类型检查、专项、覆盖率与构建日志。

已执行的代码与逻辑复核修复包括：触摸兼容 click 重复执行、拖动布局坐标、跨段 Range 恢复误判、原生轨错误后的 claimed 状态、空字幕轨、轨道资源任务异步清空、人工字幕时间轴批量查询成本，以及后台字幕时钟重启。截图复核还修复了触摸按钮被高优先级样式压缩，以及时间标签被截断的问题。

## Apple 工具检查与未完成项

本机 Xcode 26.2、macOS/Safari 26.6.2。首次检查只有 macOS/iPhoneOS/iPhoneSimulator 26.2 SDK，没有可用 iOS runtime 或连接的 Apple 设备；三个完整 iOS 构建尝试因此失败，原始日志继续保留。

用户要求继续后，使用 Apple 官方命令获取 iOS 26.2（23C52）arm64 runtime，导出包为 8,380,941,319 字节。本机 `-downloadPlatform ... -exportPath` 同时完成了 runtime 安装和注册，不能称为仅下载；确认可用后没有重复执行 import。

- macOS 通用 arm64/x86_64 完整编译通过。
- runtime 就绪后，iOS Simulator generic scheme 的完整 App/Extension 编译通过，包含此前失败的 assets/storyboard 阶段。
- iPhoneOS arm64 的完整 App/Extension 编译同样通过。它没有开发者签名，不能直接作为真机安装包。
- 最初三平台编译后的 460 个 Web 资源均逐文件匹配修复前的生产构建。正式 UTF-8 修复增加后台 HTML，变为 461 个文件；每轮包装和编译均重新对照对应源产物，最终身份见 `verification.json`。原生可执行文件与 Info.plist 单独记录，不混入 Web 资源摘要。
- 所有构建关闭开发者签名及自动 provisioning；macOS/Simulator 的链接器 ad-hoc 标记不是开发者证书。未配置账号、开发团队、TestFlight 或 App Store 发布。
- 创建了名称唯一的任务 iPhone 16 Pro 模拟器，通过 `simctl` 和 XCTest 完成 App 安装、Safari 扩展启用及单站点授权。仅对 `127.0.0.1` 允许一天，私密浏览权限保持关闭；宿主 Simulator.app 未启动，焦点监控没有测试应用激活事件。三条翻译路径的结果须分别查看后续正式产物记录。

补充的独立 macOS WebKit 研究保留了两种结果：原始 manifest 在该宿主生成的后台页使用 GB18030，导致 UTF-8 脚本执行失败；原脚本经系统 JavaScriptCore 纯解析通过。只将后台入口换成显式 UTF-8 页的研究变体，保持 124 个生产 JS 文件字节不变，通过真实 TextTrack、cue 恢复、划词挂载与卸载检查。它不是原始 Safari App 验收；隐藏宿主没有执行前台横竖屏重排，不能把几何读数当作对应 UI 通过。诊断见工作区证据 `webkit-isolated/investigation.md`。

随后在真实 iOS 26.2 Simulator Safari 进行了同一 App 的冷启动 A/B：A 保留自动 scripts 后台页，重启后点击语言确认仍出现保存失败；B 只替换 manifest 后台入口并增加 UTF-8 HTML，其余原生文件及 124 份 JS 完全相同，相同操作进入翻译主菜单。两轮均观察 15 秒，详见 `ios-ui-harness/cold-ab-comparison.json`。该对照支持“显式页面与编码声明”组合修复，未把两者拆成独立变量，也不代表已经验证翻译。正式修复使用锁定 WXT 的 publicAssets 和 manifestGenerated hooks，不修改背景业务逻辑；正式重构建的资源身份单独记录。

原生容器提供中英启用步骤、深色模式和手动系统路径。iOS-only 模板额外登记缺失的 Script.js 资源，macOS-only 和双平台布局也经过包装与编译检查。模拟器上原设置快捷按钮仅打开系统设置根页，故模拟器与无开发团队构建只呈现手动步骤；真实开发团队下的 iOS 26.2+ 公开 API 路径仍需真机验证，不能把团队标识推断为该模拟器现象的已证实根因。

正式 reviewed App 的 461 个 Web 文件在源构建、包装、三目标编译和实际 Simulator 安装中一致，完整摘要 `67b0af77f5e99f0c665643765c7f3e2399e4c93ab05097767b475e020cda853a`。原生容器独立审查修复了 WKScriptMessageHandler 强引用环；使用弱转发器并注销注册，三目标 Swift 编译通过，未作动态释放仪器验证。实际安装后的中英文及深色引导截图已审查，路径完整、无裁切，模拟器不显示无效快捷按钮。对应截图为本机 iOS 26.2 Simulator，区别于上方桌面窄视口夹具。

正式 Safari 冷启动保留了中文界面、简体中文目标及默认免费服务。三段公开英文正文均由未改写的生产业务生成一份中文译文，保留原文且没有嵌套译文。完整闭环未通过：译文出现后，Safari 仍依次显示 `dict.youdao.com`、`ifanyi.iciba.com`、`webapi.laratranslate.com`、`lingvanex.com`、`index-translate.bilibili.com` 权限提示。前四个域仅允许一天，第五个保留未授权；没有选择所有网站。提示遮住主面板操作，因此恢复、重译、刷新、触摸和视频验收尚未继续。七轮原生 guard 均未发现宿主激活或新 Simulator.app。精确结果为 `ios-ui-harness/formal-production-acceptance.json`，失败的 XCTest 轮次保留，不能改写成产品操作通过。译文与授权提示不证明某个具体上游供应商成功，也不证明每次都发出新的网络请求。

仍需完整验收：

- Safari macOS/iPhone/iPad 安装、站点授权、更新保留配置、禁用/卸载。
- iOS AVKit 原生轨显示、手动字幕 Off/切换、退出与旋转、后台冻结后的恢复。
- Android Edge/Firefox 真机安装更新、系统选词句柄、键盘、安全区、内存回收与网页/划词/字幕三条路径。
- Safari Userscripts 实际管理器与设备、真实公开供应商、真实音频播放、VoiceOver/TalkBack。

在这些证据缺失时，Safari 原生交付保持开发预览；不会宣称移动与 Safari 整体目标已经完成。

## 集成契约

共享几何端口为 `src/platform/dom/visualViewport.ts`，业务自行持有生命周期与显示状态。公共配置字段和消息协议未新增。

可能与其他并行任务冲突的共享文件：`package.json`、`wxt.config.ts`、`tests/test-matrix.json`、`tests/architecture/vue-verification-owners.json`、严格覆盖率清单、七种 i18n 消息、userscript 文案投影、文档导航与快速开始；另有全文进度组件和对应测试的最小移动定位接入。合并时应保留各任务的新增条目，不整文件覆盖。CI 兼容性修复另涉及 `tests/ownedBrowserClose.test.ts`、`tests/vocabularyVideoSourceUi.test.ts`、`tests/documentTranslationBinary.test.ts`；前两个仅修测试环境适配，后一个仅调整单用例有界预算。

## 界面审查截图

以下图片均来自生产扩展；背景网页与翻译响应为受控夹具。键盘截图中的可见视口为显式模拟，没有原生键盘验收含义。

![320px 深色划词卡片](./images/selection-dark-320.png)

![网页进度面板避让键盘的几何夹具](./images/progress-keyboard-fixture.png)

![390px 失败面板与 44px 操作](./images/progress-failure-390.png)

![竖屏视频底部双语字幕](./images/video-portrait.png)

![完整时间标签与 44px 触摸操作](./images/video-menu-touch.png)

以下为正式 reviewed App 的真实 iOS Simulator 安装指引；系统语言通过 App 启动参数指定，深色检查后恢复任务设备原有浅色外观。

![iOS Simulator 中文安装指引](./images/safari-ios-guide-light.png)

![iOS Simulator 深色安装指引](./images/safari-ios-guide-dark.png)
