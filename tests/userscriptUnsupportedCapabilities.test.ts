import {describe, expect, it, vi} from 'vitest';
import * as materialCapture from '@/userscript/materialCapture';
// Node 配置不编译 Vue 组件；空运行契约应能独立加载，不需要 mock 设置 UI。
import {VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE as extensionTranscriptionStateMessage} from '@/src/features/video-subtitle/transcription';
import {
    toggleMangaTranslation,
    openMangaEntry,
    isMangaReaderPage,
    isImageTranslatorNeeded,
    mountMangaEntry,
    unmountMangaEntry,
    subscribeMangaTranslation,
    isAreaTranslatorMounted,
    isSupportedVideoPage,
    mountAreaTranslator,
    mountImageTranslator,
    mountVideoSubtitleTranslation,
    unmountAreaTranslator,
    unmountImageTranslator,
    mountVocabularyReencounter,
    unmountVocabularyReencounter,
    mountPersonalCorrections,
    unmountPersonalCorrections,
    VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE,
} from '@/userscript/unsupportedCapabilities';

describe('userscript extension-only capability stubs', () => {
    it('保留同一词书组件及导出集合，强制挂载材料回退只显示本地化不可用且不发消息', async () => {
        const book = {name: 'ActualVocabularyModulePort'}, materials = {name: 'ExtensionMaterialsPort'};
        const sendMessage = vi.fn();
        let language: 'en-US' | 'fr-FR' = 'en-US';
        vi.resetModules();
        const core = await import('@/src/core/i18n');
        const {UI_LANGUAGE_BUNDLES} = await import('@/userscript/languageBundles');
        for (const locale of ['en-US', 'fr-FR'] as const) core.registerUiLanguageBundle(locale, UI_LANGUAGE_BUNDLES[locale]);
        // 仅替换重型组件的模块载荷；原公共 barrel 与 userscript adapter 的实际导出连线仍执行。
        vi.doMock('@/src/features/vocabulary/ui/VocabularyBook.vue', () => ({default: book}));
        vi.doMock('@/src/features/vocabulary/ui/MaterialWorkspace.vue', () => ({default: materials}));
        vi.doMock('@/src/ui/i18n', () => ({useUiI18n: () => ({t: (key: string) => core.translate(key, language)})}));
        vi.doMock('webextension-polyfill', () => ({default: {runtime: {sendMessage}}}));
        try {
            const original = await import('@/src/features/vocabulary/ui/public');
            const adapter = await import('@/userscript/vocabularyUi');
            expect(Object.keys(adapter).sort()).toEqual(Object.keys(original).sort());
            expect(adapter.VocabularyBook).toBe(original.VocabularyBook);
            expect(adapter.VocabularyBook).toBe(book);
            expect(adapter.MaterialWorkspace).not.toBe(original.MaterialWorkspace);
            const render = adapter.MaterialWorkspace.setup();
            const english = render();
            expect(english.type).toBe('p');expect(english.props?.role).toBe('status');
            expect(english.children).toBe(core.translate('options.userscriptUnavailableDescription', language));
            language = 'fr-FR';
            expect(render().children).toBe(core.translate('options.userscriptUnavailableDescription', language));
            expect(render().children).not.toBe(english.children);
            await Promise.resolve();
            expect(sendMessage).not.toHaveBeenCalled();
        } finally {
            for (const id of ['@/src/features/vocabulary/ui/VocabularyBook.vue', '@/src/features/vocabulary/ui/MaterialWorkspace.vue', '@/src/ui/i18n', 'webextension-polyfill']) vi.doUnmock(id);
            vi.resetModules();
        }
    });
    it('材料只返回未关联，不读取原文或调用完成回调，也不导出假的持久化写口', async () => {
        const reads = vi.fn(() => {throw new Error('Unsupported material capture must not inspect its inputs');});
        const range = new Proxy({} as Range, {get: reads});
        const selection = new Proxy({source: {kind: 'article' as const, url: 'https://example.test/article', title: 'Source'}, locator: {kind: 'text' as const, quote: 'Source quote'}}, {get: reads});
        const isCurrent = vi.fn(() => true);
        expect(materialCapture.captureMaterialSelection(range, 'Source quote')).toBeUndefined();
        await expect(materialCapture.beginMaterialCapture(selection, false)).resolves.toBeUndefined();
        await expect(materialCapture.beginMaterialCapture(selection, true)).resolves.toBeUndefined();
        await expect(materialCapture.completeMaterialCapture({selection, generation: 1, capturedAt: 1}, {kind: 'note', id: 'fixture-note'}, isCurrent)).resolves.toBe(false);
        await expect(materialCapture.completeMaterialCapture(undefined, {kind: 'note', id: 'fixture-note'})).resolves.toBe(false);
        expect(reads).not.toHaveBeenCalled();
        expect(isCurrent).not.toHaveBeenCalled();
        expect(Object.keys(materialCapture).sort()).toEqual(['beginMaterialCapture', 'captureMaterialSelection', 'completeMaterialCapture']);
    });
    it('完整设置页复用同源字幕状态消息契约，同时保留字幕能力关闭状态', () => {
        expect(VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE).toBe(extensionTranscriptionStateMessage);
        expect(isSupportedVideoPage()).toBe(false);
        expect(mountVideoSubtitleTranslation()()).toBeUndefined();
    });

    it('never mounts area, image, or video runtimes', () => {
        expect(isAreaTranslatorMounted()).toBe(false);
        expect(mountAreaTranslator()).toBeUndefined();
        expect(mountImageTranslator()).toBeUndefined();
        expect(unmountAreaTranslator()).toBeUndefined();
        expect(unmountImageTranslator()).toBeUndefined();
        expect(mountVideoSubtitleTranslation()()).toBeUndefined();
        expect(isSupportedVideoPage()).toBe(false);
    });

    it('个人校订复用空适配器，不挂载面板或后台客户端', () => {
        expect(mountPersonalCorrections).toBe(mountVocabularyReencounter);
        expect(unmountPersonalCorrections).toBe(unmountVocabularyReencounter);
        expect(mountPersonalCorrections()).toBeUndefined();
        expect(unmountPersonalCorrections()).toBeUndefined();
    });
});

 it('漫画入口保持不可用且初始状态不会误显示已开启', async () => {
    const statuses: unknown[] = [];
    const unsubscribe = subscribeMangaTranslation(status => statuses.push(status));
    expect(statuses).toEqual([{available: false, active: false, pending: false, errors: 0}]);
    expect(toggleMangaTranslation()).toBe(false);
    expect(openMangaEntry()).toBe(false);
    expect(isMangaReaderPage()).toBe(false);
    expect(isImageTranslatorNeeded()).toBe(false);
    await expect(mountMangaEntry()).resolves.toBeUndefined();
    expect(unmountMangaEntry()).toBeUndefined();
    expect(unsubscribe()).toBeUndefined();
 });
