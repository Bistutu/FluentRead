import {afterEach, describe, expect, it, vi} from 'vitest';
import {createRequire} from 'node:module';
import type {ChildProcess} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const require = createRequire(import.meta.url);
// CJS boundary functions are variadic Node overloads; retain that call shape
// for fault ports instead of letting spyOn infer unknown parameters.
const cp = require('node:child_process') as {
    spawn: typeof import('node:child_process').spawn;
    execFile: (...args: any[]) => any;
};
const fsPort = require('node:fs') as Record<'lstatSync' | 'realpathSync' | 'readFileSync' | 'existsSync', (...args: any[]) => any>;
const {guardBrowserClose, getGuardedBrowserPid} = require('../scripts/testing/owned-browser-close.cjs');

// External CDP is a protocol port; OS PID, ps, open FD, interval, signals and
// ChildProcess exit are real in the actor cases. Fault cases explicitly replace
// OS boundary responses, call only the public guard, and never export internals.
const ownedNode = String.raw`
'use strict';
const fs = require('node:fs'), path = require('node:path');
const profile = process.argv.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
const fd = fs.openSync(path.join(profile, 'held-fd'), 'a');
const log = event => fs.appendFileSync(path.join(profile, 'actor.jsonl'), JSON.stringify(event) + '\n');
const interval = setInterval(() => fs.writeSync(fd, '.'), 10);
const deadline = setTimeout(() => finish('fixture-deadline'), 30000);
let finished = false;
function finish(reason) {
    if (finished) return;
    finished = true;
    log({kind:'actor-exit', reason, profileExists:fs.existsSync(profile)});
    clearInterval(interval); clearTimeout(deadline); fs.closeSync(fd);
    process.exit(0);
}
process.on('SIGTERM', () => {
    log({kind:'TERM', profileExists:fs.existsSync(profile)});
    if (!process.argv.includes('--ignore-term')) finish('TERM');
});
process.on('message', value => {if (value === 'exit') finish('native-close');});
log({kind:'ready', pid:process.pid, profileExists:fs.existsSync(profile)});
process.send({kind:'ready', pid:process.pid});
`;

type ExitReceipt = {code: number | null; signal: NodeJS.Signals | null};
type Actor = {child: ChildProcess; pid: number; profile: string; exited: Promise<ExitReceipt>};
const roots: string[] = [];
const actors: Actor[] = [];
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

function profile() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluentread-owned-close-')));
    roots.push(root);
    return root;
}

async function actor(directory = profile(), ignoreTerm = false, extraArgs: string[] = []) {
    const source = join(profile(), 'actor.cjs');
    writeFileSync(source, ownedNode);
    const child: ChildProcess = cp.spawn(process.execPath, [source, `--user-data-dir=${directory}`,
        ...extraArgs, ...(ignoreTerm ? ['--ignore-term'] : [])], {stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
    const exited = new Promise<ExitReceipt>(resolve => child.once('close', (code, signal) => resolve({code, signal})));
    const result: Actor = {child, pid: child.pid!, profile: directory, exited};
    actors.push(result);
    let ready;
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('actor ready timeout')), 3000);
        child.once('message', value => {
            clearTimeout(timer);
            ready = value;
            resolve();
        });
        child.once('error', error => {clearTimeout(timer); reject(error);});
        child.once('exit', () => {clearTimeout(timer); reject(Error('actor exited before ready'));});
    });
    expect(ready).toEqual({kind: 'ready', pid: child.pid});
    return result;
}

function events(owner: Actor) {
    return readFileSync(join(owner.profile, 'actor.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
}

function nativeExit(owner: Actor) {
    owner.child.send!('exit');
    return owner.exited;
}

function psRow(pid: number): Promise<string> {
    return new Promise((resolve, reject) => cp.execFile('/bin/ps', ['-ww', '-p', String(pid), '-o', 'pid=', '-o', 'lstart=', '-o', 'stat=', '-o', 'command='],
        {encoding: 'utf8'}, (error: Error | null, stdout: string) => error ? reject(error) : resolve(stdout)));
}

function browserPort(pid: unknown, close: () => unknown = async () => {}) {
    const cdp = {send: vi.fn(async (_method: string): Promise<any> => ({processInfo: [
        {type: 'renderer', id: process.pid}, {type: 'browser', id: pid},
    ]})), detach: vi.fn(async () => {})};
    let announceDetach!: () => void;
    const detachedStarted = new Promise<void>(resolve => {announceDetach = resolve;});
    const cdpPort = {send: cdp.send, detach(...args: unknown[]) {
        // 只观察外部端口调用开始；原 mock 的拒绝、挂起与 this 都按原样转发。
        announceDetach();
        return Reflect.apply(cdp.detach, cdp, args);
    }};
    const browser = {newBrowserCDPSession: vi.fn(async (): Promise<any> => cdpPort)};
    const session = {context: {browser: vi.fn((): any => browser)}, close: vi.fn(close), marker: 'original session'};
    return {session, browser, cdp, nativeClose: session.close, detachedStarted};
}

async function captured(port: ReturnType<typeof browserPort>) {
    // Observe only the external CDP detach, not private guard state.
    await port.detachedStarted;
    expect(port.cdp.detach).toHaveBeenCalledTimes(1);
}

async function rejected(closing: unknown): Promise<any> {
    try { await closing; }
    catch (error) { return error; }
    throw Error('expected close rejection, received a receipt');
}

function psFault(pid: number, response: (callback: Function, args: string[]) => void) {
    const original = cp.execFile;
    return vi.spyOn(cp, 'execFile').mockImplementation((file: string, args: string[], options: any, callback: Function) => {
        if (file === '/bin/ps' && args.includes(String(pid))) {
            response(callback, args);
            return {};
        }
        return original(file, args, options, callback);
    });
}

async function acceleratedClose(session: any) {
    if (!vi.isFakeTimers()) vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'performance']});
    // Attach the rejection observer before advancing a timeout.
    const result = rejected(session.close());
    await vi.runAllTimersAsync();
    return result;
}

afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', originalPlatform);
    // Cleanup only ChildProcess handles spawned by this fixture. This cleanup
    // is not used as evidence for a guarded close receipt.
    for (const owner of actors.splice(0)) {
        if (owner.child.exitCode === null && owner.child.signalCode === null) owner.child.kill('SIGKILL');
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([owner.exited, new Promise((_, reject) => {
                timer = setTimeout(() => reject(Error('fixture cleanup exit timeout')), 3000);
            })]);
        } finally {clearTimeout(timer);}
    }
    for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('guardBrowserClose public API: actual owned process receipts', () => {
    const literalTemporaryRoots = [...new Set([
        tmpdir(), '/tmp', ...(process.platform === 'darwin' ? ['/private/tmp'] : []),
    ])].filter(root => existsSync(root));
    it.each(literalTemporaryRoots)('accepts the exact literal %s owned profile and observes real process exit', async temporaryRoot => {
        // 验证当前平台实际存在的原生临时目录；macOS 同时保留 /tmp 与 /private/tmp。
        // 保留启动参数的字面路径，不能用 realpath 掩盖进程 argv 的所有权差异。

        const directory = mkdtempSync(join(temporaryRoot, 'fluentread-owned-close-'));
        roots.push(directory);
        const owner = await actor(directory), port = browserPort(owner.pid, () => nativeExit(owner));
        expect(await psRow(owner.pid)).toContain(`--user-data-dir=${directory}`);
        guardBrowserClose(port.session, directory);
        await port.session.close();
        expect(await owner.exited).toEqual({code: 0, signal: null});
        await expect(psRow(owner.pid)).rejects.toMatchObject({code: 1});
        expect(events(owner).at(-1)).toMatchObject({kind: 'actor-exit', profileExists: true});
        rmSync(directory, {recursive: true});
        expect(existsSync(directory)).toBe(false);
    });

    it('returns synchronously, captures browser-level CDP immediately, preserves this and memoizes one close', async () => {
        const owner = await actor();
        const port = browserPort(owner.pid, function(this: any) {
            expect(this.marker).toBe('original session');
            return nativeExit(owner);
        });
        expect(guardBrowserClose(port.session, owner.profile)).toBe(port.session);
        expect(port.nativeClose).not.toHaveBeenCalled();
        await captured(port);
        expect(port.session.context.browser).toHaveBeenCalledOnce();
        expect(port.browser.newBrowserCDPSession).toHaveBeenCalledOnce();
        expect(port.cdp.send).toHaveBeenCalledWith('SystemInfo.getProcessInfo');
        const kill = vi.spyOn(process, 'kill');
        const first = port.session.close(), second = port.session.close();
        expect(second).toBe(first);
        await first;
        expect(port.nativeClose).toHaveBeenCalledOnce();
        expect(await owner.exited).toEqual({code: 0, signal: null});
        expect(kill).not.toHaveBeenCalled();
        await expect(psRow(owner.pid)).rejects.toMatchObject({code: 1});
        expect(existsSync(join(owner.profile, 'held-fd'))).toBe(true);
        expect(events(owner).at(-1)).toMatchObject({kind: 'actor-exit', profileExists: true});
        // Removal is downstream of both public receipt and ChildProcess exit.
        rmSync(owner.profile, {recursive: true});
        expect(existsSync(owner.profile)).toBe(false);
    });

    it('repairs native false fulfillment with real TERM while a foreign sentinel has zero impact', async () => {
        const owner = await actor(), sentinel = await actor();
        const port = browserPort(owner.pid);
        guardBrowserClose(port.session, owner.profile);
        await captured(port);
        const before = readFileSync(join(sentinel.profile, 'held-fd')).length;
        await port.session.close();
        expect(await owner.exited).toEqual({code: 0, signal: null});
        expect(events(owner)).toContainEqual({kind: 'TERM', profileExists: true});
        await expect(psRow(owner.pid)).rejects.toMatchObject({code: 1});
        expect(await psRow(sentinel.pid)).toContain(`--user-data-dir=${sentinel.profile}`);
        expect(events(sentinel).map(event => event.kind)).toEqual(['ready']);
        expect(readFileSync(join(sentinel.profile, 'held-fd')).length).toBeGreaterThan(before);
        expect(sentinel.child.exitCode).toBeNull();
        expect(sentinel.child.signalCode).toBeNull();
    });

    it('uses real KILL only after TERM-ignore and a fresh exact identity check', async () => {
        const owner = await actor(undefined, true);
        const port = browserPort(owner.pid);
        guardBrowserClose(port.session, owner.profile);
        await captured(port);
        const observations: string[] = [];
        const originalExec = cp.execFile, originalKill = process.kill;
        vi.spyOn(cp, 'execFile').mockImplementation((file: string, args: string[], ...rest: any[]) => {
            if (file === '/bin/ps') {
                expect(args).toContain(String(owner.pid));
                observations.push('ps');
            }
            return originalExec(file, args, ...rest);
        });
        vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: any) => {
            expect(pid).toBe(owner.pid);
            expect(observations.at(-1)).toBe('ps');
            observations.push(signal);
            return originalKill(pid, signal);
        });
        await port.session.close();
        expect(observations.filter(value => value !== 'ps')).toEqual(['SIGTERM', 'SIGKILL']);
        expect(await owner.exited).toEqual({code: null, signal: 'SIGKILL'});
        expect(events(owner)).toContainEqual({kind: 'TERM', profileExists: true});
        await expect(psRow(owner.pid)).rejects.toMatchObject({code: 1});
        expect(existsSync(owner.profile)).toBe(true);
    });

    it('waits for natural disappearance after native fulfillment without sending a signal', async () => {
        const owner = await actor();
        const port = browserPort(owner.pid, () => {setTimeout(() => {void nativeExit(owner);}, 50);});
        guardBrowserClose(port.session, owner.profile);
        const kill = vi.spyOn(process, 'kill');
        await port.session.close();
        expect(await owner.exited).toEqual({code: 0, signal: null});
        expect(kill).not.toHaveBeenCalled();
    });

    it('rechecks a same-start Darwin command placeholder against actual absence without a signal', async () => {
        Object.defineProperty(process, 'platform', {value: 'darwin', configurable: true});
        const owner = await actor(), port = browserPort(owner.pid, () => nativeExit(owner));
        guardBrowserClose(port.session, owner.profile);
        await captured(port);
        const row = await psRow(owner.pid), nativeExec = cp.execFile;
        // Real macOS ps can return R + (node) during exit, with the original
        // start identity. This one boundary response models the recorded race;
        // the following absence result and held-handle join are real.
        const placeholder = row.replace(/^(\s*\d+\s+[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+[?A-Za-z][?A-Za-z+<>=-]*\s+\S[^\r\n]*\n$/, '$1 R (node)\n');
        expect(placeholder).not.toBe(row);
        let observations = 0;
        psFault(owner.pid, (callback, args) => {
            if (++observations === 1) callback(null, placeholder, '');
            else nativeExec('/bin/ps', args, {encoding: 'utf8'}, callback);
        });
        const kill = vi.spyOn(process, 'kill');
        await port.session.close();
        expect(await owner.exited).toEqual({code: 0, signal: null});
        expect(observations).toBeGreaterThan(1);
        expect(kill).not.toHaveBeenCalled();
        expect(existsSync(owner.profile)).toBe(true);
    });

    it('retains a profile while a same-start Darwin command remains unavailable', async () => {
        Object.defineProperty(process, 'platform', {value: 'darwin', configurable: true});
        const owner = await actor(), port = browserPort(owner.pid);
        guardBrowserClose(port.session, owner.profile);
        await captured(port);
        const row = await psRow(owner.pid);
        const placeholder = row.replace(/^(\s*\d+\s+[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+[?A-Za-z][?A-Za-z+<>=-]*\s+\S[^\r\n]*\n$/, '$1 R (node)\n');
        expect(placeholder).not.toBe(row);
        psFault(owner.pid, callback => callback(null, placeholder, ''));
        const kill = vi.spyOn(process, 'kill');
        expect(await rejected(port.session.close())).toMatchObject({code: 'IDENTITY_CHANGED'});
        expect(kill).not.toHaveBeenCalled();
        expect(owner.child.exitCode).toBeNull();
        expect(existsSync(owner.profile)).toBe(true);
    });

    it('refuses KILL when Darwin command identity becomes unavailable after TERM', async () => {
        Object.defineProperty(process, 'platform', {value: 'darwin', configurable: true});
        const owner = await actor(undefined, true), port = browserPort(owner.pid);
        guardBrowserClose(port.session, owner.profile);
        await captured(port);
        const row = await psRow(owner.pid), nativeKill = process.kill;
        const placeholder = row.replace(/^(\s*\d+\s+[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+[?A-Za-z][?A-Za-z+<>=-]*\s+\S[^\r\n]*\n$/, '$1 R (node)\n');
        expect(placeholder).not.toBe(row);
        const kill = vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: any) => {
            const result = nativeKill(pid, signal);
            psFault(owner.pid, callback => callback(null, placeholder, ''));
            return result;
        });
        expect(await rejected(port.session.close())).toMatchObject({code: 'IDENTITY_CHANGED'});
        expect(kill.mock.calls).toEqual([[owner.pid, 'SIGTERM']]);
        expect(owner.child.exitCode).toBeNull();
        expect(existsSync(owner.profile)).toBe(true);
    });

    it.each(['sync', 'async'] as const)('preserves native %s error, still terminates owned actor, and refuses removal', async mode => {
        const owner = await actor(), primary = Error('NATIVE_CLOSE_FAILURE');
        const port = browserPort(owner.pid, mode === 'sync' ? () => {throw primary;} : async () => {throw primary;});
        guardBrowserClose(port.session, owner.profile);
        let removed = false, error;
        try {
            await port.session.close();
            rmSync(owner.profile, {recursive: true}); removed = true;
        } catch (caught) {error = caught;}
        expect(error).toBe(primary);
        expect(removed).toBe(false);
        expect(existsSync(owner.profile)).toBe(true);
        expect(await owner.exited).toEqual({code: 0, signal: null});
    });

    it('keeps capture failure until close, detaches, and still invokes native close with no ownership signal', async () => {
        const owner = await actor(), primary = Error('CDP_QUERY_FAILURE');
        const port = browserPort(owner.pid, () => nativeExit(owner));
        port.cdp.send.mockRejectedValue(primary);
        expect(guardBrowserClose(port.session, owner.profile)).toBe(port.session);
        await captured(port);
        const kill = vi.spyOn(process, 'kill');
        expect(await rejected(port.session.close())).toBe(primary);
        expect(port.nativeClose).toHaveBeenCalledOnce();
        expect(await owner.exited).toEqual({code: 0, signal: null});
        expect(kill).not.toHaveBeenCalled();
        expect(existsSync(owner.profile)).toBe(true);
    });

    it('rejects detach failure even with a captured identity and actual termination', async () => {
        const owner = await actor(), error = Error('DETACH_FAILURE');
        const port = browserPort(owner.pid);
        port.cdp.detach.mockRejectedValue(error);
        guardBrowserClose(port.session, owner.profile);
        expect(await rejected(port.session.close())).toBe(error);
        expect(await owner.exited).toEqual({code: 0, signal: null});
        expect(existsSync(owner.profile)).toBe(true);
    });

    it.each(['browser-null', 'connect-throws', 'connect-rejects'] as const)('attempts original close after %s capture failure', async mode => {
        const owner = await actor(), error = Error('CONNECT_FAILURE');
        const port = browserPort(owner.pid, () => nativeExit(owner));
        if (mode === 'browser-null') port.session.context.browser.mockReturnValue(null);
        else if (mode === 'connect-throws') port.browser.newBrowserCDPSession.mockImplementation(() => {throw error;});
        else port.browser.newBrowserCDPSession.mockRejectedValue(error);
        expect(guardBrowserClose(port.session, owner.profile)).toBe(port.session);
        const result = await rejected(port.session.close());
        expect(result).toBeInstanceOf(Error);
        if (mode !== 'browser-null') expect(result).toBe(error);
        expect(port.nativeClose).toHaveBeenCalledOnce();
        expect(port.cdp.detach).not.toHaveBeenCalled();
        expect(await owner.exited).toEqual({code: 0, signal: null});
    });
});

describe('guardBrowserClose public API: exact ownership and fail-closed OS ports', () => {
    it.each(['sibling', 'duplicate', 'split', 'embedded', 'quoted'] as const)('does not signal a foreign %s profile argument', async mode => {
        const expected = profile();
        let actual = expected, extra: string[] = [];
        if (mode === 'sibling') {actual = expected + '-sibling'; mkdirSync(actual); roots.push(actual);}
        if (mode === 'duplicate') extra = [`--user-data-dir=${expected}`];
        if (mode === 'split') extra = ['--user-data-dir', expected];
        if (mode === 'embedded') {actual = profile(); extra = [`--note=--user-data-dir=${expected}`];}
        if (mode === 'quoted') extra = ['--note="ambiguous"'];
        const sentinel = await actor(actual, false, extra);
        const port = browserPort(sentinel.pid);
        guardBrowserClose(port.session, expected);
        await captured(port);
        const kill = vi.spyOn(process, 'kill');
        expect(await rejected(port.session.close())).toMatchObject({code: 'OWNERSHIP_UNKNOWN'});
        expect(port.nativeClose).toHaveBeenCalledOnce();
        expect(kill).not.toHaveBeenCalled();
        expect(events(sentinel).map(event => event.kind)).toEqual(['ready']);
        expect(await psRow(sentinel.pid)).toContain(`--user-data-dir=${actual}`);
        expect(existsSync(expected)).toBe(true);
    });

    it.each(['string', 'zero', 'negative', 'fraction', 'unsafe', 'self', 'multiple', 'missing', 'not-array', 'null'] as const)
        ('rejects %s CDP ownership without inferring from a PID string or probing any other process', async mode => {
            const owner = await actor();
            const ids: Record<string, unknown> = {string: String(owner.pid), zero: 0, negative: -1, fraction: 1.5,
                unsafe: Number.MAX_SAFE_INTEGER + 1, self: process.pid};
            const port = browserPort(ids[mode], () => nativeExit(owner));
            if (mode === 'multiple') port.cdp.send.mockResolvedValue({processInfo: [{type: 'browser', id: owner.pid}, {type: 'browser', id: owner.pid}]});
            if (mode === 'missing') port.cdp.send.mockResolvedValue({processInfo: [{type: 'renderer', id: owner.pid}, null]});
            if (mode === 'not-array') port.cdp.send.mockResolvedValue({processInfo: {type: 'browser', id: owner.pid}});
            if (mode === 'null') port.cdp.send.mockResolvedValue(null);
            guardBrowserClose(port.session, owner.profile);
            await captured(port);
            const kill = vi.spyOn(process, 'kill');
            expect(await rejected(port.session.close())).toMatchObject({code: 'OWNERSHIP_UNKNOWN'});
            expect(kill).not.toHaveBeenCalled();
            expect(await owner.exited).toEqual({code: 0, signal: null});
        });

    it.each(['relative', 'non-string', 'normalized', 'spaces', 'missing', 'file', 'symlink', 'temporary-root', 'outside-temp'] as const)
        ('retains the session and calls native close for a %s profile', async mode => {
            const owner = await actor();
            let selected: any = owner.profile;
            if (mode === 'relative') selected = 'relative';
            if (mode === 'non-string') selected = null;
            if (mode === 'normalized') selected = owner.profile + '/.';
            if (mode === 'spaces') selected += ' space';
            if (mode === 'missing') selected += '/missing';
            if (mode === 'file') {selected += '/file'; writeFileSync(selected, 'file');}
            if (mode === 'symlink') {selected = join(profile(), 'link'); symlinkSync(owner.profile, selected);}
            if (mode === 'temporary-root') selected = realpathSync(tmpdir());
            if (mode === 'outside-temp') selected = '/';
            const port = browserPort(owner.pid, () => nativeExit(owner));
            expect(guardBrowserClose(port.session, selected)).toBe(port.session);
            expect(await rejected(port.session.close())).toBeInstanceOf(Error);
            expect(port.nativeClose).toHaveBeenCalledOnce();
            expect(port.cdp.detach).toHaveBeenCalledOnce();
            expect(await owner.exited).toEqual({code: 0, signal: null});
        });

    it('refuses ownership if the real actor is already gone at initial ps capture', async () => {
        const owner = await actor();
        await nativeExit(owner);
        const port = browserPort(owner.pid);
        guardBrowserClose(port.session, owner.profile);
        expect(await rejected(port.session.close())).toMatchObject({code: 'OWNERSHIP_UNKNOWN'});
        expect(port.nativeClose).toHaveBeenCalledOnce();
        expect(existsSync(owner.profile)).toBe(true);
    });

    it.each(['start', 'command', 'inode', 'device', 'realpath'] as const)('refuses changed %s identity before any guard signal', async mode => {
        const owner = await actor(), port = browserPort(owner.pid);
        guardBrowserClose(port.session, owner.profile);
        await captured(port);
        if (mode === 'start' || mode === 'command') {
            const row = await psRow(owner.pid);
            const changed = mode === 'start' ? row.replace(/\d{2}:\d{2}:\d{2}/, '99:99:99') : row.trimEnd() + ' --changed\n';
            psFault(owner.pid, callback => callback(null, changed, ''));
        } else if (mode === 'inode') {
            const renamed = owner.profile + '-original'; renameSync(owner.profile, renamed); roots.push(renamed);
            mkdirSync(owner.profile);
        } else if (mode === 'device') {
            const original = fsPort.lstatSync;
            vi.spyOn(fsPort, 'lstatSync').mockImplementation((selected: string, ...args: any[]) => {
                const stat = original(selected, ...args);
                return selected === owner.profile ? Object.assign(Object.create(stat), {dev: stat.dev + 1}) : stat;
            });
        } else {
            const original = fsPort.realpathSync;
            vi.spyOn(fsPort, 'realpathSync').mockImplementation((selected: string, ...args: any[]) => selected === owner.profile ? owner.profile + '-different' : original(selected, ...args));
        }
        const kill = vi.spyOn(process, 'kill');
        expect(await rejected(port.session.close())).toMatchObject({code: 'IDENTITY_CHANGED'});
        expect(kill).not.toHaveBeenCalled();
        expect(owner.child.exitCode).toBeNull();
        expect(existsSync(owner.profile)).toBe(true);
    });

    it('refuses changed identity after TERM and before any KILL', async () => {
        const owner = await actor(undefined, true), port = browserPort(owner.pid);
        guardBrowserClose(port.session, owner.profile);
        await captured(port);
        const row = await psRow(owner.pid), originalKill = process.kill;
        const kill = vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: any) => {
            const result = originalKill(pid, signal);
            psFault(owner.pid, callback => callback(null, row.trimEnd() + ' --changed\n', ''));
            return result;
        });
        expect(await rejected(port.session.close())).toMatchObject({code: 'IDENTITY_CHANGED'});
        expect(kill.mock.calls).toEqual([[owner.pid, 'SIGTERM']]);
        expect(existsSync(owner.profile)).toBe(true);
    });

    it('rejects a CDP PID with no profile argument and still tries the acquired native close', async () => {
        const owner = await actor(), port = browserPort(owner.pid, () => nativeExit(owner));
        const row = await psRow(owner.pid);
        psFault(owner.pid, callback => callback(null, row.replace(`--user-data-dir=${owner.profile}`, '--other'), ''));
        guardBrowserClose(port.session, owner.profile);
        expect(await rejected(port.session.close())).toMatchObject({code: 'OWNERSHIP_UNKNOWN'});
        expect(port.nativeClose).toHaveBeenCalledOnce();
        expect(await owner.exited).toEqual({code: 0, signal: null});
    });

    it.each(['permission', 'absent-with-stderr', 'absent-with-output', 'blank-success', 'wrong-pid', 'bad-start', 'multiple-rows', 'non-string'] as const)
        ('does not treat %s ps response as disappearance', async mode => {
            const owner = await actor(), port = browserPort(owner.pid), error = Object.assign(Error('PS_FAILURE'), {code: 'EACCES'});
            guardBrowserClose(port.session, owner.profile);
            await captured(port);
            const row = await psRow(owner.pid);
            psFault(owner.pid, callback => {
                if (mode === 'permission') callback(error, '', 'permission denied');
                if (mode === 'absent-with-stderr') callback({code: 1}, '', 'unexpected error');
                if (mode === 'absent-with-output') callback({code: 1}, row, '');
                if (mode === 'blank-success') callback(null, '', '');
                if (mode === 'wrong-pid') callback(null, row.replace(String(owner.pid), String(owner.pid + 1)), '');
                if (mode === 'bad-start') callback(null, row.replace(/\d{2}:\d{2}:\d{2}/, 'unknown'), '');
                if (mode === 'multiple-rows') callback(null, row + row, '');
                if (mode === 'non-string') callback(null, Buffer.from(row), '');
            });
            const kill = vi.spyOn(process, 'kill');
            const result = await rejected(port.session.close());
            if (mode === 'permission') expect(result).toBe(error);
            else expect(result).toBeDefined();
            expect(kill).not.toHaveBeenCalled();
            expect(existsSync(owner.profile)).toBe(true);
        });

    it('rejects an initial ps error and retains query error ahead of detach error', async () => {
        const owner = await actor(), primary = Error('CAPTURE_PS_FAILURE'), secondary = Error('DETACH_FAILURE');
        const port = browserPort(owner.pid, () => nativeExit(owner));
        psFault(owner.pid, callback => callback(primary, '', 'fault'));
        port.cdp.detach.mockRejectedValue(secondary);
        guardBrowserClose(port.session, owner.profile);
        const result = await rejected(port.session.close());
        expect(result).toBeInstanceOf(AggregateError);
        expect(result.cause).toBe(primary);
        expect(result.errors).toEqual([primary, secondary]);
        expect(await owner.exited).toEqual({code: 0, signal: null});
    });

    it('keeps native close error first when capture also fails', async () => {
        const owner = await actor(), primary = Error('NATIVE'), capture = Error('CAPTURE');
        const port = browserPort(owner.pid, async () => {await nativeExit(owner); throw primary;});
        port.cdp.send.mockRejectedValue(capture);
        guardBrowserClose(port.session, owner.profile);
        const result = await rejected(port.session.close());
        expect(result.cause).toBe(primary);
        expect(result.errors).toEqual([primary, capture]);
        expect(existsSync(owner.profile)).toBe(true);
    });

    it('keeps native close error first when known-owned cleanup fails', async () => {
        const owner = await actor(), primary = Error('NATIVE'), secondary = Object.assign(Error('SIGNAL_DENIED'), {code: 'EPERM'});
        const port = browserPort(owner.pid, () => {throw primary;});
        guardBrowserClose(port.session, owner.profile);
        await captured(port);
        vi.spyOn(process, 'kill').mockImplementation(() => {throw secondary;});
        const result = await rejected(port.session.close());
        expect(result.cause).toBe(primary);
        expect(result.errors).toEqual([primary, secondary]);
        expect(existsSync(owner.profile)).toBe(true);
    });

    it('re-observes ps after ESRCH and accepts only subsequent real absence', async () => {
        const owner = await actor(), port = browserPort(owner.pid);
        guardBrowserClose(port.session, owner.profile);
        await captured(port);
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
            void nativeExit(owner);
            throw Object.assign(Error('RACED_EXIT'), {code: 'ESRCH'});
        });
        await port.session.close();
        expect(kill).toHaveBeenCalledTimes(1);
        expect(await owner.exited).toEqual({code: 0, signal: null});
        await expect(psRow(owner.pid)).rejects.toMatchObject({code: 1});
    });

    it('accepts an actor disappearing between grace expiry and the fresh signal check', async () => {
        const owner = await actor(), port = browserPort(owner.pid);
        guardBrowserClose(port.session, owner.profile);
        await captured(port);
        const original = cp.execFile;
        let paused = false;
        const closingStarted = performance.now();
        vi.spyOn(cp, 'execFile').mockImplementation((file: string, args: string[], options: any, callback: Function) => {
            // Exit only once the public close has exhausted its grace period,
            // before the fresh process observation preceding a signal.
            if (!paused && file === '/bin/ps' && performance.now() - closingStarted >= 250) {
                paused = true;
                void nativeExit(owner).then(() => original(file, args, options, callback));
                return {};
            }
            return original(file, args, options, callback);
        });
        const kill = vi.spyOn(process, 'kill');
        await port.session.close();
        expect(paused).toBe(true);
        expect(kill).not.toHaveBeenCalled();
        expect(await owner.exited).toEqual({code: 0, signal: null});
    });
});

