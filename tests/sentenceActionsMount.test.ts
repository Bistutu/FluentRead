/**
 * @file tests/sentenceActionsMount.test.ts
 * 文件职责：验证页面学习功能不再为悬停高亮挂载额外句子入口。
 * 主要内容：覆盖不同浏览器、逐句高亮和划词开关组合，确认句子操作归已有划词卡片；验证学习功能的完整注册顺序、词汇重遇的环境门控、分享与材料续读的动态配置、挂载参数及清理所有权，油猴构建排除材料和校订功能。
 * 模块边界：执行真实组合根，仅替换词汇重遇、分享、材料、写作、校订公开生命周期和浏览器端口；指针和选区由生产浏览器专项验证。
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Config} from '@/src/core/config/model';
import {resolveBrowserCapabilities} from '@/src/platform/browser/capabilities';
const ports = vi.hoisted(() => ({
    extension: {inIncognitoContext: false} as {inIncognitoContext: boolean} | undefined,
    mountMaterial: vi.fn(), disposeMaterial: vi.fn(),
    mountReencounter: vi.fn(), unmountReencounter: vi.fn(),
    mountShareCard: vi.fn(), unmountShareCard: vi.fn(), shareCardMounted: false,
}));
vi.mock('webextension-polyfill', () => ({default: {get extension() {return ports.extension;}}}));
vi.mock('@/src/features/vocabulary/material/content/public', () => ({mountMaterialContent: ports.mountMaterial}));
vi.mock('@/src/features/vocabulary/content/public', () => ({mountVocabularyReencounter: ports.mountReencounter, unmountVocabularyReencounter: ports.unmountReencounter}));
vi.mock('@/src/features/share-card/public', () => ({mountShareCard: ports.mountShareCard, unmountShareCard: ports.unmountShareCard, isShareCardMounted: () => ports.shareCardMounted}));
vi.mock('@/src/features/writing-assistant/public', () => ({
    mountWritingAssistant: vi.fn(), unmountWritingAssistant: vi.fn(), isWritingAssistantMounted: () => false,
}));
vi.mock('@/src/app/content/personalCorrections', () => ({mountPersonalCorrectionContent: vi.fn(), unmountPersonalCorrectionContent: vi.fn()}));
vi.mock('@/src/features/personal-corrections/public', () => ({unmountPersonalCorrections: vi.fn()}));
import {createLearningContentFeatures} from '@/src/app/content/learningFeatures';
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
beforeEach(() => {
    vi.clearAllMocks(); ports.extension = {inIncognitoContext: false};
    ports.shareCardMounted = false;
    ports.mountMaterial.mockReturnValue(ports.disposeMaterial);
});
afterEach(() => {vi.unstubAllEnvs(); vi.unstubAllGlobals();});

describe('sentence entry ownership', () => {
    it('油猴构建不登记材料或校订功能，避免引入空回调和管理面板', () => {
        vi.stubEnv('BROWSER', 'userscript');
        expect(createLearningContentFeatures({} as ContentScriptContext, new Config(), resolveBrowserCapabilities({browser: 'userscript', manifestVersion: 2})).map(feature => feature.id)).toEqual(['vocabulary-reencounter', 'writing-assistant', 'share-card']);
        vi.unstubAllEnvs();
    });
    it.each(['chrome', 'firefox', 'userscript'] as const)(
        'does not add a hover entry on %s regardless of highlight or selection preferences', browser => {
            for (const highlighted of [false, true]) {
                for (const selectionMode of ['disabled', 'bilingual'] as const) {
                    const config = Object.assign(new Config(), {
                        bilingualSentenceHighlightEnabled: highlighted, selectionTranslatorMode: selectionMode,
                    });
                    const features = createLearningContentFeatures({} as ContentScriptContext, config,
                        resolveBrowserCapabilities({browser, manifestVersion: browser === 'chrome' ? 3 : 2}));
                    expect(features.map(feature => feature.id)).toEqual(['vocabulary-reencounter', 'material-resume', 'personal-corrections', 'writing-assistant', 'share-card']);
                    const corrections = features.find(feature => feature.id === 'personal-corrections')!;
                    const writing = features.find(feature => feature.id === 'writing-assistant')!;
                    expect(config.personalCorrectionsEnabled).toBe(false);
                    expect(corrections.isEnabled()).toBe(false);
                    config.personalCorrectionsEnabled = true;
                    expect(corrections.isEnabled()).toBe(browser !== 'userscript' && config.on);
                    config.on = false;
                    expect(corrections.isEnabled()).toBe(false);
                    expect(writing.isEnabled()).toBe(false);
                }
            }
        },
    );

    it('excludes materials and enabled personal corrections from the userscript build even with injected extension capabilities', () => {
        vi.stubEnv('BROWSER', 'userscript');
        try {
            const config = Object.assign(new Config(), {personalCorrectionsEnabled: true});
            const features = createLearningContentFeatures({} as ContentScriptContext, config,
                resolveBrowserCapabilities({browser: 'chrome', manifestVersion: 3}));
            expect(features.map(feature => feature.id)).toEqual(['vocabulary-reencounter', 'writing-assistant', 'share-card']);
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it.each([
        ['chrome', true, false, true], ['firefox', true, false, true],
        ['userscript', true, false, false], ['chrome', false, false, false],
        ['chrome', true, true, false], ['chrome', true, undefined, true],
    ] as const)('材料续读 %s/on=%s/private=%s 的实际组合根门控为 %s', (browser, on, privateContext, enabled) => {
        ports.extension = privateContext === undefined ? undefined : {inIncognitoContext: privateContext};
        const config = Object.assign(new Config(), {on});
        const feature = createLearningContentFeatures({} as ContentScriptContext, config,
            resolveBrowserCapabilities({browser, manifestVersion: browser === 'chrome' ? 3 : 2})).find(item => item.id === 'material-resume')!;
        expect(feature.isEnabled()).toBe(enabled);
        expect(ports.mountMaterial).not.toHaveBeenCalled();
    });

    it('材料挂载前可安全卸载，公开挂载接收 document/signal 与实时配置回调并释放其 disposer', () => {
        const document = {nodeType: 9}; vi.stubGlobal('document', document);
        const ctx = {} as ContentScriptContext, config = new Config(), controller = new AbortController();
        const feature = createLearningContentFeatures(ctx, config,
            resolveBrowserCapabilities({browser: 'chrome', manifestVersion: 3})).find(item => item.id === 'material-resume')!;
        expect(() => feature.unmount!()).not.toThrow(); expect(ports.disposeMaterial).not.toHaveBeenCalled();
        feature.mount({ctx, signal: controller.signal, isCurrent: () => true});
        expect(ports.mountMaterial).toHaveBeenCalledOnce();
        expect(ports.mountMaterial).toHaveBeenCalledWith(document, controller.signal, expect.any(Function));
        const enabled = ports.mountMaterial.mock.calls[0][2] as () => boolean;
        expect(enabled()).toBe(true); config.on = false; expect(enabled()).toBe(false);
        expect(feature.isEnabled()).toBe(false); config.on = true; expect(enabled()).toBe(true);
        feature.unmount!(); expect(ports.disposeMaterial).toHaveBeenCalledOnce();
    });

    it.each([
        ['chrome', true, false, true], ['firefox', true, false, true],
        ['userscript', true, false, false], ['chrome', false, false, false],
        ['chrome', true, true, false],
    ] as const)('词汇重遇 %s/preference=%s/private=%s 保留原门控 %s', (browser, preference, privateContext, enabled) => {
        ports.extension = {inIncognitoContext: privateContext};
        const config = Object.assign(new Config(), {vocabularyReencounterEnabled: preference});
        const feature = createLearningContentFeatures({} as ContentScriptContext, config,
            resolveBrowserCapabilities({browser, manifestVersion: browser === 'chrome' ? 3 : 2})).find(item => item.id === 'vocabulary-reencounter')!;
        expect(feature.isEnabled()).toBe(enabled);
        config.vocabularyReencounterEnabled = false;
        expect(feature.isEnabled()).toBe(false);
        expect(ports.mountReencounter).not.toHaveBeenCalled();
    });

    it('词汇重遇使用实际激活上下文和信号，分享卡保留工厂上下文、开关与状态端口', () => {
        const ctx = {} as ContentScriptContext, activeCtx = {isInvalid: false} as ContentScriptContext;
        const config = new Config(), controller = new AbortController();
        const features = createLearningContentFeatures(ctx, config, resolveBrowserCapabilities({browser: 'chrome', manifestVersion: 3}));
        const reencounter = features.find(feature => feature.id === 'vocabulary-reencounter')!;
        const share = features.find(feature => feature.id === 'share-card')!;
        const runtime = {ctx: activeCtx, signal: controller.signal, isCurrent: () => true};
        reencounter.mount(runtime);
        expect(ports.mountReencounter).toHaveBeenCalledWith(activeCtx, controller.signal);
        reencounter.unmount!(); expect(ports.unmountReencounter).toHaveBeenCalledOnce();
        expect(share.isEnabled()).toBe(true); config.on = false; expect(share.isEnabled()).toBe(false);
        config.on = true; expect(share.isEnabled()).toBe(true);
        expect(share.isMounted!()).toBe(false); ports.shareCardMounted = true; expect(share.isMounted!()).toBe(true);
        share.mount(runtime); expect(ports.mountShareCard).toHaveBeenCalledWith(ctx);
        share.unmount!(); expect(ports.unmountShareCard).toHaveBeenCalledOnce();
    });
});
