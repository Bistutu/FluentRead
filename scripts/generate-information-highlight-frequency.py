# 生成智能高亮关键词评分使用的常用字表、繁简对照和英文常用词表。
# 用法：python3 scripts/generate-information-highlight-frequency.py
# 依赖：pip install wordfreq==3.1.1 opencc-python-reimplemented==0.1.7（只在生成时需要，运行时不依赖、不下载）。
# 数据来源与授权见 public/third-party-notices/information-highlight-frequency-CC-BY-SA-4.0.txt。
import io, re
from collections import Counter
from wordfreq import get_frequency_dict, top_n_list
from opencc import OpenCC

HAN = re.compile(u'[一-鿿]')
characters = Counter()
for word, frequency in get_frequency_dict('zh', 'large').items():
    for character in word:
        if HAN.match(character): characters[character] += frequency
common_han = [character for character, _ in characters.most_common(2500)]
converters = [OpenCC(name) for name in ('s2t', 's2tw', 's2hk')]
known, pairs = set(common_han), []
for character in common_han:
    # 收录大陆以外通行的各种一对一繁体写法（含台湾、香港标准字形）；一个繁体字只对应最常用的那个简体字。
    for converter in converters:
        traditional = converter.convert(character)
        if traditional != character and len(traditional) == 1 and traditional not in known: known.add(traditional); pairs.append(traditional + character)
english = [word for word in top_n_list('en', 4000) if re.fullmatch('[a-z]{2,}', word)][:2000]
header = u'''/**
 * @file src/features/information-highlight/domain/frequencyData.ts
 * 文件职责：提供智能高亮关键词评分用的常用字表、繁简对照和英文常用词表。
 * 主要内容：由 scripts/generate-information-highlight-frequency.py 从 wordfreq 3.1.1 词频数据和 OpenCC 字形对照生成，按使用频率从高到低排列；请勿手工修改，更新时重新运行脚本。
 * 模块边界：只有静态数据，不含算法、不访问网络或浏览器接口；数据授权见 public/third-party-notices/information-highlight-frequency-CC-BY-SA-4.0.txt。
 */
'''
body = (u"/** 现代汉语最常用的 %d 个字。 */\nexport const COMMON_HAN_CHARACTERS = '%s';\n" % (len(common_han), u''.join(common_han))
    + u"/** %d 组常见繁体字及其简体字，成对排列。 */\nexport const TRADITIONAL_SIMPLIFIED_PAIRS = '%s';\n" % (len(pairs), u''.join(pairs))
    + u"/** 英语最常用的 %d 个词，以空格分隔。 */\nexport const COMMON_ENGLISH_WORDS = '%s';\n" % (len(english), u' '.join(english)))
io.open('src/features/information-highlight/domain/frequencyData.ts', 'w', encoding='utf-8').write(header + body)
print(len(common_han), len(pairs), len(english))
