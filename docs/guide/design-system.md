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
| UI | 下拉选择、功能开关卡、下载进度、服务图标、界面图标、翻译加载指示器，以及基础控件与弹窗 |
| Examples | 由真实组件组成的设置片段，展示长文案与窄屏表现 |

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

## 参考与来源

展示方式参考了 [Read Frog 的 Storybook](https://storybook.readfrog.app/?path=/docs/foundations-colors--docs)：先查看基础规范，再查看组件及其交互状态。流畅阅读的示例、样式接入与文档均使用自身的 Vue、Element Plus 和 Vite 架构实现。

关于工具本身，可阅读 [Storybook 的 Vue 与 Vite 文档](https://storybook.js.org/docs/8/get-started/frameworks/vue3-vite)。
