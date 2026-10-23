---
title: 设计系统与组件预览
description: 查看流畅阅读的颜色、字体与真实 Vue 组件，在不同主题、皮肤和屏幕尺寸下体验交互。
---

# 设计系统与组件预览

流畅阅读的组件展示站使用 Storybook，把界面中的视觉规范和可复用组件集中在一起。你可以查看配色与字体、操作下拉选择和开关，并比较浅色、深色与不同皮肤的表现。

<a class="bv-button bv-primary" href="/storybook/?path=/docs/foundations-colors--docs" target="_blank" rel="noopener noreferrer">打开组件展示站 →</a>

## 可以查看什么

| 分区 | 内容 |
| --- | --- |
| Overview | 展示站介绍与使用方式 |
| Foundations | 当前主题的颜色、文字对比度、字号与字体栈、圆角与阴影 |
| UI | 下拉选择、功能开关卡、折叠设置卡片、下载进度、服务图标、界面图标、翻译加载指示器，以及主次按钮与弹窗 |
| Examples | 由真实设置卡片组成的页面片段，展示长文案、折叠状态与窄屏表现 |

颜色取自流畅阅读正在使用的 CSS 变量，组件直接引用扩展的 Vue 实现。组件代码或共享样式更新后，展示站会随文档一起重新构建。

## 如何使用

1. 在左侧选择一个分区或组件，打开说明页或单个示例。
2. 在顶部工具栏切换浅色 / 深色、界面皮肤或组件内置文案的语言。示例说明和传入的演示文案保留原语言。
3. 在单个示例的 **Controls** 面板修改组件参数，例如禁用状态、图标尺寸或进度数据。
4. 使用视口工具切换到 Popup、Mobile 或 Desktop，查看文字换行与控件布局。
5. 直接点击、搜索或用键盘操作示例，检查交互与焦点。

预览中的数据只用于演示，不读取或修改你的扩展设置，不调用翻译服务，也不下载模型或字体。字体页展示可选字体栈；未安装的字体会使用系统回退字体。这里展示的是组件与组合片段，完整功能请在扩展中体验。

## 参与界面开发

在流畅阅读仓库根目录安装依赖后启动展示站：

```sh
pnpm install --frozen-lockfile
pnpm storybook
```

打开终端显示的本地地址，默认是 `http://127.0.0.1:6006`。示例位于 `storybook/`，展示站配置位于 `.storybook/`。新增示例时直接复用 `src/ui/components/` 的组件与 `src/ui/styles/` 的样式，覆盖正常、禁用、长文案和窄屏等相关状态。

```sh
pnpm storybook:typecheck
pnpm docs:build:site
pnpm storybook:check
pnpm docs:check
pnpm docs:preview
```

`docs:build:site` 会先构建文档，再把展示站构建到文档产物的 `storybook/` 子目录。预览完整站点时，从本地文档中的入口打开即可。GitHub Pages 使用同一份产物发布，无需另外配置子域名。

### 卡片与信息层级

设置页顶部直接显示页内导航；没有页内导航时直接显示设置内容。不再额外展示独占一行的页面大标题，页面名称由侧栏或窄屏分类选择器标识，并为屏幕阅读器保留语义标题。

新增设置优先组合 `SettingsGroup`、`SettingsItem` 和 `SettingsDisclosure`，不要为每个功能另造一套卡片。它们位于 `src/features/settings/ui/components/`，共用 `src/ui/styles/tokens.css` 的语义变量：

| 语义 | 变量与默认值 | 用途 |
| --- | --- | --- |
| 卡片边界 | `--fr-card-radius: 14px`、`--fr-card-outline`、`--fr-card-border` | 前者为完整外描边，后者为内部分隔线颜色；跟随当前皮肤 |
| 卡片层级 | `--fr-card-background`、`--fr-card-shadow` | 中性表面与轻阴影，浮层继续使用 `--fr-menu-shadow` |
| 卡片留白 | `--fr-card-gap: 20px`、`--fr-card-padding-inline: 20px` | 页面节奏与标题、设置行共同对齐；窄屏内边距缩为 16px |
| 设置行 | `--fr-settings-row-min-height: 66px`、`--fr-settings-row-padding-block: 14px` | 文案与控件对齐，内容较长时允许增高 |
| 操作与焦点 | `--fr-action-gap: 8px`、`--fr-focus-width: 2px`、`--fr-focus-color` | 主次操作间距与可见键盘焦点 |

标题说明放在同一文案区，右侧使用 `heading-extra` 插槽承载短操作。说明只解释用户需要作出的选择；完整技术说明收进已有帮助入口。卡片标题不添加粉色竖条，粉色用于选中状态与主操作。一个操作区域只设一个主按钮，其余使用中性色按钮或文字入口。

皮肤通过同名卡片 token 调整造型与密度，普通分组、总开关与折叠卡片共同消费，不再单独覆盖某个组件的圆角。传统色保留原有形态，例如乌金的 2px 棱角与金色细边；紧凑风格让标题和设置行共同使用 13px 水平留白。窄屏默认值集中定义在 `tokens.css`，避免组件内部覆盖皮肤的密度选择。玄青、乌金始终使用深色语义反馈色，不依赖系统主题是否为深色。

独立复用设置控件时，引入 `settings-controls.css` 并在容器添加 `fr-settings-controls`，即可获得与 Options 相同的开关尺寸、44px 命中区域及焦点反馈，无需挂载完整设置页骨架。Storybook 的设置组合与控件示例使用同一入口；帮助提示和数值输入直接引用 `SettingsItem` 与 `SettingsNumberInput`。卡片内贴边的折叠摘要使用内收焦点轮廓，避免被圆角裁剪。

常用设置保持展开。次要配置使用 `SettingsDisclosure` 的 `title`、`description`、`status`、`statusTone` 和可选 `status` 插槽；待配置、失败等影响使用的状态必须留在摘要中。组件使用原生 `details/summary`，透传 `id`、锚点及 `toggle` 事件，默认插槽始终挂载，收起不会丢弃输入草稿。`defaultOpen` 只决定初始状态；业务控件是否活跃、配置保存与旧请求失效仍由调用方负责。

窄屏下输入框可以移到标签下方，独立开关仍与标签同行。文案允许换行，不以省略号隐藏主要操作。禁止为了视觉效果增加背景动画、重滤镜或逐帧布局测量；复用 CSS 与现有组件，保留原生交互，并在 Storybook 检查深色、窄屏、长文案、键盘焦点及展开后再次收起的草稿状态。

## 参考与来源

展示方式参考了 [Read Frog 的 Storybook](https://storybook.readfrog.app/?path=/docs/foundations-colors--docs)：先查看基础规范，再查看组件及其交互状态。流畅阅读的示例、样式接入与文档均使用自身的 Vue、Element Plus 和 Vite 架构实现。

关于工具本身，可阅读 [Storybook 的 Vue 与 Vite 文档](https://storybook.js.org/docs/8/get-started/frameworks/vue3-vite)。
