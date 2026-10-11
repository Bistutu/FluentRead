/**
 * @file src/app/content/learningFeatures.ts
 * 文件职责：组装页面内写作入口和主动渐进阅读辅助的静态功能定义。
 * 主要内容：将当前配置、浏览器能力和 WXT context 接入写作/阅读的启用判断与挂载所有权；userscript 构建排除渐进阅读定义，句子听读与收藏统一由主动划词后的卡片承接。
 * 模块边界：只组织 feature 公开生命周期，不为普通悬停挂载句子工具条，不处理编辑器或学习数据。
 */
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
import type {Config} from '@/src/core/config/model';
import type {BrowserCapabilities} from '@/src/platform/browser/capabilities';
import {isWritingPage} from '@/src/core/config/writing';
import {mountWritingAssistant, unmountWritingAssistant, isWritingAssistantMounted} from '@/src/features/writing-assistant/public';
import {mountProgressiveReading, unmountProgressiveReading} from '@/src/features/progressive-reading/public';
import type {ContentFeatureDefinition} from './featureRegistry';

export function createLearningContentFeatures(ctx: ContentScriptContext, config: Config, capabilities: BrowserCapabilities): ContentFeatureDefinition[] {
    const progressiveFeatures: ContentFeatureDefinition[] = import.meta.env.BROWSER === 'userscript' ? [] : [
        {id: 'progressive-reading', isEnabled: () => capabilities.browser !== 'userscript' && config.on,
            mount: runtime => mountProgressiveReading(ctx, runtime.signal), unmount: unmountProgressiveReading},
    ];
    return [
        ...progressiveFeatures,
        {id: 'writing-assistant', isEnabled: () => capabilities.browser !== 'userscript' && config.on && config.writing.enabled && isWritingPage(window.location.href),
            mount: () => mountWritingAssistant(ctx), unmount: unmountWritingAssistant, isMounted: isWritingAssistantMounted},
    ];
}
