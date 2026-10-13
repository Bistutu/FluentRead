/**
 * @file src/features/video-subtitle/content/translationScheduler.ts
 * 文件职责：限制视频字幕的翻译并发，避免预取字幕挤占当前播放句子的处理机会。
 * 主要内容：按原文合并等待者、提升当前句优先级、限制预取占用；总在途已满时跳过无法启动的等待队列整理，任务完成后仍按优先级调度；丢弃离开播放窗口的未启动预取，并在轨道切换时取消旧请求。
 * 模块边界：只调度注入的翻译函数，不读取配置、播放器或浏览器消息；调用方管理译文缓存与时间轴。
 */
interface TranslationJob {
    source: string;
    priority: number;
    started: boolean;
    controller: AbortController;
    promise: Promise<string>;
    resolve(value: string): void;
    reject(error: unknown): void;
}

export class VideoTranslationScheduler {
    private readonly jobs = new Map<string, TranslationJob>();
    private active = 0;

    constructor(private readonly translate: (source: string, signal: AbortSignal) => Promise<string>) {}

    request(source: string, prefetch = false): Promise<string> {
        const existing = this.jobs.get(source);
        if (existing) {
            if (!prefetch) existing.priority = 0;
            this.pump();
            return existing.promise;
        }
        let resolve!: TranslationJob['resolve'];
        let reject!: TranslationJob['reject'];
        const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
        const job: TranslationJob = {
            source, priority: prefetch ? 1 : 0, started: false,
            controller: new AbortController(), promise, resolve, reject,
        };
        this.jobs.set(source, job);
        this.pump();
        return promise;
    }

    clear(): void {
        const error = new Error('视频字幕轨道已切换');
        error.name = 'AbortError';
        for (const job of this.jobs.values()) {
            job.controller.abort();
            job.reject(error);
        }
        this.jobs.clear();
    }

    /** 跳转后移除尚未启动的旧预取，保留当前请求和正在进行的翻译。 */
    retainPrefetches(sources: ReadonlySet<string>): string[] {
        const removed: string[] = [];
        for (const [source, job] of this.jobs) {
            if (job.started || job.priority === 0 || sources.has(source)) continue;
            const error = new Error('字幕已离开预翻译窗口');
            error.name = 'AbortError';
            job.controller.abort();
            job.reject(error);
            this.jobs.delete(source);
            removed.push(source);
        }
        return removed;
    }

    private pump(): void {
        if (this.active >= 3) return;
        const waiting = [...this.jobs.values()].filter(job => !job.started)
            .sort((a, b) => a.priority - b.priority);
        for (const job of waiting) {
            // 预取最多占两路，第三路留给当前字幕；总在途任务也严格限制为三路。
            if (this.active >= (job.priority === 0 ? 3 : 2)) break;
            job.started = true;
            this.active += 1;
            void Promise.resolve().then(() => {
                if (job.controller.signal.aborted) throw new Error('字幕翻译已取消');
                return this.translate(job.source, job.controller.signal);
            }).then(job.resolve, job.reject).finally(() => {
                this.active -= 1;
                if (this.jobs.get(job.source) === job) this.jobs.delete(job.source);
                this.pump();
            });
        }
    }
}
