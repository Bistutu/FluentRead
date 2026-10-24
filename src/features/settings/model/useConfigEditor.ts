/**
 * @file src/features/settings/model/useConfigEditor.ts
 * 文件职责：把配置编辑会话连接到 Vue 草稿 watcher 与配置服务的订阅、就绪端口。
 * 主要内容：按顶层字段缓存草稿 JSON 签名，仅重扫发生变化的分支；聚合观察保留 sync/post 时机、新增及删除字段，水合期间暂停依赖扫描，统一独立快照写入和卸载清理；领域 patch 与保存反馈仍由页面决定。
 * 模块边界：本文件属于设置编辑模型，只适配 Vue 生命周期，不读取全局 store、不直接保存存储，也不实现模型、站点或文档规则。
 */
import {computed, watch, type ComputedRef, type WatchHandle} from 'vue';
import {createConfigEditor, type ConfigEditorPorts} from '@/src/services/config/editor';
import type {Config} from '@/src/core/config/model';

export interface UseConfigEditorOptions extends ConfigEditorPorts {
    ready: PromiseLike<unknown>;
    readAuthority(): Config;
    subscribe(listener: (snapshot: Config) => void): () => void;
    flush: 'sync' | 'post';
    onReady(): void;
    onReadyError(error: unknown): void;
}

export function useConfigEditor(options: UseConfigEditorOptions) {
    let watcher: WatchHandle;
    let disposed = false;
    const editor = createConfigEditor({...options, writeDraft(snapshot) {
        watcher.pause();
        try {
            options.writeDraft(snapshot);
        } finally {
            // resume 仍处于 controller 的水合 guard 内，不能把权威同步当作用户编辑。
            try {
                watcher.resume();
            } catch (error) {
                // getter 异常会留下未完成的响应式刷新；重新建立观察归属，后续真实编辑仍可提交。
                watcher.stop();
                watcher = observeDraft();
                throw error;
            }
        }
    }});
    function observeDraft(): WatchHandle {
        let signatures = new Map<string, ComputedRef<string | undefined>>();
        return watch(() => {
            const nextSignatures = new Map<string, ComputedRef<string | undefined>>();
            const values = Object.keys(options.readDraft()).flatMap(key => {
                // computed 只追踪自己的字段；输入短文本时不重新序列化术语库等未编辑的大分支。
                const signature = signatures.get(key)
                    ?? computed(() => JSON.stringify(options.readDraft()[key as keyof Config]));
                nextSignatures.set(key, signature);
                return [key, signature.value];
            });
            // 删除字段同时释放缓存；之后重新添加同名字段时重新建立依赖。
            signatures = nextSignatures;
            return values;
        }, (next, previous) => {
            // 根引用或键集合变化可能重建数组，但同值字段不能产生额外保存。
            if (next.length !== previous.length || next.some((value, index) => value !== previous[index])) void editor.save();
        }, {flush: options.flush});
    }
    watcher = observeDraft();
    // store 可同步回调；必须在 watcher 建立之后再订阅。
    const unsubscribe = options.subscribe(editor.hydrate);
    void Promise.resolve(options.ready).then(() => {
        if (disposed) return;
        editor.initialize(options.readAuthority());
        options.onReady();
    }).catch(error => {if (!disposed) options.onReadyError(error);});
    return {...editor,
        get applying(): boolean {return editor.applying;},
        get ready(): boolean {return editor.ready;},
        dispose() {
            if (disposed) return;
            disposed = true;
            watcher.stop();
            unsubscribe();
            editor.dispose();
        },
    };
}
