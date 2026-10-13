import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';

const configurationSubscriptions = vi.hoisted(() => new Set<() => void>());
// The polyfill is the external extension API port; retain the real message wrapper.
vi.mock('webextension-polyfill', () => ({default: {get runtime() {return browser.runtime;}}}));
// The configuration storage port is controlled; image/session/read/auth/client code is real.
vi.mock('@/src/services/config/store', async () => {
    const {reactive, watch} = await import('vue');
    const {Config} = await import('@/src/core/config/model');
    const config = reactive(new Config());
    return {config, subscribeConfig: (listener: (value: typeof config) => void) => {
        const stop = watch(config, listener);
        configurationSubscriptions.add(stop);
        return () => {stop(); configurationSubscriptions.delete(stop);};
    }};
});
import {config} from '@/src/services/config/store';
// Default imports always resolve the actual repository through its normal @ alias.
// Main may substitute only the pinned runtime module for the baseline comparison.
import {mountImageTranslator, unmountImageTranslator, toggleMangaTranslation, subscribeMangaTranslation} from '@/src/features/image-translation/content/runtime';

const PAGE_URL = 'https://reader.fixture.com/chapter/1';
const SOURCE_URL = 'https://images.fixture.com/long.png';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=';
const WALL_START = 1_700_000_000_000;
const directions = ['backward', 'forward'] as const;
function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
}
async function observePublic(predicate: () => boolean, label: string) {
    // Bounded scheduling only: no private calls and no elapsed-clock guess.
    for (let turn = 0; turn < 240 && !predicate(); turn++) await Promise.resolve();
    expect(predicate(), label).toBe(true);
}
async function drain() {for (let turn = 0; turn < 80; turn++) await Promise.resolve();}
type Message = {type: string; requestId?: string; timeoutMs?: number; url?: string; [key: string]: unknown};
type Listener = (message: unknown, sender: {id?: string}, respond: (value: unknown) => void) => unknown;
let monotonic = 0;
let cleanup: (() => Promise<void>) | undefined;

