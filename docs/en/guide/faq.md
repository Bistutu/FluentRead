---
outline: false
---

# Troubleshooting

Check that FluentRead is on, use a normal webpage, and refresh once. Expand the symptom that matches your problem.

<details class="guide-details">
<summary>Where are local translation models stored? Are they cleared on uninstall?</summary>

## Where are local translation models stored? Are they cleared on uninstall?

Models downloaded through FluentRead’s Local model translation settings are stored in the extension’s local cache in the current browser. Hover over or focus the ⓘ icon inside the download button’s border for storage and removal details.

Uninstalling the extension normally makes the browser automatically clear its storage, including downloaded models and related caches. Disabling the extension keeps this data. You can also delete a model while keeping the extension. Chrome manages its own built-in translation language packs; manually downloaded extension archives or unpacked folders must be removed separately.

</details>

<details class="guide-details">
<summary>Do local models reload on every request or stay in memory forever?</summary>

## Do local models reload on every request or stay in memory forever?

Downloaded model files and models loaded into memory have separate lifetimes. Local translation, speech synthesis, video transcription, and ordinary image OCR reuse their loaded model or worker. After work finishes, they remain available for 60 seconds on devices reporting up to 4 GB of memory, 3 minutes on other devices with known memory, or 2 minutes when memory information is unavailable. New work restarts the idle window. Active and queued work is protected from idle cleanup.

Modern Chrome translation reuses a language detector and sessions for up to two translation language pairs. Older experimental APIs still release each session after use. Model changes, cancellation of running requests, timeouts, model removal, and extension runtime page exit trigger cleanup according to each feature's lifecycle. Manga OCR, inpainting, and smart highlighting already have their own 3-minute idle cleanup. Releasing runtime memory keeps downloaded model files available for the next local load.

These defaults balance responsiveness and memory; they do not impose a hard RAM or GPU-memory limit. Multiple features can retain models at the same time. Chrome controls the final residency of its own model weights, while external local services manage their own model lifetimes. [Ollama keeps models loaded for 5 minutes by default](https://docs.ollama.com/faq#how-do-i-keep-a-model-loaded-in-memory-or-make-it-unload-immediately); its server's `OLLAMA_KEEP_ALIVE` setting can change this.

</details>

<details class="guide-details">
<summary>Page translation does nothing</summary>

## Page translation does nothing

Refresh the page after installation or an update. Check that FluentRead is enabled and the target language is correct. Browser settings and extension store pages cannot be translated; try a regular article.

Check the connection in service settings. If the free service is busy, retry later or choose another provider.

</details>

<details class="guide-details">
<summary>Only part of the page is translated</summary>

## Only part of the page is translated

The default mode translates as you read. Scroll down, or change the full-page range to process everything at once. For missing menus or unusual layouts, see [Website reading area](/en/config/site-adaptation). Use image or area translation for text drawn in pictures.

</details>

<details class="guide-details">
<summary>Why does Japanese appear in a Chinese translation?</summary>

## Why does Japanese appear in a Chinese translation?

A provider can occasionally return a paragraph in the wrong language. When a result is clearly a full Japanese paragraph, Free Translation tries another enabled provider. A provider selected directly gets one retry. If it still returns the wrong language, FluentRead reports a failure instead of displaying or caching that result. Short Japanese names, terms, and quotations within Chinese text remain allowed.

If mixed languages still appear, check the target language, restore the page, and retry. Include the selected provider, extension version, and a redacted screenshot when reporting it.

</details>

<details class="guide-details">
<summary>How do I restore the original?</summary>

## How do I restore the original?

Open the extension menu and choose restore original. Restore before retrying with a different language, service, or display setting.

</details>

<details class="guide-details">
<summary>Selection works, but whole-page translation fails</summary>

## Selection works, but whole-page translation fails

The page may not be recognized correctly, or too many requests may be reaching a busy service. Try one paragraph, then check page recognition and the connection.

</details>

<details class="guide-details">
<summary>Can webmail messages be translated?</summary>

## Can webmail messages be translated?

FluentRead has a dedicated message-frame path for legacy QQ Mail and the JS6 reading pages of NetEase 163, 126, and yeah free mail. Open an individual message and try page or selection translation; refresh the mailbox if needed. Compose editors are excluded. Mailbox versions can use different layouts. If it still fails, report the mailbox domain, the page path with `sid` and other parameters removed, the browser version, and a redacted screenshot. Do not share a full message or login details.

</details>

<details class="guide-details">
<summary>Why is there no AI explanation?</summary>

## Why is there no AI explanation?

Regular selection translation gives a translation. The [reading card](/en/guide/deepseek-harness) must be enabled separately with a configured AI service and model. Choose an action after selecting text to start it.

</details>

<details class="guide-details">
<summary>Image translation is still preparing</summary>

## Image translation is still preparing

First use needs recognition language packs. Follow the download prompt and check that the source language matches. Use a clear image or a smaller area if recognition fails.

</details>

<details class="guide-details">
<summary>No subtitles appeared</summary>

## No subtitles appeared

Check that video translation is enabled and the video has subtitles. X AI transcription requires a downloaded model, and some videos cannot be read. See [Video subtitles](/en/guide/video-subtitles).

</details>

<details class="guide-details">
<summary>Where does my API key go?</summary>

## Where does my API key go?

Enter it in the corresponding service’s connection settings. Check address, key, model, and allowance. Web chat memberships may not include API use. For Ollama, confirm the local server is running and the model is downloaded. See [Translation services](/en/config/translation-engines).

</details>

<details class="guide-details">
<summary>Duplicate translations or broken layout</summary>

## Duplicate translations or broken layout

Restore the original. Check whether another extension or the browser’s own translation is active, then try with one translator. If the issue remains, record the URL and steps.

</details>

<details class="guide-details">
<summary>Why do translations disappear when Font Rendering is enabled?</summary>

## Why do translations disappear when Font Rendering is enabled?

Some older FluentRead versions mistake Font Rendering's bold-correction markers for rewritten translations and remove the translation after repeated repair attempts. The compatibility fix preserves these font markers while still checking actual content and structure changes. Update to a version containing the fix and reload the page. Until your store version includes it, temporarily disable bold correction in the font script.

</details>

<details class="guide-details">
<summary>Can I import an older backup?</summary>

## Can I import an older backup?

Older configuration JSON files and full backups are supported through backup and restore in settings. Fields introduced after a backup was created receive compatible defaults, and existing API keys are migrated.

If you see an invalid exact credential snapshot error, keep the original file. Some versions incorrectly required a newly introduced credential field in older backups; this compatibility issue has been fixed. If it persists after updating, report your extension version and the error message without sharing the full backup.

</details>

## Still need help?

Open a [GitHub issue](https://github.com/FluentRead/FluentRead/issues) with browser and extension versions, a public URL, reproduction steps, and a redacted screenshot. Do not include keys, cookies, account details, or private text.
