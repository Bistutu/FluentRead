import {describe, expect, it, vi} from 'vitest';
import {bilingualNote, restoreTasks, taskSettings, ZoteroTaskQueue} from '../integrations/zotero/queue';
import {defaultSettings} from '../integrations/zotero/settings';
import type {AttachmentSource, TranslationSettings, TranslationTask, ZoteroEngine, ZoteroHost} from '../integrations/zotero/contracts';
import type {ParsedDocument} from '../src/features/document-translation/core/document';

const settings = (): TranslationSettings => ({...defaultSettings, autoOpen: false});
const source = (): AttachmentSource => ({id: 12, libraryID: 1, key: 'PDFKEY', title: 'Paper',
    fileName: 'paper.pdf', bytes: new Uint8Array([1, 2]), fingerprint: 'hash-a', sourceURI: 'zotero://open-pdf/library/items/PDFKEY'});
const parsed = (): ParsedDocument => ({fileName: 'paper.pdf', format: 'pdf', label: 'PDF', parts: [],
    segments: [{id: 0, source: 'First paragraph', contextLabel: '第 1 页'}, {id: 1, source: 'Second paragraph', contextLabel: '第 2 页'}]});
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function done(queue: ZoteroTaskQueue) {
    await vi.waitFor(() => expect(queue.tasks.some(task => ['queued', 'running'].includes(task.state))).toBe(false));
}
function harness(stored: unknown = []) {
    const saved: TranslationTask[][] = [];
    const host: ZoteroHost = {
        loadSettings: vi.fn(async () => settings()), saveSettings: vi.fn(async () => {}),
        loadTasks: vi.fn(async () => stored), saveTasks: vi.fn(async tasks => {saved.push(JSON.parse(JSON.stringify(tasks)));}),
        selectedAttachments: vi.fn(async () => [source()]), readAttachment: vi.fn(async () => source()),
        saveOutput: vi.fn(async () => 99), saveNote: vi.fn(async () => 101),
        openAttachment: vi.fn(async () => {}), openSource: vi.fn(async () => {}), notify: vi.fn(),
    };
    const engine: ZoteroEngine = {
        parse: vi.fn(async () => parsed()),
        translate: vi.fn(async (_document, _settings, _signal, initial, commit) => {
            const result = ['第一段', '第二段'];
            result.forEach((text, id) => {if (!initial[id]) commit(id, text);}); return result;
        }),
        export: vi.fn(async () => new Uint8Array([37, 80, 68, 70])), selection: vi.fn(async () => '译文'), release: vi.fn(),
    };
    const current = settings();
    const queue = new ZoteroTaskQueue(host, engine, () => current);
    return {host, engine, queue, saved, current};
}

