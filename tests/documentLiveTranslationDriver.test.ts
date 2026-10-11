/**
 * @file tests/documentLiveTranslationDriver.test.ts
 * 文件职责：离线验证真实文档翻译工具的响应诊断截止与自有资源收尾，防止未完成正文掩盖产品失败或阻塞清理。
 * 主要内容：覆盖正常正文证据、拒绝与挂起、晚响应的文档归属、提前 drain、关闭或临时目录清理失败、Lingvanex 官方端点分类，以及可选内置词库的公开配置投影和真实 UI 操作契约。
 * 模块边界：只调用 driver 的离线端口和临时目录；词库测试由实际内置副本工厂提供数据，不另造术语预期。不创建浏览器、不访问网络、不模拟产品译文通过，也不更改真实翻译、格式或焦点断言。
 */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {addBuiltinGlossary, BUILTIN_GLOSSARIES} from '@/src/core/glossary/builtins';
import type {GlossaryLibrary} from '@/src/core/glossary/model';

interface NetworkRecord {
    document: string;
    bodyObservation?: {state: string; elapsedMs?: number; reason?: string; errorName?: string};
    translations?: Array<{sha256: string; chars: number; tail: string}>;
    finishReasons?: unknown[];
}
interface BodyObserver {
    observe(response: {json(): Promise<unknown>}, record: NetworkRecord): Promise<void>;
    drain(options?: {timeoutMs?: number}): Promise<void>;
    stats: {timeoutMs: number; started: number; completed: number; timedOut: number; failed: number; active: number; drainTimeouts: number};
}
interface CleanupReport {cleanupErrors: string[]; retainedProfile?: string; focusFailure?: string; ok?: boolean}
interface PublicGlossaryState {
    glossaryEnabled: boolean;
    documentGlossaryIds: string[] | null;
    libraries: Array<{id: string; name: string; enabled: boolean; presetId: string | null; presetVersion: number | null; termCount: number}>;
}
const require = createRequire(import.meta.url);
const fileSystem = require('node:fs') as typeof import('node:fs');
const {createResponseBodyObserver, closeLiveSession, isProviderDomain, shouldObserveResponseBody,
    parseBuiltinGlossaryArg, readPublicGlossaryState, selectPublicDocumentGlossary, installBuiltinGlossaryForLiveRun} = require(resolve(__dirname, '../scripts/testing/run-document-live-translation.cjs')) as {
    createResponseBodyObserver(options?: {timeoutMs?: number}): BodyObserver;
    closeLiveSession(options: {launched?: {close(): Promise<void>}; focusMonitor?: {stop(): Promise<void>}; profileDir: string; launchAttempted: boolean; report: CleanupReport; responseObserver?: BodyObserver}): Promise<void>;
    isProviderDomain(host: string): boolean;
    shouldObserveResponseBody(record: {providerCandidate: boolean}, response: {url(): string; headers(): Record<string, string>}): boolean;
    parseBuiltinGlossaryArg(args: string[]): string | null;
    readPublicGlossaryState(presetId?: string | null): Promise<PublicGlossaryState>;
    selectPublicDocumentGlossary(value: {id: string; presetId: string}): Promise<void>;
    installBuiltinGlossaryForLiveRun(options: {page: unknown; origin: string; presetId: string; checkFocus(phase: string): Promise<void>}): Promise<{
        presetId: string; source: string; before: PublicGlossaryState; imported: PublicGlossaryState; selected: PublicGlossaryState; optionsUrl: string;
    }>;
};
const temporaryDirectories: string[] = [];
const profile = () => {
    const directory = fileSystem.mkdtempSync(resolve(tmpdir(), 'fluentread-live-driver-test-'));
    temporaryDirectories.push(directory); return directory;
};
const flushMicrotasks = async () => {for (let index = 0; index < 8; index++) await Promise.resolve();};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
    for (const directory of temporaryDirectories.splice(0)) fileSystem.rmSync(directory, {recursive: true, force: true});
});

