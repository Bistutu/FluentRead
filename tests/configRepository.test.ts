import 'fake-indexeddb/auto';
import {afterEach, describe, expect, it} from 'vitest';
import {encryptConfigValue} from '@/src/platform/storage/configEncryption';
import {
    EncryptedConfigRepository,
    FluentReadConfigDatabase,
    type ConfigValueEncryptor,
} from '@/src/platform/storage/configRepository';

const databases: FluentReadConfigDatabase[] = [];

function createDatabase() {
    const database = new FluentReadConfigDatabase(`FluentReadConfiguration-test-${crypto.randomUUID()}`);
    databases.push(database);
    return database;
}

function createRepository(options: {
    session?: string;
    now?: () => number;
    encrypt?: ConfigValueEncryptor;
} = {}) {
    const database = createDatabase();
    return new EncryptedConfigRepository({
        database,
        getSessionKeyMaterial: async () => options.session || 'session-material-a',
        now: options.now,
        encrypt: options.encrypt,
    });
}

afterEach(async () => {
    await Promise.all(databases.splice(0).map(async database => {
        database.close();
        await database.delete();
    }));
});

describe('加密配置 IndexedDB repository', () => {
    it('完整配置明文往返，但 IndexedDB 原始记录不包含凭据和角色文本', async () => {
        const repository = createRepository({now: () => 1234});
        const config = {
            on: true,
            token: {openai: 'sk-idb-sensitive-sentinel'},
            user_role: {openai: 'user-role-sensitive-sentinel'},
            system_role: {openai: 'system-role-sensitive-sentinel'},
            proxy: {openai: 'https://proxy.example.test'},
        };

        expect(await repository.has('local:config')).toBe(false);
        await repository.set('local:config', config);

        await expect(repository.get('local:config')).resolves.toEqual(config);
        expect(await repository.has('local:config')).toBe(true);
        const raw = await repository.database.records.get('local:config');
        expect(raw).toMatchObject({key: 'local:config', updatedAt: 1234});
        expect(JSON.stringify(raw)).not.toContain('sk-idb-sensitive-sentinel');
        expect(JSON.stringify(raw)).not.toContain('user-role-sensitive-sentinel');
        expect(JSON.stringify(raw)).not.toContain('system-role-sensitive-sentinel');

        await repository.remove('local:config');
        await expect(repository.get('local:config')).resolves.toBeNull();
    });

    it('AAD 绑定数据库与记录键，交换两条合法密文也无法读取', async () => {
        const repository = createRepository();
        await repository.set('local:config', {marker: 'config'});
        await repository.set('local:credentials', {marker: 'credentials'});
        const configRecord = await repository.database.records.get('local:config');
        expect(configRecord).toBeDefined();

        await repository.database.records.put({
            ...configRecord!,
            key: 'local:credentials',
        });

        await expect(repository.get('local:credentials')).rejects.toThrow('配置密文校验失败');
    });

    it('会话随机材料相同时跨 worker 可读，变化后自动失效且不影响持久记录', async () => {
        const first = createRepository({session: 'browser-session-a'});
        await first.set('session:credentials', {token: 'session-only-secret'});
        await first.set('local:credentials', {token: 'persistent-secret'});
        const database = first.database;

        const sameSession = new EncryptedConfigRepository({
            database,
            getSessionKeyMaterial: async () => 'browser-session-a',
        });
        await expect(sameSession.get('session:credentials')).resolves.toEqual({token: 'session-only-secret'});

        const nextSession = new EncryptedConfigRepository({
            database,
            getSessionKeyMaterial: async () => 'browser-session-b',
        });
        await expect(nextSession.get('session:credentials')).resolves.toBeNull();
        await expect(nextSession.get('local:credentials')).resolves.toEqual({token: 'persistent-secret'});
        expect(await database.records.get('session:credentials')).toBeUndefined();
    });

    it('未注入会话材料时拒绝 session 记录，持久记录仍可正常读写', async () => {
        const database = createDatabase();
        const repository = new EncryptedConfigRepository({database});
        await expect(repository.set('session:test', {value: 1})).rejects.toThrow('缺少密钥材料 provider');
        await repository.set('local:test', {value: 1});
        await expect(repository.get('local:test')).resolves.toEqual({value: 1});
    });

    it('会话密钥材料瞬时读取失败时上抛但不删除仍可恢复的密文', async () => {
        const first = createRepository({session: 'browser-session-a'});
        await first.set('session:credentials', {token: 'recoverable-secret'});
        const unavailable = new EncryptedConfigRepository({
            database: first.database,
            getSessionKeyMaterial: async () => { throw new Error('storage.session unavailable'); },
        });
        await expect(unavailable.get('session:credentials')).rejects.toThrow('storage.session unavailable');
        expect(await first.database.records.get('session:credentials')).toBeDefined();
        await expect(first.get('session:credentials')).resolves.toEqual({token: 'recoverable-secret'});
    });

    it('主记录缺失时以完整迁移快照替换受管残留，主记录存在时整批放弃', async () => {
        const repository = createRepository();
        await repository.set('local:configHistory', {snapshot: 'orphaned'});
        await repository.set('local:credentials', {snapshot: 'orphaned-secret'});

        await expect(repository.importMigrationSnapshotIfAuthorityMissing(
            ['local:config', 'meta:migration'],
            new Map([
                ['local:config', {snapshot: 'legacy-a'}],
                ['local:configHistory', {snapshot: 'legacy-a'}],
            ]),
            ['local:config', 'local:configHistory', 'local:credentials'],
        )).resolves.toBe(true);
        await expect(repository.get('local:config')).resolves.toEqual({snapshot: 'legacy-a'});
        await expect(repository.get('local:configHistory')).resolves.toEqual({snapshot: 'legacy-a'});
        await expect(repository.get('local:credentials')).resolves.toBeNull();

        await expect(repository.importMigrationSnapshotIfAuthorityMissing(
            ['local:config', 'meta:migration'],
            new Map([
                ['local:config', {snapshot: 'legacy-b'}],
                ['local:credentials', {snapshot: 'legacy-b'}],
            ]),
            ['local:config', 'local:configHistory', 'local:credentials'],
        )).resolves.toBe(false);
        await expect(repository.get('local:config')).resolves.toEqual({snapshot: 'legacy-a'});
        await expect(repository.get('local:configHistory')).resolves.toEqual({snapshot: 'legacy-a'});
        await expect(repository.get('local:credentials')).resolves.toBeNull();
    });

    it('两个迁移实例并发提交时只允许一个完整快照胜出', async () => {
        const database = createDatabase();
        const first = new EncryptedConfigRepository({database});
        const second = new EncryptedConfigRepository({database});
        const managedKeys = ['local:config', 'local:configHistory', 'local:credentials'];
        const snapshot = (id: string) => new Map<string, unknown>([
            ['local:config', {id}],
            ['local:configHistory', {id}],
            ['local:credentials', {id}],
        ]);

        const results = await Promise.all([
            first.importMigrationSnapshotIfAuthorityMissing(['local:config'], snapshot('first'), managedKeys),
            second.importMigrationSnapshotIfAuthorityMissing(['local:config'], snapshot('second'), managedKeys),
        ]);

        expect(results.sort()).toEqual([false, true]);
        const config = await first.get<{id: string}>('local:config');
        const history = await first.get<{id: string}>('local:configHistory');
        const credentials = await first.get<{id: string}>('local:credentials');
        expect(config?.id).toMatch(/^(first|second)$/);
        expect(history?.id).toBe(config?.id);
        expect(credentials?.id).toBe(config?.id);
    });

    it('两个无主配置快照并发迁移时由 marker 阻止第二批覆盖', async () => {
        const database = createDatabase();
        const first = new EncryptedConfigRepository({database});
        const second = new EncryptedConfigRepository({database});
        const authorityKeys = ['local:config', 'meta:migration'];
        const managedKeys = ['local:configHistory', 'local:credentials', 'meta:migration'];
        const snapshot = (id: string) => new Map<string, unknown>([
            ['local:configHistory', {id}],
            ['local:credentials', {id}],
            ['meta:migration', {id}],
        ]);

        const results = await Promise.all([
            first.importMigrationSnapshotIfAuthorityMissing(authorityKeys, snapshot('first'), managedKeys),
            second.importMigrationSnapshotIfAuthorityMissing(authorityKeys, snapshot('second'), managedKeys),
        ]);

        expect(results.sort()).toEqual([false, true]);
        const history = await first.get<{id: string}>('local:configHistory');
        const credentials = await first.get<{id: string}>('local:credentials');
        const marker = await first.get<{id: string}>('meta:migration');
        expect(history?.id).toMatch(/^(first|second)$/);
        expect(credentials?.id).toBe(history?.id);
        expect(marker?.id).toBe(history?.id);
    });

    it('把配置、凭据写入和旧凭据删除作为一个事务提交', async () => {
        const repository = createRepository();
        await repository.set('local:config', {revision: 1});
        await repository.set('local:credentials', {token: 'old-persistent-secret'});

        await repository.commitChanges(new Map([
            ['local:config', {revision: 2}],
            ['session:credentials', {token: 'new-session-secret'}],
        ]), ['local:credentials', 'local:credentials', 'local:config']);

        await expect(repository.get('local:config')).resolves.toEqual({revision: 2});
        await expect(repository.get('session:credentials')).resolves.toEqual({token: 'new-session-secret'});
        await expect(repository.get('local:credentials')).resolves.toBeNull();
        await repository.commitChanges(new Map(), []);
        expect(await repository.database.records.count()).toBe(2);
    });

    it('批量提交任一加密失败时保留全部旧记录', async () => {
        let fail = false;
        const repository = createRepository({
            encrypt: async (value, keyMaterial, additionalData) => {
                if (fail && (value as {revision?: number}).revision === 2) throw new Error('commit encryption failed');
                return encryptConfigValue(value, undefined, keyMaterial, additionalData);
            },
        });
        await repository.set('local:config', {revision: 1});
        await repository.set('local:credentials', {token: 'existing-secret'});
        fail = true;

        await expect(repository.commitChanges(new Map([
            ['local:config', {revision: 2}],
            ['session:credentials', {token: 'new-secret'}],
        ]), ['local:credentials'])).rejects.toThrow('commit encryption failed');
        await expect(repository.get('local:config')).resolves.toEqual({revision: 1});
        await expect(repository.get('local:credentials')).resolves.toEqual({token: 'existing-secret'});
        await expect(repository.get('session:credentials')).resolves.toBeNull();
    });

    it('批量迁移任一加密失败时不留下半套记录', async () => {
        const repository = createRepository({
            encrypt: async (value, keyMaterial, additionalData) => {
                if ((value as {fail?: boolean}).fail) throw new Error('encrypt failed');
                return encryptConfigValue(value, undefined, keyMaterial, additionalData);
            },
        });

        await expect(repository.importMigrationSnapshotIfAuthorityMissing(['local:config'], new Map([
            ['local:config', {on: true}],
            ['local:configHistory', {fail: true}],
        ]), ['local:config', 'local:configHistory'])).rejects.toThrow('encrypt failed');
        expect(await repository.database.records.count()).toBe(0);
    });

    it('持久记录密文损坏时 fail closed，不删除或回退为默认值', async () => {
        const repository = createRepository();
        await repository.set('local:config', {on: true});
        const record = await repository.database.records.get('local:config');
        await repository.database.records.put({
            ...record!,
            payload: {...record!.payload, version: 99 as 1},
        });

        await expect(repository.get('local:config')).rejects.toThrow('配置密文格式无效');
        expect(await repository.has('local:config')).toBe(true);
    });
});