describe('guardBrowserClose public API: bounded operations and platform start identity', () => {
    it('ignores an unavailable standard temp root without relaxing the accepted directory roots', async () => {
        const owner = await actor(), port = browserPort(owner.pid, () => nativeExit(owner));
        const original = fsPort.existsSync;
        vi.spyOn(fsPort, 'existsSync').mockImplementation((selected: string) => selected === '/private/tmp' ? false : original(selected));
        guardBrowserClose(port.session, owner.profile);
        await port.session.close();
        expect(await owner.exited).toEqual({code: 0, signal: null});
        expect(existsSync(owner.profile)).toBe(true);
    });

    it('bounds CDP connect, still calls native close, and detaches a late-created session', async () => {
        const directory = profile(), port = browserPort(123);
        let resolveConnect!: (value: any) => void;
        port.browser.newBrowserCDPSession.mockReturnValue(new Promise(resolve => {resolveConnect = resolve;}));
        // Late detach deliberately rejects; it must not become unhandled or
        // turn the already rejected public close into a receipt.
        port.cdp.detach.mockRejectedValue(Error('LATE_DETACH_FAILURE'));
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'performance']});
        guardBrowserClose(port.session, directory);
        expect(await acceleratedClose(port.session)).toMatchObject({code: 'CDP_CONNECT_TIMEOUT'});
        expect(port.nativeClose).toHaveBeenCalledOnce();
        resolveConnect(port.cdp);
        await vi.runAllTimersAsync();
        expect(port.cdp.detach).toHaveBeenCalledOnce();
        expect(port.cdp.send).not.toHaveBeenCalled();
    });

    it('bounds CDP query, detaches, and calls native close before rejecting unknown ownership', async () => {
        const directory = profile(), port = browserPort(123);
        port.cdp.send.mockReturnValue(new Promise(() => {}));
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'performance']});
        guardBrowserClose(port.session, directory);
        expect(await acceleratedClose(port.session)).toMatchObject({code: 'CDP_QUERY_TIMEOUT'});
        expect(port.nativeClose).toHaveBeenCalledOnce();
        expect(port.cdp.detach).toHaveBeenCalledOnce();
        expect(existsSync(directory)).toBe(true);
    });

    it('bounds detach, still terminates the actual owned actor, and refuses a receipt', async () => {
        const owner = await actor(), port = browserPort(owner.pid, () => nativeExit(owner));
        port.cdp.detach.mockReturnValue(new Promise<void>(() => {}));
        guardBrowserClose(port.session, owner.profile);
        expect(await rejected(port.session.close())).toMatchObject({code: 'DETACH_TIMEOUT'});
        expect(await owner.exited).toEqual({code: 0, signal: null});
        expect(existsSync(owner.profile)).toBe(true);
    });

    it('bounds original close, performs owned termination, and retains the profile even after real exit', async () => {
        const owner = await actor(), port = browserPort(owner.pid, () => new Promise(() => {}));
        guardBrowserClose(port.session, owner.profile);
        expect(await rejected(port.session.close())).toMatchObject({code: 'NATIVE_CLOSE_TIMEOUT'});
        expect(await owner.exited).toEqual({code: 0, signal: null});
        expect(existsSync(owner.profile)).toBe(true);
    }, 10000);

    it('bounds an OS ps port that never completes without treating it as absence', async () => {
        const owner = await actor(), port = browserPort(owner.pid);
        guardBrowserClose(port.session, owner.profile);
        await captured(port);
        psFault(owner.pid, () => {});
        const kill = vi.spyOn(process, 'kill');
        expect(await acceleratedClose(port.session)).toMatchObject({code: 'PS_TIMEOUT'});
        expect(kill).not.toHaveBeenCalled();
        expect(existsSync(owner.profile)).toBe(true);
    });

    it.each(['false-success', 'ESRCH'] as const)('has a finite TERM/KILL deadline when %s signal ports leave actor live', async mode => {
        const owner = await actor(), port = browserPort(owner.pid);
        guardBrowserClose(port.session, owner.profile);
        await captured(port);
        const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
            if (mode === 'ESRCH') throw Object.assign(Error('false ESRCH'), {code: 'ESRCH'});
            return true;
        });
        expect(await rejected(port.session.close())).toMatchObject({code: 'TERMINATION_TIMEOUT'});
        expect(kill.mock.calls).toEqual([[owner.pid, 'SIGTERM'], [owner.pid, 'SIGKILL']]);
        expect(await psRow(owner.pid)).toContain(`--user-data-dir=${owner.profile}`);
        expect(events(owner).map(event => event.kind)).toEqual(['ready']);
        expect(existsSync(owner.profile)).toBe(true);
    });

    it('confirms Linux exit when the owned actor disappears between ps and its kernel stat read', async () => {
        const owner = await actor(), port = browserPort(owner.pid);
        Object.defineProperty(process, 'platform', {configurable: true, value: 'linux'});
        const originalRead = fsPort.readFileSync;
        let statReads = 0;
        vi.spyOn(fsPort, 'readFileSync').mockImplementation((file: string, ...args: any[]) => {
            if (file !== `/proc/${owner.pid}/stat`) return originalRead(file, ...args);
            if (++statReads === 1) return `${owner.pid} (owned actor) S ${Array(18).fill('0').join(' ')} 123456 0\n`;
            throw Object.assign(Error('actor was reaped before reading its kernel stat'), {code: 'ENOENT'});
        });
        guardBrowserClose(port.session, owner.profile);
        await captured(port);
        const originalExec = cp.execFile;
        let observations = 0;
        vi.spyOn(cp, 'execFile').mockImplementation((file: string, args: string[], options: any, callback: Function) => {
            if (file !== '/bin/ps' || !args.includes(String(owner.pid))) return originalExec(file, args, options, callback);
            observations++;
            if (observations !== 1) return originalExec(file, args, options, callback);
            // ps really observed this actor. Hold only delivery of that result
            // until the exact ChildProcess exits, reproducing the Linux race.
            return originalExec(file, args, options, (error: Error | null, stdout: string, stderr: string) => {
                if (error) return callback(error, stdout, stderr);
                void nativeExit(owner).then(() => callback(null, stdout, stderr));
            });
        });
        const kill = vi.spyOn(process, 'kill');
        await port.session.close();
        expect(observations).toBe(2);
        expect(statReads).toBe(2);
        expect(kill).not.toHaveBeenCalled();
        expect(port.nativeClose).toHaveBeenCalledOnce();
        expect(await owner.exited).toEqual({code: 0, signal: null});
        expect(existsSync(owner.profile)).toBe(true);
    });

    it.each(['live', 'reused-pid', 'empty-success', 'ps-permission', 'stat-permission'] as const)(
        'does not turn a Linux kernel stat failure into a gone receipt for %s evidence', async mode => {
            const owner = await actor(), port = browserPort(owner.pid);
            Object.defineProperty(process, 'platform', {configurable: true, value: 'linux'});
            const originalRead = fsPort.readFileSync;
            const statError = Object.assign(Error('kernel stat is unavailable'), {code: mode === 'stat-permission' ? 'EACCES' : 'ENOENT'});
            let statReads = 0;
            vi.spyOn(fsPort, 'readFileSync').mockImplementation((file: string, ...args: any[]) => {
                if (file !== `/proc/${owner.pid}/stat`) return originalRead(file, ...args);
                if (++statReads === 1) return `${owner.pid} (owned actor) S ${Array(18).fill('0').join(' ')} 123456 0\n`;
                throw statError;
            });
            guardBrowserClose(port.session, owner.profile);
            await captured(port);
            const row = await psRow(owner.pid);
            const psError = Object.assign(Error('ps denied observation'), {code: 'EACCES'});
            let observations = 0;
            psFault(owner.pid, callback => {
                observations++;
                if (observations === 1 || mode === 'live' || mode === 'stat-permission') callback(null, row, '');
                else if (mode === 'reused-pid') callback(null, row.replace('--user-data-dir=', '--foreign-profile='), '');
                else if (mode === 'empty-success') callback(null, '', '');
                else callback(psError, '', '');
            });
            const kill = vi.spyOn(process, 'kill');
            expect(await rejected(port.session.close())).toBe(mode === 'ps-permission' ? psError : statError);
            expect(observations).toBe(mode === 'stat-permission' ? 1 : 2);
            expect(statReads).toBe(2);
            expect(kill).not.toHaveBeenCalled();
            expect(owner.child.exitCode).toBeNull();
            expect(events(owner).map(event => event.kind)).toEqual(['ready']);
            expect(existsSync(owner.profile)).toBe(true);
        },
    );

    it.each(['unsupported', 'linux-invalid-stat', 'linux-wrong-stat-pid', 'linux-bad-ticks', 'linux-ticks-changed', 'darwin'] as const)('uses the %s process identity port conservatively', async mode => {
        const owner = await actor();
        const port = browserPort(owner.pid, mode === 'darwin' ? () => nativeExit(owner) : async () => {});
        Object.defineProperty(process, 'platform', {configurable: true, value: mode === 'unsupported' ? 'freebsd' : mode === 'darwin' ? 'darwin' : 'linux'});
        let ticks = '123456';
        if (mode.startsWith('linux')) {
            const original = fsPort.readFileSync;
            vi.spyOn(fsPort, 'readFileSync').mockImplementation((file: string, ...args: any[]) => {
                if (file === `/proc/${owner.pid}/stat`) {
                    if (mode === 'linux-invalid-stat') return 'invalid stat';
                    const statPid = mode === 'linux-wrong-stat-pid' ? owner.pid + 1 : owner.pid;
                    const statTicks = mode === 'linux-bad-ticks' ? 'unknown' : ticks;
                    // External /proc port fields; field 22 is kernel start ticks.
                    return `${statPid} (owned actor) S ${Array(18).fill('0').join(' ')} ${statTicks} 0\n`;
                }
                return original(file, ...args);
            });
        }
        guardBrowserClose(port.session, owner.profile);
        await captured(port);
        if (mode === 'linux-ticks-changed') ticks = '123457';
        const kill = vi.spyOn(process, 'kill');
        if (mode === 'darwin') {
            await port.session.close();
            expect(await owner.exited).toEqual({code: 0, signal: null});
        } else {
            expect(await rejected(port.session.close())).toMatchObject({code: mode === 'unsupported' ? 'PLATFORM_UNSUPPORTED' : mode === 'linux-ticks-changed' ? 'IDENTITY_CHANGED' : 'PS_INVALID'});
        }
        expect(kill).not.toHaveBeenCalled();
        expect(port.nativeClose).toHaveBeenCalledOnce();
    });
});


