import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';
import {createZoteroHost, contentFingerprint, sanitizeNoteHTML} from '../integrations/zotero/platform';
import {createNativeIntegration} from '../integrations/zotero/native';
import {defaultSettings} from '../integrations/zotero/settings';
import type {AttachmentSource, TranslationTask} from '../integrations/zotero/contracts';

const {document, window} = parseHTML('<html><body></body></html>');
const Parser = class {parseFromString(html: string) {return parseHTML(`<html><body>${html}</body></html>`).document;}} as unknown as typeof DOMParser;
const bytes = (text = '%PDF-source') => new TextEncoder().encode(text);
const signal = () => new AbortController().signal;
function fixture(standalone = false) {
    const files = new Map<string, unknown>([['/source.pdf', bytes()]]);
    const records = new Map<number, any>();
    let nextID = 50;
    const parent = {id: 1, libraryID: 4, isRegularItem: () => true, isPDFAttachment: () => false, isNote: () => false,
        getAttachments: () => [...records.values()].filter(item => item.parentID === 1 && item.isPDFAttachment()).map(item => item.id),
        getNotes: () => [...records.values()].filter(item => item.parentID === 1 && item.isNote?.()).map(item => item.id)};
    const original = {id: 2, libraryID: 4, key: 'PDFABCDE', parentID: standalone ? false : 1,
        attachmentFilename: 'paper.pdf', isPDFAttachment: () => true, isRegularItem: () => false,
        getFilePathAsync: async () => '/source.pdf', getField: () => 'A <paper>', getCollections: () => [9]};
    records.set(1, parent); records.set(2, original);
    const library = {editable: true, filesEditable: true, libraryType: 'user'};
    const io = {readJSON: vi.fn(async (path: string) => {
        if (!files.has(path)) throw Object.assign(new Error('missing'), {name: 'NotFoundError'});
        return files.get(path);
    }), writeJSON: vi.fn(async (path: string, value: unknown) => {files.set(path, JSON.parse(JSON.stringify(value)));}),
    read: vi.fn(async (path: string) => files.get(path) as Uint8Array),
    write: vi.fn(async (path: string, data: Uint8Array) => {files.set(path, data);}),
    exists: vi.fn(async (path: string) => files.has(path)), makeDirectory: vi.fn(async () => {}),
    remove: vi.fn(async (path: string) => {files.delete(path);}), setPermissions: vi.fn(async () => {})};
    const zotero = {Items: {getAsync: vi.fn(async (ids: number | number[]) => Array.isArray(ids) ? ids.map(id => records.get(id)) : records.get(ids)),
        get: (id: number) => records.get(id), getAll: async () => [...records.values()].filter(item => !item.parentID)},
    Libraries: {get: () => library}, Groups: {getGroupIDFromLibraryID: () => 1234},
    getActiveZoteroPane: () => ({getSelectedItems: () => [parent, original]}),
    Attachments: {importFromFile: vi.fn(async (options: any) => {
        const item = {id: ++nextID, libraryID: options.libraryID, parentID: options.parentItemID || false,
            attachmentFilename: options.fileBaseName + '.pdf', isPDFAttachment: () => true, getField: () => options.title};
        Object.assign(item, {eraseTx: async () => {records.delete(item.id);}});
        records.set(item.id, item); return item;
    })}, Reader: {open: vi.fn()},
    Item: class {
        id = ++nextID; libraryID = 0; parentID: number | false = false; note = ''; tags: string[] = [];
        isNote() {return true;} isPDFAttachment() {return false;}
        setCollections = vi.fn(); addTag(tag: string) {this.tags.push(tag);} hasTag(tag: string) {return this.tags.includes(tag);}
        setNote(note: string) {this.note = note;} async saveTx() {records.set(this.id, this);} async eraseTx() {records.delete(this.id);}
    }};
    const environment = {Zotero: zotero, IOUtils: io, PathUtils: {join: (...parts: string[]) => parts.join('/')}, profileDirectory: '/profile', DOMParser: Parser};
    return {files, records, original, parent, library, io, zotero, environment, host: createZoteroHost(environment)};
}
function task(source: AttachmentSource): TranslationTask {
    const {apiKey: _key, autoOpen: _open, ...settings} = defaultSettings;
    return {id: 'fr-task-12345678', attachmentID: source.id, libraryID: source.libraryID, attachmentKey: source.key,
        title: source.title, fingerprint: source.fingerprint, createdAt: 1, updatedAt: 2, settings,
        state: 'running', phase: 'export', translations: ['翻译'], total: 1, completed: 1};
}

