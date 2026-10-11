# 视频句子学习浏览器验收

2026-10-11。整合最新主分支 `69d41e5e1` 后的 Chrome MV3 生产产物在隔离 Edge 中通过全部 72 项针对性断言：YouTube 主流程 30 项、X 主流程 30 项、机器翻译轨保护 2 项、五个 X 来源身份场景各 2 项。产物来自 `/private/tmp/video-learning-chrome-integrated.log` 的成功构建（34.7 秒）；fixture JSON 和三张精选截图均对应此次完整复验，包含未标语言 TextTrack 的配置语言回退和单 DOM `/video/2` 身份保护。

这是生产扩展、真实解码 MP4 和真实 HTMLMediaElement 播放时钟的受控专项。平台 HTML、原始定时字幕、微软译文响应和 OpenAI 兼容解释 SSE 使用确定性 fixture；解释请求、收藏持久化和学习中心走现有生产接口。它证明所列边界和完整句数据流，不能代表 YouTube/X 原站字幕、真实翻译服务或真实解释模型的闭环验收。

运行遵守 `fluentread-browser-translation-test`：每批创建独立临时 profile，通过 macOS Launch Services 后台启动可见 Edge，在第二屏正常窗口内通过 CDP 操作。没有连接日常浏览器，没有调用 `bringToFront`，没有移动系统鼠标。最终原生焦点观察记录浏览器激活 0 次，窗口始终非前台，结束后关闭本批浏览器并删除本批 profile；八个 fixture 场景均无 pageerror。

## 已验证的受控范围

- 两个原始 cue 聚合为完整句，保持原始 0–2500 ms / 3000–5500 ms 区间和邻句；中文原句无需同目标语言翻译。
- 上下句快捷键不冒泡到宿主播放器；切句保留用户暂停状态；真实 2 倍速时钟循环、用户暂停、拖动到区间外解除循环、句末暂停和恢复正常播放。
- 首句整句译文完成；无关统计更新不取消循环或进行中的解释；解释使用原句和允许的邻近字幕语境。
- 用户确认译文和解释后显式收藏，保留标题、语境、可靠来源和原始时间；重复保存维持现有收藏身份与上下文去重。
- 请求进行中禁止保存未确认译文；用户编辑后可保存；迟到译文响应不覆盖编辑结果。
- 默认以正文卡片阅读译文和讲解，显式编辑后焦点进入文本框；编辑前即固定当前句，真实播放跨句不漂移。主动跟随当前句、切句来回和折叠展开都保留相应草稿；折叠后的透明区域不拦截原视频。
- 空译文禁止保存；空编辑草稿切句回来不自动重译。清空讲解时编辑框仍保留，显式保存能实际删除既有 note，而不是只改变“已收藏”提示。
- 内容脚本样式已实际注入；面板基础字号 13px、深色背景、默认块级阅读文本，编辑框仍为块级 13px 字体；390px × 260px 播放器完整原句处于可见正文范围，紧凑头部重播可见且实际启动媒体，固定头尾动作和学习中心仍可达，并留出宿主控制区。实际浏览器全屏中仍可访问学习面板。
- 关闭学习、播放器替换和视频身份变化释放播放控制；新媒体不会沿用旧循环或旧字幕。学习中心显示真实时间链接，无法可靠恢复的来源显示提示；X 保存链接的片段恢复使用生产逻辑。
- 关闭播放辅助不自动播放用户暂停的视频，关闭面板恢复 FluentRead 播放器入口焦点。

YouTube 迟到的外视频字幕不能覆盖当前时间轴；只有 `tlang=zh-Hans` 的机器翻译轨不能作为原句学习，原始英语轨到达后空面板才出现完整句。X 来源场景使用直接绑定当前视频的原生 TextTrack：同帖多媒体无索引、页面 `/video/2` 但当前视频无对应局部链接（包含页面只渲染一个 DOM video 的情况），以及主帖/引用帖链接有歧义时，不恢复错误时间、不保存错误 URL；当前视频有明确局部 `/video/1` 祖先时仍能恢复和保存该精确身份。一个来源歧义场景使用未传 language 的 `addTextTrack`，实际翻译请求的 `from` 和收藏 `sourceLanguage` 均为配置语言 `en`，没有使用内部 `original` 标记。没有放宽生产 sidecar 的媒体对应守卫。

