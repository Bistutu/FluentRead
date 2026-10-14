/**
 * @file tests/pr906PrivacyAudit.test.ts
 * 文件职责：独立审计 PR906 的等待就绪边界、可信隐私快照和图像调度模型身份。
 * 主要内容：使用真实入口、快照、broker 与模板函数；只用内存 provider，不启动网络或模型。
 * 模块边界：本文件为审计夹具，不修改生产实现或现有测试期望。
 */
import {describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {resolveConfiguredModel, servicesType} from '@/src/core/config/catalog';
import {createImageGlossaryContext, type ImageGlossarySenderContext} from '@/src/app/background/imageGlossaryContext';
import {IMAGE_TRANSLATE_MESSAGE_TYPE, IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE} from '@/src/features/image-translation/background/handlers';
import {createTranslationRequestRegistry} from '@/src/app/background/handlers/translation';
import {createInputBoxTranslationHandler} from '@/src/features/input-translation/background/handler';
import {createTranslationBroker} from '@/src/services/translation/broker';
import {commonMsgTemplate} from '@/src/services/translation/templates';
import {
    attachTranslationGlossaryContext,
    attachTranslationImageInput,
    attachTranslationRequestControl,
    createTranslationProviderConfigSnapshot,
    createTranslationRequestSnapshot,
    getTranslationGlossaryContext,
    getTranslationImageInput,
    getTranslationProviderConfig,
    getTranslationRequestControl,
    getTranslationRequestScheduler,
} from '@/src/services/translation/requestSnapshot';
import {TRANSLATION_REQUEST_CONTROL, type TranslationRequestMessage, type TranslationSingleRequestMessage} from '@/src/services/translation/types';

const OFFSCREEN_URL = 'chrome-extension://audit/offscreen.html';
const IMAGE = 'data:image/png;base64,YQ==';
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {resolve = done;});
    return {promise, resolve};
}
function imageAdapter(ready: Promise<unknown>) {
    return createImageGlossaryContext<ImageGlossarySenderContext>({
        ready, offscreenUrl: OFFSCREEN_URL,
        getSourceLanguage: () => 'auto', getGlossaryRevision: () => 'fixture-revision',
    });
}
function brokerHarness(current: Config, provider: (message: TranslationRequestMessage) => Promise<string>, ready = Promise.resolve()) {
    return createTranslationBroker({
        ready, getConfig: () => current,
        // Registry 的开放字段签名在此收窄为测试传入的真实翻译请求，不复制或改写请求对象。
        providers: {openai: message => provider(message as unknown as TranslationRequestMessage)},
        cache: {get: async () => null, set: async () => true, clear: async () => {}, cleanup: async () => {}},
        serviceTypes: servicesType,
        endpointResolver: {resolveOpenAICompatibleEndpoint: () => ({endpoint: 'https://fixture.invalid/v1'}),
            aiSdkTransportProfile: 'fixture'},
        promptBuilder: {buildPageSummaryPrompt: text => text, buildPageSummarySystemPrompt: () => ''},
        getMissingCredentialMessage: () => null,
        getTranslationLanguages: request => ({sourceLanguage: request?.sourceLanguage ?? current.from,
            targetLanguage: request?.targetLanguage ?? current.to}),
        resolveConfiguredModel, buildTranslationCacheKey: identity => JSON.stringify(identity), logger: {warn: vi.fn()},
    });
}

