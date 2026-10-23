/**
 * @file userscript/readingStorage.ts
 * 文件职责：在脚本管理器私有 GM 存储中保存阅读会话和用户确认的学习笔记，不使用宿主网页 IndexedDB。
 * 主要内容：复用扩展字段规范化与三十天规则；每次更新使用独立操作键，按逻辑时钟合并，持久删除墓碑拒绝迟到写入，并压缩已被替代的正文记录。
 * 模块边界：GM 不提供跨标签事务，独立笔记/turn 不覆盖，同项并发编辑确定性择新；200 条笔记限制按当前快照检查并投影，不承诺跨标签线性一致性。
 */
import {isHarnessTurnExpired, normalizeHarnessSession, normalizeHarnessStoredTurn} from '@/src/services/harness/sessions';
import type {HarnessSession, HarnessSessionGenerationToken, HarnessSessionStore, HarnessStoredTurn} from '@/src/services/harness/sessionTypes';
import {LEARNING_MEMORY_LIMIT, LearningMemoryError, validateLearningMemoryId, validateLearningMemoryInput,
    type LearningMemory, type LearningMemoryStore} from '@/src/services/harness/learningMemory';
import {sha256Hex} from '@/src/shared/function/sha256';
import {getStoredValue, listStoredKeys, removeStoredValue, setStoredValue} from './storage';

const PREFIX = 'fluentread:reading:v1:operation:';
type SessionHeader = Omit<HarnessSession, 'turns'>;
type Admission = {clock: number; id: string};
type Data = {kind: 'session-turn'; session: SessionHeader; turn: HarnessStoredTurn}
    | {kind: 'memory-save'; memory: LearningMemory; admission: Admission};
type PendingData = Exclude<Data, {kind: 'memory-save'}>
    | Omit<Extract<Data, {kind: 'memory-save'}>, 'admission'> & {admission?: Admission};
type Marker = {kind: 'session-delete'; target: string}
    | {kind: 'memory-delete'; target: string; duplicate?: string}
    | {kind: 'sessions-clear' | 'memories-clear'};
type Operation = (Data | Marker) & {version: 1; id: string; clock: number; fence: string[]};
type SessionOperation = Extract<Operation, {kind: 'session-turn' | 'session-delete' | 'sessions-clear'}>;
type MemoryOperation = Exclude<Operation, SessionOperation>;
type Scope = 'session' | 'memory' | 'markers';
type ScopedOperation<S extends Scope> = S extends 'session' ? SessionOperation : S extends 'memory' ? MemoryOperation : Operation & Marker;

export interface UserscriptReadingStoragePort {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
    list(): Promise<string[]>;
}
interface Options {
    privateContext?: boolean;
    storage?: UserscriptReadingStoragePort;
    now?: () => number;
    id?: () => string;
    operationId?: () => string;
}
const defaultStorage: UserscriptReadingStoragePort = {
    get: getStoredValue, set: setStoredValue, remove: removeStoredValue, list: listStoredKeys,
};
const uuid = () => crypto.randomUUID();
const safeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,200}$/u.test(value);
const isData = (operation: Operation): operation is Operation & Data => operation.kind === 'session-turn' || operation.kind === 'memory-save';
const memoryIdentity = (memory: Pick<LearningMemory, 'kind' | 'content'>) => sha256Hex(JSON.stringify([memory.kind, memory.content]));
const compare = (a: {clock: number; id: string}, b: {clock: number; id: string}) => a.clock - b.clock || a.id.localeCompare(b.id);
function operationKey(operation: Operation): string {
    const target = operation.kind === 'session-turn' ? operation.session.id : operation.kind === 'memory-save'
        ? operation.memory.id : 'target' in operation ? operation.target : undefined;
    return PREFIX + operation.kind + ':' + (target === undefined ? '' : encodeURIComponent(target) + ':') + encodeURIComponent(operation.id);
}

