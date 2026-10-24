/**
 * @file src/app/content/neteaseMailFrameRuntime.ts
 * 文件职责：为网易邮件正文入口装配共享邮件运行时与专用划词浮层。
 * 主要内容：静态传入划词 UI 挂载和卸载端口，让 QQ 与其他受限 frame 无须引入网易专用 Vue 组件及样式。
 * 模块边界：只负责应用接线，不改变邮件授权、about:blank 判断、配置、挂载代次或清理逻辑；共享生命周期仍由 qqMailFrameRuntime 拥有。
 */
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
import {mountSelectionTranslator, unmountSelectionTranslator} from '@/src/features/selection-translation/public';
import {startNeteaseMailFrameApp as startMailFrame} from './qqMailFrameRuntime';

export function startNeteaseMailFrameApp(ctx: ContentScriptContext): Promise<void> {
    return startMailFrame(ctx, {mount: mountSelectionTranslator, unmount: unmountSelectionTranslator});
}
