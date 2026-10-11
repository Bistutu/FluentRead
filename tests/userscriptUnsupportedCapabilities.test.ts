import {describe, expect, it} from 'vitest';
import {VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE as transcriptionStateMessage} from '@/src/features/video-subtitle/transcription';
import {
    VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE,
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
} from '@/userscript/unsupportedCapabilities';

describe('userscript extension-only capability stubs', () => {
    it('preserves the local-video state query protocol consumed by settings without enabling its runtime', () => {
        expect({type: VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE}).toEqual({type: 'fluentReadGetLocalVideoModelState'});
        expect(VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE).toBe(transcriptionStateMessage);
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
