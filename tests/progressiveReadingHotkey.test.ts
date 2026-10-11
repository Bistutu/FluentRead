import {afterEach, describe, expect, it, vi} from 'vitest';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {buildConfigDiff} from '@/src/core/config/diff';
import {projectDriveSyncConfig, restoreDriveSyncSettings, buildDriveSyncDiff} from '@/src/core/config/driveSync';
import {settingsSearchTargets, settingsPagePanels} from '@/src/features/settings/model/navigation';
import {findProgressiveReadingHotkeyConflict, normalizeProgressiveReadingHotkey, normalizeCustomProgressiveReadingHotkey,
    resolveProgressiveReadingHotkey, progressiveReadingHotkeyDisplayName, matchesProgressiveReadingHotkey} from '@/src/core/config/progressiveReading';

afterEach(() => vi.unstubAllGlobals());
const event = (patch: Partial<KeyboardEvent> = {}) => ({key: 'l', code: 'KeyL', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false, ...patch} as KeyboardEvent);
const available = (patch: Partial<Config> = {}) => Object.assign(new Config(), {hotkey: 'none', floatingBallHotkey: 'none', selectionAreaEnabled: false}, patch);

describe('学习快捷键默认点击与迁移合同', () => {
    it('新安装和旧配置均保持无快捷键，不因保留的录制值主动开启', () => {
        expect(new Config()).toMatchObject({progressiveReadingHotkey: 'none', customProgressiveReadingHotkey: ''});
        expect(normalizeConfig({})).toMatchObject({progressiveReadingHotkey: 'none', customProgressiveReadingHotkey: ''});
        const old = normalizeConfig({customProgressiveReadingHotkey: 'option+l'});
        expect(old).toMatchObject({progressiveReadingHotkey: 'none', customProgressiveReadingHotkey: 'Alt+L'});
        expect(resolveProgressiveReadingHotkey(old.progressiveReadingHotkey, old.customProgressiveReadingHotkey)).toBe('none');
    });
    it.each([undefined, null, '', 'none', 'Alt+L', 'CUSTOM', true, 7, {}])('模式 %s 不隐式绑定组合', mode => {
        expect(normalizeProgressiveReadingHotkey(mode)).toBe('none');
        expect(resolveProgressiveReadingHotkey(mode, 'Alt+L')).toBe('none');
    });
    it.each([undefined, null, '', 'none', 'l', 'Cmd+L', 'Alt+unsupported', false, {}])('空或非法自定义 %s 回退仅点击', custom => {
        expect(normalizeCustomProgressiveReadingHotkey(custom)).toBe('');
        expect(normalizeConfig({progressiveReadingHotkey: 'custom', customProgressiveReadingHotkey: custom})).toMatchObject({progressiveReadingHotkey: 'none', customProgressiveReadingHotkey: ''});
        expect(resolveProgressiveReadingHotkey('custom', custom)).toBe('none');
        expect(progressiveReadingHotkeyDisplayName('custom', custom)).toBe('');
        expect(matchesProgressiveReadingHotkey(event(), 'custom', custom)).toBe(false);
    });
    it('合法自定义按公共解析器规范化，清除不恢复任何预绑定按键', () => {
        const saved = normalizeConfig({progressiveReadingHotkey: 'custom', customProgressiveReadingHotkey: 'shift+option+control+l'});
        expect(saved).toMatchObject({progressiveReadingHotkey: 'custom', customProgressiveReadingHotkey: 'Ctrl+Alt+Shift+L'});
        expect(normalizeConfig(saved)).toEqual(saved);
        expect(normalizeConfig({...saved, progressiveReadingHotkey: 'none', customProgressiveReadingHotkey: ''})).toMatchObject({progressiveReadingHotkey: 'none', customProgressiveReadingHotkey: ''});
        expect(normalizeProgressiveReadingHotkey('custom')).toBe('custom');
        expect(resolveProgressiveReadingHotkey('custom', 'option+l')).toBe('Alt+L');
    });
    it.each([{platform: 'MacIntel', display: 'Option+L'}, {platform: 'Win32', display: 'Alt+L'}])('$platform 只改变展示，匹配修饰键必须完全相同', ({platform, display}) => {
        vi.stubGlobal('navigator', {platform});
        expect(progressiveReadingHotkeyDisplayName('custom', 'Alt+L')).toBe(display);
        expect(matchesProgressiveReadingHotkey(event(), 'custom', 'Alt+L')).toBe(true);
        expect(matchesProgressiveReadingHotkey(event({key: '¬'}), 'custom', 'Alt+L')).toBe(true);
        expect(matchesProgressiveReadingHotkey(event({shiftKey: true}), 'custom', 'Alt+L')).toBe(false);
        expect(matchesProgressiveReadingHotkey(event({altKey: false}), 'custom', 'Alt+L')).toBe(false);
        expect(matchesProgressiveReadingHotkey(event(), 'none', 'Alt+L')).toBe(false);
        expect(progressiveReadingHotkeyDisplayName('none', 'Alt+L')).toBe('');
    });
    it('配置差异和普通同步认识两个公开偏好，不混入正文或学习记录', () => {
        const before = {progressiveReadingHotkey: 'none', customProgressiveReadingHotkey: ''};
        const after = {progressiveReadingHotkey: 'custom', customProgressiveReadingHotkey: 'Alt+L'};
        const changes = buildConfigDiff(before, after).groups.find(group => group.id === 'translation')!.changes;
        expect(changes).toEqual([
            {key: 'progressiveReadingHotkey', label: '学习快捷键', before: '无快捷键（仅点击）', after: '自定义快捷键'},
            {key: 'customProgressiveReadingHotkey', label: '自定义学习快捷键', before: '未设置', after: 'Alt+L'},
        ]);
        expect(projectDriveSyncConfig({...after, readingSource: 'private text', readingHistory: ['private note']})).toEqual(after);
        expect(restoreDriveSyncSettings({...before, token: {fixture: 'private'}}, after)).toEqual({...after, token: {fixture: 'private'}});
        expect(buildDriveSyncDiff(null, before, after).changes.map(item => item.label)).toEqual(['学习快捷键', '自定义学习快捷键']);
    });
    it('搜索和 target 深链定位网页翻译的独立学习分类', () => {
        expect(settingsSearchTargets.find(item => item.id === 'progressive-reading')).toMatchObject({sectionId: 'settings-translation', targetId: 'progressive-reading'});
        expect(settingsPagePanels['settings-translation'].find(item => item.id === 'progressive-reading')).toMatchObject({labelKey: 'progressiveReading.settings.title', targetIds: ['progressive-reading']});
    });
});

