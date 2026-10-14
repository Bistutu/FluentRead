import 'fake-indexeddb/auto';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createHarnessConversationRuntime} from '@/src/services/harness/conversation';
import {FluentReadHarnessSessionDatabase, HarnessSessionRepository} from '@/src/platform/storage/harnessSessionRepository';
import type {HarnessRuntime} from '@/src/services/harness/runtime';
import type {ReadingProgress, ReadingRequest, ReadingResponse} from '@/src/features/reading-assistant/types';
const databases: FluentReadHarnessSessionDatabase[] = [];
let sequence = 0;
const request = (extra: Partial<ReadingRequest> = {}): ReadingRequest => ({type: 'fluentReadHarness', action: 'run', requestId: 'run', selection: {text: 'Original sentence', context: 'Original paragraph', sentence: ''}, intent: 'meaning', question: '', ...extra});
const success: ReadingResponse = {success: true, text: 'First paragraph.\n\nSecond paragraph.', model: 'm', service: 'openai'};
function repository(name = `Harness-real-conversation-${++sequence}`) {const database = new FluentReadHarnessSessionDatabase(name); databases.push(database); return new HarnessSessionRepository(database);}
function conversation(store: HarnessSessionRepository, runtime: HarnessRuntime) {return createHarnessConversationRuntime({store, runtime, preferences: () => ({contextMode: 'paragraph', maxContextChars: 1500})});}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {resolve = done;});
    return {promise, resolve};
}
afterEach(async () => {
    vi.useRealTimers();vi.restoreAllMocks();
    for (const database of databases.splice(0)) {database.close(); await database.delete();}
});

