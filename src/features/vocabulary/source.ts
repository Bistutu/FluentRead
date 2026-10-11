/**
 * @file src/features/vocabulary/source.ts
 * 文件职责：校验收藏视频片段的来源与原始时间点，并为学习中心构造可靠的回出处链接。
 * 主要内容：只接受 YouTube 视频 ID 和 X 帖子地址，剔除追踪参数与身份凭证；保留有限的原始毫秒范围，生成 YouTube 定位参数或 FluentRead 的 X 定位片段，以及没有可靠地址时的恢复状态。
 * 模块边界：纯领域函数不访问数据库、网络或播放器；内容运行时按自身生命周期恢复 X 时间点，UI 负责提示网站可能失效并允许读者按标题找回。
 */
import type {VocabularyContext, VocabularyEntry} from './learningModel';
import type {VocabularyVideoSource} from './protocol';

const MAX_VIDEO_TIME_MS = 7 * 24 * 60 * 60 * 1_000;

/** 非法平台、负数、非整数及无界时间全部丢弃；不把错误时间钳制成另一个片段。 */
export function sanitizeVocabularyVideoSource(value: unknown): VocabularyVideoSource | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
    const source = value as Record<string, unknown>;
    if (source.platform !== 'youtube' && source.platform !== 'x') return;
    if (typeof source.startMs !== 'number' || typeof source.endMs !== 'number'
        || !Number.isSafeInteger(source.startMs) || !Number.isSafeInteger(source.endMs)
        || source.startMs < 0 || source.endMs <= source.startMs || source.endMs > MAX_VIDEO_TIME_MS) return;
    return {platform: source.platform, startMs: source.startMs, endMs: source.endMs};
}

/** 来源仅允许明确的视频身份，不将本地、blob、搜索页或平台首页伪装成可跳转片段。 */
export function sanitizeVocabularyVideoUrl(value: unknown, platform: VocabularyVideoSource['platform']): string | undefined {
    if (typeof value !== 'string' || value.length > 2_048) return;
    let url: URL;
    try { url = new URL(value); } catch { return; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    if (url.username || url.password || url.port) return;
    if (platform === 'youtube') {
        let id: string | null;
        if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
        else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)) {
            id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|embed|live)\/([^/]+)\/?$/u.exec(url.pathname)?.[1] ?? null;
        } else return;
        return id && /^[a-zA-Z0-9_-]{11}$/u.test(id) ? `https://www.youtube.com/watch?v=${id}` : undefined;
    }
    if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(url.hostname)) return;
    const status = /^\/([a-zA-Z0-9_]{1,15})\/status\/(\d+)(\/video\/[1-9]\d*)?\/?$/u.exec(url.pathname);
    return status ? `https://x.com/${status[1]}/status/${status[2]}${status[3] ?? ''}` : undefined;
}

/** 优先展示最近的视频片段，句子本身没有额外挖空语境时也仍能回到出处。 */
export function vocabularySourceContext(entry: Pick<VocabularyEntry, 'contexts'>): VocabularyContext | undefined {
    let newest: VocabularyContext | undefined;
    for (const context of entry.contexts) {
        if ((context.video || context.sourceUrl) && (!newest || context.capturedAt >= newest.capturedAt)) newest = context;
    }
    return newest;
}

function formatTime(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1_000);
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export interface VocabularySourceLink {
    href?: string;
    timeLabel?: string;
    unavailable: boolean;
}

/** X 的 fragment 只由 FluentRead 恢复，不声称网站本身支持精确时间跳转。 */
export function vocabularySourceLink(context: Pick<VocabularyContext, 'sourceUrl' | 'video'> | undefined): VocabularySourceLink {
    if (!context) return {unavailable: false};
    const video = sanitizeVocabularyVideoSource(context.video);
    if (video) {
        const url = sanitizeVocabularyVideoUrl(context.sourceUrl, video.platform);
        const timeLabel = `${formatTime(video.startMs)}–${formatTime(video.endMs)}`;
        if (!url) return {timeLabel, unavailable: true};
        const position = video.platform === 'youtube' ? `&t=${video.startMs / 1_000}s` : `#fluentread-video=${video.startMs},${video.endMs}`;
        return {href: `${url}${position}`, timeLabel, unavailable: false};
    }
    if (!context.sourceUrl) return {unavailable: false};
    try {
        const url = new URL(context.sourceUrl);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return {unavailable: true};
        url.username = ''; url.password = '';
        return {href: url.toString(), unavailable: false};
    } catch { return {unavailable: true}; }
}
