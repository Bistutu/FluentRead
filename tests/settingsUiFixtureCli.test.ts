/**
 * @file tests/settingsUiFixtureCli.test.ts
 * 文件职责：通过两个设置专项的实际公开 CLI 子进程验证异常与资源清理。
 * 主要内容：仅替换外部 launcher/page/文件系统故障端口；partial launch 使用本测试实际持有的 Node 子进程句柄；设置中心等待用实际脚本谓词和共享 Node 轮询器验证异步存储、截止时间与错误传播。
 * 模块边界：不模拟设置 DOM、不执行 native/UI 断言、不启动浏览器或请求服务；默认执行 process.cwd() 下的公开脚本，私有源覆写必须显式提供。
 */
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {createRequire} from 'node:module';
import {Script} from 'node:vm';
import ts from 'typescript';
import {spawn, type ChildProcess} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const sourceRoot = path.resolve(process.env.FLUENTREAD_SETTINGS_UI_FIXTURE_SOURCE_ROOT || process.cwd());
const evidenceRoot = process.env.FLUENTREAD_SETTINGS_UI_FIXTURE_EVIDENCE;
const scripts = ['run-settings-search-results-layout-test.cjs', 'run-service-group-navigation-test.cjs'];
type Exit = {code: number | null; signal: NodeJS.Signals | null};
type Event = {kind: string; [key: string]: any};
const owned = new Map<ChildProcess, Promise<Exit>>();
const receipts: Record<string, unknown>[] = [];
let suiteRoot: string;
let invocation = 0;
let activeTimers = 0;

function track(child: ChildProcess): Promise<Exit> {
    const closed = new Promise<Exit>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => {owned.delete(child); resolve({code, signal});});
    });
    owned.set(child, closed);
    return closed;
}

function gone(child: ChildProcess): boolean {
    if (!child.pid) return false;
    try {process.kill(child.pid, 0); return false;}
    catch (error) {return (error as NodeJS.ErrnoException).code === 'ESRCH';}
}

async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    activeTimers++;
    try {
        return await Promise.race([promise, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Owned process/port deadline exceeded')), milliseconds);
        })]);
    } finally {if (timer) clearTimeout(timer); activeTimers--;}
}

async function stopOwned(child: ChildProcess, closed: Promise<Exit>, reason: string): Promise<Exit> {
    const signals: string[] = [];
    if (owned.has(child)) {signals.push('SIGTERM'); child.kill('SIGTERM');}
    let exit: Exit;
    try {exit = await bounded(closed, 1500);}
    catch {
        if (owned.has(child)) {signals.push('SIGKILL'); child.kill('SIGKILL');}
        exit = await bounded(closed, 1500);
    }
    receipts.push({pid: child.pid, reason, signals, waited: true, gone: gone(child), ...exit});
    if (!gone(child)) throw new Error('Tracked owned process is still alive after close');
    return exit;
}

const preload = String.raw`
const fs=require('node:fs'),path=require('node:path');
const fixture=process.env.SETTINGS_CLI_FIXTURE,flags=global.__settingsCliFlags=new Set(process.env.SETTINGS_CLI_FAULT.split('+'));
const log=global.__settingsCliLog=(kind,data={})=>fs.appendFileSync(path.join(fixture,'events.jsonl'),JSON.stringify({kind,...data})+'\n');
let ownedProfile;
const temp=fs.mkdtempSync;
fs.mkdtempSync=function(prefix,...rest){
 log('profile-create-attempt',{prefix});
 if(flags.has('temp-fail'))throw Error('CONTROLLED_TEMP_ACQUISITION_FAILURE');
 if(!/^\/private\/tmp\/fr-(settings-search-results|service-group-navigation)-$/.test(prefix))throw Error('UNEXPECTED_TEMP_PREFIX');
 ownedProfile=temp.call(this,path.join(fixture,'profiles','owned-'),...rest);
 log('profile-created',{directory:ownedProfile});return ownedProfile;
};
const remove=fs.rmSync;
fs.rmSync=function(directory,...rest){
 if(directory!==ownedProfile)throw Error('REFUSE_FOREIGN_PROFILE_REMOVAL');
 log('profile-remove',{directory});
 if(flags.has('remove-fail'))throw Error('CONTROLLED_PROFILE_REMOVE_FAILURE');
 const result=remove.call(this,directory,...rest);log('profile-removed',{directory});return result;
};
const write=fs.writeFileSync;
fs.writeFileSync=function(file,...rest){
 if(file===path.join(fixture,'artifacts','report.json'))log('report-write');
 return write.call(this,file,...rest);
};
log('cli-ready',{pid:process.pid});
`;

