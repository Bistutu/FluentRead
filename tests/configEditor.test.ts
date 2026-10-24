import {isReactive, nextTick, reactive, ref, toRaw, watch} from 'vue';
import {describe, expect, it, vi} from 'vitest';
import {Config, normalizeConfig} from '@/src/core/config/model';
import {customModelString} from '@/src/core/config/catalog';
import {createConfigEditor} from '@/src/services/config/editor';
import {useConfigEditor} from '@/src/features/settings/model/useConfigEditor';

function deferred() {
    let resolve!: () => void, reject!: (error: unknown) => void;
    const promise = new Promise<void>((yes, no) => {resolve = yes; reject = no;});
    return {promise, resolve, reject};
}

function fixture() {
    const draft = reactive(new Config());
    const saveDraft = vi.fn((_snapshot: Config, _previous: Config) => Promise.resolve());
    const onEdited = vi.fn(), onSaved = vi.fn(), onSaveError = vi.fn();
    const writeDraft = vi.fn((snapshot: Config) => {Object.assign(draft, snapshot);});
    const editor = createConfigEditor({copySnapshot: normalizeConfig, readDraft: () => draft, writeDraft, saveDraft, onEdited, onSaved, onSaveError});
    return {draft, editor, saveDraft, writeDraft, onEdited, onSaved, onSaveError};
}

