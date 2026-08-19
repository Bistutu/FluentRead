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
    isXVideoPage,
    isSupportedVideoPage,
    isIncrementalVideoCaption,
    normalizeVideoSubtitleDisplayMode,
    normalizeVideoCaptionText,
    readVisibleCaptionText,
    revealVideoSubtitleTranslation,
    mergeVideoAiSubtitleCues,
    getVisibleVideoAiCue,
    VIDEO_CAPTION_SEGMENT_SELECTOR,
} from '@/entrypoints/main/videoSubtitle';
import { normalizeVideoSubtitleFontSize } from '@/entrypoints/utils/model';

describe('YouTube 视频字幕识别', () => {
    it('只把 YouTube 视频页识别为视频字幕目标', () => {
        expect(isYouTubeVideoPage({ hostname: 'www.youtube.com', pathname: '/watch' })).toBe(true);
        expect(isYouTubeVideoPage({ hostname: 'youtube-nocookie.com', pathname: '/watch' })).toBe(true);
        expect(isYouTubeVideoPage({ hostname: 'www.youtube.com', pathname: '/results' })).toBe(false);
        expect(isYouTubeVideoPage({ hostname: 'example.com', pathname: '/watch' })).toBe(false);
    });

    it('识别 X/Twitter status 视频页，同时拒绝普通时间线', () => {
        expect(isXVideoPage({ hostname: 'x.com', pathname: '/cerebras/status/2089870131291943228' })).toBe(true);
        expect(isXVideoPage({ hostname: 'twitter.com', pathname: '/cerebras/status/2089870131291943228/' })).toBe(true);
        expect(isXVideoPage({ hostname: 'x.com', pathname: '/home' })).toBe(false);
        expect(isSupportedVideoPage({ hostname: 'x.com', pathname: '/cerebras/status/2089870131291943228' })).toBe(true);
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
        expect(normalizeVideoSubtitleFontSize(undefined)).toBe(100);
        expect(normalizeVideoSubtitleFontSize(125)).toBe(130);
        expect(normalizeVideoSubtitleFontSize(10)).toBe(80);
        expect(normalizeVideoSubtitleFontSize(200)).toBe(160);
    });

    it('按原生字幕已经显示的前缀揭示完整 cue 的译文，并保留一次性完整字幕的整句结果', () => {
        const fullSource = 'understand from [music] the axioms and the basics.';
        const fullTranslation = '从音乐中理解公理和基础。';

        expect(normalizeVideoCaptionText('  understand\nfrom   [music]  ')).toBe('understand from [music]');
        expect(revealVideoSubtitleTranslation(fullTranslation, 'understand', fullSource)).toBe('从音乐');
        expect(revealVideoSubtitleTranslation(fullTranslation, 'understand from [music] the axioms and', fullSource)).toBe('从音乐中理解公理和基');
        expect(revealVideoSubtitleTranslation(fullTranslation, fullSource, fullSource)).toBe(fullTranslation);
        expect(revealVideoSubtitleTranslation(fullTranslation, 'unrelated subtitle', fullSource)).toBe(fullTranslation);
    });

    it('识别逐词前缀并允许播放器改用完整原文 cue', () => {
        expect(isIncrementalVideoCaption('understand from', 'understand from [music] the axioms and the basics.')).toBe(true);
        expect(isIncrementalVideoCaption('understand from [music] the axioms and the basics.', 'understand from [music] the axioms and the basics.')).toBe(false);
        expect(isIncrementalVideoCaption('unrelated subtitle', 'understand from [music] the axioms and the basics.')).toBe(false);
    });

    it('合并 Whisper 分片边界的重复 cue，并在真实时间轴外及时清除', () => {
        const cues = mergeVideoAiSubtitleCues([
            { startMs: 0, durationMs: 1800, text: 'Hello world' },
            { startMs: 1700, durationMs: 800, text: 'Hello world' },
            { startMs: 2400, durationMs: 1000, text: 'Next sentence' },
        ]);

        expect(cues).toHaveLength(2);
        expect(cues[0]).toMatchObject({ startMs: 0, text: 'Hello world' });
        expect(cues[0].durationMs).toBe(2400);
        expect(getVisibleVideoAiCue(cues, 2450)?.text).toBe('Next sentence');
        expect(getVisibleVideoAiCue(cues, 4050)).toBeNull();
    });

    it('填补短时间戳空隙，并让后一句在重叠处稳定接管', () => {
        const cues = mergeVideoAiSubtitleCues([
            { startMs: 0, durationMs: 900, text: 'First sentence' },
            { startMs: 1_300, durationMs: 900, text: 'Second sentence' },
            { startMs: 1_600, durationMs: 700, text: 'Third sentence' },
        ]);

        expect(cues[0]).toMatchObject({ startMs: 0, durationMs: 1_300, text: 'First sentence' });
        expect(cues[1]).toMatchObject({ startMs: 1_300, durationMs: 500, text: 'Second sentence' });
        expect(getVisibleVideoAiCue(cues, 1_200)?.text).toBe('First sentence');
        expect(getVisibleVideoAiCue(cues, 1_650)?.text).toBe('Third sentence');
    });
});
