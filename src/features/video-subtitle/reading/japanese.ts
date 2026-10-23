/**
 * @file src/features/video-subtitle/reading/japanese.ts
 * 文件职责：在专属读音 Worker 中按需加载日语词典，把字幕转换为可安全以纯文本显示的 Hepburn 罗马字。
 * 主要内容：共享可重试的词典初始化、半角假名规范化、结构化词元读音、助词与促音衔接、有限数词例外和未知汉字保留。
 * 模块边界：不访问网页、配置或翻译服务，不生成 HTML；词典适配器只读取固定版本的已校验下载缓存，Worker 编排负责任务取消与闲置释放。
 */
import {cachedJapaneseBuilder} from './cachedJapaneseTokenizer';
import Kuroshiro from 'kuroshiro';

import type {JapaneseReadingToken, JapaneseTokenizer, BuildTokenizer} from './japaneseTypes';
export type {JapaneseReadingToken} from './japaneseTypes';

interface ReadingUnit {
    surface: string;
    kana: string;
    pos: string;
    kind: 'japanese' | 'other' | 'punctuation' | 'space';
}

const kanaOnly = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;
const hanOnly = /^\p{Script=Han}+$/u;
const numeric = /^[0-9〇零一二三四五六七八九十百千万億兆]+$/u;
const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const opening = /^[([{「『【〈《“‘]$/u;
const closing = /^[\])}」』】〉》”’、。，．,.!?！？:;：；]+$/u;

/** 仅覆盖确定的数量读法；一日需有明确数字月份相邻，才采用日历读法。 */
const counterReadings: Readonly<Record<string, string>> = {
    '一人': 'ヒトリ', '1人': 'ヒトリ', '二人': 'フタリ', '2人': 'フタリ',
    '二十歳': 'ハタチ', '20歳': 'ハタチ', '二十日': 'ハツカ', '20日': 'ハツカ',
};

function tokenUnit(token: JapaneseReadingToken): ReadingUnit {
    const surface = token.surface_form;
    const candidate = token.pronunciation || token.reading || surface;
    const hasKanaReading = kanaOnly.test(candidate);
    return {
        surface,
        kana: hasKanaReading ? candidate : surface,
        pos: token.pos || '',
        kind: /^\s+$/u.test(surface) ? 'space'
            : hasKanaReading && japanese.test(surface) ? 'japanese'
                : token.pos === '記号' || closing.test(surface) || opening.test(surface) ? 'punctuation' : 'other',
    };
}

/** 组合读音而不是组合 HTML；词典没有覆盖整段汉字时保留原段，避免输出半个猜测的人名或外语名称。 */
function createUnits(tokens: readonly JapaneseReadingToken[]): ReadingUnit[] {
    const units: ReadingUnit[] = [];
    let checkedKnownHanEnd = 0;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (i >= checkedKnownHanEnd && hanOnly.test(token.surface_form)) {
            let end = i + 1;
            while (end < tokens.length && hanOnly.test(tokens[end].surface_form)) end++;
            const run = tokens.slice(i, end);
            if (run.some(item => !kanaOnly.test(item.pronunciation || item.reading || ''))) {
                const surface = run.map(item => item.surface_form).join('');
                units.push({surface, kana: surface, pos: '', kind: 'other'});
                i = end - 1;
                continue;
            }
            // 已确认整段都有读音，后续词元仍逐个处理，但不再反复扫描剩余汉字段。
            checkedKnownHanEnd = end;
        }
        if (numeric.test(token.surface_form) && (i === 0 || !numeric.test(tokens[i - 1].surface_form))) {
            let end = i + 1;
            while (end < tokens.length && numeric.test(tokens[end].surface_form)) end++;
            const key = tokens.slice(i, end).map(item => item.surface_form).join('') + (tokens[end]?.surface_form || '');
            const calendarDay = (key === '一日' || key === '1日')
                && /^(?:[1-9]|1[0-2]|[一二三四五六七八九]|十[一二]?)月$/u.test(tokens[i - 1]?.surface_form || '');
            const reading = calendarDay ? 'ツイタチ' : counterReadings[key];
            if (reading) {
                units.push({surface: key, kana: reading, pos: '名詞', kind: 'japanese'});
                i = end;
                continue;
            }
        }
        const unit = tokenUnit(token);
        if (unit.surface === '何' && /^(?:です|でし|でしょ|だ|だっ|だろ)$/u.test(tokens[i + 1]?.surface_form || '')) unit.kana = 'ナン';
        const previous = units.at(-1);
        if (previous?.kind === 'japanese' && unit.kind === 'japanese') {
            const joinsSokuon = /[っッ]$/u.test(previous.kana)
                && /^[bcdfghjklmnpqrstvwxyz]/u.test(Kuroshiro.Util.kanaToRomaji(unit.kana, 'hepburn'));
            const joinsAuxiliary = unit.pos === '助動詞' && /^(?:動詞|形容詞|助動詞)$/u.test(previous.pos);
            const joinsConjunction = unit.pos === '助詞' && token.pos_detail_1 === '接続助詞';
            const joinsSuffix = token.pos_detail_1 === '接尾';
            if (joinsSokuon || joinsAuxiliary || joinsConjunction || joinsSuffix) {
                // 意向形の「う」は発音上の長音。助動詞「ましょ / う」も同じ語群で扱う。
                previous.kana += unit.surface === 'う' && /[おこそとのほもよろをごぞどぼぽょオコソトノホモヨロヲゴゾドボポョ]$/u.test(previous.kana) ? 'ー' : unit.kana;
                previous.surface += unit.surface;
                if (joinsAuxiliary) previous.pos = unit.pos;
                continue;
            }
        }
        units.push(unit);
    }
    return units;
}