describe('guardBrowserClose transport-only native boundary', () => {
    it.each(['macos-background-cdp', 'macos-foreground-cdp'])('routes %s close and signals through the guard without invoking the old OS fallback', async launchMode => {
        const owner = await actor();
        const port = browserPort(owner.pid, () => {throw Error('unsafe old native fallback reached');});
        const connectionClose = vi.fn(() => nativeExit(owner));
        const route = vi.fn();
        const session = Object.assign(port.session, {launchMode,
            closeBrowserConnection: connectionClose, useGuardedClose: route});
        guardBrowserClose(session, owner.profile);
        expect(route).toHaveBeenCalledWith(session.close);
        const signalClose = route.mock.calls[0][0] as () => Promise<void>;
        const closing = signalClose();
        expect(session.close()).toBe(closing);
        await closing;
        expect(connectionClose).toHaveBeenCalledTimes(1);
        expect(port.nativeClose).not.toHaveBeenCalled();
        expect(await owner.exited).toEqual({code: 0, signal: null});
        expect(existsSync(owner.profile)).toBe(true);
    });

    it.each(['macos-background-cdp', 'macos-foreground-cdp'])('rejects a legacy %s close receipt and never calls its unsafe fallback', async launchMode => {
        const owner = await actor();
        const port = browserPort(owner.pid, () => {throw Error('unsafe old fallback reached');});
        const session = Object.assign(port.session, {launchMode});
        guardBrowserClose(session, owner.profile);
        expect(await rejected(session.close())).toMatchObject({code: 'HELPER_UNSUPPORTED'});
        expect(port.nativeClose).not.toHaveBeenCalled();
        expect(await owner.exited).toEqual({code: 0, signal: null});
        expect(events(owner)).toEqual(expect.arrayContaining([expect.objectContaining({kind: 'TERM', profileExists: true})]));
        expect(existsSync(owner.profile)).toBe(true);
    });

    it.each(['macos-background-cdp', 'macos-foreground-cdp'])('closes only %s transport for a foreign profile, without calling either OS fallback or process signal', async launchMode => {
        const foreign = await actor();
        const ownedProfile = profile();
        const port = browserPort(foreign.pid, () => {throw Error('unsafe fallback reached');});
        const transport = vi.fn(async () => {});
        const session = Object.assign(port.session, {launchMode,
            closeBrowserConnection: transport, useGuardedClose: vi.fn()});
        const kill = vi.spyOn(process, 'kill');
        guardBrowserClose(session, ownedProfile);
        expect(await rejected(session.close())).toMatchObject({code: 'OWNERSHIP_UNKNOWN'});
        expect(transport).toHaveBeenCalledTimes(1);
        expect(port.nativeClose).not.toHaveBeenCalled();
        expect(kill).not.toHaveBeenCalled();
        expect(existsSync(ownedProfile)).toBe(true);
        kill.mockRestore();
        expect(await nativeExit(foreign)).toEqual({code: 0, signal: null});
    });

    it('keeps one capture and close for repeated wrappers, and rejects a different profile', async () => {
        const owner = await actor();
        const port = browserPort(owner.pid, () => nativeExit(owner));
        const wrapped = guardBrowserClose(port.session, owner.profile);
        const close = wrapped.close;
        expect(guardBrowserClose(port.session, owner.profile)).toBe(wrapped);
        expect(wrapped.close).toBe(close);
        expect(() => guardBrowserClose(port.session, profile())).toThrow('another temporary profile');
        await wrapped.close();
        expect(port.cdp.send).toHaveBeenCalledTimes(1);
        expect(port.cdp.detach).toHaveBeenCalledTimes(1);
        expect(port.nativeClose).toHaveBeenCalledTimes(1);
        expect(await owner.exited).toEqual({code: 0, signal: null});
    });

    it.each(['macos-background-cdp', 'macos-foreground-cdp'])('preserves %s signal-routing failures while still closing the known owned process', async launchMode => {
        const owner = await actor();
        const port = browserPort(owner.pid, () => {throw Error('unsafe fallback reached');});
        const failure = new Error('signal routing refused');
        const transport = vi.fn(() => nativeExit(owner));
        const session = Object.assign(port.session, {launchMode,
            closeBrowserConnection: transport, useGuardedClose() {throw failure;}});
        guardBrowserClose(session, owner.profile);
        expect(await rejected(session.close())).toBe(failure);
        expect(transport).toHaveBeenCalledTimes(1);
        expect(port.nativeClose).not.toHaveBeenCalled();
        expect(await owner.exited).toEqual({code: 0, signal: null});
        expect(existsSync(owner.profile)).toBe(true);
    });

    it('retains an unknown foreground transport rejection after exact owned termination', async () => {
        const owner = await actor();
        const port = browserPort(owner.pid, () => {throw Error('persistent native close must not be reached');});
        const failure = Object.assign(Error('unknown CDP transport failure'), {code: 'CONTROLLED_TRANSPORT_FAILURE'});
        const connectionClose = vi.fn(async () => {throw failure;});
        const session = Object.assign(port.session, {launchMode: 'macos-foreground-cdp',
            closeBrowserConnection: connectionClose, useGuardedClose: vi.fn()});
        guardBrowserClose(session, owner.profile);
        const closing = session.close();
        expect(session.close()).toBe(closing);
        expect(await rejected(closing)).toBe(failure);
        expect(await owner.exited).toEqual({code: 0, signal: null});
        expect(connectionClose).toHaveBeenCalledOnce();
        expect(port.nativeClose).not.toHaveBeenCalled();
        expect(events(owner)).toEqual(expect.arrayContaining([expect.objectContaining({kind: 'TERM'})]));
        expect(existsSync(owner.profile)).toBe(true);
    });

    it('foreground transport pending keeps the original 5000 ms failure after cleanup and late fulfillment', async () => {
        const owner = await actor();
        const port = browserPort(owner.pid, () => {throw Error('persistent native close must not be reached');});
        let completeTransport!: () => void;
        const connectionClose = vi.fn(() => new Promise<void>(resolve => {completeTransport = resolve;}));
        const session = Object.assign(port.session, {launchMode: 'macos-foreground-cdp',
            closeBrowserConnection: connectionClose, useGuardedClose: vi.fn()});
        guardBrowserClose(session, owner.profile);
        const closing = session.close();
        const failure = await rejected(closing);
        expect(failure).toMatchObject({code: 'NATIVE_CLOSE_TIMEOUT'});
        expect(await owner.exited).toEqual({code: 0, signal: null});
        completeTransport();
        expect(session.close()).toBe(closing);
        expect(await rejected(session.close())).toBe(failure);
        expect(connectionClose).toHaveBeenCalledOnce();
        expect(port.nativeClose).not.toHaveBeenCalled();
        expect(existsSync(owner.profile)).toBe(true);
    }, 10000);
});


