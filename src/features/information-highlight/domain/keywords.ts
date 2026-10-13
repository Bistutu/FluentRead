/**
 * @file src/features/information-highlight/domain/keywords.ts
 * 文件职责：以可解释的本地词项规则生成信息高亮候选，不依赖语言模型、词典下载或网络服务。
 * 主要内容：保留 UTF-16 原文坐标，以标准词分段及有界后备分词排除常见虚词，结合词长、数字、专名与缩写形态以及段内首次出现排序；中日文词长几乎相同，另按由开源词频数据生成的常用字表估计用字的常见程度，英文另按同一来源的常用词表区分等长的常见词与少见词，让常见词浅、少见词深，繁体字先折算为简体再查表；密度选择只决定绘制覆盖，不把规则分数解释为理解收益或事实可信度。
 * 模块边界：纯文本算法，不读取 DOM、不写配置、不导入浏览器平台；调用方负责文本规模、页面所有权和原生 Range 绘制。
 */
import type {InformationHighlightDensity} from '@/src/core/config/informationHighlight';
import type {InformationHighlightResult, InformationHighlightSpan} from '../protocol';
import {COMMON_ENGLISH_WORDS, COMMON_HAN_CHARACTERS, TRADITIONAL_SIMPLIFIED_PAIRS} from './frequencyData';
import {informationGraphemeBoundaries} from './textBoundaries';

const stopWords = new Set(('a an and are as at be been but by can could did do does for from had has have he her here him his how i if in into is it its me more most my no nor not of on one or our out she so some than that the their them then there these they this those to too up us was we were what when where which who will with would you your ' +
    'about after all also any because before being between both down each even just like many may much must only other over same should such through under very well while without ' +
    '的 地 得 了 着 过 是 在 和 与 及 或 而 但 为 于 对 从 到 把 被 让 给 有 无 不 也 都 就 很 更 最 一 个 这 那 这些 那些 我 我们 你 你们 他 她 它 他们 什么 怎么 因为 所以 可以 可能 ' +
    '一个 一种 一样 没有 这个 那个 这样 那样 这种 时候 已经 还是 就是 但是 而且 以及 或者 如果 通过 进行 其它 其他 自己 非常 比较 应该 需要 对于 关于 并且 然后 现在 之间 之后 之前 以后 以前 其中 由于 因此 甚至 特别 几乎 越').split(/\s+/u));
// 常用字表只用来估计“这个词是否由常见字组成”，不是词典，也不表示词义的重要性；查表和查虚词表前先把繁体折算为简体。
const hanRank = new Map<string, number>(), simplified = new Map<string, string>();
[...COMMON_HAN_CHARACTERS].forEach((character, index) => hanRank.set(character, index));
for (let index = 0; index < TRADITIONAL_SIMPLIFIED_PAIRS.length; index += 2) simplified.set(TRADITIONAL_SIMPLIFIED_PAIRS[index], TRADITIONAL_SIMPLIFIED_PAIRS[index + 1]);
const fold = (key: string) => [...key].map(character => simplified.get(character) ?? character).join('');
/** 用字越少见数值越高（0–1.1）：常用字按字表位次开方，平假名多为虚词和词尾，片假名多为外来语，字表以外的汉字最少见。 */
function characterRarity(key: string): number {
    let sum = 0, count = 0;
    for (const character of key) {
        const rank = hanRank.get(character);
        sum += rank !== undefined ? Math.sqrt(rank / hanRank.size) : /\p{Script=Hiragana}/u.test(character) ? 0.1 : /\p{Script=Han}/u.test(character) ? 1.1 : 0.8;
        count++;
    }
    return sum / count;
}
// 英语常用词表只用来区分长度相近的常见词与少见词，不是词典。
const englishRank = new Map(COMMON_ENGLISH_WORDS.split(' ').map((word, index) => [word, index]));
/** 英文词越少见数值越高（0–1）：先查原形，再去掉常见词尾查一次；词表以外的词最少见。 */
function englishRarity(key: string): number {
    const rank = englishRank.get(key) ?? englishRank.get(key.replace(/(?:ies|ied)$/u, 'y')) ?? englishRank.get(key.replace(/(?:ing|ed|es|ly|s|d)$/u, ''))
        ?? englishRank.get(key.replace(/(?:ing|ed)$/u, 'e'));
    return rank === undefined ? 1 : Math.sqrt(rank / englishRank.size) * 0.8;
}
export interface InformationWordSpan {start: number; end: number; key: string}

/** 返回原文的标准词项坐标，供规则评分、热力绘制和设置预览共同分词。 */
export function informationWordSpans(text: string): InformationWordSpan[] {
    const candidates: InformationWordSpan[] = [];
    const Segmenter = Intl.Segmenter;
    if (Segmenter) {
        const segmenter = new Segmenter(undefined, {granularity: 'word'});
        for (const part of segmenter.segment(text)) {
            if (part.isWordLike) candidates.push({start: part.index, end: part.index + part.segment.length, key: part.segment.toLocaleLowerCase()});
        }
    } else {
        // 后备只按原文匹配；连续汉字拆成双字单位，避免把整句误作一个词或更改原文。
        for (const match of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’_-][\p{L}\p{N}\p{M}]+)*/gu)) {
            const start = match.index!;
            if (/^[\p{Script=Han}]+$/u.test(match[0])) {
                let offset = 0;
                const characters = [...match[0]];
                for (let i = 0; i < characters.length; i += 2) {
                    const key = characters.slice(i, i + 2).join('');
                    candidates.push({start: start + offset, end: start + offset + key.length, key}); offset += key.length;
                }
            } else candidates.push({start, end: start + match[0].length, key: match[0].toLocaleLowerCase()});
        }
    }
    return candidates;
}

