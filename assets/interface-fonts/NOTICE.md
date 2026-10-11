# On-demand interface fonts

Used only by FluentRead's Options and Popup pages. These resources are NOT
included in the extension package. System fonts require no download; selecting
another font downloads the required files and caches them for offline use.
Downloads use versioned GitHub URLs and alternative CDNs, with expected size
and SHA-256 verification. Other scripts fall back to system fonts.
The original weights and glyph sets are retained; only
the container is converted from TTF to WOFF2. LXGW WenKai TC includes regular
and bold faces; the other eight downloadable families use variable fonts.

All fonts are distributed under SIL Open Font License 1.1. The full copyright
and license notices are included alongside the assets:

- Inter: `Inter-OFL.txt`, https://github.com/rsms/inter
- Noto Sans SC: `NotoSansSC-OFL.txt`, https://github.com/notofonts/noto-cjk
- Roboto: `roboto-OFL.txt`, https://github.com/google/fonts/tree/main/ofl/roboto
- Source Sans 3: `sourcesans3-OFL.txt`, https://github.com/adobe-fonts/source-sans
- IBM Plex Sans: `ibmplexsans-OFL.txt`, https://github.com/IBM/plex
- Manrope: `manrope-OFL.txt`, https://github.com/google/fonts/tree/main/ofl/manrope
- Nunito Sans: `nunitosans-OFL.txt`, https://github.com/google/fonts/tree/main/ofl/nunitosans
- LXGW WenKai TC: `lxgwwenkaitc-OFL.txt`, https://github.com/lxgw/LxgwWenkaiTC
- Noto Serif SC: `notoserifsc-OFL.txt`, https://github.com/notofonts/noto-cjk

## Reproduction

Source: https://github.com/google/fonts/tree/809e4d8b8d7e9364a914909bb777679606c178b8

- `ofl/inter/Inter[opsz,wght].ttf`
- `ofl/notosanssc/NotoSansSC[wght].ttf`
- `ofl/roboto/Roboto[wdth,wght].ttf`
- `ofl/sourcesans3/SourceSans3[wght].ttf`
- `ofl/ibmplexsans/IBMPlexSans[wdth,wght].ttf`
- `ofl/manrope/Manrope[wght].ttf`
- `ofl/nunitosans/NunitoSans[YTLC,opsz,wdth,wght].ttf`
- `ofl/lxgwwenkaitc/LXGWWenKaiTC-Regular.ttf`
- `ofl/lxgwwenkaitc/LXGWWenKaiTC-Bold.ttf`
- `ofl/notoserifsc/NotoSerifSC[wght].ttf`
- The `OFL.txt` from each respective directory.

Convert with FontTools 4.38.0 and Brotli 1.1.0 in a temporary Python environment:

```sh
python -m fontTools.ttLib.woff2 compress Inter.ttf -o Inter.woff2
python -m fontTools.ttLib.woff2 compress NotoSansSC.ttf -o NotoSansSC.woff2
```

Apply the same compression command to the other source files. No subsetting or
font-name/metadata rewriting is performed. This follows the unmodified-data
WOFF conversion requirements in [OFL FAQ 2.2](https://openfontlicense.org/ofl-faq/#22-can-i-make-and-use-woff-web-open-font-format-versions-of-ofl-fonts).

SHA-256:

`manifest.json` records the size, supported weights, character count and source /
compressed SHA-256 for every available face. Font name metadata, character mapping
and glyph order were verified unchanged after compression. License files retain
the complete text with whitespace and line endings normalized.

| File | SHA-256 |
| --- | --- |
| Source Inter.ttf | 29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031 |
| Source NotoSansSC.ttf | a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da |
| Inter.woff2 | 13b4cddc57045d40b411008e61588c8f81aa0bd72fe884624831a0ff9c4d159a |
| NotoSansSC.woff2 | aef8c34277afad81ecd0227138a830263c0caea65b7aea66d1195395f097b55a |

## Bundled card previews

The separately named modified subsets in `assets/interface-font-previews/` are
small offline samples for font cards. They are generated from these exact,
SHA-256-verified WOFF2 sources by
`scripts/fonts/build-interface-font-previews.py`, using the existing translated
font labels, descriptions and sample text. Each bold subset contains its own
card title; each regular subset contains its own description and common samples.
Noto Sans SC supplies the actual missing characters for other cards at the same
weight. Regular and bold glyphs are real weight-400/700 outlines; the generator
verifies their outlines and metrics against the original sources. Source files
and the full on-demand fonts stay unchanged.

The subsets use independent `FluentRead Preview …` internal font names. Source
Sans 3 is renamed `FluentRead Preview Humanist Sans`, and IBM Plex Sans becomes
`FluentRead Preview Technical Sans`, to avoid their Reserved Font Names. Original
copyright and license metadata are preserved. See the preview directory's
`NOTICE.md` and `manifest.json` for reproduction, coverage, modifications and
per-file source/output hashes. The full upstream OFL notices remain shipped in
`public/interface-font-licenses.txt` and apply to the modified preview files too.
