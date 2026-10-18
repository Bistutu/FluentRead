# 快速开始

本页介绍流畅阅读的安装方法和基本用法。

## 安装

通过当前浏览器的官方扩展商店安装流畅阅读。

<BrowserInstall />

Chrome 商店打不开时，可以从 [GitHub 官方发布页](https://github.com/FluentRead/FluentRead/releases/latest) 下载最新正式版的安装包，并参照[离线安装说明](/guide/offline-install)安装。也可以使用 [CRX搜搜（国内可用）](https://www.crxsoso.com/webstore/detail/djnlaiohfaaifbibleebjggkghlmcpcj)，这是第三方分发网站，版本同步时间可能与官方商店不同。

下面演示在 Chrome 中的安装过程。点击 **添加至 Chrome** 后，核对浏览器列出的权限并点击 **添加扩展程序**。

<GuideVisual kind="install" />

<details class="guide-details">
<summary>手机、油猴脚本与 Thunderbird</summary>

支持扩展的 **安卓 Edge** 可从扩展入口搜索流畅阅读。安装后在扩展列表中打开流畅阅读菜单，再点击网页翻译。手机可通过菜单或悬浮球操作。iPhone/iPad 上的 Edge 是否支持扩展，请以浏览器提供的功能为准。

其他安装方式：[油猴脚本](/guide/userscript) · [Thunderbird 邮件翻译](/guide/thunderbird)。

</details>

## 固定扩展图标

将流畅阅读图标固定到工具栏后即可随时打开扩展菜单。

在 Chrome 中：

1. 点击地址栏右侧的 **扩展程序** 图标，形状像一块拼图。
2. 在列表中找到 **流畅阅读**，点击右侧的固定图标。
3. 工具栏中出现流畅阅读图标后，点击它即可打开扩展菜单。

其他浏览器的工具栏菜单可能使用不同的名称。安装前已经打开的网页需要刷新后才能使用扩展。

<GuideVisual kind="pin" />

扩展菜单左上角的品牌图标可以点击，在新标签页打开[流畅阅读官网](https://read.thinkstu.com)。鼠标悬停或键盘聚焦时，图标会轻轻摇摆一次；关闭界面动画或启用系统的减少动态效果后保持静止。

## 翻译网页

1. 打开一篇外语文章，例如新闻或博客。浏览器设置页和扩展商店不支持翻译。
2. 点击工具栏中的流畅阅读图标。首次使用时，点击 **设置界面语言 / Set interface language**，选择语言并点击 **确认 / Confirm**。
3. 在主菜单中确认目标语言。源语言可保留 **自动检测**，翻译服务可保留默认的 **免费翻译服务**。
4. 点击 **翻译当前网页**，译文会显示在原文下方。向下滚动即可继续阅读。

免费翻译服务可以直接使用。界面语言用于显示按钮和设置名称，目标语言用于翻译网页内容，两者可以分别选择。

确认界面语言后，请等待保存完成再继续。保存失败时会显示提示，可以重试；设置中的界面语言也遵循这一保存流程。

<GuideVisual kind="first-translation" />

需要回到原文时，打开扩展菜单并点击 **恢复当前网页**。更换目标语言或服务后，请先恢复原文再重新翻译。

## 划词翻译

点击扩展菜单中的 **划词翻译** 卡片并在弹出的设置面板中开启开关。然后用鼠标选中一个单词或句子。点击选中文字旁的流畅阅读图标，即可查看译文。

<GuideVisual kind="selection" />

查词、朗读和句子讲解的详细用法见[划词翻译](/guide/deepseek-harness)。

## 悬浮段落翻译

点击扩展菜单中的 **鼠标悬停翻译** 卡片并确认 **默认悬浮快捷键** 已开启。将鼠标停在需要翻译的段落上并按下 **Control**，译文就会显示在这一段下方。再次按下 **Control** 可以恢复原文。

<GuideVisual kind="hover" />

触发方式和快捷键可以修改，详见[悬浮段落翻译](/guide/hover-translation)。

## 常见问题

如果点击翻译后没有变化，请确认扩展已开启，并刷新普通网页后重试。免费服务繁忙时可以稍后再试，或[切换翻译服务](/config/translation-engines)。其他问题见[常见问题](/guide/faq)。

## 相关文档

- [网页翻译](/guide/webpage-translation)
- [译文外观与阅读辅助](/config/appearance)
- [翻译服务](/config/translation-engines)

移动设备与 Safari 的安装、更新、触摸操作及视频全屏限制，参见[移动端与 Safari](./mobile-safari)。
