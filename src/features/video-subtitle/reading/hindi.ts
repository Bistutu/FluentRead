/**
 * @file src/features/video-subtitle/reading/hindi.ts
 * 文件职责：在自有读音 Worker 中按需初始化印地语读音引擎，处理印地语固有元音脱落。
 * 主要内容：编译期固定 Go 运行时、随扩展发布的 WASM、失败响应正文非阻塞回收、共享可重试初始化与结合词典、候选排序的本地罗马字。
 * 模块边界：不使用第三方包中动态 eval 的加载器，不加载远程代码；可信 WASM URL、取消、超时及内存释放由专属 Worker 生命周期控制。
 */
import '@fluentread/gomanize-go-runtime';
import {cancelUnreadResponseBody} from '@/src/platform/http/runtime';

type HindiTransliterator = (text: string, options: {lexicon: boolean; rerank: boolean}) => string;
interface GoRuntime {
    importObject: WebAssembly.Imports;
    run(instance: WebAssembly.Instance): Promise<void>;
}
interface HindiWorkerScope {
    Go?: new () => GoRuntime;
    gomanizeTranslit?: HindiTransliterator;
}

async function initializeHindi(wasmUrl: string): Promise<HindiTransliterator> {
    const scope = globalThis as HindiWorkerScope;
    if (!scope.Go) throw new Error('Hindi reading runtime is unavailable');
    const response = await fetch(wasmUrl);
    if (!response.ok) {
        cancelUnreadResponseBody(response);
        throw new Error(`Hindi reading engine failed to load (${response.status})`);
    }
    const runtime = new scope.Go();
    const bytes = await response.arrayBuffer();
    const {instance} = await WebAssembly.instantiate(bytes, runtime.importObject);
    // Go 的 main 在首次挂起前暴露固定函数；其常驻 Promise 由 Worker.terminate 统一释放。
    let runtimeFailure: unknown;
    void runtime.run(instance).catch(error => {runtimeFailure = error;});
    const transliterate = scope.gomanizeTranslit;
    if (typeof transliterate !== 'function') throw new Error('Hindi reading engine did not initialize');
    return (text, options) => {
        if (runtimeFailure) throw runtimeFailure;
        return transliterate(text, options);
    };
}

export function createHindiRomanizer(load: (url: string) => Promise<HindiTransliterator> = initializeHindi): (text: string, wasmUrl: string) => Promise<string> {
    let initialization: {url: string; promise: Promise<HindiTransliterator>} | undefined;
    return async (text, wasmUrl) => {
        if (text.length > 3000) throw new Error('Hindi reading text exceeds 3000 characters');
        const normalized = text.normalize('NFC');
        if (!/\p{Script=Devanagari}/u.test(normalized)) return normalized;
        if (!wasmUrl) throw new Error('Hindi reading engine URL is required');
        if (initialization && initialization.url !== wasmUrl) throw new Error('Hindi reading engine changed; create a new Worker');
        initialization ??= {url: wasmUrl, promise: load(wasmUrl)};
        const current = initialization;
        try {
            const transliterate = await current.promise;
            // 上游独立语料评测中，词典提高常用词一致性，双候选排序改善未知词；仍由规则处理固有元音脱落。
            return transliterate(normalized, {lexicon: true, rerank: true});
        } catch (error) {
            if (initialization === current) initialization = undefined;
            throw error;
        }
    };
}

export const romanizeHindi = createHindiRomanizer();