const launcher = String.raw`
const fs=require('node:fs'),path=require('node:path');
const flags=global.__settingsCliFlags,log=global.__settingsCliLog,fixture=process.env.SETTINGS_CLI_FIXTURE;
let pending=0;
function actorPort(type,profileDir){
 return new Promise((resolve,reject)=>{
  pending++;
  const timer=setTimeout(()=>{process.removeListener('message',onMessage);pending--;reject(Error('ACTOR_PORT_TIMEOUT'));},1500);
  function onMessage(message){if(message.type!==type+'-receipt')return;clearTimeout(timer);process.removeListener('message',onMessage);pending--;if(message.error)reject(Error(message.error));else resolve(message);}
  process.on('message',onMessage);process.send({type,profileDir});
 });
}
exports.launchFocusSafePersistentContext=async options=>{
 log('launch-attempt',{profileDir:options.profileDir});
 if(flags.has('partial-launch')||flags.has('actor-close'))log('actor-ready-receipt',await actorPort('actor-start',options.profileDir));
 if(flags.has('partial-launch'))throw Error('CONTROLLED_PARTIAL_LAUNCH_FAILURE');
 const context={serviceWorkers:()=>[{url:()=> 'chrome-extension://controlled-external-port/background.js'}]};
 return {context,launchMode:'controlled-external-port',focusPolicy:'no-browser',windowPlacement:{},close:async()=>{
  log('session-close-start');
  if(flags.has('close-fail'))throw Error('CONTROLLED_SESSION_CLOSE_FAILURE');
  if(flags.has('actor-close')){
   const receipt=await actorPort('actor-stop',options.profileDir);
   if(!receipt.waited||!receipt.gone||!receipt.timerCleared||!receipt.fdClosed)throw Error('UNCONFIRMED_ACTOR_CLOSE');
   log('actor-close-receipt',receipt);
  }
  if(flags.has('ownership-swap')){
   fs.renameSync(options.profileDir,options.profileDir+'.original');
   fs.symlinkSync(path.join(fixture,'foreign-profile'),options.profileDir);
   log('profile-ownership-swapped',{directory:options.profileDir});
  }
  log('session-close-success');
 }};
};
exports.newPageWithoutForeground=async()=>{
 log('page-acquisition-failure');
 if(flags.has('primary-null'))throw null;
 throw Error('CONTROLLED_PRIMARY_PAGE_FAILURE');
};
process.on('exit',()=>log('external-port-timers',{pending}));
`;

const actorSource = String.raw`
const fs=require('node:fs'),path=require('node:path');
const profileDir=process.argv[2];
const fd=fs.openSync(path.join(profileDir,'owned-actor.lock'),'w');
const timer=setInterval(()=>{},1000);
process.stdout.write(JSON.stringify({ready:true,pid:process.pid,profileDir})+'\n');
process.once('SIGTERM',()=>{
 clearInterval(timer);fs.closeSync(fd);
 process.stdout.write(JSON.stringify({timerCleared:true,fdClosed:true})+'\n',()=>process.exit(0));
});
`;

beforeAll(() => {
    const parent = process.env.FLUENTREAD_SETTINGS_UI_FIXTURE_TEMP_ROOT || tmpdir();
    mkdirSync(parent, {recursive: true});
    suiteRoot = mkdtempSync(path.join(parent, 'settings-ui-cli-'));
});
afterAll(async () => {
    for (const [child, closed] of [...owned]) await stopOwned(child, closed, 'suite-finally');
    if (evidenceRoot) {
        mkdirSync(evidenceRoot, {recursive: true});
        writeFileSync(path.join(evidenceRoot, 'resource-receipts.json'), JSON.stringify({testWorkerPid: process.pid, receipts, activeOwnedHandles: owned.size, activeTimers}, null, 2));
    }
    expect(owned.size).toBe(0);
    expect(activeTimers).toBe(0);
    if (suiteRoot) rmSync(suiteRoot, {recursive: true, force: true});
});

