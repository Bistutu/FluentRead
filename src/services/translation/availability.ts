/**
 * @file src/services/translation/availability.ts
 * 文件职责：把全局翻译开关接入共享翻译入口，关闭时拒绝新请求并取消所有在途请求。
 * 主要内容：在等待前复制请求字段与可编辑数组，等待配置水合、订阅启停状态、合并调用者取消信号，按启用代次隔离请求所有权，保留消息上的内部快照与预算。
 * 模块边界：只组合注入的配置和翻译端口，不访问浏览器、不改写用户设置，也不清除已完成译文或缓存。
 */
import type {TranslationBroker, TranslationRequestMessage} from './types';
import {attachTranslationRequestControl, createTranslationRequestSnapshot, getTranslationRequestControl} from './requestSnapshot';
import {TRANSLATION_REQUEST_CONTROL} from './types';

interface AvailabilityDependencies {
    ready: Promise<unknown>;
    getConfig(): {on: boolean};
    subscribe(listener: (config: {on: boolean}) => void): () => void;
    translate: TranslationBroker['translateWithCache'];
}

export class TranslationDisabledError extends Error {
    readonly retryable = false;
    readonly code = 'TRANSLATION_DISABLED';
    constructor() {
        super('插件已关闭，请在通用设置中启动插件。');
        this.name = 'TranslationDisabledError';
    }
}

/** 每个应用运行时持有一个订阅；关闭再开启不会恢复旧请求或加入旧的在途去重组。 */
export function createTranslationAvailability(deps: AvailabilityDependencies) {
    let generation = 0;
    let epoch = new AbortController();
    const apply = ({on}: {on: boolean}) => {
        if (!on) epoch.abort();
        else if (epoch.signal.aborted) {
            generation += 1;
            epoch = new AbortController();
        }
    };
    const ready = deps.ready.then(() => {
        deps.subscribe(apply);
        apply(deps.getConfig());
    });

    async function translateWithCache(message: TranslationRequestMessage): Promise<string | string[]> {
        message = createTranslationRequestSnapshot(message);
        await ready;
        apply(deps.getConfig());
        if (epoch.signal.aborted) throw new TranslationDisabledError();
        const globalSignal = epoch.signal;
        const owner = getTranslationRequestControl(message);
        const controller = new AbortController();
        const abort = () => controller.abort();
        const failure = () => globalSignal.aborted
            ? new TranslationDisabledError()
            : new DOMException('翻译已取消', 'AbortError');
        if (owner?.signal.aborted) throw failure();
        globalSignal.addEventListener('abort', abort, {once: true});
        owner?.signal.addEventListener('abort', abort, {once: true});

        // 展开运算符会丢失不可枚举的预算/快照 symbol；复制描述符并只替换取消控制。
        const descriptors = Object.getOwnPropertyDescriptors(message);
        Reflect.deleteProperty(descriptors, TRANSLATION_REQUEST_CONTROL);
        const request = attachTranslationRequestControl(Object.defineProperties({}, descriptors) as TranslationRequestMessage, {
            signal: controller.signal,
            ownershipKey: `${owner?.ownershipKey ?? 'shared'}|global:${generation}`,
        });
        let onAbort!: () => void;
        const cancelled = new Promise<never>((_, reject) => {
            onAbort = () => reject(failure());
            controller.signal.addEventListener('abort', onAbort, {once: true});
        });
        try {
            return await Promise.race([Promise.resolve().then(() => {
                if (controller.signal.aborted) throw failure();
                return deps.translate(request);
            }), cancelled]);
        } finally {
            globalSignal.removeEventListener('abort', abort);
            owner?.signal.removeEventListener('abort', abort);
            controller.signal.removeEventListener('abort', onAbort);
        }
    }
    return {ready, translateWithCache};
}
