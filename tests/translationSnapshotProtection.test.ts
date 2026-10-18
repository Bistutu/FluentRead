import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {afterEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/src/services/config/store', () => ({config: {style: 1, to: 'zh-Hans'}}));
vi.mock('@/src/core/config/catalog', () => ({options: {styles: []}}));
vi.mock('@/src/features/full-page-translation/content/layout', () => ({ensureTranslationTruncationLayout: vi.fn()}));

import {
    applyTranslationsToSnapshot,
    collectLiveTranslationTextSlots,
    createTranslationCore,
    createTranslationSourceSnapshot,
    extractTranslationText,
    type TranslationCandidateCore,
} from '@/src/core/translation/public';
import {appendBilingualTranslation} from '@/src/features/full-page-translation/content/renderer';
import {
    beginTranslation,
    getTranslationState,
    markTranslationComplete,
    restoreAllTranslations,
    restoreTranslation,
    setBilingualContent,
} from '@/src/features/full-page-translation/content/state';

function page(markup: string, computedColor?: (element: HTMLElement) => string) {
    const {document, window} = parseHTML(`<html><head><base href="https://example.org/article"></head><body><p id="owner">Read this explanation ${markup} with its linked details.</p></body></html>`);
    Object.defineProperty(window, 'getComputedStyle', {
        configurable: true,
        value: (element: HTMLElement) => ({
            display: element.style.display || 'inline',
            visibility: element.style.visibility || 'visible',
            fontFamily: 'Arial',
            color: computedColor?.(element) ?? element.style.color ?? '',
        }),
    });
    // linkedom 将 contenteditable=false 也报告为可编辑；补齐浏览器的原生语义。
    document.querySelectorAll('[contenteditable="false"]').forEach(element =>
        Object.defineProperty(element, 'isContentEditable', {value: false}));
    vi.stubGlobal('document', document);
    vi.stubGlobal('Node', window.Node);
    return {document, window, owner: document.querySelector<HTMLElement>('#owner')!};
}

afterEach(() => {
    restoreAllTranslations();
    vi.unstubAllGlobals();
});

/** 功能层使用真实快照、renderer 与状态恢复；仅译文供应结果采用确定性文本。 */
function commitBilingual(owner: HTMLElement, core = createTranslationCore()) {
    const sourceSlots = collectLiveTranslationTextSlots(owner, core.shouldStayOriginal);
    const attempt = beginTranslation(owner, 'bilingual', 'content', false,
        extractTranslationText(owner, core.shouldStayOriginal), sourceSlots.map(slot => slot.node))!;
    expect(attempt).not.toBeNull();
    const snapshot = createTranslationSourceSnapshot(owner, core.shouldStayOriginal,
        undefined, undefined, core.shouldOmitFromTranslation);
    const sources = snapshot.slots.map(slot => slot.source);
    const translations = sources.map(source => `译:${source}`);
    const html = applyTranslationsToSnapshot(snapshot, translations);
    expect(markTranslationComplete(owner, attempt.state, attempt.generation)).toBe(true);
    const wrapper = appendBilingualTranslation(owner, html, {sourceSkeleton: snapshot.clone});
    setBilingualContent(owner, wrapper, {sources, translations, targetLanguage: 'zh-Hans', style: 1});
    return {wrapper, sources, state: attempt.state};
}

describe('双语快照展示保护', () => {
    it.each([
        ['inline RGB', '<a href="https://example.org/guide" style="color:rgb(220, 38, 38)"><span>@steipete</span></a>', 'rgb(220, 38, 38)'],
        ['class', '<a href="https://example.org/guide" class="host-link"><span>@steipete</span></a>', 'rgb(31, 111, 235)'],
        ['inherited', '<span class="host-accent"><a href="https://example.org/guide"><span>@steipete</span></a></span>', 'rgb(22, 163, 74)'],
    ])('%s 链接按实时颜色保留嵌套文本，两轮翻译与恢复均不修改宿主', (_kind, markup, color) => {
        let sourceLink: HTMLAnchorElement | undefined;
        const {owner} = page(markup, element => element === sourceLink ? color : '');
        sourceLink = owner.querySelector<HTMLAnchorElement>('a')!;
        const originalHTML = owner.innerHTML;
        const originalChildren = [...owner.childNodes];
        const originalLinkText = sourceLink.firstChild;
        for (let cycle = 0; cycle < 2; cycle += 1) {
            const {wrapper} = commitBilingual(owner);
            const translatedLink = wrapper.querySelector<HTMLAnchorElement>('a')!;
            expect(translatedLink.style.color).toBe(color);
            expect(translatedLink.querySelector('span')?.textContent).toBe('@steipete');
            expect(translatedLink.getAttribute('href')).toBe('https://example.org/guide');
            expect(translatedLink.hasAttribute('class')).toBe(false);
            expect(restoreTranslation(owner)).toBe(true);
            expect(owner.innerHTML).toBe(originalHTML);
            expect([...owner.childNodes]).toEqual(originalChildren);
            expect(owner.querySelector('a')).toBe(sourceLink);
            expect(sourceLink.firstChild).toBe(originalLinkText);
        }
    });

    it.each(['unavailable', 'throws'] as const)('computed style %s 时保留来源链接的 inline color', (mode) => {
        const {owner, window} = page('<a href="https://example.org/guide" style="color:rgb(220, 38, 38)">@steipete</a>');
        Object.defineProperty(window, 'getComputedStyle', {
            configurable: true,
            value: mode === 'unavailable' ? undefined : () => {throw new Error('Style unavailable');},
        });
        const {wrapper} = commitBilingual(owner);
        expect(wrapper.querySelector<HTMLAnchorElement>('a')?.style.color).toBe('rgb(220, 38, 38)');
        expect(restoreTranslation(owner)).toBe(true);
    });

    it.each([true, false])('仅本地骨架放行链接 color，sourceSkeleton=%s 仍拒绝其他样式、class、事件和危险链接', (sourceSkeleton) => {
        const markup = '<a href="https://example.org/guide" title="Guide" class="host-link" onclick="alert(1)" ' +
            'style="color:rgb(220, 38, 38);background:red;position:fixed"><span class="host-text" style="color:blue">@steipete</span></a> ' +
            '<a href="javascript:alert(1)" style="color:rgb(220, 38, 38)">@unsafe</a>';
        const {owner} = page(markup);
        vi.stubGlobal('DOMParser', class FixtureDOMParser {
            parseFromString(source: string) {
                return parseHTML(`<html><body>${source}</body></html>`).document;
            }
        });
        const snapshot = createTranslationSourceSnapshot(owner);
        const html = applyTranslationsToSnapshot(snapshot, snapshot.slots.map(slot => `译:${slot.source}`));
        const wrapper = appendBilingualTranslation(owner, sourceSkeleton ? html : markup,
            sourceSkeleton ? {sourceSkeleton: snapshot.clone} : {});
        const [safeLink, unsafeLink] = [...wrapper.querySelectorAll<HTMLAnchorElement>('a')];
        expect(safeLink!.getAttribute('href')).toBe('https://example.org/guide');
        expect(safeLink!.getAttribute('title')).toBe('Guide');
        expect(safeLink!.style.color || '').toBe(sourceSkeleton ? 'rgb(220, 38, 38)' : '');
        expect(safeLink!.style.background || '').toBe('');
        expect(safeLink!.style.position || '').toBe('');
        expect(wrapper.querySelector('[class], [onclick]')).toBeNull();
        expect(safeLink!.querySelector('span')?.hasAttribute('style')).toBe(false);
        expect(unsafeLink!.hasAttribute('href')).toBe(false);
    });

    it.each([
        '<span hidden>EXCLUDED_SOURCE</span>',
        '<span inert>EXCLUDED_SOURCE</span>',
        '<span aria-hidden="true">EXCLUDED_SOURCE</span>',
        '<span class="sr-only">EXCLUDED_SOURCE</span>',
        '<span class="visually-hidden">EXCLUDED_SOURCE</span>',
        '<span style="display:none">EXCLUDED_SOURCE</span>',
        '<span style="visibility:hidden">EXCLUDED_SOURCE</span>',
        '<span style="visibility:collapse">EXCLUDED_SOURCE</span>',
        '<span translate="no" hidden>EXCLUDED_SOURCE</span>',
        '<span contenteditable="true">EXCLUDED_SOURCE</span>',
        '<span contenteditable="plaintext-only">EXCLUDED_SOURCE</span>',
        '<span contenteditable>EXCLUDED_SOURCE</span>',
        '<span translate="no" contenteditable="true">EXCLUDED_SOURCE</span>',
        '<textarea>EXCLUDED_SOURCE</textarea>',
        '<select><option>EXCLUDED_SOURCE</option></select>',
        '<canvas>EXCLUDED_SOURCE</canvas>',
        '<video>EXCLUDED_SOURCE</video>',
        '<svg><text>EXCLUDED_SOURCE</text></svg>',
        '<noscript>EXCLUDED_SOURCE</noscript>',
    ])('省略 %s 的双语副本，保留原节点与恢复后的结构', (markup) => {
        const {owner} = page(markup);
        const originalHTML = owner.innerHTML;
        const originalChildren = Array.from(owner.childNodes);
        for (let cycle = 0; cycle < 2; cycle += 1) {
            const snapshot = createTranslationSourceSnapshot(owner);
            expect(snapshot.slots.map(slot => slot.source).join(' ')).not.toContain('EXCLUDED_SOURCE');
            const html = applyTranslationsToSnapshot(snapshot, snapshot.slots.map(slot => `译:${slot.source}`));
            const wrapper = appendBilingualTranslation(owner, html, {sourceSkeleton: snapshot.clone});
            expect(wrapper.textContent).toContain('译:Read this explanation');
            expect(wrapper.textContent).not.toContain('EXCLUDED_SOURCE');
            wrapper.remove();
            expect(owner.innerHTML).toBe(originalHTML);
            expect(Array.from(owner.childNodes)).toEqual(originalChildren);
        }
    });

    it('保留可见代码、禁译术语、contenteditable=false 和安全链接，不在宿主上复制事件', () => {
        const {owner} = page('<code>npm install</code> <span translate="no">OpenAI</span> <span contenteditable="false">A readable note</span> <a href="https://example.org/guide">the guide</a>');
        const anchor = owner.querySelector('a')!;
        const clicked = vi.fn();
        anchor.addEventListener('click', clicked);
        const snapshot = createTranslationSourceSnapshot(owner);
        expect(snapshot.slots.map(slot => slot.source)).toContain('A readable note');
        expect(snapshot.slots.map(slot => slot.source)).not.toContain('npm install');
        expect(snapshot.slots.map(slot => slot.source)).not.toContain('OpenAI');
        const html = applyTranslationsToSnapshot(snapshot, snapshot.slots.map(slot => `译:${slot.source}`));
        const wrapper = appendBilingualTranslation(owner, html, {sourceSkeleton: snapshot.clone});
        expect(wrapper.querySelector('code')?.textContent).toBe('npm install');
        expect(wrapper.textContent).toContain('OpenAI');
        expect(wrapper.textContent).toContain('译:A readable note');
        expect(wrapper.querySelector('a')?.getAttribute('href')).toBe('https://example.org/guide');
        wrapper.remove();
        expect(owner.querySelector('a')).toBe(anchor);
        anchor.dispatchEvent(new owner.ownerDocument.defaultView!.Event('click'));
        expect(clicked).toHaveBeenCalledOnce();
    });

    it('只翻译可读链接标题与周围正文，纯网址和域名保持原链接', () => {
        const {owner} = page('<a href="http://www.tubesnow.com/">http://www.tubesnow.com/</a> <a href="https://pub.dev/publishers/dash-overflow.net">dash-overflow.net</a> <a href="/guide">the guide</a>');
        const originalLinks = [...owner.querySelectorAll('a')];
        const snapshot = createTranslationSourceSnapshot(owner);
        const sources = snapshot.slots.map(slot => slot.source);
        expect(sources).toContain('Read this explanation');
        expect(sources).toContain('the guide');
        expect(sources).not.toContain('http://www.tubesnow.com/');
        expect(sources).not.toContain('dash-overflow.net');
        expect(collectLiveTranslationTextSlots(owner).map(slot => slot.source)).toEqual(sources);

        const html = applyTranslationsToSnapshot(snapshot, sources.map(source => `译:${source}`));
        const wrapper = appendBilingualTranslation(owner, html, {sourceSkeleton: snapshot.clone});
        expect([...wrapper.querySelectorAll('a')].map(link => link.textContent)).toEqual([
            'http://www.tubesnow.com/', 'dash-overflow.net', '译:the guide',
        ]);
        wrapper.remove();
        expect([...owner.querySelectorAll('a')]).toEqual(originalLinks);
    });

    it('依据实时隐藏状态重建副本，不因禁译祖先或已克隆的属性丢失漏出文字', () => {
        const {owner} = page('<span translate="no"><span id="changing">CURRENT_LITERAL</span></span>');
        const changing = owner.querySelector<HTMLElement>('#changing')!;
        expect(createTranslationSourceSnapshot(owner).clone.textContent).toContain('CURRENT_LITERAL');
        changing.hidden = true;
        expect(createTranslationSourceSnapshot(owner).clone.textContent).not.toContain('CURRENT_LITERAL');
        changing.hidden = false;
        expect(createTranslationSourceSnapshot(owner).clone.textContent).toContain('CURRENT_LITERAL');
    });

    it('可见公式保留 aria-hidden 排版子树，隐藏公式整体省略且辅助公式只保留一份', () => {
        const {owner} = page('<span class="katex"><span class="katex-mathml"><math><mi>x</mi></math></span><span class="katex-html" aria-hidden="true"><span>x</span></span></span> <span class="MathJax"><nobr aria-hidden="true">y</nobr><span class="MJX_Assistive_MathML"><math><mi>y</mi></math></span></span> <span class="katex" hidden><span class="katex-html">HIDDEN_FORMULA</span></span> <math><mi>z</mi></math>');
        const snapshot = createTranslationSourceSnapshot(owner);
        const html = applyTranslationsToSnapshot(snapshot, snapshot.slots.map(slot => `译:${slot.source}`));
        const wrapper = appendBilingualTranslation(owner, html, {sourceSkeleton: snapshot.clone});
        expect(wrapper.querySelector('.katex')?.textContent).toBe('x');
        expect(wrapper.querySelector('.MathJax')?.textContent).toBe('y');
        expect(wrapper.querySelector('math')?.textContent).toBe('z');
        expect(wrapper.querySelectorAll('.katex')).toHaveLength(1);
        expect(wrapper.querySelector('.katex-mathml, .MJX_Assistive_MathML')).toBeNull();
        expect(wrapper.textContent).not.toContain('HIDDEN_FORMULA');
    });

    it('隐藏文字显示再隐藏后，三轮最终译文与恢复均采用当前可见内容且工件唯一', () => {
        const {owner} = page('<span id="changing" hidden>Revealed explanatory details</span>');
        const changing = owner.querySelector<HTMLElement>('#changing')!;
        const sourceNode = changing.firstChild;
        for (const hidden of [true, false, true]) {
            changing.hidden = hidden;
            const currentSourceHTML = owner.innerHTML;
            const result = commitBilingual(owner);
            expect(result.sources.includes('Revealed explanatory details')).toBe(!hidden);
            expect(result.wrapper.textContent?.includes('译:Revealed explanatory details')).toBe(!hidden);
            expect(owner.querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(1);
            expect(restoreTranslation(owner)).toBe(true);
            expect(result.state.controller.signal.aborted).toBe(true);
            expect(getTranslationState(owner)).toBeUndefined();
            expect(owner.innerHTML).toBe(currentSourceHTML);
            expect(changing.firstChild).toBe(sourceNode);
            expect(owner.querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(0);
        }
    });

    it('只读表单值不进入双语副本，翻译后宿主更新的值在真实恢复时仍保留', () => {
        const {owner} = page('<textarea readonly>PRIVATE_READONLY_DRAFT</textarea><input readonly value="PRIVATE_READONLY_VALUE">');
        const textarea = owner.querySelector('textarea')!;
        const input = owner.querySelector('input')!;
        const result = commitBilingual(owner);
        expect(result.sources.join(' ')).not.toMatch(/PRIVATE_READONLY/u);
        expect(result.wrapper.textContent).not.toMatch(/PRIVATE_READONLY/u);
        expect(result.wrapper.querySelector('textarea,input')).toBeNull();
        textarea.value = 'HOST_UPDATED_DRAFT';
        input.value = 'HOST_UPDATED_VALUE';
        expect(restoreTranslation(owner)).toBe(true);
        expect(owner.querySelector('textarea')).toBe(textarea);
        expect(owner.querySelector('input')).toBe(input);
        expect(textarea.value).toBe('HOST_UPDATED_DRAFT');
        expect(input.value).toBe('HOST_UPDATED_VALUE');
        expect(owner.querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(0);
    });

    it('SSR列表翻译后被hydrate替换，恢复不复活旧DOM，新任务行各自渲染并可恢复重译', () => {
        const {document} = page('');
        const href = 'https://github.com/kohya-ss/musubi-tuner/issues/1029';
        vi.stubGlobal('location', {href});
        document.body.innerHTML = '<main class="markdown-body"><ul id="list"><li>First server task.</li><li>Second server task.</li></ul></main>';
        const list = document.querySelector<HTMLElement>('#list')!;
        const core: TranslationCandidateCore = createTranslationCore({url: new URL(href)});
        const oldOwners = core.discover(list).map(candidate => candidate.element);
        expect(oldOwners).toHaveLength(2);
        oldOwners.forEach(owner => commitBilingual(owner, core));
        const fixture = parseHTML(readFileSync(new URL('./fixtures/translation-pages/github-task-list.html', import.meta.url), 'utf8')).document;
        list.innerHTML = fixture.querySelector('[data-testid="task-list"]')!.innerHTML;
        const hydratedHTML = list.innerHTML;
        const checkboxes = Array.from(list.querySelectorAll('input'));
        restoreAllTranslations();
        expect(list.innerHTML).toBe(hydratedHTML);
        expect(oldOwners.every(owner => !owner.isConnected && getTranslationState(owner) === undefined)).toBe(true);
        for (let cycle = 0; cycle < 2; cycle += 1) {
            const owners = core.discover(list).map(candidate => candidate.element);
            expect(owners.map(owner => owner.getAttribute('data-testid'))).toEqual([
                'task-content-0', 'task-content-1', 'task-content-2',
            ]);
            owners.forEach(owner => commitBilingual(owner, core));
            const wrappers = Array.from(list.querySelectorAll('.fluent-read-bilingual-content'));
            expect(wrappers).toHaveLength(3);
            expect(wrappers.map(wrapper => wrapper.parentElement)).toEqual(owners);
            expect(wrappers.every(wrapper => wrapper.textContent?.includes('译:'))).toBe(true);
            expect(list.querySelector('.fluent-read-bilingual-content .fluent-read-bilingual-content')).toBeNull();
            expect(list.querySelector('[data-testid="task-group"] > .fluent-read-bilingual-content')).toBeNull();
            restoreAllTranslations();
            expect(list.innerHTML).toBe(hydratedHTML);
            expect(Array.from(list.querySelectorAll('input'))).toEqual(checkboxes);
        }
    });
});
