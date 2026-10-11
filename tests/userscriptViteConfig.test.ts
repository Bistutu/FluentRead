import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname, relative, resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {runInNewContext} from 'node:vm';
import {describe, expect, it, vi} from 'vitest';
import {ungzip} from 'pako';
import ts from 'typescript';
import {zhCNMessages, UI_LANGUAGE_BUNDLES, userscriptMessages} from '@/userscript/languageBundles';
import {zhCNMessages as extensionChinese} from '@/src/core/i18n/messages/zh-CN';
import {UI_LANGUAGE_BUNDLES as extensionBundles} from '@/src/core/i18n/bundles';
import {installInformationHighlight} from '@/userscript/informationHighlight';
import {inflateWithPako} from '@/userscript/pakoRuntime';
import * as chineseCharacterData from '@/src/core/language/chineseVariants';
import * as functionWordData from '@/src/core/language/functionWordData';
import {createUserscriptCharacterDataCompressionPlugin, readUserscriptCharacterDataResource} from '@/userscript/characterDataPlugin';
import {
    default as userscriptConfig,
    executionGuardEnd,
    executionGuardStart,
    createUserscriptCatalogCompressionPlugin,
    readUserscriptInlineStylesResource,
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
        // 用固定缺失规则构造旧资源，避免测试依赖仓库当前缓存是否已经重新生成。
        data.siteCatalogs.established = structuredClone(authoritative);
        if (variant === 'old-asset' || variant === 'missing-runtime-rule') {
            data.siteCatalogs.established = data.siteCatalogs.established.filter((rule: {id: string}) =>
                !['github-code-lines', 'video-native-captions'].includes(rule.id));
            expect(data.siteCatalogs.established.length).toBeLessThan(authoritative.length);
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


describe('GF plain character data resources', () => {
    const root = process.cwd();
    const chinesePath = resolve(root, 'src/core/language/chineseVariants.ts');
    const wordsPath = resolve(root, 'src/core/language/functionWordData.ts');
    const expectedChineseOrder = ["simplifiedOnlyCharacters", "traditionalOnlyCharacters", "simplifiedChineseEvidenceCharacters"];
    const expectedWordsOrder = ["latinEnWords", "latinFrWords", "latinDeWords", "latinEsWords", "latinPtWords", "latinItWords", "latinNlWords", "latinPlWords", "latinCsWords", "latinSkWords", "latinRoWords", "latinHuWords", "latinTrWords", "latinViWords", "latinIdWords", "latinMsWords", "latinFilWords", "latinSwWords", "latinSvWords", "latinDaWords", "latinNbWords", "latinNnWords", "latinFiWords", "latinEtWords", "latinLvWords", "latinLtWords", "latinSlWords", "latinHrWords", "latinBsWords", "latinSrLatnWords", "latinCaWords", "latinGlWords", "latinAfWords", "cyrillicRuWords", "cyrillicUkWords", "cyrillicBgWords", "cyrillicSrWords", "cyrillicBeWords", "cyrillicKkWords", "cyrillicMkWords", "arabicArWords", "arabicFaWords", "arabicUrWords", "devanagariHiWords", "devanagariMrWords", "devanagariNeWords"];
    type Resource = ReturnType<typeof readUserscriptCharacterDataResource>;
    const transform = (mode: boolean | 'resource', source: string, id: string) => {
        const hook = createUserscriptCharacterDataCompressionPlugin(root, mode).transform as
            (code: string, id: string) => {code: string; map: null} | null;
        return hook(source, id);
    };
    function restore(source: string, resource: unknown, names: readonly string[]) {
        const body = source.replace(/export const /gu, 'const ');
        return runInNewContext('String.fromCodePoint = undefined;\n' + body + '\n({' + names.join(',') + '})',
            {__FLUENTREAD_USERSCRIPT_DATA__: resource}, {timeout: 5000});
    }

    describe('GF character data resource exact export contract', () => {
        it('serializes all 49 real exports as plain JSON and restores complete original strings in declaration order', () => {
            const original = readUserscriptCharacterDataResource(root);
            expect(Object.keys(original)).toEqual(['chineseVariants', 'functionWordData']);
            expect(Object.keys(original.chineseVariants)).toEqual(expectedChineseOrder);
            expect(Object.keys(original.functionWordData)).toEqual(expectedWordsOrder);
            expect(original.chineseVariants).toEqual({...chineseCharacterData});
            expect(original.functionWordData).toEqual({...functionWordData});
            const decoded = JSON.parse(JSON.stringify(original)) as Resource;
            expect(Object.keys(decoded.chineseVariants)).toEqual(expectedChineseOrder);
            expect(Object.keys(decoded.functionWordData)).toEqual(expectedWordsOrder);
            for (const [id, key] of [[chinesePath, 'chineseVariants'], [wordsPath, 'functionWordData']] as const) {
                const module = transform('resource', readFileSync(id, 'utf8'), id)!;
                expect(module.code).not.toMatch(/\b(?:atob|inflateWithPako|characterTables)\b/u);
                expect(module.code).not.toMatch(/^import /mu);
                const restored = restore(module.code, {characterData: decoded}, Object.keys(original[key]));
                expect(Object.keys(restored)).toEqual(Object.keys(original[key]));
                expect(restored).toEqual(original[key]);
                for (const name of Object.keys(original[key])) {
                    expect(Buffer.from(restored[name], 'utf8')).toEqual(Buffer.from(original[key][name], 'utf8'));
                }
            }
        });

        it.each([[chinesePath, 'chineseVariants'], [wordsPath, 'functionWordData']] as const)
        ('preserves full UTF-16 units and codepoint sequence for %s', (id, key) => {
            const values = {zeta: 'A𱊯A\0\ud800\udfff\ud800', alpha: 'é𠮷\n\t\\"\u2028\u2029', empty: ''};
            const source = Object.entries(values).map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`).join('\n');
            const plain = JSON.parse(JSON.stringify({characterData: {[key]: values}}));
            const module = transform('resource', source, id)!;
            const restored = restore(module.code, plain, Object.keys(values));
            expect(Object.keys(restored)).toEqual(['zeta', 'alpha', 'empty']);
            expect(restored).toEqual(values);
            for (const [name, value] of Object.entries(values)) {
                expect(Array.from({length: restored[name].length}, (_, index) => restored[name].charCodeAt(index)))
                    .toEqual(Array.from({length: value.length}, (_, index) => value.charCodeAt(index)));
                expect(Array.from(restored[name] as string, char => char.codePointAt(0)))
                    .toEqual(Array.from(value, char => char.codePointAt(0)));
            }
        });

        it.each([
            ['function declaration', 'export function makeData() { return "data"; }'],
            ['computed value', 'export const data = "a" + "b";'],
            ['called expression', 'export const data = makeData();'],
            ['interpolated template', 'export const data = `a${"b"}`;'],
            ['duplicate export', 'export const data = "a"; export const data = "b";'],
            ['mutable declaration', 'export let data = "a";'],
            ['private declaration', 'const data = "a";'],
            ['syntax damage', 'export const data = "unterminated;'],
            ['empty data', '/* no declarations */'],
        ])('rejects %s using the shared whitelist in compressed and resource modes', (_label, source) => {
            for (const mode of [true, 'resource'] as const) {
                for (const id of [chinesePath, wordsPath]) {
                    expect(() => transform(mode, source, id)).toThrow('only exported const strings');
                }
            }
        });

        it.each([
            ['absent namespace', undefined],
            ['missing group', {characterData: {}}],
            ['missing named export', {characterData: {chineseVariants: {other: 'value'}}}],
            ['non-string named export', {characterData: {chineseVariants: {sample: 1}}}],
        ])('fails clearly for %s instead of exporting undefined', (_label, resource) => {
            const module = transform('resource', 'export const sample = "value";', chinesePath)!;
            expect(() => restore(module.code, resource, ['sample']))
                .toThrow('Missing pinned userscript character data: chineseVariants');
        });

        it('keeps disabled mode and non-whitelisted modules unchanged', () => {
            const source = 'export const sample = "value";';
            for (const id of [chinesePath, wordsPath]) expect(transform(false, source, id)).toBeNull();
            for (const mode of [true, false, 'resource'] as const) {
                expect(transform(mode, source, resolve(root, 'src/core/language/identify.ts'))).toBeNull();
                expect(transform(mode, source, chinesePath + '.backup')).toBeNull();
            }
        });
    });

    describe('GF character data mode isolation in the real Vite config', () => {
        it.each(['standard', 'standalone', 'greasyfork'] as const)
        ('uses plain character resources only in %s when GF is selected', async mode => {
            vi.stubEnv('FLUENTREAD_USERSCRIPT_STANDALONE', mode === 'standalone' ? '1' : '0');
            vi.stubEnv('FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE', mode === 'greasyfork' ? '1' : '0');
            vi.stubEnv('FLUENTREAD_USERSCRIPT_VENDOR_URL', 'https://fixture.invalid/vendor.js');
            vi.stubEnv('FLUENTREAD_USERSCRIPT_DATA_URL', 'https://fixture.invalid/data.js');
            try {
                vi.resetModules();
                const {default: config} = await import('@/userscript/vite.config');
                const plugins = (config as {plugins: Array<{name?: string; transform?: Function; generateBundle?: {handler?: Function}}>} ).plugins;
                const characterPlugin = plugins.find(plugin => plugin.name === 'compress-userscript-character-data')!;
                for (const id of [chinesePath, wordsPath]) {
                    const module = Reflect.apply(characterPlugin.transform!, {}, [readFileSync(id, 'utf8'), id]);
                    if (mode === 'greasyfork') {
                        expect(module.code).toContain('__FLUENTREAD_USERSCRIPT_DATA__?.characterData');
                        expect(module.code).not.toContain('inflateWithPako');
                    } else {
                        expect(module.code).toContain('inflateWithPako');
                        expect(module.code).toContain('atob(');
                        expect(module.code).not.toContain('__FLUENTREAD_USERSCRIPT_DATA__');
                    }
                }
                if (mode === 'greasyfork') {
                    const cssPlugin = plugins.find(plugin => plugin.name === 'bundle-userscript-css')!;
                    const emitted: Array<{fileName: string; source: string}> = [];
                    const entry = {type: 'chunk', isEntry: true, fileName: 'fluent-read.user.js', code: 'const ENTRY_SENTINEL=1;', moduleIds: []};
                    await Reflect.apply(cssPlugin.generateBundle!.handler!, {emitFile: (asset: any) => emitted.push(asset)}, [{}, {'fluent-read.user.js': entry}]);
                    expect(emitted).toHaveLength(1);
                    expect(emitted[0].fileName).toBe('fluentread-data.v1.js');
                    const data = runInNewContext(emitted[0].source, {}, {timeout: 5000});
                    expect(Object.keys(data.characterData)).toEqual(['chineseVariants', 'functionWordData']);
                    expect(data.characterData).toEqual(readUserscriptCharacterDataResource(root));
                    expect(data.characterData.chineseVariants).toEqual({...chineseCharacterData});
                    expect(data.characterData.functionWordData).toEqual({...functionWordData});
                    expect(entry.code).toContain(readFileSync(resolve(root, 'public/third-party-notices/unicode-17.0.0.txt'), 'utf8'));
                expect(emitted[0].source).toContain(readFileSync(resolve(root, 'public/third-party-notices/unicode-17.0.0.txt'), 'utf8'));
                }
            } finally {
                vi.unstubAllEnvs();
                vi.resetModules();
            }
        });
    });
});


describe('GF plain inline CSS resources', () => {
    const root = process.cwd();
    const styles = [
        ['translationDisplayStyles', 'src/ui/styles/translation-display.css', ['src/app/content/pageStyles.ts']],
        ['pageStyles', 'src/app/content/page.css', ['src/app/content/pageStyles.ts']],
        ['sentenceHighlightStyles', 'src/ui/styles/bilingual-sentence-highlight.css', ['src/app/content/pageStyles.ts']],
        ['reencounterStyles', 'src/ui/styles/vocabulary-reencounter.css', ['src/app/content/pageStyles.ts', 'src/features/vocabulary/content/scanner.ts']],
        ['noticeStyles', 'src/features/page-notice/content/notice.css', ['src/features/page-notice/content/notice.ts']],
        ['pickerStyles', 'src/features/section-translation/content/picker.css', ['src/features/section-translation/content/picker.ts']],
    ] as const;
    const keys = styles.map(([name]) => name);
    const resourceKeys = [...keys, 'loadingIndicatorStyles'];
    const prefix = '\0fluentread-userscript-inline-style:';
    async function inMode(mode: 'standard' | 'standalone' | 'greasyfork', check: (module: typeof import('@/userscript/vite.config')) => Promise<void> | void) {
        vi.stubEnv('FLUENTREAD_USERSCRIPT_STANDALONE', mode === 'standalone' ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE', mode === 'greasyfork' ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_VENDOR_URL', 'https://fixture.invalid/vendor.js');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_DATA_URL', 'https://fixture.invalid/data.js');
        try {
            vi.resetModules();
            await check(await import('@/userscript/vite.config'));
        } finally {vi.unstubAllEnvs();vi.resetModules();}
    }
    function hooks(plugin: ReturnType<typeof createUserscriptCatalogCompressionPlugin>) {
        return {
            resolveId: typeof plugin.resolveId === 'function' ? plugin.resolveId : plugin.resolveId!.handler,
            load: typeof plugin.load === 'function' ? plugin.load : plugin.load!.handler,
        };
    }
    function restore(moduleSource: string, data: unknown) {
        return runInNewContext(moduleSource.replace('export default style;', 'globalThis.result = style;'),
            {__FLUENTREAD_USERSCRIPT_DATA__: data}, {timeout: 5000});
    }

    it.each(['standard', 'standalone', 'greasyfork'] as const)
    ('externalizes exactly six inline CSS resources only in %s when GF is selected', async mode => {
        await inMode(mode, async ({default: config, createUserscriptCatalogCompressionPlugin: createPlugin}) => {
            const {resolveId, load} = hooks(createPlugin());
            for (const [name, path, consumers] of styles) {
                for (const consumer of consumers) {
                    const id = await Reflect.apply(resolveId, {}, ['@/' + path + '?inline', resolve(root, consumer)]);
                    if (mode === 'greasyfork') expect(id).toBe(prefix + name + '.js');
                    else expect(id).toBeNull();
                }
                if (mode !== 'greasyfork') expect(await Reflect.apply(load, {}, [prefix + name + '.js'])).toBeNull();
            }
            const plugin = (config.plugins as Array<{name?: string; generateBundle?: {handler?: Function}}>)
                .find(item => item.name === 'bundle-userscript-css')!;
            const emitted: Array<{fileName: string; source: string}> = [];
            const entry = {type: 'chunk', isEntry: true, fileName: 'fluent-read.user.js', code: 'const ENTRY_SENTINEL=1;', moduleIds: []};
            await Reflect.apply(plugin.generateBundle!.handler!, {emitFile: (asset: any) => emitted.push(asset)}, [{}, {'fluent-read.user.js': entry}]);
            if (mode === 'greasyfork') {
                expect(emitted).toHaveLength(1);
                expect(Object.keys(runInNewContext(emitted[0].source, {}, {timeout: 5000}).inlineStyles)).toEqual(resourceKeys);
            } else expect(emitted).toHaveLength(0);
        });
    });

    it('accepts only the seven real consumer edges and preserves complete strings from aliases, absolute and relative paths', async () => {
        await inMode('greasyfork', async ({createUserscriptCatalogCompressionPlugin: createPlugin, readUserscriptInlineStylesResource: readStyles}) => {
            const resource = readStyles();
            expect(Object.keys(resource)).toEqual(resourceKeys);
            const {resolveId, load} = hooks(createPlugin());
            for (const [name, path, consumers] of styles) {
                for (const consumer of consumers) {
                    const importer = resolve(root, consumer), sourcePath = resolve(root, path);
                    for (const source of ['@/' + path, sourcePath, './' + relative(dirname(importer), sourcePath)]) {
                        const id = await Reflect.apply(resolveId, {}, [source + '?inline', importer]);
                        expect(id).toBe(prefix + name + '.js');
                        const watched: string[] = [];
                        const module = await Reflect.apply(load, {addWatchFile: (file: string) => watched.push(file)}, [id]);
                        expect(watched).toEqual([sourcePath]);
                        expect(module).not.toMatch(/\b(?:atob|inflateWithPako|fetch)\b/u);
                        expect(restore(module, {inlineStyles: JSON.parse(JSON.stringify(resource))})).toBe(readFileSync(sourcePath, 'utf8'));
                    }
                }
            }
        });
    });

    it('keeps other paths, assets, queries and importers on their ordinary Vite path', async () => {
        await inMode('greasyfork', async ({createUserscriptCatalogCompressionPlugin: createPlugin}) => {
            const {resolveId, load} = hooks(createPlugin());
            const source = '@/src/ui/styles/translation-display.css', importer = resolve(root, 'src/app/content/pageStyles.ts');
            const rejected: Array<[string, string | undefined]> = [
                [source, importer], [source + '?raw', importer], [source + '?inline&raw', importer],
                [source + '?inline&lang.css', importer], [source + '?raw?inline', importer],
                [source + '?inline#fragment', importer], [source + '.backup?inline', importer],
                ['@/src/ui/styles/other.css?inline', importer], ['@/public/icon/64.png?inline', importer],
                [source + '?inline', undefined], [source + '?inline', importer + '?vue&type=script'],
                [source + '?inline', resolve(root, 'src/app/content/runtime.ts')],
                ['@/src/features/page-notice/content/notice.css?inline', importer],
            ];
            for (const [request, consumer] of rejected) expect(await Reflect.apply(resolveId, {}, [request, consumer])).toBeNull();
            expect(await Reflect.apply(load, {}, ['\0unrelated-inline-style.js'])).toBeNull();
            expect(() => Reflect.apply(load, {addWatchFile: vi.fn()}, [prefix + 'unknown.js']))
                .toThrow('Unexpected userscript inline style');
        });
    });

    it.each([
        ['missing namespace', undefined], ['missing map', {}], ['missing style', {inlineStyles: {}}],
        ['non-string style', {inlineStyles: {translationDisplayStyles: 42}}],
    ])('fails explicitly for %s instead of exporting undefined', async (_label, data) => {
        await inMode('greasyfork', async ({createUserscriptCatalogCompressionPlugin: createPlugin}) => {
            const {load} = hooks(createPlugin());
            const module = await Reflect.apply(load, {addWatchFile: vi.fn()}, [prefix + 'translationDisplayStyles.js']);
            expect(() => restore(module, data)).toThrow('Missing pinned userscript inline style: translationDisplayStyles');
        });
    });

    it('preserves the six whole strings through the locked Vite GF CSS preprocessing path', async () => {
        const {resolveConfig, preprocessCSS} = await import('vite');
        // Same unminified CSS settings as GF, no server/network, artifact or production-module execution.
        const config = await resolveConfig({root, configFile: false, envFile: false, build: {minify: false}}, 'build', 'production');
        expect(config.build.cssMinify).toBe(false);
        const resource = readUserscriptInlineStylesResource();
        for (const [name, path] of styles) {
            const source = readFileSync(resolve(root, path), 'utf8');
            expect(source).not.toMatch(/@import\b|url\s*\(|@apply\b/iu);
            const processed = await preprocessCSS(source, resolve(root, path), config);
            expect(processed.code).toBe(source);
            expect(resource[name]).toBe(processed.code);
            expect(Buffer.from(resource[name], 'utf8')).toEqual(Buffer.from(source, 'utf8'));
            expect(Array.from(resource[name], character => character.codePointAt(0))).toEqual(Array.from(source, character => character.codePointAt(0)));
        }
    });

    it('emits a complete plain string map without changing the existing English, character, catalog and generated CSS fields', async () => {
        await inMode('greasyfork', async ({default: config, readUserscriptInlineStylesResource: readStyles}) => {
            const plugin = (config.plugins as Array<{name?: string; generateBundle?: {handler?: Function}}>)
                .find(item => item.name === 'bundle-userscript-css')!;
            const emitted: Array<{fileName: string; source: string}> = [];
            const css = '/* fixture CSS */ .fluent-read-sentinel { color: #f00; }\n';
            const entry = {type: 'chunk', isEntry: true, fileName: 'fluent-read.user.js', code: 'const ENTRY_SENTINEL=1;', moduleIds: []};
            const bundle = {'fluent-read.user.js': entry, 'style.css': {type: 'asset', fileName: 'style.css', source: css}};
            await Reflect.apply(plugin.generateBundle!.handler!, {emitFile: (asset: any) => emitted.push(asset)}, [{}, bundle]);
            expect(emitted.map(asset => asset.fileName)).toEqual(['fluentread-data.v1.js']);
            const data = runInNewContext(emitted[0].source, {}, {timeout: 5000});
            expect(Object.keys(data.inlineStyles)).toEqual(resourceKeys);
            expect(data.inlineStyles).toEqual(readStyles());
            expect(data.english).toEqual(UI_LANGUAGE_BUNDLES['en-US']);
            expect(data.zhCNMessages).toEqual(zhCNMessages);
            expect(data.characterData).toEqual(readUserscriptCharacterDataResource(root));
            for (const file of ['established', 'websites', 'profiles']) expect(data.siteCatalogs[file])
                .toEqual(JSON.parse(readFileSync(resolve(root, 'src/core/site-adaptation/catalog/' + file + '.json'), 'utf8')));
            expect(data.css).toBe(css);
            expect(Object.keys(bundle)).toEqual(['fluent-read.user.js']);
            for (const [name, path] of styles) expect(data.inlineStyles[name]).toBe(readFileSync(resolve(root, path), 'utf8'));
            expect(emitted[0].source).toContain(readFileSync(resolve(root, 'public/third-party-notices/unicode-17.0.0.txt'), 'utf8'));
            expect(entry.code).toContain('ENTRY_SENTINEL');
        });
    });
});


describe('GF translation insight repository boundary', () => {
    it('keeps the disabled recorder scoped to HTTP(S) userscript metadata', () => {
        const metadata = readFileSync(resolve(process.cwd(), 'userscript/metadata.ts'), 'utf8');
        const matches = Array.from(metadata.matchAll(/@match\s+([^'\s]+)/gu), match => match[1]);
        expect(matches).toEqual(['http://*/*', 'https://*/*']);
    });

    it.each(['standard', 'standalone', 'greasyfork'] as const)
    ('uses exact repository aliases only for the GF output (%s)', async mode => {
        vi.stubEnv('FLUENTREAD_USERSCRIPT_STANDALONE', mode === 'standalone' ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE', mode === 'greasyfork' ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_VENDOR_URL', 'https://fixture.invalid/vendor.js');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_DATA_URL', 'https://fixture.invalid/data.js');
        try {
            vi.resetModules();
            const {userscriptAliases: aliases} = await import('@/userscript/vite.config');
            const ports = ['modelUsageRepository', 'translationStatsRepository'];
            for (const port of ports) {
                const specifier = `@/src/platform/storage/${port}`;
                const exact = aliases.find(alias => alias.find instanceof RegExp && alias.find.test(specifier));
                if (mode !== 'greasyfork') {expect(exact).toBeUndefined(); continue;}
                expect(exact?.replacement).toBe(resolve(process.cwd(), 'userscript/translationInsights.ts'));
                for (const other of [specifier + '.ts', specifier + '/nested', specifier + '?query', 'prefix/' + specifier]) {
                    expect((exact!.find as RegExp).test(other)).toBe(false);
                }
            }
            expect(aliases.at(-1)?.find).toBe('@');
        } finally {vi.unstubAllEnvs(); vi.resetModules();}
    });

    it('keeps generation zero and ignores record inputs without database imports or calls', async () => {
        const ts = await import('typescript');
        const source = readFileSync(resolve(process.cwd(), 'userscript/translationInsights.ts'), 'utf8');
        const ast = ts.createSourceFile('translationInsights.ts', source, ts.ScriptTarget.ESNext, true);
        const imports = ast.statements.filter(ts.isImportDeclaration);
        expect(imports.every(statement => statement.importClause?.isTypeOnly)).toBe(true);
        expect(imports.map(statement => (statement.moduleSpecifier as import('typescript').StringLiteral).text)).toEqual([
            '@/src/services/model-usage/types', '@/src/services/translation-stats/types',
        ]);
        const calls: string[] = [];
        const visit = (node: import('typescript').Node) => {
            if (ts.isCallExpression(node) || ts.isNewExpression(node)) calls.push(node.expression.getText(ast));
            ts.forEachChild(node, visit);
        };
        visit(ast);
        expect(calls).toEqual([]);
        const adapter = await import('@/userscript/translationInsights');
        expect(Object.keys(adapter).sort()).toEqual(['modelUsageRepository', 'translationStatsRepository']);
        const event = new Proxy({}, {get() {throw new Error('disabled recorder read an event');}});
        const events = new Proxy([], {get() {throw new Error('disabled recorder read an event array');}});
        for (const generation of [0, 1, 99]) {
            expect(adapter.modelUsageRepository.captureGeneration()).toBe(0);
            expect(adapter.translationStatsRepository.captureGeneration()).toBe(0);
            await expect(adapter.modelUsageRepository.recordMany(events, generation)).resolves.toBe(0);
            expect(adapter.translationStatsRepository.record(
                event as Parameters<typeof adapter.translationStatsRepository.record>[0], generation,
            )).toBeUndefined();
        }
        expect(adapter.modelUsageRepository.captureGeneration()).toBe(0);
        expect(adapter.translationStatsRepository.captureGeneration()).toBe(0);
    });
});


describe('GF private loading indicator style resource boundary', () => {
    const root = process.cwd();
    const id = resolve(root, 'src/ui/translationLoadingIndicator.ts');
    const source = readFileSync(id, 'utf8');
    const binding = 'LOADING_INDICATOR_STYLES';
    const resourceKeys = [
        'translationDisplayStyles', 'pageStyles', 'sentenceHighlightStyles',
        'reencounterStyles', 'noticeStyles', 'pickerStyles', 'loadingIndicatorStyles',
    ];
    const error = 'Userscript loading indicator styles must be one private top-level const string';
    function initializer(code: string) {
        const ast = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const declarations = ast.statements.filter(ts.isVariableStatement)
            .flatMap(statement => Array.from(statement.declarationList.declarations))
            .filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === binding);
        expect(declarations).toHaveLength(1);
        expect(declarations[0].initializer).toBeDefined();
        return {ast, value: declarations[0].initializer!};
    }
    function codeExceptInitializer(code: string) {
        const {ast, value} = initializer(code);
        return code.slice(0, value.getStart(ast)) + '/* SAME_INITIALIZER_BOUNDARY */' + code.slice(value.end);
    }
    function evaluateInitializer(code: string, data: unknown): string {
        const {ast, value} = initializer(code);
        return runInNewContext('(' + value.getText(ast) + ')',
            {__FLUENTREAD_USERSCRIPT_DATA__: data}, {timeout: 5000});
    }
    async function inMode(mode: 'standard' | 'standalone' | 'greasyfork', check: (module: typeof import('@/userscript/vite.config')) => Promise<void> | void) {
        vi.stubEnv('FLUENTREAD_USERSCRIPT_STANDALONE', mode === 'standalone' ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE', mode === 'greasyfork' ? '1' : '0');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_VENDOR_URL', 'https://fixture.invalid/vendor.js');
        vi.stubEnv('FLUENTREAD_USERSCRIPT_DATA_URL', 'https://fixture.invalid/data.js');
        try {
            vi.resetModules();
            await check(await import('@/userscript/vite.config'));
        } finally {vi.unstubAllEnvs(); vi.resetModules();}
    }
    function transform(plugin: ReturnType<typeof createUserscriptCatalogCompressionPlugin>, code: string, moduleId = id) {
        const hook = typeof plugin.transform === 'function' ? plugin.transform : plugin.transform!.handler;
        const watch = vi.fn();
        const result = Reflect.apply(hook, {addWatchFile: watch}, [code, moduleId]);
        return {result, watch};
    }

    it.each(['standard', 'standalone', 'greasyfork'] as const)
    ('only replaces the exact module initializer in %s when GF is selected', async mode => {
        await inMode(mode, ({createUserscriptCatalogCompressionPlugin: createPlugin, readUserscriptInlineStylesResource: readStyles}) => {
            const {result, watch} = transform(createPlugin(), source);
            if (mode !== 'greasyfork') {
                expect(result).toBeNull();
                expect(watch).not.toHaveBeenCalled();
                // Other outputs do not even parse the private-constant candidate path.
                expect(transform(createPlugin(), 'const broken = ;').result).toBeNull();
                return;
            }
            expect(watch.mock.calls).toEqual([[id]]);
            expect(result.map).toBeNull();
            expect(codeExceptInitializer(result.code)).toBe(codeExceptInitializer(source));
            const original = initializer(source).value;
            expect(ts.isNoSubstitutionTemplateLiteral(original)).toBe(true);
            const expected = (original as import('typescript').NoSubstitutionTemplateLiteral).text;
            const resource = readStyles();
            expect(Object.keys(resource)).toEqual(resourceKeys);
            expect(createHash('sha256').update(expected).digest('hex')).toBe('dd1be4af297aa90a101a530a909cec21867fa8648fa98ee6da9757a4efc4ccfb');
            expect(resource.loadingIndicatorStyles).toBe(expected);
            const restored = evaluateInitializer(result.code, {inlineStyles: JSON.parse(JSON.stringify(resource))});
            expect(restored).toBe(expected);
            expect(Buffer.from(restored, 'utf8')).toEqual(Buffer.from(expected, 'utf8'));
            expect(Array.from({length: restored.length}, (_, index) => restored.charCodeAt(index)))
                .toEqual(Array.from({length: expected.length}, (_, index) => expected.charCodeAt(index)));
            expect(result.code.slice(0, initializer(result.code).value.getStart(initializer(result.code).ast))).toBe(source.slice(0, original.getStart(initializer(source).ast)));
            expect(result.code).not.toMatch(/\b(?:fetch|atob|inflateWithPako)\s*\(/u);
        });
    });

    it.each([
        ['string literal', JSON.stringify('ASCII\n汉字 😀 \u2028 line \ud800 lone \udfff end')],
        ['static template', '`\n:host { color: red; }\n`'],
        ['empty string', "''"],
    ])('accepts a single private %s without changing any surrounding code or UTF-16 units', async (_label, literal) => {
        await inMode('greasyfork', ({createUserscriptCatalogCompressionPlugin: createPlugin}) => {
            const code = 'const BEFORE = 1;\nconst ' + binding + ' = ' + literal + ';\nfunction untouched() { return BEFORE; }\n';
            const original = initializer(code).value as import('typescript').StringLiteralLike;
            const {result} = transform(createPlugin(), code);
            expect(codeExceptInitializer(result.code)).toBe(codeExceptInitializer(code));
            const value = JSON.parse(JSON.stringify(original.text));
            const restored = evaluateInitializer(result.code, {inlineStyles: {loadingIndicatorStyles: value}});
            expect(restored).toBe(original.text);
            expect(Array.from({length: restored.length}, (_, index) => restored.charCodeAt(index)))
                .toEqual(Array.from({length: original.text.length}, (_, index) => original.text.charCodeAt(index)));
            expect(Array.from(restored, character => character.codePointAt(0)))
                .toEqual(Array.from(original.text, character => character.codePointAt(0)));
        });
    });

    it.each([
        ['wrong path', resolve(root, 'src/ui/other.ts')],
        ['neighbor path', id + '.backup'], ['inline query', id + '?inline'],
        ['Vue query', id + '?vue&type=script'], ['fragment', id + '#fragment'],
    ])('does not transform or parse %s', async (_label, otherId) => {
        await inMode('greasyfork', ({createUserscriptCatalogCompressionPlugin: createPlugin}) => {
            const {result, watch} = transform(createPlugin(), 'const damaged = ;', otherId);
            expect(result).toBeNull();
            expect(watch).not.toHaveBeenCalled();
        });
    });

    it.each([
        ['interpolated template', 'const LOADING_INDICATOR_STYLES = `style ${value}`;'],
        ['string expression', "const LOADING_INDICATOR_STYLES = 'a' + 'b';"],
        ['function expression', 'const LOADING_INDICATOR_STYLES = makeStyles();'],
        ['duplicate binding', "const LOADING_INDICATOR_STYLES = 'a'; const LOADING_INDICATOR_STYLES = 'b';"],
        ['nested shadow binding', "const LOADING_INDICATOR_STYLES = 'a'; function nested() { const LOADING_INDICATOR_STYLES = 'b'; }"],
        ['parameter shadow binding', "const LOADING_INDICATOR_STYLES = 'a'; function nested(LOADING_INDICATOR_STYLES: string) {}"],
        ['destructured duplicate binding', "const LOADING_INDICATOR_STYLES = 'a'; const {value: LOADING_INDICATOR_STYLES} = styles;"],
        ['function binding duplicate', "const LOADING_INDICATOR_STYLES = 'a'; function LOADING_INDICATOR_STYLES() {}"],
        ['import binding duplicate', "import {styles as LOADING_INDICATOR_STYLES} from './other'; const LOADING_INDICATOR_STYLES = 'a';"],
        ['mutable binding', "let LOADING_INDICATOR_STYLES = 'a';"],
        ['multiple declarators', "const LOADING_INDICATOR_STYLES = 'a', other = 1;"],
        ['exported binding', "export const LOADING_INDICATOR_STYLES = 'a';"],
        ['nested-only binding', "function nested() { const LOADING_INDICATOR_STYLES = 'a'; }"],
        ['missing binding', "const OTHER_STYLES = 'a';"],
        ['damaged syntax', 'const LOADING_INDICATOR_STYLES = `unclosed'],
    ])('rejects %s instead of widening the source-constant boundary', async (_label, code) => {
        await inMode('greasyfork', ({createUserscriptCatalogCompressionPlugin: createPlugin}) => {
            expect(() => transform(createPlugin(), code)).toThrow(error);
        });
    });

    it.each([
        ['missing namespace', undefined], ['missing map', {}], ['missing key', {inlineStyles: {}}],
        ['number', {inlineStyles: {loadingIndicatorStyles: 42}}],
        ['null', {inlineStyles: {loadingIndicatorStyles: null}}],
        ['array', {inlineStyles: {loadingIndicatorStyles: ['CSS']}}],
        ['boxed string', {inlineStyles: {loadingIndicatorStyles: new String('CSS')}}],
    ])('throws synchronously for %s before later module work', async (_label, data) => {
        await inMode('greasyfork', ({createUserscriptCatalogCompressionPlugin: createPlugin}) => {
            const {result} = transform(createPlugin(), "const LOADING_INDICATOR_STYLES = 'CSS';");
            const {ast, value} = initializer(result.code);
            const state = {laterWork: false, __FLUENTREAD_USERSCRIPT_DATA__: data};
            expect(() => runInNewContext('const restored = (' + value.getText(ast) + '); globalThis.laterWork = true;', state, {timeout: 5000}))
                .toThrow('Missing pinned userscript inline style: loadingIndicatorStyles');
            expect(state.laterWork).toBe(false);
        });
    });
});
