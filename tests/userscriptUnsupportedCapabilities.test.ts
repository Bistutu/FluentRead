import {describe, expect, it, vi} from 'vitest';
// Vitest 的 Node 配置不编译 Vue 组件；这里仅检验无浏览器 API 的运行时空适配器。
vi.mock('@/src/features/image-translation/ui/ImageOcrSettings.vue', () => ({default: {}}));
vi.mock('@/src/features/image-translation/ui/MangaSettings.vue', () => ({default: {}}));
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
    mountProgressiveReading,
    openProgressiveReading,
    unmountProgressiveReading,
} from '@/userscript/unsupportedCapabilities';

describe('userscript extension-only capability stubs', () => {
    it('渐进阅读空适配不访问页面或扩展能力，主动开启异步返回不支持', async () => {
        const sendMessage = vi.fn(), createElement = vi.fn(), addEventListener = vi.fn();
        vi.stubGlobal('browser', {runtime: {sendMessage}});
        vi.stubGlobal('document', {createElement, addEventListener});
        try {
            expect(mountProgressiveReading()).toBeUndefined();
            const opened = openProgressiveReading();
            expect(opened).toBeInstanceOf(Promise);
            await expect(opened).resolves.toBe(false);
            expect(unmountProgressiveReading()).toBeUndefined();
            expect(sendMessage).not.toHaveBeenCalled();
            expect(createElement).not.toHaveBeenCalled();
            expect(addEventListener).not.toHaveBeenCalled();
        } finally {vi.unstubAllGlobals();}
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
