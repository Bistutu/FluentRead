<template>
  <section class="google-drive-sync" aria-labelledby="google-drive-sync-title">
    <div class="google-drive-heading">
      <div>
        <span class="google-drive-kicker">云端同步</span>
        <h3 id="google-drive-sync-title">Google Drive 云端同步</h3>
        <p>把 FluentRead 配置保存到 Google Drive 的私有应用数据区，方便在不同浏览器配置之间迁移。</p>
      </div>
      <span class="google-drive-status" :class="{ connected: authUser }">
        {{ authLoading ? '检查账号中…' : authUser ? '已连接' : '未连接' }}
      </span>
    </div>

    <div v-if="authUser" class="google-drive-account">
      <span class="google-drive-avatar" aria-hidden="true">{{ authUser.email.slice(0, 1).toUpperCase() }}</span>
      <span class="google-drive-email">{{ authUser.email }}</span>
      <button type="button" class="google-drive-link" @click="handleLogout">退出账号</button>
    </div>

    <div class="google-drive-actions">
      <button type="button" class="google-drive-primary" :disabled="syncing" @click="handleSync">
        <span v-if="syncing" class="google-drive-spinner" aria-hidden="true" />
        {{ syncing ? '同步中…' : authUser ? '同步到 Google Drive' : '连接并同步 Google Drive' }}
      </button>
      <span v-if="lastSyncTime" class="google-drive-last-sync">最后同步：{{ formatTime(lastSyncTime) }}</span>
    </div>

    <p v-if="errorMessage" class="google-drive-error" role="alert">{{ errorMessage }}</p>
    <p class="google-drive-note">配置中可能包含翻译服务令牌和自定义提示词；同步文件仅写入当前 Google 账号的 appDataFolder，不会出现在普通 Drive 文件列表中。</p>
  </section>

  <el-dialog
    v-model="conflictDialogVisible"
    title="配置同步冲突"
    width="min(900px, calc(100vw - 32px))"
    :close-on-click-modal="false"
    @closed="resetConflictState"
  >
    <p class="conflict-description">本地和 Google Drive 都基于上次同步配置发生了修改。请为每个冲突字段选择保留本地值或云端值。</p>

    <div v-if="conflictResult" class="conflict-toolbar">
      <span>已选择 {{ resolvedConflictCount }} / {{ conflictResult.conflicts.length }} 项</span>
      <div class="conflict-toolbar-actions">
        <button type="button" class="conflict-bulk-button" @click="selectAll('local')">全部使用本地</button>
        <button type="button" class="conflict-bulk-button" @click="selectAll('remote')">全部使用云端</button>
      </div>
    </div>

    <div v-if="conflictResult" class="conflict-list">
      <article v-for="conflict in conflictResult.conflicts" :key="pathKey(conflict.path)" class="conflict-item">
        <div class="conflict-path">{{ formatPath(conflict.path) }}</div>
        <div class="conflict-values">
          <button
            type="button"
            class="conflict-value"
            :class="{ selected: resolutions[pathKey(conflict.path)] === 'local' }"
            @click="selectResolution(conflict.path, 'local')"
          >
            <span class="conflict-value-heading"><b class="local-dot" />本地值</span>
            <code>{{ formatValue(conflict.localValue) }}</code>
          </button>
          <button
            type="button"
            class="conflict-value"
            :class="{ selected: resolutions[pathKey(conflict.path)] === 'remote' }"
            @click="selectResolution(conflict.path, 'remote')"
          >
            <span class="conflict-value-heading"><b class="remote-dot" />云端值</span>
            <code>{{ formatValue(conflict.remoteValue) }}</code>
          </button>
        </div>
      </article>
    </div>

    <p v-if="resolvedResult?.validationError" class="google-drive-error" role="alert">{{ resolvedResult.validationError }}</p>

    <template #footer>
      <button type="button" class="conflict-cancel-button" :disabled="syncing" @click="conflictDialogVisible = false">取消</button>
      <button type="button" class="google-drive-primary" :disabled="!canConfirmConflict" @click="handleConfirmConflict">
        {{ syncing ? '同步中…' : '确认合并并同步' }}
      </button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { GoogleUserInfo } from '@/entrypoints/utils/google-drive/auth';
import {
    clearAccessToken,
    getAuthenticatedGoogleUser,
} from '@/entrypoints/utils/google-drive/auth';
import {
    applyResolutions,
    detectConflicts,
    type ConflictResolution,
    type DiffConflictsResult,
} from '@/entrypoints/utils/google-drive/conflict-merge';
import { getLastSyncedConfigAndMeta } from '@/entrypoints/utils/google-drive/storage';
import { syncConfig, syncMergedConfig } from '@/entrypoints/utils/google-drive/sync';

const authUser = ref<GoogleUserInfo | null>(null);
const authLoading = ref(true);
const syncing = ref(false);
const errorMessage = ref('');
const lastSyncTime = ref<number | null>(null);
const conflictDialogVisible = ref(false);
const conflictResult = ref<DiffConflictsResult | null>(null);
const resolutions = ref<Record<string, ConflictResolution>>({});
const conflictEmail = ref('');

