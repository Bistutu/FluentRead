import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {getCaptionPlatform, isMeetingCaptionPlatform, findCaptionEnableButton, findTeamsCaptionMenuStep, captionLanguageMatch, chooseTargetHumanCaptionTrack} from '@/src/features/video-subtitle/content/platforms';
import {YoutubeHumanCaptions} from '@/src/features/video-subtitle/content/youtubeHumanCaptions';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {getVideoTranslationConfigFingerprint} from '@/src/features/video-subtitle/content/subtitleLogic';

afterEach(() => { vi.useRealTimers(); });

describe('视频与会议字幕平台边界', () => {
    it.each([
        ['https://meet.google.com/abc-defg-hij', 'meet'],
        ['https://teams.microsoft.com/v2/', 'teams'], ['https://teams.live.com/meet/1', 'teams'],
        ['https://teams.cloud.microsoft/v2/', 'teams'], ['https://us02web.zoom.us/wc/1/join', 'zoom'],
        ['https://app.zoom.com/wc', 'zoom'], ['https://www.udemy.com/course/demo/learn/', 'udemy'],
        ['https://www.disneyplus.com/video/demo', 'disney'], ['https://zoom.us/pricing', null],
        ['https://zoom.us/rec/play/1', null], ['https://meet.google.com.evil.test/demo', null],
        ['https://udemy.com.evil.test/demo', null], ['https://youtube.com/watch?v=1', null],
    ])('识别 %s', (url, expected) => expect(getCaptionPlatform(new URL(url))).toBe(expected));

    it('只在三个会议平台自动开字幕', () => {
        for (const platform of ['meet', 'teams', 'zoom'] as const) expect(isMeetingCaptionPlatform(platform)).toBe(true);
        for (const platform of ['udemy', 'disney'] as const) expect(isMeetingCaptionPlatform(platform)).toBe(false);
    });

    it('不触发转录、录制、已开启、不可见或禁用按钮', () => {
        const {document} = parseHTML(`<main>
            <button aria-label="Start recording"></button><button aria-label="Start transcription"></button>
            <button aria-label="Turn on captions" disabled></button><button aria-label="Turn on captions" aria-disabled="true"></button>
            <button aria-label="Turn on captions" aria-pressed="true"></button><button aria-label="Turn on captions" aria-checked="true"></button>
            <div hidden><button aria-label="Turn on captions"></button></div>
            <button id="enable" aria-label="Turn on captions (c)"></button></main>`);
        expect(findCaptionEnableButton(document, 'meet')?.id).toBe('enable');
        expect(findCaptionEnableButton(document, 'udemy')).toBeNull();
        document.getElementById('enable')!.remove();
        expect(findCaptionEnableButton(document, 'meet')).toBeNull();
        document.body.innerHTML = '<button id="cn" data-tid="closed-caption-button">开启实时字幕</button><button>More actions</button>';
        expect(findCaptionEnableButton(document, 'teams')?.id).toBe('cn');
        document.body.innerHTML = '<button aria-label="Hide captions"></button><div aria-hidden="true"><button aria-label="Show captions"></button></div>';
        expect(findCaptionEnableButton(document, 'zoom')).toBeNull();
        document.body.innerHTML = '<button data-tid="closed-caption-button"></button>';
        expect(findCaptionEnableButton(document, 'teams')).toBeNull();
    });

    it('人工目标轨优先精确语言，区分中文简繁，排除自动生成和翻译轨', () => {
        expect(captionLanguageMatch('zh_CN', 'zh-Hans')).toBe(2);
        expect(captionLanguageMatch('zh-TW', 'zh-Hant')).toBe(2);
        expect(captionLanguageMatch('zh-HK', 'zh-Hans')).toBe(0);
        expect(captionLanguageMatch('en-US', 'en-GB')).toBe(1);
        expect(captionLanguageMatch('', 'en')).toBe(0);
        expect(captionLanguageMatch('en', '')).toBe(0);
        expect(captionLanguageMatch('en', 'auto')).toBe(0);
        expect(captionLanguageMatch('zh', 'zh-Hans')).toBe(1);
        expect(chooseTargetHumanCaptionTrack([], 'en')).toBeNull();
        const tracks = [
            {languageCode: 'zh-CN', kind: 'asr'}, {languageCode: 'zh-CN', generated: true},
            {languageCode: 'zh-CN', kind: 'machine'}, {languageCode: 'zh-CN', name: 'Chinese (auto-translated)'},
            {languageCode: 'zh-TW', name: 'Traditional Chinese'}, {languageCode: 'zh', name: 'Chinese'},
            {languageCode: 'zh-Hans', name: 'Simplified Chinese'},
        ];
        expect(chooseTargetHumanCaptionTrack(tracks, 'zh-CN')).toBe(tracks[6]);
        expect(chooseTargetHumanCaptionTrack(tracks, 'zh-Hant')).toBe(tracks[4]);
        expect(chooseTargetHumanCaptionTrack(tracks, 'ja')).toBeNull();
    });

    it('Teams 自动开启仅沿会议更多操作和语言菜单，不操作其他更多按钮', () => {
        const {document} = parseHTML('<html><body><button aria-label="More actions"></button></body></html>');
        expect(findTeamsCaptionMenuStep(document)).toBeNull();
        document.body.innerHTML += '<div role="menuitem"></div>';
        expect(findTeamsCaptionMenuStep(document)).toBeNull();
        document.body.innerHTML += '<button id="callingButtons-showMoreBtn"></button>';
        expect(findTeamsCaptionMenuStep(document)?.id).toBe('callingButtons-showMoreBtn');
        document.getElementById('callingButtons-showMoreBtn')!.setAttribute('aria-expanded', 'true');
        expect(findTeamsCaptionMenuStep(document)).toBeNull();
        document.body.innerHTML += '<div role="menuitem" aria-disabled="true">Language and speech</div><div hidden><div role="menuitem">Language and speech</div></div><div id="language" role="menuitem" aria-label="Language and speech"></div>';
        expect(findTeamsCaptionMenuStep(document)?.id).toBe('language');
        document.body.innerHTML = '<button data-tid="call-more-options" disabled></button>';
        expect(findTeamsCaptionMenuStep(document)).toBeNull();
        document.body.innerHTML = '<button data-tid="call-more-options" aria-disabled="true"></button>';
        expect(findTeamsCaptionMenuStep(document)).toBeNull();
        document.body.innerHTML = '<div hidden><button data-tid="call-more-options"></button></div>';
        expect(findTeamsCaptionMenuStep(document)).toBeNull();
    });

    it('新旧配置默认开启两个选项，明确关闭保留且影响字幕缓存指纹', () => {
        const defaults = new Config();
        expect(defaults.videoMeetingAutoEnabled).toBe(true);
        expect(defaults.videoPreferHumanSubtitles).toBe(true);
        for (const value of [{}, {videoMeetingAutoEnabled: 'false', videoPreferHumanSubtitles: 0}]) {
            const config = normalizeConfig(value);
            expect(config.videoMeetingAutoEnabled).toBe(true); expect(config.videoPreferHumanSubtitles).toBe(true);
        }
        const old = normalizeConfig({videoMeetingAutoEnabled: false, videoPreferHumanSubtitles: false});
        expect(old.videoMeetingAutoEnabled).toBe(false); expect(old.videoPreferHumanSubtitles).toBe(false);
        const before = getVideoTranslationConfigFingerprint(defaults);
        defaults.videoPreferHumanSubtitles = false;
        expect(getVideoTranslationConfigFingerprint(defaults)).not.toBe(before);
    });
});

