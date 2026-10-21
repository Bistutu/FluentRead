/**
 * @file src/features/section-translation/content/index.ts
 * 文件职责：把局部翻译接入网页运行时：监听可选的进入快捷键、为 Popup 与独立快捷方案提供进入容器选择的入口，并在用户点选区域后调用全文翻译引擎翻译或恢复该区域，用页内通知说明无法完成的情况。
 * 主要内容：导出 mountSectionTranslationContentFeature 与 startSectionTranslationPicker；组装选区记忆的持久化、自动补齐和提醒端口，携带方案请求覆盖和最近指针位置进入选择模式，支持同方案取消与跨方案切换，过滤输入场景、站点停用与总开关；用挂载取消域停止旧区域任务，仅为最新确认报告结果。
 * 模块边界：本模块只做入口编排与结果提示，不绘制高亮、不实现区域判定，也不直接操作译文 DOM；选择界面归 ./picker，区域翻译与恢复归全文翻译 feature 的公开接口，按键口径归 core/config/sectionTranslation。
 */
import {matchesSectionTranslationHotkey} from '@/src/core/config/sectionTranslation';
import {matchesConfiguredHotkey as matchesHotkey} from '@/src/core/hotkey';
import {normalizeUiLanguage, translate} from '@/src/core/i18n';
import {
    inspectTranslationSection,
    ensureTranslationSection,
    toggleTranslationSection,
    isFullPageTranslationActive,
    type TranslationSectionResult,
    type PageTranslationInvocation,
} from '@/src/features/full-page-translation/public';
import {showPageNotice} from '@/src/features/page-notice/public';
import {config, requestConfigPatch, subscribeConfig} from '@/src/services/config/store';
import {resolveQuickTranslationInvocation} from '@/src/features/quick-translation/public';
import {resolveSectionLocators} from '../locator';
import {createRememberedSectionRuntime} from './remembered';
import {showSectionReminder} from './reminder';
import {saveRememberedSection, sectionRememberScopes, SectionRuleSaveError} from './save';
import {isEditingInPage} from '@/src/shared/dom/editingTarget';
import {isSectionPickerActive, startSectionPicker, stopSectionPicker, type SectionPickerPoint} from './picker';

export interface SectionTranslationContentOptions {
    isSiteDisabled: () => boolean;
}

/** 当前挂载实例的进入函数；未挂载（总开关关闭、站点停用或页面未激活）时为 null。 */
let activeStarter: ((invocation?: PageTranslationInvocation) => boolean) | null = null;
let activeController: AbortController | null = null;

function text(key: string, params?: Readonly<Record<string, string | number>>): string {
    return translate(key, normalizeUiLanguage(config.uiLanguage), params);
}

/** 只在需要用户知道的情况下提示：翻译成功或恢复原文本身就在页面上可见，不再额外弹出通知。 */
function reportSectionResult(result: TranslationSectionResult): void {
    if (result.action === 'empty') {
        showPageNotice(text('sectionTranslation.notice.empty'), 'error');
    } else if (result.action === 'settled') {
        showPageNotice(text('sectionTranslation.notice.sameLanguage'), 'success');
    } else if (result.action === 'translated' && result.failed > 0) {
        showPageNotice(text('sectionTranslation.notice.failed', {count: result.failed}), 'error');
    } else if (result.action === 'translated' && result.translated === 0 && result.unchanged > 0) {
        showPageNotice(text('sectionTranslation.notice.sameLanguage'), 'success');
    }
}

/** 供 Popup 等扩展消息进入选择模式；返回 false 表示当前页面没有可用的局部翻译运行时。 */
export function startSectionTranslationPicker(invocation?: PageTranslationInvocation): boolean {
    return activeStarter?.(invocation) === true;
}

/**
 * 挂载局部翻译入口。指针位置只做被动记录；快捷键默认关闭，开启后才会拦截对应组合键。
 * 选择模式是一次性的：确认、Esc、右键或页面隐藏都会退出；卸载或替代挂载同时停止未完成的区域任务。
 */
