/**
 * @file src/app/content/learningFeatures.ts
 * 文件职责：组装页面内个人校订与写作入口的静态功能定义。
 * 主要内容：将当前配置、浏览器能力和 WXT context 接入校订与写作助手的启用判断和挂载所有权；句子听读与收藏统一由主动划词后的卡片承接。
 * 模块边界：只组织 feature 公开生命周期，不为普通悬停挂载句子工具条，不处理编辑器、校订存储或学习数据。
 */
import type {ContentScriptContext} from 'wxt/utils/content-script-context';
import type {Config} from '@/src/core/config/model';
import type {BrowserCapabilities} from '@/src/platform/browser/capabilities';
import {isWritingPage} from '@/src/core/config/writing';
import {mountWritingAssistant, unmountWritingAssistant, isWritingAssistantMounted} from '@/src/features/writing-assistant/public';
import type {ContentFeatureDefinition} from './featureRegistry';
import {mountPersonalCorrectionContent, unmountPersonalCorrectionContent} from './personalCorrections';

export function createLearningContentFeatures(ctx: ContentScriptContext, config: Config, capabilities: BrowserCapabilities): ContentFeatureDefinition[] {
    return [
        ...(import.meta.env.BROWSER === 'userscript' ? [] : [
            {id: 'personal-corrections', isEnabled: () => capabilities.browser !== 'userscript' && config.on && config.personalCorrectionsEnabled === true,
                mount: ({signal}) => mountPersonalCorrectionContent(ctx, signal), unmount: unmountPersonalCorrectionContent} satisfies ContentFeatureDefinition,
        ]),
        {id: 'writing-assistant', isEnabled: () => capabilities.browser !== 'userscript' && config.on && config.writing.enabled && isWritingPage(window.location.href),
            mount: () => mountWritingAssistant(ctx), unmount: unmountWritingAssistant, isMounted: isWritingAssistantMounted},
    ];
}
