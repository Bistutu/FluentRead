import {translationSnapshot} from './helpers/localInferenceFixtures';
import {LOCAL_TRANSLATION_MODEL_IDS} from '@/src/core/config/localTranslation';
let withProviderSnapshot: typeof import('./helpers/providerSnapshot').withProviderSnapshot;
import {parseHTML} from 'linkedom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {BrowserCapabilities} from '@/src/platform/browser/capabilities';
import type {OffscreenDocumentApi, OffscreenMessage, OffscreenRuntimeApi} from '@/src/platform/offscreen/client';

const capabilities = vi.hoisted(() => ({} as BrowserCapabilities));
vi.mock('@/src/platform/browser/capabilities', async importOriginal => {
    const actual = await importOriginal<typeof import('@/src/platform/browser/capabilities')>();
    return {...actual, browserCapabilities: capabilities};
});
vi.mock('@/src/services/config/store', () => ({config: {
    from: 'auto', to: 'zh-Hans', uiLanguage: 'en-US',
    model: {localTranslation: 'Xenova/m2m100_418M'}, customModel: {},
}}));

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.resetModules();
});

async function browserPort(browser: string, extensionDom?: boolean) {
    vi.resetModules();
    vi.stubEnv('BROWSER', browser);
    ({withProviderSnapshot} = await import('./helpers/providerSnapshot'));
    const actual = await vi.importActual<typeof import('@/src/platform/browser/capabilities')>(
        '@/src/platform/browser/capabilities',
    );
    Object.assign(capabilities, actual.resolveBrowserCapabilities({
        browser, manifestVersion: browser === 'chrome' ? 3 : 2,
    }), extensionDom === undefined ? {} : {extensionDom});
    const document = parseHTML('<html><body></body></html>').document as unknown as Document;
    let nativeDocument = false;
    const messages: OffscreenMessage[] = [];
    const runtime: OffscreenRuntimeApi & {getURL(path: string): string} = {
        getContexts: vi.fn(async () => nativeDocument ? [{url: 'offscreen.html'}] : []),
        getURL: vi.fn(path => `moz-extension://audit48n/${path}`),
        sendMessage: vi.fn((message, callback) => {
            const envelope = message as OffscreenMessage;
            messages.push(envelope);
            if (browser === 'firefox') {
                expect(document.querySelector('#fluent-read-background-dom-runtime')).not.toBeNull();
            } else {
                expect(nativeDocument).toBe(true);
            }
            expect(envelope.target).toBe('offscreen');
            callback(envelope.type === 'FLUENT_READ_OFFSCREEN_READY'
                ? {success: true, ready: true}
                : {success: true, result: 'translated locally', ...translationSnapshot()});
        }),
    };
    const offscreen: OffscreenDocumentApi = {
        createDocument: vi.fn(async () => {nativeDocument = true;}),
        closeDocument: vi.fn(async () => {nativeDocument = false;}),
    };
    const runtimeGetter = vi.fn(() => runtime);
    const offscreenGetter = vi.fn(() => offscreen);
    vi.stubGlobal('chrome', {get runtime() {return runtimeGetter();}, get offscreen() {return offscreenGetter();}});
    vi.stubGlobal('document', document);
    return {document, runtime, offscreen, runtimeGetter, offscreenGetter, messages};
}

