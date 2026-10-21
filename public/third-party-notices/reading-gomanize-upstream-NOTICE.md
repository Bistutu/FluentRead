# Code and embedded-data attribution

Gomanize implementation code is MIT licensed, Copyright (c) 2023–2026
Budhaditya (budhash@gmail.com). The WebAssembly binary also embeds learned data;
the code license does not replace the data licenses below.

Every gomanize build (CLI binaries, the WebAssembly module, the npm package and
the web demo) embeds the data files below:

| Embedded file | Derived from | License | Changes from the source |
|---|---|---|---|
| `lang/hindi/lexicon.tsv` | Dakshina Hindi train spellings; Shabd frequencies (CC0) for ranking | CC BY-SA 4.0 | High-attestation winning spelling per word, frequency-filtered, serialized as TSV |
| `lang/hindi/schwa_tree.json` | Dakshina Hindi train alignments | CC BY-SA 4.0 | Decision tree learned over aligned schwa positions |
| `lang/hindi/roman_ngrams.tsv` | Dakshina Hindi train romanizations | CC BY-SA 4.0 | Character 4-gram counts |
| `lang/bengali/lexicon.tsv` | Dakshina Bengali train spellings | CC BY-SA 4.0 | Normalized native keys, held-out vocabularies excluded, unique high-attestation winners, TSV |
| `lang/bengali/vowel_tree.json` | Google Bengali pronunciation lexicon (train partition) | CC BY 4.0 | Grapheme–phoneme alignment; inherent-vowel decision tree |

Sources:

- **Google Dakshina**, Google / Roark et al., 2020:
  [source](https://github.com/google-research-datasets/dakshina),
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- **Google Bengali pronunciation lexicon**, Copyright Google 2015/2016:
  [source](https://github.com/googlei18n/language-resources/tree/master/bn),
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Shabd** psycholinguistic database: [source](https://osf.io/xfbhd/),
  [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (no attribution
  required; credited for transparency).

Source hashes, transformations, exclusions and reproduction tools are recorded
in the [training data record](https://github.com/budhash/gomanize/blob/main/training/data/bengali/README.md),
[Bengali lexicon record](https://github.com/budhash/gomanize/blob/main/lang/bengali/LEXICON.md),
and [research record](https://github.com/budhash/gomanize/blob/main/docs/RESEARCH.md).
These notices identify adapted data and do not imply endorsement by its creators.

## MIT code license

MIT License

Copyright (c) 2023-2026 Budhaditya (budhash@gmail.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