describe('configuration editing session', () => {
    it('hydrates an independent draft, ignores pre-ready/duplicate edits and stops after disposal', async () => {
        const f = fixture();
        f.draft.to = 'fr'; await f.editor.save(); expect(f.saveDraft).not.toHaveBeenCalled();
        const authority = normalizeConfig({to: 'en', harness: {enabled: true}});
        f.editor.hydrate(authority); expect(f.editor.ready).toBe(false);
        f.editor.initialize(authority); expect(f.editor.ready).toBe(true);
        f.draft.harness.enabled = false; expect(authority.harness.enabled).toBe(true);
        await f.editor.save(); await f.editor.save(); expect(f.saveDraft).toHaveBeenCalledOnce();
        expect(f.onSaved).toHaveBeenCalledOnce(); expect(f.onEdited).toHaveBeenCalledOnce();
        f.editor.dispose(); expect(f.editor.ready).toBe(false);
        f.editor.initialize({to: 'de'}); f.editor.hydrate({to: 'de'}); f.draft.to = 'ja'; await f.editor.save();
        expect(f.draft.to).toBe('ja'); expect(f.saveDraft).toHaveBeenCalledOnce();
    });

    it('preserves unsubmitted and pending fields across external broadcasts, while accepting unrelated changes', async () => {
        const f = fixture(); f.editor.initialize({to: 'en', theme: 'auto'});
        const first = deferred(), second = deferred();
        f.saveDraft.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        f.draft.to = 'fr'; const saveFirst = f.editor.save();
        f.draft.to = 'ja'; const saveSecond = f.editor.save();
        f.draft.display = 0;
        f.editor.hydrate({to: 'en', theme: 'dark'});
        expect(f.draft.to).toBe('ja'); expect(f.draft.theme).toBe('dark'); expect(f.draft.display).toBe(0);
        first.reject(new Error('old failure')); await saveFirst; expect(f.onSaveError).not.toHaveBeenCalled();
        second.resolve(); await saveSecond; expect(f.onSaved).toHaveBeenCalledOnce();
        f.editor.hydrate({...f.draft, to: 'de'}); expect(f.draft.to).toBe('de');
    });

    it('keeps rejected edits for exact retry and rejects late save feedback after invalidation or disposal', async () => {
        const f = fixture(); f.editor.initialize({to: 'en'});
        const rejected = deferred(); f.saveDraft.mockReturnValueOnce(rejected.promise);
        f.draft.to = 'fr'; const saving = f.editor.save();
        f.editor.hydrate({to: 'en', theme: 'dark'}); expect(f.draft.to).toBe('fr');
        const failure = new Error('offline'); rejected.reject(failure); await saving;
        expect(f.onSaveError).toHaveBeenCalledWith(failure);
        f.editor.hydrate({to: 'en', theme: 'light'}); expect(f.draft.to).toBe('fr'); expect(f.draft.theme).toBe('light');
        await f.editor.save(); expect(f.saveDraft).toHaveBeenCalledTimes(2); expect(f.onSaved).toHaveBeenCalledOnce();
        const stale = deferred(); f.saveDraft.mockReturnValueOnce(stale.promise);
        f.draft.to = 'ja'; const staleSave = f.editor.save(); f.editor.invalidateFeedback();
        stale.reject(failure); await staleSave; expect(f.onSaveError).toHaveBeenCalledOnce();
        const disposed = deferred(); f.saveDraft.mockReturnValueOnce(disposed.promise);
        f.draft.to = 'de'; const disposedSave = f.editor.save(); f.editor.dispose();
        disposed.resolve(); await disposedSave; expect(f.onSaved).toHaveBeenCalledOnce();
    });

    it('handles synchronous persistence failure and older successful replies without losing later edits', async () => {
        const f = fixture(); f.editor.initialize({to: 'en'});
        f.saveDraft.mockImplementationOnce(() => {throw new Error('sync failure');});
        f.draft.to = 'fr'; await f.editor.save(); expect(f.onSaveError).toHaveBeenCalledOnce();
        const old = deferred(), recent = deferred(); f.saveDraft.mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);
        const oldSave = f.editor.save(); f.draft.to = 'de'; const recentSave = f.editor.save();
        old.resolve(); await oldSave; expect(f.onSaved).not.toHaveBeenCalled();
        recent.resolve(); await recentSave; expect(f.onSaved).toHaveBeenCalledOnce();
        const lateFailure = deferred(); f.saveDraft.mockReturnValueOnce(lateFailure.promise);
        f.draft.to = 'ja'; const lateSave = f.editor.save(); f.editor.dispose();
        lateFailure.reject(new Error('disposed')); await lateSave; expect(f.onSaveError).toHaveBeenCalledOnce();
    });

    it('suppresses synchronous hydration watchers and releases the guard when writing fails', async () => {
        const f = fixture(); f.editor.initialize({to: 'en'});
        const watcher = watch(() => f.draft.to, () => {expect(f.editor.applying).toBe(true); void f.editor.save();}, {flush: 'sync'});
        f.editor.hydrate({to: 'ja'}); expect(f.saveDraft).not.toHaveBeenCalled(); watcher.stop();
        f.writeDraft.mockImplementationOnce(() => {throw new Error('write failed');});
        expect(() => f.editor.hydrate({to: 'fr'})).toThrow('write failed'); expect(f.editor.applying).toBe(false);
        f.draft.to = 'de'; await f.editor.save(); expect(f.saveDraft).toHaveBeenCalledOnce();
    });

    it.each([
        ['success', 'none'], ['success', 'draft'], ['success', 'pending'],
        ['failure', 'none'], ['failure', 'draft'], ['failure', 'pending'],
    ] as const)('releases settled ownership after %s while preserving a %s successor', async (outcome, successor) => {
        const f = fixture(); f.editor.initialize({to: 'en'});
        const first = deferred(), second = deferred();
        f.saveDraft.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        f.draft.to = 'fr'; const saving = f.editor.save();
        f.editor.hydrate({to: 'de', theme: 'dark'});
        expect(f.draft.to).toBe('fr'); expect(f.draft.theme).toBe('dark');
        let newer: Promise<void> | undefined;
        if (successor !== 'none') f.draft.to = 'ja';
        if (successor === 'pending') newer = f.editor.save();
        if (outcome === 'success') first.resolve(); else first.reject(new Error('save failed'));
        await saving;
        expect(f.draft.to).toBe(successor !== 'none' ? 'ja' : outcome === 'success' ? 'de' : 'fr');
        expect(f.draft.theme).toBe('dark');
        if (successor === 'pending') {
            expect(f.onSaved).not.toHaveBeenCalled(); expect(f.onSaveError).not.toHaveBeenCalled();
            // 此请求开始后没有确认快照，旧 authority 不能把已经提交的更新回退。
            second.resolve(); await newer; expect(f.draft.to).toBe('ja');
        } else if (outcome === 'failure' || successor === 'draft') {
            const retry = f.editor.save(); second.resolve(); await retry;
            expect(f.saveDraft.mock.calls[1][1].to).toBe('de');
            expect(f.saveDraft.mock.calls[1][0].to).toBe(successor === 'draft' ? 'ja' : 'fr');
        } else {
            await f.editor.save(); expect(f.saveDraft).toHaveBeenCalledOnce();
        }
    });

    it('does not treat a pre-request authority as a confirmation, and feedback invalidation still permits failed edits to retry', async () => {
        const f = fixture(); f.editor.initialize({to: 'en'});
        f.draft.to = 'fr'; await f.editor.save(); expect(f.draft.to).toBe('fr');
        await f.editor.save(); expect(f.saveDraft).toHaveBeenCalledOnce();
        const failed = deferred(); f.saveDraft.mockReturnValueOnce(failed.promise);
        f.draft.to = 'ja'; const saving = f.editor.save(); f.editor.invalidateFeedback();
        failed.reject(new Error('feedback obsolete')); await saving;
        expect(f.onSaveError).not.toHaveBeenCalled();
        await f.editor.save(); expect(f.saveDraft).toHaveBeenCalledTimes(3); expect(f.draft.to).toBe('ja');
    });

    it('reconciles a canonical snapshot after success even when feedback has been invalidated', async () => {
        const f = fixture(); f.editor.initialize({to: 'en'});
        const pending = deferred(); f.saveDraft.mockReturnValueOnce(pending.promise);
        f.draft.to = 'fr'; const saving = f.editor.save();
        f.editor.hydrate({to: 'de'}); f.editor.invalidateFeedback(); pending.resolve(); await saving;
        expect(f.draft.to).toBe('de'); expect(f.onSaved).not.toHaveBeenCalled();
        const calls = f.saveDraft.mock.calls.length; await f.editor.save(); expect(f.saveDraft).toHaveBeenCalledTimes(calls);
    });
});