function parseOperation(value: unknown, id: string): Operation | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (row.version !== 1 || row.id !== id || !validId(id) || !safeInteger(row.clock)
        || !Array.isArray(row.fence) || !row.fence.every(validId)) return null;
    const base = {version: 1 as const, id, clock: row.clock, fence: [...new Set(row.fence as string[])]};
    try {
        switch (row.kind) {
            case 'session-turn': {
                const {turns: _turns, ...session} = normalizeHarnessSession({...row.session as SessionHeader, turns: []});
                return {...base, kind: row.kind, session, turn: normalizeHarnessStoredTurn(row.turn as HarnessStoredTurn)};
            }
            case 'memory-save': {
                const memory = row.memory as LearningMemory;
                const input = validateLearningMemoryInput(memory);
                if (!input.id || !safeInteger(memory.createdAt) || !safeInteger(memory.updatedAt)) return null;
                const admission = row.admission as {clock?: unknown; id?: unknown} | undefined;
                if (!admission || !safeInteger(admission.clock) || !validId(admission.id)) return null;
                return {...base, kind: row.kind, admission: {clock: admission.clock, id: admission.id},
                    memory: {...input, id: input.id, createdAt: memory.createdAt, updatedAt: memory.updatedAt}};
            }
            case 'session-delete': return validId(row.target) ? {...base, kind: row.kind, target: row.target} : null;
            case 'memory-delete': {
                if (row.duplicate !== undefined && (typeof row.duplicate !== 'string' || !/^[a-f0-9]{64}$/u.test(row.duplicate))) return null;
                return {...base, kind: row.kind, target: validateLearningMemoryId(row.target),
                    ...(row.duplicate === undefined ? {} : {duplicate: row.duplicate})};
            }
            case 'sessions-clear': case 'memories-clear': return {...base, kind: row.kind};
            default: return null;
        }
    } catch { return null; }
}

