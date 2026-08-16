import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeConfig } from '@/entrypoints/utils/model';

const storageMock = vi.hoisted(() => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    watch: vi.fn(),
}));

vi.mock('@wxt-dev/storage', () => ({ storage: storageMock }));

const storedConfig = {
    on: true,
    service: 'openai',
    from: 'auto',
    to: 'zh-Hans',
};

async function loadConfigModule(value: unknown = null) {
    vi.resetModules();
    storageMock.getItem.mockReset().mockResolvedValue(value);
    storageMock.setItem.mockReset().mockResolvedValue(undefined);
    storageMock.watch.mockReset().mockReturnValue(() => undefined);
    return import('@/entrypoints/utils/config');
}

describe('统一配置存储', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('兼容旧 JSON 字符串，并只迁移成一次对象存储', async () => {
        const configStore = await loadConfigModule(JSON.stringify(storedConfig));

        await configStore.configReady;

        expect(storageMock.setItem).toHaveBeenCalledTimes(1);
        expect(storageMock.setItem).toHaveBeenCalledWith(
            'local:config',
            expect.objectContaining(storedConfig),
        );
        expect(typeof storageMock.setItem.mock.calls[0][1]).toBe('object');
    });

    it('读取已经规范化的对象时不产生初始化回写', async () => {
        const canonicalConfig = normalizeConfig(storedConfig);
        const configStore = await loadConfigModule(canonicalConfig);

        await configStore.configReady;

        expect(storageMock.setItem).not.toHaveBeenCalled();
        expect(configStore.config).toMatchObject(storedConfig);
    });

    it('存储内容损坏时回退到默认配置，并保持初始化 Promise 可用', async () => {
        const configStore = await loadConfigModule('{not-json');

        await expect(configStore.configReady).resolves.toBeUndefined();

        expect(configStore.config.on).toBe(true);
        expect(storageMock.setItem).toHaveBeenCalledWith(
            'local:config',
            expect.objectContaining({ on: true }),
        );
    });

    it('保存相同快照时去重，并让连续保存只保留最新快照', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        storageMock.setItem.mockClear();

        const firstSave = configStore.saveConfig({ ...configStore.config, on: false });
        const latestSave = configStore.saveConfig({ ...configStore.config, on: true, to: 'en' });
        await Promise.all([firstSave, latestSave]);

        expect(storageMock.setItem).toHaveBeenCalledTimes(1);
        expect(storageMock.setItem).toHaveBeenLastCalledWith(
            'local:config',
            expect.objectContaining({ on: true, to: 'en' }),
        );

        storageMock.setItem.mockClear();
        await configStore.saveConfig({ ...configStore.config, on: true, to: 'en' });
        expect(storageMock.setItem).not.toHaveBeenCalled();
    });

    it('收到外部对象更新时立即同步运行时状态，并通知订阅者', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const listener = vi.fn();
        const unsubscribe = configStore.subscribeConfig(listener);
        const watchCallback = storageMock.watch.mock.calls[0][1];

        watchCallback({ ...storedConfig, on: false }, storedConfig);

        expect(configStore.config.on).toBe(false);
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ on: false }));
        unsubscribe();
    });

    it('外部更新不会被本地 watcher 再次写回，取消订阅后也不再通知', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const listener = vi.fn();
        const unsubscribe = configStore.subscribeConfig(listener);
        const watchCallback = storageMock.watch.mock.calls[0][1];
        listener.mockClear();
        storageMock.setItem.mockClear();

        watchCallback({ ...storedConfig, on: false }, storedConfig);
        unsubscribe();
        watchCallback({ ...storedConfig, on: true }, { ...storedConfig, on: false });

        expect(storageMock.setItem).not.toHaveBeenCalled();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('短生命周期页面通过后台提交规范化快照，而不是自行承担落盘', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        storageMock.setItem.mockClear();
        const sendMessage = vi.fn().mockResolvedValue({ success: true });

        await configStore.requestConfigSave({ ...configStore.config, to: 'en' }, sendMessage);

        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: configStore.CONFIG_PERSIST_MESSAGE,
            config: expect.objectContaining({ to: 'en' }),
        }));
        expect(storageMock.setItem).not.toHaveBeenCalled();
    });

    it('后台不可用时保留当前上下文的降级保存路径', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        storageMock.setItem.mockClear();
        const sendMessage = vi.fn().mockRejectedValue(new Error('Receiving end does not exist'));

        await configStore.requestConfigSave({ ...configStore.config, to: 'ja' }, sendMessage);

        expect(storageMock.setItem).toHaveBeenCalledWith(
            'local:config',
            expect.objectContaining({ to: 'ja' }),
        );
    });

    it('连续请求按页面顺序发送，避免旧快照覆盖最新快照', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const sent: string[] = [];
        let releaseFirst!: () => void;
        const firstFinished = new Promise<void>((resolve) => { releaseFirst = resolve; });
        const sendMessage = vi.fn(async ({ config }: { config: { to: string } }) => {
            sent.push(config.to);
            if (sent.length === 1) await firstFinished;
            return { success: true };
        });

        const first = configStore.requestConfigSave({ ...configStore.config, to: 'en' }, sendMessage);
        const latest = configStore.requestConfigSave({ ...configStore.config, to: 'ja' }, sendMessage);
        await vi.waitFor(() => expect(sent).toEqual(['en', 'ja']));
        releaseFirst();
        await Promise.all([first, latest]);

        expect(sent).toEqual(['en', 'ja']);
    });

    it('本地存在更新请求时忽略旧 storage 回声', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        let release!: () => void;
        const pending = new Promise<void>((resolve) => { release = resolve; });
        const sendMessage = vi.fn(async () => {
            await pending;
            return { success: true };
        });
        const latest = { ...configStore.config, to: 'ja' };
        const request = configStore.requestConfigSave(latest, sendMessage);
        const listener = vi.fn();
        const unsubscribe = configStore.subscribeConfig(listener);
        listener.mockClear();
        const watchCallback = storageMock.watch.mock.calls[0][1];

        watchCallback({ ...storedConfig, to: 'en' }, storedConfig);

        expect(configStore.config.to).toBe('zh-Hans');
        expect(listener).not.toHaveBeenCalled();
        release();
        await request;
        unsubscribe();
    });

    it('迟到的旧版本 storage 快照不会回滚已同步的新版本', async () => {
        const configStore = await loadConfigModule({ ...storedConfig, __fluentConfigRevision: 5 });
        await configStore.configReady;
        const watchCallback = storageMock.watch.mock.calls[0][1];

        watchCallback({ ...storedConfig, to: 'ja', __fluentConfigRevision: 7 }, storedConfig);
        watchCallback({ ...storedConfig, to: 'en', __fluentConfigRevision: 6 }, storedConfig);

        expect(configStore.config.to).toBe('ja');
    });
});
