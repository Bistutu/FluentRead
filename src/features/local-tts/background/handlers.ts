/**
 * @file src/features/local-tts/background/handlers.ts
 * 文件职责：为设置页提供本地 TTS 模型的状态、下载和清除后台消息 handler。
 * 主要内容：逐字段构造规范模型状态，旧记录缺少下载大小时采用目录默认值，丢弃损坏的可选版本字段；解析状态查询、预下载与移除请求，让下载与清除互斥，以有界重读处理迟到状态并阻止过期写入，统一返回成功或错误结构。
 * 模块边界：不执行语音合成；实际模型缓存和 Worker 初始化由 Offscreen 适配器完成，存储与适配器均由 runtime 注入。
 */

import {isMessageRecord, isFiniteNumber} from '@/src/core/messaging/validation';
import type {LocalTtsPreparation, LocalTtsStatus} from '@/src/core/messaging/offscreen';
import type {BackgroundMessageHandler} from '@/src/services/messaging/backgroundRouter';
import {LOCAL_TTS_MODEL, LOCAL_TTS_MODEL_ID, LOCAL_TTS_MODEL_STATE_KEY} from '@/src/core/config/localTts';

type Context = unknown;
type Store = {
    get(key: string): Promise<Record<string, unknown>>;
    set(value: Record<string, unknown>): Promise<void>;
};

export const LOCAL_TTS_MODEL_STATE_MESSAGE = 'fluentReadGetLocalTtsModelState' as const;
export const LOCAL_TTS_MODEL_PREPARE_MESSAGE = 'fluentReadPrepareLocalTtsModel' as const;
export const LOCAL_TTS_MODEL_REMOVE_MESSAGE = 'fluentReadRemoveLocalTtsModel' as const;

const MAX_STATE_QUERY_ATTEMPTS = 8;

interface LocalTtsModelState {
    model: typeof LOCAL_TTS_MODEL_ID;
    downloaded: boolean;
    downloadSizeMb: number;
    dtype?: string;
    revision?: string;
}

export interface LocalTtsBackgroundDependencies {
    readonly offscreen: {
        prepare(keepWarm?: boolean): Promise<LocalTtsPreparation>;
        status(): Promise<LocalTtsStatus>;
        remove(): Promise<void>;
    };
    readonly storage: Store;
}

function modelState(value: unknown): LocalTtsModelState | null {
    if (!isMessageRecord(value) || value.model !== LOCAL_TTS_MODEL_ID || typeof value.downloaded !== 'boolean') return null;
    return {
        model: LOCAL_TTS_MODEL_ID,
        downloaded: value.downloaded,
        downloadSizeMb: isFiniteNumber(value.downloadSizeMb) && value.downloadSizeMb >= 0 ? value.downloadSizeMb : LOCAL_TTS_MODEL.downloadSizeMb,
        ...(typeof value.dtype === 'string' ? {dtype: value.dtype} : {}),
        ...(typeof value.revision === 'string' ? {revision: value.revision} : {}),
    };
}

export function createLocalTtsBackgroundHandlers(
    dependencies: LocalTtsBackgroundDependencies,
): readonly BackgroundMessageHandler<Context>[] {
    let stateWriteQueue: Promise<void> = Promise.resolve();
    let removing = false;
    let preparing = 0;
    let stateRevision = 0;
    let removalFinished: Promise<void> = Promise.resolve();

    const writeState = (state: LocalTtsModelState, revision: number): Promise<void> => {
        const write = stateWriteQueue.then(async () => {
            if (revision === stateRevision) await dependencies.storage.set({[LOCAL_TTS_MODEL_STATE_KEY]: state});
        });
        stateWriteQueue = write.then(() => undefined, () => undefined);
        return write;
    };

    const state: BackgroundMessageHandler<Context> = {
        type: LOCAL_TTS_MODEL_STATE_MESSAGE,
        async handle() {
            for (let attempt = 0; attempt < MAX_STATE_QUERY_ATTEMPTS; attempt += 1) {
                if (removing) await removalFinished;
                const revision = stateRevision;
                const response = await dependencies.offscreen.status();
                const raw = Array.isArray(response.models) ? response.models[0] : undefined;
                const reported = modelState(raw);
                const stored = await dependencies.storage.get(LOCAL_TTS_MODEL_STATE_KEY);
                const saved = modelState(stored[LOCAL_TTS_MODEL_STATE_KEY]);
                const current = reported || saved || {
                    model: LOCAL_TTS_MODEL_ID,
                    downloaded: false,
                    downloadSizeMb: LOCAL_TTS_MODEL.downloadSizeMb,
                };
                if (revision !== stateRevision) continue;
                await writeState(current, revision);
                if (revision !== stateRevision) continue;
                return {success: true, model: current.model, downloaded: current.downloaded, models: [current]};
            }
            throw new Error('本地 TTS 模型状态变更过于频繁，请稍后重试');
        },
    };

    const prepare: BackgroundMessageHandler<Context> = {
        type: LOCAL_TTS_MODEL_PREPARE_MESSAGE,
        async handle() {
            if (removing) throw new Error('正在清除本地 TTS 模型，请稍后重试');
            preparing += 1;
            const revision = ++stateRevision;
            try {
                const response = await dependencies.offscreen.prepare(false);
                const reported = Array.isArray(response.models) ? response.models[0] : undefined;
                const current = modelState(reported) || {
                    model: LOCAL_TTS_MODEL_ID,
                    downloaded: true,
                    downloadSizeMb: LOCAL_TTS_MODEL.downloadSizeMb,
                    dtype: typeof response.dtype === 'string' ? response.dtype : undefined,
                    revision: typeof response.revision === 'string' ? response.revision : undefined,
                };
                await writeState({...current, downloaded: true}, revision);
                return {...response, success: true, model: LOCAL_TTS_MODEL_ID, downloaded: true, models: [{...current, downloaded: true}]};
            } finally {
                preparing -= 1;
                // 下载结束后，期间开始的查询也必须重新读取，避免其迟到快照覆盖完成状态。
                if (revision === stateRevision) stateRevision += 1;
            }
        },
    };

    const remove: BackgroundMessageHandler<Context> = {
        type: LOCAL_TTS_MODEL_REMOVE_MESSAGE,
        async handle() {
            if (removing) throw new Error('正在清除本地 TTS 模型，请稍后重试');
            if (preparing) throw new Error('本地 TTS 模型正在下载，请完成后再清除模型');
            removing = true;
            const revision = ++stateRevision;
            let finishRemoval!: () => void;
            removalFinished = new Promise<void>((resolve) => { finishRemoval = resolve; });
            try {
                await dependencies.offscreen.remove();
                const current: LocalTtsModelState = {
                    model: LOCAL_TTS_MODEL_ID,
                    downloaded: false,
                    downloadSizeMb: LOCAL_TTS_MODEL.downloadSizeMb,
                };
                await writeState(current, revision);
                return {success: true, model: LOCAL_TTS_MODEL_ID, downloaded: false, models: [current]};
            } finally {
                removing = false;
                finishRemoval();
            }
        },
    };

    return [state, prepare, remove];
}