function markers(operations: Operation[], kind: 'session' | 'memory', target?: string): string[] {
    return operations.filter(operation => kind === 'session'
        ? operation.kind === 'sessions-clear' || operation.kind === 'session-delete' && operation.target === target
        : operation.kind === 'memories-clear' || operation.kind === 'memory-delete')
        .map(operation => operation.id).sort();
}
/** 持久正文只携带读取时真正适用的墓碑；完整删除代次仍由保存前后单独复验。 */
function memoryFence(operations: MemoryOperation[], memory: LearningMemory): string[] {
    const duplicate = memoryIdentity(memory);
    return operations.filter(operation => operation.kind === 'memories-clear'
        || operation.kind === 'memory-delete' && (operation.target === memory.id || operation.duplicate === duplicate))
        .map(operation => operation.id).sort();
}
const sameFence = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index]);
function latestData<T extends Operation>(operations: T[], now: number): Array<Extract<T, Data>> {
    const latest = new Map<string, Operation & Data>();
    const globalMarkers = {session: [] as string[], memory: [] as string[]};
    const targetMarkers = new Map<string, string[]>();
    const duplicateMarkers = new Map<string, string[]>();
    for (const operation of operations) {
        if (operation.kind === 'sessions-clear') globalMarkers.session.push(operation.id);
        else if (operation.kind === 'memories-clear') globalMarkers.memory.push(operation.id);
        else if (operation.kind === 'session-delete' || operation.kind === 'memory-delete') {
            const key = JSON.stringify([operation.kind === 'session-delete' ? 'session' : 'memory', operation.target]);
            const ids = targetMarkers.get(key) ?? []; ids.push(operation.id); targetMarkers.set(key, ids);
            if (operation.kind === 'memory-delete' && operation.duplicate) {
                const duplicateKey = operation.duplicate;
                const duplicates = duplicateMarkers.get(duplicateKey) ?? []; duplicates.push(operation.id); duplicateMarkers.set(duplicateKey, duplicates);
            }
        }
    }
    for (const operation of operations) {
        if (!isData(operation) || operation.kind === 'session-turn' && isHarnessTurnExpired(operation.turn, now)) continue;
        const target = operation.kind === 'session-turn' ? operation.session.id : operation.memory.id;
        const kind = operation.kind === 'session-turn' ? 'session' : 'memory';
        const fence = new Set(operation.fence);
        if (!globalMarkers[kind].every(id => fence.has(id))
            || !(targetMarkers.get(JSON.stringify([kind, target])) ?? []).every(id => fence.has(id))
            || operation.kind === 'memory-save' && duplicateMarkers.size > 0 && !(duplicateMarkers.get(memoryIdentity(operation.memory)) ?? []).every(id => fence.has(id))) continue;
        const key = operation.kind === 'session-turn'
            ? JSON.stringify(['session', operation.session.id, operation.turn.id]) : JSON.stringify(['memory', operation.memory.id]);
        const previous = latest.get(key);
        if (!previous || compare(previous, operation) < 0) latest.set(key, operation);
    }
    return [...latest.values()] as Array<Extract<T, Data>>;
}
function projectSessions(operations: SessionOperation[], now: number): HarnessSession[] {
    const sessions = new Map<string, HarnessSession>();
    for (const operation of latestData(operations, now).sort(compare)) {
        const {session, turn} = operation;
        const existing = sessions.get(session.id);
        const header = existing && existing.updatedAt > session.updatedAt ? existing : session;
        sessions.set(session.id, {...header, createdAt: Math.min(existing?.createdAt ?? session.createdAt, session.createdAt),
            updatedAt: Math.max(existing?.updatedAt ?? 0, session.updatedAt, turn.createdAt),
            // 历史读取不声称另一个标签的连接仍存活，也不改写其他标签正在生成的记录。
            turns: [...existing?.turns ?? [], {...turn, status: turn.status === 'streaming' ? 'stopped' : turn.status}]});
    }
    for (const session of sessions.values()) session.turns.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    return [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}
function projectMemories(operations: MemoryOperation[], now: number): LearningMemory[] {
    const distinct = new Map<string, LearningMemory>();
    // 并发重复创建按确定性次序保留一项；不同笔记不会因为整包覆盖而丢失。
    const candidates = latestData(operations, now);
    // 名额按首次写入的逻辑次序分配；并发第201条不能把已确认的旧笔记挤出列表。
    candidates.sort((a, b) => compare(a.admission, b.admission));
    for (const operation of candidates) {
        const key = JSON.stringify([operation.memory.kind, operation.memory.content]);
        if (!distinct.has(key) && distinct.size < LEARNING_MEMORY_LIMIT) distinct.set(key, {...operation.memory});
    }
    return [...distinct.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
}

export function createUserscriptReadingStorage(options: Options = {}): {
    ready: Promise<void>; sessions: HarnessSessionStore; memories: LearningMemoryStore;
} {
    const storage = options.storage ?? defaultStorage;
    const now = options.now ?? Date.now;
    const operationId = options.operationId ?? uuid;
    let known: Operation[] = [];
    let epoch = 0;
    const generations = new Map<string, number>();
    const captured = new WeakMap<HarnessSessionGenerationToken, string[]>();
    let queue = Promise.resolve();
    const read = async <S extends Scope>(scope: S, target?: string): Promise<ScopedOperation<S>[]> => {
        const prefixes = scope === 'markers' ? ['sessions-clear:', 'session-delete:', 'memories-clear:', 'memory-delete:']
            : scope === 'session' ? ['sessions-clear:', ...['session-delete:', 'session-turn:'].map(kind => kind + (target === undefined ? '' : encodeURIComponent(target) + ':'))]
                : ['memories-clear:', 'memory-delete:', 'memory-save:'];
        const keys = [...new Set((await storage.list()).filter(key => prefixes.some(prefix => key.startsWith(PREFIX + prefix))))];
        const rows = await Promise.all(keys.map(async key => {
            let id: string;
            try {id = decodeURIComponent(key.slice(key.lastIndexOf(':') + 1));} catch {return null;}
            const operation = parseOperation(await storage.get(key), id);
            return operation && operationKey(operation) === key ? operation : null;
        }));
        const operations = rows.filter((row): row is Operation => row !== null);
        const merged = new Map(known.filter(operation => !prefixes.some(prefix => operationKey(operation).startsWith(PREFIX + prefix)))
            .map(operation => [operation.id, operation]));
        for (const operation of operations) if (!isData(operation)) merged.set(operation.id, operation);
        known = [...merged.values()];
        // 读取前按精确种类前缀选择，读取后再核对规范键与内容，确保作用域类型成立。
        return operations as ScopedOperation<S>[];
    };
    const ready = options.privateContext ? Promise.resolve() : read('markers').then(() => undefined);
    const run = <T>(work: () => Promise<T>): Promise<T> => {
        const task = queue.then(async () => {
            if (options.privateContext) throw new LearningMemoryError('隐私窗口不读写学习记录');
            await ready; return work();
        });
        queue = task.then(() => undefined, () => undefined);
        return task;
    };
    const compact = async (operations: Operation[]): Promise<void> => {
        const keep = new Set(latestData(operations, now()).map(operation => operation.id));
        // 只删除本次快照已知的旧正文；墓碑永久保留，不误删并发写入的新键。
        await Promise.all(operations.filter(operation => isData(operation) && !keep.has(operation.id))
            .map(operation => storage.remove(operationKey(operation)).catch(() => undefined)));
    };
    const append = async (data: PendingData | Marker, fence: string[], operations: Operation[]): Promise<Operation> => {
        const id = operationId();
        const clock = operations.reduce((value, operation) => Math.max(value, operation.clock), 0) + 1;
        if (!validId(id) || !safeInteger(clock)) throw new Error('阅读存储操作标识无效或冲突');
        const base = {version: 1 as const, id, clock, fence: [...fence]};
        const operation: Operation = data.kind === 'memory-save'
            ? {...data, ...base, admission: data.admission ?? {clock, id}} : {...data, ...base};
        const previous = await storage.get(operationKey(operation));
        if (previous !== null && previous !== undefined) throw new Error('阅读存储操作标识无效或冲突');
        await storage.set(operationKey(operation), operation);
        if (!isData(operation)) known.push(operation);
        return operation;
    };
    const tokenCurrent = (token: HarnessSessionGenerationToken, id: string) => token.sessionId === id
        && token.epoch === epoch && token.generation === (generations.get(id) ?? 0) && captured.has(token);
    const sessions: HarnessSessionStore = {
        captureGeneration(sessionId) {
            if (options.privateContext) throw new LearningMemoryError('隐私窗口不读写学习记录');
            const token = {epoch, sessionId, generation: generations.get(sessionId) ?? 0};
            captured.set(token, markers(known, 'session', sessionId));
            return token;
        },
        async upsertTurn(sessionInput, turnInput, token) {
            const {turns: _turns, ...session} = normalizeHarnessSession({...sessionInput, turns: []});
            const turn = normalizeHarnessStoredTurn(turnInput);
            return run(async () => {
                const operations = await read('session', session.id);
                if (!tokenCurrent(token, session.id) || !sameFence(captured.get(token)!, markers(operations, 'session', session.id))
                    || isHarnessTurnExpired(turn, now())) return false;
                const operation = await append({kind: 'session-turn', session, turn}, captured.get(token)!, operations);
                const next = await read('session', session.id);
                const accepted = tokenCurrent(token, session.id) && sameFence(operation.fence, markers(next, 'session', session.id));
                if (!accepted) await storage.remove(operationKey(operation));
                await compact(next);
                return accepted;
            });
        },
        get(id) { return run(async () => {
            const operations = await read('session', id);
            const result = projectSessions(operations, now()).find(session => session.id === id) ?? null;
            await compact(operations);
            return result;
        }); },
        list(offset = 0, limit = 20) { return run(async () => {
            const start = safeInteger(offset) ? offset : 0;
            const size = safeInteger(limit) && limit >= 1 ? Math.min(limit, 100) : 20;
            const operations = await read('session');
            const all = projectSessions(operations, now());
            await compact(operations);
            return {sessions: all.slice(start, start + size).map(session => ({id: session.id, text: session.text,
                intent: session.intent, updatedAt: session.updatedAt, turnCount: session.turns.length})), hasMore: all.length > start + size};
        }); },
        delete(id) {
            if (!validId(id)) return Promise.reject(new TypeError('Harness 会话 id 格式无效'));
            generations.set(id, (generations.get(id) ?? 0) + 1);
            return run(async () => {await append({kind: 'session-delete', target: id}, [], await read('session', id)); await compact(await read('session', id));});
        },
        clear() {
            epoch++; generations.clear();
            return run(async () => {await append({kind: 'sessions-clear'}, [], await read('session')); await compact(await read('session'));});
        },
        prune() { return run(async () => {
            const operations = await read('session');
            const expired = new Set(operations.filter((operation): operation is Extract<SessionOperation, {kind: 'session-turn'}> => operation.kind === 'session-turn' && isHarnessTurnExpired(operation.turn, now()))
                .map(operation => JSON.stringify([operation.session.id, operation.turn.id])));
            await compact(operations);
            return expired.size;
        }); },
    };
    const memories: LearningMemoryStore = {
        captureGeneration() { return run(async () => markers(await read('memory'), 'memory').length); },
        list() { return run(async () => {
            const operations = await read('memory');
            const result = projectMemories(operations, now());
            await compact(operations);
            return result;
        }); },
        async save(input, expectedGeneration) {
            const valid = validateLearningMemoryInput(input);
            return run(async () => {
                const operations = await read('memory');
                const fence = markers(operations, 'memory');
                const generation = expectedGeneration ?? fence.length;
                if (!safeInteger(generation) || generation !== fence.length) throw new LearningMemoryError('学习笔记已变更，请重新保存');
                const all = projectMemories(operations, now());
                const existing = valid.id ? all.find(memory => memory.id === valid.id) : undefined;
                if (valid.id && !existing) throw new LearningMemoryError('这条学习笔记已被删除，请重新添加');
                const duplicate = all.find(memory => memory.kind === valid.kind && memory.content === valid.content);
                if (duplicate) {
                    if (!valid.id || duplicate.id === valid.id) return duplicate;
                    throw new LearningMemoryError('已有相同内容的学习笔记，请保留其中一条');
                }
                if (!existing && all.length >= LEARNING_MEMORY_LIMIT) throw new LearningMemoryError(`最多保存 ${LEARNING_MEMORY_LIMIT} 条学习笔记，请先删除不需要的内容`);
                const timestamp = now();
                if (!safeInteger(timestamp)) throw new LearningMemoryError('无法确定学习笔记保存时间');
                const id = valid.id ?? validateLearningMemoryId((options.id ?? uuid)());
                if (!existing && all.some(memory => memory.id === id)) throw new LearningMemoryError('学习笔记标识冲突，请重新保存');
                const memory = {id, content: valid.content, kind: valid.kind, createdAt: existing?.createdAt ?? timestamp,
                    updatedAt: Math.max(existing?.updatedAt ?? 0, timestamp)};
                const previous = latestData(operations, now()).find(item => item.kind === 'memory-save' && item.memory.id === id);
                const operation = await append({kind: 'memory-save', memory,
                    ...(previous?.kind === 'memory-save' ? {admission: previous.admission} : {})}, memoryFence(operations, memory), operations);
                const next = await read('memory');
                if (!sameFence(fence, markers(next, 'memory'))) {
                    await storage.remove(operationKey(operation));
                    throw new LearningMemoryError('学习笔记已变更，请重新保存');
                }
                const persisted = projectMemories(next, now()).find(item => item.kind === valid.kind && item.content === valid.content);
                if (!persisted || valid.id && persisted.id !== id) {
                    await storage.remove(operationKey(operation));
                    throw new LearningMemoryError('学习笔记已变更或达到上限，请重新保存');
                }
                if (persisted.id !== id) await storage.remove(operationKey(operation));
                await compact(next);
                return persisted;
            });
        },
        async delete(id) {
            const target = validateLearningMemoryId(id);
            return run(async () => {
                const operations = await read('memory');
                const memory = projectMemories(operations, now()).find(item => item.id === target);
                await append({kind: 'memory-delete', target, ...(memory ? {duplicate: memoryIdentity(memory)} : {})}, [], operations);
                await compact(await read('memory'));
            });
        },
        clear() { return run(async () => {await append({kind: 'memories-clear'}, [], await read('memory')); await compact(await read('memory'));}); },
    };
    return {sessions, memories, ready};
}
