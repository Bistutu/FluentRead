export interface UserscriptContentContext {
    readonly isInvalid: boolean;
    onInvalidated(callback: () => void): () => void;
    invalidate(): void;
}

/** 用显式失效回调模拟 WXT 内容脚本上下文，统一驱动共享功能在离页时清理资源。 */
export function createUserscriptContentContext(): UserscriptContentContext {
    const callbacks = new Set<() => void>();
    let invalid = false;
    return {
        get isInvalid() {
            return invalid;
        },
        onInvalidated(callback) {
            if (invalid) {
                callback();
                return () => {};
            }
            callbacks.add(callback);
            return () => { callbacks.delete(callback); };
        },
        invalidate() {
            if (invalid) return;
            invalid = true;
            const pending = [...callbacks];
            callbacks.clear();
            let failed = false;
            let firstError: unknown;
            for (const callback of pending) {
                try {callback();}
                catch (error) {
                    if (!failed) {failed = true; firstError = error;}
                }
            }
            // 每个资源均有机会清理，再保留首个异常供上层诊断；重复失效仍为幂等。
            if (failed) throw firstError;
        },
    };
}
