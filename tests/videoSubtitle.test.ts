import { describe, expect, it, vi } from 'vitest';

vi.mock('@wxt-dev/storage', () => ({
    storage: {
        getItem: vi.fn().mockResolvedValue(null),
        setItem: vi.fn().mockResolvedValue(undefined),
        watch: vi.fn().mockReturnValue(() => undefined),
    },
}));
vi.mock('webextension-polyfill', () => ({
    default: { runtime: { sendMessage: vi.fn() } },
}));
import {
    isYouTubeVideoPage,
    readVisibleCaptionText,
    VIDEO_CAPTION_SEGMENT_SELECTOR,
} from '@/entrypoints/main/videoSubtitle';

describe('YouTube 视频字幕识别', () => {
    it('只把 YouTube 视频页识别为视频字幕目标', () => {
        expect(isYouTubeVideoPage({ hostname: 'www.youtube.com', pathname: '/watch' })).toBe(true);
        expect(isYouTubeVideoPage({ hostname: 'youtube-nocookie.com', pathname: '/watch' })).toBe(true);
        expect(isYouTubeVideoPage({ hostname: 'www.youtube.com', pathname: '/results' })).toBe(false);
        expect(isYouTubeVideoPage({ hostname: 'example.com', pathname: '/watch' })).toBe(false);
    });

    it('按播放器中的字幕片段合并文本，并忽略空片段', () => {
        const segments = [
            { textContent: '  This is ' },
            { textContent: 'a test.\n' },
            { textContent: '' },
        ];
        const container = {
            querySelectorAll: (selector: string) => {
                expect(selector).toBe(VIDEO_CAPTION_SEGMENT_SELECTOR);
                return segments;
            },
        } as unknown as Element;

        expect(readVisibleCaptionText(container)).toBe('This is a test.');
        expect(readVisibleCaptionText(null)).toBe('');
    });
});
