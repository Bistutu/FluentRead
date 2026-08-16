# 安装与第一次翻译

下面的流程适用于 FluentRead 0.0.29。安装完成后，不需要注册账号即可开始使用。

## 安装扩展

从浏览器商店安装是最省事的方式：

- [Chrome Web Store](https://chromewebstore.google.com/detail/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB/djnlaiohfaaifbibleebjggkghlmcpcj?hl=zh-CN)
- [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB/kakgmllfpjldjhcnkghpplmlbnmcoflp?hl=zh-CN)
- [Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB/)

安装后，建议把 FluentRead 固定到浏览器工具栏，方便随时打开控制面板。

## 三分钟完成第一次翻译

### 1. 打开一篇可阅读的网页

选择一篇包含普通段落的文章或文档。浏览器内部页面、扩展商店、部分登录页和受保护的编辑器通常不允许扩展注入内容，建议先用普通网页测试。

### 2. 打开 FluentRead 弹窗

选择源语言和目标语言，然后确认当前使用的翻译服务。第一次使用可以先保留默认设置。

<img class="doc-screenshot" src="/screenshots/popup.png" alt="FluentRead popup controls" />

### 3. 点击“翻译页面”

FluentRead 会按页面结构处理可翻译文本，并在原文附近插入译文。页面较长时，翻译可能分批出现；请保持当前标签页打开。

<img class="doc-screenshot" src="/screenshots/translation.png" alt="FluentRead translating an article" />

### 4. 恢复或重新翻译

翻译完成后，你可以：

- 点击“恢复原文”，移除当前页面中的译文。
- 修改目标语言或翻译服务，再次执行翻译。
- 只选中一段文字，使用选区翻译获取局部结果。

## 如果点击后没有结果

按下面顺序检查：

1. 当前页面是否允许扩展注入内容。
2. 弹窗中的翻译服务是否已启用并配置完整。
3. 是否已经存在翻译结果；此时可以先恢复，再重新翻译。
4. 打开设置确认目标语言和快捷键没有冲突。

仍然无法使用时，请查看[常见问题](/guide/faq)，并在 GitHub Issue 中附上浏览器、网页类型和控制台错误，不要直接粘贴 API 密钥。

## 手动安装开发版本

如果你需要测试 GitHub 上的最新构建：

1. 在仓库的 Releases 或 Actions 中下载对应浏览器的构建产物。
2. 打开浏览器的扩展管理页并开启“开发者模式”。
3. 选择“加载已解压的扩展”，指向解压后的扩展目录。
4. 测试完成后，回到扩展管理页移除该开发版本，避免与商店版本重复注入。

开发者需要从源码构建时，请参考仓库 README 中的开发章节。
