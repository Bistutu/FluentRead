# PDF reading font

`FluentReadNotoSansSC-Regular.woff2` derives from the existing project Noto Sans SC
interface font. Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved
Font Name 'Source'. Licensed under SIL Open Font License 1.1; see `OFL.txt`.
The derived font is renamed, fixes the `wght` axis to Regular/400, and retains all
30,890 original Unicode characters. It adds 2,613 missing characters from pinned
Noto Sans and Noto Sans Math sources, and keeps 497 separate outlines for Unicode
aliases. The result has 33,503 encoded characters and 34,146 glyphs.
The reserved name is not used by the derived font.

## Fixed source

Google Fonts revision: `809e4d8b8d7e9364a914909bb777679606c178b8`.

- Original TTF: https://raw.githubusercontent.com/google/fonts/809e4d8b8d7e9364a914909bb777679606c178b8/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf
- Original license: https://raw.githubusercontent.com/google/fonts/809e4d8b8d7e9364a914909bb777679606c178b8/ofl/notosanssc/OFL.txt
- Original TTF SHA256: `a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`.
- Existing equivalent WOFF2: `assets/interface-fonts/NotoSansSC.woff2`, SHA256 `aef8c34277afad81ecd0227138a830263c0caea65b7aea66d1195395f097b55a`.
- Derived WOFF2 size: 5,112,688 bytes.
- Derived WOFF2 SHA256: `14703e46fadf7d61c61df0d476e3f9e7e8fadfdffec4188561d99142d0831cc0`.

## Runtime download

The supplemented derived font is available at the fixed FluentRead revision
`59d3a2c9666b1a47afcf0fee762d36c7dae3b123`, under
`public/pdf-fonts/FluentReadNotoSansSC-Regular.woff2`:

https://raw.githubusercontent.com/FluentRead/FluentRead/59d3a2c9666b1a47afcf0fee762d36c7dae3b123/public/pdf-fonts/FluentReadNotoSansSC-Regular.woff2

The first text PDF export downloads the asset on demand through JSDMirror,
an onmicrosoft mirror, jsDelivr, or GitHub Raw, with automatic source fallback.
The extension verifies its size and SHA256 before use and stores the verified
font in CacheStorage for later exports, including offline generation. Font
requests do not include documents, translations, or service credentials.

The maintenance asset remains in `assets/pdf-fonts/`, outside the extension
installation package. Copies of this notice, provenance and all three OFLs are distributed with
the extension under `third-party-notices/`.

## Reproduction

Run the offline maintenance script with Python 3.9, FontTools 4.38.0 and
Node.js 24.19.0 (built-in Brotli, font mode, quality 11):

```sh
python3 scripts/fonts/build-pdf-reading-font.py \
  /path/to/NotoSansSC-variable.ttf \
  /path/to/NotoSans-variable.ttf \
  /path/to/NotoSansMath-Regular.ttf --node /path/to/node-24.19.0
```

All three source hashes are checked. The CJK input can also be the existing
interface WOFF2 resource when a Brotli decoder is installed. Neither Python nor
FontTools is a runtime/build dependency. FontTools writes WOFF2 with glyf/loca
transformations disabled; compression uses Node's built-in Brotli. No extra Python compressor is needed
when using original TTF input. The `head` timestamp is preserved.
Source glyph records are aligned to four bytes: fontkit 1.1.1 uses short `loca`
offsets in small TrueType subsets without padding odd glyph sizes. Alignment
prevents those offsets from truncating and corrupting visible glyph outlines.
The WOFF2 glyf/loca transformation is disabled because fontkit 1.1.1's PDF subset
encoder cannot serialize its transformed glyph tables as TrueType records;
otherwise it emits invalid glyphs and oversized output. The raw aligned tables
are still Brotli compressed. All original 30,890 encoded characters are retained.
Unicode aliases such as U+00B7/U+2022 and U+5140/U+FA0C receive separate glyph
IDs with identical outlines so pdf-lib keeps their distinct ToUnicode mappings.

The static TrueType font, packaged as WOFF2, avoids the variable font's default Thin face and
the CFF subset corruption observed with Noto CJK OTF in fontkit 1.1.1. Every
export embeds a subset of the used glyphs with visible text and Unicode mappings.
The font is used only for text PDF export and does not join the content script
bundle. Exported documents are not subject to the OFL.

## Offline script and mathematics supplements

The sources use the same Google Fonts revision listed above:

- Noto Sans regular: [source TTF](https://raw.githubusercontent.com/google/fonts/809e4d8b8d7e9364a914909bb777679606c178b8/ofl/notosans/NotoSans%5Bwdth,wght%5D.ttf), SHA256 `bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d`. Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic); SIL OFL 1.1, see `NotoSans-OFL.txt`. The variable donor is instantiated at weight 400 and width 100.
- Noto Sans Math regular: [source TTF](https://raw.githubusercontent.com/google/fonts/809e4d8b8d7e9364a914909bb777679606c178b8/ofl/notosansmath/NotoSansMath-Regular.ttf), SHA256 `3f495fe933c06786e4d5f6d86b8ee70b6753a68ee3b9d87528726de0f6e2c47d`. Copyright 2022 The Noto Project Authors (https://github.com/notofonts/math); SIL OFL 1.1, see `NotoSansMath-OFL.txt`.

Only missing codepoints in whole Latin Extended A/B, Greek, Greek Extended,
Latin Extended Additional, superscript/letterlike, arrow and mathematics ranges,
plus the reviewed U+2023, U+2300, U+27F6 and U+27FA symbols found in actual PDF
reading text, are copied. Mathematical Operators and Supplemental Mathematical Operators are
complete, with all 256 characters in each block. Mathematical Alphanumeric
Symbols retain their original Unicode identities. Coptic letters in the shared
Greek and Coptic block are outside these donors' Greek coverage. Other scripts
and unsupported emoji are still explicitly rejected before producing a file.

Donor components are decomposed and scaled to the destination's 1000 units per
em, retaining donor outlines and horizontal metrics. Existing CJK glyphs are
never replaced. Each imported codepoint gets a distinct glyph; Unicode aliases
remain separate so PDF ToUnicode maps preserve exact copy/search text. The raw
glyf/loca tables and four-byte glyph alignment remain unchanged.
`PROVENANCE.json` records sources, tool versions, range coverage, size and hash.
The donors and maintenance tools are not runtime dependencies; the merged font
is downloaded on demand and cached locally after verification.
