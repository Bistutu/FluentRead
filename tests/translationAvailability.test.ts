import {describe, expect, it, vi} from 'vitest';
import {createTranslationAvailability} from '@/src/services/translation/availability';
import {attachTranslationRequestControl, getTranslationRequestControl, markTranslationRemainingBudget} from '@/src/services/translation/requestSnapshot';
import {TRANSLATION_REMAINING_BUDGET} from '@/src/services/translation/types';
import {serializeTranslationError} from '@/src/services/translation/errors';
import type {TranslationRequestMessage} from '@/src/services/translation/types';

function deferred<T = string>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
}
function fixture(on = true, ready: Promise<unknown> = Promise.resolve()) {
    const config = {on};
    let listener!: (value: typeof config) => void;
    const translate = vi.fn(async (_message: TranslationRequestMessage): Promise<string | string[]> => '译文');
    const api = createTranslationAvailability({ready, getConfig: () => config, translate,
        subscribe(callback) {listener = callback; callback(config); return () => {};},
    });
    return {api, config, translate, update(on: boolean) {config.on = on; listener(config);}};
}
const message = (): TranslationRequestMessage => ({origin: 'Source text', context: 'test'});

describe('全局翻译开关的共享请求边界', () => {
    it('共享入口在配置水合前固定原文和选项，仍保留内部预算与取消所有权', async () => {
        const hydration = deferred<void>();
        const f = fixture(true, hydration.promise);
        const original = markTranslationRemainingBudget({origin: ['Original text'], glossaryIds: ['library-a'], targetLanguage: 'zh-Hans', requestTimeoutMs: 100});
        const result = f.api.translateWithCache(original);
        original.origin[0] = 'Changed text';
        original.glossaryIds.push('library-b');
        original.targetLanguage = 'ja';
        hydration.resolve();
        await expect(result).resolves.toBe('译文');
        expect(f.translate.mock.calls[0][0]).toMatchObject({origin: ['Original text'], glossaryIds: ['library-a'], targetLanguage: 'zh-Hans', [TRANSLATION_REMAINING_BUDGET]: true});
    });
    it('配置水合为关闭时不进入缓存或 provider；错误跨 runtime 后不可重试', async () => {
        const hydration = deferred<void>();
        const f = fixture(true, hydration.promise);
        const result = f.api.translateWithCache(message());
        expect(f.translate).not.toHaveBeenCalled();
        f.config.on = false;
        hydration.resolve();
        const error = await result.catch(error => error);
        expect(error.name).toBe('TranslationDisabledError');
        expect(serializeTranslationError(error)).toMatchObject({code: 'TRANSLATION_DISABLED', retryable: false});
        expect(f.translate).not.toHaveBeenCalled();
    });

    it('水合失败不会发送请求', async () => {
        const error = new Error('configuration unavailable');
        const f = fixture(true, Promise.reject(error));
        await expect(f.api.translateWithCache(message())).rejects.toBe(error);
        expect(f.translate).not.toHaveBeenCalled();
    });

    it('保留内部不可枚举预算、消息字段和调用者所有权，完成后移除取消监听', async () => {
        const f = fixture(); await f.api.ready;
        const owner = new AbortController();
        const remove = vi.spyOn(owner.signal, 'removeEventListener');
        const original = attachTranslationRequestControl(markTranslationRemainingBudget({...message(), requestTimeoutMs: 125}), {signal: owner.signal, ownershipKey: 'document-1'});
        await expect(f.api.translateWithCache(original)).resolves.toBe('译文');
        const request = f.translate.mock.calls[0][0];
        expect(request).not.toBe(original);
        expect(request).toMatchObject({origin: 'Source text', requestTimeoutMs: 125, [TRANSLATION_REMAINING_BUDGET]: true});
        expect(getTranslationRequestControl(request)?.ownershipKey).toBe('document-1|global:0');
        expect(getTranslationRequestControl(original)?.signal).toBe(owner.signal);
        expect(remove).toHaveBeenCalledOnce();
        f.update(false);
        expect(getTranslationRequestControl(request)?.signal.aborted).toBe(false);
    });

    it('同时停止普通与独立请求；重开后新请求不复用旧代次，迟到结果不能完成旧请求', async () => {
        const f = fixture(); await f.api.ready;
        const slow = deferred(); f.translate.mockReturnValue(slow.promise);
        const requests = [f.api.translateWithCache(message()), f.api.translateWithCache(message())];
        const settled = Promise.allSettled(requests);
        await vi.waitFor(() => expect(f.translate).toHaveBeenCalledTimes(2));
        const old = f.translate.mock.calls.map(([request]) => getTranslationRequestControl(request)!);
        expect(old[0].ownershipKey).toBe(old[1].ownershipKey);
        f.update(false); f.update(false); f.update(true); f.update(true);
        expect(old.every(control => control.signal.aborted)).toBe(true);
        const results = await settled;
        expect(results.every(result => result.status === 'rejected' && result.reason.code === 'TRANSLATION_DISABLED')).toBe(true);
        f.translate.mockResolvedValue('新译文');
        await expect(f.api.translateWithCache(message())).resolves.toBe('新译文');
        expect(getTranslationRequestControl(f.translate.mock.calls[2][0])?.ownershipKey).toBe('shared|global:1');
        slow.resolve('迟到的译文');
    });

    it('调用者单独取消不影响其他请求，provider 忽略取消也会立即结束等待', async () => {
        const f = fixture(); await f.api.ready;
        const slow = deferred(); f.translate.mockReturnValueOnce(slow.promise);
        const owner = new AbortController();
        const result = f.api.translateWithCache(attachTranslationRequestControl(message(), {signal: owner.signal, ownershipKey: 'first'}));
        const rejection = expect(result).rejects.toMatchObject({name: 'AbortError'});
        await vi.waitFor(() => expect(f.translate).toHaveBeenCalledOnce());
        owner.abort(); await rejection;
        await expect(f.api.translateWithCache(message())).resolves.toBe('译文');
        slow.reject(new Error('late provider failure'));
    });

    it.each(['before', 'during'])('配置水合长期等待时%s取消立即退出，迟到水合不派发请求', async mode => {
        const hydration = deferred<void>();
        const f = fixture(true, hydration.promise);
        const owner = new AbortController();
        if (mode === 'before') owner.abort();
        let failure: unknown;
        const result = f.api.translateWithCache(attachTranslationRequestControl(message(), {
            signal: owner.signal, ownershipKey: 'hydrating',
        })).catch(error => {failure = error;});
        if (mode === 'during') owner.abort();
        try {
            for (let index = 0; index < 10; index++) await Promise.resolve();
            expect(failure).toMatchObject({name: 'AbortError'});
            expect(f.translate).not.toHaveBeenCalled();
        } finally {
            hydration.resolve();
            await result;
        }
        expect(f.translate).not.toHaveBeenCalled();
    });

    it('已取消的调用者不会触发 provider', async () => {
        const f = fixture(); const owner = new AbortController(); owner.abort();
        await expect(f.api.translateWithCache(attachTranslationRequestControl(message(), {signal: owner.signal, ownershipKey: 'cancelled'}))).rejects.toMatchObject({name: 'AbortError'});
        expect(f.translate).not.toHaveBeenCalled();
    });

    it('订阅前后的同步修改同样生效，并在 provider 入队前取消', async () => {
        const f = fixture(); await f.api.ready;
        f.config.on = false;
        await expect(f.api.translateWithCache(message())).rejects.toMatchObject({code: 'TRANSLATION_DISABLED'});
        f.config.on = true;
        const result = f.api.translateWithCache(message());
        const rejection = expect(result).rejects.toMatchObject({code: 'TRANSLATION_DISABLED'});
        // translate 的第一个 await 已恢复并建立取消监听，但 provider 的微任务尚未执行。
        await Promise.resolve(); f.update(false);
        await rejection; expect(f.translate).not.toHaveBeenCalled();
    });

    it('provider 拒绝或同步抛错保持原始错误，批量结果原样返回', async () => {
        const f = fixture(); const failure = new Error('provider failed');
        f.translate.mockImplementationOnce(() => {throw failure;});
        await expect(f.api.translateWithCache(message())).rejects.toBe(failure);
        f.translate.mockRejectedValueOnce(failure);
        await expect(f.api.translateWithCache(message())).rejects.toBe(failure);
        f.translate.mockResolvedValueOnce(['甲', '乙']);
        await expect(f.api.translateWithCache({...message(), origin: ['A', 'B']})).resolves.toEqual(['甲', '乙']);
    });
});
