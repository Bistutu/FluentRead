import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({cleanupTranslationCache: vi.fn()}));

vi.mock('@/src/app/translation/runtime', () => ({
    cleanupTranslationCache: mocks.cleanupTranslationCache,
}));

interface AlarmListener {
    (alarm: {name: string}): void;
}

function browserFixture(existingAlarm?: {name: string}) {
    const listeners: AlarmListener[] = [];
    const create = vi.fn(async () => undefined);
    vi.stubGlobal('browser', {
        alarms: {
            onAlarm: {addListener: (listener: AlarmListener) => listeners.push(listener)},
            get: vi.fn(async () => existingAlarm),
            create,
        },
    });
    return {listeners, create, get: browser.alarms.get};
}

beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    mocks.cleanupTranslationCache.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals();});

async function settle() {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

describe('后台翻译缓存维护调度', () => {
    it('worker 启动立即清理并只响应命名 alarm，缺失任务时创建每日维护', async () => {
        const fixture = browserFixture();
        const runtime = await import('@/src/app/background/cacheCleanup');

        runtime.installTranslationCacheCleanup();
        await settle();

        expect(mocks.cleanupTranslationCache).toHaveBeenCalledOnce();
        expect(fixture.create).toHaveBeenCalledWith(runtime.TRANSLATION_CACHE_CLEANUP_ALARM, {
            delayInMinutes: 1,
            periodInMinutes: 1440,
        });
        fixture.listeners[0]({name: 'other-alarm'});
        expect(mocks.cleanupTranslationCache).toHaveBeenCalledOnce();
        fixture.listeners[0]({name: runtime.TRANSLATION_CACHE_CLEANUP_ALARM});
        await settle();
        expect(mocks.cleanupTranslationCache).toHaveBeenCalledTimes(2);
    });

    it('已有每日维护任务时不重复创建', async () => {
        const runtime = await import('@/src/app/background/cacheCleanup');
        const fixture = browserFixture({name: runtime.TRANSLATION_CACHE_CLEANUP_ALARM});

        runtime.installTranslationCacheCleanup();
        await settle();

        expect(fixture.create).not.toHaveBeenCalled();
        expect(mocks.cleanupTranslationCache).toHaveBeenCalledOnce();
    });

    it('存储清理尚未完成时合并重复 alarm，完成后仍能继续维护', async () => {
        let finish!: () => void;
        mocks.cleanupTranslationCache.mockReturnValueOnce(new Promise<void>(resolve => {finish = resolve;}));
        const fixture = browserFixture();
        const runtime = await import('@/src/app/background/cacheCleanup');
        runtime.installTranslationCacheCleanup();
        await settle();
        for (let index = 0; index < 20; index += 1) fixture.listeners[0]({name: runtime.TRANSLATION_CACHE_CLEANUP_ALARM});
        await settle();
        expect(mocks.cleanupTranslationCache).toHaveBeenCalledOnce();
        finish();
        await settle();
        fixture.listeners[0]({name: runtime.TRANSLATION_CACHE_CLEANUP_ALARM});
        await settle();
        expect(mocks.cleanupTranslationCache).toHaveBeenCalledTimes(2);
    });

    it('清理失败被观察且后续 alarm 可以重试，不阻断每日任务安装', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mocks.cleanupTranslationCache.mockRejectedValueOnce(new Error('private storage detail'));
        const fixture = browserFixture();
        const runtime = await import('@/src/app/background/cacheCleanup');
        runtime.installTranslationCacheCleanup();
        await settle();
        expect(warn).toHaveBeenCalledWith('[FluentRead] 翻译缓存清理失败，将在下次维护时重试');
        expect(fixture.create).toHaveBeenCalledOnce();
        fixture.listeners[0]({name: runtime.TRANSLATION_CACHE_CLEANUP_ALARM});
        await settle();
        expect(mocks.cleanupTranslationCache).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenCalledOnce();
    });

    it.each(['get', 'create'] as const)('alarm %s 失败被观察，已安装的清理监听仍然可用', async operation => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const fixture = browserFixture();
        vi.mocked(fixture[operation]).mockRejectedValueOnce(new Error('browser alarm unavailable'));
        const runtime = await import('@/src/app/background/cacheCleanup');
        runtime.installTranslationCacheCleanup();
        await settle();
        expect(warn).toHaveBeenCalledWith('[FluentRead] 翻译缓存定期维护任务安装失败');
        fixture.listeners[0]({name: runtime.TRANSLATION_CACHE_CLEANUP_ALARM});
        await settle();
        expect(mocks.cleanupTranslationCache).toHaveBeenCalledTimes(2);
    });
});
