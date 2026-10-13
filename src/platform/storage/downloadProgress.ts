/**
 * @file src/platform/storage/downloadProgress.ts
 * 文件职责：让设置页、圈选卡片和播放器菜单订阅后台转存的下载进度，在任何扩展上下文里都能看到同一份真实进度。
 * 主要内容：受信扩展页监听本地存储变化；无法访问该存储的 content 在下载期间有界串行查询单项进度，停止后拒绝迟到结果。
 * 模块边界：不写存储、不发起下载；查询不暴露配置，是否显示“下载中”由调用方结合自己的请求状态判断，临时传输失败不清空已有进度。
 */
import {DOWNLOAD_PROGRESS_QUERY_MESSAGE, downloadProgressKey, isDownloadProgressId, normalizeDownloadProgress, type DownloadProgress} from '@/src/core/download/progress';

interface StorageChangeEvents {
    addListener(listener: (changes: Record<string, {newValue?: unknown}>, areaName: string) => void): void;
    removeListener(listener: (changes: Record<string, {newValue?: unknown}>, areaName: string) => void): void;
}

/**
 * 只有正在进行的下载才会产生变化事件，因此收到进度即可认为下载仍在进行；
 * 上次会话残留的键不会触发回调，不会把界面卡在“下载中”。
 */
export function watchDownloadProgress(
    ids: readonly string[],
    listener: (id: string, progress: DownloadProgress | undefined) => void,
    events: StorageChangeEvents = browser.storage.onChanged,
): () => void {
    const keys = ids.map(id => [downloadProgressKey(id), id] as const);
    const handleChange = (changes: Record<string, {newValue?: unknown}>, areaName: string) => {
        if (areaName !== 'local') return;
        for (const [key, id] of keys) {
            if (Object.hasOwn(changes, key)) listener(id, normalizeDownloadProgress(changes[key].newValue));
        }
    };
    events.addListener(handleChange);
    return () => events.removeListener(handleChange);
}

/** 仅在调用方确实下载时订阅；无并发查询，且最长十分钟后自动释放计时器。 */
export function watchContentDownloadProgress(
    id: string,
    listener: (progress: DownloadProgress | undefined) => void,
    sendMessage: (message: {type: typeof DOWNLOAD_PROGRESS_QUERY_MESSAGE; id: string; since: number}) => Promise<unknown> = message => browser.runtime.sendMessage(message),
): () => void {
    if (!isDownloadProgressId(id)) return () => undefined;
    const since = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
        stopped = true;
        clearTimeout(timer);
        clearTimeout(deadline);
    };
    const deadline = setTimeout(stop, 600_000);
    const poll = async () => {
        try {
            const response = await sendMessage({type: DOWNLOAD_PROGRESS_QUERY_MESSAGE, id, since});
            if (!stopped && response && typeof response === 'object' && (response as {success?: unknown}).success === true) {
                const raw = (response as {progress?: unknown}).progress;
                const progress = normalizeDownloadProgress(raw);
                if (raw === undefined || progress) listener(progress);
            }
        } catch { /* 读失败保留最后进度，下一次串行查询可恢复。 */ }
        if (!stopped) timer = setTimeout(() => {void poll();}, 500);
    };
    void poll();
    return stop;
}
