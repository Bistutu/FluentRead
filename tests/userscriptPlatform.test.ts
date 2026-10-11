import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {VOCABULARY_BOOK_MESSAGE} from '@/src/features/vocabulary/protocol';
import {CONFIG_COUNT_INCREMENT_MESSAGE} from '@/src/services/config/count';
import {Config} from '@/src/core/config/model';
import {TRANSLATION_CANCEL_MESSAGE_TYPE} from '@/src/services/translation/types';

const mocks = vi.hoisted(() => ({
    config: {count: 0},
    saveConfig: vi.fn(),
    incrementUserscriptConfigCount: vi.fn(),
    applyConfigHistoryAction: vi.fn(),
    runTranslationServiceConnectionTest: vi.fn(),
    translateMicrosoftTexts: vi.fn(),
    cleanupTranslationCache: vi.fn(),
    clearTranslationCache: vi.fn(),
    translateWithCache: vi.fn(),
    lookupWord: vi.fn(),
    vocabularyBook: {getByTerm: vi.fn(), upsert: vi.fn(), list: vi.fn(), clear: vi.fn()},
}));

vi.mock('@/src/services/config/store', () => ({
    config: mocks.config,
    configReady: Promise.resolve(),
    subscribeConfig: () => () => undefined,
    CONFIG_HISTORY_MESSAGE: 'configHistoryAction',
    CONFIG_PERSIST_MESSAGE: 'persistConfig',
    CONFIG_PERSIST_BATCH_MESSAGE: 'persistConfigBatch',
    CONFIG_STORAGE_KEY: 'local:config',
    getConfigRevision: () => 0,
    prepareConfigPatchRequest: vi.fn(),
    prepareConfigSaveRequest: vi.fn(),
    parseStoredConfig: vi.fn(),
    saveConfig: mocks.saveConfig,
    applyConfigHistoryAction: mocks.applyConfigHistoryAction,
}));

vi.mock('@/userscript/count', () => ({
    incrementUserscriptConfigCount: mocks.incrementUserscriptConfigCount,
}));

vi.mock('@/src/core/config/constants', () => ({
    CONNECTION_TEST_MESSAGE: 'testTranslationServiceConnection',
}));

vi.mock('@/src/providers/translation/microsoft', () => ({
    translateMicrosoftTexts: mocks.translateMicrosoftTexts,
}));

vi.mock('@/src/providers/translation/connectionTest', () => ({
    runTranslationServiceConnectionTest: mocks.runTranslationServiceConnectionTest,
}));

vi.mock('@/src/app/translation/runtime', () => ({
    cleanupTranslationCache: mocks.cleanupTranslationCache,
    clearTranslationCache: mocks.clearTranslationCache,
    translateWithCache: mocks.translateWithCache,
}));

vi.mock('@/src/features/selection-translation/services/wordDictionary', () => ({
    lookupWord: mocks.lookupWord,
}));

vi.mock('@/userscript/storage', () => ({configStorage: {watch: () => () => undefined}}));
vi.mock('@/src/platform/storage/modelUsageRepository', () => ({modelUsageRepository: {}}));
vi.mock('@/src/features/vocabulary/repository', () => ({vocabularyBook: mocks.vocabularyBook}));

import {createPlatformMessageHandler} from '@/userscript/platform';
import {createPlatformMessageHandler as createFullPlatformMessageHandler} from '@/userscript/platformFull';
import {getTranslationGlossaryContext, getTranslationRequestControl} from '@/src/services/translation/requestSnapshot';