export function mountSectionTranslationContentFeature(
    options: SectionTranslationContentOptions,
    signal: AbortSignal,
): void {
    if (signal.aborted) return;
    activeController?.abort();
    const controller = new AbortController();
    const lifetime = controller.signal;
    const abort = (): void => controller.abort();
    signal.addEventListener('abort', abort, {once: true});
    let pointer: SectionPickerPoint | null = null;
    const matchesConfiguredHotkey = (event: KeyboardEvent): boolean => config.sectionTranslationHotkeyEnabled === true
        && matchesSectionTranslationHotkey(event, config.sectionTranslationHotkey, config.customSectionTranslationHotkey);

    let activeProfileId = '';
    let selectionRevision = 0;
    let resultRevision = 0;
    const isCurrent = (): boolean => !lifetime.aborted && activeStarter === start
        && !options.isSiteDisabled() && config.on === true;
    const remembered = createRememberedSectionRuntime({
        document,
        href: () => document.location.href,
        rules: () => config.sectionTranslationRules,
        enabled: () => !lifetime.aborted && !options.isSiteDisabled() && config.on === true && !isFullPageTranslationActive() && !isSectionPickerActive(),
        resolve: resolveSectionLocators,
        translate: async (roots, rule, signal) => {
            const profile = rule.profileId ? config.quickTranslationProfiles.find(item => item.id === rule.profileId && item.action === 'section') : undefined;
            // 删除方案后不擅自改用其他服务，保留规则供设置页调整。
            if (rule.profileId && !profile) throw new Error('section-profile-unavailable');
            const invocation = profile ? resolveQuickTranslationInvocation(profile, config) : undefined;
            const result = await ensureTranslationSection(roots, invocation, signal);
            if (signal.aborted) return;
            if (result.failed || result.action === 'blocked' || result.action === 'cancelled') throw new Error('section-translation-failed');
        },
        remind: (count, translate, dismiss, signal) => showSectionReminder({count, text, translate, dismiss, signal}),
    }, lifetime);
    const unsubscribe = subscribeConfig(() => remembered.refresh());
    const start = (invocation?: PageTranslationInvocation): boolean => {
        if (!isCurrent()) return false;
        remembered.pause();
        // 快捷方案再次触发时退出当前选择；切换方案时重新进入，让高亮盘点与请求使用同一方案。
        if (isSectionPickerActive()) {
            if (!invocation) return true;
            stopSectionPicker();
            if (activeProfileId === invocation.profileId) { activeProfileId = ''; return true; }
        }
        activeProfileId = invocation?.profileId ?? '';
        const revision = ++selectionRevision;
        const profileHotkey = config.quickTranslationProfiles?.find(profile => profile.id === invocation?.profileId)?.hotkey;
        return startSectionPicker({
            initialPoint: pointer,
            rememberScopes: sectionRememberScopes(document.location?.href ?? ''),
            onRemember: async (selection, choice) => {
                const current = (): boolean => isCurrent() && revision === selectionRevision;
                try {
                    return await saveRememberedSection(selection, choice, {
                        rules: () => config.sectionTranslationRules,
                        profileId: invocation?.profileId,
                        current,
                        persist: rules => requestConfigPatch({sectionTranslationRules: rules}, message => browser.runtime.sendMessage(message)),
                    });
                } catch (error) {
                    if (current()) showPageNotice(text(`sectionTranslation.rules.${error instanceof SectionRuleSaveError ? error.reason : 'saveFailed'}`), 'error');
                    return false;
                }
            },
            inspect: (element) => invocation
                ? inspectTranslationSection(element, undefined, invocation)
                : inspectTranslationSection(element),
            onPick: async (element) => {
                if (!isCurrent() || revision !== selectionRevision) return;
                const resultId = ++resultRevision;
                const canReport = (): boolean => isCurrent() && revision === selectionRevision && resultId === resultRevision;
                try {
                    const result = await toggleTranslationSection(element, invocation, lifetime);
                    if (canReport()) reportSectionResult(result);
                } catch {
                    // 页面在扫描期间改写 DOM 等异常也应有可恢复反馈，不能留下未处理的 Promise。
                    if (canReport()) showPageNotice(text('translationCenter.requestError'), 'error');
                }
            },
            text,
            isExitHotkey: event => matchesConfiguredHotkey(event) || Boolean(profileHotkey && matchesHotkey(event, profileHotkey)),
            isEditing: isEditingInPage,
        });
    };

    document.addEventListener('pointermove', (event) => {
        if (!event.isTrusted || activeStarter !== start) return;
        pointer = {x: event.clientX, y: event.clientY};
    }, {capture: true, passive: true, signal: lifetime});

    document.addEventListener('keydown', (event) => {
        if (!event.isTrusted || activeStarter !== start) return;
        if (event.repeat || !matchesConfiguredHotkey(event) || isSectionPickerActive()) return;
        if (options.isSiteDisabled() || config.on !== true || isEditingInPage(event)) return;
        event.preventDefault();
        event.stopPropagation();
        start();
    }, {capture: true, signal: lifetime});

    activeStarter = start;
    activeController = controller;
    document.addEventListener('fluentread-route-change', () => {
        selectionRevision += 1;
        resultRevision += 1;
        activeProfileId = '';
        pointer = null;
        stopSectionPicker();
        // 规则监听器先收到导航时，旧选择器仍阻止自动处理；关闭后复核新页可用性。
        remembered.refresh();
    }, {signal: lifetime});
    lifetime.addEventListener('abort', () => {
        signal.removeEventListener('abort', abort);
        unsubscribe();
        // 替代挂载先取消旧控制器，AbortController 只结束一次，因此这里仍持有当前入口。
        activeStarter = null;
        activeController = null;
        stopSectionPicker();
    }, {once: true});
}