describe('Zotero persistent document queue', () => {
    it('saves a full result and its history without capturing credentials', async () => {
        const {queue, host, engine, saved, current} = harness();
        current.apiKey = 'secret-for-current-endpoint';
        await queue.initialize(); await queue.enqueue(); await done(queue);
        expect(queue.tasks[0]).toMatchObject({state: 'completed', outputAttachmentID: 99, total: 2, completed: 2, fingerprint: 'hash-a'});
        expect(JSON.stringify(saved)).not.toContain('secret-for-current-endpoint');
        expect(host.saveOutput).toHaveBeenCalledOnce(); expect(engine.release).toHaveBeenCalledOnce();
        expect(host.openAttachment).not.toHaveBeenCalled(); await queue.dispose();
    });
    it('pauses active network work, rejects late text, and resumes only missing paragraphs', async () => {
        const {queue, engine} = harness();
        let lateCommit!: (id: number, text: string) => void;
        let finish!: (value: string[]) => void;
        vi.mocked(engine.translate).mockImplementationOnce(async (_document, _settings, signal, _initial, commit) => {
            commit(0, '第一段'); lateCommit = commit;
            return new Promise<string[]>((resolve, reject) => {
                finish = resolve; signal.addEventListener('abort', () => reject(signal.reason), {once: true});
            });
        });
        await queue.initialize(); await queue.enqueue();
        await vi.waitFor(() => expect(queue.tasks[0].completed).toBe(1));
        const id = queue.tasks[0].id; await queue.pause(id);
        lateCommit(1, '不应提交'); finish(['迟到', '迟到']); await tick();
        expect(queue.tasks[0].translations).toEqual(['第一段', '']);
        await queue.resume(id); await done(queue);
        expect(vi.mocked(engine.translate).mock.calls[1][3]).toEqual(['第一段', '']);
        expect(queue.tasks[0].state).toBe('completed'); await queue.dispose();
    });
    it('does not mix an old checkpoint with a replaced PDF', async () => {
        const first = harness(); await first.queue.initialize(); await first.queue.enqueue(); await done(first.queue);
        const task = {...first.queue.tasks[0], state: 'running' as const}; await first.queue.dispose();
        const {queue, host, engine} = harness([task]);
        vi.mocked(host.readAttachment).mockResolvedValue({...source(), fingerprint: 'hash-b'});
        await queue.initialize(); expect(queue.tasks[0].state).toBe('paused');
        expect(engine.translate).not.toHaveBeenCalled();
        await queue.resume(task.id); await done(queue);
        expect(queue.tasks[0]).toMatchObject({state: 'failed', error: expect.stringContaining('内容已变化')});
        expect(engine.translate).not.toHaveBeenCalled(); expect(host.saveOutput).not.toHaveBeenCalled(); await queue.dispose();
    });
    it('preserves out-of-order batch checkpoints across a restart', async () => {
        const {queue, engine, saved} = harness();
        vi.mocked(engine.translate).mockImplementationOnce(async (_document, _settings, signal, _initial, commit) => {
            commit(1, '第二段先完成');
            return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
        });
        await queue.initialize(); await queue.enqueue();
        await vi.waitFor(() => expect(queue.tasks[0].completed).toBe(1));
        await queue.pause(queue.tasks[0].id);
        const restored = restoreTasks(saved.at(-1));
        expect(restored).toHaveLength(1);
        expect(restored[0].translations).toEqual(['', '第二段先完成']);
        expect(restored[0].completed).toBe(1); await queue.dispose();
    });
    it('deduplicates active selections and continues another document after a failure', async () => {
        const {queue, host, engine} = harness();
        vi.mocked(host.selectedAttachments).mockResolvedValue([source(), {...source(), id: 13, key: 'SECOND'}]);
        vi.mocked(host.readAttachment).mockImplementation(async id => ({...source(), id, key: id === 12 ? 'PDFKEY' : 'SECOND'}));
        vi.mocked(engine.parse).mockRejectedValueOnce(new Error('PDF damaged'));
        await queue.initialize(); expect(await queue.enqueue()).toBe(2);
        await done(queue);
        expect(queue.tasks.map(task => task.state)).toEqual(['failed', 'completed']);
        await queue.dispose();
    });
    it('captures language and model settings, but will not send a saved task key to another endpoint', async () => {
        const h = harness(); h.current.service = 'compatible'; h.current.endpoint = 'https://one.test/v1/chat/completions'; h.current.model = 'model';
        await h.queue.initialize(); await h.queue.enqueue(); await done(h.queue);
        const task = {...h.queue.tasks[0], state: 'paused' as const}; await h.queue.dispose();
        const next = harness([task]); next.current.service = 'compatible'; next.current.endpoint = 'https://two.test/v1/chat/completions';
        await next.queue.initialize(); await next.queue.resume(task.id); await done(next.queue);
        expect(next.engine.translate).not.toHaveBeenCalled();
        expect(next.queue.tasks[0].error).toContain('地址已变更'); await next.queue.dispose();
    });
    it('does not start translation if the queue cannot be persisted', async () => {
        const {queue, host, engine} = harness();
        vi.mocked(host.saveTasks).mockRejectedValue(new Error('Read-only disk'));
        await queue.initialize(); await expect(queue.enqueue()).rejects.toThrow('Read-only disk');
        expect(engine.parse).not.toHaveBeenCalled(); await queue.dispose().catch(() => {});
    });
    it('cancels a running task without saving a late export', async () => {
        const {queue, engine, host} = harness();
        let finish!: (bytes: Uint8Array) => void;
        vi.mocked(engine.export).mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
        await queue.initialize(); await queue.enqueue();
        await vi.waitFor(() => expect(engine.export).toHaveBeenCalled());
        await queue.cancel(queue.tasks[0].id); finish(new Uint8Array([1])); await done(queue); await tick();
        expect(queue.tasks[0].state).toBe('canceled'); expect(host.saveOutput).not.toHaveBeenCalled(); await queue.dispose();
    });
    it('saves a linked bilingual note without retranslating text and releases parsed resources', async () => {
        const {queue, host, engine} = harness(); await queue.initialize(); await queue.enqueue(); await done(queue);
        await queue.saveBilingualNote(queue.tasks[0].id);
        expect(engine.translate).toHaveBeenCalledOnce(); expect(host.saveNote).toHaveBeenCalledOnce();
        expect(vi.mocked(host.saveNote).mock.calls[0][2]).toContain('PDFKEY?page=2');
        expect(queue.tasks[0].noteID).toBe(101); expect(engine.release).toHaveBeenCalledTimes(2); await queue.dispose();
    });
    it('pauses remaining work when the workspace closes', async () => {
        const {queue, engine, host} = harness();
        let rejectWork!: (reason: unknown) => void;
        vi.mocked(engine.translate).mockImplementationOnce(async (_document, _settings, signal) => new Promise((_resolve, reject) => {
            rejectWork = reject; signal.addEventListener('abort', () => reject(signal.reason), {once: true});
        }));
        await queue.initialize(); await queue.enqueue(); await vi.waitFor(() => expect(engine.translate).toHaveBeenCalled());
        await queue.dispose(); rejectWork(new Error('late')); await tick();
        expect(queue.tasks[0].state).toBe('paused'); expect(host.saveOutput).not.toHaveBeenCalled();
    });
    it('cannot overwrite a newly opened queue when an old native commit finishes late', async () => {
        const {queue, host, saved, engine} = harness();
        let finish!: (id: number) => void;
        vi.mocked(host.saveOutput).mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
        await queue.initialize(); await queue.enqueue();
        await vi.waitFor(() => expect(host.saveOutput).toHaveBeenCalled());
        await queue.dispose();
        const newTask = {...queue.tasks[0], id: 'new-window-task', title: 'New window'};
        await host.saveTasks([newTask]);
        finish(99);
        await vi.waitFor(() => expect(engine.release).toHaveBeenCalled());
        expect(saved.at(-1)?.[0].id).toBe('new-window-task');
    });
});

describe('Zotero saved task and note boundaries', () => {
    it('ignores malformed history, deduplicates IDs and strips saved credentials', () => {
        expect(restoreTasks({bad: true})).toEqual([]);
        const h = harness(); const now = Date.now();
        const task: TranslationTask = {id: 'job-one', attachmentID: 12, attachmentKey: 'KEY', libraryID: 1, title: 'Paper',
            state: 'running', phase: 'running', createdAt: now, updatedAt: now, settings: taskSettings(h.current), translations: ['one'], total: 2, completed: 0};
        const restored = restoreTasks([{}, task, task, {...task, id: 'bad', translations: [null]}]);
        expect(restored).toHaveLength(1); expect(restored[0]).toMatchObject({state: 'paused', completed: 1});
    });
    it('escapes HTML from source text and translations while preserving page links', () => {
        const doc = parsed(); doc.segments[0].source = '<img src=x onerror=alert(1)>';
        const html = bilingualNote(doc, ['<script>alert(1)</script>'], source().sourceURI);
        expect(html).not.toContain('<script>'); expect(html).not.toContain('<img ');
        expect(html).toContain('&lt;script&gt;'); expect(html).toContain('PDFKEY?page=2');
    });
});
