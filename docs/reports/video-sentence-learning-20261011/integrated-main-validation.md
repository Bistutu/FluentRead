# 最新 main 整合后的浏览器复验

2026-10-11。合并提交 `8954f647286499b50924b38e2e9b42176808b48a` 整合 `origin/main` 的 `43f66b01` 后，以重新构建的 Chrome 生产扩展 `.output/chrome-mv3` 复跑现有默认专项：十个场景、80 项功能与操作断言全部通过，进程退出码 0。Chrome 构建日志为 `/private/tmp/video-learning-merge-chrome.log`，成功完成于 39.7 秒。精简结果与产物绑定见 [整合浏览器 JSON](./evidence/integrated-main-browser.json)。

本轮没有新增测试场景、原站探测或性能测量。真实本地 MP4 的解码、播放时钟、seek、暂停和 fullscreen 使用实际浏览器媒体能力；字幕、翻译及讲解供应使用受控夹具。此前原站返回空字幕 body 的边界与独立性能对照保持原记录，本轮结果不扩张这些结论。

## 产物绑定

扩展版本为 `0.0.37`，测试前后以下 SHA-256 完全一致：

| 文件 | SHA-256 |
| --- | --- |
| `content-scripts/content.js` | `6ae1b696c33c02e59aca70f4793be77ff64dc1eda672a5372c605b7e1bbd86ff` |
| `background.js` | `816f41d85653601fda3755be562d2bcd4a0cfccb465be8945c319a11e535f14b` |
| `manifest.json` | `961d10d94833c621d25cd57c2668613840b1b5ff2fc8aa96628448b12a767924` |

## 实际覆盖与结果

| 既有场景 | 断言数 | 结果 |
| --- | ---: | --- |
| YouTube 完整句学习、媒体控制、编辑、收藏、来源、生命周期与样式 | 31 | 通过 |
| YouTube 快切合并、收起/关闭请求释放、小播放器固定换句与键盘操作 | 3 | 通过 |
| X 完整句学习、媒体控制、编辑、收藏、来源恢复、生命周期与样式 | 31 | 通过 |
| X 快切合并、收起/关闭请求释放、小播放器固定换句与键盘操作 | 3 | 通过 |
| YouTube 仅翻译轨拒绝作为原始时间轴，原轨到达后可学习 | 2 | 通过 |
| X 五种来源身份场景，包括单 DOM video 的未证明 `/video/2` | 10 | 通过 |

真实 browser fullscreen 在两个平台均执行并通过，保留学习控件可见断言。来源身份场景保留未标语言原生轨回退配置语言、可靠 `/video/N` 来源和不可靠来源拒绝恢复/不伪造链接的原有检查。收藏与学习中心沿用实际扩展持久化和页面，没有追加展示数据。

隔离 Edge 通过 Launch Services 在第二屏正常窗口后台启动，`launchMode=macos-background-cdp`、`focusPolicy=launchservices-no-foreground`。窗口模式为 `background-visible-no-focus`，`browserFrontmost=false`；原生观察器记录 browser activations 为 0。受控页面与最终报告的 pageerror 均为 0，browser、profile、焦点观察器清理成功。日常浏览器与用户页面没有接入。

两平台菜单与学习卡的实际 computed appearance 和 [优化后功能证据](./performance/functional-browser.json) 完全一致，390×260 小播放器原句及固定控件检查通过。因此保留 [普通阅读态](./performance/youtube-learning-after.png) 与 [小播放器](./performance/x-compact-after.png) 的已有截图，没有覆盖历史图库或新增仓库图片。当前批原始截图仍随报告保存在 `/private/tmp/fluentread-video-sentence-learning-merge-20261011/retry`。

## 首批未完成与有界收尾

首批完成 YouTube 前 23 项后停在 CDP `requestFullscreen(awaitPromise:true)`，Node 未结束。只读确认该批 owned profile 的浏览器进程数为 0，原 CDP 端口拒绝连接；当时无法再读取 DOM fullscreen 状态或取得完整焦点结果，浏览器退出原因未确定。该批保持为 incomplete，没有计为通过或归因于产品回归。

随后仅对已证明身份的挂起 Node 发出 SIGINT，退出码 130；Node 与其原生观察器已退出，且 owned profile 无浏览器进程后，删除该批两个临时目录。精简观察和清理事实一并保留于 JSON，原始证据在 `/private/tmp/fluentread-video-sentence-learning-merge-20261011/initial-incomplete-owned-exit.json`。

runner 最小修正为 fullscreen 请求等待最多 15 秒、CDP detach 最多 1.5 秒，并在 owned browser 断开时快速失败后写报告与清理；实际 fullscreen 及控件断言仍保留。仅再运行一次相同产物的完整 80 项，得到上述成功结果，没有继续重启或扩测。runner 语法检查和改动 `diff --check` 通过。

## 保留的验收边界

本轮证明最新 main 整合产物在上述受控浏览器流程中的行为。真实 YouTube/X 原字幕供应后的闭环、Firefox 运行时、画中画、真实提供商质量、长期会话及任意小于 390×260 的布局仍未由本轮验收；旧 74 项和性能证据继续对应各自当时的产物。