describe('Harness streaming with real IndexedDB persistence', () => {
    it('retains a cached practice question after other actions have added more than four later turns', async () => {
        const store = repository();
        const runtime: HarnessRuntime = {run: vi.fn(async (input) => ({...success, text: `${input.intent}: ${input.question || 'Original exercise'}`}))};
        const current = conversation(store, runtime);
        const initial = await current.run(request({intent: 'practice'}), new AbortController().signal);
        if (!initial.success) throw new Error('Expected practice success');
        const sessionId = initial.sessionId;
        const anchorTurnId = initial.turnId;
        expect(anchorTurnId).toBeTruthy();
        for (let index = 0; index < 5; index += 1) await current.run(request({sessionId, question: `Meaning question ${index}`}), new AbortController().signal);
        await current.run(request({sessionId, anchorTurnId, intent: 'practice', question: 'My exercise answer', history: [{question: 'fake exercise', answer: 'fake feedback'}]}), new AbortController().signal);
        expect(vi.mocked(runtime.run).mock.calls.at(-1)![0].history).toEqual([{question: '练习', answer: 'practice: Original exercise'}]);
        const saved = await store.get(sessionId!);
        expect(saved?.turns).toHaveLength(7);
        expect(saved?.turns.at(-1)?.question).toBe('My exercise answer');
    });
    it('creates a session before model metadata arrives and restores exact saved answers for follow-up', async () => {
        const store = repository();
        const runtime: HarnessRuntime = {run: vi.fn(async (_request, _signal, publish) => {publish?.({kind: 'model', service: 'openai', model: 'm'}); publish?.({kind: 'text', text: 'First'}); return success;})};
        const current = conversation(store, runtime);
        const result = await current.run(request(), new AbortController().signal);
        expect(result.success && result.sessionId).toBeTruthy();
        if (!result.success) throw new Error('Expected success');
        const saved = await store.get(result.sessionId!);
        expect(saved?.turns[0]).toMatchObject({answer: success.text, status: 'completed', service: 'openai', model: 'm'});
        expect(saved?.turns[0].answer).toContain('\n\n');
        await current.run(request({sessionId: result.sessionId, selection: {text: 'Wrong page', context: 'Wrong paragraph', sentence: ''}, question: 'Why?'}), new AbortController().signal);
        const followup = vi.mocked(runtime.run).mock.calls[1][0];
        expect(followup.selection).toMatchObject({text: 'Original sentence', context: 'Original paragraph'});
        expect(followup.history).toEqual([{question: '读懂', answer: success.text}]);
        expect((await store.get(result.sessionId!))?.turns).toHaveLength(2);
    });
    it('checkpoints partial output and retains it as stopped when the user cancels', async () => {
        // 仅控制节流时钟；真实 IndexedDB 事务仍由正常事件循环提交。
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
        const store = repository();
        const started = deferred<(progress: ReadingProgress) => void>();
        const checkpointCommitted = deferred<void>();
        const upsertTurn = store.upsertTurn.bind(store);
        const save = vi.spyOn(store, 'upsertTurn').mockImplementation(async (...args) => {
            const saved = await upsertTurn(...args);
            if (args[1].answer === '已生成一部分' && args[1].status === 'streaming') checkpointCommitted.resolve();
            return saved;
        });
        let finish!: (response: ReadingResponse) => void;
        const current = conversation(store, {run: async (_request, _signal, callback) => {
            started.resolve(callback!);
            return new Promise(resolve => {finish = resolve;});
        }});
        const controller = new AbortController();
        const running = current.run(request(), controller.signal);
        const publish = await started.promise;
        publish({kind: 'text', text: '已生成一部分'});
        expect(save).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(499);
        expect(save).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        await checkpointCommitted.promise;
        expect(save).toHaveBeenCalledTimes(2);
        const id = (await store.list()).sessions[0].id;
        expect((await store.get(id))?.turns[0]).toMatchObject({answer: '已生成一部分', status: 'streaming', service: '', model: ''});
        controller.abort(); finish(success);
        expect(await running).toMatchObject({cancelled: true});
        expect((await store.get(id))?.turns[0]).toMatchObject({answer: '已生成一部分', status: 'stopped'});
    });
    it('clear during an active stream prevents final write resurrection in the real repository', async () => {
        const store = repository();
        const started = deferred<(response: ReadingResponse) => void>();
        const current = conversation(store, {run: async () => new Promise(resolve => {started.resolve(resolve);})});
        const running = current.run(request(), new AbortController().signal);
        const finish = await started.promise;
        expect((await store.list()).sessions).toHaveLength(1);
        await store.clear(); finish(success);
        expect(await running).toMatchObject({success: true, persistenceWarning: expect.any(String)});
        expect((await store.list()).sessions).toEqual([]);
    });
    it.each(['delete', 'clear'] as const)('%s while a saved session is loading prevents its stale snapshot from being saved again', async operation => {
        const store = repository();
        const current = conversation(store, {run: async () => success});
        const initial = await current.run(request(), new AbortController().signal);
        if (!initial.success || !initial.sessionId) throw new Error('Expected a saved session');
        const sessionId = initial.sessionId;
        const readSession = store.get.bind(store);
        let announceSnapshot!: () => void;
        let releaseSnapshot!: () => void;
        const snapshotReady = new Promise<void>(resolve => {announceSnapshot = resolve;});
        const snapshotReleased = new Promise<void>(resolve => {releaseSnapshot = resolve;});
        vi.spyOn(store, 'get').mockImplementationOnce(async id => {
            const snapshot = await readSession(id);
            announceSnapshot();
            await snapshotReleased;
            return snapshot;
        });
        const restoring = current.run(request({sessionId, question: 'Continue?'}), new AbortController().signal);
        await snapshotReady;
        if (operation === 'delete') await store.delete(sessionId);
        else await store.clear();
        expect(await readSession(sessionId)).toBeNull();
        releaseSnapshot();
        const result = await restoring;
        expect(result).toMatchObject({success: true, persistenceWarning: expect.any(String)});
        expect(result).not.toHaveProperty('sessionId');
        expect(await readSession(sessionId)).toBeNull();
        expect((await store.list()).sessions).toEqual([]);
    });
    it('recovers an interrupted checkpoint after a new repository instance starts', async () => {
        const name = `Harness-restart-${++sequence}`;
        const first = repository(name);
        const now = Date.now();
        await first.upsertTurn({id: 'session', text: 'Saved', context: '', createdAt: now, updatedAt: now, intent: 'grammar'}, {id: 'turn', question: '拆句', answer: 'Partial\nanswer', intent: 'grammar', status: 'streaming', createdAt: now, service: '', model: ''}, first.captureGeneration('session'));
        first.database.close();
        const restarted = repository(name);
        await restarted.recoverInterrupted();
        expect((await restarted.get('session'))?.turns[0]).toMatchObject({answer: 'Partial\nanswer', status: 'stopped'});
    });
});