function mountLongImage() {
    const {document, window: dom} = parseHTML('<html><head><title>Clock fixture</title></head><body><main><img class="chapter-page" /></main></body></html>');
    Object.defineProperties(document, {URL: {value: PAGE_URL}, hidden: {value: false}, visibilityState: {value: 'visible'}});
    const image = document.querySelector('img') as HTMLImageElement;
    image.src = SOURCE_URL;
    Object.defineProperties(image, {
        complete: {value: true}, naturalWidth: {value: 400}, naturalHeight: {value: 6000},
        currentSrc: {get: () => image.src}, offsetWidth: {value: 400}, offsetHeight: {value: 6000},
    });
    image.getBoundingClientRect = () => ({left: 20, top: 20, right: 420, bottom: 6020, width: 400, height: 6000} as DOMRect);
    const frames = new Map<number, FrameRequestCallback>();
    let frameSequence = 0;
    const windowListeners = new Map<string, Set<EventListener>>();
    const observers: Array<{disconnect: ReturnType<typeof vi.fn>}> = [];
    const canvases: HTMLCanvasElement[] = [];
    const readers: Reader[] = [];
    class Reader {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readyState = 0;
        result: string | null = null;
        abort = vi.fn(() => {this.readyState = 2;});
        readAsDataURL = vi.fn((_blob: Blob) => {
            this.readyState = 1;
            queueMicrotask(() => {
                if (this.readyState !== 1) return;
                this.result = PNG;this.readyState = 2;this.onload?.();
            });
        });
        constructor() {readers.push(this);}
    }
    vi.stubGlobal('FileReader', Reader);
    const decoded: HTMLImageElement[] = [];
    const drawCalls: unknown[][] = [];
    const originalCreate = document.createElement.bind(document);
    let securityErrors = 0;
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
        const element = originalCreate(tag);
        if (tag === 'canvas') {
            const canvas = element as HTMLCanvasElement;
            let lastSource: unknown;
            canvas.getContext = (() => ({
                drawImage: (...args: unknown[]) => {lastSource = args[0]; drawCalls.push(args);},
                getImageData: () => {
                    if (lastSource === image) {securityErrors++; throw new DOMException('controlled tainted source', 'SecurityError');}
                    return {data: new Uint8ClampedArray(4)};
                },
            })) as never;
            // 仅提供原生异步编码端口；保留实际 encodeImageCanvas 的预算、取消和读取器清理。
            canvas.toBlob = vi.fn((callback: BlobCallback) => {queueMicrotask(() => callback(new Blob(['png'], {type: 'image/png'})));});
            canvases.push(canvas);
        }
        return element;
    }) as never);
    vi.stubGlobal('Image', function () {
        const bitmap = originalCreate('img') as HTMLImageElement;
        Object.defineProperties(bitmap, {
            naturalWidth: {value: 400}, naturalHeight: {value: 6000},
            src: {configurable: true, get: () => bitmap.getAttribute('src') || '', set: (value: string) => {
                bitmap.setAttribute('src', value);
                if (value) queueMicrotask(() => bitmap.onload?.(new dom.Event('load')));
            }},
        });
        decoded.push(bitmap); return bitmap;
    });
    vi.stubGlobal('DOMRect', class {
        constructor(public x: number, public y: number, public width: number, public height: number) {}
        get left() {return this.x;} get top() {return this.y;}
        get right() {return this.x + this.width;} get bottom() {return this.y + this.height;}
    });
    vi.stubGlobal('MutationObserver', class {
        observe = vi.fn(); disconnect = vi.fn();
        constructor(_callback: MutationCallback) {observers.push(this);}
    });
    vi.stubGlobal('ResizeObserver', class {
        observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn();
        constructor(_callback: ResizeObserverCallback) {observers.push(this);}
    });
    // Explicitly control the optional DOM observer port too; never use an ambient browser.
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.stubGlobal('document', document);
    for (const name of ['Node', 'Element', 'HTMLElement', 'HTMLImageElement', 'ShadowRoot']) vi.stubGlobal(name, (dom as any)[name]);
    vi.stubGlobal('getComputedStyle', () => ({display: 'block', visibility: 'visible', opacity: '1', objectFit: 'fill',
        paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px',
        borderTopWidth: '0px', borderRightWidth: '0px', borderBottomWidth: '0px', borderLeftWidth: '0px',
        overflowX: 'visible', overflowY: 'visible', backgroundImage: 'none'}));
    vi.stubGlobal('window', {
        location: {href: PAGE_URL}, innerWidth: 1000, innerHeight: 800, devicePixelRatio: 1,
        setTimeout, clearTimeout,
        requestAnimationFrame: (callback: FrameRequestCallback) => {frames.set(++frameSequence, callback); return frameSequence;},
        cancelAnimationFrame: (id: number) => {frames.delete(id);},
        addEventListener: (name: string, callback: EventListener) => {
            const listeners = windowListeners.get(name) ?? new Set<EventListener>(); listeners.add(callback); windowListeners.set(name, listeners);
        },
        removeEventListener: (name: string, callback: EventListener) => {windowListeners.get(name)?.delete(callback);},
    });
    const page = deferred<Response>();
    void page.promise.catch(() => undefined);
    let pageSignal: AbortSignal | undefined;
    const pageFetch = vi.fn((_url: string, options: RequestInit) => {pageSignal = options.signal!; return page.promise;});
    vi.stubGlobal('fetch', pageFetch);
    const extension = deferred<unknown>();
    const messageListeners = new Set<Listener>();
    const messages: Message[] = [];
    const authorizations: unknown[] = [];
    const runtime = {
        id: 'controlled-extension',
        onMessage: {
            addListener: vi.fn((listener: Listener) => {messageListeners.add(listener);}),
            removeListener: vi.fn((listener: Listener) => {messageListeners.delete(listener);}),
        },
        sendMessage: vi.fn((message: Message) => {
            messages.push(message);
            if (message.type === 'fluentReadImageFetch') {
                // Exercise actual sourceAuthorization listener with the same requestId/source/document.
                for (const listener of messageListeners) listener({type: 'fluentReadImageValidateSource', requestId: message.requestId,
                    url: message.url, documentUrl: PAGE_URL}, {id: runtime.id}, value => authorizations.push(value));
                return extension.promise;
            }
            if (message.type === 'fluentReadImageTranslate') return Promise.resolve({success: true, image: PNG, lines: []});
            if (message.type === 'fluentReadImageCancel') return Promise.resolve({success: true});
            throw new Error(`unexpected controlled runtime request: ${message.type}`);
        }),
    };
    vi.stubGlobal('browser', {runtime});
    const statuses: Array<{active: boolean; pending: boolean; errors: number; completed?: number}> = [];
    const stopStatus = subscribeMangaTranslation(status => statuses.push(status));
    cleanup = async () => {
        unmountImageTranslator();
        // All owned external promises settle, including a failed assertion before the intended reply.
        page.reject(new TypeError('controlled page teardown'));
        extension.reject(new Error('controlled extension teardown'));
        await drain(); stopStatus();
        expect(messageListeners.size).toBe(0);
        expect(configurationSubscriptions.size).toBe(0);
        expect(frames.size).toBe(0);
        expect([...windowListeners.values()].every(listeners => listeners.size === 0)).toBe(true);
        expect(observers.every(observer => observer.disconnect.mock.calls.length > 0)).toBe(true);
        expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
        expect(decoded.every(bitmap => bitmap.src === '' && bitmap.onload === null && bitmap.onerror === null)).toBe(true);
        expect(readers.every(reader => reader.readyState === 2 && reader.onload === null && reader.onerror === null)).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    };
    // The transport's never-used branch must still consume teardown rejection.
    void extension.promise.catch(() => undefined);
    mountImageTranslator();
    expect(toggleMangaTranslation()).toBe(true);
    return {image, page, pageFetch, extension, messages, authorizations, messageListeners, statuses, decoded, canvases, readers, drawCalls,
        securityErrors: () => securityErrors, pageSignal: () => pageSignal};
}

