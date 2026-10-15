/**
 * @file tests/selfHelpNotice.test.ts
 * 文件职责：执行真实诊断提示模板与 popup 控制器，验证故障后用户的可操作性和隐私边界。
 * 主要内容：报告按需预览及明确导出、白名单文案、冷却与忙状态、切换和卸载清理，以及恢复后重试的整段页面归属。
 * 模块边界：自有 Vue renderer 覆盖实际组件事件与生命周期，下载及浏览器消息使用可控端口；真实浏览器下载和视觉验收另行执行。
 */
import {createRequire} from 'node:module';
import {afterEach, describe, expect, it, vi} from 'vitest';
import * as diagnostics from '@/src/services/diagnostics';
import {diagnoseFailure, getDiagnosticSummary, getDiagnosticText, getDiagnosticActionLabel, getDiagnosticUiText} from '@/src/services/diagnostics';
import {createPopupPageActions, type PopupPageState} from '@/src/app/popup/pageActions';
import {Config} from '@/src/core/config/model';
import {compileVueInlineFixture} from './helpers/compiledVueFixture';

const runtime = createRequire(import.meta.url)('vue') as typeof import('vue');
let dispose: (() => void) | undefined;
function loadNotice() {
  const compiled = compileVueInlineFixture('src/features/self-help/ui/DiagnosticNotice.vue', {id: 'self-help-notice'});
  expect(compiled.parseErrors).toEqual([]);
  const dependencies: Record<string, unknown> = {'vue': runtime, '@/src/services/diagnostics': diagnostics};
  const module = {exports: {} as {default: import('vue').Component}};
  // 只复用编译缓存；每次挂载执行同一真实 SFC 源码，诊断依赖也使用生产模块。
  new Function('require', 'exports', 'module', compiled.code)((id: string) => {
    if (!(id in dependencies)) throw new Error(`Unexpected diagnostic fixture dependency: ${id}`);
    return dependencies[id];
  }, module.exports, module);
  return module.exports.default;
}
afterEach(() => {dispose?.();dispose = undefined;vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
interface Host {tag: string; text: string; props: Record<string, any>; children: Host[]; parent: Host | null; focus: ReturnType<typeof vi.fn>}
const node = (tag: string, text = ''): Host => ({tag, text, props: {}, children: [], parent: null, focus: vi.fn()});
function all(root: Host, predicate: (value: Host) => boolean): Host[] {
  return [...(predicate(root) ? [root] : []), ...root.children.flatMap(child => all(child, predicate))];
}
function contents(root: Host): string {return root.text + root.children.map(contents).join('');}
async function settle() {for (let i = 0; i < 6; i++) {await Promise.resolve();await runtime.nextTick();}}
async function mount(diagnostic: unknown, patch: Record<string, unknown> = {}) {
  vi.stubGlobal('navigator', {onLine: true});
  const component = loadNotice();
  const props = runtime.shallowReactive({diagnostic, language: 'zh-CN', busy: false, feature: 'popup', version: '0.0.38', ...patch});
  const emitted = vi.fn();
  const remove = (value: Host) => {if (value.parent) value.parent.children.splice(value.parent.children.indexOf(value), 1);value.parent = null;};
  const renderer = runtime.createRenderer<Host, Host>({
    patchProp(value, key, _old, next) {value.props[key] = next;},
    insert(value, parent, anchor) {remove(value);const at = anchor ? parent.children.indexOf(anchor) : -1;parent.children.splice(at < 0 ? parent.children.length : at, 0, value);value.parent = parent;},
    remove, createElement: tag => node(tag), createText: text => node('#text', text), createComment: text => node('#comment', text),
    setText(value, text) {value.text = text;}, setElementText(value, text) {value.text = text;value.children = [];},
    parentNode: value => value.parent, nextSibling: value => value.parent?.children[value.parent.children.indexOf(value) + 1] ?? null,
    setScopeId() {}, insertStaticContent(content, parent, anchor) {const value = node('#static', content);const at = anchor ? parent.children.indexOf(anchor) : -1;parent.children.splice(at < 0 ? parent.children.length : at, 0, value);value.parent = parent;return [value, value];},
  });
  let instance: any;
  const app = renderer.createApp({setup: () => () => runtime.h(component, {...props, onAction: emitted, ref: (value: any) => {if (value) instance = value;}})});
  const root = node('root');app.mount(root);dispose = () => app.unmount();await settle();
  expect(instance.$.render).toBeTypeOf('function');
  const buttons = () => all(root, value => value.tag === 'button');
  const button = (label: string) => {const result = buttons().find(value => contents(value).startsWith(label) || value.props['aria-label'] === label);expect(result).toBeDefined();return result!;};
  const click = async (label: string) => {const target = button(label);if (!target.props.disabled) target.props.onClick();await settle();};
  return {root, props, emitted, button, click};
}

describe('actual self help notice', () => {
  it('keeps the popup compact until the user requests details, and Escape clears the preview without dismissing the error', async () => {
    const diagnostic = diagnoseFailure({kind: 'authentication'}), f = await mount(diagnostic);
    expect(contents(f.root)).toContain(getDiagnosticSummary(diagnostic));
    expect(contents(f.root)).not.toContain(getDiagnosticText(diagnostic).detail);
    expect(contents(f.root)).not.toMatch(/预览诊断|导出 JSON|重试/);
    expect(all(f.root, value => value.tag === 'button')).toHaveLength(3);
    expect(f.button('检查服务').props.disabled).toBe(false);
    await f.click('检查服务');expect(f.emitted).toHaveBeenLastCalledWith('services');
    expect(f.button('查看详情').props['aria-expanded']).toBe(false);
    await f.click('查看详情');expect(contents(f.root)).toContain(getDiagnosticText(diagnostic).detail);
    expect(all(f.root, value => value.props.id === f.button('查看详情').props['aria-controls'])).toHaveLength(1);
    await f.click('预览诊断');expect(all(f.root, value => value.tag === 'pre')).toHaveLength(1);
    const event = {key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn()};
    all(f.root, value => value.tag === 'section')[0].props.onKeydown(event);await settle();
    expect(event.preventDefault).toHaveBeenCalledOnce();expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(f.button('查看详情').focus).toHaveBeenCalledOnce();
    expect(f.button('查看详情').props['aria-expanded']).toBe(false);
    expect(all(f.root, value => value.tag === 'pre')).toHaveLength(0);
    expect(contents(f.root)).not.toContain(getDiagnosticText(diagnostic).detail);
    await f.click('查看详情');expect(all(f.root, value => value.tag === 'pre')).toHaveLength(0);
    await f.click('关闭');expect(f.emitted).toHaveBeenLastCalledWith('dismiss');
  });

  it('places website scope repair first when completed discovery found no content, keeping retry available in details', async () => {
    const f = await mount({code: 'no-content'});
    expect(f.button('检查范围').props['data-diagnostic-action']).toBe('site-settings');
    await f.click('检查范围');expect(f.emitted).toHaveBeenLastCalledWith('site-settings');
    expect(contents(f.root)).not.toContain('重试');
    await f.click('查看详情');await f.click('重试');expect(f.emitted).toHaveBeenLastCalledWith('retry');
  });

  it('keeps a closed-source diagnostic dismissible without offering a dead-page operation', async () => {
    const f = await mount({code: 'source-closed'});
    expect(all(f.root, value => value.tag === 'button')).toHaveLength(2);
    expect(contents(f.root)).not.toMatch(/重试|刷新|检查服务/);
    await f.click('查看详情');expect(contents(f.root)).toContain('请重新打开');
    await f.click('查看详情');expect(contents(f.root)).not.toContain('请重新打开');
    await f.click('关闭');expect(f.emitted).toHaveBeenCalledWith('dismiss');
  });

  it('shows safe fixed recovery text and generates no report or download before explicit actions', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const anchor = {href: '', download: '', click: vi.fn()};
    const createElement = vi.fn(() => anchor);vi.stubGlobal('document', {createElement});
    const f = await mount({...diagnoseFailure({kind: 'authentication'}), message: 'PRIVATE body', actions: ['export'], titleKey: '<script>PRIVATE</script>'});
    expect(contents(f.root)).toContain('服务验证失败');
    expect(contents(f.root)).not.toMatch(/PRIVATE|script|导出 JSON/);
    expect(create).not.toHaveBeenCalled();expect(createElement).not.toHaveBeenCalled();
    await f.click('查看详情');await f.click('预览诊断');
    const pre = all(f.root, value => value.tag === 'pre')[0];
    expect(pre.props.tabindex).toBe('0');
    expect(JSON.parse(contents(pre))).toEqual({schemaVersion: 1, diagnostic: {code: 'authentication'}, feature: 'popup', extensionVersion: '0.0.38', online: true});
    expect(create).not.toHaveBeenCalled();
    await f.click('导出 JSON');
    expect(create).toHaveBeenCalledOnce();expect(anchor.download).toBe('fluentread-diagnostic.json');expect(anchor.click).toHaveBeenCalledOnce();
    await settle();
    // 下载资源在组件生命周期结束后也必须被回收；允许浏览器先消费 blob URL。
    dispose?.();dispose = undefined;
    expect(revoke).toHaveBeenCalledWith('blob:fixture');
  });

  it('clears report previews and unsafe input on diagnosis changes, and recovers from export failure', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {throw new Error('download denied');});
    const f = await mount(diagnoseFailure({kind: 'timeout'}));
    await f.click('查看详情');await f.click('预览诊断');await f.click('导出 JSON');
    expect(contents(f.root)).toContain('导出失败');
    f.props.diagnostic = diagnoseFailure({kind: 'authentication'});await settle();
    expect(all(f.root, value => value.tag === 'pre')).toHaveLength(0);
    expect(f.button('查看详情').props['aria-expanded']).toBe(false);
    expect(contents(f.root)).not.toContain('导出失败');
    await f.click('查看详情');await f.click('预览诊断');await f.click('预览诊断');
    expect(all(f.root, value => value.tag === 'pre')).toHaveLength(0);
    f.props.diagnostic = {code: 'PRIVATE', message: 'private body'};await settle();
    expect(all(f.root, value => value.tag === 'section')).toHaveLength(0);
  });

  it('clears an old export failure after a successful retry or when reopening the preview', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementationOnce(() => {throw new Error('blocked');}).mockReturnValue('blob:retry');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal('document', {createElement: () => ({href: '', download: '', click() {}})});
    const f = await mount(diagnoseFailure({kind: 'timeout'}));
    await f.click('查看详情');await f.click('预览诊断');await f.click('导出 JSON');expect(contents(f.root)).toContain('导出失败');
    await f.click('导出 JSON');expect(create).toHaveBeenCalledTimes(2);expect(contents(f.root)).not.toContain('导出失败');
    create.mockImplementationOnce(() => {throw new Error('blocked again');});
    await f.click('导出 JSON');expect(contents(f.root)).toContain('导出失败');
    await f.click('预览诊断');await f.click('预览诊断');expect(contents(f.root)).not.toContain('导出失败');
  });

  it('waits for rate-limit cooldown, accepts updated remaining time, and clears timers on unmount', async () => {
    vi.useFakeTimers();vi.setSystemTime(100_000);
    const f = await mount(diagnoseFailure({kind: 'rate-limit', retryAfterMs: 5000}));
    await f.click('查看详情');
    expect(f.button('重试').props.disabled).toBe(true);
    await f.click('重试');expect(f.emitted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);await settle();
    expect(contents(f.button('重试'))).toContain('3s');
    f.props.diagnostic = diagnoseFailure({kind: 'rate-limit', retryAfterMs: 3000});await settle();
    await f.click('查看详情');
    await vi.advanceTimersByTimeAsync(3000);await settle();
    expect(f.button('重试').props.disabled).toBe(false);
    await f.click('重试');expect(f.emitted).toHaveBeenCalledWith('retry');
    expect(vi.getTimerCount()).toBe(0);
    f.props.diagnostic = diagnoseFailure({kind: 'rate-limit', retryAfterMs: 5000});await settle();expect(vi.getTimerCount()).toBe(1);
    dispose?.();dispose = undefined;expect(vi.getTimerCount()).toBe(0);
  });

  it('disables operational actions while busy and uses the same safe English text as its parent', async () => {
    const f = await mount(diagnoseFailure({kind: 'timeout'}), {language: 'en', busy: true});
    expect(contents(f.root)).toContain(getDiagnosticSummary({code: 'timeout'}, 'en'));
    await f.click(getDiagnosticUiText('details', 'en'));
    for (const label of ['Retry', 'Check translation service', 'Dismiss']) {
      expect(f.button(label).props.disabled).toBe(true);await f.click(label);
    }
    expect(f.emitted).not.toHaveBeenCalled();
    f.props.busy = false;await settle();await f.click('Check translation service');
    expect(f.emitted).toHaveBeenCalledWith('services');
  });

  it.each(['authentication', 'model-configuration', 'configuration'] as const)('offers user-triggered retry after repairing %s and keeps it disabled while busy', async code => {
    const f = await mount({code}, {busy: true});
    await f.click('查看详情');
    expect(f.button('重试').props.disabled).toBe(true);await f.click('重试');expect(f.emitted).not.toHaveBeenCalled();
    f.props.busy = false;await settle();await f.click('重试');expect(f.emitted).toHaveBeenCalledOnce();expect(f.emitted).toHaveBeenCalledWith('retry');
  });

  it('switches actual recovery, report preview and export failure copy across all seven locales without losing the preview', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {throw new Error('PRIVATE export failure');});
    const diagnostic = diagnoseFailure({kind: 'timeout'}), f = await mount(diagnostic);
    await f.click('查看详情');await f.click(getDiagnosticUiText('preview', 'zh-CN'));
    const preview = all(f.root, value => value.tag === 'pre')[0], report = contents(preview);
    for (const locale of ['zh-CN', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES', 'pt-BR']) {
      f.props.language = locale;await settle();
      expect(contents(f.root)).toContain(getDiagnosticSummary(diagnostic, locale));
      expect(contents(f.root)).toContain(getDiagnosticText(diagnostic, locale).detail);
      expect(f.button(getDiagnosticActionLabel('retry', locale))).toBeDefined();
      expect(f.button(getDiagnosticUiText('preview', locale)).props['aria-expanded']).toBe(true);
      expect(contents(f.root)).toContain(getDiagnosticUiText('privacy', locale));
      expect(preview.props['aria-label']).toBe(getDiagnosticUiText('report', locale));
      expect(all(f.root, value => value.tag === 'pre')[0]).toBe(preview);expect(contents(preview)).toBe(report);
      await f.click(getDiagnosticUiText('export', locale));
      expect(contents(f.root)).toContain(getDiagnosticUiText('exportFailed', locale));
      expect(contents(f.root)).not.toContain('PRIVATE');
    }
  });
});