describe('真实文档工具响应诊断有界收尾（离线）', () => {
    it('正常正文保留实际翻译 hash、尾部与结束原因，不保留任意响应字段', async () => {
        const observer = createResponseBodyObserver({timeoutMs: 25}), record: NetworkRecord = {document: 'first.md'};
        const translated = '这是正常响应的完整译文。';
        await observer.observe({json: async () => ({choices: [{message: {content: translated}, finish_reason: 'stop'}], privateField: 'not retained'})}, record);
        await observer.drain();
        expect(record.translations).toEqual([{sha256: createHash('sha256').update(translated).digest('hex'), chars: translated.length, tail: translated}]);
        expect(record.finishReasons).toEqual(['stop']); expect(record).not.toHaveProperty('privateField');
        expect(record.bodyObservation?.state).toBe('completed');
        expect(observer.stats).toMatchObject({started: 1, completed: 1, timedOut: 0, failed: 0, active: 0, drainTimeouts: 0});
    });

    it('挂起的 JSON 在读取截止后完成诊断，不能伪造上游译文匹配', async () => {
        const observer = createResponseBodyObserver({timeoutMs: 25}), record: NetworkRecord = {document: 'failed.pdf'};
        const completion = observer.observe({json: () => new Promise(() => {})}, record);
        await vi.advanceTimersByTimeAsync(24); expect(record.bodyObservation?.state).toBe('pending');
        await vi.advanceTimersByTimeAsync(1); await completion; await observer.drain();
        expect(record.bodyObservation).toMatchObject({state: 'timedOut', reason: 'body-deadline', elapsedMs: 25});
        expect(record.translations).toBeUndefined(); expect(record.finishReasons).toBeUndefined();
        expect(observer.stats).toMatchObject({timedOut: 1, completed: 0, active: 0});
    });

    it('读取拒绝和同步异常都记录失败类型，不泄露异常正文或重复等待', async () => {
        const observer = createResponseBodyObserver({timeoutMs: 25});
        const records: NetworkRecord[] = [{document: 'a'}, {document: 'b'}];
        await observer.observe({json: async () => {throw new SyntaxError('sensitive-response-text');}}, records[0]!);
        await observer.observe({json: () => {throw new Error('sensitive-response-text');}}, records[1]!);
        await observer.drain();
        expect(records.map(record => record.bodyObservation?.errorName)).toEqual(['SyntaxError', 'Error']);
        expect(records.every(record => record.bodyObservation?.state === 'failed')).toBe(true);
        expect(JSON.stringify(records)).not.toContain('sensitive-response-text');
        expect(observer.stats).toMatchObject({started: 2, failed: 2, active: 0});
    });

    it('晚正文不能回填超时记录或串到下一份文档，下一份正常证据保持独立', async () => {
        const observer = createResponseBodyObserver({timeoutMs: 25}), first: NetworkRecord = {document: 'first.pdf'}, next: NetworkRecord = {document: 'next.md'};
        let completeLate!: (value: unknown) => void;
        const completion = observer.observe({json: () => new Promise(resolve => {completeLate = resolve;})}, first);
        await vi.advanceTimersByTimeAsync(25); await completion;
        await observer.observe({json: async () => ({result: '下一份已完成'})}, next);
        const oldRecord = JSON.stringify(first), nextRecord = JSON.stringify(next), counts = {...observer.stats};
        completeLate({result: '上一份的晚正文'}); await flushMicrotasks(); await observer.drain();
        expect(JSON.stringify(first)).toBe(oldRecord); expect(JSON.stringify(next)).toBe(nextRecord); expect(observer.stats).toEqual(counts);
        expect(first.document).toBe('first.pdf'); expect(first.translations).toBeUndefined();
        expect(next.document).toBe('next.md'); expect(next.translations?.[0]?.tail).toBe('下一份已完成');
    });

    it('提前 drain 截止会结束当时挂起的读取，后续文档仍使用自己的正常读取时限', async () => {
        const observer = createResponseBodyObserver({timeoutMs: 5000}), first: NetworkRecord = {document: 'first'};
        observer.observe({json: () => new Promise(() => {})}, first);
        const draining = observer.drain({timeoutMs: 10});
        await vi.advanceTimersByTimeAsync(10); await draining;
        expect(first.bodyObservation).toMatchObject({state: 'timedOut', reason: 'drain-deadline'});
        const next: NetworkRecord = {document: 'next'};
        await observer.observe({json: async () => ({translation: '下一份译文'})}, next);
        expect(next.bodyObservation?.state).toBe('completed');
        expect(observer.stats).toMatchObject({drainTimeouts: 1, timedOut: 1, completed: 1, active: 0});
        expect(() => createResponseBodyObserver({timeoutMs: Infinity})).toThrow('finite deadline');
        await expect(observer.drain({timeoutMs: 0})).rejects.toThrow('finite deadline');
    });

    it('自有浏览器先关闭，挂起诊断最多再等一秒，原生观察器仍收尾且严格焦点失败保留', async () => {
        const observer = createResponseBodyObserver(), record: NetworkRecord = {document: 'failed'}, directory = profile();
        observer.observe({json: () => new Promise(() => {})}, record);
        const close = vi.fn(async () => {}), stop = vi.fn(async () => {});
        const report: CleanupReport = {cleanupErrors: [], focusFailure: 'Owned Edge activation', ok: false};
        const closing = closeLiveSession({launched: {close}, focusMonitor: {stop}, profileDir: directory, launchAttempted: true, report, responseObserver: observer});
        await flushMicrotasks(); expect(close).toHaveBeenCalledOnce(); expect(fileSystem.existsSync(directory)).toBe(false); expect(stop).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1000); await closing;
        expect(stop).toHaveBeenCalledOnce(); expect(observer.stats.active).toBe(0); expect(record.bodyObservation?.state).toBe('timedOut');
        expect(report).toEqual({cleanupErrors: [], focusFailure: 'Owned Edge activation', ok: false});
    });

    it('浏览器关闭失败保留专用 profile 和错误，仍关闭观察器', async () => {
        const directory = profile(), stop = vi.fn(async () => {}), report: CleanupReport = {cleanupErrors: []};
        await closeLiveSession({launched: {close: async () => {throw new Error('owned close failed');}}, focusMonitor: {stop}, profileDir: directory, launchAttempted: true, report});
        expect(report.retainedProfile).toBe(directory); expect(fileSystem.existsSync(directory)).toBe(true);
        expect(report.cleanupErrors).toEqual(['Error: owned close failed']); expect(stop).toHaveBeenCalledOnce();
    });

    it('profile 删除异常与 drain 异常各自记录，不能阻断原生观察器关闭', async () => {
        const directory = profile(), stop = vi.fn(async () => {}), report: CleanupReport = {cleanupErrors: []};
        vi.spyOn(fileSystem, 'rmSync').mockImplementation(() => {throw new Error('profile cleanup failed');});
        const observer = createResponseBodyObserver(); vi.spyOn(observer, 'drain').mockRejectedValue(new Error('diagnostic drain failed'));
        await closeLiveSession({launched: {close: async () => {}}, focusMonitor: {stop}, profileDir: directory, launchAttempted: true, report, responseObserver: observer});
        expect(report.retainedProfile).toBe(directory); expect(fileSystem.existsSync(directory)).toBe(true); expect(stop).toHaveBeenCalledOnce();
        expect(report.cleanupErrors).toEqual(['Error: profile cleanup failed', 'Error: diagnostic drain failed']);
    });

    it('只补 Lingvanex 官方固定翻译域，临时认证、CSRF 和非 JSON 正文继续排除', () => {
        expect(isProviderDomain('api-b2b.backenster.com')).toBe(true);
        for (const host of ['backenster.com', 'other.backenster.com', 'api-b2b.backenster.com.attacker.example']) expect(isProviderDomain(host)).toBe(false);
        const response = (pathname: string, type = 'application/json') => ({url: () => `https://api-b2b.backenster.com${pathname}`, headers: () => ({'content-type': type})});
        expect(shouldObserveResponseBody({providerCandidate: true}, response('/b1/api/v3/translate'))).toBe(true);
        for (const pathname of ['/csrf', '/token', '/auth']) expect(shouldObserveResponseBody({providerCandidate: true}, response(pathname))).toBe(false);
        expect(shouldObserveResponseBody({providerCandidate: true}, response('/translate', 'text/html'))).toBe(false);
        expect(shouldObserveResponseBody({providerCandidate: false}, response('/translate'))).toBe(false);
    });
});