## 原站只读探测

真实页面未替换 HTML、媒体或原始字幕。探测只固定微软译文传输，以避免把翻译服务抖动误归到字幕来源；没有注入 fixture 字幕，没有用 fixture 代替原站验收。

| 平台样本 | 现场证据 | 结论 |
| --- | --- | --- |
| YouTube `iG9CE55wbtY` | TED Ken Robinson 视频实际可播放，duration 1203s、readyState 4；18 次 timedtext HTTP 200，响应均 0 字节，未出现可学习原句 | 未取得可用字幕，原站闭环未通过 |
| YouTube `Ks-_Mh1QhMc` | 导航 DOMContentLoaded 超时 45s；捕获 2 次 timedtext HTTP 200，响应均 0 字节 | 页面/字幕供应限制，未验收 |
| YouTube `drSMZgnmJjk` | ONE OK ROCK 官方 MV 实际可播放，duration 353s、readyState 4；英语 ASR 轨元数据可见，原生 CC 开启；9 次 timedtext HTTP 200，响应均 0 字节，原生字幕仍为空 | 未取得可用字幕，原站闭环未通过 |
| X `cerebras/status/2089870131291943228` | 真实帖子有两个可播放媒体（68s / 3.59s），无 textTrack cue / 字幕响应，并显示登录提示 | 原生/sidecar 字幕供应不足，未运行 ASR，原站闭环未验收 |

以上现场结果无法证明空响应的服务端成因，也不能据此判定句子学习回归。两批原站探测均无 pageerror、浏览器激活 0 次，且本批 browser/profile 清理成功。

Firefox 运行时、真实画中画窗口、真实翻译提供商及真实解释模型尚未验收。全屏已验证；画中画可能涉及原生前台窗口，未把全屏测试冒充画中画验收。

## 可复跑入口与证据

生产产物先运行 `pnpm build`。专项通过 `scripts/run-video-sentence-learning-test.cjs`，显式传入 `--extension-dir .output/chrome-mv3`、`--playwright-root <Codex 工作区依赖的 Node 包目录>`、`--focus-safe-helper scripts/testing/focus-safe-browser.cjs`、`--platforms youtube,x` 和独立 `--artifacts-dir`。依赖路径由工作区依赖工具解析，未固化带日期的运行时目录。

- [最终受控专项 JSON](evidence/fixture-browser.json)：72 项断言、pageerror、焦点和清理结果。
- [原站精简 JSON](evidence/live-platform-probes.json)：仅 URL/标题、媒体与轨元数据、caption HTTP status/bytes、失败、焦点和清理；不含正文评论、完整 HTML、签名查询或浏览器 profile。
- [YouTube 原句/译文阅读态](evidence/youtube-learning.png)、[X 完整讲解阅读态](evidence/x-learning-explanation.png) 与 [390px × 260px 小播放器](evidence/x-learning-compact.png)：均已完成编辑并显示已收藏，目视检查过样式、层次和固定操作区。

本轮全屏、完整讲解及来源场景额外截图保留在 `/private/tmp/fluentread-video-sentence-learning-integrated-20261011`。390px 小屏的完整原句、标题、重播与收藏操作仍可见，正文自然滚动；精选图未用编辑态冒充默认阅读态。源语言配置为 `auto`，收藏 sourceLanguage 仍与英语原轨 `en` 一致。

完整现场 DOM/截图只保留在本机 `/private/tmp/fluentread-video-sentence-learning-live-20261011` 与 `/private/tmp/fluentread-video-sentence-learning-live-additional-20261011`，未复制到仓库。没有修改任何参考项目。
