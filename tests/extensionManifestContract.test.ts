import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import JSZip from 'jszip';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {describe, expect, it, vi} from 'vitest';
import ts from 'typescript';
import {defineUnlistedScript} from 'wxt/utils/define-unlisted-script';
import {createHash, generateKeyPairSync} from 'node:crypto';
import {GOOGLE_DRIVE_DEFAULT_CLIENT_ID, GOOGLE_DRIVE_EXTENSION_ID, GOOGLE_DRIVE_EXTENSION_PUBLIC_KEY, GOOGLE_DRIVE_SCOPES} from '@/src/platform/google-drive/constants';
import {createDriveAuth, type DriveAuthPorts} from '@/src/platform/google-drive/auth';
import type {Entrypoint, EntrypointGroup} from 'wxt';
import {remoteConfigStorageBuildPlugin, createExtensionManifest, extendRemoteConfigBuildConfig, groupModuleWorkers, finalizeExtensionZip} from '@/wxt.config';

const PROJECT_ROOT = resolve(__dirname, '..');

describe('Safari unsigned delivery contract', () => {
    async function safariTools() {
        return import(/* @vite-ignore */ pathToFileURL(resolve(PROJECT_ROOT, 'scripts/safari/package.mjs')).href);
    }

    function safariFixture() {
        const source = createExtensionManifest({browser: 'safari', manifestVersion: 2});
        return {...source, manifest_version: 2, version: '0.0.38',
            permissions: [...source.permissions!, ...source.host_permissions!],
            background: {scripts: ['background.js'], persistent: false},
            browser_action: {default_popup: 'popup.html'},
            content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}],
        };
    }

    it('Safari 使用独立版本门槛及能力权限，保留共享网页业务入口', async () => {
        const {verifySafariManifest} = await safariTools();
        const manifest = safariFixture();
        expect(verifySafariManifest(manifest)).toBe(manifest);
        expect(manifest.browser_specific_settings).toEqual({safari: {strict_min_version: '26.0'}});
        expect(manifest.web_accessible_resources).toEqual(expect.arrayContaining([
            expect.objectContaining({resources: ['popup.html']}),
        ]));
        expect(JSON.stringify(manifest.web_accessible_resources)).not.toContain('use_dynamic_url');
        for (const invalid of [
            {...manifest, manifest_version: 3},
            {...manifest, background: {scripts: ['background.js'], persistent: true}},
            {...manifest, permissions: [...manifest.permissions, 'offscreen']},
            {...manifest, permissions: [...manifest.permissions, 'identity']},
            {...manifest, permissions: ['storage']},
            {...manifest, browser_specific_settings: {safari: {strict_min_version: '15.0'}}},
            {...manifest, key: 'chromium-id'},
            {...manifest, content_scripts: []},
            {...manifest, browser_action: undefined},
        ]) expect(() => verifySafariManifest(invalid)).toThrow();
        expect(readFileSync(resolve(PROJECT_ROOT, 'entrypoints/background.ts'), 'utf8')).toContain('safari: false');
    });

    it('打包新旧工具回退可用，生成参数始终复制资源且不打开、覆盖或签名', async () => {
        const {findPackager, packagingArguments, applyDeploymentTargets} = await safariTools();
        const probe = vi.fn((_command, args) => args[1] === 'safari-web-extension-packager'
            ? {status: 1, stdout: ''} : {status: 0, stdout: '/Xcode/safari-web-extension-converter\n'});
        expect(findPackager(probe, {})).toEqual({name: 'safari-web-extension-converter', executable: '/Xcode/safari-web-extension-converter'});
        expect(probe).toHaveBeenCalledTimes(2);
        expect(() => findPackager(() => ({status: 1}), {})).toThrow('Xcode');
        const config = {extension: '/build/safari-mv2', projectLocation: '/output/FluentRead', bundleId: 'org.example.FluentRead', platform: 'both'};
        const args = packagingArguments(config);
        expect(args).toEqual([config.extension, '--project-location', config.projectLocation, '--app-name', 'FluentRead', '--bundle-identifier', config.bundleId,
            '--swift', '--copy-resources', '--no-open', '--no-prompt']);
        expect(packagingArguments({...config, platform: 'ios'})).toContain('--ios-only');
        expect(packagingArguments({...config, platform: 'macos'})).toContain('--macos-only');
        expect(() => packagingArguments({...config, bundleId: ''})).toThrow('bundle-id');
        expect(() => packagingArguments({...config, platform: 'windows'})).toThrow('platform');
        expect(applyDeploymentTargets('IPHONEOS_DEPLOYMENT_TARGET = 15.0;\nMACOSX_DEPLOYMENT_TARGET = 10.14;', 'both'))
            .toBe('IPHONEOS_DEPLOYMENT_TARGET = 26.0;\nMACOSX_DEPLOYMENT_TARGET = 14.0;');
        expect(applyDeploymentTargets('IPHONEOS_DEPLOYMENT_TARGET = 27.0;', 'ios')).toContain('27.0');
        expect(applyDeploymentTargets('MACOSX_DEPLOYMENT_TARGET = 15.0;', 'macos')).toContain('15.0');
        expect(() => applyDeploymentTargets('unknown template', 'both')).toThrow('deployment target');
    });

    it('检查最终文件，拒绝错放的浏览器后台、缺失引用和 Offscreen 容器', async () => {
        const {verifySafariBuild} = await safariTools();
        const directory = mkdtempSync(resolve(tmpdir(), 'fluentread-safari-contract-'));
        try {
            writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify(safariFixture()));
            writeFileSync(resolve(directory, 'background.js'), '__FLUENTREAD_BROWSER_CAPABILITY_BUILD__:safari:mv2__');
            writeFileSync(resolve(directory, 'popup.html'), '<html></html>');
            writeFileSync(resolve(directory, 'content.js'), 'sharedContent();');
            const verified = await verifySafariBuild(directory);
            expect(verified).toEqual(expect.objectContaining({extension: directory, version: '0.0.38', checkedReferences: 3, artifactCount: 4}));
            writeFileSync(resolve(directory, 'content.js'), 'changedSharedContent();');
            const changed = await verifySafariBuild(directory);
            expect(changed.manifestSha256).toBe(verified.manifestSha256);
            expect(changed.buildSha256).not.toBe(verified.buildSha256);
            writeFileSync(resolve(directory, 'background.js'), '__FLUENTREAD_BROWSER_CAPABILITY_BUILD__:chrome:mv3__');
            await expect(verifySafariBuild(directory)).rejects.toThrow('能力标记');
            writeFileSync(resolve(directory, 'background.js'), '__FLUENTREAD_BROWSER_CAPABILITY_BUILD__:safari:mv2__');
            writeFileSync(resolve(directory, 'offscreen.html'), '<html></html>');
            await expect(verifySafariBuild(directory)).rejects.toThrow('Offscreen');
            rmSync(resolve(directory, 'offscreen.html'));
            rmSync(resolve(directory, 'content.js'));
            await expect(verifySafariBuild(directory)).rejects.toThrow('ENOENT');
        } finally {rmSync(directory, {recursive: true, force: true});}
    });
});

