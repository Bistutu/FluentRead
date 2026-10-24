import {describe, expect, it, vi} from 'vitest';
import {requestTranslationCacheClear} from '@/src/app/popup/cache';

describe('popup translation cache clear', () => {
    it('只接受后台明确确认的成功响应', async () => {
        const sendMessage = vi.fn(async () => ({success: true}));
        await expect(requestTranslationCacheClear(sendMessage)).resolves.toEqual({invalidationPending: false});
        expect(sendMessage).toHaveBeenCalledWith({type: 'clearTranslationCache'});
    });

    it('保留页面仍同步状态，只接受明确布尔标记', async () => {
        await expect(requestTranslationCacheClear(async () => ({success: true, invalidationPending: true})))
            .resolves.toEqual({invalidationPending: true});
        await expect(requestTranslationCacheClear(async () => ({success: true, invalidationPending: false})))
            .resolves.toEqual({invalidationPending: false});
        await expect(requestTranslationCacheClear(async () => ({success: true, invalidationPending: 'true'})))
            .rejects.toThrow('后台缓存清理同步状态无效');
    });

    it('转交调用者取消，并在发送前拒绝已经失活的请求', async () => {
        const controller = new AbortController(), sendMessage = vi.fn(() => new Promise<unknown>(() => {}));
        const pending = requestTranslationCacheClear(sendMessage, {signal: controller.signal});
        controller.abort(); await expect(pending).rejects.toMatchObject({name: 'AbortError'});
        await expect(requestTranslationCacheClear(sendMessage, {signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
        expect(sendMessage).toHaveBeenCalledOnce();
    });

    it('保留后台错误并拒绝空响应或发送失败', async () => {
        await expect(requestTranslationCacheClear(async () => ({success: false, error: 'IndexedDB blocked'})))
            .rejects.toThrow('IndexedDB blocked');
        await expect(requestTranslationCacheClear(async () => undefined))
            .rejects.toThrow('后台未确认缓存清理成功');
        await expect(requestTranslationCacheClear(async () => { throw new Error('worker stopped'); }))
            .rejects.toThrow('worker stopped');
        await expect(requestTranslationCacheClear(async () => ({success: false, error: 500})))
            .rejects.toThrow('后台未确认缓存清理成功');
    });
});
