---
title: 离线下载与安装
description: Chrome 商店无法访问时，通过 CRX搜搜或官方 ZIP 包安装流畅阅读。
---

# 离线下载与安装

Chrome 商店打不开时，可以从 **[GitHub 官方发布页](https://github.com/FluentRead/FluentRead/releases/latest)** 下载最新正式版的 ZIP 包，在桌面 Chrome / Edge 中手动安装。也可以使用 **[CRX搜搜（国内可用）](https://www.crxsoso.com/webstore/detail/djnlaiohfaaifbibleebjggkghlmcpcj)**。

## 通过 CRX搜搜获取

打开 [流畅阅读在 CRX搜搜的页面](https://www.crxsoso.com/webstore/detail/djnlaiohfaaifbibleebjggkghlmcpcj)，按网站提供的安装或下载说明操作。

CRX搜搜是第三方分发网站，版本同步时间可能与官方商店不同。下载前查看页面标出的版本号。

## 下载官方离线包

打开 [GitHub 官方发布页](https://github.com/FluentRead/FluentRead/releases/latest)，这个地址会跳转到最新正式版。安装包和版本信息以发布页为准。

在发布说明下方展开 **Assets**，Chrome 选择 **`-chrome.zip`**，Edge 优先选择 **`-edge.zip`**；旧版本没有 Edge 专用包时可使用 Chrome 包。如需校验文件，也可以在同一版本的 Assets 中下载 **`SHA256SUMS.txt`**。

Chrome 离线安装包 **`-chrome.zip`** 保留公开公钥，扩展 ID 固定为 `djnlaiohfaaifbibleebjggkghlmcpcj`，与 Google Drive 同步客户端一致。**`-chrome-store.zip`** 专门用于 Chrome 商店上传，不含公钥；请勿用它离线安装，否则浏览器可能生成另一个扩展 ID，导致重复安装和 Google 同步报错。

开发者运行 `pnpm zip` 会同时生成这两个包；`pnpm build` 生成的 `.output/chrome-mv3` 也保留固定 ID。发行前可运行 `pnpm verify:extension-manifests -- --require-chrome-archive --require-firefox-archives` 分别校验离线包和商店包。

**`-sources.zip`** 和 GitHub 自动生成的 **Source code** 是源码包，不能直接安装。

GitHub 下载仍受网络环境影响；无法下载时，可以尝试上面的 CRX搜搜入口。离线安装指下载后不需要访问 Chrome 商店即可安装，在线翻译仍需要连接所选服务。

## 安装到 Chrome / Edge

1. 将 ZIP 包解压到一个准备长期保留的文件夹。
2. 在地址栏输入 **`chrome://extensions`**；Edge 用户输入 **`edge://extensions`**。
3. 开启 **开发者模式**，点击 **加载已解压的扩展程序**。
4. 选择解压后直接包含 **`manifest.json`** 的文件夹。不要选择 ZIP 文件或外层目录。
5. 将流畅阅读固定到工具栏，刷新已打开的普通网页，再开始翻译。

浏览器内部地址需要复制到地址栏打开，不能由普通网页直接跳转。加载后不要删除或移动解压目录。

## 更新离线安装的版本

离线安装的扩展不会随商店版本自动更新。更新前，先在流畅阅读设置的 **备份与同步** 中导出配置。

从 [GitHub 官方发布页](https://github.com/FluentRead/FluentRead/releases/latest) 下载新版 Chrome ZIP 包，将内容解压覆盖到原安装目录，再回到扩展管理页点击流畅阅读的 **重新加载**。刷新需要翻译的网页。使用同一目录更新，避免另装一份而出现重复翻译；操作前保留原目录的备份。

不要把拖入新 ZIP 当作更新步骤：浏览器会重新解压安装，名称和版本号相同也不保证覆盖。商店安装的版本请通过商店更新；公钥只保持身份，不能保证手动包能替换商店安装。

若已经出现两个流畅阅读，先停用新出现的那份，保留原 ID 的扩展和数据。分别导出需要保留的数据，再检查安装包是否为 `-chrome.zip`。如果旧离线包没有公钥、ID 已经不同，恢复固定 ID 会切换存储身份，需要先备份，再在正确版本中导入；不要先卸载唯一保存完整数据的版本。

安装完成后，请参照[快速开始](/guide/getting-started)固定图标并翻译网页。
