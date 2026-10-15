# 手机与 Safari

手机上优先使用浏览器扩展菜单或页面悬浮球开始翻译。选择安装方式时，先确认浏览器提供的扩展入口；桌面安装包不能直接导入 iPhone。

| 环境 | 安装入口 | 当前边界 |
| --- | --- | --- |
| Android Edge | 浏览器的扩展目录中搜索流畅阅读 | 目录、可安装项目和权限随浏览器版本及管理策略变化 |
| Android Firefox | Firefox 扩展管理器或 Mozilla 扩展网站 | Mozilla 的流畅阅读页面已标示支持 Android；本次开发包仍须设备验收 |
| Android Via 等脚本环境 | [油猴脚本安装说明](/guide/userscript) | Via 请用源码独立版；已有 Android 13 模拟器证据，仍缺真机验收 |
| iPhone/iPad 或 Mac Safari Userscripts | [Userscripts 安装与排查](/guide/userscript#safari-userscripts-安装与排查) | 核心网页和划词路径；没有扩展版的视频字幕、图片 OCR 或圈选翻译 |
| Safari 原生 Web Extension | 本页下方的开发预览流程 | 提供 Safari 26+ 的源码构建与 Xcode 包装；尚未发布可安装的 Safari 商店版本 |

## 安装与更新

**Android Edge：**从浏览器菜单进入扩展目录，找到流畅阅读并核对权限。安装后在扩展菜单打开流畅阅读；原先打开的文章需要刷新。没有扩展目录或找不到流畅阅读时，请先核对浏览器版本和组织管理策略，或使用支持的脚本环境。不要把桌面“加载已解压扩展”的步骤用于手机。Microsoft 的[移动策略文档](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-mobile-policies)确认 Android 扩展可以受管理策略禁用；此文不保证每个移动版本都能安装全部桌面扩展。更新后在扩展详情核对版本，再刷新文章。

**Android Firefox：**打开菜单中的扩展管理器，或者访问 [Mozilla 上的流畅阅读](https://addons.mozilla.org/en-US/firefox/addon/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB/)。2026-10-15 核查时，Mozilla 页面明确标示可用于 Firefox Android；请以当前设备实际出现的安装按钮继续。更新由 Firefox 的扩展机制管理；安装可用性、私密窗口权限及更新方式见 [Mozilla 官方说明](https://support.mozilla.org/en-US/kb/find-and-install-add-ons-firefox-android)。本次没有 Android Firefox 真机证据。

**Safari Userscripts：**先安装 Userscripts 并授予正在阅读的网站权限，再导入脚本。只启用一种流畅阅读脚本。Greasy Fork 更新、手动导入的源码独立版和未来原生 Safari App 是不同渠道；手动文件需要手动替换并让管理器重新读取，构建成功不会自动更新已安装脚本。具体步骤与现有验证范围见[油猴脚本](/guide/userscript)。

## 手机上怎样操作

- **网页翻译：**打开普通 HTTP(S) 文章，从扩展菜单或悬浮球点击翻译。需要恢复时使用同一入口；更换语言或服务后先恢复原文再翻译。浏览器内部页与扩展商店不能注入。
- **划词：**开启划词翻译，长按文字并调整系统选择手柄，再点选区旁的翻译图标。系统复制菜单可能同时显示；保留系统选区即可。仅触摸设备不需要鼠标悬停快捷键。
- **视频字幕：**仅扩展版提供字幕路径。YouTube 应在网页播放器中开启字幕，再使用流畅阅读的视频翻译。iOS 系统原生视频全屏不包含网页 DOM 浮层。原生扩展会尝试把已读取的原文与已缓存译文交给系统的“FluentRead”字幕轨道；字幕样式由系统播放器控制，后台挂起期间不保证及时出现新译文。未出现该轨道时，可使用站点字幕，或退出系统全屏继续在网页内阅读双语字幕。此桥接尚待 iPhone/iPad 实机确认。

旋转屏幕、唤起软键盘或回到后台后的页面，应以当前可见区域重新放置浮层。若网页已被系统重新加载，先确认页面和扩展已恢复，再重新发起翻译；未完成请求不代表已经保存的译文。问题反馈请包含系统、浏览器、扩展或脚本版本、页面地址，以及是否使用系统视频全屏。

## Safari 原生开发预览

Safari 原生版和 Userscripts 是独立运行渠道，请勿在同一网页同时启用。原生版复用 WXT、Vue、TypeScript 与共享业务模块，不包含第二套翻译实现。

源码目标为 Safari/iOS 26+。现有请求规则用 `initiatorDomains` 限制扩展来源，并用 `requestMethods` 限制请求方法；[MDN 官方兼容数据](https://github.com/mdn/browser-compat-data/blob/main/webextensions/api/declarativeNetRequest.json)记录这两个条件从 Safari 26 开始支持。不能为兼容旧版而删除这些隔离条件。清单不会声明 Chromium `offscreen`、Chrome OAuth 身份或 Firefox 身份字段。Safari 的网页访问仍需用户单独授权；清单声明网站范围不等于已经获得访问许可。

当前 Safari 能力契约关闭 Chrome 内置翻译、OCR/图片翻译、圈选截图和依赖扩展 DOM 容器的本地处理或扩展音频播放。划词朗读可以使用已有页面音频回退，但仍受用户手势和音频策略约束。Google Drive 的 Chrome 身份授权不在 Safari 开启。自定义请求头与默认免费服务仍需逐供应商在 Safari 上验证，不能由 manifest 检查推断联网可用。

<details class="guide-details">
<summary>维护者：生成并检查未签名 Xcode 包装</summary>

需要 macOS、完整 Xcode、Node 20+ 和仓库锁定的 pnpm 依赖。项目固定使用 WXT 0.20.18 的 Safari MV2 目标；Safari 后台入口已有 `persistent: false`，符合 [Apple 的 iOS 后台要求](https://developer.apple.com/documentation/safariservices/optimizing-your-web-extension-for-safari)。

在仓库根目录依次执行：

```sh
pnpm safari:check
pnpm build:safari
pnpm safari:verify
pnpm safari:package --bundle-id org.example.FluentRead
```

将示例 bundle ID 替换为维护者自己的标识。需要指定 Xcode 时在命令前设置 `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`。构建遵循项目 resource-safe runner；包装不会重新运行重型构建。

`safari:check` 只读取工具、Xcode 版本和 SDK 路径可用性；SDK 存在仍不等于已经安装了可用的模拟器运行时或连接了真机。`safari:verify` 校验 `.output/safari-mv2` 的最终清单、后台编译目标、内容脚本与文件引用。`safari:package` 优先发现 `safari-web-extension-packager`，旧 Xcode 回退到 `safari-web-extension-converter`，复制扩展资源并生成 macOS 与 iOS 工程。它不会打开 Xcode、签名、申请账号或上传。

包装会把 Apple 模板的最低系统版本提高到 iOS 26、macOS 14，避免 App 安装到明显不具备目标 Safari 的旧系统；已有更高门槛会保留。Mac 仍需升级到 Safari 26+。系统范围依据 [Apple Safari 26 发行说明](https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes)。

默认输出 `.output/safari-xcode`。已有目录会拒绝覆盖；更新时先重新构建，再用新的目录，例如：

```sh
pnpm safari:package --bundle-id org.example.FluentRead --project-location .output/safari-xcode-next
```

仅生成一种平台可加 `--platform macos` 或 `--platform ios`。生成结果中的 `fluentread-package-report.json` 记录实际工程路径、manifest 与完整资源摘要、源码版本和未签名状态。复制后的完整资源也会与源构建比对，不能用不变的 manifest 代替 JavaScript 版本检查。它不是设备验收报告。复制资源后，修改原构建目录不会自动更新已有 Xcode 工程。

可按报告中的实际工程路径做未签名编译检查（scheme 名称先用 `xcodebuild -list -project 路径` 确认）：

```sh
node scripts/testing/run-resource-safe.mjs -- xcodebuild -jobs 1 -project "报告中的工程路径" -scheme "FluentRead (macOS)" -destination 'generic/platform=macOS' -derivedDataPath .output/safari-derived-macos CODE_SIGNING_ALLOWED=NO build
node scripts/testing/run-resource-safe.mjs -- xcodebuild -jobs 1 -project "报告中的工程路径" -scheme "FluentRead (iOS)" -destination 'generic/platform=iOS Simulator' -derivedDataPath .output/safari-derived-ios CODE_SIGNING_ALLOWED=NO build
```

本地 macOS 运行还需要按 Xcode/Safari 的开发流程安装 App、启用扩展和授予站点访问；iPhone/iPad 需要可用模拟器或连接设备，并按 Apple 要求配置开发签名。未签名编译不等于可以在真机安装。发布与更新通过含扩展的 App 渠道完成，遵循 [Apple Safari 扩展分发说明](https://developer.apple.com/safari/extensions/)；本次不执行签名、TestFlight、App Store 提交或账号申请。

若 Xcode 报告找不到 iOS Simulator destination，并提示“iOS 26.2 is not installed”，需要先在 Xcode 的 Settings → Components 安装对应组件。即使 SDK 路径存在，直接指定 target 与 SDK 编译也可能在资源目录处理阶段报 `No available simulator runtimes`；这不是靠去掉 destination 就能绕过的完整 App 验证。脚本不会自动下载平台或创建测试设备。`CODE_SIGNING_ALLOWED=NO` 关闭开发者签名；macOS 链接器仍可能给 Mach-O 放入无团队、无证书的 ad-hoc 标记，这不是可分发的签名 App。

</details>

## 验收边界

2026-10-15 在 Xcode 26.2 上实际完成 Safari 生产资源校验、Apple 包装与 macOS 通用架构编译（关闭开发者签名）。iOS Simulator 通用目标因组件缺失无法开始；直接指定 iOS target 并分别使用现有 Simulator/iPhoneOS SDK 后，扩展目标能编译链接，完整 App 均在资产目录处理阶段因缺少 Simulator runtime 失败。因此不能宣称 iOS App 构建通过；本机也没有可用 iOS 模拟器实例或已连接 Apple 设备。

包装工具对 `world`、`match_about_blank` 和 `open_in_tab` 给出警告；[MDN 官方兼容数据](https://github.com/mdn/browser-compat-data/tree/main/webextensions/manifest)记录它们在当前最低 Safari 26 前已支持，其中 `open_in_tab` 始终在新标签打开。这些工具警告保留在证据中，不能由包装成功推断实际运行正常。静态清单与桌面窄视口验证只能证明各自范围，不能替代以下实机项目：

- Safari macOS 与 iPhone/iPad 的安装、启用、站点权限、升级后保留配置、禁用与卸载。
- 真机触摸选词及系统菜单、软键盘、横竖屏、安全区、系统放大字体与辅助技术。
- YouTube 网页/系统全屏切换、后台冻结与返回、公开翻译供应商和音频播放。
- Android Edge/Firefox 真机的安装更新、内存回收与三条翻译路径。

在这些项目取得实际证据前，Safari 原生版保持开发预览状态。
