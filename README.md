# 流畅阅读 <img src="./public/icon/192.png" alt="流畅阅读" style="width:1em;" />

> Fluent Read，基于母语般的阅读体验，[B站视频介绍](https://www.bilibili.com/video/BV1ux4y1e73x)。

中文 | [English](https://github.com/Bistutu/FluentRead/blob/main/misc/README_EN.md)

流畅阅读是一款高效的浏览器翻译插件，可以将网页上的文字翻译成其他语言，方便、快捷、直观，支持人工智能引擎。

插件提供「仅译文模式」和「双语模式」，让用户根据需求自由选择适合的翻译方式。
<kbd><img src="./misc/sample-git-1.gif" alt="sample-git-1.gif" style="width: 80%; max-width: 100%;border: 1px solid black;border-radius: 8px;box-shadow: 0 2px 4px rgba(0,0,0,0.1);"></kbd>

<kbd><img src="./misc/sample-git-4.gif" alt="sample-git-4.gif" style="width: 80%; max-width: 100%;border: 1px solid black;border-radius: 8px;box-shadow: 0 2px 4px rgba(0,0,0,0.1);"></kbd>

<kbd><img src="./misc/screenshot-3.png" alt="sample-git-1.gif" style="width: 40%; max-width: 100%;border: 1px solid black;border-radius: 8px;box-shadow: 0 2px 4px rgba(0,0,0,0.1);"></kbd>

# 特点介绍

1. **支持多种翻译方式**

   - 仅译文模式
   - 双语模式

2. **支持多种翻译引擎**

   微软翻译、谷歌翻译、DeepL翻译、小牛翻译、OpenAI、DeepSeek、Kimi、字节豆包、腾讯混元、SiliconCloud、OpenRouter、智谱清言、通义千问、文心一言、百川智能、零一万物、MiniMax、无向芯穹、Claude、Gemini、⭐️自定义引擎等。

3. **支持多种快捷方式**

   1. 快捷键翻译：将鼠标悬停在文本上，按下指定的快捷键即可翻译。支持的快捷键包括 Ctrl、Alt、Shift 和波浪号键。
   2. 鼠标翻译：**双击鼠标**、**长按鼠标**、**鼠标滚轮单击**可触发翻译。
   3. 滑动翻译：按住快捷键的同时，滑动鼠标到需要翻译的文本区域，即可完成翻译。

4. **支持缓存与回译**

   为避免重复翻译句子并减少请求次数，流畅阅读对每个页面实现了翻译缓存。您无需关注具体细节，翻译状态通过颜色区分：蓝色表示正常翻译，绿色表示使用缓存。当使用缓存时，插件不会发起网络请求。

   <kbd><img src="./misc/sample-git-3.gif" alt="sample-git-1.gif" style="width: 80%; max-width: 100%;border: 1px solid black;border-radius: 8px;box-shadow: 0 2px 4px rgba(0,0,0,0.1);"></kbd>

   将鼠标悬停在已翻译文本上，并按下快捷键，即可启用**回译功能**。

   <kbd><img src="./misc/sample-git-2.gif" alt="sample-git-1.gif" style="width: 70%; max-width: 100%;border: 1px solid black;border-radius: 8px;box-shadow: 0 2px 4px rgba(0,0,0,0.1);"></kbd>

# 安装指南

> 插件已成功上架各大主流浏览器的应用商店，可以通过以下链接直接安装：

- **Chrome 浏览器**：[点击安装](https://chromewebstore.google.com/detail/流畅阅读/djnlaiohfaaifbibleebjggkghlmcpcj?hl=zh-CN&authuser=0)|[备用链接](https://www.crxsoso.com/webstore/detail/djnlaiohfaaifbibleebjggkghlmcpcj)
- **Edge 浏览器**：[点击安装](https://microsoftedge.microsoft.com/addons/detail/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB/kakgmllfpjldjhcnkghpplmlbnmcoflp?hl=zh-CN)
- **Firefox 浏览器**：[点击安装](https://addons.mozilla.org/zh-CN/firefox/addon/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB/?utm_source=addons.mozilla.org&utm_medium=referral&utm_content=search)
- **其他浏览器**：[点击安装](https://www.crxsoso.com/webstore/detail/djnlaiohfaaifbibleebjggkghlmcpcj)

> 如果直接安装失败，你还可以通过下载插件的压缩包手动安装，具体步骤如下：

1. 打开浏览器的扩展程序管理页面
2. 启用“开发者模式”
3. 将下载的压缩包拖入浏览器窗口完成安装

<img src="./misc/screenshot-1.png" alt="sample-git-1.gif" style="width: 45%; max-width: 100%;border: 1px solid black;margin: 5px;border-radius: 8px;box-shadow: 0 2px 4px rgba(0,0,0,0.1);"><img src="./misc/screenshot-2.png" alt="sample-git-2.gif" style="width: 45%; max-width: 100%;border: 1px solid black;margin: 5px;border-radius: 8px;box-shadow: 0 2px 4px rgba(0,0,0,0.1);">

> 手机如何安装？

手机版目前只支持使用**油猴插件**进行安装，油猴脚本相对于正式版本有更新延迟，安装方式如下：

1. 在手机浏览器中安装 [油猴插件](https://www.tampermonkey.net)
2. 在油猴中安装 [流畅阅读](https://greasyfork.org/zh-CN/scripts/482986-%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB) 插件

# 常见问题解答

1. 我该如何获取 token？

   请直接在浏览器中进行搜索，如：DeepSeek API。

2. 我的 token 安全吗？

   你的 Token 将被安全地存储在浏览器本地，确保数据隐私。流畅阅读不会访问或收集您的任何 Token，软件代码完全开源，接受审查。

3. 我的翻译数据安全吗？

   流畅阅读会将您的所有翻译请求直接转发至「翻译服务提供商」，没有任何人可以获取你们之间的记录。

4. 为什么翻译的内容不准确？

   翻译质量取决于模型，可以更换其他 AI 模型进行尝试。

5. 这款软件如何盈利？

   软件开源，没有任何盈利的地方；如果你觉得软件给你带来了超过100元的价值，可以在扫描下面的赞赏码赞助1元给开发者。

6. 有没有**免费**的 AI 模型可以使用？

   截至2025年1月，以下 AI 模型官方声明可免费使用。详细信息请参阅对应的官方文档：

   - 智谱：GLM-4-Flash
   - SiliconCloud：Qwen2.5-7B-Instruct、Meta-Llama-3.1-8B-Instruct 等
   - Graq：llama-3.1-8b-instant、gemma2-9b-it、mixtral-8x7b-32768等
   - OpenRouter：meta-llama/llama-3.1-8b-instruct、google/gemini-2.0-flash-exp 等

# 开源许可证

[GPL-3.0 license](https://github.com/Bistutu/FluentRead#)

# 如何运行程序？

```shell
git clone https://github.com/Bistutu/FluentRead.git
cd ./FluentRead
pnpm install && pnpm dev
```

```shell
# 打包为支持 Chromium 内核的插件
pnpm zip
# 打包为支持 FireFox 内核的插件
pnpm zip:firefox
```

# Star 历史记录

[![Star History Chart](https://api.star-history.com/svg?repos=Bistutu/FluentRead&type=Date)](https://star-history.com/#Bistutu/FluentRead&Date)

# 赞赏码

如果你觉得软件给你带来了超过100元的价值，可以在扫描下面的赞赏码赞助1元给开发者，我将会在下方展示赞助金额排名前十的支持者。

<img src="https://oss.thinkstu.com/typora/202406102143926.jpg?x-oss-process=style/optimize" alt="wechat" style="width: 40%; max-width: 100%; border: 2px solid #000; border-radius: 8px; padding: 10px;">

| 序号 |       🌼赞助者🌼        | 赞助金额 |
| :--: |:--------------------:| :------: |
|  1   |         TOO          |   100    |
| 2 | 匿名 | 100 |
|  3  |        很酷的小当家        |    57    |
|  4  |       coonut🥥       |    36    |
|  5  |      hoochanlon      | 23.7 |
| 6 | Juncai（公众号“译观”） | 20 |
| 7 | 第三个火枪手 | 20 |
| 8 |        一懒众山小.        |    18    |
| 9 |          嘴馋          |    17    |
| 10 |      听说海能吞掉鱼的眼泪      |    17    |
| … |          …           |    …     |





























