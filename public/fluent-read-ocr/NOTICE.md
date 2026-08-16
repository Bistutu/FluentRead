FluentRead bundles the following open-source OCR assets for local image text recognition:

- Tesseract.js 6.0.1, Apache-2.0
- tesseract.js-core 6.1.2, Apache-2.0
- Tesseract language data packages for eng, chi_sim, and jpn, MIT

The worker, WebAssembly files, and language data are loaded from this extension's
own resources. No OCR code is downloaded from a third-party CDN at runtime.