describe('Chrome unified ZIP packaging', () => {
    async function verifier() {
        const url = pathToFileURL(resolve(PROJECT_ROOT, 'scripts/testing/verify-extension-manifests.mjs')).href;
        return import(/* @vite-ignore */ url);
    }

    async function fixture(manifest: Record<string, unknown>) {
        const directory = mkdtempSync(resolve(tmpdir(), 'fluentread-single-zip-'));
        const zipPath = resolve(directory, 'fluent-read-0.0.37-chrome.zip');
        const buildDirectory = resolve(directory, 'chrome-mv3');
        const files = {
            'manifest.json': JSON.stringify(manifest),
            'background.js': 'globalThis.packagingProbe = true;',
            'asset.wasm': Buffer.from([0, 97, 115, 109, 255, 0]),
            '_locales/zh_CN/messages.json': '{"name":{"message":"流畅阅读"}}',
        };
        const archive = new JSZip();
        for (const [name, bytes] of Object.entries(files)) {
            archive.file(name, bytes);
            const file = resolve(buildDirectory, name);
            mkdirSync(dirname(file), {recursive: true});
            writeFileSync(file, bytes);
        }
        writeFileSync(zipPath, await archive.generateAsync({type: 'nodebuffer'}));
        return {directory, zipPath, buildDirectory, storePath: zipPath.replace(/\.zip$/u, '-store.zip')};
    }

    it('唯一 ZIP 保留全部原字节，清理同版本旧商店包且重复执行稳定', async () => {
        const manifest = createExtensionManifest({browser: 'chrome', manifestVersion: 3});
        const {directory, zipPath, buildDirectory, storePath} = await fixture(manifest);
        try {
            const originalBytes = readFileSync(zipPath);
            writeFileSync(storePath, 'old store archive');
            const unrelated = ['fluent-read-0.0.36-chrome-store.zip', 'fluent-read-0.0.37-edge.zip', 'notes.txt'];
            for (const name of unrelated) writeFileSync(resolve(directory, name), name);
            expect(await finalizeExtensionZip('chrome', zipPath)).toBeUndefined();
            expect(readFileSync(zipPath)).toEqual(originalBytes);
            expect(existsSync(storePath)).toBe(false);
            const archive = await JSZip.loadAsync(readFileSync(zipPath), {checkCRC32: true});
            expect(JSON.parse(await archive.file('manifest.json')!.async('string'))).toEqual(manifest);
            const {verifyChromeArchive} = await verifier();
            await expect(verifyChromeArchive(originalBytes, manifest, buildDirectory)).resolves.toBeUndefined();
            await finalizeExtensionZip('chrome', zipPath);
            expect(readFileSync(zipPath)).toEqual(originalBytes);
            expect(existsSync(storePath)).toBe(false);
            for (const name of unrelated) expect(readFileSync(resolve(directory, name), 'utf8')).toBe(name);
        } finally {rmSync(directory, {recursive: true, force: true});}
    });

    it.each(['edge', 'firefox'])('%s ZIP 保持原字节，不清理 Chrome 旧包', async (browser) => {
        const {directory, zipPath, storePath} = await fixture({manifest_version: 3, version: '0.0.37', key: 'control'});
        try {
            const before = readFileSync(zipPath);
            writeFileSync(storePath, 'retained store archive');
            expect(await finalizeExtensionZip(browser, zipPath)).toBeUndefined();
            expect(readFileSync(zipPath)).toEqual(before);
            expect(readFileSync(storePath, 'utf8')).toBe('retained store archive');
        } finally {rmSync(directory, {recursive: true, force: true});}
    });

    it('缺少清单时拒绝交付，不改写原 ZIP 或删除旧包', async () => {
        const {directory, zipPath, storePath} = await fixture({manifest_version: 3});
        try {
            const zip = await JSZip.loadAsync(readFileSync(zipPath)); zip.remove('manifest.json');
            writeFileSync(zipPath, await zip.generateAsync({type: 'nodebuffer'}));
            writeFileSync(storePath, 'retained store archive');
            const before = readFileSync(zipPath);
            await expect(finalizeExtensionZip('chrome', zipPath)).rejects.toThrow('缺少 manifest.json');
            expect(readFileSync(zipPath)).toEqual(before);
            expect(readFileSync(storePath, 'utf8')).toBe('retained store archive');
        } finally {rmSync(directory, {recursive: true, force: true});}
    });

    it('缺少 key 的 ZIP 拒绝交付，不改原包或删除旧包', async () => {
        const manifest = createExtensionManifest({browser: 'chrome', manifestVersion: 3}); delete manifest.key;
        const {directory, zipPath, storePath} = await fixture(manifest);
        try {
            const before = readFileSync(zipPath);
            writeFileSync(storePath, 'retained store archive');
            await expect(finalizeExtensionZip('chrome', zipPath)).rejects.toThrow('key');
            expect(readFileSync(zipPath)).toEqual(before);
            expect(readFileSync(storePath, 'utf8')).toBe('retained store archive');
        } finally {rmSync(directory, {recursive: true, force: true});}
    });

    it('非 ZIP 路径拒绝处理，避免删除输入文件', async () => {
        const manifest = createExtensionManifest({browser: 'chrome', manifestVersion: 3});
        const {directory, zipPath} = await fixture(manifest);
        try {
            const file = resolve(directory, 'archive.txt');
            const before = readFileSync(zipPath); writeFileSync(file, before);
            await expect(finalizeExtensionZip('chrome', file)).rejects.toThrow('.zip');
            expect(readFileSync(file)).toEqual(before);
        } finally {rmSync(directory, {recursive: true, force: true});}
    });

    it('单包发行校验拒绝清单变化或公钥缺失，接受完整原清单', async () => {
        const {verifyChromeOfflineManifest} = await verifier();
        const local = createExtensionManifest({browser: 'chrome', manifestVersion: 3});
        const withoutKey = {...local}; delete withoutKey.key;
        expect(() => verifyChromeOfflineManifest({...local, description: 'changed'}, local)).toThrow('本地构建一致');
        expect(() => verifyChromeOfflineManifest(withoutKey, local)).toThrow('本地构建一致');
        expect(() => verifyChromeOfflineManifest(withoutKey, withoutKey)).toThrow('key');
        expect(verifyChromeOfflineManifest(local, local)).toBe(GOOGLE_DRIVE_EXTENSION_ID);
    });

    it('身份校验拒绝无效公钥与默认客户端错配，仍允许独立开发客户端', async () => {
        const {verifyChromeOfflineManifest} = await verifier();
        const local = createExtensionManifest({browser: 'chrome', manifestVersion: 3});
        for (const key of ['', 'invalid']) {
            const invalid = {...local, key};
            expect(() => verifyChromeOfflineManifest(invalid, invalid)).toThrow('key');
        }
        const otherKey = generateKeyPairSync('ed25519').publicKey.export({type: 'spki', format: 'der'}).toString('base64');
        const mismatched = {...local, key: otherKey};
        expect(() => verifyChromeOfflineManifest(mismatched, mismatched)).toThrow('默认 Google OAuth 客户端不匹配');
        const custom = {...mismatched, oauth2: {...local.oauth2, client_id: 'custom-developer.apps.googleusercontent.com'}};
        expect(() => verifyChromeOfflineManifest(custom, custom)).not.toThrow();
        for (const invalid of [
            {...local, oauth2: undefined},
            {...local, oauth2: {...local.oauth2, client_id: ''}},
            {...local, permissions: local.permissions!.filter(permission => permission !== 'identity')},
            {...local, oauth2: {...local.oauth2, scopes: []}},
        ]) expect(() => verifyChromeOfflineManifest(invalid, invalid)).toThrow(/OAuth|identity/u);
    });

    it('统一 ZIP 的真实清单与派生 ID 满足默认 OAuth，错误 ID 不发起授权', async () => {
        const manifest = createExtensionManifest({browser: 'chrome', manifestVersion: 3});
        const {directory, zipPath} = await fixture(manifest);
        try {
            await finalizeExtensionZip('chrome', zipPath);
            const archive = await JSZip.loadAsync(readFileSync(zipPath), {checkCRC32: true});
            const offline = JSON.parse(await archive.file('manifest.json')!.async('string'));
            const {verifyChromeOfflineManifest} = await verifier();
            const runtimeId = verifyChromeOfflineManifest(offline, manifest);
            const ports: DriveAuthPorts = {
                userAgent: () => 'Chrome/142.0.0.0',
                identity: {getAuthToken: vi.fn(async () => ({})), removeCachedAuthToken: vi.fn(async () => undefined), clearAllCachedAuthTokens: vi.fn(async () => undefined)},
                runtime: {id: runtimeId, getManifest: () => offline}, fetch: vi.fn(),
            };
            const auth = createDriveAuth(ports);
            expect(auth.availability()).toEqual({available: true, reason: ''});
            ports.runtime.id = 'aakdnohjinpalkgcdkjpbbfbkieohfce';
            expect(auth.availability().reason).toContain('扩展 ID');
            await expect(auth.open(true)).rejects.toThrow('OAuth 客户端不匹配');
            expect(ports.identity!.getAuthToken).not.toHaveBeenCalled();
            expect(ports.fetch).not.toHaveBeenCalled();
        } finally {rmSync(directory, {recursive: true, force: true});}
    });

    it('发行校验检查 CRC 和构建目录全部文件，拒绝资产损坏、增删或清单缺失', async () => {
        const manifest = createExtensionManifest({browser: 'chrome', manifestVersion: 3});
        const {directory, zipPath, buildDirectory, storePath} = await fixture(manifest);
        try {
            const bytes = readFileSync(zipPath);
            const {verifyChromeArchive} = await verifier();
            const broken = Buffer.from(bytes);
            const offset = broken.indexOf(Buffer.from('globalThis.packagingProbe = true;'));
            expect(offset).toBeGreaterThan(-1); broken[offset] ^= 1;
            await expect(verifyChromeArchive(broken, manifest, buildDirectory)).rejects.toThrow('CRC32');
            writeFileSync(zipPath, broken); writeFileSync(storePath, 'retained store archive');
            await expect(finalizeExtensionZip('chrome', zipPath)).rejects.toThrow('CRC32');
            expect(readFileSync(storePath, 'utf8')).toBe('retained store archive');
            for (const change of ['add', 'remove', 'content', 'manifest', 'manifest-format']) {
                const archive = await JSZip.loadAsync(bytes, {checkCRC32: true});
                if (change === 'add') archive.file('extra.js', 'extra');
                else if (change === 'remove') archive.remove('asset.wasm');
                else if (change === 'content') archive.file('asset.wasm', Buffer.from([0, 97, 115, 109, 0, 0]));
                else if (change === 'manifest-format') archive.file('manifest.json', JSON.stringify(manifest, null, 2));
                else archive.remove('manifest.json');
                await expect(verifyChromeArchive(await archive.generateAsync({type: 'nodebuffer'}), manifest, buildDirectory))
                    .rejects.toThrow(change === 'content' || change === 'manifest-format' ? '文件内容' : change === 'manifest' ? 'manifest.json' : '文件条目');
            }
        } finally {rmSync(directory, {recursive: true, force: true});}
    });

    it('当前版本只接受统一 Chrome 包，拒绝旧商店包残留并保留其他浏览器与版本', async () => {
        const {verifyChromeArchiveNames} = await verifier();
        const archive = 'fluent-read-0.0.37-chrome.zip';
        const files = [archive, 'fluent-read-0.0.36-chrome-store.zip', 'fluent-read-0.0.37-edge.zip', 'fluent-read-0.0.37-firefox.zip'];
        expect(verifyChromeArchiveNames(files, '0.0.37')).toBe(archive);
        expect(() => verifyChromeArchiveNames([...files, 'fluent-read-0.0.37-chrome-store.zip'], '0.0.37')).toThrow('不得残留');
        expect(() => verifyChromeArchiveNames(files.filter(name => name !== archive), '0.0.37')).toThrow('缺失');
    });
});

