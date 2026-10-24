/**
 * @file tests/zoteroWorkspace.test.ts
 * 文件职责：在 Linkedom 中执行真实 Vue Zotero 工作台，验证设置、队列和选区笔记的用户流程。
 * 主要内容：只替换 PDF/网络引擎与 Zotero 文件端口；覆盖先保存再翻译、安全文本渲染、重复点击、选区交接和卸载取消。
 * 模块边界：不启动 Zotero、不联网、不写入实际文献库，不把 DOM 测试当作原生客户端验收。
 */
import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {defaultSettings} from '../integrations/zotero/settings';
import type {AttachmentSource, TranslationSettings, ZoteroEngine, ZoteroHost} from '../integrations/zotero/contracts';

const fixture = vi.hoisted(() => ({engine: undefined as ZoteroEngine | undefined}));
vi.mock('../integrations/zotero/engine', () => ({createZoteroEngine: () => fixture.engine}));

let win: any;
let doc: Document;
let host: ZoteroHost;
let runtime: typeof import('vue');
const source = (): AttachmentSource => ({id: 12, libraryID: 1, key: 'PDFKEY', title: 'Paper',
    fileName: 'paper.pdf', bytes: new Uint8Array([1, 2]), fingerprint: 'hash-a',
    sourceURI: 'zotero://open-pdf/library/items/PDFKEY'});
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
}
async function settle() {
    for (let index = 0; index < 8; index++) {await Promise.resolve(); await runtime.nextTick();}
}
const namedButton = (text: string): HTMLButtonElement => {
    const result = Array.from(doc.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === text);
    expect(result, `button ${text}`).toBeDefined(); return result!;
};
function click(button: HTMLButtonElement) {button.dispatchEvent(new win.Event('click', {bubbles: true}));}
async function select(label: string, value: string) {
    const element = doc.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    expect(element, label).not.toBeNull(); element.value = value;
    element.dispatchEvent(new win.Event('change', {bubbles: true})); await settle();
}
function input(label: string, value: string) {
    const element = Array.from(doc.querySelectorAll('label')).find(element => element.querySelector('span')?.textContent === label)?.querySelector('input');
    expect(element, label).toBeDefined(); element!.value = value;
    element!.dispatchEvent(new win.Event('input', {bubbles: true}));
}
async function attach(options: Record<string, unknown> = {}) {
    win.arguments = [{host, ...options}];
    runtime = await import('vue');
    await import('../integrations/zotero/workspace'); await settle();
    await vi.waitFor(() => expect(win.FluentReadWorkspace).toBeDefined());
    return win.FluentReadWorkspace as {receive(options: Record<string, unknown>): void; dispose(): Promise<void>};
}

