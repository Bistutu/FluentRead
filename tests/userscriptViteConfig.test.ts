import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {runInNewContext} from 'node:vm';
import {describe, expect, it, vi} from 'vitest';
import {ungzip} from 'pako';
import {zhCNMessages, UI_LANGUAGE_BUNDLES, userscriptMessages} from '@/userscript/languageBundles';
import {zhCNMessages as extensionChinese} from '@/src/core/i18n/messages/zh-CN';
import {UI_LANGUAGE_BUNDLES as extensionBundles} from '@/src/core/i18n/bundles';
import {installInformationHighlight} from '@/userscript/informationHighlight';
import {inflateWithPako} from '@/userscript/pakoRuntime';
import * as chineseCharacterData from '@/src/core/language/chineseVariants';
import * as functionWordData from '@/src/core/language/functionWordData';
import {createUserscriptCharacterDataCompressionPlugin} from '@/userscript/characterDataPlugin';
import {
    default as userscriptConfig,
    executionGuardEnd,
    executionGuardStart,
    createUserscriptCatalogCompressionPlugin,
    findDexieGlobalRegistration,
    findFreeBrowserGlobals,
    injectUserscriptBrowserImports,
    userscriptAliases,
    wrapUserscriptEntry,
} from '@/userscript/vite.config';

const entrypointId = resolve(process.cwd(), 'entrypoints/userscript-injection-fixture.ts');
const sourceModuleId = resolve(process.cwd(), 'src/app/content/runtime.ts');
const vueScriptModuleId = `${resolve(process.cwd(), 'src/features/selection-translation/ui/SelectionTranslator.vue')}?vue&type=script&setup=true&lang.ts`;

describe('CommonJS initialization policy by userscript output', () => {
    it.each(['standard', 'standalone', 'greasyfork'] as const)
    ('limits deterministic wrapping to the standard output (%s)', async mode => {
        vi.stubEnv('FLUENTREAD_USERSCRIPT_STANDALONE', mode === 'standalone' ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE', mode === 'greasyfork' ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_VENDOR_URL', 'https://fixture.invalid/vendor.js');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_DATA_URL', 'https://fixture.invalid/data.js');
        try {
            vi.resetModules();
            const {default: config} = await import('@/userscript/vite.config');
            expect((config as {build: {commonjsOptions?: {strictRequires?: boolean}}}).build.commonjsOptions?.strictRequires)
                .toBe(mode === 'standard' ? true : undefined);
        } finally {
            vi.unstubAllEnvs();
            vi.resetModules();
        }
    });
});

