/**
 * @file src/platform/storage/modelArtifacts.ts
 * 文件职责：为按需模型复用固定版本、分块磁盘缓存和内容校验下载能力。
 * 主要内容：4MiB 分块、Range 续传、多来源回退、流式 SHA-256 校验及离线 Response 重建；就绪只认完整校验收据。
 * 模块边界：不认识 feature、模型算法或页面正文，不清空其他模型缓存，不执行远程代码。
 */
import {sha256} from '@noble/hashes/sha256';
import {huggingFaceDownloadOrigins} from '@/src/platform/http/modelDownloads';
export interface ModelArtifact {url: string; size: number; sha256: string}
export const MODEL_ARTIFACT_CHUNK_BYTES = 4 * 1024 * 1024;
function active(signal?: AbortSignal): void {if (signal?.aborted) throw new DOMException('模型下载已暂停', 'AbortError');}
export function createModelArtifactStore(cacheName: string, files: readonly ModelArtifact[]) {
    const part = (file: ModelArtifact, index: number) => `${file.url}?fluent-read-part=${index}`;
    const receipt = (file: ModelArtifact) => `${file.url}?fluent-read-verified=${file.sha256}`;
    const open = () => caches.open(cacheName);
    // 校验收据并读取实际块只做一遍；customCache.match 不再先 complete、再 blob 内 complete、再读第三遍。
    const preparedBlob = async (file: ModelArtifact): Promise<Blob | undefined> => {
        const cache = await open(), response = await cache.match(receipt(file));
        if (!response) return undefined;
        const verified = await response.json().catch(() => undefined) as {size?: number; sha256?: string} | undefined;
        if (verified?.size !== file.size || verified.sha256 !== file.sha256) return undefined;
        const parts: Blob[] = [];
        for (let i = 0; i < Math.ceil(file.size / MODEL_ARTIFACT_CHUNK_BYTES); i++) {
            const value = await cache.match(part(file, i));
            if (!value) return undefined;
            const bytes = await value.blob();
            if (bytes.size !== Math.min(MODEL_ARTIFACT_CHUNK_BYTES, file.size - i * MODEL_ARTIFACT_CHUNK_BYTES)) return undefined;
            parts.push(bytes);
        }
        return new Blob(parts);
    };
    const complete = async (file: ModelArtifact) => Boolean(await preparedBlob(file));
    const downloaded = async (file: ModelArtifact) => {
        const cache = await open(); let bytes = 0;
        for (let index = 0; bytes < file.size; index++) {
            const value = await cache.match(part(file, index));
            if (!value || Number(value.headers.get('Content-Length')) !== Math.min(MODEL_ARTIFACT_CHUNK_BYTES, file.size - bytes)) break;
            bytes += Number(value.headers.get('Content-Length'));
        }
        return bytes;
    };
    const remove = async (file: ModelArtifact) => {
        const cache = await open(); await cache.delete(receipt(file));
        for (let i = 0; i < Math.ceil(file.size / MODEL_ARTIFACT_CHUNK_BYTES); i++) await cache.delete(part(file, i));
    };
    const blob = async (file: ModelArtifact) => {
        const result = await preparedBlob(file);
        if (!result) throw new Error('MODEL_NOT_DOWNLOADED');
        return result;
    };
    const verify = async (file: ModelArtifact, signal: AbortSignal) => {
        const cache = await open(), digest = sha256.create();
        for (let i = 0; i < Math.ceil(file.size / MODEL_ARTIFACT_CHUNK_BYTES); i++) {
            active(signal); const value = await cache.match(part(file, i));
            if (!value) throw new Error('MODEL_INTEGRITY');
            digest.update(new Uint8Array(await value.arrayBuffer()));
        }
        const hash = Array.from(digest.digest(), value => value.toString(16).padStart(2, '0')).join('');
        if (hash !== file.sha256) {await remove(file); throw new Error('MODEL_INTEGRITY');}
        active(signal); await cache.put(receipt(file), new Response(JSON.stringify({size: file.size, sha256: hash}))); active(signal);
    };
    const receive = async (file: ModelArtifact, origin: string, signal: AbortSignal, progress: (bytes: number, verifying: boolean) => void) => {
        let offset = await downloaded(file);
        if (offset === file.size) {progress(offset, true); await verify(file, signal); return;}
        const controller = new AbortController(), abort = () => controller.abort();
        signal.addEventListener('abort', abort, {once: true});
        let timer: ReturnType<typeof setTimeout> | undefined;
        const arm = (ms: number) => {clearTimeout(timer); timer = setTimeout(abort, ms);};
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
            active(signal); arm(20_000);
            const response = await fetch(file.url.replace('https://huggingface.co', origin), {signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: offset ? {Range: `bytes=${offset}-`} : {}});
            if (!response.ok || !response.body) throw new Error('MODEL_NETWORK');
            if (response.status === 206) {
                const range = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(response.headers.get('Content-Range') || '');
                if (!range || Number(range[1]) !== offset || Number(range[2]) !== file.size - 1 || Number(range[3]) !== file.size) throw new Error('MODEL_INTEGRITY');
            } else if (response.status === 200 && offset) {await remove(file); offset = 0;}
            else if (response.status !== 200) throw new Error('MODEL_NETWORK');
            reader = response.body.getReader(); const cache = await open();
            let buffer = new Uint8Array(Math.min(MODEL_ARTIFACT_CHUNK_BYTES, file.size - offset)), filled = 0, index = offset / MODEL_ARTIFACT_CHUNK_BYTES;
            while (true) {
                active(signal); arm(45_000); const {done, value} = await reader.read(); clearTimeout(timer);
                if (done) break;
                if (offset + filled + value.byteLength > file.size) throw new Error('MODEL_INTEGRITY');
                let cursor = 0;
                while (cursor < value.byteLength) {
                    const count = Math.min(buffer.byteLength - filled, value.byteLength - cursor);
                    buffer.set(value.subarray(cursor, cursor + count), filled); cursor += count; filled += count;
                    if (filled === buffer.byteLength) {
                        active(signal); await cache.put(part(file, index++), new Response(buffer, {headers: {'Content-Length': String(filled)}}));
                        offset += filled; filled = 0; buffer = new Uint8Array(Math.min(MODEL_ARTIFACT_CHUNK_BYTES, file.size - offset));
                    }
                }
                progress(offset + filled, false);
            }
            if (offset !== file.size) throw new Error('MODEL_NETWORK');
            progress(offset, true); await verify(file, signal);
        } finally {clearTimeout(timer); controller.abort(); void reader?.cancel().catch(() => undefined); reader?.releaseLock(); signal.removeEventListener('abort', abort);}
    };
    return {complete, downloaded, remove, blob,
        async match(request: string | Request): Promise<Response | undefined> {
            const key = typeof request === 'string' ? request : request.url, file = files.find(value => value.url === key);
            const value = file && await preparedBlob(file);
            return value ? new Response(value, {headers: {'Content-Length': String(file.size)}}) : undefined;
        },
        async download(file: ModelArtifact, signal: AbortSignal, progress: (bytes: number, verifying: boolean) => void): Promise<void> {
            active(signal); if (await complete(file)) {progress(file.size, false); return;}
            let failure: unknown;
            for (const origin of huggingFaceDownloadOrigins()) {
                try {await receive(file, origin, signal, progress); return;}
                catch (error) {active(signal); if ((error as {name?: string} | null)?.name === 'QuotaExceededError') throw error; failure = error;}
            }
            throw failure;
        },
    };
}
