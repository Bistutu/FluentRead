/**
 * @file src/app/content/personalCorrections.ts
 * 文件职责：在内容脚本的既有激活生命周期中组装个人校订编辑器、网页双语端口及记忆变更订阅。
 * 主要内容：主动开启后将 WXT context 与独立 AbortSignal 注入隔离 Vue 界面，连接公开原译文对和预览接口；关闭时取消本功能订阅、观察及迟到响应，并恢复当前个人译文，保留持久记录。
 * 模块边界：仅连接公开契约，不实现存储、匹配、编辑状态或 DOM 校订算法；userscript 通过调用方能力判断和构建常量双重门控，移除扩展专属代码。
 */
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
import {mountPersonalCorrections, unmountPersonalCorrections} from '@/src/features/personal-corrections/public';
import {config} from '@/src/services/config/store';
import {personalCorrections} from '@/src/services/personal-corrections/public';
import {readPersonalCorrectionPair, listVisiblePersonalCorrectionPairs, refreshVisiblePersonalCorrections, watchPersonalCorrectionContext, disableVisiblePersonalCorrections} from '@/src/features/full-page-translation/public';
let activeCleanup: (() => void) | undefined;

export function mountPersonalCorrectionContent(ctx: ContentScriptContext, signal: AbortSignal): void {
    if (import.meta.env.BROWSER === 'userscript') return;
    if (!config.on || config.personalCorrectionsEnabled !== true || signal.aborted) return;
    activeCleanup?.();
    const controller = new AbortController();
    const dispose = () => {
        if (activeCleanup !== dispose) return;
        activeCleanup = undefined;
        signal.removeEventListener('abort', dispose);
        controller.abort();
        unmountPersonalCorrections();
        disableVisiblePersonalCorrections();
    };
    activeCleanup = dispose;
    signal.addEventListener('abort', dispose, {once: true});
    mountPersonalCorrections(ctx, controller.signal, {readPair: readPersonalCorrectionPair,
        listVisiblePairs: listVisiblePersonalCorrectionPairs, refreshVisible: refreshVisiblePersonalCorrections});
    personalCorrections.subscribe(() => {if (!controller.signal.aborted) void refreshVisiblePersonalCorrections();}, controller.signal);
    watchPersonalCorrectionContext(controller.signal);
}
export function unmountPersonalCorrectionContent(): void {
    if (import.meta.env.BROWSER !== 'userscript') activeCleanup?.();
}
