/**
 * @file tests/sameTargetLanguageClient.test.ts
 * 共享翻译客户端与页面标题翻译使用真实语言识别的协作验证：多语言同目标文本在发往后台前返回原文、零消息；
 * 其他目标、显式源语言、逐次覆盖的目标语言与 skipLanguageDetection 语义保持不变；标题会话读取冻结的排除语言，
 * 页面把标题改成外语后重新识别并翻译，恢复时写回原标题；损坏整包专项经过真实 client/handler/broker，不以来源包替代空响应。
 * PR #906 前四段密集技术名称中文也须零请求，旁边外语句子和英文目标仍请求。
 * 补充检测边界另以可控延迟验证显式排除列表快照、凭据校验顺序、取消和批量原索引；
 * 只替换浏览器消息、provider、配置存储、补充检测与页面上下文边界，本地判断仍使用真实核心。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import modelPost from './fixtures/chinese-language-model-post.json';
import technicalParagraphs from './fixtures/chinese-technical-paragraphs.json';
import pr906Paragraphs from './fixtures/chinese-technical-pr-906.json';

const mocks = vi.hoisted(() => ({
    sendMessage: vi.fn(),
    preflight: vi.fn<(text: string, target: string, excluded: readonly string[], signal?: AbortSignal) => Promise<boolean>>(),
    getPageTranslationContext: vi.fn(async () => ''),
    getMissingCredentialMessage: vi.fn<() => string | null>(() => null),
    config: {
        glossaryEnabled: false,
        glossaryLibraries: [],
        count: 0,
        maxConcurrentTranslations: 4,
        translationMaxRetries: 0,
        translationBackoffBaseMs: 1,
        translationBackoffMaxMs: 1,
        model: {mock: 'mock-model'} as Record<string, string>,
        customModel: {mock: ''} as Record<string, string>,
        modelThinking: {},
        service: 'mock',
        from: 'auto',
        to: 'zh-Hans',
        excludedLanguages: [] as string[],
        useCache: false,
        enableAIContext: false,
    },
}));

vi.mock('webextension-polyfill', () => ({default: {runtime: {sendMessage: mocks.sendMessage}}}));
vi.mock('@/src/services/config/store', () => ({config: mocks.config, requestConfigCountIncrement: vi.fn(async () => 0)}));
vi.mock('@/src/services/translation/context', () => ({getPageTranslationContext: mocks.getPageTranslationContext}));
vi.mock('@/src/services/translation/languagePreflight', () => ({shouldSkipTranslationWithEvidence: mocks.preflight}));
vi.mock('@/src/core/config/validation', () => ({getMissingCredentialMessage: mocks.getMissingCredentialMessage}));

import {translateText, translateTextBatch, type TranslateOptions} from '@/src/services/translation/client';
import {clearTranslationQueue} from '@/src/services/translation/queue';
import {startFullPageTitleTranslation, stopFullPageTitleTranslation} from '@/src/features/full-page-translation/content/titleTranslation';
import type {FullPageTranslationConfigSnapshot} from '@/src/features/full-page-translation/content/translationRequest';
import {translateTextSlots} from '@/src/features/full-page-translation/content/translationRequest';
import {serializeTranslationSlots} from '@/src/core/translation/slotProtocol';
import {createTranslationBroker} from '@/src/services/translation/broker';
import {resolveTranslationLanguages} from '@/src/core/translation/languages';
import {createTranslationRequestFallback} from '@/src/app/background/handlers/translation';
import {serializeTranslationError} from '@/src/services/translation/errors';
import type {TranslationConfigSource, TranslationProvider} from '@/src/services/translation/types';

const sameTarget = [
    ['de', 'Dieser deutsche Absatz beschreibt die verschiedenen Einstellungen der Anwendung und die automatische Übersetzung.'],
    ['pt', 'Este é um parágrafo em português que descreve as configurações do aplicativo e a tradução automática.'],
    ['it', "Questo paragrafo italiano descrive le impostazioni dell'applicazione e la traduzione automatica."],
    ['en', 'Welcome to the settings page.'],
    ['fr', 'Bonjour et bienvenue sur notre site.'],
    ['ru', 'Добро пожаловать на наш сайт.'],
    ['ja', 'GPT-6 Sol の新しいモデルを発表しました。'],
    ['ko', 'GPT-6 Sol 모델의 새로운 기능을 소개합니다.'],
    ['zh-Hans', modelPost[1]!],
    ['zh-Hans', '云端模型清单允许清空，且不再连带拒掉无关偏好的保存 (84522b3)'],
    ['he', 'הפסקה הזו מסבירה איך התוסף שומר על הטקסט המקורי ומציג את התרגום ממש מתחתיו.'],
    ['hi', 'हमारी वेबसाइट पर आपका स्वागत है।'],
    ...technicalParagraphs.map(text => ['zh-Hans', text] as const),
] as const;

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(complete => { resolve = complete; });
    return {promise, resolve};
}

beforeEach(() => {
    mocks.sendMessage.mockReset();
    mocks.sendMessage.mockImplementation(async (message: {origin: string | string[]}) =>
        Array.isArray(message.origin) ? message.origin.map(origin => `T:${origin}`) : `T:${message.origin}`);
    mocks.config.from = 'auto';
    mocks.config.to = 'zh-Hans';
    mocks.config.excludedLanguages = [];
    mocks.preflight.mockReset().mockResolvedValue(false);
    mocks.getPageTranslationContext.mockClear();
    mocks.getMissingCredentialMessage.mockReset().mockReturnValue(null);
    vi.stubGlobal('document', {title: 'Fixture'});
    vi.stubGlobal('location', {protocol: 'https:'});
});

afterEach(() => {
    clearTranslationQueue();
    vi.unstubAllGlobals();
});

describe('共享翻译客户端', () => {
    it.each(['single', 'batch'] as const)('%s 本地同目标与显式排除命中都先于凭据检查，且不等待补充检测', async kind => {
        vi.stubGlobal('location', {protocol: 'chrome-extension:'});
        mocks.getMissingCredentialMessage.mockReturnValue('请填写 API 密钥');
        const german = sameTarget[0][1];
        const run = (options: TranslateOptions) => kind === 'single'
            ? translateText(german, 'Context', options)
            : translateTextBatch([german], 'Context', options);
        await expect(run({targetLanguage: 'de'})).resolves.toEqual(kind === 'single' ? german : [german]);
        await expect(run({targetLanguage: 'zh-Hans', excludedLanguages: ['de']}))
            .resolves.toEqual(kind === 'single' ? german : [german]);
        expect(mocks.preflight).not.toHaveBeenCalled();
        expect(mocks.getMissingCredentialMessage).not.toHaveBeenCalled();
        expect(mocks.sendMessage).not.toHaveBeenCalled();

        await expect(run({targetLanguage: 'zh-Hans'})).rejects.toThrow('请填写 API 密钥');
        expect(mocks.getMissingCredentialMessage).toHaveBeenCalledOnce();
        expect(mocks.sendMessage).not.toHaveBeenCalled();
    });

    it.each(['single', 'batch'] as const)('%s 等补充判断再检查凭据和提取上下文，全部跳过无需密钥', async kind => {
        vi.stubGlobal('location', {protocol: 'chrome-extension:'});
        mocks.getMissingCredentialMessage.mockReturnValue('请填写 API 密钥');
        const decision = deferred<boolean>();
        mocks.preflight.mockReturnValueOnce(decision.promise);
        const origin = 'Axq jpv zrk wmt vdf qhs klp.';
        const options: TranslateOptions = {serviceOverride: 'openai', modelOverride: 'gpt-4o', enableAIContext: true};
        const pending = kind === 'single' ? translateText(origin, '', options) : translateTextBatch([origin], '', options);
        expect(mocks.preflight).toHaveBeenCalledOnce();
        expect(mocks.getMissingCredentialMessage).not.toHaveBeenCalled();
        expect(mocks.getPageTranslationContext).not.toHaveBeenCalled();
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        decision.resolve(true);
        await expect(pending).resolves.toEqual(kind === 'single' ? origin : [origin]);
        expect(mocks.getMissingCredentialMessage).not.toHaveBeenCalled();
        expect(mocks.getPageTranslationContext).not.toHaveBeenCalled();
        expect(mocks.sendMessage).not.toHaveBeenCalled();
    });

    it('显式排除只影响本次请求，不继承全局网页排除列表，也不发给后台', async () => {
        const german = sameTarget[0][1];
        const english = 'Please translate this English paragraph for the reader.';
        mocks.config.excludedLanguages = ['en'];
        await expect(translateText(german, '', {excludedLanguages: ['de']})).resolves.toBe(german);
        await expect(translateText(english)).resolves.toBe(`T:${english}`);
        await expect(translateTextBatch([german, english], '', {excludedLanguages: ['de']}))
            .resolves.toEqual([german, `T:${english}`]);
        expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
        expect(mocks.sendMessage.mock.calls[1]![0].origin).toEqual([english]);
        for (const [message] of mocks.sendMessage.mock.calls) expect(message).not.toHaveProperty('excludedLanguages');
    });

    it('批量补充检测可乱序完成，原文、语言对、显式排除列表在等待前冻结，回填保持原索引', async () => {
        const german = sameTarget[0][1];
        const first = 'Axq jpv zrk wmt vdf qhs klp.';
        const second = 'Bxq jpv zrk wmt vdf qhs klp.';
        const chinese = technicalParagraphs[0]!;
        const firstDecision = deferred<boolean>();
        const secondDecision = deferred<boolean>();
        mocks.preflight.mockImplementation(text => text === first ? firstDecision.promise : secondDecision.promise);
        const origins = [german, first, chinese, second];
        const excluded = ['de'];
        const options: TranslateOptions = {sourceLanguage: 'ja', targetLanguage: 'zh-Hans', excludedLanguages: excluded};
        const pending = translateTextBatch(origins, 'Context', options);
        expect(mocks.preflight.mock.calls.map(call => call[0])).toEqual([first, second]);
        expect(mocks.preflight.mock.calls[0]![2]).toEqual(['de']);
        expect(Object.isFrozen(mocks.preflight.mock.calls[0]![2])).toBe(true);
        origins.splice(0, origins.length, 'mutated input');
        excluded[0] = 'en';
        options.sourceLanguage = 'de';
        options.targetLanguage = 'en';
        secondDecision.resolve(false);
        await Promise.resolve();
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        firstDecision.resolve(true);
        await expect(pending).resolves.toEqual([german, first, chinese, `T:${second}`]);
        expect(mocks.preflight.mock.calls[0]![2]).toEqual(['de']);
        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(mocks.sendMessage.mock.calls[0]![0]).toMatchObject({origin: [second], sourceLanguage: 'ja', targetLanguage: 'zh-Hans'});
    });

    it('单条补充检测使用调用时的语言与排除列表，失败开放后仍保留显式源语言', async () => {
        const origin = 'Axq jpv zrk wmt vdf qhs klp.';
        const decision = deferred<boolean>();
        mocks.preflight.mockReturnValueOnce(decision.promise);
        const excluded = ['de'];
        const options: TranslateOptions = {sourceLanguage: 'ja', targetLanguage: 'zh-Hans', excludedLanguages: excluded};
        const pending = translateText(origin, 'Context', options);
        excluded.push('en');
        options.sourceLanguage = 'de';
        options.targetLanguage = 'en';
        decision.resolve(false);
        await expect(pending).resolves.toBe(`T:${origin}`);
        expect(mocks.preflight).toHaveBeenCalledWith(origin, 'zh-Hans', ['de'], undefined);
        expect(mocks.sendMessage.mock.calls[0]![0]).toMatchObject({origin, sourceLanguage: 'ja', targetLanguage: 'zh-Hans'});
    });

    it.each(['single', 'batch'] as const)('%s 检测等待期间取消后，迟到的非跳过结论也不能检查凭据或发送翻译', async kind => {
        vi.stubGlobal('location', {protocol: 'chrome-extension:'});
        const origin = 'Axq jpv zrk wmt vdf qhs klp.';
        const controller = new AbortController();
        const decision = deferred<boolean>();
        mocks.preflight.mockReturnValueOnce(decision.promise);
        const pending = kind === 'single'
            ? translateText(origin, '', {signal: controller.signal})
            : translateTextBatch([origin], '', {signal: controller.signal});
        expect(mocks.preflight).toHaveBeenCalledWith(origin, 'zh-Hans', [], controller.signal);
        controller.abort();
        decision.resolve(false);
        await expect(pending).rejects.toMatchObject({name: 'AbortError'});
        expect(mocks.getMissingCredentialMessage).not.toHaveBeenCalled();
        expect(mocks.getPageTranslationContext).not.toHaveBeenCalled();
        expect(mocks.sendMessage).not.toHaveBeenCalled();
    });

    it('skipLanguageDetection 绕过两层预检，单条结构化槽标记与批量原始槽继续提交', async () => {
        const chinese = technicalParagraphs[0]!;
        const packet = serializeTranslationSlots([chinese, chinese]);
        mocks.preflight.mockImplementation(() => { throw new Error('should not inspect a structured packet'); });
        await expect(translateText(packet.payload, '', {skipLanguageDetection: true, validateTranslationSlots: true,
            excludedLanguages: ['en', 'zh-Hans']})).resolves.toBe(`T:${packet.payload}`);
        await expect(translateTextBatch([chinese, chinese], '', {skipLanguageDetection: true,
            excludedLanguages: ['en', 'zh-Hans']})).resolves.toEqual([`T:${chinese}`, `T:${chinese}`]);
        expect(mocks.preflight).not.toHaveBeenCalled();
        expect(mocks.sendMessage.mock.calls[0]![0]).toMatchObject({origin: packet.payload, validateTranslationSlots: true});
        expect(mocks.sendMessage.mock.calls[1]![0].origin).toEqual([chinese, chinese]);
    });

    it.each([undefined, false, true])('空响应在槽标志 %j 下仅为普通请求回退原文', async validateTranslationSlots => {
        const origin = 'Please translate this English paragraph for the reader.';
        mocks.sendMessage.mockResolvedValueOnce('');
        await expect(translateText(origin, '', {skipLanguageDetection: true, validateTranslationSlots}))
            .resolves.toBe(validateTranslationSlots === true ? '' : origin);
        expect(mocks.sendMessage).toHaveBeenCalledOnce();
    });
    it.each(['', ' \t', '\u200b'])('真实 client/handler/broker 的损坏整包 %j 逐槽回退，不以来源包替代', async raw => {
        const first = 'The software reads the document and translates the language on this page.';
        const second = 'The second paragraph explains the settings for the computer network.';
        const outputs = ['软件读取文档并翻译页面上的语言。', '第二段说明计算机网络设置。'];
        const packet = serializeTranslationSlots([first, second]);
        const current: TranslationConfigSource = {
            service: 'openai', from: 'en', to: 'zh-Hans', useCache: true, enableAIContext: false,
            model: {}, customModel: {}, proxy: {}, custom: '', deeplx: '', newApiUrl: '',
            minimaxBillingPlan: 'payg', minimaxRegion: 'cn', mimoBillingPlan: 'payg', mimoRegion: 'cn',
            azureOpenaiEndpoint: '', customBody: {}, system_role: {}, user_role: {},
            deepseekApiType: 'auto', deepseekThinkingMode: 'disabled',
        };
        const provider = vi.fn<TranslationProvider>().mockImplementation(async message => {
            if (message.origin === packet.payload) return raw;
            if (message.origin === first) return outputs[0]!;
            if (message.origin === second) return outputs[1]!;
            throw new Error('unexpected slot provider request');
        });
        const store = new Map<string, string>();
        const broker = createTranslationBroker({
            ready: Promise.resolve(), getConfig: () => current, providers: {openai: provider},
            cache: {get: async key => store.get(key) ?? null,
                set: async (key, value) => {store.set(key, value); return true;},
                clear: async () => store.clear(), cleanup: async () => undefined},
            serviceTypes: {machine: new Set(['chromeTranslator']), isAI: service => service === 'openai',
                isAiSdk: () => false, isUseAIContext: service => service === 'openai'},
            endpointResolver: {resolveOpenAICompatibleEndpoint: () => ({endpoint: 'https://fixture.invalid/v1'}), aiSdkTransportProfile: 'fixture'},
            promptBuilder: {buildPageSummaryPrompt: text => text, buildPageSummarySystemPrompt: () => ''},
            getMissingCredentialMessage: () => null,
            getTranslationLanguages: overrides => resolveTranslationLanguages(overrides,
                {sourceLanguage: 'en', targetLanguage: 'zh-Hans'}),
            resolveConfiguredModel: (selected, custom) => custom || selected || '',
            buildTranslationCacheKey: identity => JSON.stringify(identity),
        });
        const handler = createTranslationRequestFallback({
            translate: message => broker.translateWithCache(message), serializeError: serializeTranslationError,
        });
        mocks.sendMessage.mockImplementation(message => handler.handle(message, undefined));
        const frozen: FullPageTranslationConfigSnapshot = {service: 'openai', model: '', thinking: false,
            sourceLanguage: 'en', targetLanguage: 'zh-Hans', useCache: true, enableAIContext: false,
            enableAIMultiSegment: false, enableNativeBatch: false, displayMode: 'bilingual', style: 0};
        await expect(translateTextSlots([first, second], frozen)).resolves.toEqual(outputs);
        expect(provider.mock.calls.map(([message]) => message.origin)).toEqual([packet.payload, first, second]);
        expect(provider.mock.calls.map(([message]) => message.validateTranslationSlots)).toEqual([true, undefined, undefined]);
        expect([...store.values()].sort()).toEqual([...outputs].sort());
        // 再次调用只复用正确单槽；损坏整包仍需请求且不能被替换为原文假成功。
        await expect(translateTextSlots([first, second], frozen)).resolves.toEqual(outputs);
        expect(provider.mock.calls.map(([message]) => message.origin)).toEqual([packet.payload, first, second, packet.payload]);
        expect([...store.values()].sort()).toEqual([...outputs].sort());
    });
    it('单条内部槽校验标志在等待前冻结，只有显式 true 才进入后台消息', async () => {
        const options = {skipLanguageDetection: true, validateTranslationSlots: true};
        const pending = translateText('Please translate this English paragraph for the reader.', 'Context', options);
        options.validateTranslationSlots = false;
        await pending;
        expect(mocks.sendMessage.mock.calls[0]![0]).toMatchObject({validateTranslationSlots: true});
        await translateText('Please translate another English paragraph for the reader.', 'Context', options);
        expect(mocks.sendMessage.mock.calls[1]![0]).not.toHaveProperty('validateTranslationSlots');
    });
    it.each(sameTarget)('%s 批量文本同目标零请求，跨目标仍请求', async (language, text) => {
        await expect(translateTextBatch([text], 'Context', {targetLanguage: language})).resolves.toEqual([text]);
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        const other = language === 'en' ? 'zh-Hans' : 'en';
        await expect(translateTextBatch([text], 'Context', {targetLanguage: other})).resolves.toEqual([`T:${text}`]);
        expect(mocks.sendMessage).toHaveBeenCalledOnce();
    });

    it('部分批次重试只发送外语，响应长度按实际请求校验，原文输入保持完整', async () => {
        const foreign = 'Please translate this English paragraph for the reader.';
        const texts = [technicalParagraphs[0]!, foreign, technicalParagraphs[1]!];
        const original = [...texts];
        mocks.sendMessage.mockRejectedValueOnce(new Error('temporary provider failure'));
        await expect(translateTextBatch(texts, 'Context', {maxRetries: 1}))
            .resolves.toEqual([texts[0], `T:${foreign}`, texts[2]]);
        expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
        for (const [message] of mocks.sendMessage.mock.calls) expect(message.origin).toEqual([foreign]);
        expect(texts).toEqual(original);

        mocks.sendMessage.mockResolvedValueOnce(['too', 'many']);
        await expect(translateTextBatch(texts, 'Context', {maxRetries: 0})).rejects.toThrow('批量翻译返回格式异常');
    });

    it('全跳过的批次仍响应取消，数字和空白无需提交；强制请求包含每个原始槽', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(translateTextBatch(technicalParagraphs, 'Context', {signal: controller.signal}))
            .rejects.toMatchObject({name: 'AbortError'});
        await expect(translateTextBatch(['', ' ', '2026-10-04', ...technicalParagraphs]))
            .resolves.toEqual(['', ' ', '2026-10-04', ...technicalParagraphs]);
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        await expect(translateTextBatch(technicalParagraphs, 'Context', {skipLanguageDetection: true}))
            .resolves.toEqual(technicalParagraphs.map(text => `T:${text}`));
        expect(mocks.sendMessage.mock.calls[0]![0].origin).toEqual(technicalParagraphs);
    });

    it('截图中文批量输入零后台请求，插入外语后只提交外语且保留原索引', async () => {
        await expect(translateTextBatch(technicalParagraphs)).resolves.toEqual(technicalParagraphs);
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        const foreign = 'Please translate this English paragraph for the reader.';
        const texts = [technicalParagraphs[0]!, foreign, ...technicalParagraphs.slice(1)];
        await expect(translateTextBatch(texts)).resolves.toEqual([technicalParagraphs[0], `T:${foreign}`, ...technicalParagraphs.slice(1)]);
        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(mocks.sendMessage.mock.calls[0]![0].origin).toEqual([foreign]);
    });

    it.each(pr906Paragraphs)('PR #906 中文技术正文经单条与批量客户端都零请求 %#', async text => {
        await expect(translateText(text)).resolves.toBe(text);
        await expect(translateTextBatch([text])).resolves.toEqual([text]);
        expect(mocks.sendMessage).not.toHaveBeenCalled();
    });

    it('PR #906 四段中文技术正文批量保留，独立英文句子仍发送且回填原索引', async () => {
        await expect(translateTextBatch(pr906Paragraphs)).resolves.toEqual(pr906Paragraphs);
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        const foreign = 'This English sentence still needs a Chinese translation for the reader.';
        const texts = [pr906Paragraphs[0]!, foreign, ...pr906Paragraphs.slice(1)];
        await expect(translateTextBatch(texts)).resolves.toEqual([pr906Paragraphs[0], `T:${foreign}`, ...pr906Paragraphs.slice(1)]);
        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(mocks.sendMessage.mock.calls[0]![0].origin).toEqual([foreign]);
    });

    it('PR #906 中文技术正文换成英文目标时正常发送单条及批量请求', async () => {
        await expect(translateText(pr906Paragraphs[0]!, '', {targetLanguage: 'en'})).resolves.toBe(`T:${pr906Paragraphs[0]}`);
        await expect(translateTextBatch(pr906Paragraphs, '', {targetLanguage: 'en'}))
            .resolves.toEqual(pr906Paragraphs.map(text => `T:${text}`));
        expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
        expect(mocks.sendMessage.mock.calls[0]![0]).toMatchObject({origin: pr906Paragraphs[0], targetLanguage: 'en'});
        expect(mocks.sendMessage.mock.calls[1]![0]).toMatchObject({origin: pr906Paragraphs, targetLanguage: 'en'});
    });

    it.each(sameTarget)('%s 同目标文本直接返回原文且不发送后台消息', async (language, text) => {
        await expect(translateText(text, 'Context', {targetLanguage: language})).resolves.toBe(text);
        expect(mocks.sendMessage).not.toHaveBeenCalled();
    });

    it.each(sameTarget)('%s 文本换成其他目标时正常请求一次', async (language, text) => {
        const other = language === 'en' ? 'zh-Hant' : 'en';
        await expect(translateText(text, 'Context', {targetLanguage: other})).resolves.toBe(`T:${text}`);
        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(mocks.sendMessage.mock.calls[0]![0]).toMatchObject({origin: text, targetLanguage: other});
    });

    it('同一文本逐次覆盖目标语言时每次重新判断，不复用上一次跳过结论', async () => {
        const [, german] = sameTarget[0];
        for (const [target, expectedCalls] of [['de', 0], ['en', 1], ['de-AT', 1], ['zh-Hans', 2], ['de', 2]] as const) {
            await translateText(german, 'Context', {targetLanguage: target});
            expect(mocks.sendMessage).toHaveBeenCalledTimes(expectedCalls);
        }
        mocks.config.to = 'de';
        await translateText(german, 'Context');
        expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('显式源语言不改变基于文本证据的判断：错误的源语言设定不能让外语漏译', async () => {
        const [, german] = sameTarget[0];
        await expect(translateText(german, 'Context', {sourceLanguage: 'en', targetLanguage: 'de'})).resolves.toBe(german);
        const english = 'This English sentence needs a German translation for the reader.';
        await expect(translateText(english, 'Context', {sourceLanguage: 'de', targetLanguage: 'de'})).resolves.toBe(`T:${english}`);
        expect(mocks.sendMessage.mock.calls[0]![0]).toMatchObject({sourceLanguage: 'de', targetLanguage: 'de'});
    });

    it('富文本包使用 skipLanguageDetection 时仍然发送，由调用方负责逐槽过滤', async () => {
        const [, german] = sameTarget[0];
        await expect(translateText(german, 'Context', {targetLanguage: 'de', skipLanguageDetection: true})).resolves.toBe(`T:${german}`);
        await expect(translateTextBatch([german], 'Context', {targetLanguage: 'de'})).resolves.toEqual([german]);
        expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
        await expect(translateTextBatch([german], 'Context', {targetLanguage: 'de', skipLanguageDetection: true})).resolves.toEqual([`T:${german}`]);
        expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('歧义短词、混合语言和纯共享汉字即使目标看似相同也继续请求', async () => {
        for (const [text, target] of [
            ['Settings', 'en'], ['Bienvenido a nuestro sitio web.', 'pt'], ['日本国立大学', 'zh-Hans'],
            ['预计将推出 GPT-6 Sol Please translate this sentence.', 'zh-Hans'],
            ['Welcome to our website. Nous sommes très heureux de vous accueillir sur notre nouvelle plateforme.', 'en'],
        ] as const) {
            await translateText(text, 'Context', {targetLanguage: target});
        }
        expect(mocks.sendMessage).toHaveBeenCalledTimes(5);
    });

    it('没有字母的文本不请求；只有空白时保持原值', async () => {
        await expect(translateText('2026-09-16 12:00 🎉', 'Context', {targetLanguage: 'en'})).resolves.toBe('2026-09-16 12:00 🎉');
        await expect(translateText(' 　 ', 'Context')).resolves.toBe(' 　 ');
        expect(mocks.sendMessage).not.toHaveBeenCalled();
    });
});

describe('页面标题', () => {
    let currentTitle = '';
    let observers: Array<() => void> = [];
    const snapshot = (overrides: Partial<FullPageTranslationConfigSnapshot> = {}): FullPageTranslationConfigSnapshot => ({
        service: 'mock', model: 'mock-model', thinking: false, sourceLanguage: 'auto', targetLanguage: 'de',
        useCache: false, enableAIContext: false, enableAIMultiSegment: false, displayMode: 'single', style: 0,
        excludedLanguages: [], ...overrides,
    });
    const setPageTitle = (value: string) => {
        currentTitle = value;
        observers.forEach(callback => callback());
    };

    beforeEach(() => {
        vi.useFakeTimers();
        observers = [];
        vi.stubGlobal('document', {
            get title() { return currentTitle; },
            set title(value: string) { setPageTitle(value); },
            head: {},
        });
        vi.stubGlobal('window', {setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout});
        vi.stubGlobal('MutationObserver', class {
            constructor(private readonly callback: () => void) {}
            observe(): void { observers.push(this.callback); }
            disconnect(): void { observers = observers.filter(callback => callback !== this.callback); }
        });
    });

    afterEach(() => {
        stopFullPageTitleTranslation();
        vi.useRealTimers();
    });

    it('同目标德文标题零请求；页面改成英文标题后重新识别并翻译，恢复时写回页面标题', async () => {
        currentTitle = 'Die neuesten Nachrichten aus der Stadt und der Region';
        startFullPageTitleTranslation(snapshot());
        await vi.advanceTimersByTimeAsync(300);
        expect(mocks.sendMessage).not.toHaveBeenCalled();
        expect(currentTitle).toBe('Die neuesten Nachrichten aus der Stadt und der Region');

        setPageTitle('The latest news from the city and the region');
        await vi.advanceTimersByTimeAsync(300);
        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(currentTitle).toBe('T:The latest news from the city and the region');

        stopFullPageTitleTranslation();
        expect(currentTitle).toBe('The latest news from the city and the region');
    });

    it('标题命中会话冻结的排除语言时保留原文，清空排除语言的新会话重新请求', async () => {
        currentTitle = 'GPT-6 Sol の新しいモデルを発表しました';
        startFullPageTitleTranslation(snapshot({excludedLanguages: ['ja']}));
        await vi.advanceTimersByTimeAsync(300);
        expect(mocks.sendMessage).not.toHaveBeenCalled();

        startFullPageTitleTranslation(snapshot({excludedLanguages: []}));
        await vi.advanceTimersByTimeAsync(300);
        expect(mocks.sendMessage).toHaveBeenCalledOnce();
        expect(currentTitle).toBe('T:GPT-6 Sol の新しいモデルを発表しました');
    });
});
