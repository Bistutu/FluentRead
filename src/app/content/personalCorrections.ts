/**
 * @file src/app/content/personalCorrections.ts
 * 文件职责：在内容脚本的既有激活生命周期中组装个人校订编辑器、网页双语端口及记忆变更订阅。
 * 主要内容：将 WXT context 与 AbortSignal 注入隔离 Vue 界面，使用全文功能公开的原文译文对、受影响单元预览和可逆渲染接口，共享记忆变更与语境失效的取消生命周期。
 * 模块边界：仅连接公开契约，不实现存储、匹配、编辑状态或 DOM 校订算法；userscript 通过调用方能力判断和构建常量双重门控，移除扩展专属代码。
 */
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
import {mountPersonalCorrections} from '@/src/features/personal-corrections/public';
import {personalCorrections} from '@/src/services/personal-corrections/public';
import {readPersonalCorrectionPair, listVisiblePersonalCorrectionPairs, refreshVisiblePersonalCorrections, watchPersonalCorrectionContext} from '@/src/features/full-page-translation/public';

export function mountPersonalCorrectionContent(ctx: ContentScriptContext, signal: AbortSignal): void {
    if (import.meta.env.BROWSER === 'userscript') return;
    mountPersonalCorrections(ctx, signal, {readPair: readPersonalCorrectionPair,
        listVisiblePairs: listVisiblePersonalCorrectionPairs, refreshVisible: refreshVisiblePersonalCorrections});
    personalCorrections.subscribe(() => { void refreshVisiblePersonalCorrections(); }, signal);
    watchPersonalCorrectionContext(signal);
}
