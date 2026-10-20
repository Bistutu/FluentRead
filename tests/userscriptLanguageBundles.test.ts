import {mimoRetirementSource, mimoRetirementLegacyText} from '@/src/core/i18n/messages/mimoRetirement';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
// 脚本发布的语言资源不含智能高亮文案；摘要必须按脚本实际使用的投影计算。
import {UI_LANGUAGE_BUNDLES} from '../userscript/languageBundles';
import {UI_LANGUAGE_BUNDLES as extensionBundles} from '@/src/core/i18n/bundles';
import {aiRequestTimeoutMessages} from '@/src/core/i18n/messages/aiRequestTimeout';
import {ungzip} from 'pako';
import {gunzipSync} from 'node:zlib';
import type {RegisteredUiLanguage, UiLanguageBundle} from '@/src/core/i18n/types';
import {frozen39Registration} from './fixtures/userscriptLanguageSupplements39Oracle';
import userscriptConfig from '../userscript/vite.config';

const languageDir = resolve(process.cwd(), 'userscript/languages');
const digest = createHash('sha256').update(JSON.stringify(UI_LANGUAGE_BUNDLES['fr-FR'])).digest('hex').slice(0, 16);
const fileName = `fr-FR.${digest}.json`;
const source = readFileSync(resolve(languageDir, fileName), 'utf8');
const sweepKeys = ['sectionTranslation.picker.preview', 'sectionTranslation.picker.instruction', 'popup.sectionTranslationTitle', 'sectionTranslation.picker.dragging', 'sectionTranslation.scope.selected'];
const sweepCopy = (language: keyof typeof extensionBundles) => Object.fromEntries(sweepKeys.map(key => [key, extensionBundles[language].messages[key]]));
const deeplxKeys = ['settings.services.deeplx.defaultRoute', 'settings.services.deeplx.endpointHelp'];
const deeplxCopy = (language: keyof typeof extensionBundles) => Object.fromEntries(deeplxKeys.map(key => [key, extensionBundles[language].messages[key]]));

const resourceCommit = '70d3d901033a579e32a5bf5e6af14555f0d140bb';