describe('PR906 ready 前的请求与可信隐私边界', () => {
    it('canonical 请求快照复制数组并保留不可枚举取消 symbol 的完整描述符', () => {
        const signal = new AbortController().signal;
        const original = attachTranslationRequestControl({origin: ['Alpha'], glossaryIds: ['library-a']},
            {signal, ownershipKey: 'audit:original'});
        const copy = createTranslationRequestSnapshot(original);
        original.origin[0] = 'Changed';
        original.glossaryIds[0] = 'library-b';
        expect(copy).toMatchObject({origin: ['Alpha'], glossaryIds: ['library-a']});
        expect(getTranslationRequestControl(copy)).toBe(getTranslationRequestControl(original));
        expect(Object.getOwnPropertyDescriptor(copy, TRANSLATION_REQUEST_CONTROL))
            .toEqual(Object.getOwnPropertyDescriptor(original, TRANSLATION_REQUEST_CONTROL));
        expect(JSON.stringify(copy)).not.toContain('ownershipKey');
    });

    it('图片 wrapper 在 ready 前固定真实 sender/tab 隐私并忽略 payload 自报字段', async () => {
        const ready = deferred<void>();
        const handle = vi.fn(async (message: object, _context?: ImageGlossarySenderContext) => message);
        const [wrapped] = imageAdapter(ready.promise).wrap([{type: IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE, handle}]);
        const context = {sender: {url: 'https://original.example/article', tab: {incognito: true}}};
        const pending = wrapped.handle({type: IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE, privateContext: false} as never, context);
        context.sender.url = 'https://changed.example/';
        context.sender.tab.incognito = false;
        expect(handle).not.toHaveBeenCalled();
        ready.resolve();
        const result = await pending as object;
        expect(getTranslationGlossaryContext(result)).toEqual({
            pageUrl: 'https://original.example/article', context: 'page', privateContext: true,
        });
        expect(Object.isFrozen(getTranslationGlossaryContext(result))).toBe(true);
        expect(handle.mock.calls[0][1]).toMatchObject({sender: {tab: {incognito: true}}});
    });

    it('图片 wrapper 的 requestId/sourceLanguage 在 ready 前固定', async () => {
        const ready = deferred<void>();
        const handle = vi.fn(async (message: object) => message);
        const [wrapped] = imageAdapter(ready.promise).wrap([{type: IMAGE_TRANSLATE_MESSAGE_TYPE, handle}]);
        const message = {type: IMAGE_TRANSLATE_MESSAGE_TYPE, requestId: 'image-original', sourceLanguage: 'en'};
        const pending = wrapped.handle(message, {sender: {url: 'https://original.example/', tab: {incognito: true}}});
        message.requestId = 'image-mutated';
        message.sourceLanguage = 'ja';
        ready.resolve();
        await expect(pending).resolves.toMatchObject({requestId: 'image-original', sourceLanguage: 'en'});
    });

    it('图片 wrapper 继续传递 canonical 不可枚举取消 symbol', async () => {
        const ready = deferred<void>();
        const handle = vi.fn(async (message: object) => message);
        const [wrapped] = imageAdapter(ready.promise).wrap([{type: IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE, handle}]);
        const signal = new AbortController().signal;
        const message = attachTranslationRequestControl({type: IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE, texts: ['Alpha']},
            {signal, ownershipKey: 'audit:image'});
        const pending = wrapped.handle(message, {sender: {url: 'https://original.example/', tab: {incognito: true}}});
        ready.resolve();
        const result = await pending;
        expect(getTranslationRequestControl(result)).toBe(getTranslationRequestControl(message));
        expect(Object.getOwnPropertyDescriptor(result, TRANSLATION_REQUEST_CONTROL))
            .toEqual(Object.getOwnPropertyDescriptor(message, TRANSLATION_REQUEST_CONTROL));
    });

    it('输入框在 ready 前冻结文本/目标/隐私并把内部取消控制交给真实 translate', async () => {
        const ready = deferred<void>();
        const config = Object.assign(new Config(), {service: 'openai', aiRequestTimeoutMs: 180_000});
        let observed!: TranslationSingleRequestMessage;
        const translate = vi.fn(async (request: TranslationSingleRequestMessage) => {observed = request; return '译文';});
        const handler = createInputBoxTranslationHandler({ready: ready.promise, getConfig: () => config,
            translate, requestRegistry: createTranslationRequestRegistry()});
        const message = {type: 'inputBoxTranslation' as const, text: 'Alpha sentence.', targetLang: 'zh-Hans',
            clientRequestId: 'input-audit', requestTimeoutMs: 180_000};
        const context = {sender: {tab: {id: 7, incognito: true}}};
        const pending = handler.handle(message, context);
        message.text = 'Changed sentence.';
        message.targetLang = 'ja';
        message.requestTimeoutMs = 1_000;
        context.sender.tab.incognito = false;
        expect(translate).not.toHaveBeenCalled();
        ready.resolve();
        await expect(pending).resolves.toEqual({success: true, translatedText: '译文'});
        expect(observed).toMatchObject({origin: 'Alpha sentence.', targetLanguage: 'zh-Hans', requestTimeoutMs: 180_000});
        expect(getTranslationGlossaryContext(observed)).toEqual({privateContext: true});
        expect(getTranslationRequestControl(observed)).toMatchObject({signal: expect.any(AbortSignal)});
        expect(Object.getOwnPropertyDescriptor(observed, TRANSLATION_REQUEST_CONTROL)?.enumerable).toBe(false);
        expect(JSON.stringify(observed)).not.toContain('privateContext');
    });

    it('broker 等待 ready 时保留 canonical 取消 symbol，提前取消不启动 provider', async () => {
        const ready = deferred<void>();
        const provider = vi.fn(async () => '译文');
        const current = Object.assign(new Config(), {service: 'openai', enableAIContext: false, useCache: false});
        const broker = brokerHarness(current, provider, ready.promise);
        const controller = new AbortController();
        const message = attachTranslationRequestControl({origin: 'Alpha sentence.', useCache: false},
            {signal: controller.signal, ownershipKey: 'audit:broker'});
        const pending = broker.translateWithCache(message);
        const failure = expect(pending).rejects.toMatchObject({name: 'AbortError'});
        controller.abort();
        ready.resolve();
        await failure;
        expect(provider).not.toHaveBeenCalled();
    });
});

