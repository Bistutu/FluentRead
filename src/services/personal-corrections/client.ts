/**
 * @file src/services/personal-corrections/client.ts
 * 文件职责：为网页编辑和翻译入口提供个人校订的类型化后台客户端。
 * 主要内容：发送独立消息、验证统一响应，订阅无正文变更广播并随页面生命周期释放。
 * 模块边界：客户端不写浏览器存储、不缓存个人译文、不接触 provider；不可用时由调用者保留普通翻译。
 */
import type {CorrectionQuery, PersonalCorrectionInput, PersonalCorrectionLookup, PersonalCorrectionProject, PersonalCorrectionSaveResult, PersonalCorrectionState} from '@/src/core/personal-corrections/public';
import {PERSONAL_CORRECTIONS_CHANGED, PERSONAL_CORRECTIONS_MESSAGE} from './protocol';
export interface PersonalCorrectionClientRuntime {
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {addListener(listener: (message: unknown) => void): void; removeListener(listener: (message: unknown) => void): void};
}
export function createPersonalCorrectionsClient(getRuntime: () => PersonalCorrectionClientRuntime) {
    const send = async <T>(action: string, fields: object = {}): Promise<T> => {
        let timer: ReturnType<typeof setTimeout>;
        const response = await new Promise<unknown>((resolve, reject) => {
            timer = setTimeout(() => reject(new Error(action === 'lookup' ? '个人校订查询超时' : action === 'list' ? '个人校订读取超时' : '结果未确认，请重新打开管理列表核对')), action === 'lookup' ? 1500 : 5000);
            Promise.resolve().then(() => getRuntime().sendMessage({type: PERSONAL_CORRECTIONS_MESSAGE, action, ...fields})).then(resolve, reject);
        }).finally(() => clearTimeout(timer));
        if (!response || typeof response !== 'object' || (response as {success?: unknown}).success !== true) {
            const error = response && typeof response === 'object' ? (response as {error?: unknown}).error : undefined;
            throw new Error(typeof error === 'string' ? error : '个人校订暂不可用');
        }
        return (response as {data: T}).data;
    };
    return {
        lookup: (query: CorrectionQuery) => send<PersonalCorrectionLookup>('lookup', {query}),
        list: () => send<PersonalCorrectionState>('list'),
        save: (input: PersonalCorrectionInput) => send<PersonalCorrectionSaveResult>('save', {input}),
        remove: (id: string, expectedRevision: number) => send<{undoToken: string}>('remove', {id, expectedRevision}),
        undo: (token: string) => send<void>('undo', {token}),
        createProject: (label: string) => send<PersonalCorrectionProject>('createProject', {label}),
        selectProject: (materialId: string, projectId: string | null) => send<void>('selectProject', {materialId, projectId}),
        subscribe(listener: () => void, signal?: AbortSignal): () => void {
            if (signal?.aborted) return () => undefined;
            let runtime: PersonalCorrectionClientRuntime;
            try {runtime = getRuntime();} catch {return () => undefined;}
            const receive = (message: unknown) => {
                if (message && typeof message === 'object' && (message as {type?: unknown}).type === PERSONAL_CORRECTIONS_CHANGED) listener();
            };
            let active = true;
            const cleanup = () => {if (!active) return; active = false; runtime.onMessage.removeListener(receive); signal?.removeEventListener('abort', cleanup);};
            runtime.onMessage.addListener(receive); signal?.addEventListener('abort', cleanup, {once: true});
            return cleanup;
        },
    };
}
