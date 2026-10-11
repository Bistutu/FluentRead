/**
 * @file src/core/config/progressiveReading.ts
 * 文件职责：定义学习入口默认仅点击的快捷键配置与共享冲突判断。
 * 主要内容：归一化 none/custom 与录制组合，提供运行时解析、平台显示及严格匹配；对已启用动作和纯修饰键前缀保守让行，设置与内容监听复用同一判断。
 * 模块边界：只做纯配置转换，不读取存储、不注册事件或打开面板；按键规则沿用 core/hotkey，配置持久化和阅读会话分别由 services 与 feature 负责。
 */
import {canonicalizeHotkey, matchesHotkey, parseHotkey, resolveConfiguredHotkey} from '@/src/core/hotkey';
import {resolveAreaTranslationHotkey} from './areaTranslation';
import {resolveParagraphCopyHotkey} from './paragraphCopy';
import {resolveSectionTranslationHotkey} from './sectionTranslation';
import {findEnabledQuickTranslationHotkeyConflict, inputBoxTranslationTriggerHotkey, type QuickTranslationProfile} from './quickTranslation';

export function normalizeProgressiveReadingHotkey(value: unknown): 'none' | 'custom' {
    return value === 'custom' ? 'custom' : 'none';
}
export function normalizeCustomProgressiveReadingHotkey(value: unknown): string {
    return typeof value === 'string' ? canonicalizeHotkey(value) : '';
}
export function resolveProgressiveReadingHotkey(hotkey: unknown, customHotkey: unknown): string {
    return normalizeProgressiveReadingHotkey(hotkey) === 'custom'
        ? normalizeCustomProgressiveReadingHotkey(customHotkey) || 'none' : 'none';
}
export function progressiveReadingHotkeyDisplayName(hotkey: unknown, customHotkey: unknown): string {
    return parseHotkey(resolveProgressiveReadingHotkey(hotkey, customHotkey)).displayName;
}
export function matchesProgressiveReadingHotkey(event: KeyboardEvent, hotkey: unknown, customHotkey: unknown): boolean {
    return matchesHotkey(event, parseHotkey(resolveProgressiveReadingHotkey(hotkey, customHotkey)));
}

export type ProgressiveReadingHotkeyConflict = 'hover' | 'page' | 'selection' | 'area' | 'paragraph' | 'section' | 'input' | 'highlight' | 'profile';
/** 只描述冲突判断需要的配置结构，避免反向依赖创建这些配置的 model。 */
interface HotkeyConfig {
    hotkey: string;
    customHotkey: string;
    floatingBallHotkey: string;
    customFloatingBallHotkey: string;
    disableSelectionTranslator: boolean;
    selectionTranslatorMode: string;
    selectionTranslatorTrigger: string;
    customSelectionTranslatorHotkey: string;
    selectionAreaEnabled: boolean;
    selectionAreaHotkey: string;
    customSelectionAreaHotkey: string;
    paragraphCopyEnabled: boolean;
    paragraphCopyHotkey: string;
    customParagraphCopyHotkey: string;
    sectionTranslationHotkeyEnabled: boolean;
    sectionTranslationHotkey: string;
    customSectionTranslationHotkey: string;
    inputBoxTranslationTrigger: string;
    informationHighlight: {enabled: boolean; hotkeyEnabled: boolean; hotkey: string};
    quickTranslationProfiles: readonly QuickTranslationProfile[];
}

/** 纯修饰键动作先于最终组合触发；已启用的悬浮/划词动作也占用含此修饰键的组合。 */
export function findProgressiveReadingHotkeyConflict(config: HotkeyConfig, hotkey: string): ProgressiveReadingHotkeyConflict | null {
    const canonical = canonicalizeHotkey(hotkey);
    if (!canonical) return null;
    const identity = canonical.toLowerCase(), modifiers = parseHotkey(canonical).modifiers;
    const owners: Array<[ProgressiveReadingHotkeyConflict, string]> = [
        ['hover', resolveConfiguredHotkey(config.hotkey, config.customHotkey)],
        ['page', resolveConfiguredHotkey(config.floatingBallHotkey, config.customFloatingBallHotkey)],
        ['selection', config.disableSelectionTranslator || config.selectionTranslatorMode === 'disabled' ? ''
            : resolveConfiguredHotkey(config.selectionTranslatorTrigger, config.customSelectionTranslatorHotkey)],
        ['area', config.selectionAreaEnabled ? resolveAreaTranslationHotkey(config.selectionAreaHotkey, config.customSelectionAreaHotkey) : ''],
        ['paragraph', config.paragraphCopyEnabled ? resolveParagraphCopyHotkey(config.paragraphCopyHotkey, config.customParagraphCopyHotkey) : ''],
        ['section', config.sectionTranslationHotkeyEnabled ? resolveSectionTranslationHotkey(config.sectionTranslationHotkey, config.customSectionTranslationHotkey) : ''],
        ['input', inputBoxTranslationTriggerHotkey(config.inputBoxTranslationTrigger)],
        ['highlight', config.informationHighlight.enabled && config.informationHighlight.hotkeyEnabled ? config.informationHighlight.hotkey : ''],
    ];
    const modifierNames: Record<string, string> = {control: 'ctrl', ctrl: 'ctrl', alt: 'alt', option: 'alt', shift: 'shift'};
    for (const [owner, binding] of owners) {
        const prefix = modifierNames[binding.toLowerCase()];
        if (canonicalizeHotkey(binding).toLowerCase() === identity
            || (owner === 'hover' || owner === 'selection') && Boolean(prefix) && modifiers.includes(prefix)) return owner;
    }
    return findEnabledQuickTranslationHotkeyConflict(config.quickTranslationProfiles, canonical) ? 'profile' : null;
}
