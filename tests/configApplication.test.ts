/**
 * @file tests/configApplication.test.ts
 * 文件职责：验证配置应用实例的显式启动、状态隔离和真实权威端到客户端提交协作。
 * 主要内容：直接组合生产 authority/client/history 与后台保存 handler，以可控存储和消息等待验证独立实例、计数重放及并发字段保留。
 * 模块边界：不替换配置领域规则，不读取真实凭据或浏览器存储，不复制生产 CAS 或 ACK 算法。
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {normalizeConfig} from '@/src/core/config/model';
import {extractConfigCredentials, sanitizeConfigCredentials} from '@/src/core/config/credentials';
import {createConfigApplication, type ConfigApplication} from '@/src/services/config/application';
import {createConfigPersistenceHandler} from '@/src/app/background/handlers/configPersistence';
import type {ConfigStoragePort} from '@/src/platform/storage/configStorage';

const applications: ConfigApplication[] = [];
afterEach(async () => {
    await Promise.all(applications.splice(0).map(application => application.flushConfigHistory()));
});

function pending<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {resolve = done;});
    return {promise, resolve};
}

function memoryStorage(to: string, count = 7) {
    const initial = normalizeConfig({to, count});
    const records = new Map<string, unknown>([
        ['local:config', {...sanitizeConfigCredentials(initial), __fluentConfigRevision: 4}],
        ['local:credentials', extractConfigCredentials(initial)],
    ]);
    const listeners = new Map<string, Set<(value: unknown) => void>>();
    const reads = vi.fn<(key: string) => void>();
    const notify = (key: string) => {
        for (const listener of listeners.get(key) ?? []) listener(structuredClone(records.get(key) ?? null));
    };
    const port: ConfigStoragePort = {
        writeOwner: true,
        getItem: async <T>(key: string) => {
            reads(key);
            return structuredClone(records.get(key) ?? null) as T | null;
        },
        setItem: vi.fn(async <T>(key: string, value: T) => {records.set(key, structuredClone(value)); notify(key);}),
        setItems: vi.fn(async (entries, removeKeys = []) => {
            for (const [key, value] of entries) records.set(key, structuredClone(value));
            for (const key of removeKeys) records.delete(key);
            for (const key of [...entries.keys(), ...removeKeys]) notify(key);
        }),
        removeItem: vi.fn(async key => {records.delete(key); notify(key);}),
        watch: vi.fn((key, callback) => {
            const watched = listeners.get(key) ?? new Set();
            const listener = callback as (value: unknown) => void;
            listeners.set(key, watched); watched.add(listener);
            return () => {watched.delete(listener);};
        }),
    };
    return {port, records, reads};
}

function application(storage: ConfigStoragePort) {
    const result = createConfigApplication({storage, trustedContext: true});
    applications.push(result);
    return result;
}

describe('explicit configuration application ownership', () => {
    it('reports a storage observer startup failure through the same ready promise', async () => {
        const {port, reads} = memoryStorage('en');
        vi.mocked(port.watch).mockImplementation(() => {throw new Error('observer unavailable');});
        const app = createConfigApplication({storage: port, trustedContext: true});
        const ready = app.start();
        await expect(ready).rejects.toThrow('observer unavailable');
        expect(app.start()).toBe(ready);
        expect(reads).not.toHaveBeenCalled();
        expect(port.setItem).not.toHaveBeenCalled();
    });

    it('reconciles a rejected patch from an already received authoritative watch without another read', async () => {
        const {port, reads} = memoryStorage('en');
        const client = application({...port, writeOwner: false});
        await client.start();
        const sent = pending<void>(), rejectAck = pending<void>();
        const saving = client.requestConfigPatch({to: 'ja'}, async () => {
            sent.resolve();
            await rejectAck.promise;
            return {success: false, error: 'field changed elsewhere'};
        });
        await sent.promise;
        const readCount = reads.mock.calls.length;
        await port.setItem('local:config', {
            ...sanitizeConfigCredentials(normalizeConfig({to: 'fr', on: false, count: 7})),
            __fluentConfigRevision: 5,
        });
        expect(client.config.to).toBe('ja');
        rejectAck.resolve();
        await expect(saving).rejects.toThrow('field changed elsewhere');
        expect(client.config).toMatchObject({to: 'fr', on: false, count: 7});
        expect(client.getConfigRevision()).toBe(5);
        expect(reads.mock.calls).toHaveLength(readCount);
    });

    it('constructs without storage work and starts only one authority hydration', async () => {
        const {port, reads} = memoryStorage('en');
        const app = application(port);
        expect(reads).not.toHaveBeenCalled();
        expect(port.setItem).not.toHaveBeenCalled();
        expect(port.watch).not.toHaveBeenCalled();
        const ready = app.start();
        expect(app.start()).toBe(ready);
        expect(ready).toBe(app.configReady);
        await ready;
        expect(app.config.to).toBe('en');
        const configWatches = vi.mocked(port.watch).mock.calls.filter(([key]) => key === 'local:config');
        expect(configWatches).toHaveLength(1);
    });

    it('isolates authority, client queues and history between independent instances', async () => {
        const left = application(memoryStorage('en').port);
        const right = application(memoryStorage('fr').port);
        expect(left.config).not.toBe(right.config);
        await Promise.all([left.start(), right.start()]);
        await left.requestConfigPatch({to: 'ja'});
        expect(left.config.to).toBe('ja');
        expect(right.config.to).toBe('fr');
        await Promise.all([left.configHistoryReady, right.configHistoryReady]);
        expect(left.getConfigHistorySnapshot().entries.at(-1)?.config.to).toBe('ja');
        expect(right.getConfigHistorySnapshot().entries.at(-1)?.config.to).toBe('fr');
    });

    it('keeps durable count-operation replay when a new authority instance starts', async () => {
        const {port} = memoryStorage('en');
        const first = application(port);
        await first.start();
        expect(await first.incrementConfigCount(3, 'application:count:1')).toBe(10);
        const restarted = application(port);
        await restarted.start();
        expect(await restarted.incrementConfigCount(3, 'application:count:1')).toBe(10);
        expect(restarted.config.count).toBe(10);
        expect(await restarted.incrementConfigCount(2, 'application:count:2')).toBe(12);
    });

    it('uses the real background authority and preserves concurrent unrelated fields across a delayed ACK', async () => {
        const {port} = memoryStorage('en');
        const owner = application(port);
        const client = application({...port, writeOwner: false});
        await Promise.all([owner.start(), client.start()]);
        const handler = createConfigPersistenceHandler({
            ready: owner.configReady, getCurrentConfig: () => owner.config,
            prepareConfigSaveRequest: owner.prepareConfigSaveRequest,
            prepareConfigPatchRequest: owner.prepareConfigPatchRequest,
            saveConfig: owner.saveConfig, getCurrentRevision: owner.getConfigRevision,
            isExtensionUrl: url => url.startsWith('chrome-extension://application-test/'),
        });
        const sent = pending<void>(), proceed = pending<void>();
        const saving = client.requestConfigPatch({to: 'ja'}, async message => {
            sent.resolve();
            await proceed.promise;
            return handler.handle(JSON.parse(JSON.stringify(message)), {
                sender: {url: 'chrome-extension://application-test/options.html'},
            });
        });
        await sent.promise;
        expect(client.config.to).toBe('ja');
        expect(owner.config.to).toBe('en');
        await owner.requestConfigPatch({on: false});
        proceed.resolve();
        await saving;
        expect(owner.config).toMatchObject({to: 'ja', on: false, count: 7});
        expect(client.config).toMatchObject({to: 'ja', on: false, count: 7});
        expect(client.getConfigRevision()).toBe(owner.getConfigRevision());
        await client.waitForConfigPersistenceQueue();
    });
});