describe('retry transaction ownership', () => {
  function fixture(warning = '') {
    const cfg = new Config();cfg.on = true;cfg.disabledExtensionDomains = [];
    const state: PopupPageState = {tabId: 7, url: 'https://example.com/old', domain: 'example.com', translated: true, busy: false, savingRule: false};
    const getTab = vi.fn(async () => ({id: 7, url: 'https://example.com/old'}));
    const documentToken = 'fixture-document-a';
    const send = vi.fn(async (_id: number, message: {type: string; action?: string}): Promise<unknown> => ({status: 'success', isTranslated: message.action === 'fullPage', documentToken}));
    const status = vi.fn(), failure = vi.fn(), notice = vi.fn();let active = true;
    const actions = createPopupPageActions({state, config: () => cfg, active: () => active, warning: () => warning, getTab, send, persistRule: async () => undefined, notice, close: vi.fn(), translate: key => key, onStatus: status, onFailure: failure, thunderbird: false});
    return {cfg, state, actions, getTab, send, status, failure, notice, documentToken, setActive: (value: boolean) => {active = value;}};
  }
  it('restores and retranslates the same document when ownership remains current', async () => {
    const f = fixture();await f.actions.retry();
    expect(f.send.mock.calls.map(call => call[1].action)).toEqual(['restore', 'fullPage']);
    expect(f.state.translated).toBe(true);
  });
  it.each(['inactive', 'busy', 'saving-rule'] as const)('does not restore or resend a failed translation while the popup is %s', async reason => {
    const f = fixture();
    if (reason === 'inactive') f.setActive(false);
    if (reason === 'busy') f.state.busy = true;
    if (reason === 'saving-rule') f.state.savingRule = true;
    await f.actions.retry();
    expect(f.getTab).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.failure).not.toHaveBeenCalled();
    expect(f.state.translated).toBe(true);expect(f.state.busy).toBe(reason === 'busy');expect(f.state.savingRule).toBe(reason === 'saving-rule');
    f.setActive(true);f.state.busy = false;f.state.savingRule = false;
    await f.actions.retry();
    expect(f.send.mock.calls.map(call => call[1].action)).toEqual(['restore', 'fullPage']);expect(f.state.translated).toBe(true);
  });
  it('does not transfer a pending retry to a newly hydrated document', async () => {
    const f = fixture();let complete!: (value: unknown) => void;
    f.send.mockReturnValueOnce(new Promise(resolve => {complete = resolve;}));
    const pending = f.actions.retry();await settle();
    f.getTab.mockResolvedValue({id: 8, url: 'https://example.net/new'});
    await f.actions.hydrate();complete({status: 'success', isTranslated: false});await pending;
    expect(f.send.mock.calls.filter(call => call[1].type === 'contextMenuTranslate').map(call => [call[0], call[1].action])).toEqual([[7, 'restore']]);
    expect(f.state.tabId).toBe(8);expect(f.state.translated).toBe(false);
  });
  it('does not resume a retry after configuration invalidation during restore', async () => {
    const f = fixture();let complete!: (value: unknown) => void;
    f.send.mockReturnValueOnce(new Promise(resolve => {complete = resolve;}));
    const pending = f.actions.retry();await settle();
    f.actions.invalidate();f.state.translated = false;
    complete({status: 'success', isTranslated: false});await pending;
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('does not let an old hydrate response overwrite a newer real page result', async () => {
    const f = fixture();let complete!: (value: unknown) => void;
    f.send.mockReturnValueOnce(new Promise(resolve => {complete = resolve;}));
    const pending = f.actions.hydrate();await settle();
    // 新命令回执先绑定文档令牌，此后才接受该文档的实时完成消息。
    await f.actions.toggle();f.status.mockClear();
    const result = {isTranslated: true, toolbarStatus: 'translated', documentToken: f.documentToken};
    f.actions.receiveStatus(7, 'https://example.com/old', result);
    complete({status: 'success', isTranslated: false, toolbarStatus: 'idle'});await pending;
    expect(f.state.translated).toBe(true);expect(f.status).toHaveBeenLastCalledWith(result);
  });

  it.each(['translated', 'error'] as const)('keeps the latest %s result received while the full-page command acknowledgement is pending', async toolbarStatus => {
    const f = fixture();await f.actions.hydrate();f.status.mockClear();f.state.translated = false;let complete!: (value: unknown) => void;
    f.send.mockReturnValueOnce(new Promise(resolve => {complete = resolve;}));
    const pending = f.actions.toggle();await settle();expect(f.state.busy).toBe(true);
    const result = {isTranslated: true, toolbarStatus, documentToken: f.documentToken,
      ...(toolbarStatus === 'error' ? {diagnostic: diagnoseFailure({kind: 'authentication'})} : {})};
    f.actions.receiveStatus(7, 'https://example.com/old', result);
    expect(f.state.busy).toBe(true);expect(f.status).toHaveBeenLastCalledWith(result);
    complete({status: 'success', isTranslated: true, toolbarStatus: 'translating'});await pending;
    expect(f.state.translated).toBe(true);expect(f.state.busy).toBe(false);
    expect(f.status).toHaveBeenCalledOnce();expect(f.status).toHaveBeenLastCalledWith(result);expect(f.failure).not.toHaveBeenCalled();
  });

  it('does not replace a newer real completion with a late command transport rejection', async () => {
    const f = fixture();await f.actions.hydrate();f.status.mockClear();f.state.translated = false;let reject!: (reason: unknown) => void;
    f.send.mockReturnValueOnce(new Promise((_resolve, no) => {reject = no;}));
    const pending = f.actions.toggle();await settle();
    const result = {isTranslated: true, toolbarStatus: 'translated', documentToken: f.documentToken};
    f.actions.receiveStatus(7, 'https://example.com/old', result);
    reject(new Error('Failed to fetch an obsolete command receipt'));await pending;
    expect(f.state.translated).toBe(true);expect(f.state.busy).toBe(false);
    expect(f.status).toHaveBeenLastCalledWith(result);expect(f.failure).not.toHaveBeenCalled();
  });

  it('ignores results from a previous tab or document after navigation', async () => {
    const f = fixture();f.getTab.mockResolvedValue({id: 8, url: 'https://example.net/new'});await f.actions.hydrate();f.status.mockClear();
    f.actions.receiveStatus(7, 'https://example.com/old', {isTranslated: true, documentToken: f.documentToken});
    f.actions.receiveStatus(8, 'https://example.net/previous', {isTranslated: true, documentToken: f.documentToken});
    expect(f.state.translated).toBe(false);expect(f.status).not.toHaveBeenCalled();
    f.actions.receiveStatus(8, 'https://example.net/new', {isTranslated: true, documentToken: f.documentToken});
    expect(f.state.translated).toBe(true);expect(f.status).toHaveBeenCalledOnce();
  });

  it('rejects an older document token even when tab and URL are unchanged', async () => {
    const f = fixture();await f.actions.hydrate();f.status.mockClear();
    f.actions.receiveStatus(7, f.state.url, {isTranslated: true, documentToken: 'old-document-at-same-url'});
    expect(f.state.translated).toBe(false);expect(f.status).not.toHaveBeenCalled();
    f.actions.receiveStatus(7, f.state.url, {isTranslated: true, documentToken: f.documentToken});
    expect(f.state.translated).toBe(true);expect(f.status).toHaveBeenCalledOnce();
  });

  it('requires a new query token after reload and rejects both old broadcasts and old delayed queries', async () => {
    const f = fixture();await f.actions.hydrate();f.status.mockClear();let complete!: (value: unknown) => void;
    f.send.mockReturnValueOnce(new Promise(resolve => {complete = resolve;}));
    const oldQuery = f.actions.hydrate();await settle();
    f.actions.receiveStatus(7, f.state.url, {isTranslated: true, documentToken: f.documentToken});
    expect(f.state.translated).toBe(false);expect(f.status.mock.calls).toEqual([[undefined]]);
    f.actions.receiveStatus(7, f.state.url, {isTranslated: true});
    expect(f.state.translated).toBe(false);expect(f.status.mock.calls).toEqual([[undefined]]);
    f.send.mockResolvedValueOnce({status: 'success', isTranslated: false, documentToken: 'refreshed-document-b'});
    await f.actions.hydrate();f.status.mockClear();
    complete({status: 'success', isTranslated: true, documentToken: f.documentToken});await oldQuery;
    f.actions.receiveStatus(7, f.state.url, {isTranslated: true, documentToken: f.documentToken});
    expect(f.state.translated).toBe(false);expect(f.status).not.toHaveBeenCalled();
    const fresh = {isTranslated: true, documentToken: 'refreshed-document-b', toolbarStatus: 'translated'};
    f.actions.receiveStatus(7, f.state.url, fresh);
    expect(f.state.translated).toBe(true);expect(f.status).toHaveBeenLastCalledWith(fresh);
  });

  it.each(['off', 'disabled'] as const)('does not accept live results while the extension is %s', async reason => {
    const f = fixture();await f.actions.hydrate();f.status.mockClear();
    if (reason === 'off') f.cfg.on = false;else f.cfg.disabledExtensionDomains = ['example.com'];
    const result = {isTranslated: true, documentToken: f.documentToken, toolbarStatus: 'error', diagnostic: diagnoseFailure({kind: 'authentication'})};
    f.actions.receiveStatus(7, f.state.url, result);
    expect(f.state.translated).toBe(false);expect(f.status).not.toHaveBeenCalled();
    f.cfg.on = true;f.cfg.disabledExtensionDomains = [];
    f.actions.receiveStatus(7, f.state.url, result);
    expect(f.state.translated).toBe(true);expect(f.status).toHaveBeenCalledWith(result);
  });

  it.each(['authentication', 'model-configuration'] as const)('preserves %s diagnostics from a failed command receipt', async code => {
    const f = fixture();f.state.translated = false;
    f.send.mockResolvedValueOnce({status: 'failed', isTranslated: false,
      diagnostic: {code, titleKey: 'PRIVATE text', actions: ['export'], message: 'PRIVATE response'}});
    await f.actions.toggle();
    expect(f.state.translated).toBe(false);expect(f.state.busy).toBe(false);
    expect(f.failure).toHaveBeenCalledOnce();
    const diagnostic = f.failure.mock.calls[0][0];
    expect(diagnostic.code).toBe(code);expect(diagnostic.actions).toEqual(['services', 'retry', 'dismiss']);
    expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE');
  });

  it('blocks requests on an incomplete configuration and still lets the user restore original text', async () => {
    const f = fixture('当前服务尚未完成配置');f.state.translated = false;const service = f.cfg.service;
    await f.actions.toggle();
    expect(f.send).not.toHaveBeenCalled();expect(f.state.busy).toBe(false);expect(f.cfg.service).toBe(service);
    expect(f.failure).toHaveBeenCalledWith(diagnoseFailure(undefined, {reason: 'configuration'}));
    expect(getDiagnosticText(f.failure.mock.calls[0][0]).title).toBe('当前服务配置需要检查');
    expect(f.notice).toHaveBeenCalledWith('当前服务尚未完成配置', 'error');
    f.state.translated = true;await f.actions.toggle();
    expect(f.send).toHaveBeenCalledWith(7, {type: 'contextMenuTranslate', action: 'restore'});expect(f.state.translated).toBe(false);
    expect(f.failure).toHaveBeenCalledOnce();
  });

  it('classifies a restricted browser page failure without attempting a provider recovery', async () => {
    const f = fixture();f.state.translated = false;f.state.url = 'chrome://extensions';
    f.getTab.mockResolvedValue({id: 7, url: f.state.url});f.send.mockRejectedValueOnce(new Error('PRIVATE browser access denied'));
    vi.stubGlobal('navigator', {onLine: true});await f.actions.toggle();
    expect(f.state.busy).toBe(false);expect(f.failure).toHaveBeenCalledWith(diagnoseFailure(undefined, {reason: 'unsupported-page'}));
    expect(f.failure.mock.calls[0][0].actions).toEqual(['dismiss']);expect(JSON.stringify(f.failure.mock.calls)).not.toContain('PRIVATE');
  });

  it('keeps network recovery available when a platform adapter does not expose navigator', async () => {
    const f = fixture();f.state.translated = false;vi.stubGlobal('navigator', undefined);
    f.send.mockRejectedValueOnce(new Error('Failed to fetch PRIVATE data'));await f.actions.toggle();
    expect(f.state.busy).toBe(false);expect(f.failure).toHaveBeenCalledWith(diagnoseFailure({kind: 'network'}));
    expect(JSON.stringify(f.failure.mock.calls)).not.toContain('PRIVATE');
  });

  it('releases the pending operation and provides safe recovery when the original tab query fails', async () => {
    const f = fixture();f.state.translated = false;
    f.getTab.mockRejectedValueOnce(new Error('PRIVATE tab is gone'));await f.actions.toggle();
    expect(f.send).not.toHaveBeenCalled();expect(f.state.busy).toBe(false);expect(f.failure).toHaveBeenCalledWith(diagnoseFailure(undefined));
    expect(JSON.stringify(f.failure.mock.calls)).not.toContain('PRIVATE');
  });

  it.each(['missing', 'old'] as const)('uses a read-only handshake when the completed navigation query left a %s document identity', async identity => {
    const f = fixture();
    if (identity === 'missing') f.send.mockRejectedValueOnce(new Error('Receiving end does not exist'));
    await f.actions.hydrate();f.status.mockClear();f.send.mockClear();
    const authoritative = {status: 'success', isTranslated: true, toolbarStatus: 'translated', documentToken: 'new-document'};
    f.send.mockResolvedValueOnce(authoritative);
    f.actions.receiveStatus(7, f.state.url, {isTranslated: false, toolbarStatus: 'error', documentToken: 'new-document'});
    expect(f.state.translated).toBe(false);expect(f.status).not.toHaveBeenCalled();
    await settle();expect(f.state.translated).toBe(true);expect(f.status).toHaveBeenLastCalledWith(authoritative);
    expect(f.send.mock.calls.map(call => call[1])).toEqual([{type: 'getFullPageTranslationState'}]);expect(f.state.busy).toBe(false);
  });

  it('reads the actual current document rather than adopting an obsolete broadcast token or payload', async () => {
    const f = fixture();await f.actions.hydrate();f.status.mockClear();
    const current = {status: 'success', isTranslated: false, toolbarStatus: 'idle', documentToken: 'current-document-c'};
    f.send.mockResolvedValueOnce(current);
    f.actions.receiveStatus(7, f.state.url, {isTranslated: true, toolbarStatus: 'translated', documentToken: 'obsolete-document-b'});
    await settle();expect(f.state.translated).toBe(false);expect(f.status).toHaveBeenLastCalledWith(current);
    f.actions.receiveStatus(7, f.state.url, {isTranslated: true, documentToken: 'current-document-c'});
    expect(f.state.translated).toBe(true);
  });

  it('coalesces a final broadcast arriving before an older handshake snapshot and then consumes matching live results', async () => {
    const f = fixture();await f.actions.hydrate();f.send.mockClear();f.status.mockClear();let complete!: (value: unknown) => void;
    f.send.mockReturnValueOnce(new Promise(resolve => {complete = resolve;}));
    f.actions.receiveStatus(7, f.state.url, {isTranslated: true, toolbarStatus: 'translating', documentToken: 'new-document'});await settle();
    for (let i = 0; i < 10; i++) f.actions.receiveStatus(7, f.state.url, {isTranslated: true, toolbarStatus: 'translated', documentToken: 'new-document'});
    const final = {status: 'success', isTranslated: true, toolbarStatus: 'translated', documentToken: 'new-document'};
    f.send.mockResolvedValueOnce(final);complete({...final, toolbarStatus: 'translating'});await settle();
    expect(f.send).toHaveBeenCalledTimes(2);expect(f.status).toHaveBeenLastCalledWith(final);
    for (let i = 0; i < 10; i++) f.actions.receiveStatus(7, f.state.url, {isTranslated: true, toolbarStatus: 'translated', documentToken: 'new-document'});
    await settle();expect(f.send).toHaveBeenCalledTimes(2);
  });

  it('does not lose a second new document that becomes ready during the trailing read', async () => {
    const f = fixture();await f.actions.hydrate();f.send.mockClear();let first!: (value: unknown) => void, tail!: (value: unknown) => void;
    f.send.mockReturnValueOnce(new Promise(resolve => {first = resolve;})).mockReturnValueOnce(new Promise(resolve => {tail = resolve;}));
    f.actions.receiveStatus(7, f.state.url, {isTranslated: true, toolbarStatus: 'translating', documentToken: 'document-b'});await settle();
    f.actions.receiveStatus(7, f.state.url, {isTranslated: true, toolbarStatus: 'translated', documentToken: 'document-b'});
    first({status: 'success', isTranslated: true, toolbarStatus: 'translating', documentToken: 'document-b'});await settle();
    f.actions.receiveStatus(7, f.state.url, {isTranslated: true, toolbarStatus: 'translating', documentToken: 'document-c'});
    f.actions.receiveStatus(7, f.state.url, {isTranslated: true, toolbarStatus: 'translated', documentToken: 'document-c'});
    const final = {status: 'success', isTranslated: true, toolbarStatus: 'translated', documentToken: 'document-c'};
    f.send.mockResolvedValueOnce(final);tail({status: 'success', isTranslated: true, toolbarStatus: 'translating', documentToken: 'document-b'});await settle();
    expect(f.send).toHaveBeenCalledTimes(3);expect(f.status).toHaveBeenLastCalledWith(final);
  });

  it('deduplicates repeated failed handshake hints without scheduling timers or provider retries', async () => {
    const f = fixture();await f.actions.hydrate();f.send.mockClear();f.status.mockClear();
    f.send.mockRejectedValueOnce(new Error('Receiving end does not exist'));
    const hint = {isTranslated: false, toolbarStatus: 'unrecognized-phase', documentToken: 'not-ready'};
    f.actions.receiveStatus(7, f.state.url, hint);await settle();
    for (let i = 0; i < 10; i++) {f.actions.receiveStatus(7, f.state.url, hint);await settle();}
    expect(f.send).toHaveBeenCalledTimes(1);expect(f.status).not.toHaveBeenCalled();
    f.send.mockResolvedValueOnce({status: 'success', isTranslated: true, toolbarStatus: 'translated', documentToken: 'not-ready'});
    f.actions.receiveStatus(7, f.state.url, {...hint, toolbarStatus: 'translated', isTranslated: true});await settle();
    expect(f.send).toHaveBeenCalledTimes(2);expect(f.state.translated).toBe(true);
  });

  it('preserves busy and a newer command acknowledgement over an older read handshake', async () => {
    const f = fixture();await f.actions.hydrate();f.status.mockClear();let command!: (value: unknown) => void, probe!: (value: unknown) => void;
    f.send.mockReturnValueOnce(new Promise(resolve => {command = resolve;}));
    const pending = f.actions.toggle();await settle();expect(f.state.busy).toBe(true);
    f.send.mockReturnValueOnce(new Promise(resolve => {probe = resolve;}));
    f.actions.receiveStatus(7, f.state.url, {isTranslated: true, documentToken: 'new-document'});await settle();expect(f.state.busy).toBe(true);
    const acknowledged = {status: 'success', isTranslated: true, toolbarStatus: 'translated', documentToken: 'new-document'};
    command(acknowledged);await pending;
    probe({status: 'success', isTranslated: false, toolbarStatus: 'idle', documentToken: 'old-document'});await settle();
    expect(f.state.translated).toBe(true);expect(f.status).toHaveBeenLastCalledWith(acknowledged);
  });

  it('lets an authoritative handshake invalidate an older command acknowledgement without releasing its busy lock early', async () => {
    const f = fixture();await f.actions.hydrate();f.state.translated = false;let command!: (value: unknown) => void;
    f.send.mockReturnValueOnce(new Promise(resolve => {command = resolve;}));const pending = f.actions.toggle();await settle();
    const current = {status: 'success', isTranslated: true, toolbarStatus: 'translated', documentToken: 'new-document'};
    f.send.mockResolvedValueOnce(current);f.actions.receiveStatus(7, f.state.url, {isTranslated: true, documentToken: 'new-document'});await settle();
    expect(f.state.busy).toBe(true);expect(f.status).toHaveBeenLastCalledWith(current);
    command({status: 'success', isTranslated: true, toolbarStatus: 'translating', documentToken: f.documentToken});await pending;
    expect(f.state.busy).toBe(false);expect(f.status).toHaveBeenLastCalledWith(current);
  });

  it.each(['inactive', 'invalidate', 'tab', 'url', 'off', 'disabled', 'saving'] as const)('discards pending handshake replies after %s changes ownership', async reason => {
    const f = fixture();await f.actions.hydrate();f.status.mockClear();let complete!: (value: unknown) => void;
    f.send.mockReturnValueOnce(new Promise(resolve => {complete = resolve;}));
    f.actions.receiveStatus(7, f.state.url, {isTranslated: true, documentToken: 'unknown-document'});await settle();
    f.actions.receiveStatus(7, f.state.url, {isTranslated: true, toolbarStatus: 'translated', documentToken: 'unknown-document'});
    if (reason === 'inactive') f.setActive(false);if (reason === 'invalidate') f.actions.invalidate();
    if (reason === 'tab') f.state.tabId = 8;if (reason === 'url') f.state.url = 'https://example.net/new';
    if (reason === 'off') f.cfg.on = false;if (reason === 'disabled') f.cfg.disabledExtensionDomains = ['example.com'];if (reason === 'saving') f.state.savingRule = true;
    complete({status: 'success', isTranslated: true, documentToken: 'unknown-document'});await settle();
    expect(f.state.translated).toBe(false);expect(f.status).not.toHaveBeenCalled();
  });

  it.each(['invalid-id', 'missing-tab', 'empty-url', 'changed-tab', 'changed-url', 'lost-owner', 'query-rejected'] as const)('does not send a handshake into a %s source', async reason => {
    const f = fixture();await f.actions.hydrate();f.send.mockClear();f.status.mockClear();
    if (reason === 'invalid-id') f.state.tabId = -1;
    if (reason === 'missing-tab') f.getTab.mockResolvedValueOnce(undefined as any);
    if (reason === 'empty-url') f.getTab.mockResolvedValueOnce({id: 7, url: ''});
    if (reason === 'changed-tab') f.getTab.mockResolvedValueOnce({id: 8, url: f.state.url});
    if (reason === 'changed-url') f.getTab.mockResolvedValueOnce({id: 7, url: 'https://example.net/new'});
    if (reason === 'query-rejected') f.getTab.mockRejectedValueOnce(new Error('source unavailable'));
    let finish!: (value: {id: number; url: string}) => void;
    if (reason === 'lost-owner') f.getTab.mockReturnValueOnce(new Promise(resolve => {finish = resolve;}));
    f.actions.receiveStatus(f.state.tabId!, f.state.url, {isTranslated: true, documentToken: 'unknown-document'});
    if (reason === 'lost-owner') {f.setActive(false);finish({id: 7, url: f.state.url});}
    await settle();expect(f.send).not.toHaveBeenCalled();expect(f.status).not.toHaveBeenCalled();
  });

  it.each([undefined, {status: 'failed'}, {status: 'success'}, {status: 'success', documentToken: ''}, {status: 'success', documentToken: 123}])('rejects malformed read-handshake response %j', async snapshot => {
    const f = fixture();await f.actions.hydrate();f.status.mockClear();f.send.mockResolvedValueOnce(snapshot);
    f.actions.receiveStatus(7, f.state.url, {isTranslated: true, documentToken: 'unknown-document'});await settle();
    expect(f.state.translated).toBe(false);expect(f.status).not.toHaveBeenCalled();
  });

  it('still reports a failed command acknowledgement that has no structured diagnosis', async () => {
    const f = fixture();f.state.translated = false;f.send.mockResolvedValueOnce({status: 'failed', documentToken: f.documentToken});
    await f.actions.toggle();expect(f.failure).toHaveBeenCalledWith(diagnoseFailure(undefined));expect(f.notice).toHaveBeenCalled();expect(f.state.busy).toBe(false);
  });
});
