import {mimoRetirementSource, mimoRetirementLegacyText} from '@/src/core/i18n/messages/mimoRetirement';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
// 脚本发布的语言资源不含智能高亮文案；摘要必须按脚本实际使用的投影计算。
import {UI_LANGUAGE_BUNDLES, currentUserscriptLanguageBundle, createUserscriptLanguageUpdate} from '../userscript/languageBundles';
import {gzipUserscriptBuildData} from '../userscript/buildGzip';
import {UI_LANGUAGE_BUNDLES as extensionBundles} from '@/src/core/i18n/bundles';
import {aiRequestTimeoutMessages} from '@/src/core/i18n/messages/aiRequestTimeout';
import {ungzip} from 'pako';
import {packUiLanguageBundle, unpackUiLanguageBundle} from '@/userscript/languageData';
import userscriptConfig from '../userscript/vite.config';

const languageDir = resolve(process.cwd(), 'userscript/languages');
const digest = createHash('sha256').update(JSON.stringify(UI_LANGUAGE_BUNDLES['fr-FR'])).digest('hex').slice(0, 16);
const fileName = `fr-FR.${digest}.json`;
const source = readFileSync(resolve(languageDir, fileName), 'utf8');
const resourceCommit = '70d3d901033a579e32a5bf5e6af14555f0d140bb';

describe('embedded language columns', () => {
    it('roundtrips sorted catalogs and preserves duplicate patterns and optional captures', () => {
        const bundle = {messages: {z: '末尾', a: 'first'}, legacyText: {'旧文案': 'legacy'}, legacyPatterns: {
            early: [], late: [['^same$', 'localized'], ['^same$', 'fallback', []], ['^(.+)$', '{1}', [1]]],
        }} as const;
        const packed = packUiLanguageBundle(bundle);
        expect(packed).toEqual([[['a', 'z'], ['旧文案']], [[], [], []],
            [['^same$', '^same$', '^(.+)$'], ['localized', 'fallback', '{1}'], [null, [], [1]]], [['first', '末尾'], ['legacy']]]);
        expect(unpackUiLanguageBundle(JSON.parse(JSON.stringify(packed)))).toEqual(bundle);
        expect(unpackUiLanguageBundle(bundle)).toBe(bundle);
        expect(packUiLanguageBundle({...bundle, messages: {a: 'first', z: '末尾'}})).toEqual(packed);
    });
});

