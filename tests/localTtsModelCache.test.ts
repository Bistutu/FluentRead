/**
 * @file tests/localTtsModelCache.test.ts
 * 文件职责：验证本地 TTS 模型升级后的 preferred/legacy 缓存边界。
 * 主要内容：流式下载只保存一份固定版本并回报合并后的真实字节进度；状态只读，显式准备时才迁移来源可证明的旧 main 副本；旧 q4f16 不误判为新模型，下载去重且与清除互斥，显式清除保留其他模型。
 * 模块边界：使用内存 Cache Storage，不下载真实模型、不启动 Worker、不修改用户配置。
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    LOCAL_TTS_LEGACY_MODEL_FILES,
    LOCAL_TTS_MODEL_FILES,
    cacheLocalTtsModelFiles,
    LOCAL_TTS_VOICES,
    getLocalTtsModelFileUrl,
    getLocalTtsModelLoaderUrl,
    getLocalTtsVoiceCacheUrl,
    isLocalTtsModelCached,
    removeLocalTtsModelFiles,
} from '@/src/features/local-tts/offscreen/modelCache';
import {
    LOCAL_TTS_MODEL_CACHE_NAME,
    LOCAL_TTS_VOICE_CACHE_NAME,
} from '@/src/core/config/localTts';

type MemoryCache = {
    match: (request: RequestInfo | URL) => Promise<Response | undefined>;
    put: (request: RequestInfo | URL, response: Response) => Promise<void>;
    delete: (request: RequestInfo | URL) => Promise<boolean>;
};

function requestKey(request: RequestInfo | URL): string {
    return typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url;
}

function memoryCache(): MemoryCache {
    const entries = new Map<string, Response>();
    return {
        match: async (request) => entries.get(requestKey(request))?.clone(),
        put: async (request, response) => {
            // Cache Storage put 完成意味着响应体已完整接收；真实下载端口会在此后释放 reader。
            const body = await response.arrayBuffer();
            entries.set(requestKey(request), new Response(body, {
                status: response.status, statusText: response.statusText, headers: response.headers,
            }));
        },
        delete: async (request) => entries.delete(requestKey(request)),
    };
}

function installCaches(modelCache = memoryCache(), voiceCache = memoryCache()): {modelCache: MemoryCache; voiceCache: MemoryCache} {
    vi.stubGlobal('caches', {
        open: vi.fn(async (name: string) => name === LOCAL_TTS_MODEL_CACHE_NAME ? modelCache : voiceCache),
    });
    return {modelCache, voiceCache};
}

async function put(cache: MemoryCache, url: string): Promise<void> {
    await cache.put(url, new Response(new Uint8Array([1])));
}

async function putModelFiles(cache: MemoryCache, files: readonly string[]): Promise<void> {
    for (const file of files) {
        await put(cache, getLocalTtsModelFileUrl(file));
        await put(cache, getLocalTtsModelLoaderUrl(file));
    }
}

async function putVoices(cache: MemoryCache): Promise<void> {
    for (const voice of LOCAL_TTS_VOICES) await put(cache, getLocalTtsVoiceCacheUrl(voice));
}

beforeEach(() => vi.stubGlobal('navigator', {language: 'en-US'}));
afterEach(() => vi.unstubAllGlobals());

describe('local TTS model cache upgrade compatibility', () => {
    it('keeps legacy-only q4f16 caches available for explicit removal but reports the preferred model as missing', async () => {
        const {modelCache, voiceCache} = installCaches();
        await putModelFiles(modelCache, [
            ...LOCAL_TTS_MODEL_FILES.filter((file) => file !== 'onnx/model.onnx'),
            ...LOCAL_TTS_LEGACY_MODEL_FILES,
        ]);
        await putVoices(voiceCache);

        await expect(isLocalTtsModelCached()).resolves.toBe(false);
        expect(await modelCache.match(getLocalTtsModelFileUrl('onnx/model_q4f16.onnx'))).toBeDefined();
    });

    it('streams one pinned copy per resource, keeps state reads pure and prunes proven duplicates only during prepare', async () => {
        const {modelCache, voiceCache} = installCaches();
        const fetcher=vi.fn(async()=>new Response(new Uint8Array([1,2,3])));
        vi.stubGlobal('fetch',fetcher);
        await cacheLocalTtsModelFiles();
        expect(await isLocalTtsModelCached()).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(LOCAL_TTS_MODEL_FILES.length+LOCAL_TTS_VOICES.length);
        for (const file of LOCAL_TTS_MODEL_FILES) {
            const pinned=getLocalTtsModelFileUrl(file),loader=getLocalTtsModelLoaderUrl(file);
            expect(await modelCache.match(pinned)).toBeDefined();
            expect(await modelCache.match(loader)).toBeUndefined();
            await modelCache.put(loader,new Response('old',{headers:{'X-FluentRead-Model-Source':pinned}}));
        }
        expect(await isLocalTtsModelCached()).toBe(true);
        for (const file of LOCAL_TTS_MODEL_FILES) expect(await modelCache.match(getLocalTtsModelLoaderUrl(file))).toBeDefined();
        await cacheLocalTtsModelFiles();
        for (const file of LOCAL_TTS_MODEL_FILES) expect(await modelCache.match(getLocalTtsModelLoaderUrl(file))).toBeUndefined();
        const file=LOCAL_TTS_MODEL_FILES[0];
        await modelCache.put(getLocalTtsModelLoaderUrl(file),new Response('legacy'));
        await isLocalTtsModelCached();
        expect(await modelCache.match(getLocalTtsModelLoaderUrl(file))).toBeDefined();
        await modelCache.delete(getLocalTtsModelFileUrl(file));
        expect(await isLocalTtsModelCached()).toBe(false);
        await cacheLocalTtsModelFiles();
        expect(fetcher).toHaveBeenCalledTimes(LOCAL_TTS_MODEL_FILES.length+LOCAL_TTS_VOICES.length+1);
        // 未证实版本的 legacy alias 不读也不删；下载只补写 pinned key。
        expect(await modelCache.match(getLocalTtsModelLoaderUrl(file))).toBeDefined();
        expect(await voiceCache.match(getLocalTtsVoiceCacheUrl(LOCAL_TTS_VOICES[0]!))).toBeDefined();
    });

    it('migrates a proven loader-only fixed version without fetching or leaving a duplicate', async () => {
        const {modelCache, voiceCache} = installCaches();
        for (const file of LOCAL_TTS_MODEL_FILES) {
            await modelCache.put(getLocalTtsModelLoaderUrl(file), new Response('legacy-current', {
                headers: {'X-FluentRead-Model-Source': getLocalTtsModelFileUrl(file)},
            }));
        }
        await putVoices(voiceCache);
        const fetcher = vi.fn(async () => { throw new Error('A proven cached version must not download'); });
        vi.stubGlobal('fetch', fetcher);
        expect(await isLocalTtsModelCached()).toBe(true);
        await cacheLocalTtsModelFiles();
        expect(fetcher).not.toHaveBeenCalled();
        for (const file of LOCAL_TTS_MODEL_FILES) {
            expect(await (await modelCache.match(getLocalTtsModelFileUrl(file)))!.text()).toBe('legacy-current');
            expect(await modelCache.match(getLocalTtsModelLoaderUrl(file))).toBeUndefined();
        }
        expect(await isLocalTtsModelCached()).toBe(true);
    });

    it('rejects failed responses and wrong-version aliases while preserving unmarked pinned compatibility', async () => {
        const {modelCache, voiceCache} = installCaches();
        await putModelFiles(modelCache, LOCAL_TTS_MODEL_FILES);
        await putVoices(voiceCache);
        expect(await isLocalTtsModelCached()).toBe(true);
        const pinned = getLocalTtsModelFileUrl(LOCAL_TTS_MODEL_FILES[0]);
        const loader = getLocalTtsModelLoaderUrl(LOCAL_TTS_MODEL_FILES[0]);
        await modelCache.put(pinned, new Response('expired', {status: 403}));
        await modelCache.put(loader, new Response('wrong version', {
            headers: {'X-FluentRead-Model-Source': pinned.replace(/\/resolve\/[^/]+\//, '/resolve/not-the-pinned-version/')},
        }));
        expect(await isLocalTtsModelCached()).toBe(false);
        expect(await modelCache.match(loader)).toBeDefined();
        await modelCache.put(pinned, new Response('fixed version'));
        expect(await isLocalTtsModelCached()).toBe(true);
    });

    it('accepts the actual fallback official provenance for both model and voice bytes without redownloading', async () => {
        const {modelCache, voiceCache} = installCaches();
        vi.stubGlobal('navigator', {language: 'zh-CN'});
        const fetcher = vi.fn(async (url: string) => new Response(new Uint8Array([1, 2, 3]), {
            status: url.startsWith('https://hf-mirror.com/') ? 403 : 200,
        }));
        vi.stubGlobal('fetch', fetcher);
        await cacheLocalTtsModelFiles();
        expect(await isLocalTtsModelCached()).toBe(true);
        for (const file of LOCAL_TTS_MODEL_FILES) {
            const pinned = getLocalTtsModelFileUrl(file);
            expect((await modelCache.match(pinned))!.headers.get('X-FluentRead-Model-Source'))
                .toBe(pinned);
            expect(await modelCache.match(getLocalTtsModelLoaderUrl(file))).toBeUndefined();
        }
        for (const voice of LOCAL_TTS_VOICES) {
            const pinned = getLocalTtsVoiceCacheUrl(voice);
            expect((await voiceCache.match(pinned))!.headers.get('X-FluentRead-Model-Source'))
                .toBe(pinned);
        }
        const calls = fetcher.mock.calls.length;
        await cacheLocalTtsModelFiles();
        expect(fetcher).toHaveBeenCalledTimes(calls);
    });

    it('deduplicates concurrent public downloads and excludes clear until they settle', async () => {
        installCaches();
        let finish!: (response: Response) => void;
        const firstResponse = new Promise<Response>(resolve => { finish = resolve; });
        const fetcher = vi.fn(async () => new Response(new Uint8Array([1])))
            .mockImplementationOnce(() => firstResponse);
        vi.stubGlobal('fetch', fetcher);
        const first = cacheLocalTtsModelFiles();
        const second = cacheLocalTtsModelFiles();
        expect(second).toBe(first);
        await expect(removeLocalTtsModelFiles()).rejects.toThrow('正在下载');
        finish(new Response(new Uint8Array([1])));
        await first;
        expect(fetcher).toHaveBeenCalledTimes(LOCAL_TTS_MODEL_FILES.length + LOCAL_TTS_VOICES.length);
        await removeLocalTtsModelFiles();
        expect(await isLocalTtsModelCached()).toBe(false);
    });

    it('reports one combined byte progress for model and voice files and counts files already cached', async () => {
        const {modelCache} = installCaches();
        const fileCount = LOCAL_TTS_MODEL_FILES.length + LOCAL_TTS_VOICES.length;
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(10), {headers: {'Content-Length': '10'}})));
        const reports: Array<{loaded: number; total: number}> = [];
        await cacheLocalTtsModelFiles(progress => reports.push(progress));
        // 最后一个文件开始前按声明的 343 MB 计算，全部大小已知后改用精确合计。
        expect(reports[0]).toEqual({loaded: 0, total: 343_000_000});
        expect(reports.at(-1)).toEqual({loaded: fileCount * 10, total: fileCount * 10});
        expect(reports.every((item, index) => index === 0 || item.loaded >= reports[index - 1].loaded)).toBe(true);
        expect(reports.every(item => item.loaded <= item.total)).toBe(true);

        // 只缺一个文件时，其余文件按缓存里的大小计入已完成部分。
        await modelCache.delete(getLocalTtsModelFileUrl('config.json'));
        const resumed: Array<{loaded: number; total: number}> = [];
        await cacheLocalTtsModelFiles(progress => resumed.push(progress));
        expect(fetch).toHaveBeenCalledTimes(fileCount + 1);
        expect(resumed.at(-1)).toEqual({loaded: fileCount * 10, total: fileCount * 10});
    });

    it('clears preferred and legacy model keys without deleting another model', async () => {
        const {modelCache, voiceCache} = installCaches();
        await putModelFiles(modelCache, [...LOCAL_TTS_MODEL_FILES, ...LOCAL_TTS_LEGACY_MODEL_FILES]);
        await put(modelCache, getLocalTtsModelFileUrl('onnx/model_q8.onnx'));
        await put(modelCache, getLocalTtsModelLoaderUrl('onnx/model_q8.onnx'));
        await putVoices(voiceCache);

        await removeLocalTtsModelFiles();

        for (const file of [...LOCAL_TTS_MODEL_FILES, ...LOCAL_TTS_LEGACY_MODEL_FILES]) {
            await expect(modelCache.match(getLocalTtsModelFileUrl(file))).resolves.toBeUndefined();
            await expect(modelCache.match(getLocalTtsModelLoaderUrl(file))).resolves.toBeUndefined();
        }
        await expect(modelCache.match(getLocalTtsModelFileUrl('onnx/model_q8.onnx'))).resolves.toBeDefined();
        await expect(modelCache.match(getLocalTtsModelLoaderUrl('onnx/model_q8.onnx'))).resolves.toBeDefined();
        for (const voice of LOCAL_TTS_VOICES) {
            await expect(voiceCache.match(getLocalTtsVoiceCacheUrl(voice))).resolves.toBeUndefined();
        }
        expect(LOCAL_TTS_VOICE_CACHE_NAME).toBe('kokoro-voices');
    });
});