function buildEntrypoint(name: string, type: Entrypoint['type'] = 'unlisted-script'): Entrypoint {
    return {name, type, inputPath: `/entrypoints/${name}.ts`, outputDir: '/output', options: {}} as Entrypoint;
}

describe('module worker build groups', () => {
    it('三个已知模块 Worker 共享构建，保留其顺序及其他构建组的对象', () => {
        const workers = ['localTranslationWorker', 'localTtsWorker', 'videoTranscriptionWorker'].map(name => buildEntrypoint(name));
        const background = buildEntrypoint('background', 'background');
        const content = buildEntrypoint('content', 'content-script');
        const classic = buildEntrypoint('otherWorker');
        const pages = [buildEntrypoint('options', 'options'), buildEntrypoint('popup', 'popup')];
        const groups: EntrypointGroup[] = [background, workers[0], content, workers[1], classic, workers[2], pages];

        groupModuleWorkers(groups);

        expect(groups).toEqual([background, workers, content, classic, pages]);
        expect(groups[1]).not.toBe(workers);
        for (const entry of [background, content, classic, pages]) expect(groups).toContain(entry);
        for (const worker of workers) expect(groups[1]).toContain(worker);
        const grouped = [...groups];
        groupModuleWorkers(groups);
        expect(groups).toEqual(grouped);
        expect(groups[1]).toBe(grouped[1]);
    });

    it('部分构建仍可以组合两个模块 Worker', () => {
        const workers = ['videoTranscriptionWorker', 'localTranslationWorker'].map(name => buildEntrypoint(name));
        const groups: EntrypointGroup[] = [...workers];
        groupModuleWorkers(groups);
        expect(groups).toEqual([workers]);
    });

    it('不足两个可组合入口时保留原有构建方式', () => {
        for (const groups of [[], [buildEntrypoint('localTtsWorker')], [buildEntrypoint('unknown')]]) {
            const before = [...groups];
            groupModuleWorkers(groups);
            expect(groups).toEqual(before);
        }
    });

    it('同名的内容脚本、后台或已分组入口不会被改成模块 Worker', () => {
        const groups: EntrypointGroup[] = [
            buildEntrypoint('localTranslationWorker', 'content-script'),
            buildEntrypoint('localTtsWorker', 'background'),
            [buildEntrypoint('videoTranscriptionWorker')],
        ];
        const before = [...groups];
        groupModuleWorkers(groups);
        expect(groups).toEqual(before);
    });
});

