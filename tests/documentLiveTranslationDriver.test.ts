/**
 * @file tests/documentLiveTranslationDriver.test.ts
 * 文件职责：离线验证真实文档翻译工具的响应诊断截止与自有资源收尾，防止未完成正文掩盖产品失败或阻塞清理。
 * 主要内容：覆盖正常正文证据、拒绝与挂起、晚响应的文档归属、提前 drain、关闭或临时目录清理失败，以及已接入的 Lingvanex 官方端点分类。
 * 模块边界：只调用 driver 的诊断端口和临时目录；不创建浏览器、不访问网络、不模拟产品译文通过，也不更改真实翻译、格式或焦点断言。
 */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

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
const require = createRequire(import.meta.url);
const fileSystem = require('node:fs') as typeof import('node:fs');
const {createResponseBodyObserver, closeLiveSession, isProviderDomain, shouldObserveResponseBody} = require(resolve(__dirname, '../scripts/testing/run-document-live-translation.cjs')) as {
    createResponseBodyObserver(options?: {timeoutMs?: number}): BodyObserver;
    closeLiveSession(options: {launched?: {close(): Promise<void>}; focusMonitor?: {stop(): Promise<void>}; profileDir: string; launchAttempted: boolean; report: CleanupReport; responseObserver?: BodyObserver}): Promise<void>;
    isProviderDomain(host: string): boolean;
    shouldObserveResponseBody(record: {providerCandidate: boolean}, response: {url(): string; headers(): Record<string, string>}): boolean;
};
const temporaryDirectories: string[] = [];
const profile = () => {
    const directory = fileSystem.mkdtempSync(resolve(tmpdir(), 'fluentread-live-driver-test-'));
    temporaryDirectories.push(directory); return directory;
};
const flushMicrotasks = async () => {for (let index = 0; index < 8; index++) await Promise.resolve();};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.restoreAllMocks(); vi.useRealTimers();
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