describe('Vue configuration editor adapter', () => {
    function vueFixture(flush: 'sync' | 'post', ready = Promise.resolve(), synchronous = true) {
        const draft = reactive(new Config()), authority = normalizeConfig({to: 'en'});
        let notify!: (snapshot: Config) => void;
        const onReady = vi.fn(), onReadyError = vi.fn(), onSaveError = vi.fn(), unsubscribe = vi.fn();
        const saveDraft = vi.fn((_snapshot: Config, _previous: Config) => Promise.resolve());
        const editor = useConfigEditor({copySnapshot: normalizeConfig, readDraft: () => draft, writeDraft: snapshot => {Object.assign(draft, snapshot);},
            saveDraft, ready, readAuthority: () => authority, flush,
            subscribe: listener => {notify = listener; if (synchronous) listener(authority); return unsubscribe;},
            onEdited: vi.fn(), onSaved: vi.fn(), onSaveError, onReady, onReadyError});
        return {draft, editor, saveDraft, onReady, onReadyError, onSaveError, unsubscribe, notify: (value: unknown) => notify(normalizeConfig(value))};
    }
    async function settle() {await nextTick(); for (let i = 0; i < 5; i++) await Promise.resolve(); await nextTick();}

    it('supports immediate subscriptions, sync saving and hydration without serializing the whole reactive draft', async () => {
        const f = vueFixture('sync'); await settle(); expect(f.onReady).toHaveBeenCalledOnce(); expect(f.editor.ready).toBe(true);
        f.notify({to: 'ja', theme: 'dark'}); expect(f.saveDraft).not.toHaveBeenCalled();
        f.draft.to = 'fr'; expect(f.saveDraft).toHaveBeenCalledOnce();
        const stringify = JSON.stringify; let scans = 0;
        const spy = vi.spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
            if (value === f.draft) scans++;
            return stringify(value, replacer, space);
        });
        f.notify({...f.draft, to: 'de', theme: 'light'}); expect(scans).toBe(0); spy.mockRestore();
        expect(f.editor.applying).toBe(false); f.editor.dispose(); f.notify({to: 'en'});
        expect(f.draft.to).toBe('fr'); f.editor.dispose(); expect(f.unsubscribe).toHaveBeenCalledOnce();
    });

    it('coalesces post edits atomically and protects same-tick local fields from an external snapshot', async () => {
        const f = vueFixture('post', Promise.resolve(), false); await settle();
        f.draft.documentModel.deepseek = customModelString; f.draft.documentCustomModel.deepseek = 'local-model'; f.draft.to = 'fr';
        f.notify({to: 'en', theme: 'dark'}); expect(f.draft.to).toBe('fr'); expect(f.draft.theme).toBe('dark');
        // Hydration rebuilds dependencies under its guard; explicitly saving retains the unpublished dirty fields.
        await f.editor.save();
        expect(f.saveDraft).toHaveBeenCalledOnce(); expect(f.saveDraft.mock.calls[0][0]).toMatchObject({to: 'fr', documentCustomModel: {deepseek: 'local-model'}});
        f.editor.dispose();
    });

    it.each(['sync', 'post'] as const)('observes nested keys, arrays and removed/readded top-level fields with %s timing', async flush => {
        const f = vueFixture(flush); await settle();
        const changes = [
            () => {f.draft.customBody.openai = '{"temperature":0.1}';},
            () => {f.draft.customBody.deepseek = '{"temperature":0.2}';},
            () => {delete f.draft.customBody.deepseek;},
            () => {f.draft.excludedLanguages.push('en');},
            () => {f.draft.excludedLanguages.splice(0, 1, 'fr');},
            () => {f.draft.excludedLanguages.pop();},
            () => {delete (f.draft as Partial<Config>).customBody;},
            () => {f.draft.customBody = {openai: '{"temperature":0.3}'};},
        ];
        for (const [index, change] of changes.entries()) {
            change();
            expect(f.saveDraft).toHaveBeenCalledTimes(flush === 'sync' ? index + 1 : index);
            await nextTick(); expect(f.saveDraft).toHaveBeenCalledTimes(index + 1);
        }
        expect(f.saveDraft.mock.lastCall?.[0]).toMatchObject({excludedLanguages: [], customBody: {openai: '{"temperature":0.3}'}});
        f.editor.dispose();
    });

    it('coalesces several post edits into one synchronous snapshot handoff', async () => {
        const f = vueFixture('post'); await settle();
        f.draft.to = 'fr'; f.draft.theme = 'dark'; f.draft.customBody.openai = '{"temperature":0.1}';
        expect(f.saveDraft).not.toHaveBeenCalled();
        await nextTick(); expect(f.saveDraft).toHaveBeenCalledOnce();
        expect(f.saveDraft.mock.lastCall?.[0]).toMatchObject({to: 'fr', theme: 'dark', customBody: {openai: '{"temperature":0.1}'}});
        f.editor.dispose();
    });

    it('ignores replacement by an equivalent root and tracks the replacement branches', async () => {
        const draft = ref(new Config()), saveDraft = vi.fn(async () => {});
        const editor = useConfigEditor({copySnapshot: normalizeConfig, readDraft: () => draft.value,
            writeDraft: snapshot => {draft.value = snapshot;}, saveDraft, ready: Promise.resolve(), readAuthority: () => new Config(),
            subscribe: () => () => {}, flush: 'sync', onEdited: vi.fn(), onSaved: vi.fn(), onSaveError: vi.fn(), onReady: vi.fn(), onReadyError: vi.fn()});
        await settle();
        draft.value = normalizeConfig(draft.value); expect(saveDraft).not.toHaveBeenCalled();
        draft.value.customBody.openai = '{"temperature":0.1}'; expect(saveDraft).toHaveBeenCalledOnce();
        editor.dispose();
    });

    it.each(['sync', 'post'] as const)('does not rescan an unchanged 5000-entry glossary while typing with %s timing', async flush => {
        const f = vueFixture(flush); await settle();
        f.notify({...f.draft, glossaryLibraries: Array.from({length: 10}, (_, library) => ({
            id: `library-${library}`, name: `Library ${library}`, enabled: true, sourceLanguage: 'en', targetLanguage: 'zh-Hans', domains: [],
            entries: Array.from({length: 500}, (_, entry) => ({id: `term-${entry}`, source: `term ${entry}`, target: `术语${entry}`, caseSensitive: false})),
        }))});
        await settle();
        let sourceReads = 0, watcherSourceReads = 0, watcherSerializations = 0;
        for (const library of f.draft.glossaryLibraries) for (const entry of library.entries) {
            const source = entry.source;
            Object.defineProperty(toRaw(entry), 'source', {enumerable: true, configurable: true, get() {sourceReads++; return source;}});
        }
        const stringify = JSON.stringify, glossary = f.draft.glossaryLibraries;
        const spy = vi.spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
            const watcherScan = value === f.draft || value === glossary;
            if (watcherScan) watcherSerializations++;
            const before = sourceReads, result = stringify(value, replacer, space);
            if (watcherScan) watcherSourceReads += sourceReads - before;
            return result;
        });
        try {
            for (let index = 0; index < 20; index++) {
                f.draft.customBody.openai = `{"temperature":${index}}`;
                await nextTick();
            }
            expect(f.saveDraft).toHaveBeenCalledTimes(20);
            // 保存端仍捕获完整独立快照：计数明确保留的成本，不能把 watcher 优化表述为整条链路零遍历。
            expect({watcherSerializations, watcherSourceReads, snapshotSourceReads: sourceReads - watcherSourceReads})
                .toEqual({watcherSerializations: 0, watcherSourceReads: 0, snapshotSourceReads: 20 * 5000});
        } finally {
            spy.mockRestore(); f.editor.dispose();
        }
    });

    it('does not initialize or notify after disposal, reports readiness rejection and hydration exceptions', async () => {
        const ready = deferred(); const f = vueFixture('sync', ready.promise); f.editor.dispose(); ready.resolve(); await settle();
        expect(f.onReady).not.toHaveBeenCalled(); expect(f.editor.ready).toBe(false);
        const rejected = deferred(); const g = vueFixture('post', rejected.promise); rejected.reject(new Error('ready failed')); await settle();
        expect(g.onReadyError).toHaveBeenCalledWith(expect.any(Error)); g.draft.to = 'fr'; await settle(); expect(g.saveDraft).not.toHaveBeenCalled(); g.editor.dispose();
        const late = deferred(); const h = vueFixture('post', late.promise); h.editor.dispose(); late.reject(new Error('late')); await settle(); expect(h.onReadyError).not.toHaveBeenCalled();
        const k = vueFixture('sync'); k.onReady.mockImplementation(() => {throw new Error('ready callback');}); await settle();
        expect(k.onReadyError).toHaveBeenCalledWith(expect.any(Error)); k.editor.dispose();
    });

    it('recovers its reactive watcher when a hydration getter throws once', async () => {
        const f = vueFixture('sync'); await settle();
        const stringify = JSON.stringify, previousHarness = toRaw(f.draft.harness); let failed = false;
        const warn = vi.spyOn(console, 'warn').mockImplementationOnce(() => {});
        const spy = vi.spyOn(JSON, 'stringify').mockImplementation((value, replacer, space) => {
            if (value && typeof value === 'object' && isReactive(value) && toRaw(value) !== previousHarness && 'hoverDelay' in value && !failed) {failed = true; throw new Error('draft getter');}
            return stringify(value, replacer, space);
        });
        try {
            expect(() => f.notify({to: 'ja'})).toThrow('draft getter');
            expect(f.editor.applying).toBe(false); spy.mockRestore();
            expect(warn).toHaveBeenCalledOnce();
            expect(warn).toHaveBeenCalledWith('[Vue warn]: Unhandled error during execution of watcher getter');
            f.draft.to = 'fr'; expect(f.saveDraft).toHaveBeenCalledOnce();
        } finally {
            spy.mockRestore(); warn.mockRestore(); f.editor.dispose();
        }
    });
});
