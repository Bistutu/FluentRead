import {describe, expect, it} from 'vitest';
import {createUserscriptMetadata} from '@/userscript/metadata';

describe('userscript metadata', () => {
    it('keeps the content-world GM contract required by Safari and classic managers', () => {
        const metadata = createUserscriptMetadata({version: '1.2.3'});

        expect(metadata.startsWith('// ==UserScript==\n')).toBe(true);
        expect(metadata).toContain('// @name         FluentRead-流畅阅读\n');
        expect(metadata).toContain('// @name:zh-CN   流畅阅读\n');
        expect(metadata).toContain('// @name:zh      流畅阅读\n');
        expect(metadata).toContain('// @name:en      FluentRead\n');
        for (const language of ['ja', 'ko', 'fr', 'ru', 'es']) {
            expect(metadata).toContain(`// @name:${language}      FluentRead\n`);
        }
        expect(metadata).toContain('// @namespace    https://fr.unmeta.cn/');
        expect(metadata).toContain('// @version      1.2.3');
        expect(metadata).toContain('// @grant        GM_xmlhttpRequest');
        expect(metadata).toContain('// @grant        GM_registerMenuCommand');
        expect(metadata).toContain('// @grant        GM.getValue');
        expect(metadata).toContain('// @grant        GM.setValue');
        expect(metadata).toContain('// @grant        GM.xmlHttpRequest');
        expect(metadata).toContain('// @connect      *');
        expect(metadata).toContain('// @match        http://*/*');
        expect(metadata).toContain('// @match        https://*/*');
        expect(metadata).toContain('// @run-at       document-start');
        expect(metadata).toContain('// @inject-into  content');
        expect(metadata).toContain('// @noframes');
        expect(metadata).not.toContain('@require');
    });
});
