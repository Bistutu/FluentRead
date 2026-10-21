import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import ts from 'typescript';
import {normalizeConfig} from '@/src/core/config/model';
import {resolveConfiguredHotkey} from '@/src/core/hotkey';
import {buildConfigDiff} from '@/src/core/config/diff';
import {createPopupPageFontActions, type PopupPageFontState} from '@/src/app/popup/pageFontActions';
import type {PopupActiveTab} from '@/src/app/popup/pageContracts';

// 编译真实 Popup action，注入浏览器边界，验证恢复与配置更新不会走错误的副作用路径。
function loadAction(name: string, ports: Record<string, unknown>) {
    const source = readFileSync(resolve(__dirname, '../src/app/popup/PopupApp.vue'), 'utf8');
    const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1];
    const ast = ts.createSourceFile('popup.ts', script, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
    const code = ts.transpileModule(declaration.getText(ast), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
    return new Function(...Object.keys(ports), `${code}\nreturn ${name};`)(...Object.values(ports));
}

describe('Popup actions across configuration and page state', () => {
    it('悬停开关关闭并重开后恢复预设、手势与自定义快捷键，不改变额外方案', () => {
        for (const hotkey of ['Control', 'Alt', 'Shift', 'Escape', '`', 'DoubleClick', 'LongPress', 'MiddleClick', 'TwoFinger', 'ThreeFinger', 'FourFinger', 'DoubleClickScree', 'TripleClickScree', 'custom']) {
            const config = {value: normalizeConfig({hotkey, customHotkey: 'Alt+J'})};
            const extra = config.value.quickTranslationProfiles;
            const action = loadAction('toggleDefaultHoverShortcut', {config, resolveConfiguredHotkey,
                defaultHoverEnabled: {get value() {return config.value.hotkey !== 'none';}},
                quickTranslationConflictMessage: () => '', showNotice: vi.fn()});
            action();
            expect(config.value.hotkey).toBe('none');
            config.value = normalizeConfig(JSON.parse(JSON.stringify(config.value)));
            expect(config.value.hoverShortcutBeforeDisable).toBe(hotkey);
            action();
            expect(config.value.hotkey).toBe(hotkey);
            expect(config.value.customHotkey).toBe('Alt+J');
            expect(config.value.quickTranslationProfiles).toEqual(extra);
        }
    });

    it('旧版关闭状态和损坏恢复字段安全迁移；空自定义键回退，冲突时不覆盖独立方案', () => {
        expect(normalizeConfig({hotkey: 'none'}).hotkey).toBe('none');
        expect(normalizeConfig({hotkey: 'none', hoverShortcutBeforeDisable: 'Computer'}).hoverShortcutBeforeDisable).toBe('Control');
        const config = {value: normalizeConfig({hotkey: 'none', hoverShortcutBeforeDisable: 'custom', customHotkey: ''})};
        const showNotice = vi.fn();
        let conflict = '';
        const action = loadAction('toggleDefaultHoverShortcut', {config, resolveConfiguredHotkey,
            defaultHoverEnabled: {value: false}, quickTranslationConflictMessage: () => conflict, showNotice});
        action(); expect(config.value.hotkey).toBe('Control');
        config.value.hotkey = 'none'; conflict = '快捷键已被独立方案使用'; action();
        expect(config.value.hotkey).toBe('none');
        expect(showNotice).toHaveBeenCalledWith(conflict, 'error');
    });

    it('划词开关恢复关闭前的译文显示偏好且保留触发、卡片与收藏设置', () => {
        const config = {value: normalizeConfig({selectionTranslatorMode: 'translation-only', selectionTranslatorTrigger: 'contextMenu', selectionTranslatorPresentation: 'card', vocabularyBookEnabled: true})};
        const setSelectionMode = loadAction('setSelectionMode', {config});
        const action = loadAction('toggleSelectionTranslation', {config, setSelectionMode});
        action();
        expect(config.value.selectionTranslatorMode).toBe('disabled');
        expect(config.value.disableSelectionTranslator).toBe(true);
        config.value = normalizeConfig(JSON.parse(JSON.stringify(config.value)));
        action();
        expect(config.value.selectionTranslatorMode).toBe('translation-only');
        expect(config.value.disableSelectionTranslator).toBe(false);
        expect(config.value.selectionTranslatorTrigger).toBe('contextMenu');
        expect(config.value.selectionTranslatorPresentation).toBe('card');
        expect(config.value.vocabularyBookEnabled).toBe(true);
        setSelectionMode('bilingual'); action(); action();
        expect(config.value.selectionTranslatorMode).toBe('bilingual');
        expect(normalizeConfig({selectionTranslatorMode: 'disabled'}).selectionTranslatorModeBeforeDisable).toBe('bilingual');
        expect(normalizeConfig({selectionTranslatorMode: 'disabled', selectionTranslatorModeBeforeDisable: 'invalid' as never}).selectionTranslatorModeBeforeDisable).toBe('bilingual');
    });

    it('关闭前的记忆字段保存在配置中但不重复进入用户差异预览', () => {
        expect(buildConfigDiff({hoverShortcutBeforeDisable: 'Control', selectionTranslatorModeBeforeDisable: 'bilingual'},
            {hoverShortcutBeforeDisable: 'Alt', selectionTranslatorModeBeforeDisable: 'translation-only'}).changeCount).toBe(0);
    });

    it('总开关保留在设置页，Popup 只展示暂停状态', () => {
        const popup = readFileSync(resolve(__dirname, '../src/app/popup/PopupApp.vue'), 'utf8');
        const settings = readFileSync(resolve(__dirname, '../src/features/settings/ui/SettingsSections.vue'), 'utf8');
        expect(popup).not.toContain('setPluginEnabled');
        expect(popup).toContain('v-if="!config.on"');
        expect(settings).toContain('v-model="config.on"');
    });
});

function pageFontFixture() {
    const state: PopupPageFontState = {browserDefault: null, loading: false, busy: false, unavailable: false, error: ''};
    const tab: PopupActiveTab = {id: 7, url: 'https://example.com/article'};
    const snapshot = {status: 'success', browserDefault: false, documentToken: 'document-a', pageUrl: tab.url!};
    let active = true;
    const getTab = vi.fn(async (): Promise<PopupActiveTab | undefined> => ({...tab}));
    const send = vi.fn(async (_id: number, message: {type: string; browserDefault?: boolean; documentToken?: string; pageUrl?: string}): Promise<unknown> => ({...snapshot,
        browserDefault: message.type === 'setPageTranslationFont' ? message.browserDefault : snapshot.browserDefault}));
    const actions = createPopupPageFontActions({state, getTab, send, active: () => active});
    return {state, tab, snapshot, getTab, send, actions, pause: () => {active = false;}, deactivate: () => {active = false;actions.invalidate();}};
}
function pendingFontReply<T = unknown>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => {resolve = yes;});
    return {promise, resolve};
}
async function flushFontTasks() {for (let index = 0; index < 12; index++) await Promise.resolve();}

