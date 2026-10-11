# Image translation

Recognize words in a webpage image and read the translation over it. Enable **Image translation** in settings first.

Under **Image/manga translation**, choose the source language, target language and translation service at the top. Image, manga and area translation then have separate controls. **Controls and cache**, **Recognition resources and downloads**, and **Supported websites** stay collapsed until needed.

Single images use **PaddleOCR (standard model)** by default for ordinary images, screenshots and comic text. You can switch to **Tesseract (lightweight model)**, which uses source-language packs. New installations and configurations with a missing or invalid engine use PaddleOCR; saved engine choices are preserved. PaddleOCR prepares about 30 MB on the first translation and shares existing manga models. Selecting an engine alone starts no download and keeps the ordinary image interface. Changing the engine invalidates older translated-image results. Recognition quality varies by image; compare originals to choose what works for your content.

<GuideVisual kind="image" en />

For ordinary images, nearby wrapped lines with similar sizes and alignment are translated as a complete paragraph. Headings, list items and separate columns are kept apart where possible. Translations wrap within the paragraph area with bounded font sizes and matching alignment. Only the original line boxes are erased, reducing changes to artwork between lines. **Text → Compare original** also presents complete paragraphs. Complex layouts or recognition errors can still affect grouping; switch back to the original to check.

Local layout and background repair now reduce repeated work and memory use for large ordinary images. Translated images use asynchronous lossless PNG encoding, so you can cancel while waiting. Initial model preparation and translation service response times still affect the overall wait.

## Local model failures and controls

Recognition and translation are separate steps. Short words or mixed languages can affect automatic detection, and a local model may only support specific language pairs. Failure messages explain model readiness, language support, browser compatibility, or timeouts. **Adjust local model** opens the model settings; **Change image translation service** opens the image settings. After changing the settings, return to the image and retry. The extension does not automatically send local text to an online service.

After translation, the **Original / Text** controls hide when the pointer leaves the image and no control has keyboard focus. Hover over the image to show them again. Opening the text panel keeps the controls available.

## Continuous manga translation

With continuous translation enabled, new pages wait until scrolling has settled for about 180 ms before recognition starts. Quickly passed pages do not build up in the queue; completed translations still appear immediately. After a distant jump to an untranslated page, an old task outside the retention window is canceled so the current page can proceed. Manual activation and retry run immediately. Configured page prefetch resumes after scrolling settles.

Local manga models are reused during reading and brief pauses, then released after about three idle minutes. Pausing during initialization restores the original immediately while model preparation can finish for reuse when you resume. Timeouts and failures stop the worker and allow retry. Initial preparation, complex page recognition and the text translation service can still take time.