function sourceBody(path: string): string {
    const source = readFileSync(resolve(PROJECT_ROOT, path), 'utf8');
    const header = source.match(/^\/\*\*[\s\S]*?\*\/\s*/u)?.[0];
    return header?.includes(`@file ${path}`) ? source.slice(header.length) : source;
}

describe('TTS worker entrypoint metadata isolation', () => {
    it('WXT 的实际元数据转换移除 TTS 运行时导入，避免在 Node 中装载另一版 ONNX', async () => {
        const transformUrl = pathToFileURL(resolve(dirname(createRequire(import.meta.url).resolve('wxt')), 'core/utils/transform.mjs')).href;
        const {removeMainFunctionCode} = await import(/* @vite-ignore */ transformUrl) as {
            removeMainFunctionCode(source: string): {code: string};
        };
        const source = sourceBody('entrypoints/localTtsWorker.ts');
        const metadata = removeMainFunctionCode(source).code;
        expect(metadata).toContain('defineUnlistedScript');
        expect(metadata).not.toContain('startLocalTtsWorkerApp');
        expect(metadata).not.toContain('@/src/app/offscreen/localTtsWorker');
    });

    it('真实入口保留静态导入，并在 main 调用时同步启动 Worker 一次', () => {
        const source = sourceBody('entrypoints/localTtsWorker.ts');
        expect(source).toContain("import {startLocalTtsWorkerApp} from '@/src/app/offscreen/localTtsWorker';");
        const start = vi.fn();
        const requireApp = vi.fn((path: string) => {
            expect(path).toBe('@/src/app/offscreen/localTtsWorker');
            return {startLocalTtsWorkerApp: start};
        });
        const exports: {default?: {main?: () => void}} = {};
        const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
        new Function('require', 'exports', 'defineUnlistedScript', compiled)(requireApp, exports, defineUnlistedScript);
        expect(requireApp).toHaveBeenCalledOnce();
        expect(start).not.toHaveBeenCalled();
        expect(exports.default!.main!()).toBeUndefined();
        expect(start).toHaveBeenCalledOnce();
        expect(start).toHaveBeenCalledWith();
    });
});