async function invoke(script: string, fault: string) {
    const number = ++invocation;
    const fixture = path.join(suiteRoot, String(number));
    for (const directory of ['runtime/playwright', 'profiles', 'foreign-profile', 'extension']) mkdirSync(path.join(fixture, directory), {recursive: true});
    if (fault.includes('mkdir-fail')) writeFileSync(path.join(fixture, 'artifacts'), 'actual file blocks mkdir');
    else mkdirSync(path.join(fixture, 'artifacts'));
    if (fault.includes('report-eisdir')) mkdirSync(path.join(fixture, 'artifacts', 'report.json'));
    writeFileSync(path.join(fixture, 'foreign-profile', 'sentinel'), 'foreign profile must survive');
    writeFileSync(path.join(fixture, 'runtime/playwright/index.js'), 'exports.chromium={};\n');
    writeFileSync(path.join(fixture, 'runtime/playwright/package.json'), '{"type":"commonjs","main":"index.js"}');
    writeFileSync(path.join(fixture, 'preload.cjs'), preload);
    writeFileSync(path.join(fixture, 'launcher.cjs'), launcher);
    writeFileSync(path.join(fixture, 'actor.cjs'), actorSource);
    writeFileSync(path.join(fixture, 'events.jsonl'), '');
    const scriptPath = path.join(sourceRoot, 'scripts/testing', script);
    const child = spawn(process.execPath, ['--require', path.join(fixture, 'preload.cjs'), scriptPath,
        '--playwright-root', path.join(fixture, 'runtime'), '--focus-safe-helper', path.join(fixture, 'launcher.cjs'),
        '--extension-dir', path.join(fixture, 'extension'), '--artifacts-dir', path.join(fixture, 'artifacts')], {
        cwd: fixture, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: {...process.env, SETTINGS_CLI_FAULT: fault, SETTINGS_CLI_FIXTURE: fixture},
    });
    const closed = track(child);
    let stdout = '', stderr = '', actorOutput = '', portError: unknown;
    let actor: ChildProcess | undefined;
    let actorClosed: Promise<Exit> | undefined;
    let actorStop: Promise<Exit> | undefined;
    let result: any;
    child.stdout!.on('data', chunk => {stdout += chunk;});
    child.stderr!.on('data', chunk => {stderr += chunk;});
    async function onMessage(message: any) {
        try {
            if (message.type === 'actor-start') {
                if (actor || path.dirname(message.profileDir) !== path.join(fixture, 'profiles')) throw new Error('Refuse foreign or duplicate actor');
                actor = spawn(process.execPath, [path.join(fixture, 'actor.cjs'), message.profileDir], {stdio: ['ignore', 'pipe', 'pipe']});
                actorClosed = track(actor);
                const ready = new Promise<void>(resolve => {
                    actor!.stdout!.on('data', chunk => {actorOutput += chunk; if (actorOutput.includes('"ready":true')) resolve();});
                });
                await bounded(ready, 1500);
                child.send({type: 'actor-start-receipt', pid: actor.pid, actualOwnedHandle: true});
            } else if (message.type === 'actor-stop') {
                if (!actor || !actorClosed || actorStop) throw new Error('Refuse unowned or repeated actor stop');
                actorStop = stopOwned(actor, actorClosed, 'awaited-launcher-close');
                const exit = await actorStop;
                child.send({type: 'actor-stop-receipt', pid: actor.pid, waited: true, gone: gone(actor),
                    timerCleared: actorOutput.includes('"timerCleared":true'), fdClosed: actorOutput.includes('"fdClosed":true'), ...exit});
            }
        } catch (error) {
            portError = error;
            if (child.connected) child.send({type: message.type + '-receipt', error: String(error)});
        }
    }
    child.on('message', onMessage);
    try {
        const exit = await bounded(closed, 5000);
        receipts.push({pid: child.pid, reason: 'cli-natural-exit', waited: true, gone: gone(child), ...exit});
        const events: Event[] = readFileSync(path.join(fixture, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
        const profiles = events.filter(event => event.kind === 'profile-created').map(event => ({path: event.directory, existsAtCliClose: existsSync(event.directory)}));
        const reportFile = path.join(fixture, 'artifacts/report.json');
        const report = existsSync(reportFile) && statSync(reportFile).isFile() ? JSON.parse(readFileSync(reportFile, 'utf8')) : undefined;
        let summary;
        try {summary = JSON.parse(stdout.trim().split('\n').at(-1) || '');} catch {summary = undefined;}
        result = {...exit, fault, script, scriptPath, scriptSha256: createHash('sha256').update(readFileSync(scriptPath)).digest('hex'),
            cliPid: child.pid, cliWaited: true, cliGone: gone(child), stdout, stderr, events, profiles, report, summary,
            actorAtCliClose: actor ? {pid: actor.pid, alive: !gone(actor), profileExists: profiles[0]?.existsAtCliClose, output: actorOutput} : undefined,
            foreignSentinelAtCliClose: readFileSync(path.join(fixture, 'foreign-profile/sentinel'), 'utf8')};
    } finally {
        if (actorStop) await actorStop;
        if (actor && actorClosed && owned.has(actor)) await stopOwned(actor, actorClosed, 'fixture-finally');
        if (owned.has(child)) await stopOwned(child, closed, 'fixture-finally');
        child.removeListener('message', onMessage);
        if (evidenceRoot && result) {
            mkdirSync(evidenceRoot, {recursive: true});
            writeFileSync(path.join(evidenceRoot, `${number}-${script}-${fault}.json`), JSON.stringify({...result,
                actorGoneAfterTeardown: actor ? gone(actor) : undefined, actorOutputAfterTeardown: actorOutput,
                activeOwnedHandlesAfterTeardown: owned.size, activeTimersAfterTeardown: activeTimers, portError: portError ? String(portError) : undefined}, null, 2));
        }
    }
    expect(portError).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.cliGone).toBe(true);
    expect(result.foreignSentinelAtCliClose).toBe('foreign profile must survive');
    if (actor) expect(gone(actor)).toBe(true);
    return result;
}

const count = (result: any, kind: string) => result.events.filter((event: Event) => event.kind === kind).length;
function primary(result: any, message = 'CONTROLLED_PRIMARY_PAGE_FAILURE') {
    expect(result.code).toBe(1);
    expect(result.report?.ok ?? result.summary?.ok, 'cleanup/primary failure cannot claim UI success').toBe(false);
    expect(result.report?.error ?? result.summary?.error, 'primary error stays available').toContain(message);
    expect(result.report?.cases ?? result.summary?.cases, 'fixture fails before any native/UI case runs').toEqual(result.report ? [] : 0);
}
function cleanupErrors(record: any): string {
    expect(Array.isArray(record?.cleanupErrors), 'independent cleanup failures have a structured array').toBe(true);
    return record.cleanupErrors.join('\n');
}
function removed(result: any) {
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].existsAtCliClose).toBe(false);
    expect(count(result, 'profile-removed')).toBe(1);
}