The manga reader on [MANGA Plus by SHUEISHA](https://mangaplus.shueisha.co.jp/) and artwork pages on [Pixiv](https://www.pixiv.net/) have dedicated adapters. Click the manga button to start. No reading panel opens automatically. On first use with missing resources, a confirmation explains about 30 MB for recognition and an optional 197 MB for text removal. Confirming closes it and starts preparation. Choosing **Later** or closing it starts no download.

The right-side controls stay visible by default: webpage translation above, a circular brand icon in the middle, and a 32-pixel manga button below on reader pages. Moving away, waiting or pressing Escape does not retract them. An explicit hover preference remains available in floating-button settings; only that mode retracts manga controls after about 2.5 seconds. With the ordinary floating button hidden, the optional standalone manga button also stays visible by default. Use **Image/manga translation → Standalone manga button** to control it. Saved visibility preferences are preserved. The master and manga switches control availability.

The image currently being processed shows a small stage indicator. It disappears on completion or when you switch to originals. Actual download, recognition or cleanup percentages appear when available; waiting for translation shows the stage without estimating an overall percentage. The indicator does not intercept clicks or scrolling. Manga mode hides the lower-left Original/Text toolbar and cancel popup. Preparing a cached result never removes a translation you are reading. Ordinary images retain their previous lightweight loading indicator, with Cancel in the image toolbar rather than a central card.

- Click once to enable translation for the current chapter. Visible pages take priority, with the next **3 images** prepared by default. Select **0–5 images** in settings; 0 processes visible pages only. Only images already loaded by the website are prepared, without fetching entire or subsequent chapters. More upcoming images use additional device resources and service requests.
- The current result appears as soon as it is ready. Upcoming results appear when their images enter view. Unloaded images and rapid scrolling can still require waiting. Scrolling alone does not cancel an in-flight task for the same image. Switching away from the tab pauses the start of new page tasks.
- Results for up to two loaded preceding images are retained within a pixel budget, without starting extra recognition. Returning to these images displays their results even while another page is processing. More distant pages can restore instantly when their cached results remain available; disabling caching or evicting results can require processing again. Changed sources, languages or services invalidate older results.
- Click again to show originals and pause new work. Another click restores translations and resumes. Visible decoded results switch immediately; nearby results use a cache bounded by image count and pixels. Evicted pages may need processing again.
- Failed pages retain their originals. Switch to originals and back with the manga button to retry. Pages with no detected text keep their artwork, and the session continues. Changing chapters, disabling manga translation or the extension, or leaving the page cancels old work and restores originals.

This uses your image translation service and language settings. FluentRead adds no membership or image quota; the selected service's own limits and costs still apply. Other catalogued sites and common reading paths are checked for image readers, with an entry shown only when reader images or adapted canvases are found. Search the 235 requested site names and domains under **Supported websites**. Registration does not mean every chapter has passed live tests. WeebCentral, Dynasty and MangaDNA use dedicated image selectors. On MangaPark, open an available chapter from its work page before starting manga translation. Readable chapter canvases on Champion Cross, Comic Ryu, Comic Growl, Rimacomiplus, Heros Web, YoungAnimal, YoungChampion and ComicWalker share continuous translation, original-page pause and automatic translation after page turns. Their original canvases and navigation remain intact; unreadable artwork offers area selection. Canvas readers on Comic Zenon, Comic Days, ComicGardo, Comic-Trail, Comic-action, Kurage Bunch, ShonenJumpPlus, tonarinoyj and Ichicomi, and unreadable or tiled readers on YanMaga, Jumptoon, Televi-Kun Super Hero Comics and Comic Meteor (Kirapo), offer **Select manga area to translate**. Enable area translation and drag over visible artwork. This mode does not automatically translate as you scroll. Authenticated or protected readers still depend on content displayed by the website. Advanced users can add exact domains, reader paths and image selectors under supported sites. Custom rules are not verified site support. Single-image and area translation remain available on other sites.

Pixiv uses images from the current artwork, prioritizing its expanded reader to avoid processing the cover behind it twice. After verifying the current webpage image, the extension temporarily adds Pixiv's referrer only to its own request for that exact CDN image. It does not send login cookies or change the website's own requests. This requires the added `declarativeNetRequestWithHostAccess` extension permission. Local manga models remain an extension capability; userscript capabilities are limited.

Manga uses local PaddleOCR. Closed light speech bubbles are enlarged and recognized individually, nearby lines are grouped into dialogue, and translations use bounded font sizes and wrapping. Local LaMa repairs original lettering on complex backgrounds. Single-image translation can use Tesseract or PaddleOCR and keeps its lightweight controls and full-image result. Area recognition remains independent. LaMa repairs backgrounds; it is not an OCR engine and is not loaded when choosing PaddleOCR for single images. Small or tilted text, decorative fonts, names, and background repair can still be imperfect; switch to originals with the manga button to check. Ordinary images retain **Text → Compare original**.

Manga dialogue uses a moderately bold font; large lettering on complex backgrounds keeps a stronger title style with a white outline. Wrapping keeps punctuation with adjacent characters and balances very short last lines within the original text area. System fonts are used without an additional font download. These changes improve presentation; they do not guarantee accurate recognition or translation of every page.

### Download manga models

Expand **Recognition resources and downloads** under **Image/manga translation** to view resources grouped by purpose. Expand **Download and manage** to import downloaded files or clear resources. Tesseract language packs are managed separately in the same area. PaddleOCR needs about 30 MB. Manga's first complex background also needs an inpainting model of about 197 MB. The repair resource is hidden when only single-image PaddleOCR is enabled. Settings show download progress and received bytes; the manga button shows preparation status without covering the artwork.

Resources are prepared automatically on first use. Failed connections or integrity checks are retried automatically without a source selection. Completed verified files are retained, so retrying after cancellation or failure only prepares missing files. An interrupted individual file must restart. Clearing manga models preserves ordinary OCR packs and translation configuration.

If you already have the matching model files, use **Import downloaded files** to select them together. File names, complete sizes, and SHA-256 hashes must match; imported files stay local and are never uploaded. Once the models are present, recognition and repair can run offline. Your text translation service still needs its own connection.

## Translate one image

1. Make sure image translation is enabled. Click the icon near the image’s lower-left corner, or use the image’s context menu.
2. With Tesseract, follow the prompt to download a new source language's recognition pack. With PaddleOCR, the first translation prepares shared recognition models; existing resources are reused.
3. Wait for recognition and translation. Choose cancel if you want to stop.
4. Switch between original and translated image, or open **Text** in a separate reading panel. Compare the recognized original and translation, and copy either the translation or both. Long text remains readable even for small images.

When you open the site's image viewer, covered thumbnail translations and their text panels hide so they do not float over the enlarged image. You can translate the viewer image separately. Closing the viewer restores the thumbnail translation without another translation request.

<details class="guide-details">
<summary>Language packs, cancellation and retry</summary>

Canceling a translation does not remove downloaded language packs. Later images can reuse them. If text stays unchanged, you can still read and copy the recognized result.

Numbers, symbols, URLs, version numbers, and clear model identifiers are kept without separate translation requests. Ordinary prose on the same line is still translated. Images with more text require more segments, and the selected service affects the time needed. If a passage fails to translate, the original image stays available for retry; identifiers that need no translation do not cause the whole image to fail.

Language settings show the packs needed for your source language, downloaded packs, and active tasks first. Expand other languages as needed. Download progress is shown per pack; you can leave the settings page and return later. Completed packs are kept when another pack fails. Retrying downloads only missing packs. Removed packs need to be downloaded again.

If the translation connection is interrupted, it retries once automatically and remains cancelable. If it still fails, choose **Retry**. After an extension update or reload, refresh the webpage before trying again.

</details>

<details class="guide-details">
<summary>Cross-origin images</summary>

## Cross-origin images

Images on public HTTPS CDNs can also be translated. When the webpage cannot read their pixels, the extension verifies the currently selected image and reads it without login credentials. Canceling, changing the image, or leaving the page invalidates the previous request.

Images that require login credentials, redirect to another address, or use local or intranet sources may be unreadable. Try [area translation](/en/guide/area-translation) for visible text. Files over 16 MiB, access refusals, and non-image responses report their specific cause.

</details>

<details class="guide-details">
<summary>Choose the source language</summary>

## Choose the source language

Choose the recognition source language at the top of **Image/manga translation**. This setting is shared with webpage and area translation. Tesseract's recognition pack must match the image’s language. Automatic detection prepares Simplified Chinese, Traditional Chinese, English, and Japanese by default. Other supported languages require selecting the source language and downloading its pack.

When using Tesseract, choosing **English** for an English-only image can reduce recognition time. Keep **Automatic detection** for mixed languages. Completed recognition results are reused, and simultaneous requests for the same image share recognition. Canceling one request does not interrupt the others. Initial language-pack downloads still depend on network speed.

When the source language is automatic or Japanese, the Japanese pack recognizes both horizontal and vertical text. Vertical columns in a manga speech bubble are joined right to left into one passage before translation.

The current translation service and target language are used. Hover and context-menu entries can be turned off separately in image settings.

</details>

<details class="guide-details">
<summary>Small or blurry text?</summary>

## Small or blurry text?

Open a clear original if possible. Decorative fonts, complex backgrounds, tables, and vertical text in languages other than Japanese are harder to recognize. Check names, numbers, and units.

Long translations may appear small inside the picture; use the text view to read them fully. Background repairs may leave marks, and you can always restore the original.

For one small part, try [area translation](/en/guide/area-translation). Unreadable image sources and restricted pages may not work.

</details>

<details class="guide-details">
<summary>Image entry and ignored small images</summary>

Image translation recognizes text inside webpage images and overlays the translation on the image. It is off by default and can be enabled in settings. Once enabled, hover over an image for about 0.6 seconds to reveal a faint icon in its lower-left corner. The icon becomes clear when you hover over it; click to translate.

Sites such as X may use a transparent source image or link to receive pointer input while a background layer displays the photo. These media elements keep the hover entry available when their source and bounds match. When a viewer, dialog, or menu covers the image, its controls and translation overlay temporarily hide and return after the obstruction closes.

The hover entry skips common avatars, icons, logos, emoji, video previews, and small images where it can identify them. Video previews on sites such as X/Twitter can be skipped before playback starts, using player or thumbnail markers. Enlarging a small image may still leave the entry hidden. If an image you want to translate has no icon, use its context menu or open a clear original and try again.

</details>

## What gets sent?

Recognition happens locally. Recognized text goes to the selected translation service; image pixels are not uploaded as part of text translation. Initial language-pack downloads require a network connection. See [Data & privacy](/en/guide/privacy).

## Related guides

- [All guides](/en/docs/)
- [Troubleshooting](/en/guide/faq)

## Settings preview and sections

Image and manga settings show a fixed English–Chinese example on the left and recognition or prefetch controls on the right. The examples run no OCR and send no translation requests. Source and target languages are shared with webpage translation; images and manga share the service selected here. Region translation, entry points and cache, recognition resources, and supported sites are visible directly. Offline import, resource cleanup and custom site rules remain optional sections. Viewing resource status does not start a model download.
