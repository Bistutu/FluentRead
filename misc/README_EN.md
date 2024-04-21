# Fluent Read <img src="../public/icon/192.png" alt="Fluent Read" style="width:1em;" />

> Fluent Read, designed for a native-like reading experience. [Introduction video on Bilibili](https://www.bilibili.com/video/BV1ux4y1e73x).

[中文](https://github.com/Bistutu/FluentRead) | English

Fluent Read is a highly efficient browser translation plugin that can translate text on web pages into any language. It is convenient, fast, and intuitive, and is powered by an artificial intelligence engine.

Fluent Read is written using TypeScript + [Vue3](https://cn.vuejs.org/) + [Element-Plus](https://element-plus.org/) + [WXT](https://wxt.dev/) frameworks, and supports compilation into plugins installable on most browsers.

<kbd><img src="../misc/sample-git-1.gif" alt="sample-git-1.gif" style="width: 80%; max-width: 100%;border: 1px solid black;"></kbd>

<kbd><img src="../misc/screenshot-3.png" alt="sample-git-1.gif" style="width: 40%; max-width: 100%;border: 1px solid black;"></kbd>

# Installation Guide

> The plugin is available on major browser stores. You can install it directly using the following links:

- **Chrome Browser**: [Direct Install](https://chromewebstore.google.com/detail/FluentRead/djnlaiohfaaifbibleebjggkghlmcpcj?hl=zh-CN&authuser=0), [Alternative Link](https://www.crxsoso.com/webstore/detail/djnlaiohfaaifbibleebjggkghlmcpcj)
- **Edge Browser**: [Direct Install](https://microsoftedge.microsoft.com/addons/detail/FluentRead/kakgmllfpjldjhcnkghpplmlbnmcoflp?hl=zh-CN), [Alternative Link](https://www.crxsoso.com/webstore/detail/djnlaiohfaaifbibleebjggkghlmcpcj)
- **Firefox Browser**: [Direct Install](https://addons.mozilla.org/zh-CN/firefox/addon/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB/?utm_source=addons.mozilla.org&utm_medium=referral&utm_content=search), [Alternative Link](https://www.crxsoso.com/firefox/detail/流畅阅读)
- **Other Browsers**: [Alternative Link](https://www.crxsoso.com/webstore/detail/djnlaiohfaaifbibleebjggkghlmcpcj)

If direct installation fails, you can download the plugin's ZIP file, open your browser's **Manage Extensions Window**, activate developer mode, and drag the ZIP file into the browser for installation.

<img src="../misc/screenshot-1.png" alt="sample-git-1.gif" style="width: 45%; max-width: 100%;border: 1px solid black;"><img src="../misc/screenshot-2.png" alt="sample-git-2.gif" style="width: 45%; max-width: 100%;border: 1px solid black;">

# Features

1. Multiple translation methods:
   - Key shortcut translation: Hover the mouse over the text and press the designated shortcut key to translate.
   - Slide translation: Hold down the shortcut key and slide the mouse to select the text area you want to translate.

2. Supports caching and back translation:
   - To avoid re-translating sentences and reduce request counts, Fluent Read caches translations on each page. You don't need to worry about the details (blue indicates normal translation, green indicates cached translation). When using cached translations, no network request occurs.
   
     <kbd><img src="../misc/sample-git-3.gif" alt="sample-git-1.gif" style="width: 80%; max-width: 100%;border: 1px solid black;"></kbd>
   
   - Hovering the mouse over translated text and pressing the shortcut key triggers the **back translation feature**.
   
     <kbd><img src="../misc/sample-git-2.gif" alt="sample-git-1.gif" style="width: 70%; max-width: 100%;border: 1px solid black;"></kbd>

# FAQ

<details>
    <summary>1. How do I obtain a token?</summary>
    If you want to get a token for translation services, it's recommended to search on Baidu or Google with keywords like <code>model name + API</code>.
</details>
<details>
    <summary>2. Can someone steal my token?</summary>
    No. Fluent Read stores all your tokens locally in the browser, so no third party, including us, can steal your token data.
</details>
<details>
  <summary>3. Can my data be intercepted by others?</summary>
  No. Fluent Read does not collect your data. All your translation requests are directly forwarded to the translation service provider, so no intermediary can access your translation records.
</details>
<details>
    <summary>4. Why might the translation be inaccurate?</summary>
    There are many reasons why translations might be inaccurate. First, the translation engine might not fully understand the context and subtle language nuances of the original text. Secondly, different languages have different grammatical structures and expressions, which can make it difficult to retain the full meaning of the original text when translated directly. <strong>It is suggested to try other models.</strong>
</details>

# Version History

- 2024-04-01: Program restructured using Vue3 + WXT, released version 0.01.
- 2024-03-04: Version update 1.30
    1. Added [DeepL](https://deepl.com/zh/) translation service.
    1. Added [ollama](https://github.com/ollama/ollama) local large model support.
    1. Made compatible with mobile devices, implementing "three-finger touch" translation.
    1. Optimized caching logic.

- 2024-02-18: Version 1.0 released.
  1. Integrated Microsoft machine translation.
  2. Integrated OpenAI, Zhipu Qingyan, moonshot, and other AI engines.
  3. Added shortcut key translation feature.
  4. Added translation caching and back translation feature.
- 2024-01: Version 0.6 released.
- ...
- 2023-12: Version 0.1 released.

# Open Source License

[GPL-3.0 license](https://github.com/Bistutu/FluentRead#)

# How to Run the Program?

```shell
git clone https://github.com/Bistutu/FluentRead.git
cd ./FluentRead
pnpm install && pnpm dev
```

```shell
# Package for Chromium-based browsers
pnpm zip
# Package for Firefox-based browsers
pnpm zip:firefox
```

# Star History Chart

[![Star History Chart](https://api.star-history.com/svg?repos=Bistutu/FluentRead&type=Date)](https://star-history.com/#Bistutu/FluentRead&Date)

# Appreciation Code

If you wish to encourage the author, please use WeChat to scan the QR code below, and your name will appear on the list of sponsors.

<img src="../misc/approve.jpg" alt="wechat" style="width: 35%; max-width: 100%;border: 1px solid black;">


| No. |      🌼 Sponsor 🌼      |   Amount Sponsore   |
| :--: |:-------------------:|:-------------------:|
|  1   |         TOO          |         100         |
|  2   |    Cool Little Master    |         57          |
|  3   |       coonut🥥       |         36          |
|  4   |      hoochanlon      |        23.7         |
|  5   |    Lazy Mountain Small    |         18          |
|  6   |        Mouth Craving       |         17          |
|  7   |   Heard the Sea Can Swallow Tears  |         17          |
|  8   |         Soup Qing         |         6.6         |
|  9   |   Sincerely Less Than Half a Jin   |          5          |
|  10  |          …           |          …          |