async function beginRead() {
    const env = mountLongImage();
    await observePublic(() => env.pageFetch.mock.calls.length === 1, 'real segment capture reaches page fetch');
    expect(env.securityErrors()).toBe(1);
    expect(env.drawCalls[0]).toEqual([env.image, 0, 0, 400, 2304, 0, 0, 400, 2304]);
    expect(env.pageFetch).toHaveBeenCalledWith(SOURCE_URL, expect.objectContaining({mode: 'cors', credentials: 'omit', signal: expect.any(AbortSignal)}));
    return env;
}
async function jumpAfter400(direction: typeof directions[number]) {
    monotonic = 400;
    await vi.advanceTimersByTimeAsync(400);
    vi.setSystemTime(WALL_START + 400 + (direction === 'backward' ? -300_000 : 300_000));
}
async function rejectPage(env: Awaited<ReturnType<typeof beginRead>>) {
    env.page.reject(new TypeError('controlled network/CORS failure'));
    await observePublic(() => env.messages.some(message => message.type === 'fluentReadImageFetch'), 'real extension fallback entered');
    const message = env.messages.find(message => message.type === 'fluentReadImageFetch')!;
    expect(message).toMatchObject({url: SOURCE_URL, timeoutMs: 14_600});
    expect(message.requestId).toMatch(/^image-source-/);
    expect(env.authorizations).toEqual([{valid: true}]);
    return message;
}

