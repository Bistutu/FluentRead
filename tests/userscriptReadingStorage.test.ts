import {afterEach, describe, expect, it, vi} from 'vitest';
import {createUserscriptReadingStorage, type UserscriptReadingStoragePort} from '@/userscript/readingStorage';
import {HARNESS_SESSION_TTL_MS} from '@/src/services/harness/sessions';
import type {HarnessStoredTurn} from '@/src/services/harness/sessionTypes';

const NOW = 1_800_000_000_000;
const prefix = 'fluentread:reading:v1:operation:';
const memoryId = (number: number) => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function deferred() {let resolve!: () => void; const promise = new Promise<void>(yes => {resolve = yes;}); return {promise, resolve};}
function fixture() {
    const values = new Map<string, unknown>();
    let sequence = 0, clock = NOW, memorySequence = 0;
    const storage: UserscriptReadingStoragePort = {
        get: vi.fn(async key => values.has(key) ? structuredClone(values.get(key)) : null),
        set: vi.fn(async (key, value) => {values.set(key, structuredClone(value));}),
        remove: vi.fn(async key => {values.delete(key);}),
        list: vi.fn(async () => [...values.keys()]),
    };
    const create = (extra: Parameters<typeof createUserscriptReadingStorage>[0] = {}) => createUserscriptReadingStorage({
        storage, now: () => clock, operationId: () => `operation-${++sequence}`, id: () => memoryId(++memorySequence), ...extra,
    });
    return {values, storage, create, time: (value: number) => {clock = value;}};
}
const header = (id = 'session-1', updatedAt = NOW) => ({id, text: 'Readable source', context: 'Context', createdAt: NOW, updatedAt, intent: 'meaning' as const});
const turn = (id = 'turn-1', patch: Partial<HarnessStoredTurn> = {}): HarnessStoredTurn => ({id, question: 'Meaning?', answer: 'An answer',
    intent: 'meaning', status: 'completed', createdAt: NOW, service: 'openai', model: 'fixture-model', ...patch});
const tick = async () => {for (let count = 0; count < 20; count++) await Promise.resolve();};
afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks();});