const resolvedResult = computed(() => conflictResult.value
    ? applyResolutions(conflictResult.value, resolutions.value)
    : null);
const resolvedConflictCount = computed(() => Object.keys(resolutions.value).length);
const allConflictsResolved = computed(() => Boolean(
    conflictResult.value?.conflicts.every((conflict) => Boolean(resolutions.value[pathKey(conflict.path)])),
));
const canConfirmConflict = computed(() => Boolean(
    !syncing.value
    && allConflictsResolved.value
    && resolvedResult.value
    && !resolvedResult.value.validationError,
));

function pathKey(path: string[]): string {
    return path.join('.');
}

function formatPath(path: string[]): string {
    return path.length ? path.join(' › ') : '根配置';
}

function formatValue(value: unknown): string {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized !== undefined) return serialized.length > 1_200 ? `${serialized.slice(0, 1_200)}…` : serialized;
    return String(value);
}

function formatTime(timestamp: number): string {
    return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(timestamp);
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Google Drive 同步失败，请稍后重试';
}

async function refreshAuth(showError = false): Promise<void> {
    authLoading.value = true;
    try {
        authUser.value = await getAuthenticatedGoogleUser();
    } catch (error) {
        authUser.value = null;
        if (showError) errorMessage.value = toErrorMessage(error);
    } finally {
        authLoading.value = false;
    }
}

async function refreshLastSync(): Promise<void> {
    const lastSynced = await getLastSyncedConfigAndMeta();
    lastSyncTime.value = lastSynced?.meta.lastSyncedAt ?? null;
}

function showSuccess(message: string): void {
    ElMessage({message, type: 'success', duration: 2_000});
}

function getSyncSuccessMessage(action: 'uploaded' | 'downloaded' | 'same-changes' | 'no-change'): string {
    return {
        uploaded: '本地配置已同步到 Google Drive',
        downloaded: 'Google Drive 配置已应用到本地',
        'same-changes': '本地和云端修改一致，已完成同步',
        'no-change': '本地和云端配置没有变化',
    }[action];
}

async function handleSync(): Promise<void> {
    if (syncing.value) return;
    syncing.value = true;
    errorMessage.value = '';
    try {
        const result = await syncConfig();
        if (result.status === 'error') {
            errorMessage.value = result.error.message;
            return;
        }

        conflictEmail.value = result.email;
        if (result.status === 'unresolved') {
            conflictResult.value = detectConflicts(result.data.base, result.data.local, result.data.remote);
            resolutions.value = {};
            conflictDialogVisible.value = true;
            return;
        }

        lastSyncTime.value = result.syncedAt;
        showSuccess(getSyncSuccessMessage(result.action));
    } catch (error) {
        errorMessage.value = toErrorMessage(error);
    } finally {
        syncing.value = false;
        await refreshAuth(false);
    }
}

async function handleConfirmConflict(): Promise<void> {
    if (!canConfirmConflict.value || !resolvedResult.value) return;
    const email = conflictEmail.value || authUser.value?.email;
    if (!email) {
        errorMessage.value = '无法确认 Google 账号，请重新连接后重试';
        conflictDialogVisible.value = false;
        return;
    }

    syncing.value = true;
    errorMessage.value = '';
    try {
        await syncMergedConfig(resolvedResult.value.config, email);
        lastSyncTime.value = Date.now();
        conflictDialogVisible.value = false;
        showSuccess('冲突已解决，合并配置已同步到本地和 Google Drive');
    } catch (error) {
        errorMessage.value = toErrorMessage(error);
    } finally {
        syncing.value = false;
        await refreshAuth(false);
    }
}

function selectResolution(path: string[], resolution: ConflictResolution): void {
    resolutions.value = {...resolutions.value, [pathKey(path)]: resolution};
}

function selectAll(resolution: ConflictResolution): void {
    if (!conflictResult.value) return;
    const next: Record<string, ConflictResolution> = {};
    for (const conflict of conflictResult.value.conflicts) next[pathKey(conflict.path)] = resolution;
    resolutions.value = next;
}

function resetConflictState(): void {
    conflictResult.value = null;
    resolutions.value = {};
    conflictEmail.value = '';
}

async function handleLogout(): Promise<void> {
    try {
        await clearAccessToken();
        authUser.value = null;
        errorMessage.value = '';
        showSuccess('已退出 Google Drive 账号');
    } catch (error) {
        errorMessage.value = toErrorMessage(error);
    }
}

onMounted(() => {
    void refreshAuth();
    void refreshLastSync().catch(() => undefined);
});
</script>

