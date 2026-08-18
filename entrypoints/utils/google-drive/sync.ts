import { configReady, saveConfig } from '@/entrypoints/utils/config';
import { normalizeConfig } from '@/entrypoints/utils/model';
import {
    configValuesEqual,
} from './conflict-merge';
import {
    GOOGLE_DRIVE_SYNC_SCHEMA_VERSION,
} from './constants';
import {
    getLocalConfigAndMeta,
    getLastSyncedConfigAndMeta,
    getRemoteConfigAndMetaWithUserEmail,
    setLastSyncedConfigAndMeta,
    setLocalConfigAndMeta,
    setRemoteConfigAndMeta,
    type ConfigValueAndMeta,
} from './storage';

export type SyncAction = 'uploaded' | 'downloaded' | 'same-changes' | 'no-change';

export interface UnresolvedConfigs {
    base: ReturnType<typeof normalizeConfig>;
    local: ReturnType<typeof normalizeConfig>;
    remote: ReturnType<typeof normalizeConfig>;
}

export type SyncResult =
    | {status: 'success'; action: SyncAction; email: string; syncedAt: number}
    | {status: 'unresolved'; data: UnresolvedConfigs; email: string}
    | {status: 'error'; error: Error};

function createConfigValueAndMeta(value: ReturnType<typeof normalizeConfig>, lastModifiedAt = Date.now()): ConfigValueAndMeta {
    return {
        value: normalizeConfig(value),
        meta: {
            schemaVersion: GOOGLE_DRIVE_SYNC_SCHEMA_VERSION,
            lastModifiedAt,
        },
    };
}

async function markSynced(
    value: ReturnType<typeof normalizeConfig>,
    email: string,
    lastModifiedAt: number,
    syncedAt: number,
): Promise<void> {
    await setLastSyncedConfigAndMeta(value, {
        schemaVersion: GOOGLE_DRIVE_SYNC_SCHEMA_VERSION,
        lastModifiedAt,
        lastSyncedAt: syncedAt,
        email,
    });
}

export async function syncMergedConfig(mergedConfig: ReturnType<typeof normalizeConfig>, email: string): Promise<void> {
    await configReady;
    const now = Date.now();
    const local = createConfigValueAndMeta(mergedConfig, now);
    await saveConfig(local.value, {recordHistory: true, immediateHistory: true});
    await setRemoteConfigAndMeta(local);
    await markSynced(local.value, email, now, now);
}

export async function syncConfig(): Promise<SyncResult> {
    try {
        await configReady;
        // Flush a change made immediately before clicking the sync button.
        await saveConfig();

        const local = await getLocalConfigAndMeta();
        const lastSynced = await getLastSyncedConfigAndMeta();
        const remoteResult = await getRemoteConfigAndMetaWithUserEmail();
        const remote = remoteResult.configValueAndMeta;
        const email = remoteResult.email;
        const now = Date.now();

        // A different Google account gets its own remote configuration as the
        // source of truth, just like a first sync on a new browser profile.
        if (!lastSynced || lastSynced.meta.email !== email) {
            if (remote) {
                await setLocalConfigAndMeta(remote.value);
                await markSynced(remote.value, email, remote.meta.lastModifiedAt, now);
                return {status: 'success', action: 'downloaded', email, syncedAt: now};
            }

            const localToUpload = createConfigValueAndMeta(local.value, now);
            await setRemoteConfigAndMeta(localToUpload);
            await markSynced(local.value, email, now, now);
            return {status: 'success', action: 'uploaded', email, syncedAt: now};
        }

        const localChanged = !configValuesEqual(local.value, lastSynced.value);
        const remoteChanged = Boolean(remote && !configValuesEqual(remote.value, lastSynced.value));

        if (localChanged && remoteChanged && remote) {
            if (configValuesEqual(local.value, remote.value)) {
                const sameConfig = createConfigValueAndMeta(local.value, now);
                await setRemoteConfigAndMeta(sameConfig);
                await markSynced(local.value, email, now, now);
                return {status: 'success', action: 'same-changes', email, syncedAt: now};
            }

            return {
                status: 'unresolved',
                data: {
                    base: lastSynced.value,
                    local: local.value,
                    remote: remote.value,
                },
                email,
            };
        }

        if (localChanged) {
            const localToUpload = createConfigValueAndMeta(local.value, now);
            await setRemoteConfigAndMeta(localToUpload);
            await markSynced(local.value, email, now, now);
            return {status: 'success', action: 'uploaded', email, syncedAt: now};
        }

        if (remoteChanged && remote) {
            await setLocalConfigAndMeta(remote.value);
            await markSynced(remote.value, email, remote.meta.lastModifiedAt, now);
            return {status: 'success', action: 'downloaded', email, syncedAt: now};
        }

        await markSynced(local.value, email, lastSynced.meta.lastModifiedAt, now);
        return {status: 'success', action: 'no-change', email, syncedAt: now};
    } catch (error) {
        return {
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
        };
    }
}