beforeEach(() => {
    vi.resetModules();
    const parsed = parseHTML('<html><body><div id="fluentread-workspace"></div></body></html>');
    win = parsed.window; doc = win.document;
    // Linkedom 的 select.value 只有 getter；为真实 Vue DOM renderer 补标准的可写选中值。
    const prototype = win.HTMLSelectElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (!descriptor?.set) Object.defineProperty(prototype, 'value', {configurable: true,
        get: descriptor?.get,
        set(value: string) {
            for (const option of this.options) option.removeAttribute('selected');
            const selected = Array.from(this.options as HTMLOptionElement[]).find(option => option.value === String(value));
            selected?.setAttribute('selected', '');
        },
    });
    for (const [key, value] of Object.entries({window: win, document: doc, Element: win.Element,
        HTMLElement: win.HTMLElement, SVGElement: win.SVGElement, Node: win.Node, Event: win.Event})) vi.stubGlobal(key, value);
    fixture.engine = {
        parse: vi.fn(async () => ({fileName: 'paper.pdf', format: 'pdf' as const, label: 'PDF', parts: [],
            segments: [{id: 0, source: 'A paragraph', contextLabel: '第 1 页'}]})),
        translate: vi.fn(async (_document, _settings, _signal, _initial, commit) => {commit(0, '译文'); return ['译文'];}),
        export: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
        selection: vi.fn(async () => '选区译文'), release: vi.fn(),
    };
    host = {
        loadSettings: vi.fn(async () => ({...defaultSettings, autoOpen: false})), saveSettings: vi.fn(async () => {}),
        loadTasks: vi.fn(async () => []), saveTasks: vi.fn(async () => {}),
        selectedAttachments: vi.fn(async () => [source()]), readAttachment: vi.fn(async () => source()),
        saveOutput: vi.fn(async () => 99), saveNote: vi.fn(async () => 101),
        openAttachment: vi.fn(async () => {}), openSource: vi.fn(async () => {}), notify: vi.fn(),
    };
});
afterEach(async () => {
    await win.FluentReadWorkspace?.dispose();
    delete win.FluentReadWorkspace;
    vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('Zotero Vue workspace user flows', () => {
    it('renders an empty workspace and requires a deliberate translation action', async () => {
        await attach();
        expect(doc.querySelector('h1')?.textContent).toBe('流畅阅读');
        expect(doc.body.textContent).toContain('从一篇论文开始');
        expect(doc.querySelector<HTMLSelectElement>('select[aria-label="译文"]')?.value).toBe('zh-Hans');
        expect(host.selectedAttachments).not.toHaveBeenCalled();
        expect(fixture.engine!.selection).not.toHaveBeenCalled();
        expect(fixture.engine!.translate).not.toHaveBeenCalled();
    });

    it('persists normalized language and service settings before translating selected literature', async () => {
        await attach();
        await select('原文', 'en'); await select('译文', 'ja');
        click(namedButton('翻译设置')); await settle();
        await select('翻译服务', 'compatible');
        input('模型服务地址', 'https://model.example/v1'); input('模型名称', 'academic-model');
        input('API 密钥（仅保存在本机）', 'workspace-test-key');
        const saving = deferred<void>(); vi.mocked(host.saveSettings).mockReturnValueOnce(saving.promise);
        click(namedButton('翻译所选文献')); await settle();
        expect(host.saveSettings).toHaveBeenCalledWith(expect.objectContaining({sourceLanguage: 'en', targetLanguage: 'ja',
            service: 'compatible', endpoint: 'https://model.example/v1/chat/completions', model: 'academic-model'}));
        expect(host.readAttachment).not.toHaveBeenCalled();
        expect(fixture.engine!.translate).not.toHaveBeenCalled();
        saving.resolve(); await settle();
        await vi.waitFor(() => expect(host.saveOutput).toHaveBeenCalledOnce());
        expect(vi.mocked(fixture.engine!.translate).mock.calls[0][1]).toMatchObject({targetLanguage: 'ja', service: 'compatible', model: 'academic-model'});
        expect(vi.mocked(host.saveSettings).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(host.readAttachment).mock.invocationCallOrder[0]);
    });

    it('renders selected source and model results as text and saves only one note on a double click', async () => {
        const text = '<img src=x onerror=alert(1)> original';
        const result = '<script>unexpected()</script> translated';
        vi.mocked(fixture.engine!.selection).mockResolvedValue(result);
        await attach({selection: {attachmentID: 12, text, page: 3}});
        click(namedButton('翻译选中文字')); await settle();
        expect(doc.querySelector('.selection-source')?.textContent).toBe(text);
        expect(doc.querySelector('.selection-result')?.textContent).toBe(result);
        expect(doc.querySelector('img, script')).toBeNull();
        const saved = deferred<number>(); vi.mocked(host.saveNote).mockReturnValueOnce(saved.promise);
        const button = namedButton('保存为双语笔记'); click(button); click(button); await settle();
        expect(host.saveNote).toHaveBeenCalledOnce();
        const html = vi.mocked(host.saveNote).mock.calls[0][2];
        expect(html).toContain('&lt;img'); expect(html).toContain('&lt;script&gt;');
        expect(html).toContain('?page=3'); expect(html).not.toContain('<script>');
        saved.resolve(101); await settle();
        expect(namedButton('笔记已保存').disabled).toBe(true);
    });

    it('aborts replaced selections and ignores late results after receiving another selection', async () => {
        const pending = deferred<string>(); vi.mocked(fixture.engine!.selection).mockReturnValueOnce(pending.promise);
        const workspace = await attach({selection: {attachmentID: 12, text: 'First source'}});
        click(namedButton('翻译选中文字')); await settle();
        const signal = vi.mocked(fixture.engine!.selection).mock.calls[0][2];
        workspace.receive({selection: {attachmentID: 12, text: 'Second source', page: 2}}); await settle();
        expect(signal.aborted).toBe(true); pending.resolve('Late first translation'); await settle();
        expect(doc.querySelector('.selection-source')?.textContent).toBe('Second source');
        expect(doc.querySelector('.selection-result')).toBeNull();
        click(namedButton('翻译选中文字')); await settle();
        expect(doc.querySelector('.selection-result')?.textContent).toBe('选区译文');
    });

    it('aborts a selection when its panel closes and does not restore a late response', async () => {
        const pending = deferred<string>(); vi.mocked(fixture.engine!.selection).mockReturnValueOnce(pending.promise);
        await attach({selection: {attachmentID: 12, text: 'Source'}});
        click(namedButton('翻译选中文字')); await settle();
        const signal = vi.mocked(fixture.engine!.selection).mock.calls[0][2];
        click(namedButton('关闭')); await settle(); expect(signal.aborted).toBe(true);
        pending.resolve('Late translation'); await settle();
        expect(doc.querySelector('.selection-source, .selection-result')).toBeNull();
        expect(host.saveNote).not.toHaveBeenCalled();
    });

    it.each(['replace', 'cancel'])('ignores a late selection rejection after %s', async action => {
        const pending = deferred<string>(); vi.mocked(fixture.engine!.selection).mockReturnValueOnce(pending.promise);
        const workspace = await attach({selection: {attachmentID: 12, text: 'First source'}});
        click(namedButton('翻译选中文字')); await settle();
        const signal = vi.mocked(fixture.engine!.selection).mock.calls[0][2];
        if (action === 'replace') workspace.receive({selection: {attachmentID: 12, text: 'Current source'}});
        else click(namedButton('取消'));
        await settle(); expect(signal.aborted).toBe(true);
        pending.reject(new Error('Expired request failed')); await settle();
        expect(doc.querySelector('[role="alert"]')).toBeNull();
        if (action === 'replace') expect(doc.querySelector('.selection-source')?.textContent).toBe('Current source');
        expect(doc.querySelector('.selection-result')).toBeNull();
    });

    it('ignores a late note-save rejection after switching to another selected text', async () => {
        const workspace = await attach({selection: {attachmentID: 12, text: 'First source'}});
        click(namedButton('翻译选中文字')); await settle();
        const pending = deferred<number>(); vi.mocked(host.saveNote).mockReturnValueOnce(pending.promise);
        click(namedButton('保存为双语笔记')); await settle();
        workspace.receive({selection: {attachmentID: 12, text: 'Current source'}}); await settle();
        pending.reject(new Error('Expired note save failed')); await settle();
        expect(doc.querySelector('[role="alert"]')).toBeNull();
        expect(doc.querySelector('.selection-source')?.textContent).toBe('Current source');
    });

    it('disposes active selection work and rejects received actions after unloading', async () => {
        const pending = deferred<string>(); vi.mocked(fixture.engine!.selection).mockReturnValueOnce(pending.promise);
        const workspace = await attach({selection: {attachmentID: 12, text: 'Source'}});
        click(namedButton('翻译选中文字')); await settle();
        const signal = vi.mocked(fixture.engine!.selection).mock.calls[0][2];
        await workspace.dispose(); expect(signal.aborted).toBe(true);
        workspace.receive({initialSelection: true, selection: {attachmentID: 12, text: 'After close'}});
        pending.resolve('Late translation'); await settle();
        expect(doc.querySelector('#fluentread-workspace')?.childNodes.length).toBe(0);
        expect(host.selectedAttachments).not.toHaveBeenCalled();
        expect(host.saveNote).not.toHaveBeenCalled();
    });

    it('does not mount or start an initial translation after closing during settings loading', async () => {
        const loading = deferred<TranslationSettings>();
        vi.mocked(host.loadSettings).mockReturnValueOnce(loading.promise);
        win.arguments = [{host, initialSelection: true}];
        runtime = await import('vue'); await import('../integrations/zotero/workspace');
        win.dispatchEvent(new win.Event('unload'));
        loading.resolve({...defaultSettings, autoOpen: false}); await settle();
        expect(doc.querySelector('main') === null).toBe(true);
        expect(host.selectedAttachments).not.toHaveBeenCalled();
        expect(host.readAttachment).not.toHaveBeenCalled();
        expect(fixture.engine!.translate).not.toHaveBeenCalled();
    });

    it.each(['内容已改变', '文件位置或父条目已改变'])('keeps the captured source when a PDF %s before saving a selection note', async reason => {
        const original = source();
        let locationVersion = 1;
        const capturedLocations = new WeakMap<AttachmentSource, number>();
        vi.mocked(host.readAttachment).mockImplementation(async () => {
            const captured = {...original};
            capturedLocations.set(captured, locationVersion); return captured;
        });
        vi.mocked(host.saveNote).mockImplementation(async captured => {
            if (capturedLocations.get(captured) !== locationVersion) throw new Error(`原 PDF ${reason}`);
            return 101;
        });
        await attach({selection: {attachmentID: 12, text: 'Source before replacement'}});
        click(namedButton('翻译选中文字')); await settle();
        expect(doc.querySelector('.selection-result')?.textContent).toBe('选区译文');
        locationVersion++;
        click(namedButton('保存为双语笔记')); await settle();
        expect(doc.querySelector('[role="alert"]')?.textContent).toContain(reason);
        expect(host.readAttachment).toHaveBeenCalledOnce();
        expect(Array.from(doc.querySelectorAll('button')).some(button => button.textContent === '笔记已保存')).toBe(false);
    });
});