describe('userscript GM 阅读会话', () => {
    it('只写专用GM命名空间和白名单，保持更新合并、摘要分页及读取对象隔离', async () => {
        const f = fixture(); const api = f.create(); await api.ready;
        f.values.set('local:config', {credential: 'must-stay-outside-reading'});
        const token = api.sessions.captureGeneration('session-1');
        await expect(api.sessions.upsertTurn({...header(), credential: 'discard'} as never, {...turn(), url: 'discard'} as never, token)).resolves.toBe(true);
        await expect(api.sessions.upsertTurn(header(), turn('turn-2', {status: 'streaming', answer: 'partial'}), token)).resolves.toBe(true);
        const saved = await api.sessions.get('session-1');
        expect(saved).toMatchObject({text: 'Readable source', turns: [{id: 'turn-1', status: 'completed'}, {id: 'turn-2', status: 'stopped'}]});
        saved!.turns[0].answer = 'mutated reader';
        expect((await api.sessions.get('session-1'))!.turns[0].answer).toBe('An answer');
        await api.sessions.upsertTurn(header(), turn('turn-1', {answer: 'replacement'}), token);
        expect((await api.sessions.get('session-1'))!.turns).toHaveLength(2);
        expect([...f.values.values()].filter(row => (row as any).kind === 'session-turn')).toHaveLength(2);
        const other = header('session-2', NOW + 1);
        await api.sessions.upsertTurn(other, turn('turn-3'), api.sessions.captureGeneration(other.id));
        expect(await api.sessions.list(0, 1)).toEqual({sessions: [{id: other.id, text: other.text, intent: other.intent, updatedAt: NOW + 1, turnCount: 1}], hasMore: true});
        expect((await api.sessions.list(1, 1)).sessions[0].id).toBe('session-1');
        expect((await api.sessions.list(-1, 0)).sessions).toHaveLength(2);
        expect((await api.sessions.list(0, 101)).hasMore).toBe(false);
        expect(await api.sessions.get('missing')).toBeNull();
        expect(JSON.stringify([...f.values.entries()].filter(([key]) => key.startsWith(prefix)))).not.toContain('discard');
        expect(f.values.get('local:config')).toEqual({credential: 'must-stay-outside-reading'});
    });

    it('两个独立标签并发写入同会话不同turn不互相覆盖，分隔符ID也保持独立', async () => {
        const f = fixture(); const a = f.create(), b = f.create(); await Promise.all([a.ready, b.ready]);
        const start = deferred(); const originalSet = f.storage.set;
        f.storage.set = vi.fn(async (key, value) => {await start.promise; await originalSet(key, value);});
        const writes = [a.sessions.upsertTurn(header(), turn('a'), a.sessions.captureGeneration('session-1')),
            b.sessions.upsertTurn(header(), turn('b'), b.sessions.captureGeneration('session-1'))];
        await tick(); start.resolve();
        expect(await Promise.all(writes)).toEqual([true, true]);
        expect((await a.sessions.get('session-1'))!.turns.map(item => item.id)).toEqual(['a', 'b']);
        await a.sessions.upsertTurn(header('a:b'), turn('c'), a.sessions.captureGeneration('a:b'));
        await a.sessions.upsertTurn(header('a'), turn('b:c'), a.sessions.captureGeneration('a'));
        expect((await a.sessions.get('a:b'))!.turns[0].id).toBe('c');
        expect((await a.sessions.get('a'))!.turns[0].id).toBe('b:c');
        expect((await a.sessions.list()).sessions.map(item => item.id)).toEqual(['a', 'a:b', 'session-1']);
    });

    it.each(['delete', 'clear'] as const)('%s 同步废弃本地token且跨标签墓碑阻止GM迟到提交复活', async action => {
        const f = fixture(); const a = f.create(), b = f.create(); await Promise.all([a.ready, b.ready]);
        const token = a.sessions.captureGeneration('session-1');
        await a.sessions.upsertTurn(header(), turn(), token);
        const held = deferred(), entered = deferred(); const originalSet = f.storage.set;
        f.storage.set = vi.fn(async (key, value) => {
            if ((value as any).kind === 'session-turn' && (value as any).turn.answer === 'late') {entered.resolve(); await held.promise;}
            await originalSet(key, value);
        });
        const late = a.sessions.upsertTurn(header(), turn('late', {answer: 'late'}), token);
        await entered.promise;
        await (action === 'delete' ? b.sessions.delete('session-1') : b.sessions.clear());
        held.resolve(); await expect(late).resolves.toBe(false);
        expect(await b.sessions.get('session-1')).toBeNull();
        await expect(a.sessions.upsertTurn(header(), turn(), token)).resolves.toBe(false);
        const next = a.sessions.captureGeneration('session-1');
        await expect(a.sessions.upsertTurn(header(), turn(), next)).resolves.toBe(true);
        const old = a.sessions.captureGeneration('session-1');
        const removed = action === 'delete' ? a.sessions.delete('session-1') : a.sessions.clear();
        await expect(a.sessions.upsertTurn(header(), turn('stale'), old)).resolves.toBe(false); await removed;
        expect(await a.sessions.get('session-1')).toBeNull();
        const reopened = f.create(); await reopened.ready;
        await expect(reopened.sessions.upsertTurn(header(), turn(), reopened.sessions.captureGeneration('session-1'))).resolves.toBe(true);
    });

    it('逐turn执行30天边界，过期不会随新的问答续期，热写不读取别的会话正文', async () => {
        const f = fixture(); const api = f.create(); await api.ready;
        const token = api.sessions.captureGeneration('session-1');
        await api.sessions.upsertTurn(header(), turn('old'), token);
        f.time(NOW + HARNESS_SESSION_TTL_MS - 1);
        await api.sessions.upsertTurn(header('session-1', NOW + HARNESS_SESSION_TTL_MS - 1), turn('fresh', {createdAt: NOW + HARNESS_SESSION_TTL_MS - 1}), token);
        f.time(NOW + HARNESS_SESSION_TTL_MS);
        expect(await api.sessions.prune()).toBe(1);
        expect((await api.sessions.get('session-1'))!.turns.map(item => item.id)).toEqual(['fresh']);
        await expect(api.sessions.upsertTurn(header(), turn(), token)).resolves.toBe(false);
        expect(await api.sessions.prune()).toBe(0);
        for (let index = 0; index < 10; index++) await api.sessions.upsertTurn(header('other-' + index), turn('other', {createdAt: NOW + HARNESS_SESSION_TTL_MS}), api.sessions.captureGeneration('other-' + index));
        vi.mocked(f.storage.get).mockClear();
        await api.sessions.upsertTurn(header('session-1', NOW + HARNESS_SESSION_TTL_MS), turn('fresh', {createdAt: NOW + HARNESS_SESSION_TTL_MS}), token);
        expect(vi.mocked(f.storage.get).mock.calls.every(([key]) => !key.includes('other-'))).toBe(true);
    });

    it('拒绝伪造或串会话token、非法输入，并在GM失败后允许后续任务重试', async () => {
        const f = fixture(); const api = f.create(); await api.ready;
        const token = api.sessions.captureGeneration('session-1');
        await expect(api.sessions.upsertTurn(header(), turn(), {...token})).resolves.toBe(false);
        await expect(api.sessions.upsertTurn(header('other'), turn(), token)).resolves.toBe(false);
        await expect(api.sessions.upsertTurn({...header(), text: ''}, turn(), token)).rejects.toThrow();
        await expect(api.sessions.delete('bad id')).rejects.toThrow();
        vi.mocked(f.storage.set).mockRejectedValueOnce(new Error('GM unavailable'));
        await expect(api.sessions.upsertTurn(header(), turn(), token)).rejects.toThrow('GM unavailable');
        await expect(api.sessions.upsertTurn(header(), turn(), token)).resolves.toBe(true);
        f.values.clear();
        expect(await api.sessions.get('session-1')).toBeNull();
        await expect(api.sessions.upsertTurn(header(), turn(), api.sessions.captureGeneration('session-1'))).resolves.toBe(true);
    });

    it('较旧动作的迟到turn不覆盖更新的会话标题，其他会话删除不作废本会话', async () => {
        const f = fixture(); const api = f.create(); await api.ready;
        const token = api.sessions.captureGeneration('session-1');
        await api.sessions.upsertTurn({...header(), intent: 'grammar', updatedAt: NOW + 5}, turn('new', {createdAt: NOW + 5}), token);
        await api.sessions.delete('unrelated');
        await expect(api.sessions.upsertTurn(header(), turn('old'), token)).resolves.toBe(true);
        expect(await api.sessions.get('session-1')).toMatchObject({intent: 'grammar', updatedAt: NOW + 5});
        expect((await api.sessions.get('session-1'))!.turns.map(item => item.id)).toEqual(['old', 'new']);
    });
});

