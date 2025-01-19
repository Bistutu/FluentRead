# Fluent Read <img src="../public/icon/192.png" alt="Fluent Read" style="width:1em;" />

> Fluent Read provides a native-like reading experience for translations. [Bilibili Video Introduction (Chinese)](https://www.bilibili.com/video/BV1ux4y1e73x).

[中文](https://github.com/Bistutu/FluentRead/blob/main/README.md) | English

Fluent Read is an efficient browser translation extension that helps translate text on web pages into other languages with convenience and clarity. It also supports various AI translation engines.

The extension provides two translation modes: **Translation-Only Mode** and **Bilingual Mode**. Users can choose whichever mode suits their needs.

<kbd><img src=".//sample-git-1.gif" alt="sample-git-1.gif" style="width: 80%; max-width: 100%;border: 1px solid black;"></kbd>

<kbd><img src=".//sample-git-4.gif" alt="sample-git-4.gif" style="width: 80%; max-width: 100%;border: 1px solid black;"></kbd>

<kbd><img src=".//screenshot-3.png" alt="sample-git-1.gif" style="width: 40%; max-width: 100%;border: 1px solid black;"></kbd>

## Features

1. **Multiple Translation Modes**
   - Translation-Only Mode  
   - Bilingual Mode  

2. **Multiple Translation Engines Supported**  
   Microsoft Translator, Google Translate, DeepL, NiuTrans, OpenAI, DeepSeek, Kimi, Byte Doubao, Tencent Hunyuan, SiliconCloud, OpenRouter, ChatGLM (Zhipu), Tongyi Qianwen, Wenxin Yiyan, Baichuan, ZeroOne, MiniMax, Wuxiang XinQiong, Claude, Gemini, and ⭐️Custom Engines, etc.

3. **Various Shortcut Options**
   1. **Keyboard Shortcuts**: Hover over the text and press the specified key to translate (supports Ctrl, Alt, Shift, and ~).
   2. **Mouse Actions**: Trigger translation by **double-click**, **long-press**, or **middle-click**.
   3. **Swipe Translation**: Hold the shortcut key and swipe the mouse over any text you want to translate.

4. **Supports Caching & Back-Translation**
   - To avoid translating the same sentence repeatedly and reduce requests, Fluent Read caches translations on each page. The translation status is color-coded: **blue** for normal translations and **green** when retrieved from cache. When using the cache, no network request is made.
   - **Back-Translation**: Hover over a piece of translated text and press the shortcut key again to display the back-translation.

<kbd><img src=".//sample-git-3.gif" alt="sample-git-1.gif" style="width: 80%; max-width: 100%;border: 1px solid black;"></kbd>

<kbd><img src=".//sample-git-2.gif" alt="sample-git-1.gif" style="width: 70%; max-width: 100%;border: 1px solid black;"></kbd>

## Installation Guide

> Fluent Read is already available in major browser app stores. Use the links below to install directly:

- **Chrome**: [Install Here](https://chromewebstore.google.com/detail/流畅阅读/djnlaiohfaaifbibleebjggkghlmcpcj?hl=zh-CN&authuser=0) | [Mirror Link](https://www.crxsoso.com/webstore/detail/djnlaiohfaaifbibleebjggkghlmcpcj)
- **Edge**: [Install Here](https://microsoftedge.microsoft.com/addons/detail/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB/kakgmllfpjldjhcnkghpplmlbnmcoflp?hl=zh-CN)
- **Firefox**: [Install Here](https://addons.mozilla.org/zh-CN/firefox/addon/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB/?utm_source=addons.mozilla.org&utm_medium=referral&utm_content=search)
- **Other Browsers**: [Install Here](https://www.crxsoso.com/webstore/detail/djnlaiohfaaifbibleebjggkghlmcpcj)

> If direct installation fails, you can also manually install by downloading the extension package:

1. Open your browser’s extensions management page.
2. Enable “Developer Mode”.
3. Drag the downloaded package into your browser window to complete the installation.

<img src=".//screenshot-1.png" alt="screenshot-1" style="width: 45%; max-width: 100%;border: 1px solid black;"><img src=".//screenshot-2.png" alt="screenshot-2" style="width: 45%; max-width: 100%;border: 1px solid black;">

> How to install on mobile?

Currently, mobile browsers only support **Tampermonkey** scripts. The Tampermonkey script may lag behind the official release. Steps to install:

1. Install [Tampermonkey](https://www.tampermonkey.net) on your mobile browser.
2. Install the [Fluent Read](https://greasyfork.org/zh-CN/scripts/482986-%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB) script in Tampermonkey.

## FAQ

1. **How do I get a token?**  
   Please search online within your browser, for example: “DeepSeek API”.

2. **Is my token secure?**  
   Your token is securely stored locally in your browser. Fluent Read does not access or collect any of your tokens. The code is fully open-source and open for review.

3. **Is my translation data secure?**  
   Fluent Read forwards all your translation requests directly to the translation service providers. No one else can access your records.

4. **Why are my translations inaccurate?**  
   The translation quality depends on the models. Feel free to try different AI models to get better results.

5. **How does this software make money?**  
   It is open-source and has no revenue model. If you believe it has brought you more than 100 CNY in value, feel free to tip the developer 1 CNY using the donation code below.

6. **Are there any free AI models I can use?**  
   As of January 2025, the following AI models have official statements indicating free usage (refer to their official docs for details):
   - Zhipu: GLM-4-Flash  
   - SiliconCloud: Qwen2.5-7B-Instruct, Meta-Llama-3.1-8B-Instruct, etc.  
   - Graq: llama-3.1-8b-instant, gemma2-9b-it, mixtral-8x7b-32768, etc.  
   - OpenRouter: meta-llama/llama-3.1-8b-instruct, google/gemini-2.0-flash-exp, etc.

## License

[GPL-3.0 license](https://github.com/Bistutu/FluentRead#)

## How to Run

```shell
git clone https://github.com/Bistutu/FluentRead.git
cd ./FluentRead
pnpm install && pnpm dev
```

```shell
# Build a Chromium-compatible extension
pnpm zip
# Build a Firefox-compatible extension
pnpm zip:firefox
```

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Bistutu/FluentRead&type=Date)](https://star-history.com/#Bistutu/FluentRead&Date)

## Donation

If you believe this software has brought you more than 100 CNY in value, you can donate 1 CNY via the QR code below. The top ten donors by amount will be listed here.

<img src="https://oss.thinkstu.com/typora/202406102143926.jpg?x-oss-process=style/optimize" alt="wechat" style="width: 40%; max-width: 100%;border: 1px solid black;">

| Rank |      🌼Donor🌼      | Amount |
| :--: | :----------------: | :----: |
|  1   |        TOO         |  100   |
|  2   |       Anonymous    |  100   |
|  3   |  很酷的小当家 (Cool Chef) |   57   |
|  4   |     coonut🥥      |   36   |
|  5   |    hoochanlon     |  23.7  |
|  6   | Juncai (“译观” on WeChat) |   20   |
|  7   |  第三个火枪手 (The Third Musketeer) |   20   |
|  8   |  一懒众山小. (LazyOne)  |   18   |
|  9   |       嘴馋 (Greedy)      |   17   |
|  10  | 听说海能吞掉鱼的眼泪 (Sea’s Tear) |   17   |
|  …   |         …         |   …    |
