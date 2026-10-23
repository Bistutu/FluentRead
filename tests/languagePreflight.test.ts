/**
 * @file tests/languagePreflight.test.ts
 * 验证生产预检的证据边界、平台兼容、同文共享、独立取消、限流、过期和迟到结果隔离。
 * 样本调用真实纯识别器；可控 Promise 只替代不可取消的浏览器 API，不把模拟输出当作识别质量。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({i18n: undefined as undefined | {detectLanguage: ReturnType<typeof vi.fn>}}));
vi.mock('webextension-polyfill', () => ({default: {get i18n() {return mocks.i18n;}}}));
import {getSupplementalLanguageCandidate, acceptSupplementalLanguage} from '@/src/core/language/supplement';
import {identifyTextLanguage} from '@/src/core/language/identify';
import {segmentScriptWords} from '@/src/core/language/scripts';
import {assessStatisticalLanguage} from '@/src/core/language/statistical';
import * as statistical from '@/src/core/language/statistical';
import {detectBrowserLanguage} from '@/src/platform/browser/languageDetection';
import {createLanguagePreflight, shouldSkipTranslationWithEvidence} from '@/src/services/translation/languagePreflight';

const english = 'Astronomical instruments capture electromagnetic radiation across distant interstellar regions enabling detailed spectroscopic measurements alongside sophisticated computational simulations.';
const second = 'Photographic collections document extraordinary architectural landscapes throughout remarkable Mediterranean villages alongside magnificent historical monuments.';
const third = 'Procedural generation creates remarkable landscapes combining mountains valleys forests rivers meadows villages castles harbours tunnels bridges towers monuments.';
const reliable = (language = 'en') => ({isReliable: true, languages: [{language, percentage: 100}]});
const deferred = () => {
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<unknown>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
};

beforeEach(() => {mocks.i18n = undefined;});
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});

describe('平台能力边界', () => {
    it('没有 i18n 时继续原有规则；可用时保留完整 API 证据', async () => {
        expect(detectBrowserLanguage(english)).toBeUndefined();
        const detectLanguage = vi.fn().mockResolvedValue(reliable());
        mocks.i18n = {detectLanguage};
        expect(await detectBrowserLanguage(english)).toEqual(reliable());
        expect(detectLanguage).toHaveBeenCalledWith(english);
        expect(await shouldSkipTranslationWithEvidence(english, 'en')).toBe(true);
    });
});

describe('补充证据的纯规则', () => {
    it('Markdown 目标后的异语正文使用真实识别保留，平台结果不能把它重新提升为纯英语', async () => {
        const detector = vi.fn().mockResolvedValue(reliable());
        const preflight = createLanguagePreflight(detector);
        for (const destination of ['https://example.com', 'example.com/a_(b)']) {
            const source = `This is a link to [read the manual](${destination})请保存设置后重启浏览器。`;
            expect(await preflight(source, 'en')).toBe(false);
            expect(await preflight(source, 'de', ['en'])).toBe(false);
            expect(getSupplementalLanguageCandidate(source)).toBeUndefined();
        }
        expect(detector).not.toHaveBeenCalled();
    });

    it('1024 字符完整正文仍检查，超过边界立即放行且大 key 不驱逐已缓存正文', () => {
        const text = english.repeat(5).padEnd(1024, '.');
        expect(text).toHaveLength(1024);
        expect(identifyTextLanguage(text)).toMatchObject({status: 'unknown', bestGuess: 'en'});
        const assess = vi.spyOn(statistical, 'assessStatisticalLanguage');
        expect(getSupplementalLanguageCandidate(text)).toBe('en');
        expect(assess).toHaveBeenCalled();
        assess.mockClear();
        expect(getSupplementalLanguageCandidate(text + '.')).toBeUndefined();
        for (let index = 0; index < 129; index++) expect(getSupplementalLanguageCandidate(text + ` ${index}`)).toBeUndefined();
        expect(getSupplementalLanguageCandidate(text)).toBe('en');
        expect(assess).not.toHaveBeenCalled();
    });

    it('按完整规范文本复用入选和拒绝结果，不重复扫描窗口', () => {
        const assess = vi.spyOn(statistical, 'assessStatisticalLanguage');
        for (const [text, candidate] of [[english + ' 7001', 'en'], [english + ' Réservation confirmée. 7002', undefined]] as const) {
            assess.mockClear();
            expect(getSupplementalLanguageCandidate(text)).toBe(candidate);
            expect(assess).toHaveBeenCalled();
            assess.mockClear();
            expect(getSupplementalLanguageCandidate(text)).toBe(candidate);
            expect(getSupplementalLanguageCandidate(' ' + text.replace(/ /gu, '\t  ') + ' ')).toBe(candidate);
            expect(assess).not.toHaveBeenCalled();
        }
    });

    it('资格缓存只保留最近使用的 128 项，逐出后仍用真实核心重新检查', () => {
        const texts = Array.from({length: 129}, (_, index) => `${english} ${8000 + index}`);
        for (const text of texts.slice(0, 128)) expect(getSupplementalLanguageCandidate(text)).toBe('en');
        const assess = vi.spyOn(statistical, 'assessStatisticalLanguage');
        expect(getSupplementalLanguageCandidate(texts[0]!)).toBe('en');
        expect(assess).not.toHaveBeenCalled();
        expect(getSupplementalLanguageCandidate(texts[128]!)).toBe('en');
        expect(assess).toHaveBeenCalled();
        assess.mockClear();
        expect(getSupplementalLanguageCandidate(texts[0]!)).toBe('en');
        expect(assess).not.toHaveBeenCalled();
        expect(getSupplementalLanguageCandidate(texts[1]!)).toBe('en');
        expect(assess).toHaveBeenCalled();
    });

    it('只为完整的长单文字未知正文提供候选，未截断尾部', () => {
        expect(getSupplementalLanguageCandidate(english)).toBe('en');
        expect(getSupplementalLanguageCandidate(second)).toBe('en');
        expect(getSupplementalLanguageCandidate(third)).toBe('en');
        for (const text of ['', 'Hello', 'API 设置', '労働条件通知書', '請把門關好', '这段话保留原文。',
            'The library is open and you can read the books here.', english.repeat(30),
            english + ' 中文', english + ' "bonjour"', english + ' `secret_value`',
            english + ' https://example.org/private', english + ' ModelName 3.2', english + '\uFFFC',
            'Hi']) {
            expect(getSupplementalLanguageCandidate(text), text).toBeUndefined();
        }
    });

    it('成对 ASCII 与弯单引号保留外语引语，词内撇号不误当引语', async () => {
        const detector = vi.fn().mockResolvedValue(reliable());
        const preflight = createLanguagePreflight(detector);
        for (const quote of [" 'bonjour'", ' ‘Accès interdit’', " 'don't translate'", ' ‘don’t translate’']) {
            expect(getSupplementalLanguageCandidate(english + quote)).toBeUndefined();
            expect(await preflight(english + quote, 'en')).toBe(false);
        }
        expect(detector).not.toHaveBeenCalled();
        for (const apostrophe of [" don't", ' don’t']) {
            expect(getSupplementalLanguageCandidate(english + apostrophe)).toBe('en');
            expect(await preflight(english + apostrophe, 'en')).toBe(true);
        }
        expect(detector).toHaveBeenCalledTimes(2);
    });

    it('目录外未知正文、外语正字法与整段功能词反证不能被平台重新提升', async () => {
        const outsideCatalog = 'Para panaliti astronomi nglumpukake informasi babagan lintang lan galaksi supaya masyarakat bisa mangerteni perkembangan jagad raya kanthi luwih cetha.';
        const orthography = english + ' Réservation confirmée.';
        const functionWords = english + ' ' + second + ' Veuillez patienter avec votre dossier.';
        expect(identifyTextLanguage(outsideCatalog)).toMatchObject({status: 'unknown', bestGuess: 'jv'});
        const assess = (text: string) => assessStatisticalLanguage('Latin', segmentScriptWords(text).map(word => word.text));
        expect(assess(outsideCatalog)).toMatchObject({reason: 'unsupported'});
        expect(identifyTextLanguage(orthography)).toMatchObject({status: 'unknown', bestGuess: 'en'});
        expect(assess(orthography)).toMatchObject({reason: 'orthography'});
        expect(identifyTextLanguage(functionWords)).toMatchObject({status: 'unknown', bestGuess: 'en'});
        expect(assess(functionWords)).toMatchObject({reason: 'function-words', functionWordLeader: 'fr'});
        const detector = vi.fn().mockResolvedValue(reliable());
        const preflight = createLanguagePreflight(detector);
        for (const text of [outsideCatalog, orthography, functionWords]) {
            expect(getSupplementalLanguageCandidate(text)).toBeUndefined();
            expect(await preflight(text, 'en')).toBe(false);
        }
        expect(detector).not.toHaveBeenCalled();
    });

    it.each([true, false])('整段无明确反证时仍保留局部葡语正文，独立分句=%s', async separateSentence => {
        const base = 'Experimental architecture combines semantic analysis, structural evaluation, deterministic validation, performance measurement, quality control, resource management, and documentation.';
        const foreign = 'Com os participantes avaliamos resultados concretos.';
        const text = (separateSentence ? base : base.replace(/\.$/u, ',')) + ' ' + foreign;
        const words = segmentScriptWords(text).map(word => word.text);
        const whole = assessStatisticalLanguage('Latin', words);
        expect(identifyTextLanguage(text)).toMatchObject({status: 'unknown', bestGuess: 'en'});
        expect(whole.reason).toBe('function-words');
        expect(whole.language).toBeUndefined();
        expect(whole.functionWordLeader).toBeUndefined();
        if (separateSentence) {
            expect(assessStatisticalLanguage('Latin', segmentScriptWords(foreign).map(word => word.text)))
                .toMatchObject({functionWordLeader: 'pt'});
        } else {
            // 逗号没有切开子句；原文第 16 词开始的真实重叠窗口发现局部葡语。
            expect(text.slice(0, -1).includes('.')).toBe(false);
            expect(assessStatisticalLanguage('Latin', words.slice(16, 24)))
                .toMatchObject({functionWordLeader: 'pt'});
        }
        const detector = vi.fn().mockResolvedValue(reliable());
        expect(getSupplementalLanguageCandidate(text)).toBeUndefined();
        expect(await createLanguagePreflight(detector)(text, 'en')).toBe(false);
        expect(detector).not.toHaveBeenCalled();
    });

    it.each([
        undefined, null, 0, {}, {isReliable: false, languages: [{language: 'en', percentage: 100}]},
        {isReliable: true}, {isReliable: true, languages: []}, {isReliable: true, languages: [null]},
        {isReliable: true, languages: [{language: 'en'}]}, {isReliable: true, languages: [{language: 'en', percentage: '100'}]},
        {isReliable: true, languages: [{language: 'en', percentage: NaN}]},
        {isReliable: true, languages: [{language: 'en', percentage: 100.1}]},
        {isReliable: true, languages: [{language: 'en', percentage: -1}]},
        {isReliable: true, languages: [{language: 'en', percentage: 101}]},
        {isReliable: true, languages: [{language: 'en', percentage: 99}]},
        {isReliable: true, languages: [{language: 'en', percentage: 99}, {language: 'fr', percentage: 1}]},
        {isReliable: true, languages: [{language: 'en', percentage: 100}, {language: 'en', percentage: 100}]},
        {isReliable: true, languages: [{language: 'und', percentage: 100}]}, reliable('fr'),
        {isReliable: true, languages: [{percentage: 100}]},
    ])('拒绝不完整、不可靠、其他语言和混合占比：%j', evidence => {
        expect(acceptSupplementalLanguage('en', evidence)).toBeUndefined();
    });

    it('归一化别名，零占比条目不构成正文证据', () => {
        expect(acceptSupplementalLanguage('en', reliable('eng'))).toBe('en');
        expect(acceptSupplementalLanguage('en', {isReliable: true, languages: [
            {language: 'en', percentage: 100}, {language: 'fr', percentage: 0},
        ]})).toBe('en');
    });
});

describe('预检资源与调用契约', () => {
    it('本地明确命中、外语目标、混合和短歧义不调用平台', async () => {
        const detector = vi.fn().mockResolvedValue(reliable());
        const preflight = createLanguagePreflight(detector);
        expect(await preflight('请阅读这段文字。', 'zh-Hans')).toBe(true);
        expect(await preflight('请阅读这段文字。', 'en')).toBe(false);
        expect(await preflight(english, 'fr')).toBe(false);
        expect(await preflight('请翻译：Permission denied', 'zh-Hans')).toBe(false);
        expect(await preflight('労働条件通知書', 'zh-Hans')).toBe(false);
        expect(detector).not.toHaveBeenCalled();
    });

    it('同文共享证据，目标和显式排除逐次比较，不更改传入文本', async () => {
        const work = deferred();
        const detector = vi.fn().mockReturnValue(work.promise);
        const preflight = createLanguagePreflight(detector);
        const excluded = ['en'];
        const one = preflight(english, 'en');
        const two = preflight(english, 'fr', excluded);
        excluded[0] = 'fr';
        work.resolve(reliable('eng'));
        expect(await Promise.all([one, two])).toEqual([true, true]);
        expect(await preflight(english, 'de')).toBe(false);
        expect(await preflight(english, 'fr', ['en-US'])).toBe(true);
        expect(detector).toHaveBeenCalledTimes(1);
        expect(detector).toHaveBeenCalledWith(english);
    });

    it('取消一个订阅者不会中断另一个，等待结束后移除事件监听', async () => {
        const work = deferred();
        const detector = vi.fn().mockReturnValue(work.promise);
        const preflight = createLanguagePreflight(detector);
        const a = new AbortController();
        const b = new AbortController();
        const removeA = vi.spyOn(a.signal, 'removeEventListener');
        const removeB = vi.spyOn(b.signal, 'removeEventListener');
        const first = preflight(english, 'en', [], a.signal);
        const rejected = expect(first).rejects.toMatchObject({name: 'AbortError'});
        const secondCall = preflight(english, 'en', [], b.signal);
        a.abort();
        await rejected;
        work.resolve(reliable());
        expect(await secondCall).toBe(true);
        expect(detector).toHaveBeenCalledTimes(1);
        expect(removeA).toHaveBeenCalled(); expect(removeB).toHaveBeenCalled();
    });

    it('已经取消时连本地命中也不继续，缓存等待同样响应取消', async () => {
        const detector = vi.fn().mockResolvedValue(reliable());
        const preflight = createLanguagePreflight(detector);
        const before = new AbortController(); before.abort();
        await expect(preflight('请继续阅读。', 'zh-Hans', [], before.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(detector).not.toHaveBeenCalled();
        expect(await preflight(english, 'en')).toBe(true);
        const cached = new AbortController();
        const result = preflight(english, 'en', [], cached.signal);
        const rejected = expect(result).rejects.toMatchObject({name: 'AbortError'});
        cached.abort(); await rejected;
    });

    it('平台端口同步触发取消时不登记已取消的订阅，共享工作仍可供下一调用使用', async () => {
        const work = deferred();
        const controller = new AbortController();
        const add = vi.spyOn(controller.signal, 'addEventListener');
        const detector = vi.fn(() => {controller.abort(); return work.promise;});
        const preflight = createLanguagePreflight(detector);
        await expect(preflight(english, 'en', [], controller.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(add).not.toHaveBeenCalled();
        const following = preflight(english, 'en');
        work.resolve(reliable());
        expect(await following).toBe(true);
        expect(detector).toHaveBeenCalledTimes(1);
    });

    it('证据监听已清理而异步返回尚未恢复时取消，最后一次信号检查仍拒绝结果', async () => {
        const work = deferred();
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        const detector = vi.fn().mockReturnValue(work.promise);
        const preflight = createLanguagePreflight(detector);
        const rejected = expect(preflight(english, 'en', [], controller.signal)).rejects.toMatchObject({name: 'AbortError'});
        let cleanedBeforeAbort = false;
        work.resolve(reliable());
        // 第一次让底层结果结算，第二次排在订阅清理之后、async continuation 之前。
        queueMicrotask(() => queueMicrotask(() => {
            cleanedBeforeAbort = remove.mock.calls.length > 0;
            controller.abort();
        }));
        await rejected;
        expect(cleanedBeforeAbort).toBe(true);
        expect(await preflight(english, 'en')).toBe(true);
        expect(detector).toHaveBeenCalledTimes(1);
    });

    it('API 不支持、同步故障、异步拒绝都保留翻译，故障后可以重试', async () => {
        const detector = vi.fn().mockReturnValueOnce(undefined).mockImplementationOnce(() => {throw new Error('unavailable');})
            .mockRejectedValueOnce(new Error('not supported')).mockResolvedValue(reliable());
        const preflight = createLanguagePreflight(detector);
        for (let index = 0; index < 3; index++) expect(await preflight(english, 'en')).toBe(false);
        expect(await preflight(english, 'en')).toBe(true);
        expect(detector).toHaveBeenCalledTimes(4);
    });

    it('错误或多语言平台证据不提升，本地结果优先', async () => {
        const detector = vi.fn().mockResolvedValue({isReliable: true, languages: [
            {language: 'en', percentage: 99}, {language: 'fr', percentage: 1},
        ]});
        const preflight = createLanguagePreflight(detector);
        expect(await preflight(english, 'en')).toBe(false);
        expect(await preflight(english, 'en')).toBe(false);
        expect(detector).toHaveBeenCalledTimes(1);
    });

    it('120ms 后放行；未结束的底层调用仍占并发上限，迟到结果不能写缓存', async () => {
        vi.useFakeTimers();
        const a = deferred(); const b = deferred();
        const detector = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise).mockResolvedValue(reliable());
        const preflight = createLanguagePreflight(detector);
        const one = preflight(english, 'en'); const two = preflight(second, 'en');
        expect(await preflight(third, 'en')).toBe(false);
        expect(detector).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(120);
        expect(await Promise.all([one, two])).toEqual([false, false]);
        expect(await preflight(third, 'en')).toBe(false);
        a.resolve(reliable()); b.reject(new Error('late'));
        await vi.advanceTimersByTimeAsync(0);
        expect(await preflight(english, 'en')).toBe(true);
        expect(detector).toHaveBeenCalledTimes(3);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('超时同文快速放行且不重复启动，其他正文可用剩余名额，真实结算后才允许重试', async () => {
        vi.useFakeTimers();
        const hung = deferred();
        const detector = vi.fn().mockReturnValueOnce(hung.promise).mockResolvedValue(reliable());
        const preflight = createLanguagePreflight(detector);
        const first = preflight(english, 'en');
        await vi.advanceTimersByTimeAsync(120);
        expect(await first).toBe(false);
        for (let index = 0; index < 3; index++) expect(await preflight(english, 'en')).toBe(false);
        expect(detector).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        expect(await preflight(second, 'en')).toBe(true);
        expect(await preflight(third, 'en')).toBe(true);
        expect(detector).toHaveBeenCalledTimes(3);
        hung.resolve(reliable());
        await vi.advanceTimersByTimeAsync(0);
        // 迟到成功不能填缓存；新调用重新取证，而不是永久保留超时状态。
        expect(await preflight(english, 'en')).toBe(true);
        expect(detector).toHaveBeenCalledTimes(4);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('一分钟过期，有界缓存按最近使用保留，缓存不进入持久化', async () => {
        vi.useFakeTimers();
        const detector = vi.fn().mockResolvedValue(reliable());
        const preflight = createLanguagePreflight(detector);
        expect(await preflight(english, 'en')).toBe(true);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(await preflight(english, 'en')).toBe(true);
        expect(detector).toHaveBeenCalledTimes(2);
        for (let index = 0; index < 127; index++) expect(await preflight(`${english} ${index}`, 'en')).toBe(true);
        expect(await preflight(english, 'en')).toBe(true); // 保留最近使用项。
        expect(await preflight(second, 'en')).toBe(true);
        expect(await preflight(english, 'en')).toBe(true);
        const calls = detector.mock.calls.length;
        expect(await preflight(`${english} 0`, 'en')).toBe(true); // 最旧项已逐出。
        expect(detector.mock.calls.length).toBe(calls + 1);
    });
});
