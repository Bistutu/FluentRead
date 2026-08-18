import { storage } from '@wxt-dev/storage';
import {
    configReady,
    getConfigSnapshot,
    parseStoredConfig,
    saveConfig,
} from '@/entrypoints/utils/config';
import {
    normalizeConfig,
    type Config,
} from '@/entrypoints/utils/model';
import {
    GOOGLE_DRIVE_CONFIG_FILENAME,
    GOOGLE_DRIVE_LAST_SYNC_STORAGE_KEY,
    GOOGLE_DRIVE_SYNC_SCHEMA_VERSION,
} from './constants';
import { downloadFile, findFileInAppData, uploadFile } from './api';
import { getGoogleUserInfo, getValidAccessToken } from './auth';

export interface ConfigSyncMeta {
    schemaVersion: typeof GOOGLE_DRIVE_SYNC_SCHEMA_VERSION;
    lastModifiedAt: number;
}

export interface ConfigValueAndMeta {
    value: Config;
    meta: ConfigSyncMeta;
}

export interface LastSyncedConfigMeta extends ConfigSyncMeta {
    lastSyncedAt: number;
    email: string;
}

export interface LastSyncedConfigValueAndMeta {
    value: Config;
    meta: LastSyncedConfigMeta;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseTimestamp(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseConfigValue(value: unknown): Config | null {
    const parsed = parseStoredConfig(value);
    return parsed ? normalizeConfig(parsed) : null;
}

export function parseRemoteConfig(content: string): ConfigValueAndMeta {
    let raw: unknown;
    try {
        raw = JSON.parse(content);
    } catch {
        throw new Error('Google Drive 配置不是有效的 JSON');
    }

    if (!isRecord(raw) || !isRecord(raw.meta)) {
        throw new Error('Google Drive 配置缺少同步元数据');
    }

    const schemaVersion = raw.meta.schemaVersion;
    if (schemaVersion !== GOOGLE_DRIVE_SYNC_SCHEMA_VERSION) {
        if (typeof schemaVersion === 'number' && schemaVersion > GOOGLE_DRIVE_SYNC_SCHEMA_VERSION) {
            throw new Error(`Google Drive 配置版本过新（${schemaVersion}），当前扩展仅支持版本 ${GOOGLE_DRIVE_SYNC_SCHEMA_VERSION}`);
        }
        throw new Error('Google Drive 配置版本不受支持');
    }

    const config = parseConfigValue(raw.value);
    const lastModifiedAt = parseTimestamp(raw.meta.lastModifiedAt);
    if (!config || lastModifiedAt === null) {
        throw new Error('Google Drive 配置内容无效');
    }

    return {
        value: config,
        meta: {schemaVersion: GOOGLE_DRIVE_SYNC_SCHEMA_VERSION, lastModifiedAt},
    };
}

export async function getLocalConfigAndMeta(): Promise<ConfigValueAndMeta> {
    await configReady;
    return {
        value: getConfigSnapshot(),
        meta: {
            schemaVersion: GOOGLE_DRIVE_SYNC_SCHEMA_VERSION,
            lastModifiedAt: Date.now(),
        },
    };
}

export async function setLocalConfigAndMeta(config: Config): Promise<void> {
    await saveConfig(normalizeConfig(config), {
        recordHistory: true,
        immediateHistory: true,
    });
}

export async function getLastSyncedConfigAndMeta(): Promise<LastSyncedConfigValueAndMeta | null> {
    const raw = await storage.getItem<unknown>(GOOGLE_DRIVE_LAST_SYNC_STORAGE_KEY);
    if (!isRecord(raw) || !isRecord(raw.meta)) return null;

    const value = parseConfigValue(raw.value);
    const schemaVersion = raw.meta.schemaVersion;
    const lastModifiedAt = parseTimestamp(raw.meta.lastModifiedAt);
    const lastSyncedAt = parseTimestamp(raw.meta.lastSyncedAt);
    const email = raw.meta.email;
    if (!value
        || schemaVersion !== GOOGLE_DRIVE_SYNC_SCHEMA_VERSION
        || lastModifiedAt === null
        || lastSyncedAt === null
        || typeof email !== 'string'
        || !email) {
        return null;
    }

    return {
        value,
        meta: {
            schemaVersion: GOOGLE_DRIVE_SYNC_SCHEMA_VERSION,
            lastModifiedAt,
            lastSyncedAt,
            email,
        },
    };
}

export async function setLastSyncedConfigAndMeta(
    config: Config,
    meta: Omit<LastSyncedConfigMeta, 'schemaVersion'> & {schemaVersion?: typeof GOOGLE_DRIVE_SYNC_SCHEMA_VERSION},
): Promise<void> {
    await storage.setItem<LastSyncedConfigValueAndMeta>(GOOGLE_DRIVE_LAST_SYNC_STORAGE_KEY, {
        value: normalizeConfig(config),
        meta: {
            schemaVersion: GOOGLE_DRIVE_SYNC_SCHEMA_VERSION,
            lastModifiedAt: meta.lastModifiedAt,
            lastSyncedAt: meta.lastSyncedAt,
            email: meta.email,
        },
    });
}

export async function getRemoteConfigAndMetaWithUserEmail(): Promise<{
    configValueAndMeta: ConfigValueAndMeta | null;
    email: string;
}> {
    const accessToken = await getValidAccessToken();
    const userInfo = await getGoogleUserInfo(accessToken);
    const file = await findFileInAppData(GOOGLE_DRIVE_CONFIG_FILENAME);
    if (!file) return {configValueAndMeta: null, email: userInfo.email};

    const content = await downloadFile(file.id);
    return {
        configValueAndMeta: parseRemoteConfig(content),
        email: userInfo.email,
    };
}

export async function setRemoteConfigAndMeta(configValueAndMeta: ConfigValueAndMeta): Promise<void> {
    const existingFile = await findFileInAppData(GOOGLE_DRIVE_CONFIG_FILENAME);
    const content = JSON.stringify({
        value: normalizeConfig(configValueAndMeta.value),
        meta: {
            schemaVersion: GOOGLE_DRIVE_SYNC_SCHEMA_VERSION,
            lastModifiedAt: configValueAndMeta.meta.lastModifiedAt,
        },
    }, null, 2);
    await uploadFile(GOOGLE_DRIVE_CONFIG_FILENAME, content, existingFile?.id);
}
