/**
 * @file src/features/video-subtitle/content/readingAnnotationSession.ts
 * 文件职责：管理单个视频字幕挂载的读音标注请求、当前句优先级与有界内存缓存。
 * 主要内容：同文同语言合并请求，当前句到达时中止过期当前句与在途预取，少量预取顺序执行；缓存采用条数与字符总量双上限的 LRU，关闭、切媒体和销毁后拒绝迟到结果。
 * 模块边界：只调用注入的本地异步标注引擎，不读取配置、DOM、网络、播放器或翻译服务；可见句子的 DOM 提交资格仍由调用方的媒体及句子代次控制。
 */

import type {VideoReadingAnnotation} from '@/src/core/messaging/readingAnnotation';
export type {VideoReadingAnnotation} from '@/src/core/messaging/readingAnnotation';

export type VideoReadingAnnotator = (text: string, language: string, signal: AbortSignal) => Promise<VideoReadingAnnotation | null>;

interface SessionOptions {
  maxEntries?: number;
  maxCharacters?: number;
}

interface CacheEntry { value: VideoReadingAnnotation | null; characters: number }
interface ReadingJob {
  key: string;
  text: string;
  language: string;
  prefetch: boolean;
  controller: AbortController;
  promise: Promise<VideoReadingAnnotation | null>;
  resolve(value: VideoReadingAnnotation | null): void;
  reject(error: unknown): void;
  settled: boolean;
}

const MAX_INPUT_CHARACTERS = 3_000;
const MAX_QUEUED_PREFETCHES = 4;
const normalizeText = (text: string) => text.replace(/[\s\u3000]+/g, ' ').trim();
const normalizeLanguage = (language: string) => language.trim().toLowerCase().replace(/_/g, '-');
const makeKey = (text: string, language: string) => JSON.stringify([language, text]);
const positiveLimit = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
const aborted = () => Object.assign(new Error('读音标注已切换或关闭'), {name: 'AbortError'});

/** 一个挂载只保留一个执行中的任务；调用 cancelPending 可关闭，clear 可切换媒体，destroy 为永久释放。 */
export class VideoReadingAnnotationSession {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly jobs = new Map<string, ReadingJob>();
  private queue: ReadingJob[] = [];
  private active: ReadingJob | undefined;
  private characters = 0;
  private disposed = false;
  private visibleRevision = 0;
  private readonly maxEntries: number;
  private readonly maxCharacters: number;

  constructor(private readonly annotate: VideoReadingAnnotator, options: SessionOptions = {}) {
    this.maxEntries = positiveLimit(options.maxEntries, 160);
    this.maxCharacters = positiveLimit(options.maxCharacters, 64_000);
  }

  get revision(): number { return this.visibleRevision; }

  /** null 表示引擎确认此句无需/不能标注；undefined 表示尚无缓存。读取命中同时刷新 LRU。 */
  peek(text: string, language: string): VideoReadingAnnotation | null | undefined {
    const key = makeKey(normalizeText(text), normalizeLanguage(language));
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  request(text: string, language: string, prefetch = false): Promise<VideoReadingAnnotation | null> {
    if (this.disposed) return Promise.reject(aborted());
    const source = normalizeText(text), sourceLanguage = normalizeLanguage(language);
    if (!source || !sourceLanguage || source.length > MAX_INPUT_CHARACTERS) return Promise.resolve(null);
    const key = makeKey(source, sourceLanguage);

    // 当前句即使命中缓存，也要释放仍在执行的旧句，避免无用分词继续占用引擎。
    if (!prefetch) {
      for (const job of this.jobs.values()) {
        if (job.key !== key && (!job.prefetch || job === this.active)) this.cancel(job);
      }
    }
    const cached = this.peek(source, sourceLanguage);
    if (cached !== undefined) { this.pump(); return Promise.resolve(cached); }
    const existing = this.jobs.get(key);
    if (existing) {
      if (!prefetch && existing.prefetch) {
        existing.prefetch = false;
        if (existing !== this.active) this.queue = [existing, ...this.queue.filter(job => job !== existing)];
      }
      this.pump();
      return existing.promise;
    }

    let resolve!: ReadingJob['resolve'], reject!: ReadingJob['reject'];
    const promise = new Promise<VideoReadingAnnotation | null>((fulfill, fail) => { resolve = fulfill; reject = fail; });
    const job: ReadingJob = {key, text: source, language: sourceLanguage, prefetch,
      controller: new AbortController(), promise, resolve, reject, settled: false};
    this.jobs.set(key, job);
    if (prefetch) this.queue.push(job);
    else this.queue.unshift(job);
    const queuedPrefetches = this.queue.filter(item => item.prefetch);
    while (queuedPrefetches.length > MAX_QUEUED_PREFETCHES) this.cancel(queuedPrefetches.shift()!);
    this.pump();
    return promise;
  }

  /** 丢弃离开近期播放窗口的预取；当前句的工作资格不受预取窗口变化影响。 */
  retainPrefetches(sources: readonly {text: string; language: string}[]): void {
    const retained = new Set(sources.map(source => makeKey(normalizeText(source.text), normalizeLanguage(source.language))));
    for (const job of this.jobs.values()) if (job.prefetch && !retained.has(job.key)) this.cancel(job);
    this.pump();
  }

  cancelPending(): void {
    for (const job of this.jobs.values()) this.cancel(job);
    this.queue = [];
  }

  clear(): void {
    this.cancelPending();
    if (this.cache.size) this.visibleRevision += 1;
    this.cache.clear();
    this.characters = 0;
  }

  destroy(): void { this.disposed = true; this.clear(); }

  private cancel(job: ReadingJob): void {
    job.settled = true;
    job.controller.abort();
    this.jobs.delete(job.key);
    this.queue = this.queue.filter(item => item !== job);
    if (this.active === job) this.active = undefined;
    job.reject(aborted());
  }

  private pump(): void {
    if (this.disposed || this.active) return;
    const job = this.queue.shift();
    if (!job) return;
    this.active = job;
    // 先让同一轮的当前句选择完成；已取消的预取不再进入昂贵引擎。
    void Promise.resolve().then(() => job.settled ? null : this.annotate(job.text, job.language, job.controller.signal))
      .then(value => this.finish(job, value), error => this.finish(job, null, true, error));
  }

  private finish(job: ReadingJob, value: VideoReadingAnnotation | null, failed = false, error?: unknown): void {
    if (job.settled) return;
    job.settled = true;
    this.jobs.delete(job.key);
    this.active = undefined;
    if (failed) job.reject(error);
    else {
      const result = value ? Object.freeze({...value}) : null;
      const characters = job.key.length + (result?.text.length || 0);
      if (characters <= this.maxCharacters) {
        this.cache.set(job.key, {value: result, characters});
        this.characters += characters;
        this.visibleRevision += 1;
        while (this.cache.size > this.maxEntries || this.characters > this.maxCharacters) {
          const oldest = this.cache.keys().next().value!;
          this.characters -= this.cache.get(oldest)!.characters;
          this.cache.delete(oldest);
        }
      }
      job.resolve(result);
    }
    this.pump();
  }
}
