import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {saveRememberedSection, sectionRememberScopes} from '@/src/features/section-translation/content/save';
import type {SectionTranslationRule} from '@/src/core/config/sectionTranslationRules';

let document: Document;
beforeEach(() => {
    document = parseHTML('<html><body><article id="story"><p>Read this paragraph.</p></article><div id="second">Other region.</div></body></html>').document as unknown as Document;
});
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});
const rule = (id = 'saved'): SectionTranslationRule => ({id, enabled: true, site: 'example.com/docs/', selectors: [['[id="story"]']], mode: 'remind'});

describe('保存局部翻译区域', () => {
    it('默认作用域不包含查询和锚点，目录带边界，非网页不允许保存', () => {
        expect(sectionRememberScopes('https://example.com/docs/chapter?token=private#x')).toEqual({site: 'example.com', path: 'example.com/docs/'});
        expect(sectionRememberScopes('http://localhost:3100/docs/')).toEqual({site: 'localhost:3100', path: 'localhost:3100/docs/'});
        expect(sectionRememberScopes('https://example.com/')).toEqual({site: 'example.com', path: 'example.com'});
        expect(sectionRememberScopes('file:///docs/test.html')).toBeUndefined();
        expect(sectionRememberScopes('broken')).toBeUndefined();
        expect(sectionRememberScopes('https://com/')).toBeUndefined();
    });

    it('相同选区更新规则而非不断追加，并保留方案引用但不存正文', async () => {
        const rules = [rule()];
        const persist = vi.fn(async (_rules: SectionTranslationRule[]) => {});
        expect(await saveRememberedSection(document.querySelector('article')!, {site: 'EXAMPLE.com/docs', mode: 'auto'}, {
            rules: () => rules, profileId: 'my-section-profile', current: () => true, persist,
        })).toBe(true);
        expect(persist.mock.calls[0][0]).toEqual([{...rule(), mode: 'auto', profileId: 'my-section-profile'}]);
        expect(JSON.stringify(persist.mock.calls)).not.toContain('Read this');
    });

    it('全部选区必须能唯一定位，保存失败不能留下部分规则', async () => {
        const persist = vi.fn(async (_rules: SectionTranslationRule[]) => {});
        const ports = {rules: () => [], current: () => true, persist};
        await expect(saveRememberedSection([document.querySelector('article')!, document.body], {site: 'example.com', mode: 'auto'}, ports)).rejects.toMatchObject({reason: 'unsupported'});
        await expect(saveRememberedSection([], {site: 'example.com', mode: 'auto'}, ports)).rejects.toMatchObject({reason: 'unsupported'});
        await expect(saveRememberedSection(document.querySelector('article')!, {site: '*.com', mode: 'auto'}, ports)).rejects.toMatchObject({reason: 'unsupported'});
        expect(persist).not.toHaveBeenCalled();
    });

    it('新区域建立独立规则；达到上限仍可更新已有规则', async () => {
        let rules = Array.from({length: 100}, (_, i) => rule(`saved-${i}`));
        const persist = vi.fn(async (next: SectionTranslationRule[]) => { rules = next; });
        const ports = {rules: () => rules, current: () => true, persist};
        await expect(saveRememberedSection(document.querySelector('#second')!, {site: 'example.com', mode: 'auto'}, ports)).rejects.toMatchObject({reason: 'limit'});
        expect(await saveRememberedSection(document.querySelector('article')!, {site: 'example.com/docs/', mode: 'auto'}, ports)).toBe(true);
        rules = [];
        expect(await saveRememberedSection(document.querySelector('article')!, {site: 'example.com', mode: 'remind'}, ports)).toBe(true);
        expect(rules).toHaveLength(1);
        expect(rules[0].id).toMatch(/^section-/);
    });

    it('失效选择不提交；确认写入失败保留拒绝给选择器重试', async () => {
        const persist = vi.fn(async (_rules: SectionTranslationRule[]) => {});
        expect(await saveRememberedSection(document.querySelector('article')!, {site: 'example.com', mode: 'auto'}, {rules: () => [], current: () => false, persist})).toBe(false);
        const current = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
        expect(await saveRememberedSection(document.querySelector('article')!, {site: 'example.com', mode: 'auto'}, {rules: () => [], current, persist})).toBe(false);
        expect(persist).not.toHaveBeenCalled();
        const failed = vi.fn(async () => { throw new Error('storage unavailable'); });
        await expect(saveRememberedSection(document.querySelector('article')!, {site: 'example.com', mode: 'auto'}, {rules: () => [], current: () => true, persist: failed})).rejects.toThrow('storage unavailable');
    });

    it('非安全网页没有randomUUID也能保存，反向划选复用同一条规则', async () => {
        vi.stubGlobal('crypto', undefined);
        let rules: SectionTranslationRule[] = [];
        const persist = async (next: SectionTranslationRule[]): Promise<void> => {rules = next;};
        const ports = {rules: () => rules, current: () => true, persist};
        const first = document.querySelector('article')!, second = document.querySelector('#second')!;
        await saveRememberedSection([first, second], {site: 'example.com', mode: 'auto'}, ports);
        const id = rules[0].id;
        await saveRememberedSection([second, first, first], {site: 'example.com', mode: 'remind'}, ports);
        expect(rules).toHaveLength(1);
        expect(rules[0].id).toBe(id);
        expect(rules[0].mode).toBe('remind');
    });
});