describe('PR906 图像实际模型调度身份', () => {
    it.each([
        ['vision-base（推荐）', undefined, 'vision-base'],
        ['vision-base（推荐）', 'vision-override（图像）', 'vision-override'],
        [' vision-base（推荐） ', ' vision-override（图像） ', 'vision-override'],
    ])('图像配置 %s / override %s 不被 customBody.model 分到其他 quota', async (configured, override, expected) => {
        const current = Object.assign(new Config(), {service: 'openai', enableAIContext: false, useCache: false,
            model: {openai: configured}, customBody: {openai: '{"model":"unrelated-body-model"}'}});
        let observed!: TranslationRequestMessage;
        const provider = vi.fn(async (message: TranslationRequestMessage) => {observed = message; return '译文';});
        const broker = brokerHarness(current, provider);
        const request = attachTranslationGlossaryContext(attachTranslationImageInput({
            origin: 'Alpha sentence.', useCache: false, ...(override ? {modelOverride: override} : {}),
        }, IMAGE), {privateContext: true});
        await expect(broker.translateWithCache(request)).resolves.toBe('译文');
        const identity = getTranslationRequestScheduler(observed)?.identity;
        expect(identity).toMatchObject({service: 'openai', model: expected});
        expect(identity?.quotaScope).toMatch(/^[a-f0-9]{64}$/u);
        const snapshot = getTranslationProviderConfig(observed, createTranslationProviderConfigSnapshot(current));
        const body = JSON.parse(commonMsgTemplate({current: snapshot, origin: String(observed.origin),
            serviceOverride: 'openai', targetLanguage: 'zh-Hans', modelOverride: observed.modelOverride,
            imageInput: getTranslationImageInput(observed)}));
        expect(String(body.model).trim()).toBe(expected);
        expect(body.model).not.toBe('unrelated-body-model');
        expect(JSON.stringify(body)).not.toContain('privateContext');
        expect(body.messages[1].content[1].image_url.url).toBe(IMAGE);
    });
});