// Launch focus metadata shares the CDP+OS ownership capture.
// Actor cases verify OS lifecycle; native browser behavior has separate gates.
describe('getGuardedBrowserPid public API: shared ownership capture', () => {
    it('returns the OS-verified PID to concurrent readers without another CDP query or native close', async () => {
        const owner = await actor(), port = browserPort(owner.pid, () => nativeExit(owner));
        const wrapped = guardBrowserClose(port.session, owner.profile);
        expect(guardBrowserClose(port.session, owner.profile)).toBe(wrapped);
        expect(await Promise.all([getGuardedBrowserPid(wrapped), getGuardedBrowserPid(wrapped)]))
            .toEqual([owner.pid, owner.pid]);
        expect(port.browser.newBrowserCDPSession).toHaveBeenCalledOnce();
        expect(port.cdp.send).toHaveBeenCalledOnce();
        expect(port.cdp.send).toHaveBeenCalledWith('SystemInfo.getProcessInfo');
        expect(port.cdp.detach).toHaveBeenCalledOnce();
        expect(port.nativeClose).not.toHaveBeenCalled();
        expect(owner.child.exitCode).toBeNull();
        expect(existsSync(owner.profile)).toBe(true);
        await wrapped.close();
        expect(port.nativeClose).toHaveBeenCalledOnce();
        expect(await owner.exited).toEqual({code: 0, signal: null});
    });

    it('does not publish a captured PID until the same session detach has completed', async () => {
        const owner = await actor(), port = browserPort(owner.pid, () => nativeExit(owner));
        let completeDetach!: () => void;
        port.cdp.detach.mockReturnValue(new Promise<void>(resolve => {completeDetach = resolve;}));
        guardBrowserClose(port.session, owner.profile);
        const reading = getGuardedBrowserPid(port.session);
        let settled = false;
        void reading.then(() => {settled = true;}, () => {settled = true;});
        await captured(port);
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(port.nativeClose).not.toHaveBeenCalled();
        completeDetach();
        expect(await reading).toBe(owner.pid);
        expect(port.browser.newBrowserCDPSession).toHaveBeenCalledOnce();
        await port.session.close();
        expect(await owner.exited).toEqual({code: 0, signal: null});
    });

    it('rejects at launch for detach timeout and preserves that same failure for owned close', async () => {
        const owner = await actor(), port = browserPort(owner.pid, () => nativeExit(owner));
        port.cdp.detach.mockReturnValue(new Promise<void>(() => {}));
        guardBrowserClose(port.session, owner.profile);
        const captureError = await rejected(getGuardedBrowserPid(port.session));
        expect(captureError).toMatchObject({code: 'DETACH_TIMEOUT'});
        expect(port.nativeClose).not.toHaveBeenCalled();
        expect(owner.child.exitCode).toBeNull();
        expect(await rejected(port.session.close())).toBe(captureError);
        expect(port.nativeClose).toHaveBeenCalledOnce();
        expect(port.browser.newBrowserCDPSession).toHaveBeenCalledOnce();
        expect(port.cdp.detach).toHaveBeenCalledOnce();
        expect(await owner.exited).toEqual({code: 0, signal: null});
        expect(existsSync(owner.profile)).toBe(true);
    });

    it('preserves every capture error and its order for both the PID reader and close', async () => {
        const directory = profile(), port = browserPort(123);
        const queryFailure = Error('QUERY_FAILED'), detachFailure = Error('DETACH_FAILED');
        port.cdp.send.mockRejectedValue(queryFailure);
        port.cdp.detach.mockRejectedValue(detachFailure);
        guardBrowserClose(port.session, directory);
        const readError = await rejected(getGuardedBrowserPid(port.session));
        expect(readError.cause).toBe(queryFailure);
        expect(readError.errors).toEqual([queryFailure, detachFailure]);
        const closeError = await rejected(port.session.close());
        expect(closeError.cause).toBe(queryFailure);
        expect(closeError.errors).toEqual([queryFailure, detachFailure]);
        expect(port.nativeClose).toHaveBeenCalledOnce();
        expect(port.browser.newBrowserCDPSession).toHaveBeenCalledOnce();
        expect(existsSync(directory)).toBe(true);
    });

    it('refuses a foreign profile PID without signalling it or retrying ownership capture', async () => {
        const expected = profile(), foreign = await actor(), port = browserPort(foreign.pid);
        const kill = vi.spyOn(process, 'kill');
        guardBrowserClose(port.session, expected);
        const captureError = await rejected(getGuardedBrowserPid(port.session));
        expect(captureError).toMatchObject({code: 'OWNERSHIP_UNKNOWN'});
        expect(await rejected(port.session.close())).toBe(captureError);
        expect(kill).not.toHaveBeenCalled();
        expect(port.browser.newBrowserCDPSession).toHaveBeenCalledOnce();
        expect(port.cdp.detach).toHaveBeenCalledOnce();
        expect(events(foreign).map(event => event.kind)).toEqual(['ready']);
        expect(existsSync(expected)).toBe(true);
        kill.mockRestore();
        expect(await nativeExit(foreign)).toEqual({code: 0, signal: null});
    });

    it('rejects an unguarded session without opening any CDP session', async () => {
        const port = browserPort(123);
        expect(await rejected(getGuardedBrowserPid(port.session))).toMatchObject({code: 'SESSION_UNGUARDED'});
        expect(port.browser.newBrowserCDPSession).not.toHaveBeenCalled();
        expect(port.nativeClose).not.toHaveBeenCalled();
    });
});


