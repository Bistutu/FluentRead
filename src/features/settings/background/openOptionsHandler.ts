/**
 * @file src/features/settings/background/openOptionsHandler.ts
 * 文件职责：处理来自页面通知和扩展 UI 的打开设置请求，在后台严格校验目标分区并将导航动作委托给可注入的 Options 页面适配器。
 * 主要内容：从设置导航注册表派生允许的分区与具体表单锚点，校验服务编辑目标或学习中心子栏目，定义请求响应与可注入导航契约；服务直达不修改默认服务。
 * 模块边界：本文件不直接绑定 browser.runtime、不渲染设置页也不持久化配置；浏览器页面创建由 app 注入，分区展示与搜索逻辑属于 settings/model 和 Options composition root。
 */
import {services} from '@/src/core/config/catalog';
import {isCustomOpenAIProviderId} from '@/src/core/config/customOpenAI';
import {isCompositeTranslationProviderId} from '@/src/core/config/compositeTranslation';
import {NAVIGATION_SECTION_ALIASES, NAVIGATION_SECTION_IDS, settingsSearchTargets, type NavigationSectionId} from '@/src/features/settings/model/navigation';

export const OPEN_OPTIONS_PAGE_MESSAGE_TYPE = 'openOptionsPage' as const;

export const OPTIONS_SECTION_IDS = NAVIGATION_SECTION_IDS;

export type OptionsSectionId = NavigationSectionId;

export interface OpenOptionsPageMessage {
    type: typeof OPEN_OPTIONS_PAGE_MESSAGE_TYPE;
    section?: unknown;
    learningTab?: unknown;
    service?: unknown;
    target?: unknown;
}

export interface OpenOptionsPageResponse {
    success: true;
}

export interface OpenOptionsPageDependencies {
    readonly openDefaultPage: () => Promise<void>;
    readonly openSection: (section: OptionsSectionId, destination?: string, target?: string) => Promise<void>;
}

export interface OpenOptionsPageHandler {
    readonly type: typeof OPEN_OPTIONS_PAGE_MESSAGE_TYPE;
    handle(message: OpenOptionsPageMessage): Promise<OpenOptionsPageResponse>;
}

const OPTIONS_SECTIONS = new Set<string>(OPTIONS_SECTION_IDS);

function parseSection(value: unknown): OptionsSectionId | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
        throw new TypeError('无效的设置页面');
    }
    const resolvedSection = NAVIGATION_SECTION_ALIASES.get(value) ?? value;
    if (!OPTIONS_SECTIONS.has(resolvedSection)) {
        throw new TypeError('无效的设置页面');
    }
    return resolvedSection as OptionsSectionId;
}

/** 创建设置页导航 handler；URL 与 tabs API 由 WXT composition root 负责。 */
export function createOpenOptionsPageHandler(
    dependencies: OpenOptionsPageDependencies,
): OpenOptionsPageHandler {
    return {
        type: OPEN_OPTIONS_PAGE_MESSAGE_TYPE,
        async handle(message) {
            const section = parseSection(message.section);
            const learningTab = message.learningTab;
            if (learningTab !== undefined && (section !== 'settings-vocabulary' || typeof learningTab !== 'string' || !['saved', 'materials', 'history', 'memory'].includes(learningTab))) {
                throw new TypeError('无效的学习栏目');
            }
            const service = message.service;
            if (service !== undefined && (section !== 'settings-services' || typeof service !== 'string'
                || !(Object.values(services).some(value => value === service)
                    || isCustomOpenAIProviderId(service) || isCompositeTranslationProviderId(service)))) throw new TypeError('无效的翻译服务设置');
            const target = message.target;
            if (target !== undefined && (typeof target !== 'string'
                || !settingsSearchTargets.some(item => item.sectionId === section && item.targetId === target))) throw new TypeError('无效的设置目标');
            if (section === undefined) {
                await dependencies.openDefaultPage();
            } else {
                const destination = typeof learningTab === 'string' ? learningTab : service;
                if (typeof target === 'string') await dependencies.openSection(section, destination, target);
                else if (typeof destination === 'string') await dependencies.openSection(section, destination);
                else await dependencies.openSection(section);
            }
            return {success: true};
        },
    };
}