describe('userscript remote UI language data', () => {
    it('keeps the complete settings notice aligned with the shared locale source', () => {
        const component = readFileSync(resolve(process.cwd(), 'src/features/settings/ui/services/ServiceConfiguration.vue'), 'utf8');
        expect(component).toContain("translateLegacy('" + mimoRetirementSource + "')");
        expect(component).toContain('data-mimo-retirement-note');
    });

    beforeEach(() => {
        const defines = (userscriptConfig as {define: Record<string, string>}).define;
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_DATA__', undefined);
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_UPDATES__', JSON.parse(defines.__FLUENTREAD_USERSCRIPT_LANGUAGE_UPDATES__));
        vi.stubGlobal('DecompressionStream', undefined);
        vi.stubGlobal('pako', {ungzip});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
        globalThis.GM = undefined;
    });

    it.each(['current', 'legacy'] as const)('registers the %s English data resource without a network request or mutating its source', async version => {
        for (const bundle of Object.values(UI_LANGUAGE_BUNDLES)) {
            expect(bundle.messages).not.toHaveProperty('popup.compact.translate');
            expect(bundle.messages).not.toHaveProperty('popup.compact.restore');
            expect(Object.keys(bundle.messages).some(key => key.startsWith('popup.displayMode.'))).toBe(false);
            expect(Object.keys(bundle.messages).some(key => key.startsWith('popup.pageFont.'))).toBe(false);
            expect(Object.keys(bundle.messages).some(key => key.startsWith('safari.freePool.'))).toBe(false);
            expect(bundle.messages['popup.translateCurrentPage']).toBeTruthy();
        }
        const requests: string[] = [];
        globalThis.GM = {
            xmlHttpRequest(details) { requests.push(details.url); throw new Error('unexpected request'); },
        };
        const pinned = runInNewContext(readFileSync(resolve(process.cwd(), 'userscript/resources/fluentread-data.v1.js'), 'utf8'), {}, {timeout: 5000});
        if (version === 'legacy') {
            delete pinned.english.messages['settings.services.deeplx.defaultRoute'];
            pinned.english.messages['settings.services.deeplx.endpointHelp'] = 'Legacy endpoint route help';
        }
        const englishUpdate = createUserscriptLanguageUpdate(currentUserscriptLanguageBundle('en-US'), pinned.english);
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_UPDATES__', gzipUserscriptBuildData(Buffer.from(JSON.stringify({'en-US': englishUpdate}))).toString('base64'));
        const original = JSON.stringify(pinned.english);
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_DATA__', pinned);
        // data 优先于压缩资源；旧资源缺失或过期的两条文案也必须在注册时修复。
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__', {'en-US': 'invalid-if-selected'});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__', {});

        const {hasUiLanguageBundle, translate, translateLegacyText} = await import('@/src/core/i18n');
        expect(hasUiLanguageBundle('en-US')).toBe(false);
        const loader = await import('@/userscript/uiLanguageBundles');
        await expect(loader.ensureUiLanguageBundle('en-US')).resolves.toBe(true);
        expect(hasUiLanguageBundle('en-US')).toBe(true);
        expect(translateLegacyText(mimoRetirementSource, 'en-US')).toBe(extensionBundles['en-US'].legacyText[mimoRetirementSource]);
        for (const [key, text] of Object.entries(currentUserscriptLanguageBundle('en-US').messages)) expect(translate(key, 'en-US')).toBe(text);
        expect(JSON.stringify(pinned.english)).toBe(original);
        expect(requests).toEqual([]);
    });

    it('registers the actual compressed English define without a GM request and preserves retained copy', async () => {
        const requests: string[] = [];
        globalThis.GM = {
            xmlHttpRequest(details) { requests.push(details.url); throw new Error('unexpected request'); },
        };
        const defines = (userscriptConfig as {define: Record<string, string>}).define;
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_DATA__', undefined);
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__', JSON.parse(defines.__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__));
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__', JSON.parse(defines.__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__));
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_RESOURCE_COMMIT__', JSON.parse(defines.__FLUENTREAD_USERSCRIPT_RESOURCE_COMMIT__));
        // 确定走现有 pako fallback；此处不要求测试 DOM 环境提供浏览器原生 gzip stream。
        vi.stubGlobal('DecompressionStream', undefined);
        vi.stubGlobal('pako', {ungzip});
        const original = UI_LANGUAGE_BUNDLES['en-US'];
        const messages = Object.fromEntries(Object.entries(original.messages).filter(([key]) => !key.startsWith('document.') && !key.startsWith('translationStats.')));
        const expected = {...original, messages, legacyText: {...original.legacyText, ...mimoRetirementLegacyText['en-US']}};
        const core = await import('@/src/core/i18n');
        expect(core.hasUiLanguageBundle('en-US')).toBe(false);
        const register = vi.spyOn(core, 'registerUiLanguageBundle');
        try {
            const loader = await import('@/userscript/uiLanguageBundles');
            await expect(loader.ensureUiLanguageBundle('en-US')).resolves.toBe(true);
            expect(core.hasUiLanguageBundle('en-US')).toBe(true);
            expect(core.translateLegacyText(mimoRetirementSource, 'en-US')).toBe(extensionBundles['en-US'].legacyText[mimoRetirementSource]);
            expect(register).toHaveBeenCalledTimes(1);
            expect(register).toHaveBeenCalledWith('en-US', expected);
            // 对实际注册后的每一条保留稳定 key 使用核心翻译入口，包含参数占位文案。
            for (const [key, value] of Object.entries(messages)) expect(core.translate(key, 'en-US')).toBe(value);
            expect(original.legacyText['配置服务']).toBeTruthy();
            expect(core.translateLegacyText('配置服务', 'en-US')).toBe(original.legacyText['配置服务']);
            expect(core.translateLegacyText('翻译连接：Google；自定义服务：2；凭据和地址已隐藏', 'en-US'))
                .toBe('Connection: Google; custom services: 2; credentials and addresses hidden');
            await expect(loader.ensureUiLanguageBundle('en-US')).resolves.toBe(true);
            expect(register).toHaveBeenCalledTimes(1);
            expect(requests).toEqual([]);
        } finally {
            register.mockRestore();
        }
    });

    it('downloads a generated language resource once and loads it from private GM cache next time', async () => {
        const values = new Map<string, unknown>();
        const requests: string[] = [];
        globalThis.GM = {
            async getValue(key, fallback) { return values.get(key) ?? fallback; },
            async setValue(key, value) { values.set(key, value); },
            xmlHttpRequest(details) {
                requests.push(details.url);
                return Promise.resolve({status: 200, statusText: 'OK', responseText: source});
            },
        };
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__', {});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__', {'fr-FR': fileName});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_RESOURCE_COMMIT__', resourceCommit);

        const first = await import('@/userscript/uiLanguageBundles');
        await expect(first.ensureUiLanguageBundle('fr-FR')).resolves.toBe(true);
        expect(requests).toEqual([
            `https://cdn.jsdelivr.net/gh/FluentRead/FluentRead@${resourceCommit}/userscript/languages/${fileName}`,
        ]);
        expect(values.has(`fluentread:ui-language:${fileName}`)).toBe(true);

        vi.resetModules();
        globalThis.GM.xmlHttpRequest = () => { throw new Error('offline'); };
        const cached = await import('@/userscript/uiLanguageBundles');
        await expect(cached.ensureUiLanguageBundle('fr-FR')).resolves.toBe(true);
        expect(requests).toHaveLength(1);
    });

    it('tries raw GitHub when the CDN is unavailable', async () => {
        const requests: string[] = [];
        globalThis.GM = {
            async getValue(_key, fallback) { return fallback; },
            async setValue() {},
            xmlHttpRequest(details) {
                requests.push(details.url);
                return requests.length === 1
                    ? Promise.reject(new Error('CDN unavailable'))
                    : Promise.resolve({status: 200, statusText: 'OK', responseText: source});
            },
        };
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__', {});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__', {'fr-FR': fileName});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_RESOURCE_COMMIT__', resourceCommit);

        const loader = await import('@/userscript/uiLanguageBundles');
        await expect(loader.ensureUiLanguageBundle('fr-FR')).resolves.toBe(true);
        expect(requests).toEqual([
            `https://cdn.jsdelivr.net/gh/FluentRead/FluentRead@${resourceCommit}/userscript/languages/${fileName}`,
            `https://raw.githubusercontent.com/FluentRead/FluentRead/${resourceCommit}/userscript/languages/${fileName}`,
        ]);
    });

    it.each(['ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const)('localizes recovery, DeepLX and MiMo copy after loading pinned %s data and after an offline cache reload', async language => {
        const digest = createHash('sha256').update(JSON.stringify(UI_LANGUAGE_BUNDLES[language])).digest('hex').slice(0, 16);
        const remoteFile = `${language}.${digest}.json`;
        const remoteSource = readFileSync(resolve(languageDir, remoteFile), 'utf8');
        const original = JSON.parse(remoteSource);
        expect(original.legacyText).not.toHaveProperty(mimoRetirementSource);
        expect(extensionBundles[language].legacyText[mimoRetirementSource]).toBeTruthy();
        expect(extensionBundles[language].legacyText[mimoRetirementSource]).not.toBe(mimoRetirementSource);
        expect(original.messages).not.toHaveProperty('sectionTranslation.picker.dragging');
        expect(original.messages).not.toHaveProperty('sectionTranslation.scope.selected');
        expect(original.messages).not.toHaveProperty('learning.panelLoadError');
        expect(original.messages).not.toHaveProperty('learning.reloadPage');
        expect(original.messages).not.toHaveProperty('settings.services.deeplx.defaultRoute');
        expect(original.messages['settings.services.deeplx.endpointHelp']).not.toBe(extensionBundles[language].messages['settings.services.deeplx.endpointHelp']);
        for (const key of Object.keys(aiRequestTimeoutMessages[language])) expect(original.messages).not.toHaveProperty(key);
        const values = new Map<string, unknown>();
        const requests: string[] = [];
        globalThis.GM = {
            async getValue(key, fallback) { return values.get(key) ?? fallback; },
            async setValue(key, value) { values.set(key, value); },
            xmlHttpRequest(details) {
                requests.push(details.url);
                return Promise.resolve({status: 200, statusText: 'OK', responseText: remoteSource});
            },
        };
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__', {});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__', {[language]: remoteFile});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_RESOURCE_COMMIT__', resourceCommit);
        const current = currentUserscriptLanguageBundle(language);
        const assertCurrentCopy = async () => {
            const core = await import('@/src/core/i18n');
            for (const [key, text] of Object.entries(current.messages)) expect(core.translate(key, language), `${language}: ${key}`).toBe(text);
            for (const [source, text] of Object.entries(current.legacyText)) expect(core.translateLegacyText(source, language), `${language}: ${source}`).toBe(text);
        };
        async function assertLocalizedRegistration() {
            const core = await import('@/src/core/i18n');
            const register = vi.spyOn(core, 'registerUiLanguageBundle');
            try {
                const loader = await import('@/userscript/uiLanguageBundles');
                await expect(loader.ensureUiLanguageBundle(language)).resolves.toBe(true);
                await assertCurrentCopy();
                expect(core.translateLegacyText(mimoRetirementSource, language)).toBe(extensionBundles[language].legacyText[mimoRetirementSource]);
                expect(register).toHaveBeenCalledTimes(1);
                const registered = register.mock.calls[0][1];
                for (const [key, text] of Object.entries(current.messages)) expect(registered.messages[key]).toBe(text);
                for (const [source, text] of Object.entries(current.legacyText)) expect(registered.legacyText[source]).toBe(text);
                for (const phase of ['early', 'late'] as const) {
                    expect(registered.legacyPatterns[phase]).toEqual(current.legacyPatterns[phase]);
                }
                expect(registered.legacyText['服务优先顺序']).toBe(original.legacyText['服务优先顺序']);
                await expect(loader.ensureUiLanguageBundle(language)).resolves.toBe(true);
                await assertCurrentCopy();
                expect(core.translateLegacyText(mimoRetirementSource, language)).toBe(extensionBundles[language].legacyText[mimoRetirementSource]);
                expect(register).toHaveBeenCalledTimes(1);
            } finally { register.mockRestore(); }
        }
        await assertLocalizedRegistration();
        expect(requests).toHaveLength(1);
        expect(values.get(`fluentread:ui-language:${remoteFile}`)).toBe(JSON.stringify(original));
        // 注册补充不写回固定资源或GM缓存；离线读取同一旧资源也应本地化。
        vi.resetModules();
        globalThis.GM.xmlHttpRequest = () => { throw new Error('offline'); };
        await assertLocalizedRegistration();
        expect(requests).toHaveLength(1);
        expect(values.get(`fluentread:ui-language:${remoteFile}`)).toBe(JSON.stringify(original));
        expect(readFileSync(resolve(languageDir, remoteFile), 'utf8')).toBe(remoteSource);
    });

    it('uses current source copy over stale cached recovery messages without mutating the cache', async () => {
        const original = JSON.parse(source);
        const messages = {...original.messages,
            'learning.panelLoadError': 'Remote section recovery', 'learning.reloadPage': 'Remote reload'};
        const supplied = {...original, messages};
        globalThis.GM = {
            async getValue() { return supplied; },
            xmlHttpRequest() { throw new Error('unexpected request'); },
        };
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__', {});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__', {'fr-FR': fileName});
        const core = await import('@/src/core/i18n');
        const register = vi.spyOn(core, 'registerUiLanguageBundle');
        try {
            const loader = await import('@/userscript/uiLanguageBundles');
            await expect(loader.ensureUiLanguageBundle('fr-FR')).resolves.toBe(true);
            expect(register).toHaveBeenCalledTimes(1);
            const registered = register.mock.calls[0][1];
            const current = currentUserscriptLanguageBundle('fr-FR');
            for (const [key, text] of Object.entries(current.messages)) expect(registered.messages[key]).toBe(text);
            expect(core.translate('learning.panelLoadError', 'fr-FR')).toBe(current.messages['learning.panelLoadError']);
            expect(core.translate('learning.reloadPage', 'fr-FR')).toBe(current.messages['learning.reloadPage']);
            expect(supplied.messages).toEqual(messages);
        } finally { register.mockRestore(); }
    });

    it('retries a failed local increment decode using the unchanged cached remote resource', async () => {
        const original = JSON.parse(source), before = JSON.stringify(original);
        globalThis.GM = {async getValue() {return original;}, xmlHttpRequest() {throw new Error('offline');}};
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__', {});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__', {'fr-FR': fileName});
        vi.stubGlobal('pako', {ungzip: vi.fn().mockImplementationOnce(() => {throw new Error('temporary decompression failure');}).mockImplementation(ungzip)});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const core = await import('@/src/core/i18n');
            const loader = await import('@/userscript/uiLanguageBundles');
            await expect(loader.ensureUiLanguageBundle('fr-FR')).resolves.toBe(false);
            expect(core.hasUiLanguageBundle('fr-FR')).toBe(false);
            await expect(loader.ensureUiLanguageBundle('fr-FR')).resolves.toBe(true);
            expect(core.translate('settings.floatingBall.hoverDelayHelp', 'fr-FR')).toBe(extensionBundles['fr-FR'].messages['settings.floatingBall.hoverDelayHelp']);
            expect(JSON.stringify(original)).toBe(before);
        } finally {warn.mockRestore();}
    });

    it('reconstructs duplicate regex entries, reordering and changed captures without changing the baseline', async () => {
        const baseline = {messages: {'sample': 'old'}, legacyText: {}, legacyPatterns: {early: [], late: [
            ['^same (.+)$', 'localized {1}', [1]], ['^same (.+)$', 'fallback {1}'], ['^removed$', 'removed'],
        ]}} as const;
        const current = {messages: {'sample': 'new'}, legacyText: {}, legacyPatterns: {early: [['^early$', 'new early']], late: [
            baseline.legacyPatterns.late[1], ['^same (.+)$', 'updated {1}', [1]], baseline.legacyPatterns.late[0],
        ]}} as const;
        const update = createUserscriptLanguageUpdate(current, baseline);
        expect(createUserscriptLanguageUpdate(current, baseline)).toEqual(update);
        expect(update.legacyPatterns.late).toEqual([current.legacyPatterns.late[1]]);
        expect(update.patternOrder?.late).toEqual([1, -1, 0]);
        expect(createUserscriptLanguageUpdate(current, current)).toEqual({messages: {}, legacyText: {}, legacyPatterns: {early: [], late: []}});
        const before = JSON.stringify(baseline);
        globalThis.GM = {async getValue() {return baseline;}, xmlHttpRequest() {throw new Error('unexpected request');}};
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__', {});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__', {'fr-FR': fileName});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_UPDATES__', gzipUserscriptBuildData(Buffer.from(JSON.stringify({'fr-FR': update}))).toString('base64'));
        const core = await import('@/src/core/i18n'), register = vi.spyOn(core, 'registerUiLanguageBundle');
        try {
            const loader = await import('@/userscript/uiLanguageBundles');
            await expect(loader.ensureUiLanguageBundle('fr-FR')).resolves.toBe(true);
            expect(register).toHaveBeenCalledWith('fr-FR', current);
            expect(JSON.stringify(baseline)).toBe(before);
        } finally {register.mockRestore();}
    });

    it.each([
        {messages: null},
        {patternOrder: {early: 'invalid'}},
        {patternOrder: {early: [0.5]}},
        {patternOrder: {early: [999999]}},
        {patternOrder: {early: [-999999]}},
    ])('rejects malformed local update %j without registering or changing the baseline', async invalid => {
        const original = JSON.parse(source), before = JSON.stringify(original);
        const update = {messages: {}, legacyText: {}, legacyPatterns: {early: [], late: []}, ...invalid};
        globalThis.GM = {async getValue() {return original;}, xmlHttpRequest() {throw new Error('unexpected request');}};
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__', {});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__', {'fr-FR': fileName});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_UPDATES__', gzipUserscriptBuildData(Buffer.from(JSON.stringify({'fr-FR': update}))).toString('base64'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const core = await import('@/src/core/i18n');
            const loader = await import('@/userscript/uiLanguageBundles');
            await expect(loader.ensureUiLanguageBundle('fr-FR')).resolves.toBe(false);
            expect(core.hasUiLanguageBundle('fr-FR')).toBe(false);
            expect(JSON.stringify(original)).toBe(before);
        } finally {warn.mockRestore();}
    });

    it('keeps baseline compatibility when an older build has no local increment define', async () => {
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_UPDATES__', undefined);
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__', {});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__', {'fr-FR': fileName});
        globalThis.GM = {async getValue() {return JSON.parse(source);}, xmlHttpRequest() {throw new Error('unexpected request');}};
        const core = await import('@/src/core/i18n'), register = vi.spyOn(core, 'registerUiLanguageBundle');
        try {
            const loader = await import('@/userscript/uiLanguageBundles');
            await expect(loader.ensureUiLanguageBundle('fr-FR')).resolves.toBe(true);
            expect(register).toHaveBeenCalledWith('fr-FR', JSON.parse(source));
        } finally {register.mockRestore();}
    });

    it('shares concurrent loads and rerenders once after availability, while unsupported languages render once', async () => {
        let resolveCache!: (value: unknown) => void;
        globalThis.GM = {async getValue() {return new Promise(resolve => {resolveCache = resolve;});}, xmlHttpRequest() {throw new Error('unexpected request');}};
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__', {});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__', {'fr-FR': fileName});
        const loader = await import('@/userscript/uiLanguageBundles');
        const render = vi.fn();
        loader.renderWithUiLanguageBundle('fr-FR', render);
        expect(render).toHaveBeenCalledTimes(1);
        const first = loader.ensureUiLanguageBundle('fr-FR');
        expect(loader.ensureUiLanguageBundle('fr-FR')).toBe(first);
        resolveCache(JSON.parse(source));
        await expect(first).resolves.toBe(true);
        expect(render).toHaveBeenCalledTimes(2);
        loader.renderWithUiLanguageBundle('fr-FR', render);
        expect(render).toHaveBeenCalledTimes(3);
        const unsupported = vi.fn();
        loader.renderWithUiLanguageBundle('ko-KR', unsupported);
        await expect(loader.ensureUiLanguageBundle('ko-KR')).resolves.toBe(false);
        expect(unsupported).toHaveBeenCalledTimes(1);
    });

    it.each(['http', 'invalid-resource', 'invalid-compressed'] as const)('rejects %s resources without registering them', async kind => {
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__', kind === 'invalid-compressed'
            ? {'fr-FR': gzipUserscriptBuildData(Buffer.from('null')).toString('base64')} : {});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__', {'fr-FR': fileName});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_RESOURCE_COMMIT__', resourceCommit);
        const requests: string[] = [];
        globalThis.GM = {
            async getValue() {throw new Error('cache unavailable');},
            xmlHttpRequest(details) {requests.push(details.url);return Promise.resolve({status: kind === 'http' ? 503 : 200, statusText: '', responseText: 'null'});},
        };
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const core = await import('@/src/core/i18n'), loader = await import('@/userscript/uiLanguageBundles');
            await expect(loader.ensureUiLanguageBundle('fr-FR')).resolves.toBe(false);
            expect(core.hasUiLanguageBundle('fr-FR')).toBe(false);
            expect(requests).toHaveLength(kind === 'invalid-compressed' ? 0 : 2);
        } finally {warn.mockRestore();}
    });

});
