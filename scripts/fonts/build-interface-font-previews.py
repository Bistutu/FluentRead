"""Build the small, checked-in interface font card previews, entirely offline.

Maintenance command only; the extension build needs neither Python nor fontTools.
Validated with Python 3.9, fontTools 4.38.0 and Node 20+ (built-in Brotli).
Run from any directory, or add --check to reproduce and compare without writing.
"""
import argparse
import ast
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
from types import SimpleNamespace

import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont, woff2
from fontTools.varLib.instancer import instantiateVariableFont


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / 'assets/interface-fonts'
TARGET_DIR = ROOT / 'assets/interface-font-previews'
LANGUAGES = ('zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'es-ES', 'ru-RU')
SAMPLE_LATIN = 'Aa Bb Cc · 0123456789'
# The CSS alias identifies the option, while the internal names identify a
# modified font. Avoid the Reserved Font Names Source and Plex internally.
FAMILIES = (
    ('inter', 'Inter', 'Inter', 'Inter', 'Inter-OFL.txt'),
    ('noto-sans-sc', 'NotoSansSC', 'Noto Sans SC', 'Noto Sans SC', 'NotoSansSC-OFL.txt'),
    ('roboto', 'Roboto', 'Roboto', 'Roboto', 'roboto-OFL.txt'),
    ('source-sans-3', 'SourceSans3', 'Humanist Sans', 'Source Sans 3', 'sourcesans3-OFL.txt'),
    ('ibm-plex-sans', 'IBMPlexSans', 'Technical Sans', 'IBM Plex Sans', 'ibmplexsans-OFL.txt'),
    ('manrope', 'Manrope', 'Manrope', 'Manrope', 'manrope-OFL.txt'),
    ('nunito-sans', 'NunitoSans', 'Nunito Sans', 'Nunito Sans', 'nunitosans-OFL.txt'),
    ('lxgw-wenkai', 'LXGWWenKaiTC', 'LXGW WenKai', 'LXGW WenKai', 'lxgwwenkaitc-OFL.txt'),
    ('noto-serif-sc', 'NotoSerifSC', 'Noto Serif SC', 'Noto Serif SC', 'notoserifsc-OFL.txt'),
)


def digest(data):
    return sha256(data).hexdigest()


def brotli_compress(data, mode=2):
    script = ('const z=require("node:zlib"),f=require("node:fs");'
              'process.stdout.write(z.brotliCompressSync(f.readFileSync(0),{params:{'
              '[z.constants.BROTLI_PARAM_MODE]:2,[z.constants.BROTLI_PARAM_QUALITY]:11}}));')
    return subprocess.run(['node', '-e', script], input=data,
                          stdout=subprocess.PIPE, check=True).stdout


def brotli_decompress(data):
    script = ('const z=require("node:zlib"),f=require("node:fs");'
              'process.stdout.write(z.brotliDecompressSync(f.readFileSync(0)));')
    return subprocess.run(['node', '-e', script], input=data,
                          stdout=subprocess.PIPE, check=True).stdout


def avoid_legacy_decoder_stream_copies():
    # fontTools 4.38 converts the *whole remaining* coordinate stream into an
    # array for every glyph. Large CJK fonts otherwise incur quadratic copying.
    # Keep its original decoder and present only the current glyph's possible
    # coordinate bytes: a WOFF2 triplet consumes at most four bytes per point.
    # memoryview slices keep the unconsumed stream without copying any bytes.
    original = woff2.WOFF2GlyfTable._decodeTriplets
    original_reconstruct = woff2.WOFF2GlyfTable.reconstruct
    original_byteord = woff2.byteord

    def decode_triplets(table, glyph):
        remaining = memoryview(table.glyphStream)
        prefix = remaining[:4 * (glyph.endPtsOfContours[-1] + 1)]
        table.glyphStream = prefix
        table.flagStream = memoryview(table.flagStream)
        original(table, glyph)
        consumed = len(prefix) - len(table.glyphStream)
        table.glyphStream = remaining[consumed:]

    def reconstruct(table, data, font):
        original_reconstruct(table, data, font)
        # Restore ordinary bytes after reconstruction, including for deepcopy.
        for stream in table.subStreams:
            value = getattr(table, stream)
            if isinstance(value, memoryview):
                setattr(table, stream, value.tobytes())

    def byteord(value):
        # Legacy unpack255UShort expects its one-byte slice to be bytes.
        return value[0] if isinstance(value, memoryview) else original_byteord(value)

    woff2.WOFF2GlyfTable._decodeTriplets = decode_triplets
    woff2.WOFF2GlyfTable.reconstruct = reconstruct
    woff2.byteord = byteord


def collect_text():
    # These message values are ordinary single/double quoted TS string literals.
    # Refuse an unexpected shape instead of silently shipping stale previews.
    pattern = re.compile(
        r"['\"](?P<key>settings\.interface\.font\.(?:options\.[A-Za-z0-9]+\.(?:label|description)|preview))['\"]"
        r"\s*:\s*(?P<literal>'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\")\s*,"
    )
    texts = {}
    message_keys = None
    for language in LANGUAGES:
        path = ROOT / 'src/core/i18n/messages' / f'{language}.ts'
        values = {match['key']: ast.literal_eval(match['literal'])
                  for match in pattern.finditer(path.read_text())}
        if len(values) != 21:
            raise ValueError(f'{path}: expected 20 option strings and one sample, found {len(values)}')
        if message_keys is None:
            message_keys = set(values)
        if set(values) != message_keys:
            raise ValueError(f'{path}: font preview message keys do not match other languages')
        texts[language] = '\n'.join(values[key] for key in sorted(values)) + '\n' + SAMPLE_LATIN
    codepoints = {ord(character) for text in texts.values() for character in text
                  if not character.isspace() or character == ' '}
    return texts, codepoints


def codepoint_labels(codepoints):
    return [f'U+{codepoint:04X}' for codepoint in sorted(codepoints)]


def rename(font, family, style, license_text):
    postscript = re.sub(r'[^A-Za-z0-9]', '', family) + '-' + style
    names = {1: family, 2: style, 3: postscript + ';InterfacePreview',
             4: family + ' ' + style, 6: postscript, 16: family, 17: style,
             18: family + ' ' + style, 21: family, 22: style}
    # Keep every original copyright, license, author and vendor record. Rewrite
    # all localized font identifiers so no original primary name survives.
    for record in list(font['name'].names):
        if record.nameID in (13, 25):
            font['name'].names.remove(record)
        elif record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    for name_id, value in names.items():
        font['name'].setName(value, name_id, 3, 1, 0x409)
    # The userscript embeds WOFF2 without a separate accompanying license file.
    # Embed the complete source copyright notice and OFL, rather than only a URL.
    font['name'].setName(license_text, 13, 3, 1, 0x409)
    if 'STAT' in font:
        del font['STAT']


def build(check=False):
    # fontTools remains responsible for WOFF2 tables and their transforms.
    # Only the ordinary Brotli codec uses Node, avoiding a Python codec install.
    woff2.brotli = SimpleNamespace(compress=brotli_compress,
                                  decompress=brotli_decompress, MODE_FONT=2)
    woff2.haveBrotli = True
    avoid_legacy_decoder_stream_copies()
    source_manifest_data = (SOURCE_DIR / 'manifest.json').read_bytes()
    source_manifest = json.loads(source_manifest_data)
    source_records = {item['asset']: item for item in source_manifest['fonts']}
    texts, requested = collect_text()
    language_points = {language: {ord(character) for character in text
                                  if not character.isspace() or character == ' '}
                       for language, text in texts.items()}
    products = {}
    records = []
    source_cache = {}
    licenses = {}
    for option, stem, internal, alias, license_file in FAMILIES:
        licenses[license_file] = (SOURCE_DIR / license_file).read_text()
        for weight, style in ((400, 'Regular'), (700, 'Bold')):
            source_name = (f'LXGWWenKaiTC-{style}.woff2' if option == 'lxgw-wenkai'
                           else f'{stem}.woff2')
            source_record = source_records[source_name]
            if source_name not in source_cache:
                print(f'Preparing {source_name}…', flush=True)
                source_data = (SOURCE_DIR / source_name).read_bytes()
                if digest(source_data) != source_record['assetSha256']:
                    raise ValueError(f'{source_name}: source SHA-256 changed; review provenance before regenerating')
                if len(source_data) != source_record['bytes']:
                    raise ValueError(f'{source_name}: source size changed')
                font = TTFont(SOURCE_DIR / source_name, recalcTimestamp=False)
                available = set(font.getBestCmap()) & requested
                options = subset.Options()
                options.name_IDs = ['*']
                options.name_languages = ['*']
                options.notdef_outline = True
                options.recommended_glyphs = True
                subsetter = subset.Subsetter(options=options)
                subsetter.populate(unicodes=available)
                subsetter.subset(font)
                # The WOFF2 reader retains a second, full reconstructed CJK
                # glyph table. It is no longer needed after subset has loaded
                # all retained tables; do not deepcopy 30,000 discarded glyphs.
                for tag in font.keys():
                    if tag != 'GlyphOrder' and tag not in font.tables:
                        font[tag]
                font.reader = None
                source_cache[source_name] = font
            font = deepcopy(source_cache[source_name])
            if 'fvar' in font:
                axes = {axis.axisTag: axis.defaultValue for axis in font['fvar'].axes}
                axes['wght'] = weight
                font = instantiateVariableFont(font, axes, inplace=True)
            elif font['OS/2'].usWeightClass != weight:
                raise ValueError(f'{source_name}: wrong static weight')
            family = 'FluentRead Preview ' + internal
            rename(font, family, style, licenses[license_file])
            font['OS/2'].usWeightClass = weight
            font['OS/2'].fsSelection &= ~0x61  # Clear italic, bold, regular.
            font['OS/2'].fsSelection |= (0x20 if weight == 700 else 0x40)
            font['head'].macStyle = (font['head'].macStyle & ~0x3) | (1 if weight == 700 else 0)
            font.flavor = 'woff2'
            # Normal WOFF2 transforms suit browser loading (unlike PDF fontkit).
            font.flavorData = woff2.WOFF2FlavorData()
            from io import BytesIO
            buffer = BytesIO()
            font.save(buffer)
            data = buffer.getvalue()
            asset = f'{stem}-{style}.woff2'
            products[asset] = data
            # Decode the actual output and verify glyph coverage and static name.
            decoded = TTFont(BytesIO(data), recalcTimestamp=False)
            coverage = set(decoded.getBestCmap())
            expected = set(source_cache[source_name].getBestCmap()) & requested
            if coverage != expected or 'fvar' in decoded:
                raise ValueError(f'{asset}: output coverage or static instancing changed')
            if decoded['name'].getDebugName(1) != family:
                raise ValueError(f'{asset}: modified font name was not retained')
            if decoded['name'].getDebugName(13) != licenses[license_file]:
                raise ValueError(f'{asset}: complete copyright and OFL were not embedded')
            records.append({
                'asset': asset, 'option': option, 'family': family,
                'cssFamily': 'FluentRead Preview ' + alias, 'weight': weight,
                'bytes': len(data), 'sha256': digest(data),
                'glyphs': len(decoded.getGlyphOrder()),
                'unicodeCount': len(coverage), 'unicodeRange': codepoint_labels(coverage),
                'sourceAsset': source_name, 'sourceAssetSha256': source_record['assetSha256'],
                'originalSourceSha256': source_record['sourceSha256'],
                'license': '../../public/interface-font-licenses.txt',
                'sourceLicenseFile': license_file, 'embeddedLicenseNameId': 13,
                'embeddedLicenseSha256': digest(licenses[license_file].encode()),
                'missingByLanguage': {language: codepoint_labels(points - coverage)
                                      for language, points in language_points.items()},
            })
            print(f'{asset}: {len(data)} bytes, {len(coverage)} Unicode characters', flush=True)
    license_bundle = (ROOT / 'public/interface-font-licenses.txt').read_text()
    for license_file, text in licenses.items():
        if text.strip() not in license_bundle:
            raise ValueError(f'{license_file}: full source license is absent from the shipped license bundle')
    manifest = {
        'version': 1, 'fontToolsVersion': fontTools.__version__,
        'sourceRevision': source_manifest['sourceRevision'],
        'sourceManifestSha256': digest(source_manifest_data),
        'languages': list(LANGUAGES), 'requestedUnicodeCount': len(requested),
        'corpusMethod': 'For each locale: sorted settings.interface.font.options.*.{label,description} and settings.interface.font.preview keys; newline-join their string values; append newline and sampleLatin. Exclude whitespace except U+0020 for glyph coverage. corpusSha256 hashes the compact UTF-8 JSON object with lexicographically sorted locale keys.',
        'sampleLatin': SAMPLE_LATIN,
        'corpusSha256': digest(json.dumps(texts, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()),
        'corpus': {language: {'unicodeCount': len(points), 'sha256': digest(texts[language].encode())}
                   for language, points in language_points.items()},
        'totalFontBytes': sum(item['bytes'] for item in records), 'fonts': records,
    }
    products['manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    products['NOTICE.md'] = notice(manifest).encode()
    for filename, data in products.items():
        target = TARGET_DIR / filename
        if check:
            if not target.exists() or target.read_bytes() != data:
                raise ValueError(f'{target}: checked-in preview differs; regenerate and review')
        else:
            TARGET_DIR.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    print(f"{'Verified' if check else 'Generated'} {len(records)} faces: {manifest['totalFontBytes']} bytes total, "
          f"{len(requested)} requested characters across {len(LANGUAGES)} languages")


def notice(manifest):
    return f"""# Bundled interface font card previews

These small, modified fonts are packaged with FluentRead solely for font option
labels, descriptions and the existing sample text. They are not the downloadable
interface fonts and are not installed into the user's system. Full interface
fonts remain opt-in downloads and retain their original files and cache behavior.

## Source, modifications and license

The checked-in WOFF2 sources in `assets/interface-fonts/` originate from Google
Fonts revision `{manifest['sourceRevision']}`. That directory's `NOTICE.md` and
`manifest.json` document the original upstream files, copyright and hashes.
The generator verifies every source's existing SHA-256 before processing it.
No network download is used during regeneration.

These previews contain only source glyphs used by the current font option labels,
descriptions and sample text in zh-CN, en-US, ja-JP, ko-KR, fr-FR, es-ES and ru-RU,
plus `Aa Bb Cc · 0123456789`. Variable sources are instantiated at weight 400 and
700 with all other axes at their source defaults. LXGW WenKai uses its respective
original Regular and Bold sources. Font names are rewritten to independent
`FluentRead Preview …` names. The modified Source Sans 3 primary name is
`FluentRead Preview Humanist Sans`; IBM Plex Sans is
`FluentRead Preview Technical Sans`, avoiding Reserved Font Names Source/Plex.
The CSS aliases identify the corresponding original font options for the UI;
they are not the internal primary names of the modified fonts.

Original copyright, license, author and vendor metadata remain in the files.
The complete upstream copyright notice and OFL text are also embedded in each
font's nameID 13 license record, including when the userscript distributes the
WOFF2 as an inline resource without an accompanying license file.
The complete upstream copyright notices and SIL Open Font License 1.1 are
distributed in [interface-font-licenses.txt](../../public/interface-font-licenses.txt).
All these modified font files remain licensed under SIL OFL 1.1.

Each Latin family shares the bundled Noto Sans SC preview as a fallback for
characters it does not contain. A preview does not add glyphs absent from its
original source: unsupported characters, including most Korean Hangul in these
sources, retain the usual system fallback. `manifest.json` records the exact
per-face character coverage and each language's missing source characters.

## Offline reproduction

Run `python3 scripts/fonts/build-interface-font-previews.py` from the repository,
or append `--check` to reproduce and compare without changing any file.
The maintenance script uses Python, fontTools {fontTools.__version__} and Node 20+
with built-in Brotli. These are not extension build or runtime dependencies.
The script keeps original font timestamps so regenerated WOFF2 bytes are stable.
When card copy changes, regenerate and review the new coverage and hashes.

The 18 checked-in WOFF2 faces total {manifest['totalFontBytes']:,} bytes. They
cover a corpus of {manifest['requestedUnicodeCount']} distinct requested Unicode
characters, retaining each source font's real outlines and supported mappings.
"""


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='regenerate and compare without writing')
    build(parser.parse_args().check)
