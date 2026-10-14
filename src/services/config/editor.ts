/**
 * @file src/services/config/editor.ts
 * 文件职责：维护设置编辑会话的独立草稿基线、水合、提交所有权和保存反馈代次。
 * 主要内容：外部快照只刷新未编辑字段，在途提交保留自己的字段，成功后采用期间到达的确认快照，失败后保留可重试草稿；同步捕获提交，再通过调用方已有配置补丁端口保存，卸载与反馈失效拒绝迟到结果。
 * 模块边界：本文件是配置应用服务，不依赖 Vue、全局配置单例、浏览器或存储；页面决定可提交字段，权威持久化与 CAS 继续由 config store 负责。
 */
import type {Config} from '@/src/core/config/model';

export interface ConfigEditorPorts {
    copySnapshot(value: unknown): Config;
    readDraft(): Config;
    writeDraft(snapshot: Config): void;
    saveDraft(snapshot: Config, previous: Config): Promise<void>;
    onEdited(): void;
    onSaved(): void;
    onSaveError(error: unknown): void;
}

/** 顶层字段与 config store 的 patch 所有权一致，嵌套映射的领域合并由页面提交端口负责。 */
function changedFields(next: Config, previous: Config): Partial<Config> {
    return Object.fromEntries(Object.keys(next).filter(key =>
        JSON.stringify(next[key as keyof Config]) !== JSON.stringify(previous[key as keyof Config]),
    ).map(key => [key, next[key as keyof Config]]));
}

export function createConfigEditor(ports: ConfigEditorPorts) {
    let baseline = ports.copySnapshot(ports.readDraft());
    let authority = baseline;
    let authorityGeneration = 0;
    let ready = false;
    let disposed = false;
    let applying = false;
    let sequence = 0;
    let feedbackGeneration = 0;
    const pending = new Map<number, Partial<Config>>();

    const submittedFields = () => Object.assign({}, ...pending.values()) as Partial<Config>;

    function reconcile(nextAuthority: Config): void {
        const edits = ready ? changedFields(ports.readDraft(), baseline) : {};
        const snapshot = ports.copySnapshot({...nextAuthority, ...submittedFields(), ...edits});
        applying = true;
        try {
            // 基线与页面草稿必须拥有不同的嵌套对象，页面 v-model 不能提前污染差分。
            // 同值水合保留嵌套引用，不能让 popup 的页面身份或表单操作上下文无故失效。
            if (Object.keys(changedFields(snapshot, ports.readDraft())).length > 0) ports.writeDraft(snapshot);
            baseline = ports.copySnapshot({...nextAuthority, ...submittedFields()});
            authority = nextAuthority;
        } finally {
            applying = false;
        }
    }

    function hydrate(value: unknown): void {
        if (disposed) return;
        reconcile(ports.copySnapshot(value));
        authorityGeneration += 1;
    }

    function initialize(value: unknown): void {
        if (disposed) return;
        hydrate(value);
        ready = true;
    }

    function save(): Promise<void> {
        if (disposed || !ready || applying) return Promise.resolve();
        const snapshot = ports.copySnapshot(ports.readDraft());
        const previous = baseline;
        const fields = changedFields(snapshot, previous);
        if (Object.keys(fields).length === 0) return Promise.resolve();
        const request = ++sequence;
        const generation = feedbackGeneration;
        const observedAuthority = authorityGeneration;
        baseline = snapshot;
        pending.set(request, fields);
        ports.onEdited();
        let result: Promise<void>;
        try {
            // 不先 await：关闭页的调用方必须能在同一栈中交接新增补丁。
            result = ports.saveDraft(snapshot, previous);
        } catch (error) {
            result = Promise.reject(error);
        }
        return result.then(() => {
            pending.delete(request);
            // canonical/外部快照可能在 ACK 之前到达，被当前提交暂时遮住；解除字段所有权后立即采用。
            // 没有请求之后的新快照时，成功本身不能把请求前的旧 authority 当作本次提交结果。
            if (!disposed && authorityGeneration > observedAuthority) reconcile(authority);
            if (!disposed && request === sequence && generation === feedbackGeneration) ports.onSaved();
        }, error => {
            pending.delete(request);
            if (disposed || request !== sequence) return;
            // 保存失败不销毁用户草稿；重新基于已收到的权威快照计算 dirty，下一次编辑或显式保存可重试。
            baseline = ports.copySnapshot({...authority, ...submittedFields()});
            if (generation === feedbackGeneration) ports.onSaveError(error);
        });
    }

    function dispose(): void {
        disposed = true;
        ready = false;
        pending.clear();
        feedbackGeneration += 1;
    }

    return {
        hydrate, initialize, save, dispose,
        invalidateFeedback: () => {feedbackGeneration += 1;},
        get applying(): boolean {return applying;},
        get ready(): boolean {return ready;},
    };
}

export type ConfigEditor = ReturnType<typeof createConfigEditor>;