for (const script of scripts) describe(`${script} actual public CLI cleanup`, () => {
    it('cleans independently before EISDIR report failure and preserves the primary', async () => {
        const result = await invoke(script, 'report-eisdir');
        primary(result); removed(result);
        expect(cleanupErrors(result.summary)).toMatch(/report write:.*EISDIR/s);
        expect(count(result, 'session-close-success')).toBe(1);
        expect(result.events.findIndex((event: Event) => event.kind === 'profile-removed')).toBeLessThan(result.events.findIndex((event: Event) => event.kind === 'report-write'));
    });
    it('records close failure, keeps profile and persists report false', async () => {
        const result = await invoke(script, 'close-fail');
        primary(result);
        expect(cleanupErrors(result.report)).toContain('CONTROLLED_SESSION_CLOSE_FAILURE');
        expect(result.report.retainedProfile).toBe(result.profiles[0].path);
        expect(result.profiles[0].existsAtCliClose).toBe(true);
        expect(count(result, 'profile-remove')).toBe(0);
    });
    it('reports independent close and report failures without replacing the primary', async () => {
        const result = await invoke(script, 'close-fail+report-eisdir');
        primary(result);
        expect(cleanupErrors(result.summary)).toContain('CONTROLLED_SESSION_CLOSE_FAILURE');
        expect(cleanupErrors(result.summary)).toContain('EISDIR');
        expect(result.summary.retainedProfile).toBe(result.profiles[0].path);
        expect(count(result, 'profile-remove')).toBe(0);
    });
    it('keeps partial-launch profile while its actual owned actor has no exit receipt', async () => {
        const result = await invoke(script, 'partial-launch');
        primary(result, 'CONTROLLED_PARTIAL_LAUNCH_FAILURE');
        expect(result.actorAtCliClose).toMatchObject({alive: true, profileExists: true});
        expect(result.report.retainedProfile).toBe(result.profiles[0].path);
        expect(count(result, 'profile-remove')).toBe(0);
    });
    it('removes only after close awaits actual owned actor exit and fd/timer release', async () => {
        const result = await invoke(script, 'actor-close');
        primary(result); removed(result);
        expect(result.actorAtCliClose).toMatchObject({alive: false, profileExists: false});
        const receipt = result.events.find((event: Event) => event.kind === 'actor-close-receipt');
        expect(receipt).toMatchObject({waited: true, gone: true, timerCleared: true, fdClosed: true});
        expect(result.events.findIndex((event: Event) => event.kind === 'actor-close-receipt')).toBeLessThan(result.events.findIndex((event: Event) => event.kind === 'profile-remove'));
        expect(result.events.findIndex((event: Event) => event.kind === 'profile-removed')).toBeLessThan(result.events.findIndex((event: Event) => event.kind === 'report-write'));
    });
    it('preserves a null non-Error primary and still closes/removes', async () => {
        const result = await invoke(script, 'primary-null');
        primary(result, 'null'); removed(result);
        expect(result.report.error).toBe('null');
        expect(result.stderr).not.toContain('TypeError');
    });
    it('guards actual artifacts mkdir failure and publishes primary plus report-write error', async () => {
        const result = await invoke(script, 'mkdir-fail');
        primary(result, 'EEXIST');
        expect(result.profiles).toHaveLength(0);
        expect(count(result, 'launch-attempt')).toBe(0);
        expect(cleanupErrors(result.summary)).toContain('report write');
    });
    it('guards temp acquisition failure without launch or profile removal', async () => {
        const result = await invoke(script, 'temp-fail');
        primary(result, 'CONTROLLED_TEMP_ACQUISITION_FAILURE');
        expect(result.profiles).toHaveLength(0);
        expect(count(result, 'launch-attempt')).toBe(0);
        expect(count(result, 'profile-remove')).toBe(0);
    });
    it('records profile removal failure after successful close without losing primary', async () => {
        const result = await invoke(script, 'remove-fail');
        primary(result);
        expect(cleanupErrors(result.report)).toContain('CONTROLLED_PROFILE_REMOVE_FAILURE');
        expect(result.report.retainedProfile).toBe(result.profiles[0].path);
        expect(result.profiles[0].existsAtCliClose).toBe(true);
        expect(count(result, 'session-close-success')).toBe(1);
    });
    it('retains changed profile identity without deleting the foreign replacement', async () => {
        const result = await invoke(script, 'ownership-swap');
        primary(result);
        expect(cleanupErrors(result.report)).toContain('Temporary profile ownership changed');
        expect(result.report.retainedProfile).toBe(result.profiles[0].path);
        expect(result.profiles[0].existsAtCliClose).toBe(true);
        expect(count(result, 'profile-remove')).toBe(0);
    });
});