describe('userscript 平台消息适配', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('免费池逐服务检查保留候选 ID，避免脚本端退回自动换线', async () => {
        mocks.runTranslationServiceConnectionTest.mockResolvedValue({durationMs: 12});
        const handler = createPlatformMessageHandler(vi.fn());
        await expect(handler({type: 'testTranslationServiceConnection', service: 'freeTranslation', freeProviderId: 'transmart'}))
            .resolves.toEqual({success: true, durationMs: 12});
        expect(mocks.runTranslationServiceConnectionTest).toHaveBeenCalledWith('freeTranslation', expect.objectContaining({freeProviderId: 'transmart'}));
    });
    it('术语网站范围取当前页面而不是公开payload，视频仍使用独立入口', async () => {
        vi.stubGlobal('location', {href: 'https://docs.example.com/article'});
        mocks.translateWithCache.mockResolvedValue('译文');
        const handler = createPlatformMessageHandler(vi.fn());
        try {
            await handler({origin: 'agent', pageUrl: 'https://forged.example', glossaryContext: 'document'});
            expect(getTranslationGlossaryContext(mocks.translateWithCache.mock.calls[0][0])).toEqual({pageUrl: 'https://docs.example.com/article', context: 'page'});
            await handler({origin: 'agent', glossaryContext: 'video'});
            expect(getTranslationGlossaryContext(mocks.translateWithCache.mock.calls[1][0])).toEqual({pageUrl: 'https://docs.example.com/article', context: 'video'});
        } finally { vi.unstubAllGlobals(); }
    });
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('GM_info', undefined);
        vi.stubGlobal('GM', undefined);
        Object.assign(mocks.config, new Config());
        mocks.config.count = 0;
        mocks.translateWithCache.mockReset();
        mocks.saveConfig.mockResolvedValue(undefined);
        mocks.incrementUserscriptConfigCount.mockResolvedValue(14);
    });

    it('通过 userscript 专用副本累加，并避免把瞬时总数作为跨标签持久投影', async () => {
        mocks.config.count = 12;
        const handler = createPlatformMessageHandler(vi.fn());

        await expect(handler({
            type: CONFIG_COUNT_INCREMENT_MESSAGE,
            delta: 2,
            operationId: 'userscript-operation-1',
        })).resolves.toEqual({
            success: true,
            count: 14,
        });
        expect(mocks.incrementUserscriptConfigCount).toHaveBeenCalledWith(2, 'userscript-operation-1');
        expect(mocks.saveConfig).not.toHaveBeenCalled();
        expect(mocks.config.count).toBe(14);
    });

    it('拒绝无效计数增量或 operationId，且不写专用副本', async () => {
        const handler = createPlatformMessageHandler(vi.fn());

        await expect(handler({
            type: CONFIG_COUNT_INCREMENT_MESSAGE,
            delta: 0,
            operationId: 'userscript-operation-2',
        })).resolves.toEqual({
            success: false,
            error: '无效的翻译计数增量',
        });
        await expect(handler({
            type: CONFIG_COUNT_INCREMENT_MESSAGE,
            delta: 1,
            operationId: 'bad id',
        })).resolves.toEqual({
            success: false,
            error: '无效的翻译计数操作标识',
        });
        expect(mocks.incrementUserscriptConfigCount).not.toHaveBeenCalled();
        expect(mocks.saveConfig).not.toHaveBeenCalled();
    });


    describe.each([
        ['兼容', createPlatformMessageHandler],
        ['完整', createFullPlatformMessageHandler],
    ] as const)('%s userscript 三态隐私', (_name, createHandler) => {
        it.each([false, true, undefined])('typed/fallback quota 只信管理器隐私 %s，保留首次 await 前快照', async privacy => {
            vi.stubGlobal('GM_info', privacy === undefined ? undefined : {isIncognito: privacy});
            const handler = createHandler(vi.fn());
            mocks.translateWithCache.mockResolvedValue('翻译结果');
            try {
                const pending = handler({type: 'inputBoxTranslation', text: 'Hello', targetLang: 'ja',
                    clientRequestId: 'privacy-typed', privateContext: privacy !== true,
                    sender: {tab: {incognito: privacy !== true}}});
                // handler 在 ready 的 await 前已快照，后续元数据变化不得改变此请求。
                vi.stubGlobal('GM_info', {isIncognito: privacy !== true});
                await expect(pending).resolves.toMatchObject({success: true});
                const typedRequest = mocks.translateWithCache.mock.calls[0]![0];
                expect(getTranslationGlossaryContext(typedRequest)?.privateContext).toBe(privacy);
                expect(getTranslationRequestControl(typedRequest)).toBeDefined();
                vi.stubGlobal('GM_info', privacy === undefined ? undefined : {isIncognito: privacy});
                await handler({origin: 'ordinary alpha', targetLang: 'ja', privateContext: privacy !== true,
                    sender: {tab: {incognito: privacy !== true}}});
                const fallbackRequest = mocks.translateWithCache.mock.calls[1]![0];
                expect(getTranslationGlossaryContext(fallbackRequest)?.privateContext).toBe(privacy);
            } finally { if ('dispose' in handler && typeof handler.dispose === 'function') handler.dispose(); }
        });
    });

    it.each([true, undefined])('完整 userscript 隐私 %s 在任何词书 handler/数据库调用前拒绝', async privacy => {
        vi.stubGlobal('GM_info', privacy === undefined ? undefined : {isIncognito: privacy});
        const handler = createFullPlatformMessageHandler(vi.fn());
        try {
            for (const action of ['getByTerm', 'upsert', 'list', 'clear']) {
                await expect(handler({type: VOCABULARY_BOOK_MESSAGE, action,
                    privateContext: false, sender: {tab: {incognito: false}}})).resolves
                    .toMatchObject({success: false, error: {code: 'invalid-input'}});
            }
            for (const method of Object.values(mocks.vocabularyBook)) expect(method).not.toHaveBeenCalled();
        } finally { handler.dispose(); }
    });

    it('完整 userscript 明确普通模式仍读取与保存词书', async () => {
        vi.stubGlobal('GM_info', {isIncognito: false});
        Object.assign(mocks.config, {vocabularyBookEnabled: true});
        mocks.vocabularyBook.getByTerm.mockResolvedValue({id: 'normal-word'});
        mocks.vocabularyBook.upsert.mockResolvedValue({id: 'normal-word'});
        const handler = createFullPlatformMessageHandler(vi.fn());
        try {
            await expect(handler({type: VOCABULARY_BOOK_MESSAGE, action: 'getByTerm', sourceLanguage: 'en', term: 'art'}))
                .resolves.toMatchObject({success: true, data: {id: 'normal-word'}});
            await expect(handler({type: VOCABULARY_BOOK_MESSAGE, action: 'upsert', input: {
                sourceLanguage: 'en', targetLanguage: 'zh-Hans', term: 'art', translation: '艺术',
            }})).resolves.toMatchObject({success: true, data: {id: 'normal-word'}});
            expect(mocks.vocabularyBook.getByTerm).toHaveBeenCalledOnce();
            expect(mocks.vocabularyBook.upsert).toHaveBeenCalledOnce();
        } finally { handler.dispose(); }
    });

    describe.each([
        ['兼容', createPlatformMessageHandler],
        ['完整', createFullPlatformMessageHandler],
    ] as const)('%s userscript 输入框取消', (_name, createHandler) => {
        it('共享取消消息可以终止输入框的真实后台请求', async () => {
            let started!: () => void;
            const providerStarted = new Promise<void>(resolve => {started = resolve;});
            let signal!: AbortSignal;
            mocks.translateWithCache.mockImplementation(async (request) => {
                signal = getTranslationRequestControl(request)!.signal;
                started();
                return new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => {
                    const error = new Error('provider cancelled'); error.name = 'AbortError'; reject(error);
                }, {once: true}));
            });
            const handler = createHandler(vi.fn());
            const translation = handler({type: 'inputBoxTranslation', text: 'Hello', targetLang: 'ja', clientRequestId: 'userscript-input-active'});
            await providerStarted;
            await expect(handler({type: TRANSLATION_CANCEL_MESSAGE_TYPE, clientRequestId: 'userscript-input-active'}))
                .resolves.toMatchObject({success: true, cancelled: true});
            expect(signal.aborted).toBe(true);
            await expect(translation).resolves.toMatchObject({success: false, error: 'provider cancelled'});
            if ('dispose' in handler && typeof handler.dispose === 'function') handler.dispose();
        });

        it('先取消后触发不调用 provider，错误取消标识返回明确失败', async () => {
            const handler = createHandler(vi.fn());
            await expect(handler({type: TRANSLATION_CANCEL_MESSAGE_TYPE, clientRequestId: 'userscript-input-pending'}))
                .resolves.toMatchObject({success: true, cancelled: false});
            await expect(handler({type: 'inputBoxTranslation', text: 'Hello', targetLang: 'ja', clientRequestId: 'userscript-input-pending'}))
                .resolves.toMatchObject({success: false, error: '翻译请求已取消'});
            await expect(handler({type: TRANSLATION_CANCEL_MESSAGE_TYPE, clientRequestId: 'invalid id'}))
                .resolves.toMatchObject({success: false, error: '翻译请求 clientRequestId 格式无效'});
            expect(mocks.translateWithCache).not.toHaveBeenCalled();
            if ('dispose' in handler && typeof handler.dispose === 'function') handler.dispose();
        });
    });
});