describe('authoritative site catalogs with an external pinned data asset', () => {
    it.each(['unchanged', 'old-asset', 'reordered', 'removed-rule', 'missing-runtime-rule'] as const)
    ('reconciles %s without mutating the external asset', async variant => {
        const vm = await vi.importActual<typeof import('node:vm')>('node:vm');
        const authoritative = JSON.parse(readFileSync(resolve(process.cwd(), 'src/core/site-adaptation/catalog/established.json'), 'utf8'));
        const data = vm.runInNewContext(readFileSync(resolve(process.cwd(), 'userscript/resources/fluentread-data.v1.js'), 'utf8'), {}, {timeout: 5000});
        if (variant === 'unchanged' || variant === 'reordered' || variant === 'removed-rule') {
            data.siteCatalogs.established = structuredClone(authoritative);
        }
        if (variant === 'reordered') data.siteCatalogs.established.reverse();
        if (variant === 'removed-rule') data.siteCatalogs.established.push({id: 'removed-pinned-rule', match: {hosts: ['removed.invalid']}});
        vi.doMock('node:vm', () => ({...vm, runInNewContext: () => data}));
        vi.stubEnv('FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE', '1');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_VENDOR_URL', 'https://fixture.invalid/vendor.js');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_DATA_URL', 'https://fixture.invalid/data.js');
        try {
            vi.resetModules();
            const {createUserscriptCatalogCompressionPlugin: createPlugin} = await import('@/userscript/vite.config');
            const {transformWithEsbuild} = await import('vite');
            const plugin = createPlugin();
            const resolveId = typeof plugin.resolveId === 'function' ? plugin.resolveId : plugin.resolveId!.handler;
            const load = typeof plugin.load === 'function' ? plugin.load : plugin.load!.handler;
            const id = await Reflect.apply(resolveId, {}, ['./catalog/established.json', resolve(process.cwd(), 'src/core/site-adaptation/pack.ts')]);
            const source = await Reflect.apply(load, {}, [id]);
            const compiled = await transformWithEsbuild(source, 'pinned-catalog.js', {format: 'cjs', target: 'es2018'});
            if (variant === 'missing-runtime-rule') data.siteCatalogs.established = data.siteCatalogs.established.filter((rule: {id: string}) => rule.id !== 'openrouter');
            const before = JSON.stringify(data), original = data.siteCatalogs.established;
            const realm = {module: {exports: {} as any}, __FLUENTREAD_USERSCRIPT_DATA__: data};
            if (variant === 'missing-runtime-rule') {
                expect(() => vm.runInNewContext(compiled.code, realm, {timeout: 5000})).toThrow('Missing pinned userscript site rule: openrouter');
            } else {
                vm.runInNewContext(compiled.code, realm, {timeout: 5000});
                const result = realm.module.exports.default;
                expect(result).toEqual(authoritative);
                if (variant === 'unchanged') expect(result).toBe(original);
                for (const rule of original) {
                    const expected = authoritative.find((current: {id: string}) => current.id === rule.id);
                    if (expected && JSON.stringify(rule) === JSON.stringify(expected)) expect(result.find((current: {id: string}) => current.id === rule.id)).toBe(rule);
                }
            }
            expect(JSON.stringify(data)).toBe(before);
        } finally {vi.doUnmock('node:vm');vi.unstubAllEnvs();vi.resetModules();}
    });
});

describe('actual generateBundle service SVG license routing', () => {
    it.each(['posix', 'windows-vite', 'windows-native', 'windows-query'].flatMap(platform =>
        [true, false].map(hasSvg => [platform, hasSvg] as const)))
    ('uses the %s module ID and includes SVG=%s to retain the exact license', async (platform, hasSvg) => {
        const path = await vi.importActual<typeof import('node:path')>('node:path');
        const vite = await vi.importActual<typeof import('vite')>('vite');
        const windows = platform.startsWith('windows');
        const nativeFile = windows
            ? path.win32.resolve('C:\\FluentRead', 'src/ui/assets/serviceBrandPaths.json')
            : path.posix.resolve('/FluentRead', 'src/ui/assets/serviceBrandPaths.json');
        // 模拟平台路径端口；Windows 分支与锁定 Vite 5.4.19 的 slash + posix.normalize 相同。
        // 被测的是生产 generateBundle 本身，不把许可布尔值传给 wrapper。
        vi.doMock('node:path', () => ({...path, resolve: (...segments: string[]) =>
            segments.length === 2 && segments[1] === 'src/ui/assets/serviceBrandPaths.json'
                ? nativeFile : path.resolve(...segments)}));
        vi.doMock('vite', () => ({...vite, normalizePath: windows
            ? (id: string) => path.posix.normalize(id.replace(/\\/gu, '/')) : vite.normalizePath}));
        vi.stubEnv('FLUENTREAD_USERSCRIPT_STANDALONE', hasSvg ? '1' : '0');
        let moduleId = platform === 'windows-native' ? nativeFile : nativeFile.replace(/\\/gu, '/');
        if (platform === 'windows-query') moduleId += '?import';
        try {
            vi.resetModules();
            const {default: config} = await import('@/userscript/vite.config');
            const plugin = (config.plugins as Array<{name?: string; generateBundle?: {handler?: Function}}>)
                .find(item => item.name === 'bundle-userscript-css')!;
            const entry = {type: 'chunk', isEntry: true, fileName: 'fluent-read.user.js',
                code: 'const ENTRY_SENTINEL = 1;', moduleIds: [hasSvg ? moduleId : moduleId.replace('.json', '-unrelated.json')]};
            await Reflect.apply(plugin.generateBundle!.handler!, {emitFile: vi.fn()}, [{}, {'fluent-read.user.js': entry}]);
            const notice = readFileSync(resolve(process.cwd(), 'public/third-party-notices/lobe-icons-MIT.txt'), 'utf8');
            if (hasSvg) expect(entry.code).toContain(notice);
            else expect(entry.code).not.toContain('Lobe Icons static SVG paths');
            expect(entry.code).toContain('UNICODE LICENSE V3');
            expect(entry.code).toContain('ENTRY_SENTINEL');
        } finally {
            vi.doUnmock('node:path'); vi.doUnmock('vite'); vi.unstubAllEnvs(); vi.resetModules();
        }
    });
});