/**
 * 轻量规则评分是候选排序，不是概率、模型意外度或语义重要性的标定值。
 * 词越长、越少见的形态（数字、专名、缩写）分数越高；同一词在段内再次出现时更容易预料，分数降低。
 * 中日文按用字的常见程度加分，单个少见汉字也可成为候选；英文按常用词表加分。
 */
export function scoreInformationKeywords(text: string): InformationHighlightResult {
    const ideographic = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
    const candidates = informationWordSpans(text).map(word => ({...word, key: ideographic.test(word.key) ? fold(word.key) : word.key}))
        .filter(word => !stopWords.has(word.key) && ([...word.key].length >= 2 || (/^\p{Script=Han}$/u.test(word.key) && characterRarity(word.key) >= 0.6)));
    const counts = new Map<string, number>(), seen = new Set<string>();
    for (const word of candidates) counts.set(word.key, (counts.get(word.key) ?? 0) + 1);
    return {engine: 'local-keyword-rules-v5', spans: candidates.map(word => {
        const original = text.slice(word.start, word.end), length = [...word.key].length, repeated = seen.has(word.key);
        seen.add(word.key);
        // 表意文字的单字信息量高于字母：韩文按约 2.5 个字母折算；中日文的词长差别很小且长词多为常用短语，
        // 只按 1.5 个字母折算，主要由下面的用字常见程度拉开层次。
        const weight = ideographic.test(word.key) ? length * 1.5 : /^\p{Script=Hangul}/u.test(word.key) ? length * 2.5 : length;
        let score = Math.log2(2 + Math.min(weight, 12)) + (repeated ? -0.6 : Math.log2(counts.get(word.key)!) * 0.35);
        if (ideographic.test(word.key)) score += characterRarity(word.key) * 2.4;
        else if (/^[a-z]+$/u.test(word.key)) score += englishRarity(word.key) * 1.2;
        if (/\p{N}/u.test(word.key)) score += 1.4;
        if (/^\p{Lu}[\p{Lu}\p{N}]+$/u.test(original)) score += 0.7;
        // 句中首字母大写多为专名；句首大写不提供信息。
        else if (/^\p{Lu}/u.test(original) && /[^\s.!?。！？:：\n]\s+$/u.test(text.slice(Math.max(0, word.start - 3), word.start))) score += 0.5;
        return {start: word.start, end: word.end, score};
    })};
}

/** 过滤不可信分数及坐标，把模型分词贡献聚合到原文完整词项；不改写原始评分。 */
export function alignInformationWordSpans(text: string, spans: readonly InformationHighlightSpan[]): InformationHighlightSpan[] {
    const boundaries = informationGraphemeBoundaries(text);
    const validPieces = spans.filter(span => Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end)
        && span.start >= 0 && span.end <= text.length && span.end > span.start && Number.isFinite(span.score)
        && boundaries.has(span.start) && boundaries.has(span.end));
    // 模型 subword/byte pieces 在原文词段上聚合，密度绘制不会切开英文词或标准中文词项。
    validPieces.sort((a, b) => a.start - b.start);
    let cursor = 0;
    const valid: InformationHighlightSpan[] = [];
    for (const word of informationWordSpans(text)) {
        if (!boundaries.has(word.start) || !boundaries.has(word.end)) continue;
        while (cursor < validPieces.length && validPieces[cursor].end <= word.start) cursor++;
        let score = 0, matches = 0;
        for (let i = cursor; i < validPieces.length && validPieces[i].start < word.end; i++) {
            if (validPieces[i].end > word.start) {score += validPieces[i].score; matches++;}
        }
        if (matches && Number.isFinite(score)) valid.push({start: word.start, end: word.end, score});
    }
    return valid;
}

/** 按字符预算挑选高分候选，并合并相邻重叠坐标；保留原有底色和细线的选择语义。 */
export function selectInformationSpans(text: string, spans: readonly InformationHighlightSpan[], density: InformationHighlightDensity): InformationHighlightSpan[] {
    const valid = alignInformationWordSpans(text, spans);
    const budget = Math.max(1, Math.ceil(text.replace(/\s/gu, '').length * ({low: 0.12, medium: 0.22, high: 0.35}[density])));
    const selected: InformationHighlightSpan[] = [];
    let used = 0;
    for (const span of [...valid].sort((a, b) => b.score - a.score || a.start - b.start)) {
        if (selected.length >= 48 || (selected.length > 0 && used + span.end - span.start > budget)) continue;
        // 聚合后的词段已经构成互不重叠的原文分区。
        selected.push({...span}); used += span.end - span.start;
    }
    selected.sort((a, b) => a.start - b.start);
    const merged: InformationHighlightSpan[] = [];
    for (const span of selected) {
        const previous = merged.at(-1);
        if (previous && previous.end === span.start) {previous.end = span.end; previous.score = Math.max(previous.score, span.score);}
        else merged.push(span);
    }
    return merged;
}