describe('implementation audit 48 N: userscript local translation boundary', () => {
    it.each([true, false])('拒绝 userscript，即使 extensionDom=%s，仍保留稳定原因且不调用真实适配器', async extensionDom => {
        await browserPort('userscript', extensionDom);
        const {localTranslationOffscreenAdapter} = await import('@/src/platform/offscreen/localTranslation');
        const send = vi.spyOn(localTranslationOffscreenAdapter, 'translate');
        const {default: translate} = await import('@/src/providers/translation/local-translation');
        await expect(translate(withProviderSnapshot({origin: 'Hello', sourceLanguage: 'en', targetLanguage: 'zh-Hans'}, {
    from: 'auto', to: 'zh-Hans', uiLanguage: 'en-US',
    model: {localTranslation: 'Xenova/m2m100_418M'}, customModel: {},
})))
            .rejects.toMatchObject({
                message: '当前浏览器不支持本地模型翻译，请切换到其他翻译服务',
                localTranslationErrorKey: 'settings.localTranslation.error.browser',
            });
        expect(send).not.toHaveBeenCalled();
    });

    it.each(['chrome', 'firefox'])('%s 保留原 capability guard，禁用时不调用真实适配器', async browser => {
        await browserPort(browser, false);
        const {localTranslationOffscreenAdapter} = await import('@/src/platform/offscreen/localTranslation');
        const send = vi.spyOn(localTranslationOffscreenAdapter, 'translate');
        const {default: translate} = await import('@/src/providers/translation/local-translation');
        await expect(translate(withProviderSnapshot({origin: 'Hello', sourceLanguage: 'en', targetLanguage: 'zh-Hans'}, {
    from: 'auto', to: 'zh-Hans', uiLanguage: 'en-US',
    model: {localTranslation: 'Xenova/m2m100_418M'}, customModel: {},
})))
            .rejects.toMatchObject({localTranslationErrorKey: 'settings.localTranslation.error.browser'});
        expect(send).not.toHaveBeenCalled();
    });

    it.each(['chrome', 'firefox'])('%s 的真实 provider 和默认工厂实例继续握手并发送本地翻译', async browser => {
        const port = await browserPort(browser);
        const {default: translate} = await import('@/src/providers/translation/local-translation');
        const controller = new AbortController();
        await expect(translate(withProviderSnapshot({origin: 'Hello', sourceLanguage: 'en', targetLanguage: 'zh-Hans',
            abortSignal: controller.signal, requestTimeoutMs: 12_000}, {
    from: 'auto', to: 'zh-Hans', uiLanguage: 'en-US',
    model: {localTranslation: 'Xenova/m2m100_418M'}, customModel: {},
})))
            .resolves.toBe('translated locally');
        expect(port.messages.map(message => message.type))
            .toEqual(['FLUENT_READ_OFFSCREEN_READY', 'LOCAL_TRANSLATION_TRANSLATE']);
        expect(port.messages[1]).toMatchObject({text: 'Hello', sourceLanguage: 'en', targetLanguage: 'zh-Hans'});
        expect(port.messages[1]).not.toHaveProperty('signal');
        if (browser === 'chrome') expect(port.offscreen.createDocument).toHaveBeenCalledOnce();
        else {
            expect(port.offscreen.createDocument).not.toHaveBeenCalled();
            expect(port.document.querySelectorAll('iframe')).toHaveLength(1);
        }
    });

    it.each(['chrome', 'firefox'])('%s 固定单例工厂初始化无外部副作用，使用后仍能查询与发送', async browser => {
        const port = await browserPort(browser);
        const createElement = vi.spyOn(port.document, 'createElement');
        const randomUUID = vi.spyOn(crypto, 'randomUUID');
        vi.useFakeTimers();
        const {chromeOffscreenClient, createOffscreenClient} = await import('@/src/platform/offscreen/client');
        const {extensionDomClient, createExtensionDomClient} = await import('@/src/platform/offscreen/extensionClient');
        const {localTranslationOffscreenAdapter, createLocalTranslationOffscreenAdapter} = await import('@/src/platform/offscreen/localTranslation');
        const getRuntime = vi.fn(() => port.runtime);
        const getDocument = vi.fn(() => port.document);
        const getOffscreen = vi.fn(() => port.offscreen);
        const explicit = createOffscreenClient({getRuntime, getOffscreen});
        const selected = createExtensionDomClient(capabilities, getRuntime, getDocument);
        const adapter = createLocalTranslationOffscreenAdapter();
        expect(adapter).not.toBe(localTranslationOffscreenAdapter);
        if (browser === 'chrome') {
            expect(extensionDomClient).toBe(chromeOffscreenClient);
            expect(selected).toBe(chromeOffscreenClient);
        } else expect(extensionDomClient).not.toBe(chromeOffscreenClient);
        expect(getRuntime).not.toHaveBeenCalled();
        expect(getDocument).not.toHaveBeenCalled();
        expect(getOffscreen).not.toHaveBeenCalled();
        expect(port.runtimeGetter).not.toHaveBeenCalled();
        expect(port.offscreenGetter).not.toHaveBeenCalled();
        expect(port.runtime.sendMessage).not.toHaveBeenCalled();
        expect(createElement).not.toHaveBeenCalled();
        expect(randomUUID).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        await expect(adapter.translate({model:LOCAL_TRANSLATION_MODEL_IDS.m2m100,text:'Hello',sourceLanguage:'en',targetLanguage:'zh'})).resolves.toBe('translated locally');
        await expect(extensionDomClient.hasDocument()).resolves.toBe(true);
        expect(randomUUID).toHaveBeenCalledOnce();
        expect(port.messages[1]).toMatchObject({type: 'LOCAL_TRANSLATION_TRANSLATE', text: 'Hello'});
        expect(vi.getTimerCount()).toBe(0);
        if (browser === 'chrome') await expect(explicit.hasDocument()).resolves.toBe(true);
        else expect(createElement).toHaveBeenCalledWith('iframe');
    });

    it.each(['translate', 'prepare', 'status', 'pause', 'remove'] as const)
    ('默认本地适配器 %s 保留失败详情和稳定兜底，不接受缺失响应', async operation => {
        const port = await browserPort('chrome');
        const {localTranslationOffscreenAdapter: adapter} = await import('@/src/platform/offscreen/localTranslation');
        const fallback = {
            translate: '本地翻译失败', prepare: '本地翻译模型下载失败', status: '无法读取本地翻译模型状态',
            pause: 'LOCAL_TRANSLATION_PAUSE_FAILED', remove: '本地翻译模型清除失败',
        }[operation];
        const invoke = () => operation === 'translate' ? adapter.translate({model:LOCAL_TRANSLATION_MODEL_IDS.m2m100,text:'Hello',sourceLanguage:'en',targetLanguage:'zh'})
            : operation === 'status' ? adapter.status() : adapter[operation]('Xenova/m2m100_418M');
        for (const response of [{success: false, error: 'executor failed'}, {success: false, error: ''},
            {success: false, error: 42}, undefined]) {
            vi.mocked(port.runtime.sendMessage).mockImplementation((message, callback) => {
                callback((message as OffscreenMessage).type === 'FLUENT_READ_OFFSCREEN_READY'
                    ? {success: true, ready: true} : response);
            });
            await expect(invoke()).rejects.toThrow(response && typeof response.error === 'string' ? response.error || fallback : '响应消息格式无效');
        }
        expect(port.offscreen.createDocument).toHaveBeenCalledOnce();
    });

    it('默认暂停适配器返回真实响应快照并保留模型及三十秒预算', async () => {
        const port = await browserPort('chrome');
        const {extensionDomClient} = await import('@/src/platform/offscreen/extensionClient');
        const send = vi.spyOn(extensionDomClient, 'send');
        const {localTranslationOffscreenAdapter: adapter} = await import('@/src/platform/offscreen/localTranslation');
        await expect(adapter.pause('Xenova/m2m100_418M')).resolves.toMatchObject({success: true});
        expect(port.messages[1]).toMatchObject({type: 'LOCAL_TRANSLATION_PAUSE', model: 'Xenova/m2m100_418M'});
        expect(send).toHaveBeenCalledWith({type: 'LOCAL_TRANSLATION_PAUSE', model: 'Xenova/m2m100_418M'}, {timeoutMs: 30_000});
        expect(port.offscreen.createDocument).toHaveBeenCalledOnce();
    });

    it.each(['failed', 'completed'] as const)
    ('原生创建超时后等待迟到 %s，再安全复用或重试，所有计时器均清理', async outcome => {
        const port = await browserPort('chrome');
        const {createOffscreenClient} = await import('@/src/platform/offscreen/client');
        const nativeCreate = vi.mocked(port.offscreen.createDocument).getMockImplementation()!;
        let settleCreate!: () => Promise<void>;
        vi.mocked(port.offscreen.createDocument).mockImplementationOnce(options => new Promise<void>((resolve, reject) => {
            settleCreate = async () => {
                if (outcome === 'failed') reject(new Error('native creation failed after timeout'));
                else {
                    await nativeCreate(options);
                    resolve();
                }
            };
        }));
        const client = createOffscreenClient({getRuntime: () => port.runtime, getOffscreen: () => port.offscreen,
            preparationTimeoutMs: 10, readyRetryAttempts: 1});
        vi.useFakeTimers();
        const first = expect(client.ensureDocument()).rejects.toThrow('Offscreen 文档准备超时');
        await vi.advanceTimersByTimeAsync(11);
        await first;
        const second = client.ensureDocument();
        await vi.advanceTimersByTimeAsync(1);
        expect(port.offscreen.createDocument).toHaveBeenCalledOnce();
        await settleCreate();
        await expect(second).resolves.toBeUndefined();
        expect(port.offscreen.createDocument).toHaveBeenCalledTimes(outcome === 'failed' ? 2 : 1);
        await expect(client.hasDocument()).resolves.toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
});
