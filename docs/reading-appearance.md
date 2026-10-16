# 阅读外观

在扩展弹窗打开「阅读外观」，选择「系统默认」即可预览当前网页的正文字体，无需先开启翻译。原文和译文（包括之后生成的译文）使用同一系统字体；选择「网站原样」立即恢复。

默认只应用于当前网页，刷新或切换到新页面后不保留。想持续使用时，主动选择「此网站记住设置」；网站范围与现有网站规则相同，按基础域匹配。清除网站记忆不会打断当前页预览，下次打开恢复网站原样。

这项功能只调整字体，不下载字体、不修改文字或重排页面。代码、公式、图标、表单及扩展界面保持原有样式。关闭扩展、停用当前站点或离开页面时清理覆盖。网页结构与字体实现各异，复杂画布、图片文字及受保护区域不在调整范围内；不能保证所有网站都能识别为正文。

开发验证：`pnpm test tests/readingAppearanceRuntime.test.ts tests/readingAppearanceComposition.test.ts tests/readingAppearanceContent.test.ts tests/popupReadingAppearance.test.ts`。另需类型检查、架构检查以及 Chrome / Firefox 构建。DOM 测试不代表真实网站或跨浏览器视觉验收。
