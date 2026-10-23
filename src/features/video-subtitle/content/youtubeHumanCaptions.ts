/**
 * @file src/features/video-subtitle/content/youtubeHumanCaptions.ts
 * 文件职责：读取 YouTube 目标语言人工字幕，供现有双语显示与下载优先使用。
 * 主要内容：选择当前视频的人工轨、以统一总时限及字节预算读取、取消过期请求、限制失败重试，并按播放时间读取目标语言原始时间轴。
 * 模块边界：网络函数由调用者注入，不切换原生字幕语言、不覆盖原文轨，也不调用翻译服务。
 */
import {chooseTargetHumanCaptionTrack} from './platforms';
import {readVideoCaptionText} from './subtitleTransport';
import {buildYoutubeTimedTextUrl, extractYoutubeCaptionTracks, getYoutubeVideoId, parseYoutubeTimedTextResponse, finalizeVideoSubtitleCues, type VideoSubtitleCue} from './youtubeSubtitleData';

export class YoutubeHumanCaptions {
    private key = '';
    private cues: VideoSubtitleCue[] = [];
    private maximumEnds: number[] = [];
    private controller: AbortController | undefined;
    private retryAt = 0;
    private pending: Promise<void> | undefined;
    private requestUrl = '';
    private visibleRevision = 0;
    /** 供原生轨道避免每秒遍历未变化的人工字幕。 */
    get revision(): number { return this.visibleRevision; }
    constructor(private readonly request: typeof fetch, private readonly onReady: () => void) {}

    sync(root: ParentNode, location: Pick<Location, 'hostname' | 'pathname' | 'search'>, target: string, enabled: boolean): void {
        const id = getYoutubeVideoId(location);
        const track = enabled && id ? chooseTargetHumanCaptionTrack(extractYoutubeCaptionTracks(root, id), target) : null;
        const key = track ? `${id}:${target}:${track.baseUrl}` : '';
        if (key !== this.key) { this.clear(); this.key = key; }
        if (!track || this.cues.length || this.pending || Date.now() < this.retryAt) return;
        let url: URL;
        try { url = new URL(buildYoutubeTimedTextUrl(track)); } catch { return; }
        // 初始化脚本是页面数据；只请求本站的 timedtext，不信任任意 baseUrl。
        if (url.protocol !== 'https:' || !/(^|\.)youtube\.com$/.test(url.hostname) || url.pathname !== '/api/timedtext') return;
        this.requestUrl = url.href;
        const controller = new AbortController();
        this.controller = controller;
        const pending = (async () => {
            try {
                const text = await readVideoCaptionText(url.href, this.request, {credentials: 'include', signal: controller.signal});
                const cues = finalizeVideoSubtitleCues(parseYoutubeTimedTextResponse(text));
                if (controller.signal.aborted || this.key !== key) return;
                if (!cues.length) throw new Error('人工字幕为空');
                this.cues = cues;
                let maximumEnd = 0;
                this.maximumEnds = cues.map(cue => (maximumEnd = Math.max(maximumEnd, cue.startMs + cue.durationMs)));
                this.visibleRevision += 1;
                this.onReady();
            } catch {
                if (!controller.signal.aborted && this.key === key) this.retryAt = Date.now() + 5000;
            }
        })();
        this.pending = pending;
        void pending.finally(() => { if (this.pending === pending) this.pending = undefined; });
    }

    at(timeMs: number): string {
        if (!Number.isFinite(timeMs)) return '';
        // finalized 时间轴按开始时间排序；二分跳过未来 cue，prefix end 跳过已全部结束的区间。
        // 原生轨批量构建会调用数千次，不能每句重新扫描全长人工字幕。
        let lower = 0, upper = this.cues.length;
        while (lower < upper) {
            const middle = (lower + upper) >>> 1;
            if (this.cues[middle].startMs <= timeMs) lower = middle + 1;
            else upper = middle;
        }
        let active: VideoSubtitleCue | undefined;
        for (let index = lower - 1; index >= 0 && this.maximumEnds[index] > timeMs; index -= 1) {
            const cue = this.cues[index];
            if (active && cue.startMs < active.startMs) break;
            // 同起点保留原有顺序；较新的短 cue 结束后仍可回到较早的有效长 cue。
            if (cue.startMs + cue.durationMs > timeMs) active = cue;
        }
        return active?.text || '';
    }

    ownsUrl(url: string): boolean {
        if (!this.requestUrl) return false;
        try {
            const parsed = new URL(url);
            const base = new URL(this.requestUrl);
            return parsed.origin === base.origin && parsed.pathname === base.pathname
                && parsed.searchParams.get('v') === base.searchParams.get('v')
                && parsed.searchParams.get('lang') === base.searchParams.get('lang')
                && parsed.searchParams.get('kind') === base.searchParams.get('kind')
                && !parsed.searchParams.has('tlang');
        } catch { return false; }
    }

    async ready(): Promise<void> { await this.pending; }

    clear(): void {
        this.controller?.abort();
        this.controller = undefined;
        this.pending = undefined;
        this.key = '';
        this.requestUrl = '';
        if (this.cues.length) this.visibleRevision += 1;
        this.cues = [];
        this.maximumEnds = [];
        this.retryAt = 0;
    }
}
