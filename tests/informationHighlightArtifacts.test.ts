import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {huggingFaceDownloadOrigins} from '@/src/platform/http/modelDownloads';
import {sha256} from '@noble/hashes/sha256';
import {createModelArtifactStore, MODEL_ARTIFACT_CHUNK_BYTES, type ModelArtifact} from '@/src/platform/storage/modelArtifacts';
import {DEFAULT_INFORMATION_HIGHLIGHT_MODEL_ID, getInformationHighlightModel, INFORMATION_HIGHLIGHT_MODELS, INFORMATION_HIGHLIGHT_MODEL_FILES, INFORMATION_HIGHLIGHT_MODEL_REVISION, INFORMATION_HIGHLIGHT_MODEL_BYTES} from '@/src/core/config/informationHighlightModel';
import {getInformationHighlightArtifacts, getInformationHighlightArtifactStore, informationHighlightArtifacts, informationHighlightArtifactStore, INFORMATION_HIGHLIGHT_CACHE, removeRetiredInformationHighlightArtifacts} from '@/src/features/information-highlight/offscreen/artifacts';

describe('fixed model artifacts integrity and bounded resumable cache', () => {
    let entries: Map<string, Response>, cache: {match: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>};
    beforeEach(() => {
        entries = new Map(); cache = {match: vi.fn(async (key: string) => entries.get(key)?.clone()), put: vi.fn(async (key: string, value: Response) => {entries.set(key, value.clone());}), delete: vi.fn(async (key: string) => entries.delete(key))};
        vi.stubGlobal('caches', {open: vi.fn(async () => cache)}); vi.stubGlobal('navigator', {language: 'en'});
    });
    afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});
    const fileFor = (body: Uint8Array, path = 'model.onnx'): ModelArtifact => ({url: `https://huggingface.co/org/model/resolve/pinned/${path}`, size: body.length, sha256: Array.from(sha256(body), value => value.toString(16).padStart(2,'0')).join('')});
    it('pins six verified files with actual size and content SHA-256, not a parameter-count estimate', () => {
        expect(INFORMATION_HIGHLIGHT_MODEL_REVISION).toMatch(/^[a-f0-9]{40}$/u); expect(INFORMATION_HIGHLIGHT_MODEL_BYTES).toBe(490043908);
        expect(INFORMATION_HIGHLIGHT_MODEL_FILES).toHaveLength(6); expect(INFORMATION_HIGHLIGHT_MODEL_FILES.every(file => /^[a-f0-9]{64}$/u.test(file.sha256))).toBe(true);
        expect(INFORMATION_HIGHLIGHT_MODEL_FILES.at(-1)).toMatchObject({size: 483003582, sha256: '30a39f89fab8f30d0f99aa1e28d3e3be6fca66a3fab915f77584ac52a8361d25'});
    });
    it('offers only a pretrained Base model and resolves retired persisted choices to it', () => {
        expect(DEFAULT_INFORMATION_HIGHLIGHT_MODEL_ID).toBe('qwen2.5-0.5b');
        expect(INFORMATION_HIGHLIGHT_MODELS.map(model => model.id)).toEqual(['qwen2.5-0.5b']);
        for (const model of INFORMATION_HIGHLIGHT_MODELS) {
            expect(model.revision).toMatch(/^[a-f0-9]{40}$/u);
            expect(model.files).toHaveLength(6);
            expect(model.files.every(file => /^[a-f0-9]{64}$/u.test(file.sha256))).toBe(true);
            expect(model.bytes).toBe(model.files.reduce((sum, file) => sum + file.size, 0));
            expect(getInformationHighlightModel(model.id)).toBe(model);
        }
        for (const value of [undefined, null, 'qwen3-0.6b', 'unsupported-model', {}, 1]) expect(getInformationHighlightModel(value)).toBe(INFORMATION_HIGHLIGHT_MODELS[0]);
        expect(getInformationHighlightModel(DEFAULT_INFORMATION_HIGHLIGHT_MODEL_ID)).toMatchObject({name: 'Qwen2.5 0.5B Base', repository: 'onnx-community/Qwen2.5-0.5B', bytes: INFORMATION_HIGHLIGHT_MODEL_BYTES, kvCacheDtype: 'float32'});
    });
    it('keeps verified Base v1 files readable and never serves retired chat-model cache entries', async () => {
        const file = informationHighlightArtifacts[0];
        const retiredUrl = 'https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/resolve/1e0a4a196ecabdf9a879664110574563d3f372d3/config.json';
        expect(file.url).toBe(`https://huggingface.co/onnx-community/Qwen2.5-0.5B/resolve/${INFORMATION_HIGHLIGHT_MODEL_REVISION}/config.json`);
        expect(getInformationHighlightArtifacts()).toEqual(informationHighlightArtifacts);
        expect(getInformationHighlightArtifactStore()).toBe(informationHighlightArtifactStore);
        entries.set(`${file.url}?fluent-read-verified=${file.sha256}`, new Response(JSON.stringify({size: file.size, sha256: file.sha256})));
        entries.set(`${file.url}?fluent-read-part=0`, new Response(new Uint8Array(file.size), {headers: {'Content-Length': String(file.size)}}));
        entries.set(retiredUrl, new Response('retired chat model'));
        expect(await informationHighlightArtifactStore.complete(file)).toBe(true);
        expect(await informationHighlightArtifactStore.match(file.url)).toBeInstanceOf(Response);
        expect(await informationHighlightArtifactStore.match(retiredUrl)).toBeUndefined();
        await informationHighlightArtifactStore.remove(file);
        expect(await informationHighlightArtifactStore.complete(file)).toBe(false);
        expect(entries.has(retiredUrl)).toBe(true);
        expect(vi.mocked(caches.open).mock.calls.every(([name]) => name === INFORMATION_HIGHLIGHT_CACHE)).toBe(true);
    });
    it('deletes only the exact retired chat-model cache and preserves Base and unrelated resources', async () => {
        const retiredCache = 'fluent-read-information-highlight-model-qwen3-0.6b-v1';
        const names = new Set([retiredCache, INFORMATION_HIGHLIGHT_CACHE, 'fluent-read-local-translation-v1', `${retiredCache}-other`]);
        const remove = vi.fn(async (name: string) => names.delete(name));
        vi.stubGlobal('caches', {delete: remove});
        await removeRetiredInformationHighlightArtifacts();
        expect(remove).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledWith(retiredCache);
        expect([...names]).toEqual([INFORMATION_HIGHLIGHT_CACHE, 'fluent-read-local-translation-v1', `${retiredCache}-other`]);
        await removeRetiredInformationHighlightArtifacts();
        expect(names.size).toBe(3);
    });
    it('streams verified bytes, emits verifying progress and serves only canonical prepared artifacts', async () => {
        const body = new TextEncoder().encode('fixed bytes'), file = fileFor(body), store = createModelArtifactStore('models', [file]), progress = vi.fn();
        await expect(store.blob(file)).rejects.toThrow('NOT_DOWNLOADED'); expect(await store.complete(file)).toBe(false); expect(await store.downloaded(file)).toBe(0);
        const fetcher = vi.fn(async () => new Response(body)); vi.stubGlobal('fetch', fetcher);
        await store.download(file, new AbortController().signal, progress); expect(await store.complete(file)).toBe(true); expect(await store.downloaded(file)).toBe(body.length); expect(await (await store.blob(file)).text()).toBe('fixed bytes');
        expect(await (await store.match(file.url))!.text()).toBe('fixed bytes'); expect(await store.match(new Request(file.url))).toBeInstanceOf(Response); expect(await store.match('https://elsewhere')).toBeUndefined();
        expect(progress).toHaveBeenCalledWith(body.length, true); await store.download(file, new AbortController().signal, progress); expect(fetcher).toHaveBeenCalledOnce();
        await store.remove(file); expect(await store.complete(file)).toBe(false);
    });
    it('requires a valid receipt plus all actual chunks; stale/corrupt receipts cannot claim ready', async () => {
        const body = new Uint8Array([1,2]), file = fileFor(body), store = createModelArtifactStore('models', [file]);
        const receipt = `${file.url}?fluent-read-verified=${file.sha256}`, chunk = `${file.url}?fluent-read-part=0`;
        for (const value of ['invalid JSON', JSON.stringify({size: 1, sha256: file.sha256}), JSON.stringify({size: 2, sha256: 'bad'}), JSON.stringify({size: 2, sha256: file.sha256})]) {entries.set(receipt, new Response(value)); expect(await store.complete(file)).toBe(false);}
        entries.set(chunk, new Response('x', {headers: {'Content-Length': '2'}})); expect(await store.complete(file)).toBe(false); expect(await store.downloaded(file)).toBe(2); await expect(store.blob(file)).rejects.toThrow('NOT_DOWNLOADED');
        entries.set(chunk, new Response(body, {headers: {'Content-Length': '2'}})); expect(await store.complete(file)).toBe(true);
        cache.match.mockImplementation(async (key: string) => key === chunk ? undefined : entries.get(key)?.clone()); await expect(store.blob(file)).rejects.toThrow('NOT_DOWNLOADED');
    });
    it('resumes a whole 4MiB prefix using exact Range, and verifies a fully downloaded unverified file offline', async () => {
        const body = new Uint8Array(MODEL_ARTIFACT_CHUNK_BYTES + 3).fill(7), file = fileFor(body), store = createModelArtifactStore('models', [file]);
        entries.set(`${file.url}?fluent-read-part=0`, new Response(body.subarray(0, MODEL_ARTIFACT_CHUNK_BYTES), {headers: {'Content-Length': String(MODEL_ARTIFACT_CHUNK_BYTES)}}));
        const fetcher = vi.fn(async (_url: string, _options: RequestInit) => new Response(body.subarray(MODEL_ARTIFACT_CHUNK_BYTES), {status: 206, headers: {'Content-Range': `bytes ${MODEL_ARTIFACT_CHUNK_BYTES}-${body.length - 1}/${body.length}`}})); vi.stubGlobal('fetch', fetcher);
        await store.download(file, new AbortController().signal, () => {}); expect(fetcher.mock.calls[0][1]).toMatchObject({headers: {Range: `bytes=${MODEL_ARTIFACT_CHUNK_BYTES}-`}}); expect(await store.complete(file)).toBe(true);
        entries.delete(`${file.url}?fluent-read-verified=${file.sha256}`); await store.download(file, new AbortController().signal, () => {}); expect(fetcher).toHaveBeenCalledOnce();
    });
    it('reads each prepared chunk only once and rejects eviction or replacement during reading', async () => {
        const body = new Uint8Array([1,2]), file = fileFor(body), store = createModelArtifactStore('models', [file]);
        const receipt = `${file.url}?fluent-read-verified=${file.sha256}`, chunk = `${file.url}?fluent-read-part=0`;
        entries.set(receipt, new Response(JSON.stringify({size: file.size, sha256: file.sha256}))); entries.set(chunk, new Response(body, {headers: {'Content-Length': '2'}}));
        cache.match.mockClear(); expect(await (await store.match(file.url))!.arrayBuffer()).toEqual(body.buffer);
        expect(cache.match.mock.calls.map(call => call[0])).toEqual([receipt, chunk]);
        for (const replacement of [undefined, new Response('x')]) {
            cache.match.mockImplementation(async (key: string) => key === chunk ? replacement?.clone() : entries.get(key)?.clone());
            await expect(store.blob(file)).rejects.toThrow('MODEL_NOT_DOWNLOADED'); expect(await store.match(file.url)).toBeUndefined();
        }
        cache.match.mockImplementation(async (key: string) => entries.get(key)?.clone()); entries.delete(receipt); entries.delete(chunk);
        cache.put.mockImplementation(async () => {entries.delete(chunk);});
        vi.stubGlobal('fetch', vi.fn(async () => new Response(body))); await expect(store.download(file, new AbortController().signal, () => {})).rejects.toThrow('MODEL_INTEGRITY');
    });
    it('restarts when a source ignores Range and discards corrupt bytes before trying another source', async () => {
        const body = new Uint8Array(MODEL_ARTIFACT_CHUNK_BYTES + 1).fill(3), file = fileFor(body), store = createModelArtifactStore('models', [file]);
        entries.set(`${file.url}?fluent-read-part=0`, new Response(body.subarray(0, MODEL_ARTIFACT_CHUNK_BYTES), {headers: {'Content-Length': String(MODEL_ARTIFACT_CHUNK_BYTES)}}));
        const fetcher = vi.fn(async () => new Response(body)); vi.stubGlobal('fetch', fetcher); await store.download(file, new AbortController().signal, () => {}); expect(await store.complete(file)).toBe(true);
        const small = fileFor(new TextEncoder().encode('good'), 'small'), other = createModelArtifactStore('models', [small]); vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('evil')).mockResolvedValueOnce(new Response('good')));
        await other.download(small, new AbortController().signal, () => {}); expect(await other.complete(small)).toBe(true); expect(await store.complete(file)).toBe(true);
    });
    it('rejects invalid ranges, short/oversized files, HTML bodies and quota errors without accepting incomplete data', async () => {
        const file = fileFor(new Uint8Array([1,2])), store = createModelArtifactStore('models', [file]);
        for (const response of [new Response('x', {status: 206}), new Response('x', {status: 206, headers: {'Content-Range': 'bytes 1-1/2'}}), new Response('x'), new Response('xxx'), new Response('page', {status: 500}), new Response(null), new Response('x', {status: 201})]) {
            vi.stubGlobal('fetch', vi.fn(async () => response.clone())); await expect(store.download(file, new AbortController().signal, () => {})).rejects.toThrow(); expect(await store.complete(file)).toBe(false); await store.remove(file);
        }
        cache.put.mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError')); const fetcher = vi.fn(async () => new Response(new Uint8Array([1,2]))); vi.stubGlobal('fetch', fetcher); await expect(store.download(file, new AbortController().signal, () => {})).rejects.toMatchObject({name: 'QuotaExceededError'}); expect(fetcher).toHaveBeenCalledOnce();
        vi.stubGlobal('fetch', vi.fn(async () => {throw null;})); await expect(store.download(file, new AbortController().signal, () => {})).rejects.toBe(null);
    });
    it.each([500, 206, 201])('cancels a rejected %s response before trying the next model source', async status => {
        const bytes = new Uint8Array([1, 2]), file = fileFor(bytes), store = createModelArtifactStore('models', [file]);
        const cancel = vi.fn(() => new Promise<void>(() => {}));
        const fetcher = vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({cancel}), {status}))
            .mockResolvedValueOnce(new Response(bytes));
        vi.stubGlobal('fetch', fetcher);
        await store.download(file, new AbortController().signal, () => {});
        expect(cancel).toHaveBeenCalledOnce();
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(await store.complete(file)).toBe(true);
    });
    it('pauses before fetch or during the stream, keeps other model entries and bounds stalled-network waiting', async () => {
        const body = new Uint8Array([1,2]), file = fileFor(body), store = createModelArtifactStore('models', [file]);
        const controller = new AbortController(); controller.abort(); await expect(store.download(file, controller.signal, () => {})).rejects.toMatchObject({name: 'AbortError'});
        const during = new AbortController(); vi.stubGlobal('fetch', vi.fn(async () => {during.abort(); return new Response(body);})); await expect(store.download(file, during.signal, () => {})).rejects.toMatchObject({name: 'AbortError'});
        vi.useFakeTimers(); const fetcher = vi.fn((_url, {signal}: {signal: AbortSignal}) => new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stalled'))))); vi.stubGlobal('fetch', fetcher);
        const stalled = store.download(file, new AbortController().signal, () => {}); const expectation = expect(stalled).rejects.toThrow('stalled'); await vi.runAllTimersAsync(); await expectation; expect(fetcher).toHaveBeenCalledTimes(huggingFaceDownloadOrigins().length);
    });
});