describe('Zotero native storage and attachment ownership', () => {
    it('uses content SHA-256, deduplicates selection, and creates group-aware source links', async () => {
        const f = fixture();
        expect(await f.host.selectedAttachments()).toHaveLength(1);
        f.library.libraryType = 'group';
        const source = await f.host.readAttachment(2, signal());
        expect(source.fingerprint).toBe(contentFingerprint(bytes()));
        expect(source.sourceURI).toBe('zotero://open-pdf/groups/1234/items/PDFABCDE');
    });
    it('keeps credentials outside settings and task snapshots and redacts errors', async () => {
        const f = fixture();
        expect(await f.host.loadSettings()).toEqual(defaultSettings);
        await f.host.saveSettings({...defaultSettings, apiKey: 'secret-key'});
        expect(JSON.stringify(f.files.get('/profile/fluentread/settings.json'))).not.toContain('secret-key');
        expect(f.files.get('/profile/fluentread/credentials.json')).toEqual({apiKey: 'secret-key', endpoint: '', service: 'microsoft'});
        const source = await f.host.readAttachment(2, signal());
        const value = Object.assign(task(source), {apiKey: 'accidental-key', error: 'provider secret-key failed'});
        await f.host.saveTasks([value]);
        expect(JSON.stringify(await f.host.loadTasks())).not.toMatch(/secret-key|accidental-key/);
        expect((await f.host.loadSettings()).apiKey).toBe('secret-key');
        expect(f.io.writeJSON).toHaveBeenLastCalledWith('/profile/fluentread/tasks.json', expect.any(Array), {tmpPath: '/profile/fluentread/tasks.json.tmp', flush: true});
        expect(f.io.setPermissions).toHaveBeenCalledWith('/profile/fluentread/credentials.json', 0o600);
    });
    it('never combines a newly saved key with an older endpoint after a partial settings write', async () => {
        const f = fixture();
        await f.host.saveSettings({...defaultSettings, service: 'compatible', endpoint: 'https://a.example/v1', apiKey: 'key-A'});
        const originalWrite = f.io.writeJSON.getMockImplementation()!;
        f.io.writeJSON.mockImplementationOnce(originalWrite).mockImplementationOnce(async () => {throw new Error('disk failure');});
        await expect(f.host.saveSettings({...defaultSettings, service: 'compatible', endpoint: 'https://b.example/v1', apiKey: 'key-B'})).rejects.toThrow('disk failure');
        const restored = await createZoteroHost(f.environment).loadSettings();
        expect(restored.endpoint).toBe('https://a.example/v1/chat/completions');
        expect(restored.apiKey).toBe('');
    });
    it('rolls back only a newly created PDF when cancellation arrives during the database commit', async () => {
        const f = fixture(); const source = await f.host.readAttachment(2, signal()); const controller = new AbortController();
        const performImport = f.zotero.Attachments.importFromFile.getMockImplementation()!;
        f.zotero.Attachments.importFromFile.mockImplementation(async (options: any) => {const result = await performImport(options); controller.abort(); return result;});
        await expect(f.host.saveOutput(source, task(source), bytes('%PDF-translated'), controller.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(f.records.size).toBe(2);
        expect(f.files.get('/source.pdf')).toEqual(bytes());
    });
    it('filters generated PDFs when a parent is selected and rejects read-only before returning source bytes', async () => {
        const f = fixture(); const source = await f.host.readAttachment(2, signal());
        await f.host.saveOutput(source, task(source), bytes('%PDF-translated'), signal());
        expect(await f.host.selectedAttachments()).toHaveLength(1);
        f.library.editable = false;
        await expect(f.host.readAttachment(2, signal())).rejects.toThrow('只读');
    });
    it('recovers a committed PDF after recreating the host without duplicating or overwriting the original', async () => {
        const f = fixture(); const source = await f.host.readAttachment(2, signal()); const t = task(source);
        const result = await f.host.saveOutput(source, t, bytes('%PDF-translated'), signal());
        const restarted = createZoteroHost(f.environment);
        const restoredSource = await restarted.readAttachment(2, signal());
        expect(await restarted.saveOutput(restoredSource, t, bytes('%PDF-translated'), signal())).toBe(result);
        expect(f.zotero.Attachments.importFromFile).toHaveBeenCalledTimes(1);
        expect(f.zotero.Attachments.importFromFile).toHaveBeenCalledWith(expect.objectContaining({parentItemID: 1, libraryID: 4, contentType: 'application/pdf'}));
        expect(f.files.get('/source.pdf')).toEqual(bytes());
    });
    it('preserves standalone attachment collections without making a PDF its parent', async () => {
        const f = fixture(true); const source = await f.host.readAttachment(2, signal());
        await f.host.saveOutput(source, task(source), bytes('%PDF-translated'), signal());
        expect(f.zotero.Attachments.importFromFile).toHaveBeenCalledWith(expect.objectContaining({parentItemID: undefined, collections: [9]}));
    });
    it('rejects changed bytes, changed parent, changed identity and read-only libraries before import', async () => {
        for (const change of ['bytes', 'parent', 'identity', 'readonly', 'filesreadonly']) {
            const f = fixture(); const source = await f.host.readAttachment(2, signal());
            if (change === 'bytes') f.files.set('/source.pdf', bytes('%PDF-modified'));
            if (change === 'parent') f.original.parentID = false as any;
            if (change === 'identity') f.original.libraryID = 7;
            if (change === 'readonly') f.library.editable = false;
            if (change === 'filesreadonly') f.library.filesEditable = false;
            await expect(f.host.saveOutput(source, task(source), bytes('%PDF-translated'), signal())).rejects.toThrow();
            expect(f.zotero.Attachments.importFromFile).not.toHaveBeenCalled();
        }
    });
    it('rejects an oversized PDF from its native stat before allocating the file bytes', async () => {
        const f = fixture();
        const host = createZoteroHost({...f.environment, IOUtils: {...f.io, stat: async () => ({size: Number.MAX_SAFE_INTEGER})}});
        await expect(host.readAttachment(2, signal())).rejects.toThrow('超过');
        expect(f.io.read).not.toHaveBeenCalled();
    });
    it('rejects missing files, non-PDF output, path injection and cancellation', async () => {
        const f = fixture(); const source = await f.host.readAttachment(2, signal());
        await expect(f.host.saveOutput(source, task(source), bytes('not PDF'), signal())).rejects.toThrow('有效的 PDF');
        await expect(f.host.saveOutput(source, {...task(source), id: '../../outside'}, bytes(), signal())).rejects.toThrow('任务标识');
        const controller = new AbortController(); controller.abort();
        await expect(f.host.readAttachment(2, controller.signal)).rejects.toMatchObject({name: 'AbortError'});
        f.files.delete('/source.pdf');
        await expect(f.host.readAttachment(2, signal())).rejects.toThrow('找不到 PDF');
    });
    it('saves safe, idempotent notes with only matching source-page backlinks', async () => {
        const f = fixture(); const source = await f.host.readAttachment(2, signal());
        const html = '<p onclick="attack()">译文<img src=x onerror="attack()"><script>attack()</script></p><a href="javascript:attack()">bad</a>'
            + `<a href="${source.sourceURI}?page=3">page 3</a><a href="zotero://open-pdf/library/items/OTHERKEY?page=4">other</a>`;
        const id = await f.host.saveNote(source, task(source), html, signal());
        const saved = f.records.get(id);
        expect(saved.note).not.toMatch(/onclick|onerror|<script|<img|javascript:|OTHERKEY|attack\(\)/);
        expect(saved.note).toContain(`${source.sourceURI}?page=3`);
        expect(saved.note).toContain('A &lt;paper&gt;');
        expect(await createZoteroHost(f.environment).saveNote(source, task(source), html, signal())).toBe(id);
        expect(saved.parentID).toBe(1);
    });
    it('permits read-only selection viewing and writable notes without weakening the full-PDF preflight', async () => {
        const f = fixture(); f.library.editable = false;
        expect((await f.host.readAttachment(2, signal(), 'selection')).bytes).toEqual(bytes());
        await expect(f.host.readAttachment(2, signal())).rejects.toThrow('只读');
        await expect(f.host.readAttachment(2, signal(), 'note')).rejects.toThrow('只读');
        f.library.editable = true; f.library.filesEditable = false;
        const source = await f.host.readAttachment(2, signal(), 'note');
        expect(await f.host.saveNote(source, task(source), '<p>Note</p>', signal())).toBeGreaterThan(2);
        await expect(f.host.readAttachment(2, signal())).rejects.toThrow('只读');
    });
    it('waits for an earlier checkpoint write before a newly opened workspace reads tasks', async () => {
        const f = fixture(); const source = await f.host.readAttachment(2, signal());
        let release!: () => void; const gate = new Promise<void>(resolve => {release = resolve;});
        const performWrite = f.io.writeJSON.getMockImplementation()!;
        f.io.writeJSON.mockImplementationOnce(async (path: string, value: unknown) => {await gate; await performWrite(path, value);});
        const writing = f.host.saveTasks([task(source)]);
        const reading = f.host.loadTasks(); let finished = false; void reading.then(() => {finished = true;});
        await new Promise(resolve => setImmediate(resolve)); expect(finished).toBe(false);
        release(); await writing; expect(await reading).toHaveLength(1);
    });
    it('rolls back a newly created note when cancellation arrives during saveTx', async () => {
        const f = fixture(); const source = await f.host.readAttachment(2, signal()); const controller = new AbortController();
        const Note = f.zotero.Item;
        f.zotero.Item = class extends Note {async saveTx() {await super.saveTx(); controller.abort();}};
        await expect(f.host.saveNote(source, task(source), '<p>Note</p>', controller.signal)).rejects.toMatchObject({name: 'AbortError'});
        expect(f.records.size).toBe(2);
    });
    it('removes all external attributes and active XML/HTML content from notes', () => {
        expect(sanitizeNoteHTML('<svg><script>bad</script></svg><iframe>bad</iframe><p style="x"><b>okay</b></p>', Parser)).toBe('<p><b>okay</b></p>');
    });
});

describe('Zotero native lifecycle', () => {
    it('uses escaped passive notifications and closes its owned notification timers on shutdown', async () => {
        vi.useFakeTimers();
        try {
            const f = fixture(); const popups: any[] = [];
            const zotero = Object.assign(f.zotero, {locale:'zh-CN', getMainWindow:()=>({}), getMainWindows:()=>[], alert:vi.fn(),
                ProgressWindow: class {changeHeadline=vi.fn(); addDescription=vi.fn(); show=vi.fn(); startCloseTimer=vi.fn(); close=vi.fn(); constructor(){popups.push(this);}}});
            Object.assign(zotero.Reader,{registerEventListener:vi.fn(),unregisterEventListener:vi.fn()});
            const native = createNativeIntegration({...f.environment,Zotero:zotero, Services:{dirsvc:{get:()=>({path:'/profile'})}},Components:{interfaces:{nsIFile:{}}}});
            await native.startup({id:'test@fluentread',version:'0.0.40',rootURI:'file:///plugin/'});
            native.getHost()!.notify('<img src=x> saved');
            expect(popups[0].addDescription).toHaveBeenCalledWith('&lt;img src=x&gt; saved');
            expect(popups[0].startCloseTimer).toHaveBeenCalledWith(4000);
            expect(zotero.alert).not.toHaveBeenCalled();
            await native.shutdown();
            expect(popups[0].close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
        } finally {vi.useRealTimers();}
    });

    it('mounts each window once, reuses the workspace and removes every owned entry on shutdown', async () => {
        const f = fixture();
        document.body.innerHTML = '<div id="zotero-itemmenu"></div><div id="menu_ToolsPopup"></div>';
        (document as any).createXULElement = (name: string) => document.createElement(name);
        const workspace = {closed: false, addEventListener: vi.fn(), focus: vi.fn(), close: vi.fn(), FluentReadWorkspace: {receive: vi.fn(), dispose: vi.fn(async () => {})}};
        const win = {document, openDialog: vi.fn(() => workspace), ZoteroPane: {getSelectedItems: () => [f.original]}};
        Object.assign(f.zotero.Reader, {registerEventListener: vi.fn(), unregisterEventListener: vi.fn()});
        const zotero = Object.assign(f.zotero, {locale: 'zh-CN', getMainWindow: () => win, getMainWindows: () => [win], alert: vi.fn()});
        const nativeEnvironment = {...f.environment, Zotero: zotero,
            Services: {dirsvc: {get: () => ({path: '/profile'})}}, Components: {interfaces: {nsIFile: {}}}};
        Object.defineProperty(nativeEnvironment, 'DOMParser', {value: Parser, enumerable: false});
        const native = createNativeIntegration(nativeEnvironment);
        await native.startup({id: 'test@fluentread', version: '0.0.40', rootURI: 'file:///plugin/'});
        const nativeHost = native.getHost()!;
        const nativeSource = await nativeHost.readAttachment(2, signal());
        expect(await nativeHost.saveNote(nativeSource, task(nativeSource), '<p>Sandbox note</p>', signal())).toBeGreaterThan(2);
        native.onMainWindowLoad({window: win});
        expect(document.querySelectorAll('#fluentread-zotero-translate')).toHaveLength(1);
        document.getElementById('fluentread-zotero-translate')!.dispatchEvent(new window.Event('command'));
        await new Promise(resolve => setImmediate(resolve));
        expect(win.openDialog).toHaveBeenCalledOnce();
        native.openWorkspace({selection: {attachmentID: 2, text: 'selected'}});
        expect(workspace.FluentReadWorkspace.receive).toHaveBeenCalledWith({selection: {attachmentID: 2, text: 'selected'}});
        const listener = (f.zotero.Reader as any).registerEventListener.mock.calls[0][1];
        const popup = document.createElement('div'); document.body.append(popup);
        listener({reader: {itemID: 2}, doc: document, params: {annotation: {text: 'paper', position: {pageIndex: 2}}}, append: (node: Element) => popup.append(node)});
        (popup.querySelector('button') as HTMLButtonElement).click();
        expect(workspace.FluentReadWorkspace.receive).toHaveBeenLastCalledWith({selection: {attachmentID: 2, text: 'paper', page: 3}});
        await native.shutdown(); await native.shutdown();
        expect(document.getElementById('fluentread-zotero-translate')).toBeNull();
        expect(document.querySelector('.fluentread-zotero-selection')).toBeNull();
        expect(workspace.close).toHaveBeenCalledOnce();
        expect((f.zotero.Reader as any).unregisterEventListener).toHaveBeenCalledOnce();
    });
});
