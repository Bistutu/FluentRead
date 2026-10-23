import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {describe, expect, it} from 'vitest';
import {UI_LANGUAGE_OPTIONS} from '@/src/core/i18n/language';
import {createExtensionMetadataLocaleFiles} from '@/src/core/i18n/bundles';
import productDescriptions from '@/src/core/i18n/messages/product-descriptions.json';
import brandTaglines from '@/src/core/i18n/messages/brand-taglines.json';
import {createUserscriptMetadata} from '@/userscript/metadata';

const root = resolve(__dirname, '..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');
const metadataManifest = {name: '__MSG_extensionName__', description: '__MSG_extensionDescription__', default_locale: 'en'};

async function metadataVerifier() {
    return import(/* @vite-ignore */ pathToFileURL(resolve(root, 'scripts/testing/verify-extension-manifests.mjs')).href) as Promise<{
        verifyLocalizedExtensionMetadata(directory: string, manifest: Record<string, string>): Promise<string[]>;
    }>;
}

function createMetadataFixture() {
    const directory = mkdtempSync(resolve(tmpdir(), 'fluentread-i18n-metadata-'));
    for (const {relativeDest, contents} of createExtensionMetadataLocaleFiles()) {
        const file = resolve(directory, relativeDest);
        mkdirSync(dirname(file), {recursive: true});
        writeFileSync(file, contents);
    }
    return directory;
}

describe('localized installation and publication descriptions', () => {
    it('uses one seven-language functional catalog with a native manifest length budget', () => {
        expect(Object.keys(productDescriptions).sort()).toEqual(UI_LANGUAGE_OPTIONS.map(({value}) => value).sort());
        for (const [language, description] of Object.entries(productDescriptions)) {
            expect(description).toBe(description.trim());
            expect(description.length).toBeGreaterThan(20);
            expect(description.length).toBeLessThanOrEqual(132);
            expect(description).not.toMatch(/[\r\n]|__MSG_|\{\w+\}/u);
            expect(description).not.toBe(brandTaglines[language as keyof typeof brandTaglines]);
        }
    });

    it('keeps userscript installation identity while providing localized functional descriptions', () => {
        const metadata = createUserscriptMetadata({version: '2.0.2'});
        expect(metadata).toContain('// @name         FluentRead-流畅阅读\n');
        expect(metadata).toContain('// @namespace    https://fr.unmeta.cn/\n');
        expect(metadata).toContain(`// @description  ${productDescriptions['en-US']}\n`);
        expect(metadata).toContain(`// @description:zh ${productDescriptions['zh-CN']}\n`);
        for (const [language, description] of Object.entries(productDescriptions)) {
            const locale = language === 'zh-CN' ? language : language.split('-')[0];
            expect(metadata).toContain(`// @description:${locale} ${description}\n`);
        }
        const directives = metadata.match(/^\/\/ @description(?::[^ ]+)? /gmu);
        expect(directives).toHaveLength(UI_LANGUAGE_OPTIONS.length + 2);
    });

    it('keeps English and Chinese store short descriptions in the listing language', () => {
        expect(JSON.parse(read('package.json')).description).toBe(productDescriptions['en-US']);
        for (const [locale, language] of [['en', 'en-US'], ['zh-CN', 'zh-CN']] as const) {
            const folder = `marketing/chrome-web-store/${locale}`;
            const short = read(`${folder}/short-description.txt`).trim();
            expect(short).toBe(productDescriptions[language]);
            expect(JSON.parse(read(`${folder}/listing.json`)).shortDescription).toBe(short);
            expect(read(`${folder}/description.txt`).startsWith(`${brandTaglines[language]}\n\n`)).toBe(true);
        }
        expect(read('marketing/chrome-web-store/en/short-description.txt')).not.toMatch(/[\u3400-\u9fff]/u);
    });

    it('accepts generated locale artifacts and rejects unlocalized manifest fields', async () => {
        const directory = createMetadataFixture();
        try {
            const {verifyLocalizedExtensionMetadata} = await metadataVerifier();
            expect(await verifyLocalizedExtensionMetadata(directory, metadataManifest)).toEqual(['en', 'es', 'fr', 'ja', 'ko', 'ru', 'zh_CN']);
            await expect(verifyLocalizedExtensionMetadata(directory, {...metadataManifest, description: productDescriptions['en-US']})).rejects.toThrow('浏览器本地化');
            await expect(verifyLocalizedExtensionMetadata(directory, {...metadataManifest, default_locale: 'zh_CN'})).rejects.toThrow('英文默认语言');
        } finally {rmSync(directory, {recursive: true, force: true});}
    });

    it('rejects missing languages, missing names and descriptions that drift from the reviewed source', async () => {
        const directory = createMetadataFixture();
        try {
            const {verifyLocalizedExtensionMetadata} = await metadataVerifier();
            const japaneseFile = resolve(directory, '_locales/ja/messages.json');
            writeFileSync(japaneseFile, JSON.stringify({extensionDescription: {message: productDescriptions['ja-JP']}}));
            await expect(verifyLocalizedExtensionMetadata(directory, metadataManifest)).rejects.toThrow('缺少本地化扩展名称');
            writeFileSync(japaneseFile, JSON.stringify({extensionName: {message: 'FluentRead'}, extensionDescription: {message: 'Old slogan'}}));
            await expect(verifyLocalizedExtensionMetadata(directory, metadataManifest)).rejects.toThrow('扩展说明缺失、漂移');
            rmSync(resolve(directory, '_locales/ja'), {recursive: true});
            await expect(verifyLocalizedExtensionMetadata(directory, metadataManifest)).rejects.toThrow('语言集合');
        } finally {rmSync(directory, {recursive: true, force: true});}
    });
});
