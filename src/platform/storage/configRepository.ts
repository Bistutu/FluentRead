/**
 * @file src/platform/storage/configRepository.ts
 *
 * 文件职责：在扩展后台的专属 IndexedDB 中持久化加密配置记录，并保留旧版会话凭据的安全读取与迁移能力。
 * 主要内容：定义 FluentReadConfiguration Dexie 数据库、加密记录表、单键读写删除与密文条件提交、配置与凭据的多键原子提交、主记录缺失条件下的完整旧快照导入，以及只清理原密文的会话失效处理。
 * 模块边界：本文件只拥有扩展 IndexedDB 与加密记录不变量，不读取旧 browser.storage、不发送 runtime 消息、不归一化 Config；旧数据迁移和跨上下文代理由 configStorage 负责编排。
 */

import Dexie, {type Table} from 'dexie';
import {
    FLUENTREAD_CONFIG_ENCRYPTION_KEY,
    decryptConfigValue,
    encryptConfigValue,
    type EncryptedConfigPayload,
} from './configEncryption';

export const CONFIG_DATABASE_NAME = 'FluentReadConfiguration' as const;
export const CONFIG_DATABASE_VERSION = 1 as const;

export interface EncryptedConfigRecord {
    key: string;
    payload: EncryptedConfigPayload;
    updatedAt: number;
}

export type ConfigValueEncryptor = (
    value: unknown,
    keyMaterial?: string,
    additionalData?: string,
) => Promise<EncryptedConfigPayload>;
export type ConfigValueDecryptor = (
    value: unknown,
    keyMaterial?: string,
    additionalData?: string,
) => Promise<unknown>;

export interface EncryptedConfigRepositoryOptions {
    database?: FluentReadConfigDatabase;
    encrypt?: ConfigValueEncryptor;
    decrypt?: ConfigValueDecryptor;
    getSessionKeyMaterial?: () => Promise<string>;
    now?: () => number;
}

export class FluentReadConfigDatabase extends Dexie {
    records!: Table<EncryptedConfigRecord, string>;

    constructor(name: string = CONFIG_DATABASE_NAME) {
        super(name);
        this.version(CONFIG_DATABASE_VERSION).stores({
            records: '&key, updatedAt',
        });
    }
}

function isSessionKey(key: string): boolean {
    return key.startsWith('session:');
}

export class EncryptedConfigRepository {
    readonly database: FluentReadConfigDatabase;
    private readonly encrypt: ConfigValueEncryptor;
    private readonly decrypt: ConfigValueDecryptor;
    private readonly getSessionKeyMaterial: () => Promise<string>;
    private readonly now: () => number;

    constructor(options: EncryptedConfigRepositoryOptions = {}) {
        this.database = options.database || new FluentReadConfigDatabase();
        this.encrypt = options.encrypt || ((value, keyMaterial, additionalData) => (
            encryptConfigValue(value, undefined, keyMaterial, additionalData)
        ));
        this.decrypt = options.decrypt || ((value, keyMaterial, additionalData) => (
            decryptConfigValue(value, undefined, keyMaterial, additionalData)
        ));
        this.getSessionKeyMaterial = options.getSessionKeyMaterial || (async () => {
            throw new Error('会话配置记录缺少密钥材料 provider');
        });
        this.now = options.now || Date.now;
    }

    private async keyMaterial(key: string): Promise<string | undefined> {
        if (!isSessionKey(key)) return undefined;
        return `${FLUENTREAD_CONFIG_ENCRYPTION_KEY}\0${await this.getSessionKeyMaterial()}`;
    }

    private additionalData(key: string): string {
        return `${this.database.name}\0${key}`;
    }

    async has(key: string): Promise<boolean> {
        return (await this.database.records.get(key)) !== undefined;
    }

