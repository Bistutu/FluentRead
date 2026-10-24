# Zotero literature translation

FluentRead provides an experimental Zotero desktop plugin. Translate PDFs from your library, translate selected text while reading, and save the results as new attachments under the same literature item or as bilingual notes. The compatibility manifest targets Zotero 7–10; Zotero 7 compatibility has not been tested separately.

## Install

Install and configure this plugin separately from the browser extension. It currently requires a source build: run `pnpm build:zotero` in the FluentRead repository root to generate `integrations/zotero/dist/fluentread-zotero.xpi`.

In Zotero, open **Tools → Plugins**, click the gear menu, choose **Install Plugin From File**, and select the XPI. The plugin is not yet listed in Zotero's plugin directory.

Full-document translation, saving Chinese PDF results, bilingual notes, and task recovery have been verified in an isolated test library using Zotero 10.0.6 on macOS. The full-document workflow used a controlled translation service; a separate fixed public sentence verified a real Chinese response from Microsoft Translator. Zotero 7–9, Windows/Linux, and the semantic quality of complete papers translated by real services have not been tested. Use a test library first.

The current package is for local testing and has not been published to an automatic update channel.

## Configure translation

Open the FluentRead workspace and select the source language, target language, and service. By default, the plugin detects the source language automatically and translates into Simplified Chinese.

- **Microsoft Translator** uses FluentRead's existing Microsoft translation service without requiring a model API key.
- **OpenAI-compatible services** require a Chat Completions endpoint, model, and API key. Remote endpoints use HTTPS; local models can use an HTTP loopback address.
- **Terminology** lets you specify consistent translations for terms in the current document.
- **Output** lets you choose a bilingual or translation-only PDF and whether to open the result automatically when finished.

The plugin stores its own settings and does not read or synchronize the browser extension's keys.

## Translate and continue reading

Select one or more literature items with local PDFs in your Zotero library, or select PDF attachments directly, then add them to the translation queue from the FluentRead menu.

The workspace shows progress for each document. Files are processed sequentially. Pausing preserves completed translations, and continuing processes the remaining passages. Failed tasks can be retried. After closing or disabling the plugin, unfinished tasks return in a paused state; new translation requests are sent only when you continue. Changing the source language, target language, or service affects new tasks; existing tasks retain the settings used when they were created.

Before continuing, the plugin checks the attachment's identity and file contents. If the original PDF has changed, create a new task to avoid applying old translations to a different document.

When translation finishes, the translated PDF is saved as a new attachment under the original literature item, preserving the original file. Results for standalone PDFs stay in the original library and collections. Task actions can also save the original text and translation as bilingual notes organized by page. Clearing task records does not delete PDFs or notes that have already been created.

Select text in Zotero's PDF reader and use the FluentRead selection action to translate it. This action uses the same service and language settings as document translation in the plugin.

## Files and data

The plugin currently supports PDFs with a text layer. Scanned documents need an OCR text layer first; the plugin does not include OCR for scans. It does not support EPUB, Zotero's web library, or mobile apps. The layout and page count of translated PDFs may differ from the original. Highlights and annotations on the original file are not automatically transferred to the translation.

PDFs are parsed and generated locally. When you start translation, the text to translate and necessary translation instructions are sent to the selected service, with terminology handled according to your glossary. The complete PDF is not uploaded to FluentRead's cloud. The plugin does not collect telemetry.

Settings, tasks, and translation progress are stored in `fluentread/` within the current Zotero profile directory. API keys are stored in a separate local `credentials.json` file and are not included in task records or notes. This file is not an encrypted credential store.

PDF.js runtime resources are bundled with the installation package. The first export may download about 5 MB of openly licensed font data. Its size and SHA-256 are verified before it is stored in the local font cache and reused for later exports. The download request contains no document text, translations, or keys.

Results cannot be saved to read-only libraries. If a PDF cannot be found, download the attachment in Zotero or locate its file again first.

See the [Zotero plugin directory](https://github.com/Bistutu/FluentRead/tree/main/integrations/zotero) for source code, build instructions, and implementation boundaries.
