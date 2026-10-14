/**
 * @file src/features/video-subtitle/content/video-ai/subtitleSession.ts
 * 文件职责：拥有当前媒体的完整 AI 字幕缓存恢复请求、生成提交身份与销毁后的异步隔离。
 * 主要内容：按媒体、识别模型和来源语言去重恢复，取消旧请求的提交资格，保存生成开始时的独立身份快照，并允许同媒体元数据补全；只在原生字幕未就绪且播放器仍允许恢复时交付结果。
 * 模块边界：不操作视频播放、音轨、PCM 或模型 Worker；采集资源和真实转写传输仍由 capture 与 fullCapture 拥有，持久缓存读写通过注入的客户端端口完成。
 */
import {buildVideoAiSubtitleCacheIdentity, buildVideoAiSubtitleCacheKey, type VideoAiSubtitleCacheRequest} from '../../transcriptionCache';
import type {VideoSubtitleCue} from '../youtubeSubtitleData';

interface VideoAiSubtitleSessionOptions {
    readRequest: () => VideoAiSubtitleCacheRequest | null;
    canRestore: () => boolean;
    get: (request: VideoAiSubtitleCacheRequest) => Promise<VideoSubtitleCue[] | null>;
    set: (request: VideoAiSubtitleCacheRequest, cues: readonly VideoSubtitleCue[]) => Promise<void>;
    restore: (cues: VideoSubtitleCue[]) => boolean;
}

const snapshot = (request: VideoAiSubtitleCacheRequest): VideoAiSubtitleCacheRequest => ({...request, source: {...request.source}});
const requestKey = (request: VideoAiSubtitleCacheRequest | null): string | null => {
    const identity = request && buildVideoAiSubtitleCacheIdentity(request);
    return identity ? buildVideoAiSubtitleCacheKey(identity) : null;
};

export class VideoAiSubtitleSession {
    private disposed = false;
    private revision = 0;
    private lookup: {key: string; promise: Promise<boolean>} | undefined;
    private activeRequest: VideoAiSubtitleCacheRequest | null = null;
    private restored = false;

    constructor(private readonly options: VideoAiSubtitleSessionOptions) {}

    get isRestoring(): boolean { return Boolean(this.lookup); }
    get isRestored(): boolean { return this.restored; }

    /** 撤销恢复提交资格，不宣称后台缓存 transport 已结束，也不丢弃已展示字幕。 */
    invalidate(): void {
        this.revision += 1;
        this.lookup = undefined;
    }

    reset(): void {
        this.invalidate();
        this.activeRequest = null;
        this.restored = false;
    }

    beginGeneration(): void {
        this.reset();
        const request = !this.disposed && this.options.readRequest();
        if (request) this.activeRequest = snapshot(request);
    }

    /** 调用方确认仍是同一媒体后，才允许补全缓存身份；不更新识别模型或语言快照。 */
    updateMediaIdentity(): void {
        if (this.disposed || !this.activeRequest) return;
        const request = this.options.readRequest();
        if (request) this.activeRequest = {...this.activeRequest, source: {...request.source}};
    }

    persistCompleted(cues: readonly VideoSubtitleCue[]): void {
        if (this.disposed || !this.activeRequest || !cues.length) return;
        const request = snapshot(this.activeRequest);
        const completed = cues.map(cue => ({...cue}));
        // 缓存失败不会把已识别字幕改成失败；已经发送的提交只属于捕获时的完整身份。
        void Promise.resolve().then(() => this.options.set(request, completed)).catch(() => undefined);
    }

    restoreCached(): Promise<boolean> {
        if (this.disposed || !this.options.canRestore()) return Promise.resolve(false);
        const request = this.options.readRequest();
        const key = requestKey(request);
        if (!request || !key) return Promise.resolve(false);
        if (this.lookup?.key === key) return this.lookup.promise;
        const revision = ++this.revision;
        const captured = snapshot(request);
        const pending = Promise.resolve().then(() => this.disposed || revision !== this.revision
            ? null : this.options.get(captured)).then(cues => {
            if (!cues || this.disposed || revision !== this.revision || !this.options.canRestore()
                || key !== requestKey(this.options.readRequest())) return false;
            this.activeRequest = captured;
            this.restored = true;
            if (this.options.restore(cues)) return !this.disposed && revision === this.revision;
            if (revision === this.revision) {
                this.activeRequest = null;
                this.restored = false;
            }
            return false;
        }).catch(() => {
            if (revision === this.revision) {
                this.activeRequest = null;
                this.restored = false;
            }
            return false;
        }).finally(() => {
            if (this.lookup?.promise === pending) this.lookup = undefined;
        });
        this.lookup = {key, promise: pending};
        return pending;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.reset();
    }
}
