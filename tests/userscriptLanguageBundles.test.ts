import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
// 脚本发布的语言资源不含智能高亮文案；摘要必须按脚本实际使用的投影计算。
import {UI_LANGUAGE_BUNDLES} from '../userscript/languageBundles';

const languageDir = resolve(process.cwd(), 'userscript/languages');
const digest = createHash('sha256').update(JSON.stringify(UI_LANGUAGE_BUNDLES['fr-FR'])).digest('hex').slice(0, 16);
const fileName = `fr-FR.${digest}.json`;
const source = readFileSync(resolve(languageDir, fileName), 'utf8');
const resourceCommit = '70d3d901033a579e32a5bf5e6af14555f0d140bb';

describe('userscript remote UI language data', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
        globalThis.GM = undefined;
    });

    it('registers the English bundle supplied by the pinned data resource without a network request', async () => {
        const requests: string[] = [];
        globalThis.GM = {
            xmlHttpRequest(details) { requests.push(details.url); throw new Error('unexpected request'); },
        };
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_DATA__', {english: UI_LANGUAGE_BUNDLES['en-US']});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__', {});
        vi.stubGlobal('__FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__', {});

        const {hasUiLanguageBundle} = await import('@/src/core/i18n');
        expect(hasUiLanguageBundle('en-US')).toBe(false);
        const loader = await import('@/userscript/uiLanguageBundles');
        await expect(loader.ensureUiLanguageBundle('en-US')).resolves.toBe(true);
        expect(hasUiLanguageBundle('en-US')).toBe(true);
        expect(requests).toEqual([]);
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
});
