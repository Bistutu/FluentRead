/**
 * @file src/features/video-subtitle/offscreen/readingAnnotation.ts
 * 文件职责：拥有离屏页面中的唯一读音标注 Worker 与有界请求队列。
 * 主要内容：按需启动模块 Worker，串行处理有界请求，取消时立即结算页面等待但保留正在下载或初始化的共享词典；校验请求编号和回复语言，为首次下载保留有界等待，超时或 Worker 错误后回收实例以允许后续重试，空闲三十秒释放词典内存。
 * 模块边界：不在离屏主线程加载词典、分词或转写，不创建离屏文档；浏览器 Worker 创建由 app composition root 注入，纯消息契约由 core 拥有。
 */
import {isReadingAnnotationWorkerResponse, type ReadingAnnotationInput, type VideoReadingAnnotation} from '@/src/core/messaging/readingAnnotation';
import {isMessageRecord} from '@/src/core/messaging/validation';
import {READING_ANNOTATION_WORKER_TIMEOUT_MS} from '@/src/core/readingAnnotation';

interface Ports {createWorker(): Worker; timeoutMs?: number; idleMs?: number}
interface Job {
  id: number;
  input: ReadingAnnotationInput;
  signal?: AbortSignal;
  abort(): void;
  resolve(value: VideoReadingAnnotation | null): void;
  reject(error: unknown): void;
  settled: boolean;
}

const aborted = () => Object.assign(new Error('读音标注已取消'), {name: 'AbortError'});

export function createReadingAnnotationRuntime(ports: Ports) {
  let worker: Worker | undefined;
  let active: Job | undefined;
  let queue: Job[] = [];
  let sequence = 0;
  let disposed = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;

  const stopWorker = () => {
    if (timeout !== undefined) clearTimeout(timeout);
    if (idle !== undefined) clearTimeout(idle);
    timeout = undefined; idle = undefined;
    if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); worker = undefined; }
  };
  const settle = (job: Job, value: VideoReadingAnnotation | null, failed = false, error?: unknown) => {
    if (job.settled) return;
    job.settled = true;
    job.signal?.removeEventListener('abort', job.abort);
    if (failed) job.reject(error); else job.resolve(value);
  };
  const scheduleIdle = () => {
    if (!worker || active || queue.length || disposed) return;
    idle = setTimeout(stopWorker, ports.idleMs ?? 30_000);
  };
  const finish = (value: VideoReadingAnnotation | null, failed = false, error?: unknown) => {
    const job = active;
    if (!job) return;
    active = undefined;
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = undefined;
    settle(job, value, failed, error);
    pump();
  };
  const failWorker = (error: unknown) => { stopWorker(); finish(null, true, error); };
  const ensureWorker = () => {
    if (worker) return worker;
    const instance = ports.createWorker();
    worker = instance;
    instance.onmessage = event => {
      if (worker !== instance || !active) return;
      const value: unknown = event.data;
      if (!isMessageRecord(value) || value.id !== active.id) return;
      if (!isReadingAnnotationWorkerResponse(value)) { failWorker(new Error('读音标注 Worker 响应格式无效')); return; }
      if (!value.ok) { finish(null, true, new Error(value.error)); return; }
      if (value.result && value.result.language !== active.input.language) { failWorker(new Error('读音标注 Worker 响应语言不匹配')); return; }
      finish(value.result);
    };
    instance.onerror = () => { if (worker === instance) failWorker(new Error('读音标注 Worker 执行失败')); };
    instance.onmessageerror = () => { if (worker === instance) failWorker(new Error('读音标注 Worker 消息读取失败')); };
    return instance;
  };
  const pump = () => {
    if (active || disposed) return;
    const job = queue.shift();
    if (!job) { scheduleIdle(); return; }
    active = job;
    try {
      const instance = ensureWorker();
      timeout = setTimeout(() => failWorker(new Error('读音标注准备超时，请重试')), ports.timeoutMs ?? READING_ANNOTATION_WORKER_TIMEOUT_MS);
      instance.postMessage({id: job.id, ...job.input});
    } catch (error) { failWorker(error); }
  };

  return {
    annotate(input: ReadingAnnotationInput, signal?: AbortSignal): Promise<VideoReadingAnnotation | null> {
      if (disposed || signal?.aborted) return Promise.reject(aborted());
      if (queue.length >= 16) return Promise.reject(new Error('读音标注队列已满，请稍后重试'));
      if (idle !== undefined) clearTimeout(idle);
      idle = undefined;
      return new Promise((resolve, reject) => {
        // DTO 守卫允许信封字段；只复制正文与语言，内部 Worker 编号始终由本运行时分配。
        const job: Job = {id: ++sequence, input: {text: input.text, language: input.language}, signal, resolve, reject, settled: false, abort() {
          settle(job, null, true, aborted());
          queue = queue.filter(item => item !== job);
          // 在途 Worker 可能正在下载或初始化共享词典，等待其完成后再执行最新任务，避免换句反复重新下载。
          if (active !== job) pump();
        }};
        signal?.addEventListener('abort', job.abort, {once: true});
        queue.push(job);
        pump();
      });
    },
    dispose(): void {
      disposed = true;
      if (active) settle(active, null, true, aborted());
      for (const job of queue) settle(job, null, true, aborted());
      active = undefined; queue = [];
      stopWorker();
    },
  };
}