// 只取实际调用表达式执行，不提取 main 或仿造设置 DOM；浏览器端谓词按
// page.evaluate 的序列化边界放进独立 VM，存储端口可控，轮询器使用真实字节。
const requireSettingsWait = createRequire(import.meta.url);
const {waitForAsyncCondition} = requireSettingsWait(path.join(sourceRoot, 'scripts/testing/wait-for-async-condition.cjs'));
const centerSource = readFileSync(path.join(sourceRoot, 'scripts/testing/run-settings-center-ui-test.cjs'), 'utf8');
const centerAst = ts.createSourceFile('settings-center.cjs', centerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const storageWaitMessages = ['命名译文样式未持久化：期望 ', '旧存储迁移后缺少预期的加密配置记录'];
const storageWaitCalls = new Map<string, ts.CallExpression>();
function collectStorageWaits(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.expression.getText(centerAst) === 'waitForAsyncCondition') {
        const options = node.arguments[1];
        const message = options && ts.isObjectLiteralExpression(options)
            ? options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(centerAst) === 'message')
            : undefined;
        if (message && ts.isPropertyAssignment(message)) {
            const text = ts.isTemplateExpression(message.initializer) ? message.initializer.head.text
                : ts.isStringLiteralLike(message.initializer) ? message.initializer.text : undefined;
            if (text && storageWaitMessages.includes(text)) {
                if (storageWaitCalls.has(text)) throw new Error(`设置中心存储等待重复：${text}`);
                storageWaitCalls.set(text, node);
            }
        }
    }
    ts.forEachChild(node, collectStorageWaits);
}
collectStorageWaits(centerAst);
function runStorageWait(index: number, page: unknown, {count = 2, activeName = '回归对照', timeout = 30000} = {}): Promise<void> {
    // 动画和逐句高亮也需要存储等待；按实际失败文案定位本组两条谓词，
    // 不依赖全脚本调用数量或 AST 遍历顺序，仍拒绝目标缺失与重复。
    const call = storageWaitCalls.get(storageWaitMessages[index]);
    if (storageWaitCalls.size !== storageWaitMessages.length || !call) throw new Error('设置中心必须保留两个独立存储等待');
    return new Script(`(async () => ${call.getText(centerAst)})()`).runInNewContext({
        waitForAsyncCondition, page, count, activeName, timeout,
        configDatabaseName: 'FluentReadConfiguration',
        migratedRecordKeys: ['local:config', 'local:configAutoBackups', 'local:credentials'],
    });
}
function pageWithStorage(ports: Record<string, unknown>) {
    return {evaluate: vi.fn((predicate: (args: unknown) => unknown, args: unknown) =>
        new Script(`(${predicate.toString()})(args)`).runInNewContext({...ports, args}))};
}
function profileSnapshot(names = ['回归阅读', '回归对照'], active = names.at(-1) || '') {
    return {translationStyleProfiles: names.map((name, id) => ({id: String(id), name, style: id})),
        activeTranslationStyleProfileId: String(names.indexOf(active))};
}
async function flushWait() {for (let i = 0; i < 20; i++) await Promise.resolve();}
function pendingRead<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => {resolve = yes;});
    return {promise, resolve};
}
function indexedDbPort(readKeys: () => Promise<string[]>) {
    const close = vi.fn();
    const indexedDB = {open: vi.fn(() => {
        const open: any = {};
        queueMicrotask(() => {
            open.result = {close, transaction: vi.fn(() => ({objectStore: vi.fn(() => ({getAllKeys: () => {
                const request: any = {};
                void readKeys().then(keys => {request.result = keys; request.onsuccess();}, error => {request.error = error; request.onerror();});
                return request;
            }}))}))};
            open.onsuccess();
        });
        return open;
    })};
    return {indexedDB, close};
}