    async get<T>(key: string): Promise<T | null> {
        const record = await this.database.records.get(key);
        if (!record) return null;
        // storage.session 的瞬时读取故障不等于浏览器会话已经结束。密钥材料获取
        // 失败必须保留密文并上抛；只有成功取得材料后认证失败，才说明记录已失效。
        const keyMaterial = await this.keyMaterial(key);
        try {
            return await this.decrypt(
                record.payload,
                keyMaterial,
                this.additionalData(key),
            ) as T;
        } catch (error) {
            // session 随机材料在浏览器会话结束后消失；旧 session 密文应安全失效，
            // 而持久配置的认证或格式错误必须上抛，防止被默认值静默覆盖。
            if (!isSessionKey(key)) throw error;
            // 加解密在事务外等待；期间另一调用可能已提交当前会话的新凭据。
            // 清理必须在写事务中核对原密文，不能删除同键的后续替换记录。
            await this.database.transaction('rw', this.database.records, async () => {
                const current = await this.database.records.get(key);
                if (JSON.stringify(current) === JSON.stringify(record)) {
                    await this.database.records.delete(key);
                }
            });
            return null;
        }
    }

    async set<T>(key: string, value: T): Promise<void> {
        const payload = await this.encrypt(
            value,
            await this.keyMaterial(key),
            this.additionalData(key),
        );
        await this.database.records.put({key, payload, updatedAt: this.now()});
    }

    /** 仅在调用者读取的明文仍为当前值时提交，事务内再核对整条原密文记录。 */
    async setIfUnchanged<T>(key: string, expectedValue: unknown, value: T): Promise<boolean> {
        const record = await this.database.records.get(key);
        const keyMaterial = await this.keyMaterial(key);
        const actual = record
            ? await this.decrypt(record.payload, keyMaterial, this.additionalData(key))
            : null;
        if (JSON.stringify(actual) !== JSON.stringify(expectedValue)) return false;
        const payload = await this.encrypt(value, keyMaterial, this.additionalData(key));
        return this.database.transaction('rw', this.database.records, async () => {
            const current = await this.database.records.get(key);
            if (JSON.stringify(current) !== JSON.stringify(record)) return false;
            await this.database.records.put({key, payload, updatedAt: this.now()});
            return true;
        });
    }

    /**
     * 配置、凭据与清理操作先在事务外完成全部加密，再作为一个 IndexedDB 提交。
     * 浏览器在任意单条写入之间终止后台时，不会留下跨记录的新旧配置组合。
     */
    async commitChanges(
        entries: ReadonlyMap<string, unknown>,
        removeKeys: readonly string[] = [],
    ): Promise<void> {
        const encryptedEntries = await Promise.all([...entries].map(async ([key, value]) => ({
            key,
            payload: await this.encrypt(
                value,
                await this.keyMaterial(key),
                this.additionalData(key),
            ),
            updatedAt: this.now(),
        })));
        const removals = [...new Set(removeKeys)].filter(key => !entries.has(key));
        await this.database.transaction('rw', this.database.records, async () => {
            if (encryptedEntries.length) await this.database.records.bulkPut(encryptedEntries);
            if (removals.length) await this.database.records.bulkDelete(removals);
        });
    }

    async remove(key: string): Promise<void> {
        await this.database.records.delete(key);
    }

    /**
     * 在同一个写事务内再次检查主记录或迁移标记，只允许一个完整迁移快照胜出。
     * 即使旧快照没有主配置，两个后台实例也不能逐键拼接或覆盖彼此的数据。
     */
    async importMigrationSnapshotIfAuthorityMissing(
        authorityKeys: readonly string[],
        entries: ReadonlyMap<string, unknown>,
        managedKeys: readonly string[],
    ): Promise<boolean> {
        const encryptedEntries = await Promise.all([...entries].map(async ([key, value]) => ({
            key,
            payload: await this.encrypt(
                value,
                await this.keyMaterial(key),
                this.additionalData(key),
            ),
            updatedAt: this.now(),
        })));
        const removals = [...new Set(managedKeys)].filter(key => !entries.has(key));
        return this.database.transaction('rw', this.database.records, async () => {
            const existingAuthority = await this.database.records.bulkGet([...new Set(authorityKeys)]);
            if (existingAuthority.some(record => record !== undefined)) return false;
            await this.database.records.bulkDelete(removals);
            await this.database.records.bulkPut(encryptedEntries);
            return true;
        });
    }
}
