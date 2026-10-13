/**
 * @file src/app/background/handlers/downloadProgress.ts
 * 文件职责：把离屏页面上报的模型与语言包下载进度转存到扩展本地存储，供设置页和网页内界面通过存储变化事件实时显示。
 * 主要内容：只接受本扩展离屏页面的进度消息并串行写入；结束时删除对应键；为同扩展内容脚本校验 tab 来源后只读单项进度，避免开放本地配置存储权限。
 * 模块边界：不发起、暂停或取消下载，不判断资源是否已就绪，也不广播所有标签页；存储与发送方身份由后台组合根注入。
 */
import {
    DOWNLOAD_PROGRESS_MESSAGE,
    DOWNLOAD_PROGRESS_QUERY_MESSAGE,
    downloadProgressKey,
    isDownloadProgressId,
    normalizeDownloadProgress,
    type DownloadProgress,
} from '@/src/core/download/progress';
import type {BackgroundMessageHandler} from '../messageRouter';

export interface DownloadProgressHandlerDependencies {
    readonly runtimeId: string;
    readonly offscreenUrl: string;
    readonly now?: () => number;
    readonly storage: {
        set(value: Record<string, unknown>): Promise<void>;
        remove(key: string): Promise<void>;
    };
}

/** 只暴露经过归一化的下载字节数，调用者不能指定任意存储键。 */
export function createDownloadProgressQueryHandler(dependencies: {
    readonly runtimeId: string;
    readonly storage: {get(key: string): Promise<Record<string, unknown>>};
}): BackgroundMessageHandler<unknown, {type: typeof DOWNLOAD_PROGRESS_QUERY_MESSAGE; id?: unknown; since?: unknown}, {success: boolean; progress?: DownloadProgress}> {
    return {
        type: DOWNLOAD_PROGRESS_QUERY_MESSAGE,
        async handle(message, context) {
            const sender = (context as {sender?: {id?: unknown; tab?: {id?: unknown}}} | undefined)?.sender;
            const tabId = sender?.tab?.id;
            const since = message.since;
            if (sender?.id !== dependencies.runtimeId || typeof tabId !== 'number' || !Number.isSafeInteger(tabId) || tabId < 0 || !isDownloadProgressId(message.id) || typeof since !== 'number' || !Number.isFinite(since) || since < 0) return {success: false};
            const key = downloadProgressKey(message.id);
            try {
                const stored = await dependencies.storage.get(key);
                const value = stored[key];
                const updatedAt = (value as {updatedAt?: unknown} | undefined)?.updatedAt;
                return {success: true, progress: typeof updatedAt === 'number' && Number.isFinite(updatedAt) && updatedAt >= since ? normalizeDownloadProgress(value) : undefined};
            } catch {
                return {success: false};
            }
        },
    };
}

interface IncomingDownloadProgressMessage {
    type: typeof DOWNLOAD_PROGRESS_MESSAGE;
    id?: unknown;
    progress?: unknown;
}

export function createDownloadProgressHandler(
    dependencies: DownloadProgressHandlerDependencies,
): BackgroundMessageHandler<unknown, IncomingDownloadProgressMessage, {success: boolean}> {
    // 结束通知必须排在最后一次进度之后落盘，否则订阅方会停在“仍在下载”。
    let writes: Promise<void> = Promise.resolve();
    const now = dependencies.now ?? Date.now;
    return {
        type: DOWNLOAD_PROGRESS_MESSAGE,
        async handle(message, context) {
            const sender = (context as {sender?: {id?: unknown; url?: unknown}} | undefined)?.sender;
            if (sender?.id !== dependencies.runtimeId || sender.url !== dependencies.offscreenUrl) return {success: false};
            const id = message.id;
            if (!isDownloadProgressId(id)) return {success: false};
            const finished = message.progress === undefined;
            const progress = normalizeDownloadProgress(message.progress);
            if (!finished && !progress) return {success: false};
            const key = downloadProgressKey(id);
            const write = writes.then(() => progress
                ? dependencies.storage.set({[key]: {...progress, updatedAt: now()}})
                : dependencies.storage.remove(key));
            writes = write.catch(() => undefined);
            await writes;
            return {success: true};
        },
    };
}