describe('userscript remote UI language data', () => {
    it('keeps the complete settings notice aligned with the shared locale source', () => {
        const component = readFileSync(resolve(process.cwd(), 'src/features/settings/ui/services/ServiceConfiguration.vue'), 'utf8');
        expect(component).toContain("translateLegacy('" + mimoRetirementSource + "')");
        expect(component).toContain('data-mimo-retirement-note');
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
        globalThis.GM = undefined;
    });

    it('registers the English bundle supplied by the pinned data resource without a network request', async () => {
        for (const bundle of Object.values(UI_LANGUAGE_BUNDLES)) {
            expect(bundle.messages).not.toHaveProperty('popup.compact.translate');
            expect(bundle.messages).not.toHaveProperty('popup.compact.restore');
            expect(Object.keys(bundle.messages).some(key => key.startsWith('popup.displayMode.'))).toBe(false);
            expect(Object.keys(bundle.messages).some(key => key.startsWith('safari.freePool.'))).toBe(false);
            expect(bundle.messages['popup.translateCurrentPage']).toBeTruthy();
        }
        const requests: string[] = [];
        globalThis.GM = {
            xmlHttpRequest(details) { requests.push(details.url); throw new Error('unexpected request'); },
        };
        const pinned = runInNewContext(readFileSync(resolve(process.cwd(), 'userscript/resources/fluentread-data.v1.js'), 'utf8'), {}, {timeout: 5000});
        const original = JSON.stringify(pinned.english);
        expect(pinned.english.messages).not.toHaveProperty('settings.services.deeplx.defaultRoute');
        expect(pinned.english.messages['settings.services.deeplx.endpointHelp']).not.toBe(extensionBundles['en-US'].messages['settings.services.deeplx.endpointHelp']);
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_DATA__', pinned);
        // 嵌入的旧 data 优先于压缩资源，因此两条新文案必须在注册时覆盖。
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__', {'en-US': 'invalid-if-selected'});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__', {});

        const {hasUiLanguageBundle, translate, translateLegacyText} = await import('@/src/core/i18n');
        expect(hasUiLanguageBundle('en-US')).toBe(false);
        const loader = await import('@/userscript/uiLanguageBundles');
        await expect(loader.ensureUiLanguageBundle('en-US')).resolves.toBe(true);
        expect(hasUiLanguageBundle('en-US')).toBe(true);
        expect(translateLegacyText(mimoRetirementSource, 'en-US')).toBe(extensionBundles['en-US'].legacyText[mimoRetirementSource]);
        for (const key of deeplxKeys) expect(translate(key, 'en-US')).toBe(extensionBundles['en-US'].messages[key]);
        expect((await import('@/src/core/i18n')).translateLegacyText('网站阅读字体', 'en-US')).toBe(extensionBundles['en-US'].legacyText['网站阅读字体']);
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
        const messages = Object.fromEntries(Object.entries(original.messages).filter(([key]) => !key.startsWith('document.')));
        const expected = {...original, messages, legacyText: {...original.legacyText, ...mimoRetirementLegacyText['en-US'], '网站阅读字体': extensionBundles['en-US'].legacyText['网站阅读字体']}};
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
            expect(core.translateLegacyText('网站阅读字体', 'en-US')).toBe(extensionBundles['en-US'].legacyText['网站阅读字体']);
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
        const assertSweepCopy = async () => {
            const core = await import('@/src/core/i18n');
            for (const key of [...sweepKeys, ...deeplxKeys]) {
                expect(core.translate(key, language)).toBe(extensionBundles[language].messages[key]);
            }
        };
        const recovery = {
            'learning.panelLoadError': extensionBundles[language].messages['learning.panelLoadError'],
            'learning.reloadPage': extensionBundles[language].messages['learning.reloadPage'],
        };
        async function assertLocalizedRegistration() {
            const core = await import('@/src/core/i18n');
            const register = vi.spyOn(core, 'registerUiLanguageBundle');
            try {
                const loader = await import('@/userscript/uiLanguageBundles');
                await expect(loader.ensureUiLanguageBundle(language)).resolves.toBe(true);
                await assertSweepCopy();
                expect(core.translateLegacyText(mimoRetirementSource, language)).toBe(extensionBundles[language].legacyText[mimoRetirementSource]);
                expect(core.translateLegacyText('网站阅读字体', language)).toBe(extensionBundles[language].legacyText['网站阅读字体']);
                expect(JSON.stringify(original)).toBe(remoteSource.trimEnd());
                expect(register).toHaveBeenCalledTimes(1);
                expect(register).toHaveBeenCalledWith(language, {
                    ...original, legacyText: {...original.legacyText, ...mimoRetirementLegacyText[language], '网站阅读字体': extensionBundles[language].legacyText['网站阅读字体']}, messages: {...recovery, ...original.messages, ...aiRequestTimeoutMessages[language], ...sweepCopy(language), ...deeplxCopy(language)},
                });
                for (const [key, text] of Object.entries(recovery)) {
                    expect(core.translate(key, language)).toBe(text);
                    expect(core.translate(key, language)).not.toBe(core.translate(key, 'zh-CN'));
                }
                for (const [key, text] of Object.entries(aiRequestTimeoutMessages[language])) {
                    expect(core.translate(key, language)).toBe(text);
                    if (key !== 'settings.requestLimits.seconds') expect(core.translate(key, language)).not.toBe(core.translate(key, 'zh-CN'));
                }
                await expect(loader.ensureUiLanguageBundle(language)).resolves.toBe(true);
                await assertSweepCopy();
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

    it('preserves recovery messages supplied by a remote bundle instead of replacing them with the local supplement', async () => {
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
            expect(register).toHaveBeenCalledWith('fr-FR', {
                ...supplied, legacyText: {...supplied.legacyText, ...mimoRetirementLegacyText['fr-FR'], '网站阅读字体': extensionBundles['fr-FR'].legacyText['网站阅读字体']}, messages: {...supplied.messages, ...aiRequestTimeoutMessages['fr-FR'], ...sweepCopy('fr-FR'), ...deeplxCopy('fr-FR')},
            });
            expect(core.translate('learning.panelLoadError', 'fr-FR')).toBe('Remote section recovery');
            expect(core.translate('learning.reloadPage', 'fr-FR')).toBe('Remote reload');
            expect(supplied.messages).toEqual(messages);
        } finally { register.mockRestore(); }
    });

});


describe('userscript gzipped supplement parity', () => {
    const languages = ['en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'es-ES'] as const;
    const defineMacros = () => {
        const defines = (userscriptConfig as {define: Record<string, string>}).define;
        const supplement = JSON.parse(defines.__FLUENTREAD_USERSCRIPT_LANGUAGE_SUPPLEMENTS__) as string;
        const compressed = JSON.parse(defines.__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__) as Record<string, string>;
        const remote = JSON.parse(defines.__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__) as Record<string, string>;
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_DATA__', undefined);
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__', compressed);
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_SUPPLEMENTS__', supplement);
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__', remote);
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_RESOURCE_COMMIT__', JSON.parse(defines.__FLUENTREAD_USERSCRIPT_RESOURCE_COMMIT__));
        return {supplement, compressed, remote};
    };
    const assertOriginalBytes = (language: RegisteredUiLanguage, actual: UiLanguageBundle, incoming: UiLanguageBundle) => {
        const expected = frozen39Registration(language, incoming);
        // 比较最终注册对象全部UTF8 JSON字节，同时避免失败日志倾倒整份大型词典。
        expect(Buffer.compare(Buffer.from(JSON.stringify(actual), 'utf8'), Buffer.from(JSON.stringify(expected), 'utf8')),
            `frozen39 registration bytes for ${language}`).toBe(0);
    };
    const minimalEnglish = (): UiLanguageBundle => ({
        messages: {'audit.retained': 'Keep this message', 'settings.services.deeplx.endpointHelp': 'Stale embedded English'},
        legacyText: {'audit source': 'Keep this legacy value', '网站阅读字体': 'Stale embedded font'},
        legacyPatterns: {early: [], late: []},
    });
    beforeEach(() => vi.resetModules());
    afterEach(() => {
        vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); globalThis.GM = undefined;
    });

    it('matches frozen39 bytes for all six macro registrations, inflates once and preserves remote cache reuse', async () => {
        const {supplement, remote} = defineMacros();
        const pinned = runInNewContext(readFileSync(resolve(process.cwd(), 'userscript/resources/fluentread-data.v1.js'), 'utf8'), {}, {timeout: 5000}) as {english: UiLanguageBundle};
        const incoming = new Map<RegisteredUiLanguage, UiLanguageBundle>([['en-US', pinned.english]]);
        const originalInputs = new Map<RegisteredUiLanguage, string>([['en-US', JSON.stringify(pinned.english)]]);
        const remoteSources = new Map<string, string>();
        for (const language of languages) {
            if (language === 'en-US') continue;
            const text = readFileSync(resolve(languageDir, remote[language]), 'utf8');
            remoteSources.set(remote[language], text);
            incoming.set(language, JSON.parse(text)); originalInputs.set(language, JSON.stringify(incoming.get(language)));
        }
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_DATA__', pinned);
        // 确认旧embedded English优先；不得误走另一份压缩English。
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__', {'en-US': 'invalid-if-selected'});
        const values = new Map<string, unknown>(), requests: string[] = [];
        globalThis.GM = {
            async getValue(key, fallback) {return values.get(key) ?? fallback;},
            async setValue(key, value) {values.set(key, value);},
            xmlHttpRequest(details) {
                requests.push(details.url);
                const file = new URL(details.url).pathname.split('/').pop()!;
                const text = remoteSources.get(file);
                if (text === undefined) throw new Error('Unexpected language resource request');
                return Promise.resolve({status: 200, statusText: 'OK', responseText: text});
            },
        };
        const core = await import('@/src/core/i18n');
        const compression = await import('@/userscript/compression');
        const inflate = vi.spyOn(compression, 'inflateGzipBase64'); // 保留真实解压实现。
        const register = vi.spyOn(core, 'registerUiLanguageBundle');
        const loader = await import('@/userscript/uiLanguageBundles');
        const pending = languages.map(language => loader.ensureUiLanguageBundle(language));
        expect(loader.ensureUiLanguageBundle('fr-FR')).toBe(pending[languages.indexOf('fr-FR')]);
        expect(await Promise.all(pending)).toEqual(languages.map(() => true));
        expect(register).toHaveBeenCalledTimes(languages.length);
        for (const language of languages) {
            const call = register.mock.calls.find(([registered]) => registered === language);
            expect(call, language).toBeDefined();
            if (!call) throw new Error(`Missing language registration: ${language}`);
            assertOriginalBytes(language, call[1], incoming.get(language)!);
            expect(JSON.stringify(incoming.get(language)), language).toBe(originalInputs.get(language));
            expect(core.hasUiLanguageBundle(language)).toBe(true);
        }
        expect(inflate.mock.calls.filter(([value]) => value === supplement)).toHaveLength(1);
        expect(inflate).toHaveBeenCalledTimes(1);
        expect(requests).toHaveLength(5);
        for (const language of languages) {
            if (language === 'en-US') continue;
            expect(values.get(`fluentread:ui-language:${remote[language]}`)).toBe(originalInputs.get(language));
            expect(readFileSync(resolve(languageDir, remote[language]), 'utf8')).toBe(remoteSources.get(remote[language]));
        }
        // 新模块/新注册表重新读取同一旧GM缓存，补充仍不得写回缓存或触网。
        register.mockRestore(); inflate.mockRestore(); vi.resetModules();
        globalThis.GM.xmlHttpRequest = () => {throw new Error('offline cache must be sufficient');};
        const cachedCore = await import('@/src/core/i18n');
        const cachedCompression = await import('@/userscript/compression');
        const cachedInflate = vi.spyOn(cachedCompression, 'inflateGzipBase64');
        const cachedRegister = vi.spyOn(cachedCore, 'registerUiLanguageBundle');
        const cachedLoader = await import('@/userscript/uiLanguageBundles');
        await expect(cachedLoader.ensureUiLanguageBundle('fr-FR')).resolves.toBe(true);
        expect(cachedRegister).toHaveBeenCalledTimes(1);
        assertOriginalBytes('fr-FR', cachedRegister.mock.calls[0][1], incoming.get('fr-FR')!);
        expect(cachedInflate.mock.calls.filter(([value]) => value === supplement)).toHaveLength(1);
        expect(requests).toHaveLength(5);
        expect(values.get(`fluentread:ui-language:${remote['fr-FR']}`)).toBe(originalInputs.get('fr-FR'));
    });

    it('matches frozen39 bytes through real compressed English and real supplement inflation', async () => {
        const {supplement, compressed} = defineMacros();
        const incoming = JSON.parse(gunzipSync(Buffer.from(compressed['en-US'], 'base64')).toString('utf8')) as UiLanguageBundle;
        const requests: string[] = [];
        globalThis.GM = {xmlHttpRequest(details) {requests.push(details.url); throw new Error('unexpected request');}};
        const core = await import('@/src/core/i18n');
        const compression = await import('@/userscript/compression');
        const inflate = vi.spyOn(compression, 'inflateGzipBase64');
        const register = vi.spyOn(core, 'registerUiLanguageBundle');
        const loader = await import('@/userscript/uiLanguageBundles');
        await expect(loader.ensureUiLanguageBundle('en-US')).resolves.toBe(true);
        expect(register).toHaveBeenCalledTimes(1);
        assertOriginalBytes('en-US', register.mock.calls[0][1], incoming);
        expect(inflate.mock.calls.filter(([value]) => value === compressed['en-US'])).toHaveLength(1);
        expect(inflate.mock.calls.filter(([value]) => value === supplement)).toHaveLength(1);
        expect(inflate).toHaveBeenCalledTimes(2);
        await expect(loader.ensureUiLanguageBundle('en-US')).resolves.toBe(true);
        expect(register).toHaveBeenCalledTimes(1); expect(inflate).toHaveBeenCalledTimes(2);
        expect(requests).toEqual([]);
    });

    it('rejects real corrupt gzip without registration, retries inflation and recovers after valid macro repair', async () => {
        const {supplement} = defineMacros();
        const incoming = minimalEnglish();
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_DATA__', {english: incoming});
        const damaged = Buffer.from(supplement, 'base64');
        // 破坏实际gzip的CRC32 trailer，base64仍合法，必须由真实gzip读取拒绝。
        damaged[damaged.length - 8] = damaged[damaged.length - 8]! ^ 0xff;
        const corrupt = damaged.toString('base64');
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_SUPPLEMENTS__', corrupt);
        globalThis.GM = {xmlHttpRequest() {throw new Error('unexpected request');}};
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const core = await import('@/src/core/i18n');
        const compression = await import('@/userscript/compression');
        const inflate = vi.spyOn(compression, 'inflateGzipBase64');
        const register = vi.spyOn(core, 'registerUiLanguageBundle');
        const loader = await import('@/userscript/uiLanguageBundles');
        const first = loader.ensureUiLanguageBundle('en-US');
        expect(loader.ensureUiLanguageBundle('en-US')).toBe(first);
        await expect(first).resolves.toBe(false);
        expect(register).not.toHaveBeenCalled(); expect(core.hasUiLanguageBundle('en-US')).toBe(false);
        expect(inflate.mock.calls.filter(([value]) => value === corrupt)).toHaveLength(1);
        // 同一模块再次读坏输入也必须重新尝试，而非永久缓存被拒绝promise。
        await expect(loader.ensureUiLanguageBundle('en-US')).resolves.toBe(false);
        expect(register).not.toHaveBeenCalled(); expect(core.hasUiLanguageBundle('en-US')).toBe(false);
        expect(inflate.mock.calls.filter(([value]) => value === corrupt)).toHaveLength(2);
        // 仅测试夹具修复宏输入；产品宏没有运行时修复机制，此处不声称坏内容自行恢复。
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_SUPPLEMENTS__', supplement);
        await expect(loader.ensureUiLanguageBundle('en-US')).resolves.toBe(true);
        expect(register).toHaveBeenCalledTimes(1);
        assertOriginalBytes('en-US', register.mock.calls[0][1], incoming);
        expect(inflate.mock.calls.filter(([value]) => value === supplement)).toHaveLength(1);
        expect(inflate).toHaveBeenCalledTimes(3);
    });
});