beforeEach(() => {
    vi.useFakeTimers({toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']});
    vi.setSystemTime(WALL_START); monotonic = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
    config.on = true; config.disableImageTranslator = false; config.imageTranslationMangaEnabled = true;
    config.imageTranslationMangaSites = [{hostname: 'reader.fixture.com', pathPrefix: '/chapter/', selector: 'main .chapter-page'}];
    config.imageTranslationMangaPrefetchPages = 0; config.imageTranslationMangaDownloadConfirmed = false;
    config.imageTranslationMangaCachePages = 12; config.imageTranslationOcrEngine = 'paddle';
    config.from = 'en'; config.to = 'zh-Hans'; config.useCache = true; config.uiLanguage = 'zh-CN';
});
afterEach(async () => {
    try {await cleanup?.();}
    finally {cleanup = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();}
});

describe('长漫画图片授权读取的总时间预算', () => {
    it.each(directions)('墙钟%s跳变后扩展读取保留14600ms预算并正常完成', async direction => {
        const env = await beginRead(); await jumpAfter400(direction); await rejectPage(env);
        env.extension.resolve({success: true, image: PNG});
        await observePublic(() => env.statuses.at(-1)?.pending === false && env.statuses.at(-1)?.completed === 1, 'real session completes');
        expect(env.messages.filter(message => message.type === 'fluentReadImageTranslate')).toHaveLength(1);
        expect(env.pageFetch).toHaveBeenCalledOnce();expect(env.readers).toHaveLength(1);
        expect(env.readers[0].readAsDataURL).toHaveBeenCalledWith(expect.any(Blob));
        expect(env.messages.some(message => message.type === 'fluentReadImageCancel')).toBe(false);
        expect(env.messageListeners.size).toBe(0);
        expect(env.statuses.at(-1)).toMatchObject({active: true, pending: false, errors: 0, completed: 1});
        expect(env.image.src).toBe(SOURCE_URL); expect(env.image.naturalHeight).toBe(6000);
        expect(env.decoded[0]).toMatchObject({src: '', onload: null, onerror: null});
    });
    it.each(directions)('墙钟%s跳变不延长或提前结束15s总读取等待', async direction => {
        const env = await beginRead(); await jumpAfter400(direction); const message = await rejectPage(env);
        monotonic = 14_999; await vi.advanceTimersByTimeAsync(14_599);
        expect(env.statuses.at(-1)?.pending).toBe(true);
        expect(env.messages.some(value => value.type === 'fluentReadImageCancel')).toBe(false);
        monotonic = 15_000; await vi.advanceTimersByTimeAsync(1);
        await observePublic(() => env.statuses.at(-1)?.pending === false, 'total read timeout ends session page');
        expect(env.messages.filter(value => value.type === 'fluentReadImageCancel')).toEqual([{type: 'fluentReadImageCancel', requestId: message.requestId}]);
        expect(env.statuses.at(-1)?.errors).toBe(1); expect(env.messageListeners.size).toBe(0);
        env.extension.reject(new Error('late extension failure'));
        await drain(); expect(env.messages.filter(value => value.type === 'fluentReadImageTranslate')).toHaveLength(0);
    });
    it.each(directions)('墙钟%s跳变后取消页面读取，迟到TypeError不触发扩展消息', async direction => {
        const env = await beginRead(); await jumpAfter400(direction);
        expect(toggleMangaTranslation()).toBe(true);
        await observePublic(() => env.pageSignal()?.aborted === true, 'page fetch signal aborts on pause');
        env.page.reject(new TypeError('late page network failure')); await drain();
        expect(env.messages).toEqual([]); expect(env.decoded).toHaveLength(0);
        expect(env.statuses.at(-1)).toMatchObject({active: false, pending: false, errors: 0});
        expect(env.image.src).toBe(SOURCE_URL);
    });
    it.each(['resolve', 'reject'] as const)('卸载授权读取后消费迟到%s，撤下授权且不继续解码或翻译', async outcome => {
        const env = await beginRead(); await jumpAfter400('backward'); const message = await rejectPage(env);
        unmountImageTranslator(); await drain();
        expect(env.messages.filter(value => value.type === 'fluentReadImageCancel')).toEqual([{type: 'fluentReadImageCancel', requestId: message.requestId}]);
        expect(env.messageListeners.size).toBe(0);
        const before = env.statuses.length;
        if (outcome === 'resolve') env.extension.resolve({success: true, image: PNG});
        else env.extension.reject(new Error('late discarded response failure'));
        await drain();
        expect(env.statuses).toHaveLength(before); expect(env.decoded).toHaveLength(0);
        expect(env.messages.filter(value => value.type === 'fluentReadImageTranslate')).toHaveLength(0);
        expect(env.image.src).toBe(SOURCE_URL);
        expect(env.canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
    });
});