describe('Popup current-page font document ownership', () => {
    it('读取真实来源并仅在确认后切换与还原，不发送翻译或配置消息', async () => {
        const f = pageFontFixture();await f.actions.load();expect(f.state.browserDefault).toBe(false);
        const pending = f.actions.set(true);expect(f.state.busy).toBe(true);expect(f.state.browserDefault).toBe(false);await pending;
        expect(f.state.browserDefault).toBe(true);expect(f.state.busy).toBe(false);
        expect(f.send).toHaveBeenLastCalledWith(7, {type: 'setPageTranslationFont', browserDefault: true, documentToken: 'document-a', pageUrl: f.tab.url});
        await f.actions.set(false);expect(f.state.browserDefault).toBe(false);
        expect(f.send.mock.calls.map(call => call[1].type)).toEqual(['getPageTranslationFontState', 'setPageTranslationFont', 'setPageTranslationFont']);
    });

    it.each([undefined, {id: -1, url: 'https://example.com/'}, {id: 7}, {id: 7, url: 'chrome://settings'}, {id: 7, url: 'extension://popup.html'}])('不支持的来源 %j 禁用动作且不向其他页发送消息', async tab => {
        const f = pageFontFixture();f.getTab.mockResolvedValue(tab);await f.actions.load();
        expect(f.state).toMatchObject({unavailable: true, browserDefault: null, loading: false});
        await f.actions.set(true);expect(f.send).not.toHaveBeenCalled();
    });

    it.each([undefined, {}, {status: 'error'}, {status: 'success'}, {status: 'success', browserDefault: true},
        {status: 'success', browserDefault: true, documentToken: '', pageUrl: 'https://example.com/article'},
        {status: 'success', browserDefault: true, documentToken: 'x'.repeat(129), pageUrl: 'https://example.com/article'},
        {status: 'success', browserDefault: true, documentToken: 'new', pageUrl: ''}])('损坏回复 %j 不显示假选中且允许重新读取', async response => {
        const f = pageFontFixture();f.send.mockResolvedValueOnce(response);await f.actions.load();
        expect(f.state).toMatchObject({browserDefault: null, loading: false, error: 'popup.pageFont.readError'});
        await f.actions.load();expect(f.state.browserDefault).toBe(false);expect(f.state.error).toBe('');
    });

    it('回复页面地址不匹配及来源读取失败均显示明确错误', async () => {
        const f = pageFontFixture();f.send.mockResolvedValueOnce({...f.snapshot, pageUrl: 'https://other.example/'});await f.actions.load();
        expect(f.state.error).toBe('popup.pageFont.readError');
        f.getTab.mockRejectedValueOnce(new Error('tab closed'));await f.actions.load();expect(f.state.error).toBe('popup.pageFont.readError');
    });

    it('读取途中切换标签页只接受重新读取的新页状态', async () => {
        const f = pageFontFixture(), gate = pendingFontReply();f.send.mockReturnValueOnce(gate.promise);
        const pending = f.actions.load();await flushFontTasks();f.tab.id = 8;f.tab.url = 'https://example.net/b';
        f.snapshot.pageUrl = f.tab.url;f.snapshot.documentToken = 'document-b';f.snapshot.browserDefault = true;
        gate.resolve({status: 'success', browserDefault: false, documentToken: 'document-a', pageUrl: 'https://example.com/article'});await pending;
        expect(f.state.browserDefault).toBe(true);expect(f.send.mock.calls.map(call => [call[0], call[1].type])).toEqual([[7, 'getPageTranslationFontState'], [8, 'getPageTranslationFontState']]);
    });

    it.each(['tab', 'url', 'pendingUrl'])('点击后发现 %s 已变只读新状态，不转发旧选择', async kind => {
        const f = pageFontFixture();await f.actions.load();
        if (kind === 'tab') f.tab.id = 8;
        else if (kind === 'url') f.tab.url = 'https://example.net/new';
        else f.tab.pendingUrl = 'https://example.net/new';
        f.snapshot.pageUrl = f.tab.pendingUrl || f.tab.url!;f.snapshot.documentToken = 'new-document';
        await f.actions.set(true);expect(f.state.browserDefault).toBe(false);
        expect(f.send.mock.calls.filter(call => call[1].type === 'setPageTranslationFont')).toHaveLength(0);
    });

    it('写入途中导航后不接受旧成功回复，并读取当前页状态', async () => {
        const f = pageFontFixture();await f.actions.load();const gate = pendingFontReply();f.send.mockReturnValueOnce(gate.promise);
        const pending = f.actions.set(true);await flushFontTasks();f.tab.id = 8;f.tab.url = 'https://example.net/b';
        const old = {...f.snapshot, browserDefault: true};f.snapshot.pageUrl = f.tab.url;f.snapshot.documentToken = 'document-b';
        gate.resolve(old);await pending;expect(f.state.browserDefault).toBe(false);expect(f.send).toHaveBeenLastCalledWith(8, {type: 'getPageTranslationFontState'});
    });

    it.each(['token', 'url', 'value', 'error', 'reject'])('写入 %s 未获确认时清除选择并提供重试，不声称切换成功', async kind => {
        const f = pageFontFixture();await f.actions.load();
        if (kind === 'reject') f.send.mockRejectedValueOnce(new Error('message failed'));
        else f.send.mockResolvedValueOnce(kind === 'error' ? {status: 'error'} : {...f.snapshot, browserDefault: kind !== 'value',
            ...(kind === 'token' ? {documentToken: 'new-document'} : {}), ...(kind === 'url' ? {pageUrl: 'https://other.example'} : {})});
        await f.actions.set(true);expect(f.state).toMatchObject({browserDefault: null, busy: false, error: 'popup.pageFont.changeError'});
        await f.actions.set(true);expect(f.send).toHaveBeenCalledTimes(2);
        f.snapshot.browserDefault = true;await f.actions.load();expect(f.state.browserDefault).toBe(true);
    });

    it('未读取、相同选择、忙碌与失活不发送额外写入', async () => {
        const f = pageFontFixture();await f.actions.set(true);expect(f.send).not.toHaveBeenCalled();
        await f.actions.load();await f.actions.set(false);await f.actions.set('true' as never);expect(f.send).toHaveBeenCalledTimes(1);
        const gate = pendingFontReply();f.send.mockReturnValueOnce(gate.promise);const pending = f.actions.set(true);await flushFontTasks();
        await f.actions.set(false);expect(f.send).toHaveBeenCalledTimes(2);f.deactivate();gate.resolve({...f.snapshot, browserDefault: true});await pending;
        await f.actions.load();await f.actions.set(true);expect(f.send).toHaveBeenCalledTimes(2);expect(f.state.browserDefault).toBeNull();
    });

    it('关闭重开重新读取，前次迟到回复不能覆盖新文档或发出旧写入', async () => {
        const f = pageFontFixture(), gate = pendingFontReply();f.send.mockReturnValueOnce(gate.promise);
        const oldRead = f.actions.load();await flushFontTasks();f.actions.invalidate();f.snapshot.browserDefault = true;f.snapshot.documentToken = 'reopened';
        await f.actions.load();gate.resolve({...f.snapshot, browserDefault: false, documentToken: 'old'});await oldRead;expect(f.state.browserDefault).toBe(true);
        const query = pendingFontReply<PopupActiveTab | undefined>();f.getTab.mockReturnValueOnce(query.promise);const oldWrite = f.actions.set(false);
        f.actions.invalidate();query.resolve(f.tab);await oldWrite;expect(f.send).toHaveBeenCalledTimes(2);expect(f.state.browserDefault).toBeNull();
    });

    it.each(['read-source', 'read-message', 'read-validation', 'write-source', 'write-message', 'write-validation'])('%s 等待结束时再次复验活跃上下文，不消费失活后的回复', async phase => {
        const f = pageFontFixture(), gate = pendingFontReply<any>(), writing = phase.startsWith('write');
        if (writing) await f.actions.load();
        if (phase.endsWith('source')) f.getTab.mockReturnValueOnce(gate.promise);
        else if (phase.endsWith('message')) f.send.mockReturnValueOnce(gate.promise);
        else f.getTab.mockResolvedValueOnce({...f.tab}).mockReturnValueOnce(gate.promise);
        const pending = writing ? f.actions.set(true) : f.actions.load();await flushFontTasks();f.pause();
        gate.resolve(phase.endsWith('message') ? {...f.snapshot, browserDefault: true} : {...f.tab});await pending;
        expect(f.state).toMatchObject({browserDefault: writing ? false : null, loading: false, busy: false, error: ''});
        if (phase === 'write-source') expect(f.send.mock.calls.filter(call => call[1].type === 'setPageTranslationFont')).toHaveLength(0);
    });

    it('读取与切换均有等待上限，超时后的迟到回复不更新选择', async () => {
        vi.useFakeTimers();
        try {
            const f = pageFontFixture(), read = pendingFontReply();f.send.mockReturnValueOnce(read.promise);
            const loading = f.actions.load();await flushFontTasks();await vi.advanceTimersByTimeAsync(10_000);await loading;
            expect(f.state.error).toBe('popup.pageFont.readError');read.resolve(f.snapshot);await flushFontTasks();expect(f.state.browserDefault).toBeNull();
            await f.actions.load();const write = pendingFontReply();f.send.mockReturnValueOnce(write.promise);const changing = f.actions.set(true);
            await flushFontTasks();await vi.advanceTimersByTimeAsync(10_000);await changing;expect(f.state.error).toBe('popup.pageFont.changeError');
            write.resolve({...f.snapshot, browserDefault: true});await flushFontTasks();expect(f.state.browserDefault).toBeNull();expect(vi.getTimerCount()).toBe(0);
        } finally {vi.useRealTimers();}
    });
});
