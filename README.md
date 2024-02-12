# 流畅阅读

> Fluent Read，基于母语般的阅读体验
>

拥有基于上下文语境的人工智能翻译引擎，为网站提供更加友好的翻译，让所有人都能够拥有基于母语般的阅读体验。

<img src="./misc/images/sample-git-1.gif" alt="sample-git-1.gif" style="width: 80%; max-width: 100%;">

# 安装指南

1. 在浏览器中安装 [油猴插件](https://www.tampermonkey.net)（如已安装则跳过）
2. 在油猴中安装 [流畅阅读](https://greasyfork.org/zh-CN/scripts/482986-%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB) 插件

# 如何使用？

1. 打开油猴插件，**配置**你想要的翻译服务（如果选择 AI 翻译则需要填写 `token`）。

   <img src="./misc/images/sample-git-3.gif" alt="sample-git-1.gif" style="width: 90%; max-width: 100%;">

2. 翻译功能

   流畅阅读提供了 2 种翻译方式，分别为：

   - 将鼠标悬浮在想要翻译的文本上面，按下快捷键进行翻译。
   - 持续按住快捷键，鼠标滑动至文本进行翻译。

3. 缓存与回译功能

   为了避免 AI 模型重复翻译句子，流畅阅读基于每个页面做了缓存，你无需关心具体细节（蓝色表示正常翻译、绿色表示使用缓存）。

   <div id="spinnerContainer" style="border: 3px solid #f3f3f3;border-top: 4px solid blue;border-radius: 50%;width: 12px;height: 12px;animation: spin 1s linear infinite;display: inline-block;"></div>&emsp;&emsp;<div id="spinnerContainer" style="border: 3px solid #f3f3f3;border-top: 3px solid green;border-radius: 50%;width: 12px;height: 12px;animation: spin 1s linear infinite;display: inline-block;"></div>

   当你将鼠标悬浮在已翻译的文本上时，会触发“回译”功能。

   <img src="./misc/images/sample-git-2.gif" alt="sample-git-1.gif" style="width: 70%; max-width: 100%;">

4. 部分网站定制化翻译功能

   由于部分网站属于“较常”访问的站点，流畅阅读在编写时考虑到了这些场景，因此针对部分网站做了专门的翻译，这些站点包括但不限于：

   [OpenAI官网](https://openai.com/)、[Docker仓库](https://hub.docker.com)、[Maven仓库](https://mvnrepository.com/)、[Stackoverflow](https://stackoverflow.com/)、[GitHub Star 趋势生成网](https://star-history.com/)、[coze人工智能助手](https://www.coze.com)

# star 历史记录

[![Star History Chart](https://api.star-history.com/svg?repos=Bistutu/FluentRead&type=Date)](https://star-history.com/#520250/FluentRead&Date)

# 版本更新记录

- 2024-02-18：1.0版本发布。
  1. 接入微软、谷歌机器翻译
  2. 接入 openAI、智谱清言、文心一言、通义千问、moonshot 人工智能引擎
  3. 增加鼠标快捷键操作
  4. 增加翻译缓存与回译功能
- 2024-01：0.6版本发布，增加讯飞翻译引擎
- ...
- 2023-12：0.1版本发布

# 开源许可证

[GPL-3.0 license](https://github.com/Bistutu/FluentRead#)



