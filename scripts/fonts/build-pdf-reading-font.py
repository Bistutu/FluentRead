"""Create the checked-in static PDF font from pinned OFL Noto sources.

Offline maintenance operation, not part of a build or browser runtime.
Validated with Python 3.9 / fontTools 4.38.0. CJK WOFF2 input requires Brotli;
the pinned original CJK TTF avoids needing a WOFF2 decoder.
WOFF2 compression uses Node's built-in Brotli, without installing a Python codec.
"""
from hashlib import sha256
from copy import deepcopy
from pathlib import Path
from argparse import ArgumentParser
import json
import subprocess
from types import SimpleNamespace
import sys
import unicodedata
from fontTools.ttLib import TTFont, woff2
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

root = Path(__file__).resolve().parents[2]
parser = ArgumentParser(description=__doc__)
parser.add_argument('cjk', type=Path, help='Pinned Noto Sans SC variable TTF (or existing interface WOFF2 with a Brotli decoder)')
parser.add_argument('sans', type=Path, help='Pinned NotoSans[wdth,wght].ttf')
parser.add_argument('math', type=Path, help='Pinned NotoSansMath-Regular.ttf')
parser.add_argument('--node', default='node', help='Node executable used for deterministic WOFF2 Brotli compression')
args = parser.parse_args()
source = args.cjk
target = root / 'assets/pdf-fonts/FluentReadNotoSansSC-Regular.woff2'
expected = ('a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da'
            if source.suffix == '.ttf' else 'aef8c34277afad81ecd0227138a830263c0caea65b7aea66d1195395f097b55a')
assert sha256(source.read_bytes()).hexdigest() == expected, 'Font source changed; review its provenance before regenerating'
font = TTFont(source, recalcTimestamp=False)
font = instantiateVariableFont(font, {'wght': 400}, inplace=True, updateFontNames=True)
font.flavor = None
# Extend whole script/operator ranges, without replacing any original CJK glyph.
# The donors are pinned to the same Google Fonts revision as the CJK source.
revision = '809e4d8b8d7e9364a914909bb777679606c178b8'
base_cmap = dict(font.getBestCmap())
ranges = [(0x0100, 0x024F), (0x0370, 0x03FF), (0x1E00, 0x1FFF),
          (0x2070, 0x214F), (0x2190, 0x22FF), (0x27C0, 0x27EF),
          (0x2980, 0x2AFF), (0x1D400, 0x1D7FF),
          # Actual readable PDF targets also use these assigned symbols outside
          # the complete blocks above. Copy only these reviewed codepoints.
          (0x2023, 0x2023), (0x2300, 0x2300), (0x27F6, 0x27F6), (0x27FA, 0x27FA)]
donors = [(args.sans, 'NotoSans', 'bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d',
           'ofl/notosans/NotoSans%5Bwdth,wght%5D.ttf'),
          (args.math, 'NotoSansMath', '3f495fe933c06786e4d5f6d86b8ee70b6753a68ee3b9d87528726de0f6e2c47d',
           'ofl/notosansmath/NotoSansMath-Regular.ttf')]
order = list(font.getGlyphOrder())
added = []
sources = []
for donor_path, family, digest, url_path in donors:
    assert sha256(donor_path.read_bytes()).hexdigest() == digest, 'Supplement font source changed'
    donor = TTFont(donor_path, recalcTimestamp=False)
    if 'fvar' in donor:
        axes = {axis.axisTag: axis.defaultValue for axis in donor['fvar'].axes}
        axes.update({tag: value for tag, value in {'wght': 400, 'wdth': 100}.items() if tag in axes})
        donor = instantiateVariableFont(donor, axes, inplace=True, updateFontNames=True)
    glyphs = donor.getGlyphSet()
    scale = font['head'].unitsPerEm / donor['head'].unitsPerEm
    count = 0
    existing = font.getBestCmap()
    for codepoint, glyph_name in sorted(donor.getBestCmap().items()):
        if codepoint in existing or not any(lo <= codepoint <= hi for lo, hi in ranges):
            continue
        # Flatten donor components before copying: no composite can refer to a
        # donor glyph name or retain a transform in the destination glyph set.
        recording = DecomposingRecordingPen(glyphs)
        glyphs[glyph_name].draw(recording)
        pen = TTGlyphPen(None)
        recording.replay(TransformPen(pen, (scale, 0, 0, scale, 0, 0)))
        name = f'fr{family}.u{codepoint:06X}'
        glyph = pen.glyph()
        glyph.recalcBounds(font['glyf'])
        font['glyf'][name] = glyph
        advance, bearing = donor['hmtx'][glyph_name]
        font['hmtx'][name] = (round(advance * scale), round(bearing * scale))
        if 'vmtx' in font:
            font['vmtx'][name] = (font['head'].unitsPerEm, font['hhea'].ascent - getattr(glyph, 'yMax', 0))
        order.append(name)
        for table in font['cmap'].tables:
            if table.isUnicode() and hasattr(table, 'cmap') and (codepoint <= 0xFFFF or table.format in (10, 12, 13)):
                table.cmap[codepoint] = name
        existing[codepoint] = name
        added.append(codepoint)
        count += 1
    sources.append({'family': family, 'sha256': digest, 'addedCodepoints': count,
                    'url': f'https://raw.githubusercontent.com/google/fonts/{revision}/{url_path}'})