const aiLibrary = () => {
    const added = addBuiltinGlossary('ai-en-zh-hans', [], '人工智能 · 英→简中');
    if (added.status !== 'added') throw new Error('Actual builtin factory must create its copy');
    return added.library;
};
const publicConfigPort = (libraries: GlossaryLibrary[] = [], glossaryEnabled = false) => {
    const config = {glossaryEnabled, glossaryLibraries: libraries, documentGlossaryIds: null as string[] | null,
        privateToken: 'private-token-not-for-report', userPrivateSetting: {text: 'private-config-not-for-report'}};
    const messages: Array<Record<string, unknown>> = [];
    const sendMessage = vi.fn(async (message: Record<string, unknown>) => {
        messages.push(structuredClone(message));
        if (message.type === 'configStorageRead') return {success: true, value: JSON.stringify(config)};
        if (message.type === 'persistConfig') {
            const patch = message.config as {documentGlossaryIds: string[]};
            expect(message.expected).toEqual({documentGlossaryIds: config.documentGlossaryIds});
            config.documentGlossaryIds = [...patch.documentGlossaryIds];
            return {success: true};
        }
        throw new Error('Unexpected public message');
    });
    vi.stubGlobal('chrome', {runtime: {sendMessage}});
    return {config, messages, sendMessage};
};
const builtinUiPort = (enabled = false) => {
    const port = publicConfigPort([], enabled), interactions: string[] = [];
    const waitFor = vi.fn(async () => {});
    const card = {
        waitFor,
        locator(selector: string) {
            interactions.push(selector);
            if (selector === 'h4') return {innerText: async () => '人工智能 · 英→简中'};
            if (selector === 'button.builtin-add') return {click: async () => {
                const added = addBuiltinGlossary('ai-en-zh-hans', port.config.glossaryLibraries, '人工智能 · 英→简中');
                if (added.status !== 'added') throw new Error('UI must add its actual builtin copy');
                port.config.glossaryLibraries = added.libraries;
            }};
            if (selector === '.builtin-added') return {waitFor: async () => {expect(port.config.glossaryLibraries).toHaveLength(1);}};
            throw new Error(`Unexpected card selector: ${selector}`);
        },
    };
    const master = {getAttribute: async (attribute: string) => {
        expect(attribute).toBe('aria-checked'); return String(port.config.glossaryEnabled);
    }, focus: async () => {interactions.push('master-focus');}};
    const glossary = {waitFor, getByTestId(id: string) {expect(id).toBe('builtin-ai-en-zh-hans'); interactions.push(id); return card;},
        locator(selector: string) {expect(selector).toBe('.feature-enable-card [role="switch"]'); return master;}};
    const page = {
        goto: vi.fn(async (url: string) => {interactions.push(url);}),
        getByTestId(id: string) {expect(id).toBe('glossary-settings'); interactions.push(id); return glossary;},
        evaluate<T, A>(callback: (argument: A) => Promise<T>, argument: A) {return callback(argument);},
        waitForFunction: async (callback: () => Promise<boolean>, _argument: null, options: {timeout: number}) => {
            expect(options.timeout).toBe(15000); expect(await callback()).toBe(true);
        },
        keyboard: {press: vi.fn(async (key: string) => {expect(key).toBe('Space'); port.config.glossaryEnabled = true;})},
    };
    return {...port, page, interactions};
};

