---
title: Offline download & installation
description: Install FluentRead through CRXSOso or the official ZIP package when the Chrome Web Store is unavailable.
---

# Offline download & installation

If the Chrome Web Store does not open, download the latest stable ZIP package from the **[official GitHub release page](https://github.com/FluentRead/FluentRead/releases/latest)** and install it manually in desktop Chrome / Edge. You can also try **[CRXSOso](https://www.crxsoso.com/webstore/detail/djnlaiohfaaifbibleebjggkghlmcpcj)**.

## Get FluentRead through CRXSOso

Open [FluentRead on CRXSOso](https://www.crxsoso.com/webstore/detail/djnlaiohfaaifbibleebjggkghlmcpcj) and follow the website’s installation or download instructions.

CRXSOso is a third-party distribution website. Its version may differ from the official store, so check the version shown before downloading.

## Download the official offline package

Open the [official GitHub release page](https://github.com/FluentRead/FluentRead/releases/latest). This address takes you to the latest stable release. Use that page for current packages and version information.

Expand **Assets** below the release notes. Choose **`-chrome.zip`** for Chrome and **`-edge.zip`** for Edge; older releases without an Edge package can use the Chrome package. For checksums, download **`SHA256SUMS.txt`** from the same release’s Assets.

The Chrome ZIP can also be uploaded to the store and omits the development-only `key` field. Developers who need a stable local extension ID can run `pnpm build` and load `.output/chrome-mv3`, which retains the fixed ID and OAuth configuration. `pnpm zip` removes `key` only from the store ZIP. Before release, run `pnpm verify:extension-manifests -- --require-chrome-archive --require-firefox-archives` to validate the packages.

The **`-sources.zip`** file and GitHub’s automatic **Source code** downloads contain source code and cannot be installed directly.

GitHub downloads still depend on your network. Try CRXSOso above if the download is unavailable. Offline installation means you can install the downloaded package without accessing the Chrome Web Store; online translation still needs a connection to your chosen provider.

## Install in Chrome / Edge

1. Extract the ZIP into a folder you intend to keep.
2. Enter **`chrome://extensions`** in the address bar, or **`edge://extensions`** in Edge.
3. Enable **Developer mode**, then choose **Load unpacked**.
4. Select the extracted folder that directly contains **`manifest.json`**. Do not select the ZIP file or its parent folder.
5. Pin FluentRead to the toolbar and refresh any normal webpages that were already open.

Copy browser internal addresses into the address bar; normal websites cannot link directly to them. Keep the extracted folder in place after installation.

## Update an offline installation

An unpacked extension does not receive store updates automatically. Before updating, export your configuration from **Backup & sync** in FluentRead’s settings.

Download the new Chrome ZIP from the [official GitHub release page](https://github.com/FluentRead/FluentRead/releases/latest) and extract it over the original installation folder, then select FluentRead’s **Reload** button on the extensions page. Refresh webpages you want to translate. Reuse the same folder to avoid duplicate installations and keep a backup of the previous folder before replacing files.

After installation, follow [Quick start](/en/guide/getting-started) to pin FluentRead and translate a webpage.