describe('userscript browser shim injection', () => {
    it.each(['standard', 'standalone'] as const)('keeps %s runtime icon inline and pins only the standard manager icon', async mode => {
        vi.stubEnv('FLUENTREAD_USERSCRIPT_STANDALONE', mode === 'standalone' ? '1' : '');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE', '');
        try {
            vi.resetModules();
            const {default: config} = await import('@/userscript/vite.config');
            const plugins = (config as {plugins: Array<{name: string; generateBundle?: {handler: Function}}>}).plugins;
            const plugin = plugins.find(item => item.name === 'bundle-userscript-css')!;
            const entry = {type: 'chunk', isEntry: true, code: 'var fixture = 1;', moduleIds: []};
            await Reflect.apply(plugin.generateBundle!.handler, {}, [{}, {'entry.js': entry}]);
            const iconBytes = readFileSync(resolve(process.cwd(), 'public/icon/64.png'));
            const runtimeIcon = JSON.parse(entry.code.match(/globalThis\.__FLUENTREAD_ICON_DATA__=("[^"]+");/u)![1]) as string;
            expect(Buffer.from(runtimeIcon.split(',')[1], 'base64')).toEqual(iconBytes);
            const metadataIcon = entry.code.match(/^\/\/ @icon\s+(.+)$/mu)![1];
            if (mode === 'standalone') expect(metadataIcon).toBe(runtimeIcon);
            else {
                const pinned = metadataIcon.match(/^https:\/\/cdn\.jsdelivr\.net\/gh\/FluentRead\/FluentRead@([a-f0-9]{40})\/public\/icon\/64\.png$/u);
                expect(pinned).not.toBeNull();
                expect(execFileSync('git', ['show', `${pinned![1]}:public/icon/64.png`], {cwd: process.cwd()})).toEqual(iconBytes);
                expect(metadataIcon).not.toBe(runtimeIcon);
            }
        } finally {vi.unstubAllEnvs();vi.resetModules();}
    });
    it.each<readonly [string, Record<string, string>, Record<string, string>]>([
        ['zh-CN', extensionChinese, zhCNMessages],
        ...Object.entries(extensionBundles).map(([language, bundle]) => [language, bundle.messages, UI_LANGUAGE_BUNDLES[language as keyof typeof UI_LANGUAGE_BUNDLES].messages] as const),
    ])('retains extension notices in %s while preserving all other userscript menu and settings copy', (_language, extension, projected) => {
        const noticeKeys = Object.keys(extension).filter(key => key.startsWith('contextMenu.notice.'));
        expect(noticeKeys).toHaveLength(6);
        for (const key of noticeKeys) {
            expect(extension[key]).toBeTruthy();
            expect(Object.hasOwn(projected, key)).toBe(false);
        }
        const retainedKeys = Object.keys(extension).filter(key => !key.startsWith('informationHighlight.') && !noticeKeys.includes(key));
        expect(Object.keys(projected)).toHaveLength(retainedKeys.length);
        for (const key of retainedKeys) expect(projected[key]).toBe(extension[key]);
        expect(projected['contextMenu.translateSelection']).toBeTruthy();
        expect(projected['contextMenu.translatePage']).toBeTruthy();
        expect(projected['contextMenu.restorePage']).toBeTruthy();
    });
    it('excludes unreachable highlight code and copy while keeping an explicitly unavailable state', () => {
        expect(userscriptMessages(extensionChinese)).toEqual(zhCNMessages);
        expect(Object.keys(zhCNMessages).some(key => key.startsWith('informationHighlight.'))).toBe(false);
        const controller = installInformationHighlight({} as Document, {enabled: true, hotkey: 'Alt+H', hotkeyEnabled: true, mode: 'keywords', model: 'qwen2.5-0.5b', density: 'medium', color: 'amber', style: 'background', intensity: 'standard'});
        expect(controller.setEnabled(true)).toMatchObject({enabled: false, phase: 'unsupported', mode: 'keywords'});
        controller.updatePreferences({enabled: true, hotkey: 'Alt+H', hotkeyEnabled: true, mode: 'surprisal-local', model: 'qwen3-0.6b', density: 'low', color: 'mint', style: 'underline', intensity: 'standard'});
        expect(controller.retry()).toMatchObject({enabled: false, mode: 'surprisal-local'});
        controller.refresh();controller.dispose();expect(controller.getState().enabled).toBe(false);
        expect(userscriptAliases.find(alias => alias.find === '@/src/features/information-highlight/public')?.replacement).toMatch(/userscript\/informationHighlight\.ts$/u);
    });
    it('pins each remote language file to a commit containing exactly its built contents', () => {
        const defines = (userscriptConfig as {define: Record<string, string>}).define;
        const commit = JSON.parse(defines.__FLUENTREAD_USERSCRIPT_RESOURCE_COMMIT__);
        const bundles = JSON.parse(defines.__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__) as Record<string, string>;
        expect(commit).toBe('25f5dca794848782f717493ce0e08545a0e57b35');
        expect(Object.keys(bundles)).toHaveLength(5);
        for (const file of Object.values(bundles)) {
            const path = `userscript/languages/${file}`;
            const committed = execFileSync('git', ['show', `${commit}:${path}`], {cwd: process.cwd(), encoding: 'utf8'});
            expect(committed).toBe(readFileSync(resolve(process.cwd(), path), 'utf8'));
        }
    });
    it('embeds the Chinese fallback catalog, minus the reader-only keys of the extension document page, as lossless static data', () => {
        const plugin = createUserscriptCatalogCompressionPlugin() as unknown as {
            resolveId: (source: string, importer: string) => string | null;
            load: (id: string) => string | null;
        };
        const id = plugin.resolveId('./messages/zh-CN', resolve(process.cwd(), 'src/core/i18n/index.ts'));
        expect(id).toBeTruthy();
        const moduleSource = plugin.load(id!);
        const base64 = moduleSource?.match(/atob\("([A-Za-z0-9+/=]+)"\)/u)?.[1];
        expect(base64).toBeTruthy();
        const restored = JSON.parse(gunzipSync(Buffer.from(base64!, 'base64')).toString('utf8'));
        // 文档翻译页面（含 PDF 阅读器）只存在于扩展里，油猴脚本不含该页面：内嵌目录恰好是全部中文文案去掉 document. 这一组键，其余一条不少、内容无损。
        const readerOnly = Object.keys(zhCNMessages).filter(key => key.startsWith('document.'));
        expect(readerOnly.length).toBeGreaterThan(0);
        const embedded = Object.fromEntries(Object.entries(zhCNMessages).filter(([key]) => !key.startsWith('document.')));
        expect(Object.keys(embedded)).toHaveLength(Object.keys(zhCNMessages).length - readerOnly.length);
        expect(restored).toEqual(embedded);
        vi.stubGlobal('pako', {ungzip});
        try {
            expect(JSON.parse(inflateWithPako(new Uint8Array(Buffer.from(base64!, 'base64'))))).toEqual(embedded);
        } finally {
            vi.unstubAllGlobals();
        }
        expect(moduleSource).toContain(createHash('sha256').update(gunzipSync(Buffer.from(base64!, 'base64'))).digest('hex'));
    });

    it('keeps all site rule JSON data intact when embedding compressed offline catalogs', () => {
        const plugin = createUserscriptCatalogCompressionPlugin() as unknown as {
            resolveId: (source: string, importer: string) => string | null;
            load: (id: string) => string | null;
        };
        const importer = resolve(process.cwd(), 'src/core/site-adaptation/catalog.ts');
        for (const name of ['established', 'websites', 'profiles']) {
            const id = plugin.resolveId(`./catalog/${name}.json`, importer);
            expect(id).toContain('fluentread-userscript-site-catalog:');
            const moduleSource = plugin.load(id!);
            const base64 = moduleSource?.match(/atob\("([A-Za-z0-9+/=]+)"\)/u)?.[1];
            expect(base64).toBeTruthy();
            const original = JSON.parse(readFileSync(resolve(process.cwd(), `src/core/site-adaptation/catalog/${name}.json`), 'utf8'));
            const restored = JSON.parse(gunzipSync(Buffer.from(base64!, 'base64')).toString('utf8'));
            expect(restored).toEqual(original);
            expect(moduleSource).toContain(createHash('sha256').update(JSON.stringify(original)).digest('hex'));
        }
        expect(plugin.resolveId('./catalog/other.json', importer)).toBeNull();
    });

    it('keeps the full Lobe license exactly when service SVG data is shipped', () => {
        const withIcons = wrapUserscriptEntry('ENTRY_SENTINEL', 'BOOTSTRAP_SENTINEL', '', true);
        const withoutIcons = wrapUserscriptEntry('ENTRY_SENTINEL', 'BOOTSTRAP_SENTINEL', '', false);
        const notice = readFileSync(resolve(process.cwd(), 'public/third-party-notices/lobe-icons-MIT.txt'), 'utf8');
        expect(withIcons).toContain(notice);
        expect(withoutIcons).not.toContain('Lobe Icons static SVG paths');
        expect(withoutIcons).toContain('UNICODE LICENSE V3');
        expect(withoutIcons).toContain('@ctrl/tinycolor 3.6.1');
        expect(withIcons.replace(`/*\n${notice}\n*/\n`, '')).toBe(withoutIcons);
    });

    it('wraps the complete single-file runtime in a duplicate-injection guard', () => {
        const wrapped = wrapUserscriptEntry('ENTRY_SENTINEL', 'BOOTSTRAP_SENTINEL');
        const guardStart = wrapped.indexOf(executionGuardStart);
        const condition = wrapped.indexOf('if (!globalThis.__fluentReadUserscriptBootstrapped) {');
        const bootstrap = wrapped.indexOf('BOOTSTRAP_SENTINEL');
        const entry = wrapped.indexOf('ENTRY_SENTINEL');
        const guardEnd = wrapped.indexOf(executionGuardEnd);

        expect(guardStart).toBeGreaterThan(-1);
        expect(condition).toBeGreaterThan(guardStart);
        expect(bootstrap).toBeGreaterThan(condition);
        expect(entry).toBeGreaterThan(bootstrap);
        expect(guardEnd).toBeGreaterThan(entry);
    });

    it('在 app 使用的 public contract 边界替换扩展专属 feature 与可信 GM 凭据上下文', () => {
        const stringAliases = new Map(userscriptAliases
            .filter((entry): entry is {find: string; replacement: string} => typeof entry.find === 'string')
            .map((entry) => [entry.find, entry.replacement]));

        for (const feature of ['area-translation', 'image-translation', 'video-subtitle']) {
            expect(stringAliases.get(`@/src/features/${feature}/public`)).toMatch(/userscript\/unsupportedCapabilities\.ts$/u);
        }
        expect(stringAliases.get('@/src/features/writing-assistant/public')).toMatch(/userscript\/writingAssistant\.ts$/u);
        expect(stringAliases.get('@/src/platform/storage/credentialContext')).toMatch(/userscript\/credentialContext\.ts$/u);
        expect(stringAliases.get('@/src/platform/storage/configStorageRuntime')).toMatch(/userscript\/storage\.ts$/u);
        expect(userscriptAliases.at(-1)?.find).toBe('@');
    });

    it('把 dexie 换成不注册全局单例的入口，且不改写 dexie 自身的实现产物路径', () => {
        const dexieAlias = userscriptAliases.find((entry) => entry.find instanceof RegExp
            && (entry.find as RegExp).test('dexie'));

        expect(dexieAlias?.replacement).toMatch(/userscript\/dexie\.ts$/u);
        // 别名必须严格匹配裸模块名；否则 userscript/dexie.ts 内部对实现产物的引用会被改写回自身。
        expect((dexieAlias!.find as RegExp).test('dexie/dist/dexie.min.js')).toBe(false);
    });

    it('产物中残留 Dexie 全局注册时能被构建守卫识别', () => {
        expect(findDexieGlobalRegistration('const s=Symbol.for("Dexie");globalThis[s]=D;')).toBe(true);
        expect(findDexieGlobalRegistration("globalThis[Symbol.for('Dexie')]=D;")).toBe(true);
        expect(findDexieGlobalRegistration('Symbol . for ( "Dexie" )')).toBe(true);
        expect(findDexieGlobalRegistration('Symbol.for("vercel.ai.schema")')).toBe(false);
        expect(findDexieGlobalRegistration('const label="Dexie";')).toBe(false);
    });

    it('imports only unresolved browser globals', () => {
        const transformed = injectUserscriptBrowserImports(
            'browser.runtime.sendMessage({}); chrome.runtime.getURL("icon.png");',
            entrypointId,
        );

        expect(transformed).toContain('import {default as browser, chrome}');

        expect(injectUserscriptBrowserImports(
            'browser.runtime.sendMessage({type: "from-app"});',
            sourceModuleId,
        )).toContain('import {default as browser}');
        expect(injectUserscriptBrowserImports(
            'chrome.runtime.getURL("from-vue.png");',
            vueScriptModuleId,
        )).toContain('import {chrome}');
    });

    it('ignores property names and lexically bound identifiers', () => {
        expect(injectUserscriptBrowserImports(
            'const extensionGlobal = {} as {browser?: unknown}; void extensionGlobal.browser;',
            entrypointId,
        )).toBeNull();
        expect(injectUserscriptBrowserImports(
            'function useBrowser(browser: {runtime: unknown}) { return browser.runtime; }',
            entrypointId,
        )).toBeNull();
        expect(injectUserscriptBrowserImports(
            'import chrome from "webextension-polyfill"; void chrome.runtime;',
            entrypointId,
        )).toBeNull();
        expect(injectUserscriptBrowserImports(
            'browser.runtime.sendMessage({});',
            '/tmp/fluentread-external-module.ts',
        )).toBeNull();
        expect(injectUserscriptBrowserImports(
            '<script setup>browser.runtime.sendMessage({})</script>',
            resolve(process.cwd(), 'src/RawComponent.vue'),
        )).toBeNull();
    });

    it('checks generated JavaScript for free extension globals', () => {
        const bundleId = resolve(process.cwd(), '.output/userscript/fluent-read.user.js');
        expect(findFreeBrowserGlobals(
            'const browser = {runtime: {}}; void browser.runtime; const chrome = browser; void chrome.runtime;',
            bundleId,
        )).toEqual([]);
        expect(findFreeBrowserGlobals(
            'browser.runtime.sendMessage({}); chrome.runtime.getURL("icon.png");',
            bundleId,
        )).toEqual(['browser', 'chrome']);
    });
});


describe('userscript lossless Unicode character data', () => {
    const dataPath = resolve(process.cwd(), 'src/core/language/chineseVariants.ts');
    const wordDataPath = resolve(process.cwd(), 'src/core/language/functionWordData.ts');
    const createPlugin = (enabled = true) => createUserscriptCharacterDataCompressionPlugin(process.cwd(), enabled) as unknown as {
        transform: (code: string, id: string) => {code: string; map: null} | null;
    };
    const restoreExports = (moduleSource: string, names: readonly string[]) => {
        const body = moduleSource.replace("import {inflateWithPako} from '@/userscript/pakoRuntime';", '')
            .replace(/export const /gu, 'const ');
        // 使用生产解压适配器和真实 pako；禁止 fromCodePoint，覆盖旧内核上的补充平面还原。
        return runInNewContext(
            'String.fromCodePoint = undefined;\n' + body + '\n({' + names.join(',') + '})',
            {atob: (value: string) => Buffer.from(value, 'base64').toString('binary'), Uint8Array, inflateWithPako},
        );
    };

    it('restores every generated Unicode character exactly before Chinese detection consumes it', () => {
        const original = readFileSync(dataPath, 'utf8');
        const transformed = createPlugin().transform(original, dataPath);
        expect(transformed).not.toBeNull();
        vi.stubGlobal('pako', {ungzip});
        try {
            const restored = restoreExports(transformed!.code, Object.keys(chineseCharacterData));
            expect(restored).toEqual({...chineseCharacterData});
            for (const value of Object.values(chineseCharacterData)) {
                expect(typeof value).toBe('string');
                expect(value.length).toBeGreaterThan(0);
            }
            expect(Array.from(restored.simplifiedOnlyCharacters as string).some((character) => character.codePointAt(0)! > 0xFFFF)).toBe(true);
            expect(Array.from(restored.traditionalOnlyCharacters as string).some((character) => character.codePointAt(0)! > 0xFFFF)).toBe(true);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('restores all 46 function-word strings byte for byte and preserves the audited lexicon digest', () => {
        const entries = Object.entries(functionWordData).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
        expect(entries).toHaveLength(46);
        // 提取前四组功能词原始字符串的摘要；按导出名排序，不依赖 module namespace 的枚举实现。
        expect(createHash('sha256').update(JSON.stringify(entries)).digest('hex'))
            .toBe('998dc8f897b31a8b91eaaec8ffe4e563b513fe856a6f91d8d528209d90f15ca1');
        const transformed = createPlugin().transform(readFileSync(wordDataPath, 'utf8'), wordDataPath)!;
        vi.stubGlobal('pako', {ungzip});
        try {
            const restored = restoreExports(transformed.code, Object.keys(functionWordData));
            expect(restored).toEqual({...functionWordData});
            for (const [name, value] of entries) {
                expect(Buffer.from(restored[name], 'utf8')).toEqual(Buffer.from(value, 'utf8'));
            }
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it.each([dataPath, wordDataPath])('preserves unsorted strings, repeated characters, surrogate pairs and empty exports in %s', currentPath => {
        const values = {sample: 'A𱊯A\0\ud800', empty: ''};
        const original = Object.entries(values).map(([name, value]) => 'export const ' + name + ' = ' + JSON.stringify(value) + ';').join('\n');
        const transformed = createPlugin().transform(original, currentPath)!;
        vi.stubGlobal('pako', {ungzip});
        try {
            expect(restoreExports(transformed.code, Object.keys(values))).toEqual(values);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it.each([dataPath, wordDataPath])('rejects executable additions to %s instead of dropping or compressing them', currentPath => {
        const original = readFileSync(currentPath, 'utf8');
        expect(() => createPlugin().transform(original + '\nsideEffect();', currentPath)).toThrow('only exported const strings');
        expect(() => createPlugin().transform('export const data = makeData();', currentPath)).toThrow('only exported const strings');
        expect(() => createPlugin().transform('const privateData = "data";', currentPath)).toThrow('only exported const strings');
    });

    it('leaves Greasy Fork source and every other module untouched', () => {
        const original = readFileSync(dataPath, 'utf8');
        expect(createPlugin(false).transform(original, dataPath)).toBeNull();
        expect(createPlugin(false).transform(readFileSync(wordDataPath, 'utf8'), wordDataPath)).toBeNull();
        expect(createPlugin().transform(original, resolve(process.cwd(), 'src/core/language/chinese.ts'))).toBeNull();
        expect(createPlugin().transform(original, resolve(process.cwd(), 'src/core/language/lexicon.ts'))).toBeNull();
        expect(createPlugin().transform(original, wordDataPath + '.backup')).toBeNull();
    });
});

describe('standalone service SVG static data and license', () => {
    const asset = resolve(process.cwd(), 'src/ui/assets/serviceBrandPaths.json');
    const consumer = resolve(process.cwd(), 'src/ui/components/ServiceIcon.vue');
    const alias = '@/src/ui/assets/serviceBrandPaths.json';
    async function inMode(mode: 'standard' | 'standalone' | 'greasyfork', use: (module: typeof import('@/userscript/vite.config')) => Promise<void>) {
        vi.stubEnv('FLUENTREAD_USERSCRIPT_STANDALONE', mode === 'standalone' ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE', mode === 'greasyfork' ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_VENDOR_URL', 'https://fixture.invalid/vendor.js');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_DATA_URL', 'https://fixture.invalid/data.js');
        try {vi.resetModules(); await use(await import('@/userscript/vite.config'));}
        finally {vi.unstubAllEnvs();vi.resetModules();}
    }

    it('restores all ordered SVG attributes and retains the full license through the actual virtual module', async () => {
        await inMode('standalone', async ({default: config, createUserscriptCatalogCompressionPlugin: createPlugin}) => {
            const plugin = createPlugin();
            const resolveId = typeof plugin.resolveId === 'function' ? plugin.resolveId : plugin.resolveId!.handler;
            const load = typeof plugin.load === 'function' ? plugin.load : plugin.load!.handler;
            const id = await Reflect.apply(resolveId, {}, [alias, consumer + '?vue&type=script&setup=true&lang.ts']);
            expect(id).toBe(await Reflect.apply(resolveId, {}, [asset, consumer]));
            const watch = vi.fn();
            const source = await Reflect.apply(load, {addWatchFile: watch}, [id]);
            expect(watch).toHaveBeenCalledWith(asset);
            const original = JSON.parse(readFileSync(asset, 'utf8'));
            const canonical = JSON.stringify(original);
            const encoded = JSON.parse(source.match(/atob\(("[^"]+")\)/u)![1]);
            const bytes = Buffer.from(encoded, 'base64');
            expect(gunzipSync(bytes).toString('utf8')).toBe(canonical);
            expect(ungzip(bytes, {to: 'string'})).toBe(canonical);
            const {transformWithEsbuild} = await import('vite');
            const {inflateWithPako: inflateWithBundledPako} = await import('@/userscript/pakoBundled');
            const compiled = await transformWithEsbuild(source, 'service-svg.js', {format: 'cjs', target: 'es2018'});
            const realm = {module: {exports: {} as any}, Uint8Array,
                atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
                require: (specifier: string) => {
                    expect(specifier).toBe('@/userscript/pakoRuntime');
                    return {inflateWithPako: inflateWithBundledPako};
                }};
            runInNewContext(compiled.code, realm, {timeout: 5000});
            const restored = realm.module.exports.default;
            expect(JSON.stringify(restored)).toBe(canonical);
            expect(Object.keys(restored)).toEqual(Object.keys(original));
            expect(Object.keys(restored)).toHaveLength(38);
            expect(Object.values(restored).flat()).toHaveLength(63);
            const bundlePlugin = (config.plugins as Array<{name?: string; generateBundle?: {handler?: Function}}>)
                .find(item => item.name === 'bundle-userscript-css')!;
            const entry = {type: 'chunk', isEntry: true, fileName: 'fluent-read.user.js', code: 'const ENTRY_SENTINEL=1;', moduleIds: [id]};
            await Reflect.apply(bundlePlugin.generateBundle!.handler!, {emitFile: vi.fn()}, [{}, {'fluent-read.user.js': entry}]);
            expect(entry.code).toContain(readFileSync(resolve(process.cwd(), 'public/third-party-notices/lobe-icons-MIT.txt'), 'utf8'));
        });
    });

    it.each(['standard', 'greasyfork'] as const)('leaves the %s SVG module and resource path unchanged', async mode => {
        await inMode(mode, async ({createUserscriptCatalogCompressionPlugin: createPlugin}) => {
            const plugin = createPlugin();
            const resolveId = typeof plugin.resolveId === 'function' ? plugin.resolveId : plugin.resolveId!.handler;
            expect(await Reflect.apply(resolveId, {}, [alias, consumer])).toBeNull();
            expect(await Reflect.apply(resolveId, {}, [asset, consumer])).toBeNull();
        });
    });

    it.each(['other importer', 'query source', 'missing importer', 'other asset'] as const)
    ('preserves the ordinary JSON path for %s', async kind => {
        await inMode('standalone', async ({createUserscriptCatalogCompressionPlugin: createPlugin}) => {
            const plugin = createPlugin();
            const resolveId = typeof plugin.resolveId === 'function' ? plugin.resolveId : plugin.resolveId!.handler;
            const source = kind === 'query source' ? alias + '?raw' : kind === 'other asset' ? alias.replace('serviceBrandPaths', 'other') : alias;
            const importer = kind === 'missing importer' ? undefined : kind === 'other importer' ? consumer.replace('ServiceIcon', 'Other') : consumer;
            expect(await Reflect.apply(resolveId, {}, [source, importer])).toBeNull();
        });
    });
});