<style scoped>
.google-drive-sync {
  display: grid;
  gap: 14px;
  margin: 0 12px 20px;
  padding: 18px 20px;
  border: 1px solid #d8e8f5;
  border-radius: 18px;
  background: linear-gradient(135deg, #f7fbff, #fff);
}
.google-drive-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.google-drive-kicker { display: block; margin-bottom: 5px; color: #2678c9; font-size: 10px; font-weight: 800; letter-spacing: .1em; }
.google-drive-heading h3 { margin: 0 0 6px; color: #172033; font-size: 17px; }
.google-drive-heading p, .google-drive-note { margin: 0; color: #69768a; font-size: 11px; line-height: 1.6; }
.google-drive-status { flex: none; padding: 5px 9px; border-radius: 999px; color: #778397; background: #eef2f7; font-size: 10px; font-weight: 750; }
.google-drive-status.connected { color: #18835d; background: #eaf8f1; }
.google-drive-account { display: flex; align-items: center; gap: 8px; min-width: 0; }
.google-drive-avatar { display: grid; width: 26px; height: 26px; flex: none; place-items: center; border-radius: 50%; color: #fff; background: #4285f4; font-size: 12px; font-weight: 800; }
.google-drive-email { overflow: hidden; color: #334155; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.google-drive-link { margin-left: auto; padding: 0; border: 0; color: #2678c9; background: transparent; font-size: 11px; cursor: pointer; }
.google-drive-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.google-drive-primary { display: inline-flex; min-height: 34px; align-items: center; justify-content: center; gap: 7px; padding: 0 14px; border: 0; border-radius: 9px; color: #fff; background: #2678c9; font-size: 12px; font-weight: 750; cursor: pointer; }
.google-drive-primary:hover { background: #1d66ad; }
.google-drive-primary:disabled { cursor: default; opacity: .55; }
.google-drive-spinner { width: 12px; height: 12px; border: 2px solid rgba(255, 255, 255, .45); border-top-color: #fff; border-radius: 50%; animation: google-drive-spin .8s linear infinite; }
.google-drive-last-sync { color: #7b8799; font-size: 10px; }
.google-drive-error { margin: 0; padding: 9px 10px; border-radius: 9px; color: #bd3154; background: #fff0f3; font-size: 11px; line-height: 1.5; }
.google-drive-note { color: #8a94a5; font-size: 10px; }

.conflict-description { margin: 0 0 14px; color: #69768a; font-size: 12px; line-height: 1.6; }
.conflict-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; color: #69768a; font-size: 11px; }
.conflict-toolbar-actions { display: flex; gap: 7px; }
.conflict-bulk-button, .conflict-cancel-button { min-height: 30px; padding: 0 10px; border: 1px solid #dfe5ee; border-radius: 8px; color: #536174; background: #fff; font-size: 11px; cursor: pointer; }
.conflict-bulk-button:hover, .conflict-cancel-button:hover { border-color: #a9c8e8; color: #2678c9; }
.conflict-list { display: grid; max-height: 56vh; gap: 10px; overflow: auto; padding-right: 3px; }
.conflict-item { padding: 11px; border: 1px solid #e8ebf1; border-radius: 11px; background: #fbfcfe; }
.conflict-path { margin-bottom: 8px; color: #344054; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; font-weight: 700; word-break: break-all; }
.conflict-values { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.conflict-value { min-width: 0; padding: 9px; border: 1px solid #e3e7ef; border-radius: 9px; color: #536174; background: #fff; text-align: left; cursor: pointer; }
.conflict-value:hover, .conflict-value.selected { border-color: #70a9df; box-shadow: 0 0 0 2px rgba(38, 120, 201, .12); }
.conflict-value.selected { background: #f4f9ff; }
.conflict-value-heading { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-size: 10px; font-weight: 750; }
.local-dot, .remote-dot { width: 7px; height: 7px; border-radius: 50%; }
.local-dot { background: #23a36d; }
.remote-dot { background: #4285f4; }
.conflict-value code { display: block; max-height: 120px; overflow: auto; color: #344054; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }

:global(.dark) .google-drive-sync { border-color: #2c4860; background: linear-gradient(135deg, rgba(38, 120, 201, .13), #252830); }
:global(.dark) .google-drive-heading h3, :global(.dark) .google-drive-email, :global(.dark) .conflict-path, :global(.dark) .conflict-value code { color: #f4f5f8; }
:global(.dark) .google-drive-heading p, :global(.dark) .google-drive-note, :global(.dark) .google-drive-last-sync, :global(.dark) .conflict-description, :global(.dark) .conflict-toolbar { color: #a7adba; }
:global(.dark) .conflict-item, :global(.dark) .conflict-value { border-color: #30333c; background: #252830; }
:global(.dark) .conflict-value.selected { background: rgba(38, 120, 201, .15); }
:global(.dark) .conflict-bulk-button, :global(.dark) .conflict-cancel-button { border-color: #3a414e; color: #c3c9d4; background: #252830; }

@keyframes google-drive-spin { to { transform: rotate(360deg); } }

@media (max-width: 640px) {
  .google-drive-heading, .conflict-toolbar { align-items: flex-start; flex-direction: column; }
  .google-drive-status { align-self: flex-start; }
  .conflict-values { grid-template-columns: 1fr; }
  .conflict-toolbar-actions { width: 100%; }
}
</style>