font.setGlyphOrder(order)
# fontkit 1.1.1 emits short loca offsets in small subsets without adding padding.
# Align every source glyph so subsetting cannot truncate an odd byte offset.
font['glyf'].padding = 4
# One CID must represent one Unicode character. A source font may share a
# glyph (e.g. U+00B7/U+2022); pdf-lib otherwise collapses its ToUnicode mapping.
seen = set()
order = list(font.getGlyphOrder())
aliases = 0
for codepoint, glyph_name in sorted(font.getBestCmap().items()):
    if glyph_name not in seen:
        seen.add(glyph_name)
        continue
    name = f'{glyph_name}.frU{codepoint:06X}'
    font['glyf'][name] = deepcopy(font['glyf'][glyph_name])
    font['hmtx'][name] = font['hmtx'][glyph_name]
    if 'vmtx' in font:
        font['vmtx'][name] = font['vmtx'][glyph_name]
    order.append(name)
    for table in font['cmap'].tables:
        if table.isUnicode() and table.cmap.get(codepoint) == glyph_name:
            table.cmap[codepoint] = name
    aliases += 1
font.setGlyphOrder(order)
names = {1: 'FluentRead Noto Sans SC', 2: 'Regular', 3: 'FluentReadNotoSansSC-Regular',
         4: 'FluentRead Noto Sans SC Regular', 6: 'FluentReadNotoSansSC-Regular',
         16: 'FluentRead Noto Sans SC', 17: 'Regular'}
for record in font['name'].names:
    if record.nameID == 0:
        record.string = ('Copyright 2014-2021 Adobe; Copyright 2022 The Noto Project Authors. '
                         'SIL Open Font License 1.1.').encode(record.getEncoding())
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
target.parent.mkdir(parents=True, exist_ok=True)

def brotli_compress(data, mode=2):
    encoder = ('const z=require("node:zlib"),f=require("node:fs");'
               'process.stdout.write(z.brotliCompressSync(f.readFileSync(0),{params:{'
               '[z.constants.BROTLI_PARAM_MODE]:2,[z.constants.BROTLI_PARAM_QUALITY]:11}}));')
    return subprocess.run([args.node, '-e', encoder], input=data,
                          stdout=subprocess.PIPE, check=True).stdout

# Only the standard Brotli compressor is replaced. Keep glyf/loca raw:
# fontkit 1.1.1 can read transformed WOFF2 glyphs but its PDF subset encoder
# cannot serialize those transformed tables as TrueType glyph records.
woff2.brotli = SimpleNamespace(compress=brotli_compress, MODE_FONT=2)
woff2.haveBrotli = True
font.flavor = 'woff2'
font.flavorData = woff2.WOFF2FlavorData(transformedTables=set())
font.save(target)
data = target.read_bytes()
cmap = font.getBestCmap()
assert all(codepoint in cmap for codepoint in base_cmap), 'Original Unicode coverage lost'
assert all(codepoint in cmap for codepoint in range(0x0100, 0x0250)), 'Latin Extended A/B coverage incomplete'
assert all(codepoint in cmap for codepoint in range(0x2200, 0x2300)), 'Mathematical Operators coverage incomplete'
assert all(codepoint in cmap for codepoint in range(0x2A00, 0x2B00)), 'Supplemental Mathematical Operators coverage incomplete'
assert all(codepoint in cmap for codepoint in (0x2023, 0x2300, 0x27F6, 0x27FA)), 'Reviewed readable PDF symbols missing'
provenance = {'googleFontsRevision': revision, 'cjkSourceSha256': expected, 'supplements': sources,
              'tools': {'python': sys.version.split()[0], 'fontTools': __import__('fontTools').__version__,
                        'node': subprocess.check_output([args.node, '--version'], text=True).strip()},
              'originalCodepointsRetained': len(base_cmap), 'addedCodepoints': len(added),
              'codepoints': len(cmap), 'glyphs': len(font.getGlyphOrder()), 'unicodeAliasesSeparated': aliases,
              'ranges': [{'from': f'U+{lo:04X}', 'to': f'U+{hi:04X}', 'supported': sum(cp in cmap for cp in range(lo, hi + 1)),
                          'assignedMissing': [f'U+{cp:04X}' for cp in range(lo, hi + 1) if cp not in cmap and unicodedata.category(chr(cp)) != 'Cn']}
                         for lo, hi in ranges],
              'outputBytes': len(data), 'outputSha256': sha256(data).hexdigest()}
(target.parent / 'PROVENANCE.json').write_text(json.dumps(provenance, indent=2) + '\n')
print(f'{target.name}: {len(data)} bytes, SHA256 {sha256(data).hexdigest()}, {len(added)} supplement characters, {aliases} Unicode alias glyphs separated')