function permissionsFor(browser: string, manifestVersion: 2 | 3): string[] {
    const manifest = createExtensionManifest({browser, manifestVersion} as Parameters<typeof createExtensionManifest>[0]);
    return manifest.permissions as string[];
}

describe('extension manifest capability contract', () => {
    it.each(['chrome', 'firefox', 'edge'] as const)('%s 安装名称使用浏览器本地化 metadata，不复用技术包名', (browser) => {
        const manifest = createExtensionManifest({browser, manifestVersion: browser === 'firefox' ? 2 : 3});
        expect(manifest.name).toBe('__MSG_extensionName__');
        expect(manifest.default_locale).toBe('en');
        expect(manifest.version).toBeUndefined();
    });

    it('Chrome 原生 OAuth 绑定公开商店身份；其他构建不声明 Chrome 客户端', () => {
        const chrome = createExtensionManifest({browser: 'chrome', manifestVersion: 3});
        expect(chrome.oauth2).toEqual({client_id: GOOGLE_DRIVE_DEFAULT_CLIENT_ID, scopes: GOOGLE_DRIVE_SCOPES});
        expect(chrome.key).toBe(GOOGLE_DRIVE_EXTENSION_PUBLIC_KEY);
        const digest = createHash('sha256').update(Buffer.from(GOOGLE_DRIVE_EXTENSION_PUBLIC_KEY, 'base64')).digest('hex').slice(0, 32);
        expect([...digest].map(value => String.fromCharCode(97 + parseInt(value, 16))).join('')).toBe(GOOGLE_DRIVE_EXTENSION_ID);
        expect(permissionsFor('chrome', 3).filter(permission => permission === 'identity')).toHaveLength(1);
        for (const browser of ['edge', 'firefox', 'safari']) {
            const manifest = createExtensionManifest({browser, manifestVersion: browser === 'firefox' ? 2 : 3});
            expect(manifest.oauth2).toBeUndefined(); expect(manifest.key).toBeUndefined();
            expect(manifest.permissions).not.toContain('identity');
        }
    });
    it('builds a separate Thunderbird package with mail display access and no browser page injection', async () => {
        const packageUrl = pathToFileURL(resolve(PROJECT_ROOT, 'scripts/thunderbird/package.mjs')).href;
        const {createThunderbirdManifest} = await import(/* @vite-ignore */ packageUrl) as {
            createThunderbirdManifest(source: any): any;
        };
        const firefox = {
            manifest_version: 2,
            name: 'FluentRead',
            version: '0.0.35',
            background: {scripts: ['background.js']},
            permissions: ['storage', '<all_urls>'],
            browser_specific_settings: {gecko: {
                id: '{3096bd53-3bda-4556-b076-ebf47442a5c1}',
                strict_min_version: '140.0',
                data_collection_permissions: {required: ['websiteContent']},
            }},
            content_scripts: [{matches: ['<all_urls>'], js: ['content-scripts/content.js']}],
        };
        const mail = createThunderbirdManifest(firefox);
        expect(mail.manifest_version).toBe(2);
        expect(mail.background).toEqual(firefox.background);
        expect(mail.content_scripts).toBeUndefined();
        expect(mail.permissions).toContain('messagesModify');
        expect(mail.permissions).not.toContain('contextMenus');
        expect(mail.permissions.filter((permission: string) => permission === 'messagesModify')).toHaveLength(1);
        expect(mail.browser_specific_settings.gecko.id).not.toBe(firefox.browser_specific_settings.gecko.id);
        expect(mail.browser_specific_settings.gecko.strict_min_version).toBe('140.0');
        expect(mail.browser_specific_settings.gecko.data_collection_permissions).toBeUndefined();
        expect(mail.message_display_action.default_icon['16']).toBe('icon/16.png');
        expect(firefox.content_scripts).toHaveLength(1);
        expect(() => createThunderbirdManifest({...firefox, manifest_version: 3})).toThrow('MV2');
        expect(() => createThunderbirdManifest({...firefox, browser_specific_settings: {}})).toThrow('Gecko');
    });

    it('旧 QQ 与受限正文共用子 frame 入口，通用网页仍保持顶层注入', () => {
        const entry = sourceBody('entrypoints/supportedFrame.content.ts');
        expect(entry).toContain("'https://mail.qq.com/cgi-bin/readmail*'");
        expect(entry).toContain("'https://disqus.com/embed/comments/*'");
        expect(entry).toContain("'https://www.kaggleusercontent.com/kf/*/__results__.html*'");
        expect(entry).toContain("window.location.hostname === 'mail.qq.com'");
        expect(entry).toContain('startQqMailFrameApp(ctx) : startEmbeddedFrameApp(ctx)');
        expect(entry).toContain('allFrames: true');
        expect(entry).not.toContain('matchAboutBlank');
        expect(entry).not.toContain('matchOriginAsFallback');
        expect(sourceBody('entrypoints/content.ts')).not.toContain('allFrames');
    });

    it('网易邮箱独立入口覆盖受限主机及 about:blank 正文 frame', () => {
        const entry = sourceBody('entrypoints/neteaseMailFrame.content.ts');
        for (const host of ['mail.163.com', 'mail.126.com', 'mail.yeah.net']) {
            expect(entry).toContain(`https://*.${host}/*`);
        }
        expect(entry).toContain('allFrames: true');
        expect(entry).toContain('matchAboutBlank: true');
        expect(entry).not.toContain('matchOriginAsFallback');
        expect(sourceBody('entrypoints/content.ts')).not.toContain('allFrames');
    });

    it('通用网页内容脚本在基础 DOM 出现前注入，让 loading 页面也能建立翻译入口', () => {
        expect(sourceBody('entrypoints/content.ts')).toContain("runAt: 'document_start'");
    });

    it('declares the literal all-URLs host permission required by captureVisibleTab', () => {
        for (const [browser, manifestVersion] of [
            ['chrome', 3],
            ['edge', 3],
            ['firefox', 2],
        ] as const) {
            const manifest = createExtensionManifest({browser, manifestVersion} as Parameters<typeof createExtensionManifest>[0]);
            expect(manifest.host_permissions, `${browser}-mv${manifestVersion}`).toContain('<all_urls>');
        }
    });

    it('declares Offscreen exactly once only for supported Chrome and Edge MV3 builds', () => {
        for (const [browser, manifestVersion, expected] of [
            ['chrome', 3, 1],
            ['edge', 3, 1],
            ['chrome', 2, 0],
            ['firefox', 2, 0],
            ['firefox', 3, 0],
            ['opera', 3, 0],
        ] as const) {
            const permissions = permissionsFor(browser, manifestVersion);
            expect(permissions.filter((permission) => permission === 'offscreen'), `${browser}-mv${manifestVersion}`)
                .toHaveLength(expected);
            expect(permissions).toEqual(expect.arrayContaining([
                'storage',
                'unlimitedStorage',
                'alarms',
                'contextMenus',
            ]));
        }
    });

    it('keeps the Offscreen page entrypoint target-limited and delegates to the app composition root', () => {
        const html = readFileSync(resolve(PROJECT_ROOT, 'entrypoints/offscreen/index.html'), 'utf8');
        const main = sourceBody('entrypoints/offscreen/main.ts');
        expect(html).toContain('<meta name="wxt.include" content="[\'chrome\', \'edge\', \'firefox\']">');
        expect(html).toContain('<script type="module" src="./main.ts"></script>');
        expect(html).not.toContain('opera');
        expect(main).toBe(
            "import {startOffscreenApp} from '@/src/app/offscreen/runtime';\n\nstartOffscreenApp();\n",
        );
    });

    it('uses the capability-derived manifest factory instead of a static Offscreen permission', () => {
        const source = readFileSync(resolve(PROJECT_ROOT, 'wxt.config.ts'), 'utf8');
        expect(source).toContain('manifest: createExtensionManifest');
        expect(source).toContain("...(capabilities.offscreenDocument ? ['offscreen'] : [])");
        expect(source).not.toContain("permissions: ['storage', 'alarms', 'contextMenus', 'offscreen']");
    });

    it('只给 Firefox 声明稳定 AMO 身份、最低版本和准确的数据传输分类', () => {
        const firefox = createExtensionManifest({browser: 'firefox', manifestVersion: 2} as never) as any;
        const chrome = createExtensionManifest({browser: 'chrome', manifestVersion: 3} as never) as any;

        expect(firefox.browser_specific_settings?.gecko).toEqual({
            id: '{3096bd53-3bda-4556-b076-ebf47442a5c1}',
            strict_min_version: '140.0',
            data_collection_permissions: {
                required: ['websiteContent', 'authenticationInfo', 'personalCommunications'],
            },
        });
        expect(chrome.browser_specific_settings).toBeUndefined();
    });

    it('固定发布包英文名称，并为 Firefox 保留共享 OCR 资产', () => {
        const source = readFileSync(resolve(PROJECT_ROOT, 'wxt.config.ts'), 'utf8');

        expect(source).toContain("name: 'fluent-read'");
        // 验证排除 coverage 的契约，允许其他合法排除项与多行格式。
        const excludedSources = source.match(/excludeSources:\s*\[([\s\S]*?)\]/)?.[1];
        expect(excludedSources).toContain("'coverage/**'");
        expect(source).toContain("'build:publicAssets'");
        expect(source).not.toContain("files.splice(index, 1)");
    });

    it('拒绝当前版本的非期望 Firefox 归档名，但允许其他版本归档留存', async () => {
        const verifierUrl = pathToFileURL(
            resolve(PROJECT_ROOT, 'scripts/testing/verify-extension-manifests.mjs'),
        ).href;
        const verifier = await import(/* @vite-ignore */ verifierUrl) as {
            findUnexpectedCurrentVersionArchives(
                files: string[],
                version: string,
                expected: string[],
            ): string[];
        };
        const expected = [
            'fluent-read-0.0.35-firefox.zip',
            'fluent-read-0.0.35-sources.zip',
        ];

        expect(verifier.findUnexpectedCurrentVersionArchives([
            ...expected,
            '-0.0.30-firefox.zip',
            'legacy-10.0.35-sources.zip',
        ], '0.0.35', expected)).toEqual([]);
        expect(verifier.findUnexpectedCurrentVersionArchives([
            ...expected,
            '-0.0.35-firefox.zip',
            'legacy-v0.0.35-sources.zip',
            'fluent-read-0.0.30-firefox.zip',
        ], '0.0.35', expected)).toEqual([
            '-0.0.35-firefox.zip',
            'legacy-v0.0.35-sources.zip',
        ]);
    });

    it('从任意 YouTube 起始页预注入 timedtext bridge，但不扩大到非 YouTube 站点', () => {
        const source = sourceBody('entrypoints/youtubeBridge.content.ts');
        const matches = [...source.matchAll(/['"](\*:\/\/[^'"]+)['"]/gu)].map((match) => match[1]);

        expect(matches).toEqual([
            '*://*.youtube.com/*',
            '*://youtube.com/*',
        ]);
        expect(source).toContain("runAt: 'document_start'");
        expect(source).toContain("world: 'MAIN'");
        expect(matches).not.toContain('*://*/*');
        expect(matches.some((match) => match.includes('youtube-nocookie'))).toBe(false);
        expect(matches.every((match) => match.includes('youtube'))).toBe(true);
    });

    it('网页及扩展 UI 构建组使用远程配置存储，后台和未知入口保留完整运行时', () => {
        const plugin = remoteConfigStorageBuildPlugin();
        expect(plugin.enforce).toBe('pre');
        expect(plugin.resolveId(resolve(PROJECT_ROOT, 'src/platform/storage/configStorageRuntime')))
            .toBe(resolve(PROJECT_ROOT, 'src/platform/storage/remoteConfigStorageRuntime.ts'));
        expect(plugin.resolveId(resolve(PROJECT_ROOT, 'src/platform/storage/configStorageRuntime.ts')))
            .toBe(resolve(PROJECT_ROOT, 'src/platform/storage/remoteConfigStorageRuntime.ts'));
        expect(plugin.resolveId(resolve(PROJECT_ROOT, 'src/platform/storage/configStorage.ts'))).toBeNull();

        const contentGroup: {plugins?: unknown[]} = {plugins: ['existing']};
        extendRemoteConfigBuildConfig([{type: 'content-script'}, {type: 'content-script'}], contentGroup);
        expect(contentGroup.plugins).toEqual(['existing', expect.objectContaining({name: 'fluentread-remote-config-storage'})]);
        const emptyPlugins: {plugins?: unknown[]} = {};
        extendRemoteConfigBuildConfig([{type: 'content-script'}], emptyPlugins);
        expect(emptyPlugins.plugins).toHaveLength(1);

        for (const group of [[{type: 'popup'}], [{type: 'options'}], [{type: 'popup'}, {type: 'options'}, {type: 'unlisted-page'}]]) {
            const config: {plugins?: unknown[]} = {plugins: []};
            extendRemoteConfigBuildConfig(group, config);
            expect(config.plugins).toHaveLength(1);
        }
        for (const group of [[], [{type: 'background'}], [{type: 'options'}, {type: 'background'}], [{type: 'content-script'}, {type: 'unlisted-script'}], [{type: 'unknown'}]]) {
            const config: {plugins?: unknown[]} = {plugins: []};
            extendRemoteConfigBuildConfig(group, config);
            expect(config.plugins).toEqual([]);
        }
    });
});