function page(tracks: unknown[] = [{baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=zh-CN', languageCode: 'zh-CN'}]) {
    const {document} = parseHTML('<html><body></body></html>');
    const script = document.createElement('script');
    script.textContent = `var ytInitialPlayerResponse=${JSON.stringify({videoDetails: {videoId: 'abc'}, captions: {playerCaptionsTracklistRenderer: {captionTracks: tracks}}})};`;
    document.body.appendChild(script);
    return document;
}
const location = new URL('https://www.youtube.com/watch?v=abc');
const body = JSON.stringify({events: [{tStartMs: 0, dDurationMs: 1500, segs: [{utf8: '人工译文'}]}]});
const response = () => new Response(body);

describe('YouTube 目标语言人工字幕时间轴', () => {
    it('只请求一次并保留空档和截止时间，不把人工轨当作原文轨', async () => {
        const fetch = vi.fn().mockResolvedValue(response()), ready = vi.fn();
        const source = new YoutubeHumanCaptions(fetch, ready);
        expect(source.revision).toBe(0);
        expect(source.ownsUrl('invalid')).toBe(false);
        source.sync(page(), location, 'zh-Hans', true);
        source.sync(page(), location, 'zh-Hans', true);
        await source.ready();
        expect(fetch).toHaveBeenCalledTimes(1); expect(ready).toHaveBeenCalledOnce();
        expect(source.revision).toBe(1);
        expect(source.at(200)).toBe('人工译文'); expect(source.at(1500)).toBe('');
        expect(source.ownsUrl('https://www.youtube.com/api/timedtext?v=abc&lang=zh-CN&fmt=json3')).toBe(true);
        for (const url of ['bad-url', 'https://www.youtube.com/api/timedtext?v=xyz&lang=zh-CN',
            'https://www.youtube.com/api/timedtext?v=abc&lang=en', 'https://www.youtube.com/api/timedtext?v=abc&lang=zh-CN&tlang=en',
            'https://evil.test/api/timedtext?v=abc&lang=zh-CN', 'https://www.youtube.com/other?v=abc&lang=zh-CN',
            'https://www.youtube.com/api/timedtext?v=abc&lang=zh-CN&kind=asr']) expect(source.ownsUrl(url), url).toBe(false);
        source.sync(page(), location, 'zh-Hans', true);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(source.revision).toBe(1);
        source.sync(page(), location, 'zh-Hans', false);
        expect(source.revision).toBe(2);
        source.clear(); expect(source.revision).toBe(2);
        expect(source.at(200)).toBe(''); expect(source.ownsUrl('https://www.youtube.com/api/timedtext?v=abc&lang=zh-CN')).toBe(false);
    });

    it('按索引保留重叠cue最新开始、同起点首条、空档和精确截止语义', async () => {
        const cues = [
            {tStartMs: 0, dDurationMs: 10000, segs: [{utf8: 'Earlier active.'}]},
            {tStartMs: 1000, dDurationMs: 500, segs: [{utf8: 'Recent short.'}]},
            {tStartMs: 2000, dDurationMs: 8000, segs: [{utf8: 'Equal first.'}]},
            {tStartMs: 2000, dDurationMs: 8000, segs: [{utf8: 'Equal second.'}]},
        ];
        const source = new YoutubeHumanCaptions(vi.fn().mockResolvedValue(new Response(JSON.stringify({events: cues}))), vi.fn());
        source.sync(page(), location, 'zh-Hans', true); await source.ready();
        expect(source.at(-1)).toBe(''); expect(source.at(NaN)).toBe('');
        expect(source.at(1100)).toBe('Recent short.');
        expect(source.at(1800)).toBe('Earlier active.');
        expect(source.at(2500)).toBe('Equal first.'); expect(source.at(10000)).toBe('');
        source.clear(); expect(source.at(1100)).toBe('');
    });

    it.each(['bad', 'http://www.youtube.com/api/timedtext?v=abc&lang=zh-CN',
        'https://evil.test/api/timedtext?v=abc&lang=zh-CN', 'https://www.youtube.com/other?v=abc&lang=zh-CN'])('拒绝不安全轨道 %s', async url => {
        const fetch = vi.fn(), source = new YoutubeHumanCaptions(fetch, vi.fn());
        source.sync(page([{baseUrl: url, languageCode: 'zh-CN'}]), location, 'zh-Hans', true);
        await source.ready(); expect(fetch).not.toHaveBeenCalled();
    });

    it('无人工轨或非视频页不请求；失败和空响应退避后重试', async () => {
        vi.useFakeTimers();
        const fetch = vi.fn().mockResolvedValueOnce(new Response('', {status: 503})).mockResolvedValueOnce(new Response('{}')).mockResolvedValue(response());
        const source = new YoutubeHumanCaptions(fetch, vi.fn());
        source.sync(page([]), location, 'zh-Hans', true);
        source.sync(page(), new URL('https://youtube.com/'), 'zh-Hans', true);
        expect(fetch).not.toHaveBeenCalled();
        source.sync(page(), location, 'zh-Hans', true); await source.ready();
        source.sync(page(), location, 'zh-Hans', true); expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(5001);
        source.sync(page(), location, 'zh-Hans', true); await source.ready(); expect(fetch).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(5001);
        source.sync(page(), location, 'zh-Hans', true); await source.ready(); expect(source.at(10)).toBe('人工译文');
    });

    it('换语言、关闭和换视频后忽略旧响应及旧请求失败', async () => {
        let resolve!: (response: Response) => void;
        const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(yes => { resolve = yes; })).mockResolvedValue(response());
        const ready = vi.fn(), source = new YoutubeHumanCaptions(fetch, ready);
        source.sync(page(), location, 'zh-Hans', true);
        const pending = source.ready();
        const signal = fetch.mock.calls[0][1].signal;
        source.sync(page(), location, 'en', true);
        expect(signal.aborted).toBe(true);
        resolve(response()); await pending;
        expect(ready).not.toHaveBeenCalled(); expect(source.at(200)).toBe('');
        source.sync(page(), location, 'zh-Hans', true); await source.ready(); expect(source.at(10)).toBe('人工译文');
        source.clear();
        const fail = vi.fn().mockImplementation((_url, options) => new Promise((_yes, no) => options.signal.addEventListener('abort', () => no(new Error('aborted')))));
        const aborted = new YoutubeHumanCaptions(fail, ready);
        aborted.sync(page(), location, 'zh-Hans', true); const old = aborted.ready(); aborted.clear(); await old;
        expect(aborted.at(10)).toBe('');
    });
});