describe('focus-safe helper shared PID public port integration', () => {
    it('fails before a second CDP session and keeps all nested capture/close codes in the persisted stack', async () => {
        const queryError = Object.assign(Error('capture query failed'), {code: 'CDP_QUERY_TIMEOUT'});
        const detachError = Object.assign(Error('capture detach failed'), {code: 'DETACH_TIMEOUT'});
        const nativeError = Object.assign(Error('transport close failed'), {code: 'NATIVE_CLOSE_TIMEOUT'});
        const captureError = new AggregateError([queryError, detachError], 'capture failed', {cause: queryError});
        const closeError = new AggregateError([nativeError, queryError, detachError], 'close failed', {cause: nativeError});
        const guardedClose = vi.fn(async () => {throw closeError;});
        let guardedSession: unknown;
        const guard = vi.fn((session: any, directory: string) => {
            expect(directory).toBe('/private/tmp/focus-reuse-candidate');
            guardedSession = session;
            session.close = guardedClose;
            return session;
        });
        const readPid = vi.fn(async (session: unknown) => {
            expect(session).toBe(guardedSession);
            throw captureError;
        });
        const openExtraSession = vi.fn(async () => {throw Error('Unexpected duplicate PID or window session');});
        const context = {};
        const browser = {contexts: () => [context], newBrowserCDPSession: openExtraSession};
        const deleted: string[] = [];
        const execFile = () => {throw Error('Unexpected native execution');};
        const util = require('node:util');
        (execFile as any)[util.promisify.custom] = async (file: string) => {
            if (file === '/usr/bin/open') return {stdout: ''};
            expect(file).toBe('/usr/bin/osascript');
            return {stdout: JSON.stringify({pid: 777, name: 'fixture frontmost'})};
        };
        const module = {exports: {} as any};
        const helperRequire = (specifier: string) => {
            if (specifier === './owned-browser-close.cjs') return {guardBrowserClose: guard, getGuardedBrowserPid: readPid};
            if (specifier === 'node:child_process') return {execFile};
            if (specifier === 'node:fs') return {
                existsSync: () => true,
                lstatSync: () => undefined,
                rmSync: (file: string) => {deleted.push(file);},
                readFileSync: () => '9230\n',
            };
            return require(specifier);
        };
        const helperPath = new URL('../scripts/testing/focus-safe-browser.cjs', import.meta.url);
        const {Script} = require('node:vm');
        new Script(readFileSync(helperPath, 'utf8'), {filename: helperPath.pathname}).runInNewContext({
            module, exports: module.exports, require: helperRequire, console,
            process: {platform: 'darwin', once: vi.fn(), off: vi.fn(), exit: () => {throw Error('Unexpected process exit');}},
            setTimeout, clearTimeout,
        });
        const failure = await rejected(module.exports.launchFocusSafePersistentContext({
            chromium: {connectOverCDP: vi.fn(async () => browser)},
            profileDir: '/private/tmp/focus-reuse-candidate',
            browserPath: '/Applications/Fixture.app/Contents/MacOS/Fixture',
            background: true, headless: false, viewport: {width: 1280, height: 900},
        }));
        expect(guard).toHaveBeenCalledOnce();
        expect(readPid).toHaveBeenCalledOnce();
        expect(guardedClose).toHaveBeenCalledOnce();
        expect(openExtraSession).not.toHaveBeenCalled();
        expect(failure.cause).toBe(captureError);
        expect(failure.errors).toEqual([captureError, closeError]);
        expect(failure.stack).toContain('CDP_QUERY_TIMEOUT');
        expect(failure.stack).toContain('DETACH_TIMEOUT');
        expect(failure.stack).toContain('NATIVE_CLOSE_TIMEOUT');
        expect(deleted).toEqual(['/private/tmp/focus-reuse-candidate/DevToolsActivePort']);
    });
});