/** 未完の促音は独立した tsu ではない。字を残し、次の字幕との境界を勝手に連結しない。 */
function renderUnit(unit: ReadingUnit): string {
    if (unit.kind !== 'japanese') return Kuroshiro.Util.kanaToRomaji(unit.surface, 'hepburn');
    const trailingSokuon = /[っッ]$/u.test(unit.kana);
    return Kuroshiro.Util.kanaToRomaji(trailingSokuon ? unit.kana.slice(0, -1) : unit.kana, 'hepburn')
        + (trailingSokuon ? 'っ' : '');
}

export function formatJapaneseReadings(tokens: readonly JapaneseReadingToken[]): string {
    const units = createUnits(tokens);
    let output = '';
    let previous: ReadingUnit | undefined;
    for (const unit of units) {
        const rendered = renderUnit(unit);
        if (unit.kind === 'space') {
            output += ' ';
        } else {
            const joinsOther = previous?.kind === 'other' && unit.kind === 'other';
            const needsSpace = output && !/\s$/u.test(output) && !closing.test(unit.surface)
                && !opening.test(previous!.surface) && !joinsOther;
            output += (needsSpace ? ' ' : '') + rendered;
        }
        previous = unit;
    }
    return output.replace(/\s+/gu, ' ').trim();
}

/** 工厂让测试可以注入轻量词典端口；实际 Worker 只创建一个实例，初始化失败后允许下一次重试。 */
export function createJapaneseRomanizer(build: BuildTokenizer = cachedJapaneseBuilder): (text: string, dictBaseUrl: string) => Promise<string> {
    let initialization: {url: string; promise: Promise<JapaneseTokenizer>} | undefined;
    return async (text, dictBaseUrl) => {
        if (text.length > 4096) throw new Error('Japanese reading text exceeds 4096 characters');
        const normalized = text.normalize('NFKC');
        if (!japanese.test(normalized)) return normalized;
        const url = dictBaseUrl.trim().replace(/\/+$/u, '');
        if (!url) throw new Error('Japanese reading dictionary URL is required');
        if (initialization && initialization.url !== url) {
            throw new Error('Japanese reading dictionary changed; create a new Worker');
        }
        if (!initialization) {
            const promise = new Promise<JapaneseTokenizer>((resolve, reject) => {
                build({dicPath: url}).build((error, tokenizer) => error ? reject(error) : tokenizer ? resolve(tokenizer) : reject(new Error('Japanese tokenizer did not initialize')));
            });
            initialization = {url, promise};
        }
        const current = initialization;
        let tokenizer: JapaneseTokenizer;
        try {
            tokenizer = await current.promise;
        } catch (error) {
            if (initialization === current) initialization = undefined;
            throw error;
        }
        return formatJapaneseReadings(tokenizer.tokenize(normalized));
    };
}

export const romanizeJapanese = createJapaneseRomanizer();