describe('学习快捷键复用当前配置冲突边界', () => {
    it('无快捷键、非法值和无人占用的组合均不冲突', () => {
        for (const hotkey of ['', 'none', 'unsupported', 'Alt+L']) expect(findProgressiveReadingHotkeyConflict(available(), hotkey)).toBe(null);
    });
    it.each([
        ['hover', {hotkey: 'custom', customHotkey: 'Alt+L'}],
        ['page', {floatingBallHotkey: 'custom', customFloatingBallHotkey: 'Alt+L'}],
        ['selection', {disableSelectionTranslator: false, selectionTranslatorMode: 'bilingual', selectionTranslatorTrigger: 'custom', customSelectionTranslatorHotkey: 'Alt+L'}],
        ['area', {selectionAreaEnabled: true, selectionAreaHotkey: 'custom', customSelectionAreaHotkey: 'Alt+L'}],
        ['paragraph', {paragraphCopyEnabled: true, paragraphCopyHotkey: 'custom', customParagraphCopyHotkey: 'Alt+L'}],
        ['section', {sectionTranslationHotkeyEnabled: true, sectionTranslationHotkey: 'custom', customSectionTranslationHotkey: 'Alt+L'}],
        ['input', {inputBoxTranslationTrigger: 'ctrl_enter'}],
        ['highlight', {informationHighlight: {...new Config().informationHighlight, enabled: true, hotkeyEnabled: true, hotkey: 'Alt+L'}}],
        ['profile', {quickTranslationProfiles: [{id: 'owned', enabled: true, action: 'hover', hotkey: 'Alt+L'}]}],
    ] as const)('%s 已启用的组合按规范身份判断', (owner, patch) => {
        expect(findProgressiveReadingHotkeyConflict(available(patch as unknown as Partial<Config>), owner === 'input' ? 'Control+Enter' : 'option+l')).toBe(owner);
    });
    it.each(['Control', 'Ctrl', 'Alt', 'Option', 'Shift'])('已启用悬浮纯修饰 %s 的前缀也占用后续组合', hotkey => {
        expect(findProgressiveReadingHotkeyConflict(available({hotkey}), 'Ctrl+Alt+Shift+L')).toBe('hover');
    });
    it('已启用划词纯修饰前缀让行，关闭任一划词门禁后旧绑定不再占用', () => {
        const config = available({disableSelectionTranslator: false, selectionTranslatorMode: 'bilingual', selectionTranslatorTrigger: 'Control'});
        expect(findProgressiveReadingHotkeyConflict(config, 'Ctrl+Shift+L')).toBe('selection');
        config.disableSelectionTranslator = true;
        expect(findProgressiveReadingHotkeyConflict(config, 'Ctrl+Shift+L')).toBe(null);
        config.disableSelectionTranslator = false; config.selectionTranslatorMode = 'disabled';
        expect(findProgressiveReadingHotkeyConflict(config, 'Ctrl+Shift+L')).toBe(null);
        config.selectionTranslatorMode = 'bilingual'; config.selectionTranslatorTrigger = 'Alt';
        expect(findProgressiveReadingHotkeyConflict(config, 'Ctrl+L')).toBe(null);
    });
    it('关闭的功能与停用方案不占用，启用高亮但关闭其快捷键也不占用', () => {
        const config = available({customParagraphCopyHotkey: 'Alt+L', customSectionTranslationHotkey: 'Alt+L',
            customSelectionAreaHotkey: 'Alt+L', informationHighlight: {...new Config().informationHighlight, enabled: true, hotkeyEnabled: false, hotkey: 'Alt+L'},
            quickTranslationProfiles: [{id: 'off', enabled: false, action: 'hover', hotkey: 'Alt+L'}] as Config['quickTranslationProfiles']});
        expect(findProgressiveReadingHotkeyConflict(config, 'Alt+L')).toBe(null);
    });
});