describe('settings center actual async storage waits', () => {
    afterEach(() => {vi.useRealTimers();});
    function clock() {vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'performance']});}
    it.each(['object', 'json'])('awaits %s false results, checks exact count and active name, and serializes reads', async format => {
        clock();
        const gate = pendingRead<any>();
        const value = (config: unknown) => ({success: true, value: format === 'json' ? JSON.stringify(config) : config});
        const sendMessage = vi.fn().mockReturnValueOnce(gate.promise)
            .mockResolvedValueOnce(value(profileSnapshot(['回归阅读', '回归对照'], '回归阅读')))
            .mockResolvedValueOnce(value(profileSnapshot()));
        const page = pageWithStorage({chrome: {runtime: {sendMessage}}});
        let completed = false;
        const result = runStorageWait(0, page).then(() => {completed = true;});
        await flushWait();
        await vi.advanceTimersByTimeAsync(500);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(completed).toBe(false);
        gate.resolve(value(profileSnapshot(['回归阅读'])));
        await flushWait();
        await vi.advanceTimersByTimeAsync(99);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(completed).toBe(false);
        await vi.advanceTimersByTimeAsync(100);
        await result;
        expect(sendMessage).toHaveBeenCalledTimes(3);
        expect(sendMessage).toHaveBeenLastCalledWith({type: 'configStorageRead', key: 'local:config'});
        expect(vi.getTimerCount()).toBe(0);
    });
    it('preserves the empty/deleted style case and exact active-name matching', async () => {
        clock();
        const sendMessage = vi.fn().mockResolvedValue({success: true, value: profileSnapshot([])});
        await runStorageWait(0, pageWithStorage({chrome: {runtime: {sendMessage}}}), {count: 0, activeName: ''});
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
    it.each(['mismatch', 'hung'])('fails %s at the original 30000ms deadline and clears timers', async fault => {
        clock();
        const gate = pendingRead<any>();
        const sendMessage = vi.fn(() => fault === 'hung' ? gate.promise : Promise.resolve({success: true, value: profileSnapshot(['回归阅读'])}));
        const result = runStorageWait(0, pageWithStorage({chrome: {runtime: {sendMessage}}})).catch(error => error);
        await flushWait();
        await vi.advanceTimersByTimeAsync(29999);
        expect(vi.getTimerCount()).toBeGreaterThan(0);
        await vi.advanceTimersByTimeAsync(1);
        const error = await result;
        expect(error.message).toContain('命名译文样式未持久化');
        expect(error.message).toContain('30000ms');
        expect(vi.getTimerCount()).toBe(0);
        const reads = sendMessage.mock.calls.length;
        gate.resolve({success: true, value: profileSnapshot()});
        await flushWait();
        await vi.advanceTimersByTimeAsync(1000);
        expect(sendMessage).toHaveBeenCalledTimes(reads);
    });
    it('propagates storage rejection and malformed JSON without retrying or passing', async () => {
        clock();
        const original = new Error('CONTROLLED_CONFIG_READ_FAILURE');
        const sendMessage = vi.fn().mockRejectedValue(original);
        await expect(runStorageWait(0, pageWithStorage({chrome: {runtime: {sendMessage}}}))).rejects.toBe(original);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        const malformed = vi.fn().mockResolvedValue({success: true, value: '{'});
        await expect(runStorageWait(0, pageWithStorage({chrome: {runtime: {sendMessage: malformed}}}))).rejects.toHaveProperty('name', 'SyntaxError');
        expect(malformed).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('awaits missing encrypted record keys, polls again and closes every IndexedDB handle', async () => {
        clock();
        const readKeys = vi.fn().mockResolvedValueOnce(['local:config'])
            .mockResolvedValueOnce(['local:config', 'local:configAutoBackups', 'local:credentials']);
        const port = indexedDbPort(readKeys);
        const page = pageWithStorage({indexedDB: port.indexedDB});
        let completed = false;
        const result = runStorageWait(1, page).then(() => {completed = true;});
        await flushWait();
        expect(completed).toBe(false);
        expect(port.close).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(100);
        await result;
        expect(port.indexedDB.open).toHaveBeenLastCalledWith('FluentReadConfiguration');
        expect(port.close).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('fails permanently missing migration records within 30000ms instead of passing', async () => {
        clock();
        const port = indexedDbPort(vi.fn().mockResolvedValue(['local:config']));
        const result = runStorageWait(1, pageWithStorage({indexedDB: port.indexedDB})).catch(error => error);
        await flushWait();
        await vi.advanceTimersByTimeAsync(30000);
        expect((await result).message).toContain('旧存储迁移后缺少预期的加密配置记录');
        expect(port.close).toHaveBeenCalledTimes(port.indexedDB.open.mock.calls.length);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('propagates IndexedDB read failure and still closes the opened handle', async () => {
        clock();
        const original = new Error('CONTROLLED_INDEXED_DB_READ_FAILURE');
        const port = indexedDbPort(vi.fn().mockRejectedValue(original));
        await expect(runStorageWait(1, pageWithStorage({indexedDB: port.indexedDB}))).rejects.toBe(original);
        expect(port.indexedDB.open).toHaveBeenCalledTimes(1);
        expect(port.close).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });
});
