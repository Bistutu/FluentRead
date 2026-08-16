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
    getVideoServiceLabel,
    getVideoPretranslationWindowMs,
    isYouTubeVideoPage,
    normalizeVideoSubtitleDisplayMode,
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
            { textContent: '  This is ', contains: () => false },
            { textContent: 'a test.\n', contains: () => false },
            { textContent: '', contains: () => false },
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

    it('优先读取叶子字幕片段，避免 YouTube 嵌套节点重复拼接', () => {
        const child = { textContent: 'A subtitle.', contains: () => false };
        const parent = { textContent: 'A subtitle.', contains: (node: unknown) => node === child };
        const container = {
            querySelectorAll: () => [parent, child],
        } as unknown as Element;

        expect(readVisibleCaptionText(container)).toBe('A subtitle.');
    });

    it('存在原生字幕片段时忽略字幕设置等 captions-text 文本', () => {
        const subtitle = { textContent: 'the axioms and the basics.', contains: () => false };
        const settings = { textContent: '英语（自动生成）点击 查看设置', contains: () => false };
        const container = {
            querySelectorAll: (selector: string) => selector === VIDEO_CAPTION_SEGMENT_SELECTOR ? [subtitle] : [settings],
        } as unknown as Element;

        expect(readVisibleCaptionText(container)).toBe('the axioms and the basics.');
    });

    it('保留播放器菜单需要的三种显示模式，并为服务显示用户可读名称', () => {
        expect(normalizeVideoSubtitleDisplayMode('translation-only')).toBe('translation-only');
        expect(normalizeVideoSubtitleDisplayMode('original-only')).toBe('original-only');
        expect(normalizeVideoSubtitleDisplayMode('unknown')).toBe('bilingual');
        expect(getVideoServiceLabel('microsoft')).toBe('微软翻译');
        expect(getVideoServiceLabel('custom-service')).toBe('custom-service');
        expect(getVideoPretranslationWindowMs('microsoft')).toBe(10_000);
        expect(getVideoPretranslationWindowMs('openai')).toBe(30_000);
    });
});
