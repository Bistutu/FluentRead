# FluentRead 开发规则

## 项目定位

- FluentRead 是主要开发目标：一款提供全文双语翻译、划词翻译和多翻译服务支持的浏览器扩展。
- 上级工作区仅用于参考。需求未指名其他项目时，一律在本项目实现。

## 技术基线

- 保持现有技术栈：WXT 0.20、Vue 3、TypeScript、Element Plus 和 pnpm 9。当前锁文件实际使用 WXT 0.20.18；未经明确升级任务，不按新版文档擅自使用仅在更高版本存在的 API。
- 优先延续现有模块边界：
  - `entrypoints/background.ts`：后台能力、扩展消息和浏览器 API。
  - `entrypoints/content.ts` 与 `entrypoints/main/`：页面注入、DOM 处理和全文翻译流程。
  - `entrypoints/service/`：翻译服务适配器。
  - `entrypoints/utils/`：配置、缓存、队列、快捷键和组件挂载等共享能力。
  - `components/` 与 `entrypoints/popup/`：Vue UI。
- 新功能应复用现有配置、消息、翻译服务和挂载机制，避免另建一套并行状态或通信体系。
- 内容脚本运行在任意网页中。新增 DOM、样式和事件时使用 FluentRead 专属命名，避免污染宿主页面；卸载、关闭或页面离开时清理监听器、计时器、观察器、挂载节点和未完成请求。
- 浏览器 API 优先使用项目现有的 `browser`/webextension-polyfill 方式，并同时考虑 Chrome、Edge 和 Firefox 的行为差异。
- API 密钥、令牌和用户配置只能按现有本地存储方案处理，不写入日志、源码、测试夹具或提交内容。

## WXT 官方依据

- WXT 是 FluentRead 的浏览器扩展开发框架。涉及入口、manifest、构建、浏览器目标、内容脚本、后台脚本、扩展 UI、存储、消息通信或 WXT 配置时，优先查阅官方资料：
  - 官网与文档：<https://wxt.dev/>
  - WXT API 参考：<https://wxt.dev/api/reference/wxt/>
  - 官方示例：<https://wxt.dev/examples.html>
  - 安装与入门指南：<https://wxt.dev/guide/installation.html>
  - 官方源码：<https://github.com/wxt-dev/wxt>
- 官方文档和源码是 WXT 行为的权威依据；参考项目、博客、搜索结果和既有印象只能作为补充。
- 使用官方文档前先核对 FluentRead 锁定的 WXT 版本。若当前文档描述的是更高版本，应查对应版本的源码、类型定义或变更记录，不能假设 API 向下兼容。
- 遵循 WXT 的文件式入口和构建约定，优先使用 WXT 提供的 `defineBackground`、`defineContentScript`、配置、manifest 与跨浏览器构建能力，不重复搭建框架已经提供的基础设施。
- 新增入口或浏览器能力时，同时检查生成的 manifest、所需权限、Chrome/Edge/Firefox 差异，以及 MV2/MV3 生命周期差异。

## 实现原则

- 修复问题时处理根因，并覆盖翻译、恢复原文、重复触发、动态 DOM、页面卸载和失败重试等相关状态。
- 引入新的翻译服务时沿用 `entrypoints/service/` 的适配器模式，补齐配置可见性、错误处理和调用路径，不在 UI 组件中直接散落网络请求。
- 从参考项目借鉴功能时，将概念适配为 Vue/TypeScript 实现；不要引入 React 专用依赖或跨仓库运行时耦合。
- 控制改动范围，不顺手重写无关代码；除非任务需要，不升级依赖或改变构建工具。
- 用户可见行为变化同步更新相关文档；版本号和发布产物仅在用户明确要求发布时修改。

## 验证

- 使用 `pnpm compile` 做 TypeScript/Vue 类型检查。
- 涉及扩展构建或入口行为时运行 `pnpm build`；涉及 Firefox 兼容性时再运行 `pnpm build:firefox`。
- 涉及文档时运行 `pnpm docs:build`。
- 当前项目没有自动化测试脚本。对 DOM 翻译、悬浮球、划词翻译、快捷键、配置持久化或浏览器消息的改动，需要说明并执行相应的手动验证。
- 需要由 Codex 操作 Chrome 测试指定段落翻译或翻译状态切换时，必须遵循 `docs/guide/codex-browser-testing.md`。自动化按键名称使用标准 `Control`，不要使用 `CTRL`；成功状态通过目标段落中的 `.fluent-read-bilingual-content` 判断。
- 不把参考项目自身的测试通过视为 FluentRead 的验证结果。
