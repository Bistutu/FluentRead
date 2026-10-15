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
| Safari 交付 | WXT 0.20.18 Safari MV2、Safari 26 门槛；最终产物检查、完整资源摘要、Apple 新旧包装工具、独立 Xcode 目录与最低系统版本 | 生成和编译可复现；不签名发布、不申请账号、不把包装当运行验收 |

没有新增独立翻译实现。触摸和字幕均继续通过已有配置、服务与生命周期接入。未复制或借鉴外部参考项目代码。

## 官方依据与现有能力核实

- [Mozilla 的 FluentRead 商店页](https://addons.mozilla.org/en-US/firefox/addon/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB/) 在本次核查时明确标示可用于 Firefox Android。这不等于本次开发包已完成 Android 设备验证。
- [Microsoft 移动策略](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-mobile-policies)说明 Android 扩展可受管理策略限制；具体目录和安装按钮仍需当前浏览器确认。
- Safari Userscripts 的核心网页/划词入口和 Via 既有说明继续保留；userscript 不提供扩展的视频字幕运行时，新原生全屏提示不进入其固定语言资源。
- [Apple Safari 扩展说明](https://developer.apple.com/safari/extensions/)及[包装工具文档](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)用于未签名包装流程。
- [MDN 官方兼容数据](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/declarativeNetRequest.json)记录现有请求隔离所需的 `initiatorDomains`/`requestMethods` 从 Safari 26 开始支持。本项保留限制条件，不对旧 Safari 放宽来源范围。
- [WebKit 的内联视频说明](https://webkit.org/blog/6784/new-video-policies-for-ios/)区分网页内播放与系统全屏；网页 DOM 字幕不能直接覆盖系统播放器。原生轨桥接不保证平台样式或后台持续翻译。

## 验证状态

本轮专项均限定改动与直接影响范围，没有运行无筛选全量回归。

| 验证 | 结果与范围 |
| --- | --- |
| 类型检查 | `pnpm compile` 通过 |
| 最终集成专项 | 10 文件、1,436 项通过，含 1,028 条文件头规则；其余覆盖模块边界、验证归属、真实 Vue 行为、浮层尺寸协商、字幕运行时与划词生命周期 |
| 平台/文案合约 | Safari manifest 专项 37 项通过；userscript 构建配置与固定语言资源投影专项通过 |
| 严格覆盖率 | VisualViewport、新原生轨桥接及既有 popup/core/字幕缓存/人工字幕 6 个受影响模块四维均 100%（分别限定模块执行） |
| Vue 行为归属 | 悬浮球与全文进度组件迁出冻结债务，真实 SFC setup/模板消费者分别 10 和 5 项通过 |
| 网页触摸与浮层 | `floating-progress/report.json`：14 项通过，含加载、取消迟到结果、44px 目标、拖动、刷新、深色 popup、可见视口夹具及卸载 |
| 划词 | `selection-final/report.json`：8 项通过，含真实生产 UI、可信 CDP 触摸/DOM Range、320px 深色、键盘偏移夹具、后台和刷新清理 |
| 网页结果状态 | `progress-status/report.json`：12 项通过，含失败重试、取消、恢复、隐藏、390px 深色失败面板；三个操作目标宽高均不小于 44px |
| 视频 | 生产原生轨资源事件、内联/横屏、菜单与恢复 10 项通过；所有 13 个可见按钮不小于 44×44，时间标签独立成行，最终证据为 `video-complete/report.json` |
| 构建 | Chrome、Firefox、Safari MV2、userscript 均通过，userscript verifier 通过；具体资源身份见 `verification.json` |
| 文档与审计 | `pnpm docs:build`、`pnpm test:audit` 和 `git diff --check` 通过；审计发现 730 个已归类文件不代表已执行全量 |

所有浏览器专项使用 production 扩展、自有临时 profile、第二屏正常后台窗口、焦点监测与 owned-close 清理；翻译响应及页面受控。CDP 触摸输入、DOM Range、VisualViewport/生命周期夹具不替代原生长按、系统键盘或移动真机。

本地原始证据根目录：`research/mobile-safari-20261015/`（工作区层级）。失败轮次保留在各自目录，最终通过轮次另存，不覆盖失败证据。与本报告并列的 [verification.json](./verification.json) 记录源码摘要、构建身份和证据索引；`validation/` 保存类型检查、专项、覆盖率与构建日志。

已执行的代码与逻辑复核修复包括：触摸兼容 click 重复执行、拖动布局坐标、跨段 Range 恢复误判、原生轨错误后的 claimed 状态、空字幕轨、轨道资源任务异步清空、人工字幕时间轴批量查询成本，以及后台字幕时钟重启。截图复核还修复了触摸按钮被高优先级样式压缩，以及时间标签被截断的问题。

## Apple 工具检查与未完成项

本机 Xcode 26.2、macOS/Safari 26.6.2，存在 macOS/iPhoneOS/iPhoneSimulator 26.2 SDK 路径。`simctl` 没有可用设备，`devicectl` 没有连接设备。SDK 路径存在不等于模拟器运行时可用。

- 已生成 macOS/iOS Xcode 包装，检查 460 个资源文件：源构建、包装复制和编译后 macOS 扩展三处完整树摘要一致。摘要及路径保存在 `verification.json`。
- macOS 通用 arm64/x86_64 编译通过，设置 `CODE_SIGNING_ALLOWED=NO` 和 `CODE_SIGNING_REQUIRED=NO`。链接器默认 ad-hoc 标记不是开发者签名或可发布凭证；未安装、启动或启用扩展。
- iOS generic Simulator destination 被平台组件缺失拒绝（exit 70）。
- 直接按 Simulator SDK 与 iPhoneOS SDK 的 target 构建均完成扩展编译/链接，但完整 App 在资产目录处理阶段失败（exit 65）：`No available simulator runtimes for platform iphonesimulator`，`supportedRuntimes=[]`。
- 三次 iOS 失败来自此前资源快照；最后触摸样式补丁未改变缺失 runtime 的环境，因此没有重跑或计为最新 iOS 构建通过。
- 没有下载大型平台组件、配置开发者团队、签名、TestFlight 或 App Store 操作。

仍需完整验收：

- Safari macOS/iPhone/iPad 安装、站点授权、更新保留配置、禁用/卸载。
- iOS AVKit 原生轨显示、手动字幕 Off/切换、退出与旋转、后台冻结后的恢复。
- Android Edge/Firefox 真机安装更新、系统选词句柄、键盘、安全区、内存回收与网页/划词/字幕三条路径。
- Safari Userscripts 实际管理器与设备、真实公开供应商、真实音频播放、VoiceOver/TalkBack。

在这些证据缺失时，Safari 原生交付保持开发预览；不会宣称移动与 Safari 整体目标已经完成。

## 集成契约

共享几何端口为 `src/platform/dom/visualViewport.ts`，业务自行持有生命周期与显示状态。公共配置字段和消息协议未新增。

可能与其他并行任务冲突的共享文件：`package.json`、`wxt.config.ts`、`tests/test-matrix.json`、`tests/architecture/vue-verification-owners.json`、严格覆盖率清单、七种 i18n 消息、userscript 文案投影、文档导航与快速开始；另有全文进度组件和对应测试的最小移动定位接入。合并时应保留各任务的新增条目，不整文件覆盖。

## 界面审查截图

以下图片均来自生产扩展；背景网页与翻译响应为受控夹具。键盘截图中的可见视口为显式模拟，没有原生键盘验收含义。

![320px 深色划词卡片](./images/selection-dark-320.png)

![网页进度面板避让键盘的几何夹具](./images/progress-keyboard-fixture.png)

![390px 失败面板与 44px 操作](./images/progress-failure-390.png)

![竖屏视频底部双语字幕](./images/video-portrait.png)

![完整时间标签与 44px 触摸操作](./images/video-menu-touch.png)