describe('真实文档工具可选内置词库（离线端口，不运行翻译）', () => {
    it('无参数保持默认，唯一合法 AI 参数可用，拼错、缺值和重复在启动前拒绝', () => {
        expect(parseBuiltinGlossaryArg(['--service', 'freeTranslation'])).toBeNull();
        expect(parseBuiltinGlossaryArg(['--builtin-glossary', 'ai-en-zh-hans', '--service', 'freeTranslation'])).toBe('ai-en-zh-hans');
        for (const args of [['--builtin-glossary'], ['--builtin-glossary', '--service'], ['--builtin-glossary', 'unknown'],
            ['--builtin-glossary=ai-en-zh-hans'], ['--builtin-glossary', 'ai-en-zh-hans', '--builtin-glossary', 'ai-en-zh-hans']]) {
            expect(() => parseBuiltinGlossaryArg(args)).toThrow();
        }
    });

    it('投影真实内置副本版本、条目数量与选择状态，不带词表或私人配置', async () => {
        const library = aiLibrary(), port = publicConfigPort([library], true);
        port.config.documentGlossaryIds = [library.id];
        const before = structuredClone(port.config), state = await readPublicGlossaryState('ai-en-zh-hans');
        const actualPreset = BUILTIN_GLOSSARIES.find(preset => preset.id === 'ai-en-zh-hans')!;
        expect(state).toEqual({glossaryEnabled: true, documentGlossaryIds: [library.id], libraries: [{id: library.id,
            name: library.name, enabled: true, presetId: actualPreset.id, presetVersion: actualPreset.version, termCount: actualPreset.terms.length}]});
        expect(port.config).toEqual(before); expect(port.messages).toEqual([{type: 'configStorageRead', key: 'local:config'}]);
        const serialized = JSON.stringify(state);
        expect(serialized).not.toContain('private-'); expect(serialized).not.toContain('entries'); expect(serialized).not.toContain(actualPreset.terms[0]![0]);
    });

    it('默认模式只读真实继承/显式空选择，停用库与其它配置保持原样', async () => {
        const active = aiLibrary(), disabled = {...aiLibrary(), id: 'disabled-library', enabled: false};
        const port = publicConfigPort([active, disabled]);
        expect(await readPublicGlossaryState()).toMatchObject({glossaryEnabled: false, documentGlossaryIds: null, libraries: [{id: active.id}]});
        port.config.documentGlossaryIds = [];
        expect(await readPublicGlossaryState()).toEqual({glossaryEnabled: false, documentGlossaryIds: [], libraries: []});
        expect(port.messages.every(message => message.type === 'configStorageRead')).toBe(true);
    });

    it('公开端口读取失败或无效元数据立即失败，错误不带私人响应正文', async () => {
        const sendMessage = vi.fn(); vi.stubGlobal('chrome', {runtime: {sendMessage}});
        for (const [response, error] of [
            [{success: false, error: 'private-response'}, 'read failed'],
            [{success: true, value: 'private-invalid-json'}, 'Invalid public glossary configuration'],
            [{success: true, value: {glossaryLibraries: null}}, 'Invalid public glossary libraries'],
            [{success: true, value: {glossaryLibraries: [], documentGlossaryIds: [4]}}, 'Invalid public document glossary selection'],
            [{success: true, value: {glossaryLibraries: [{enabled: true, id: 'a', name: 'a', entries: null}]}}, 'Invalid selected glossary metadata'],
            [{success: true, value: {glossaryLibraries: [{enabled: true, id: 'a', name: 'a', entries: [], preset: {id: 'a', version: 0}}]}}, 'Invalid selected glossary preset'],
        ] as const) {
            sendMessage.mockResolvedValueOnce(response);
            await expect(readPublicGlossaryState()).rejects.toThrow(error);
        }
    });

    it('只 CAS 选择已经由 UI 导入且启用的真实 ID，词条和私人设置没有写入', async () => {
        const library = aiLibrary(), port = publicConfigPort([library], true), before = structuredClone(port.config);
        await selectPublicDocumentGlossary({id: library.id, presetId: 'ai-en-zh-hans'});
        expect(port.config).toEqual({...before, documentGlossaryIds: [library.id]});
        const writes = port.messages.filter(message => message.type === 'persistConfig'); expect(writes).toHaveLength(1);
        expect(writes[0]).toMatchObject({mode: 'patch', config: {documentGlossaryIds: [library.id]}, expected: {documentGlossaryIds: null}, sequence: 1});
        expect(Object.keys(writes[0]!)).toEqual(['type', 'mode', 'config', 'expected', 'clientId', 'sequence']);
        expect(writes[0]!.clientId).toMatch(/^document-live-glossary-/u);
    });

    it('不能替换未导入/停用/其它预设库，公开 CAS 拒绝也立即失败', async () => {
        const library = aiLibrary(), port = publicConfigPort([library]);
        const selection = {id: library.id, presetId: 'ai-en-zh-hans'};
        await expect(selectPublicDocumentGlossary(selection)).rejects.toThrow('not enabled');
        port.config.glossaryEnabled = true; library.enabled = false;
        await expect(selectPublicDocumentGlossary(selection)).rejects.toThrow('not enabled');
        library.enabled = true;
        await expect(selectPublicDocumentGlossary({...selection, id: 'not-imported'})).rejects.toThrow('not enabled');
        await expect(selectPublicDocumentGlossary({...selection, presetId: 'software-en-zh-hans'})).rejects.toThrow('Invalid builtin');
        expect(port.messages.every(message => message.type === 'configStorageRead')).toBe(true);
        port.sendMessage.mockImplementation(async message => message.type === 'configStorageRead'
            ? {success: true, value: JSON.stringify(port.config)} : {success: false, value: 'private-rejection'});
        await expect(selectPublicDocumentGlossary(selection)).rejects.toThrow('selection was rejected');
    });

    it('实际 UI 契约导入生产工厂副本，经 Space 启用并只选择其真实 ID，每步保留焦点检查', async () => {
        const port = builtinUiPort(), checkFocus = vi.fn(async (_phase: string) => {}), origin = 'chrome-extension://actual-build';
        const result = await installBuiltinGlossaryForLiveRun({page: port.page, origin, presetId: 'ai-en-zh-hans', checkFocus});
        const library = port.config.glossaryLibraries[0]!;
        expect(port.page.goto).toHaveBeenCalledWith(origin + '/options.html#settings-glossary', {waitUntil: 'domcontentloaded'});
        expect(port.interactions).toContain('builtin-ai-en-zh-hans'); expect(port.interactions).toContain('button.builtin-add');
        expect(port.interactions).toContain('master-focus'); expect(port.page.keyboard.press).toHaveBeenCalledOnce();
        expect(result.before).toEqual({glossaryEnabled: false, documentGlossaryIds: null, libraries: []});
        expect(result.selected).toEqual({...result.imported, glossaryEnabled: true, documentGlossaryIds: [library.id]});
        expect(result.selected.libraries[0]).toMatchObject({presetId: 'ai-en-zh-hans', presetVersion: library.preset!.version, termCount: library.entries.length});
        expect(port.messages.filter(message => message.type === 'persistConfig').map(message => message.config)).toEqual([{documentGlossaryIds: [library.id]}]);
        expect(checkFocus.mock.calls.map(([phase]) => phase)).toEqual(['builtin-glossary-options-open', 'builtin-glossary-import', 'builtin-glossary-enable', 'builtin-glossary-document-selection']);
    });

    it('已有开启的 master 不重复切换，已有副本或焦点检查失败不得继续导入或写配置', async () => {
        const enabled = builtinUiPort(true), checkFocus = vi.fn(async (_phase: string) => {});
        await installBuiltinGlossaryForLiveRun({page: enabled.page, origin: 'chrome-extension://actual-build', presetId: 'ai-en-zh-hans', checkFocus});
        expect(enabled.page.keyboard.press).not.toHaveBeenCalled();
        const existing = builtinUiPort(); existing.config.glossaryLibraries = [aiLibrary()];
        await expect(installBuiltinGlossaryForLiveRun({page: existing.page, origin: 'chrome-extension://actual-build', presetId: 'ai-en-zh-hans', checkFocus})).rejects.toThrow('Fresh profile');
        expect(existing.interactions).not.toContain('button.builtin-add');
        const stopped = builtinUiPort();
        await expect(installBuiltinGlossaryForLiveRun({page: stopped.page, origin: 'chrome-extension://actual-build', presetId: 'ai-en-zh-hans',
            checkFocus: async phase => {if (phase === 'builtin-glossary-import') throw new Error('Owned Edge activation');}})).rejects.toThrow('Owned Edge activation');
        expect(stopped.config.glossaryLibraries).toEqual([]); expect(stopped.messages.every(message => message.type === 'configStorageRead')).toBe(true);
    });
});
