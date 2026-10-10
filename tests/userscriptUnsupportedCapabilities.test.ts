import {describe, expect, it} from 'vitest';
import {VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE as extensionTranscriptionStateMessage} from '@/src/features/video-subtitle/transcription';
// Node 配置不编译 Vue 组件；空运行契约应能独立加载，不需要 mock 设置 UI。
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