describe('userscript GM 学习笔记', () => {
    it('无关删除仍改变公开代次，但不会让新笔记正文随历史删除次数膨胀', async () => {
        const f = fixture(); const a = f.create(), b = f.create(); await Promise.all([a.ready, b.ready]);
        const persisted = (id: string) => [...f.values.values()].find((row: any) => row.kind === 'memory-save' && row.memory.id === id) as {fence: string[]};
        for (let index = 0; index < 20; index++) await b.memories.delete(memoryId(1000 + index));
        const first = await a.memories.save({kind: 'note', content: 'first note'});
        expect(persisted(first.id).fence).toEqual([]);
        const firstBytes = JSON.stringify(persisted(first.id)).length;
        const generation = await a.memories.captureGeneration(); expect(generation).toBe(20);
        for (let index = 0; index < 100; index++) await b.memories.delete(memoryId(2000 + index));
        await expect(a.memories.save({kind: 'note', content: 'stale note'}, generation)).rejects.toThrow('已变更');
        const second = await a.memories.save({kind: 'note', content: 'other note'}, await a.memories.captureGeneration());
        expect(persisted(second.id).fence).toEqual([]);
        expect(JSON.stringify(persisted(second.id)).length - firstBytes).toBeLessThan(10);
        expect(await a.memories.list()).toHaveLength(2);
    });

    it('精简fence仍保留当前ID、相同内容及清空标记，明确重新添加后可正常编辑', async () => {
        const f = fixture(); const a = f.create(), b = f.create(); await Promise.all([a.ready, b.ready]);
        const first = await a.memories.save({kind: 'note', content: 'same content'});
        await b.memories.delete(first.id);
        const duplicate = await a.memories.save({kind: 'note', content: 'same content'});
        const rows = () => [...f.values.values()] as Array<{id: string; kind: string; target?: string; fence: string[]; memory?: {id: string}}>;
        const firstDelete = rows().find(row => row.kind === 'memory-delete' && row.target === first.id)!.id;
        expect(rows().find(row => row.memory?.id === duplicate.id)!.fence).toEqual([firstDelete]);
        await b.memories.delete(duplicate.id); await b.memories.clear();
        const secondDelete = rows().find(row => row.kind === 'memory-delete' && row.target === duplicate.id)!.id;
        const clear = rows().find(row => row.kind === 'memories-clear')!.id;
        const reopened = f.create({id: () => first.id}); await reopened.ready;
        const added = await reopened.memories.save({kind: 'note', content: 'different content'});
        expect(new Set(rows().find(row => row.memory?.id === added.id)!.fence)).toEqual(new Set([firstDelete, clear]));
        await reopened.memories.save({id: added.id, kind: 'note', content: 'same content'});
        expect(new Set(rows().find(row => row.memory?.id === added.id)!.fence)).toEqual(new Set([firstDelete, secondDelete, clear]));
        expect(await a.memories.list()).toMatchObject([{id: first.id, content: 'same content'}]);
    });

    it('字段校验、幂等重复、编辑冲突、代次删除、重新打开与白名单保持扩展合同', async () => {
        const f = fixture(); const api = f.create(); await api.ready;
        const first = await api.memories.save({kind: 'note', content: '  note  ', credential: 'discard'} as never);
        expect(first).toEqual({id: memoryId(1), kind: 'note', content: 'note', createdAt: NOW, updatedAt: NOW});
        expect(await api.memories.save({kind: 'note', content: 'note'})).toEqual(first);
        const second = await api.memories.save({kind: 'lesson', content: 'lesson'});
        const generation = await api.memories.captureGeneration();
        f.time(NOW - 1);
        const changed = await api.memories.save({id: first.id, kind: 'note', content: 'updated'}, generation);
        expect(changed.createdAt).toBe(NOW); expect(changed.updatedAt).toBe(NOW);
        await expect(api.memories.save({id: second.id, kind: 'note', content: 'updated'})).rejects.toThrow('相同内容');
        await api.memories.delete(first.id);
        await expect(api.memories.save({kind: 'note', content: 'late'}, generation)).rejects.toThrow('已变更');
        await expect(api.memories.save({id: first.id, kind: 'note', content: 'restore'})).rejects.toThrow('已被删除');
        expect((await api.memories.list()).map(item => item.id)).toEqual([second.id]);
        const reopened = f.create(); await reopened.ready;
        expect(await reopened.memories.captureGeneration()).toBe(1);
        expect((await reopened.memories.list())[0]).toEqual(second);
        await reopened.memories.clear();
        expect(await api.memories.list()).toEqual([]);
        expect(JSON.stringify([...f.values.values()])).not.toContain('discard');
        await expect(api.memories.save({kind: 'bad', content: 'x'} as never)).rejects.toThrow();
        await expect(api.memories.save({kind: 'note', content: 'x'}, -1)).rejects.toThrow('已变更');
        await expect(api.memories.delete('bad')).rejects.toThrow('标识');
    });

    it('两个独立标签并发保存不同笔记不覆盖，并发同项编辑确定性择新', async () => {
        const f = fixture(); const a = f.create(), b = f.create(); await Promise.all([a.ready, b.ready]);
        const [left, right] = await Promise.all([a.memories.save({kind: 'note', content: 'left'}), b.memories.save({kind: 'note', content: 'right'})]);
        expect(new Set((await a.memories.list()).map(item => item.id))).toEqual(new Set([left.id, right.id]));
        f.time(NOW + 1);
        const edits = await Promise.allSettled([a.memories.save({id: left.id, kind: 'note', content: 'edit A'}), b.memories.save({id: left.id, kind: 'note', content: 'edit B'})]);
        expect(edits.some(result => result.status === 'fulfilled')).toBe(true);
        expect(await a.memories.list()).toEqual(await b.memories.list());
        expect((await a.memories.list())).toHaveLength(2);
    });

    it('并发重复创建幂等，删除后迟到重复正文即使没有完成回调也不复活', async () => {
        const f = fixture(); const a = f.create(), b = f.create(); await Promise.all([a.ready, b.ready]);
        const entered = deferred(), write = deferred(), committed = deferred(), release = deferred();
        const originalSet = f.storage.set;
        f.storage.set = vi.fn(async (key, value) => {
            if ((value as any).kind === 'memory-save' && (value as any).memory.id === memoryId(2)) {
                entered.resolve(); await write.promise; await originalSet(key, value); committed.resolve(); await release.promise;
            } else await originalSet(key, value);
        });
        const saves = [a.memories.save({kind: 'note', content: 'same note'}), b.memories.save({kind: 'note', content: 'same note'})];
        const late = saves[1].catch(error => error);
        await entered.promise; const first = await saves[0];
        await a.memories.delete(first.id); write.resolve(); await committed.promise;
        expect(await a.memories.list()).toEqual([]);
        release.resolve(); expect(await late).toMatchObject({message: '学习笔记已变更，请重新保存'});
        expect(JSON.stringify([...f.values.values()])).not.toContain('same note');
        const duplicate = await Promise.all([a.memories.save({kind: 'note', content: 'new duplicate'}), b.memories.save({kind: 'note', content: 'new duplicate'})]);
        expect(duplicate[0].id).toBe(duplicate[1].id);
        expect(await a.memories.list()).toHaveLength(1);
        await a.memories.delete(duplicate[0].id); expect(await b.memories.list()).toEqual([]);
    });

    it.each(['delete', 'clear'] as const)('%s 跨标签发生在GM提交等待中仍拒绝迟到保存', async action => {
        const f = fixture(); const a = f.create(), b = f.create(); await Promise.all([a.ready, b.ready]);
        const first = await a.memories.save({kind: 'note', content: 'first'});
        const generation = await a.memories.captureGeneration();
        const held = deferred(), entered = deferred(); const originalSet = f.storage.set;
        f.storage.set = vi.fn(async (key, value) => {
            if ((value as any).kind === 'memory-save' && (value as any).memory.content === 'late') {entered.resolve(); await held.promise;}
            await originalSet(key, value);
        });
        const pending = a.memories.save({id: first.id, kind: 'note', content: 'late'}, generation);
        const failed = pending.catch(error => error);
        await entered.promise; await (action === 'delete' ? b.memories.delete(first.id) : b.memories.clear()); held.resolve();
        expect(await failed).toMatchObject({message: '学习笔记已变更，请重新保存'});
        expect(await a.memories.list()).toEqual([]);
        expect([...f.values.values()].every(row => (row as any).kind !== 'memory-save')).toBe(true);
    });

    it('已知200条上限拒绝新增但允许编辑、重复保存与删除后新增', async () => {
        const f = fixture(); const api = f.create(); await api.ready;
        for (let index = 0; index < 200; index++) await api.memories.save({kind: 'note', content: 'note ' + index});
        expect(await api.memories.list()).toHaveLength(200);
        await expect(api.memories.save({kind: 'note', content: 'overflow'})).rejects.toThrow('最多保存 200');
        const first = (await api.memories.list())[0];
        expect(await api.memories.save({kind: 'note', content: first.content})).toEqual(first);
        await api.memories.save({id: first.id, kind: 'note', content: 'edited at limit'});
        await api.memories.delete(first.id);
        await expect(api.memories.save({kind: 'note', content: 'replacement'})).resolves.toMatchObject({content: 'replacement'});
    });

    it('两个标签竞争最后一个名额时保持200条且不挤掉已确认笔记', async () => {
        const f = fixture(); const a = f.create(); await a.ready;
        for (let index = 0; index < 199; index++) await a.memories.save({kind: 'note', content: 'existing ' + index});
        const existing = (await a.memories.list()).map(item => item.id);
        const b = f.create(); await b.ready;
        f.time(NOW - 1); // 系统时钟回调也不能把新笔记排到已占用名额之前。
        const added = await Promise.allSettled([a.memories.save({kind: 'note', content: 'last A'}), b.memories.save({kind: 'note', content: 'last B'})]);
        expect(added.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const all = await a.memories.list(); expect(all).toHaveLength(200);
        expect(existing.every(id => all.some(item => item.id === id))).toBe(true);
        expect(await b.memories.list()).toEqual(all);
    });

    it('时间和ID冲突报错，不把已提交正文的压缩失败改判为保存失败', async () => {
        const f = fixture(); const api = f.create({id: () => memoryId(1)}); await api.ready;
        const first = await api.memories.save({kind: 'note', content: 'first'});
        await expect(api.memories.save({kind: 'note', content: 'collision'})).rejects.toThrow('标识冲突');
        f.time(-1);
        await expect(api.memories.save({id: first.id, kind: 'note', content: 'bad time'})).rejects.toThrow('保存时间');
        f.time(NOW + 1); vi.mocked(f.storage.remove).mockRejectedValue(new Error('cleanup unavailable'));
        await expect(api.memories.save({id: first.id, kind: 'note', content: 'updated'})).resolves.toMatchObject({content: 'updated'});
        expect(await api.memories.list()).toHaveLength(1);
    });
});

describe('阅读存储边界', () => {
    it.each([
        ['null', null], ['array', []], ['clock', {clock: -1}], ['fence', {fence: ['bad fence']}],
        ['memory-id', {memory: {kind: 'note', content: 'body', createdAt: NOW, updatedAt: NOW}}],
        ['created-time', {memory: {id: memoryId(1), kind: 'note', content: 'body', createdAt: -1, updatedAt: NOW}}],
        ['updated-time', {memory: {id: memoryId(1), kind: 'note', content: 'body', createdAt: NOW, updatedAt: NaN}}],
        ['admission', {admission: {clock: -1, id: 'bad'}}], ['missing-admission', {admission: undefined}],
        ['delete-target', {kind: 'session-delete', target: 'bad target'}],
        ['delete-id', {kind: 'memory-delete', target: 'invalid'}],
        ['duplicate-type', {kind: 'memory-delete', target: memoryId(1), duplicate: 1}],
        ['duplicate-hash', {kind: 'memory-delete', target: memoryId(1), duplicate: 'bad'}],
        ['unknown', {kind: 'future-action'}],
    ] as const)('GM中的 %s 损坏记录不进入公开历史或笔记', async (_label, patch) => {
        const f = fixture();
        const base = {version: 1, id: 'bad', clock: 1, fence: [], admission: {clock: 1, id: 'bad'}, kind: 'memory-save',
            memory: {id: memoryId(1), kind: 'note', content: 'body', createdAt: NOW, updatedAt: NOW}};
        const value = patch && !Array.isArray(patch) ? {...base, ...patch} : patch;
        const kind = value && 'kind' in value && value.kind !== 'future-action' ? value.kind : 'memory-save';
        const target = kind === 'session-delete' ? 'bad%20target' : memoryId(1);
        f.values.set(prefix + kind + ':' + target + ':bad', value);
        const api = f.create(); await api.ready;
        expect(await api.memories.list()).toEqual([]);
        expect(await api.sessions.list()).toEqual({sessions: [], hasMore: false});
    });

    it('删除未知笔记只更新代次且操作时钟溢出明确失败', async () => {
        const f = fixture();
        f.values.set(prefix + 'memory-save:' + memoryId(1) + ':legacy', {version: 1, id: 'legacy', clock: 1, fence: [], admission: {clock: 1, id: 'legacy'}, kind: 'memory-save',
            memory: {id: memoryId(1), kind: 'note', content: 'legacy', createdAt: NOW, updatedAt: NOW}});
        const api = f.create(); await api.ready;
        expect(await api.memories.list()).toHaveLength(1);
        await api.memories.delete(memoryId(99));
        expect(await api.memories.captureGeneration()).toBe(1);
        expect(await api.memories.list()).toHaveLength(1);
        f.values.set(prefix + 'memories-clear:overflow', {version: 1, id: 'overflow', clock: Number.MAX_SAFE_INTEGER, fence: [], kind: 'memories-clear'});
        await expect(api.memories.save({kind: 'note', content: 'new'})).rejects.toThrow('标识');
    });

    it('隐私模式初始化和所有入口均不读取或写入GM', async () => {
        const f = fixture(); const api = f.create({privateContext: true}); await api.ready;
        expect(() => api.sessions.captureGeneration('session')).toThrow('隐私');
        const denied = [api.sessions.get('session'), api.sessions.list(), api.sessions.clear(), api.sessions.delete('session'), api.sessions.prune(),
            api.memories.captureGeneration(), api.memories.list(), api.memories.save({kind: 'note', content: 'private'}), api.memories.delete(memoryId(1)), api.memories.clear()];
        expect((await Promise.allSettled(denied)).every(result => result.status === 'rejected')).toBe(true);
        for (const method of Object.values(f.storage)) expect(method).not.toHaveBeenCalled();
    });

    it('损坏或未来版本记录不进入历史、不误删除其他命名空间，并拒绝复用操作ID', async () => {
        const f = fixture();
        f.values.set(prefix + 'session-turn:session-1:bad', {version: 2});
        f.values.set(prefix + 'session-turn:session-1:malformed', {version: 1, id: 'malformed', clock: 1, fence: [], kind: 'session-turn', session: header(), turn: {}});
        f.values.set(prefix + 'session-turn:session-1:%FF', {});
        f.values.set('foreign:data', {secret: 'untouched'});
        const api = f.create({operationId: () => 'repeat'}); await api.ready;
        expect(await api.sessions.list()).toEqual({sessions: [], hasMore: false});
        const token = api.sessions.captureGeneration('session-1');
        await api.sessions.upsertTurn(header(), turn(), token);
        await expect(api.sessions.upsertTurn(header(), turn(), token)).rejects.toThrow('冲突');
        expect(f.values.get('foreign:data')).toEqual({secret: 'untouched'});
        const invalid = f.create({operationId: () => 'bad op'}); await invalid.ready;
        await expect(invalid.memories.save({kind: 'note', content: 'note'})).rejects.toThrow('标识');
    });

    it('默认适配器只通过实际GM端口落盘并能在独立实例恢复', async () => {
        const values = new Map<string, string>();
        const get = vi.fn((key: string, fallback: unknown) => values.has(key) ? values.get(key) : fallback);
        vi.stubGlobal('GM_getValue', get); vi.stubGlobal('GM_listValues', () => [...values.keys()]);
        vi.stubGlobal('GM_setValue', (key: string, value: string) => {values.set(key, value);});
        vi.stubGlobal('GM_deleteValue', (key: string) => {values.delete(key);});
        const one = createUserscriptReadingStorage(); await one.ready;
        const saved = await one.memories.save({kind: 'lesson', content: 'from actual GM adapter'});
        const two = createUserscriptReadingStorage(); await two.ready;
        expect(await two.memories.list()).toEqual([saved]);
        expect([...values.keys()].every(key => key.startsWith(prefix))).toBe(true);
        expect(get).toHaveBeenCalled();
        await two.memories.clear(); expect(await one.memories.list()).toEqual([]);
    });
});
