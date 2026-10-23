/**
 * @file tests/bilingualRemountPerformanceBoundaries.test.ts
 * 文件职责：验证批量重挂优化没有扩大候选权限、跨写入复用保护结果或破坏同步来源/译文身份。
 * 主要内容：500 段正文的共享祖先读取预算与全部范围叶节点的重复分段工作预算、文档表面例外、外壳与站点目标隔离、隐藏/可编辑/保留原文边界、
 * 惰性布局字段失效和同步提交后的精确原文/工件位置，以及准备之后的来源篡改拒绝。
 * 模块边界：执行真实候选与重挂端口；只替代缺失的布局 API，不替换保护算法、不发请求、
 * 不启动浏览器；操作预算是确定性单元证据，不代表原生长任务或首帧耗时。
 */
import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {createTranslationLayoutMeasurements, maxComposedAncestorDepth} from '@/src/core/translation/public';
import {createTranslationCore} from './helpers/translationCore';
import {createBilingualRemountPreparationBatch, transferEquivalentBilingualOwners} from '@/src/features/full-page-translation/content/bilingualRemount';
import {beginTranslation, getTranslationState, markTranslationComplete, restoreAllTranslations,
    restoreTranslation, setBilingualContent} from '@/src/features/full-page-translation/content/state';

afterEach(() => { restoreAllTranslations(); vi.restoreAllMocks(); });

const source = (index: number) => `A readable paragraph number ${index} keeps its original source nodes and committed translation.`;
const layoutStyle = (overrides: object = {}) => ({display: 'block', visibility: 'visible',
    position: 'static', transform: 'none', fontFamily: 'sans-serif', overflow: 'visible',
    overflowY: 'visible', height: 'auto', maxHeight: 'none', webkitLineClamp: 'none',
    getPropertyValue: () => '', ...overrides});

function childList(target: Node, added: Node[], removed: Node[]): MutationRecord {
    return {type: 'childList', target, addedNodes: added as unknown as NodeList,
        removedNodes: removed as unknown as NodeList} as MutationRecord;
}

function committedFixture(count: number, before: boolean) {
    const {document} = parseHTML('<html><body><main></main></body></html>');
    const main = document.querySelector('main')!;
    const previousOwners: HTMLElement[] = [];
    const outputs: string[] = [];
    for (let index = 0; index < count; index++) {
        const owner = document.createElement('p');
        owner.textContent = source(index);
        main.appendChild(owner);
        const attempt = beginTranslation(owner, 'bilingual', 'content', false, source(index),
            [owner.firstChild as Text])!;
        expect(markTranslationComplete(owner, attempt.state, attempt.generation)).toBe(true);
        const content = document.createElement('span');
        content.className = 'fluent-read-bilingual-content';
        content.setAttribute('data-fr-translation-owned', 'true');
        content.setAttribute('translate', 'no');
        content.textContent = `已提交译文 ${index}。`;
        if (before) owner.insertBefore(content, owner.firstChild);
        else owner.appendChild(content);
        setBilingualContent(owner, content);
        previousOwners.push(owner);
        outputs.push(content.outerHTML);
    }
    const replacements = previousOwners.map((owner) => {
        const next = document.createElement('p');
        next.innerHTML = getTranslationState(owner)!.sourceHTML;
        return next;
    });
    main.replaceChildren(...replacements);
    return {document, main, previousOwners, replacements, outputs};
}

describe('批量重挂性能优化的保护边界', () => {
    it('500 段全部范围叶节点不重复探测内联分段，候选仍复验原文和保护', () => {
        const {document} = parseHTML('<html><head></head><body><main>' +
            Array.from({length: 500}, (_, index) => `<section><p>${source(index)}</p></section>`).join('') +
            '</main></body></html>');
        // 与原版 responsiveness CLI 一致：本地 HTTP 页面、默认 registry、全部范围。
        const core = createTranslationCore({url: new URL('http://127.0.0.1:43123/'), scope: 'all'});
        expect(core.adapters).toEqual([]);
        const stayOriginal = vi.spyOn(core, 'shouldStayOriginal');
        const owners = Array.from(document.querySelectorAll('p'));
        const html = document.documentElement.outerHTML;
        const resolve = core.createSynchronousResolver();
        owners.forEach(owner => {
            expect(resolve(owner)).toMatchObject({element: owner, kind: 'content', scope: 'all'});
        });
        const ownerSet = new Set<Element>(owners);
        expect(stayOriginal.mock.calls.filter(([element]) => ownerSet.has(element)).length).toBe(1000);
        expect(document.documentElement.outerHTML).toBe(html);
        owners[0]!.setAttribute('translate', 'no');
        owners[1]!.hidden = true;
        owners[2]!.setAttribute('contenteditable', 'true');
        owners[3]!.textContent = '12345';
        owners[4]!.textContent = '';
        const fresh = core.createSynchronousResolver();
        for (const owner of owners.slice(0, 5)) expect(fresh(owner)).toBeNull();
    });

    it('全部范围的文档表面只有直接 Text 时仍产出原来的内联 run', () => {
        const {document} = parseHTML('<html><body>Direct document text remains a readable inline source.</body></html>');
        const core = createTranslationCore({adapters: [], scope: 'all'});
        const text = document.body.firstChild as Text;
        const candidate = core.createSynchronousResolver()(text);
        expect(candidate?.element).toBe(document.body);
        expect(candidate?.nodes).toEqual([text]);
        expect(candidate?.reason).toBe('generic-inline-run');
        expect(text.parentNode).toBe(document.body);
        expect(core.createSynchronousResolver()(document.body)).toEqual(core.resolve(document.body));
    });

    it('仍按元素屏障拆分混合内容，行内 span 与 br 不会被叶节点分支误排除', () => {
        const {document} = parseHTML('<html><body><main><div id="mixed">Before readable text.<p>Independent paragraph.</p>After readable text.</div>' +
            '<p id="inline">A readable <span>inline phrase</span><br> continues in the same source.</p></main></body></html>');
        const core = createTranslationCore({adapters: [], scope: 'all'});
        const mixed = document.getElementById('mixed')!;
        const inline = document.getElementById('inline')!;
        const resolve = core.createSynchronousResolver();
        const before = resolve(mixed.firstChild!);
        const after = resolve(mixed.lastChild!);
        expect(before?.element).toBe(mixed);
        expect(before?.nodes).toEqual([mixed.firstChild]);
        expect(after?.element).toBe(mixed);
        expect(after?.nodes).toEqual([mixed.lastChild]);
        expect(resolve(inline)?.element).toBe(inline);
        expect(resolve(inline)).toEqual(core.resolve(inline));
    });

    it('500 段通用正文解析共享祖先保护，保持逐项解析的候选及 DOM 原样', () => {
        const {document, window} = parseHTML('<html><body><main>' +
            Array.from({length: 500}, (_, index) => `<section><p>${source(index)}</p></section>`).join('') +
            '</main></body></html>');
        const main = document.querySelector('main')!;
        const owners = Array.from(document.querySelectorAll('p'));
        let mainReads = 0;
        Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: (element: Element) => {
            if (element === main) mainReads++;
            return layoutStyle();
        }});
        const core = createTranslationCore({adapters: [], scope: 'content'});
        owners.forEach(owner => expect(core.resolve(owner)?.element).toBe(owner));
        expect(mainReads).toBeGreaterThanOrEqual(500);
        mainReads = 0;
        const html = document.documentElement.outerHTML;
        const resolve = core.createSynchronousResolver();
        owners.forEach(owner => {
            const candidate = resolve(owner);
            expect(candidate?.element).toBe(owner);
            expect(candidate?.kind).toBe('content');
            expect(candidate?.allowTopLevelApplicationShell).toBeUndefined();
        });
        expect(mainReads).toBeLessThanOrEqual(2);
        expect(document.documentElement.outerHTML).toBe(html);
    });

    it('共享祖先不放行隐藏、可编辑、局部 no-translate 或外来译文子树', () => {
        const {document, window} = parseHTML('<html><body><main>' +
            '<section><p id="plain">Readable ordinary text.</p></section>' +
            '<section><p id="css">Hidden through computed style.</p></section>' +
            '<section hidden><p id="hidden">Hidden ancestor source.</p></section>' +
            '<section contenteditable="true"><p id="editor">Editable source.</p></section>' +
            '<section translate="no"><p id="protected">Protected source.</p></section>' +
            '<section><span class="immersive-translate-target-wrapper">Foreign translation.</span><p id="foreign">Foreign-owned source.</p></section>' +
            '<section><code id="code">Protected code source.</code></section>' +
            '</main></body></html>');
        Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: (element: HTMLElement) =>
            layoutStyle({display: element.id === 'css' ? 'none' : 'block'})});
        const core = createTranslationCore({adapters: []});
        const resolve = core.createSynchronousResolver();
        const plain = document.getElementById('plain')!;
        expect(resolve(plain)?.element).toBe(plain);
        for (const id of ['css', 'hidden', 'editor', 'protected', 'foreign', 'code']) {
            const owner = document.getElementById(id)!;
            expect(core.resolve(owner)).toBeNull();
            expect(resolve(owner)).toBeNull();
        }
        expect(resolve(plain)?.element).toBe(plain);
    });

    it('应用外壳的显式命中权限不会泄漏到普通正文或同一外壳自身', () => {
        const {document} = parseHTML('<html><body>' +
            '<main><p id="plain">Ordinary paragraph outside an application shell.</p></main>' +
            '<div translate="no" id="shell"><p id="inside">Explicitly selected application paragraph.</p></div>' +
            '</body></html>');
        const core = createTranslationCore({adapters: []});
        const plain = document.getElementById('plain')!;
        const inside = document.getElementById('inside')!;
        const shell = document.getElementById('shell')!;
        const resolve = core.createSynchronousResolver();
        for (const owner of [plain, inside, shell, plain, inside, shell]) {
            expect(resolve(owner)).toEqual(core.resolve(owner));
        }
        expect(resolve(inside)?.allowTopLevelApplicationShell).toBe(true);
        expect(resolve(shell)).toBeNull();
        expect(resolve(plain)?.allowTopLevelApplicationShell).toBeUndefined();
    });

    it('站点适配器指向不同外壳时仍独立复验显式目标', () => {
        const {document} = parseHTML('<html><body>' +
            '<main><p id="hit">This hit is redirected by a site rule.</p></main>' +
            '<div translate="no" id="shell"><p id="target">The actual target is inside a shell.</p></div>' +
            '</body></html>');
        const hit = document.getElementById('hit')!;
        const target = document.getElementById('target')!;
        const shell = document.getElementById('shell')!;
        const core = createTranslationCore({adapters: [{id: 'redirect', matches: () => true,
            decide: element => element === hit
                ? {kind: 'force-target', target, candidateKind: 'content', reason: 'site-target'}
                : {kind: 'pass'}}]});
        const resolve = core.createSynchronousResolver();
        expect(resolve(hit)).toEqual(core.resolve(hit));
        expect(resolve(hit)?.element).toBe(target);
        expect(resolve(hit)?.allowTopLevelApplicationShell).toBe(true);
        expect(resolve(shell)).toEqual(core.resolve(shell));
    });

    it('通过 ShadowRoot 的 composed 外壳权限仍独立，超深祖先不会借共享结果放行', () => {
        const {document} = parseHTML('<html><body><main><p>Ordinary source outside shadow content.</p></main>' +
            '<div id="shell" translate="no"></div></body></html>');
        const core = createTranslationCore({adapters: []});
        const plain = document.querySelector('p')!;
        const shadow = document.getElementById('shell')!.attachShadow({mode: 'open'});
        const shadowOwner = document.createElement('p');
        shadowOwner.textContent = 'Explicit source inside a shadow application shell.';
        shadow.appendChild(shadowOwner);
        const resolve = core.createSynchronousResolver();
        expect(resolve(plain)?.element).toBe(plain);
        expect(resolve(shadowOwner)).toEqual(core.resolve(shadowOwner));
        expect(resolve(shadowOwner)?.allowTopLevelApplicationShell).toBe(true);
        expect(resolve(plain)?.allowTopLevelApplicationShell).toBeUndefined();
        let parent: HTMLElement = document.querySelector('main')!;
        for (let depth = 0; depth < maxComposedAncestorDepth + 2; depth++) {
            const next = document.createElement('section');
            parent.appendChild(next);
            parent = next;
        }
        const deepOwner = document.createElement('p');
        deepOwner.textContent = source(0);
        parent.appendChild(deepOwner);
        // 宿主已写 DOM，重新创建只读批次；先缓存正常祖先，再检查恶意深树。
        const fresh = core.createSynchronousResolver();
        expect(fresh(plain)?.element).toBe(plain);
        expect(fresh(deepOwner)).toBeNull();
        expect(core.resolve(deepOwner)).toBeNull();
    });

    it('新同步批次重新读取祖先隐藏、局部保护与 owner 原文', () => {
        const {document, window} = parseHTML('<html><body><main><section><p>Readable original source.</p></section></main></body></html>');
        const main = document.querySelector('main')!;
        const section = document.querySelector('section')!;
        const owner = document.querySelector('p')!;
        let hidden = false;
        Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: (element: Element) =>
            layoutStyle({display: hidden && element === main ? 'none' : 'block'})});
        const core = createTranslationCore({adapters: []});
        expect(core.createSynchronousResolver()(owner)?.element).toBe(owner);
        hidden = true;
        expect(core.createSynchronousResolver()(owner)).toBeNull();
        hidden = false;
        section.setAttribute('translate', 'no');
        expect(core.createSynchronousResolver()(owner)).toBeNull();
        section.removeAttribute('translate');
        owner.textContent = '12345';
        expect(core.createSynchronousResolver()(owner)).toBeNull();
        owner.textContent = 'A changed source is read in the new batch.';
        expect(core.createSynchronousResolver()(owner)?.element).toBe(owner);
    });

    it('布局字段保持惰性、冻结空值且显式失效后读取宿主最新值', () => {
        const {document, window} = parseHTML('<html><body><p>Source.</p></body></html>');
        const owner = document.querySelector('p')!;
        let position = '';
        let reads = 0;
        let heightReads = 0;
        const live = layoutStyle();
        Object.defineProperty(live, 'position', {get() { reads++; return position; }});
        Object.defineProperty(live, 'height', {get() { heightReads++; throw new Error('Unknown geometry'); }});
        Object.defineProperty(window, 'getComputedStyle', {configurable: true, value: () => live});
        const measurements = createTranslationLayoutMeasurements();
        const snapshot = measurements.style(owner)!;
        expect(reads).toBe(0);
        expect(heightReads).toBe(0);
        expect(snapshot.position).toBe('');
        position = 'fixed';
        expect(snapshot.position).toBe('');
        expect(reads).toBe(1);
        measurements.invalidate();
        expect(measurements.style(owner)?.position).toBe('fixed');
        expect(reads).toBe(2);
        expect(heightReads).toBe(0);
    });

    it.each([false, true])('500 段同步完整交接保留原 Text、结构、精确译文与位置 before=%s', (before) => {
        const fixture = committedFixture(500, before);
        const texts = fixture.replacements.map(owner => owner.firstChild as Text);
        const result = transferEquivalentBilingualOwners(
            childList(fixture.main, fixture.replacements, fixture.previousOwners),
            createBilingualRemountPreparationBatch());
        expect(result.transfers).toHaveLength(500);
        expect(result.capitulations).toEqual([]);
        fixture.replacements.forEach((owner, index) => {
            const state = getTranslationState(owner)!;
            expect(state.phase).toBe('translated');
            expect(state.sourceTextNodes?.[0]).toBe(texts[index]);
            expect(texts[index]!.parentNode).toBe(owner);
            expect(texts[index]!.data).toBe(source(index));
            expect(owner.querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(1);
            expect(owner.querySelectorAll('.fluent-read-bilingual-content .fluent-read-bilingual-content')).toHaveLength(0);
            expect(state.bilingualContent?.outerHTML).toBe(fixture.outputs[index]);
            expect(state.bilingualContent === owner.firstChild).toBe(before);
            expect(getTranslationState(fixture.previousOwners[index]!)).toBeUndefined();
            expect(restoreTranslation(owner)).toBe(true);
            expect(owner.childNodes.length).toBe(1);
            expect(owner.firstChild).toBe(texts[index]);
            expect(owner.innerHTML).toBe(source(index));
        });
    });

    it('prepare 后同步篡改来源结构仍在提交前拒绝，保留宿主新原文及节点结构', () => {
        const fixture = committedFixture(2, false);
        const prepare = createBilingualRemountPreparationBatch();
        const changed = fixture.replacements[0]!;
        const text = changed.firstChild as Text;
        const result = transferEquivalentBilingualOwners(
            childList(fixture.main, fixture.replacements, fixture.previousOwners),
            (previous, replacement, state) => {
                const preparation = prepare(previous, replacement, state);
                if (replacement === fixture.replacements[1]) {
                    const link = fixture.document.createElement('a');
                    link.href = '/host-link';
                    changed.replaceChild(link, text);
                    link.appendChild(text);
                }
                return preparation;
            });
        expect(result.transfers).toHaveLength(1);
        expect(result.transfers[0]!.replacementOwner).toBe(fixture.replacements[1]);
        expect(getTranslationState(changed)).toBeUndefined();
        expect(changed.querySelector('.fluent-read-bilingual-content')).toBeNull();
        expect(changed.querySelector('a')!.firstChild).toBe(text);
        expect(text.data).toBe(source(0));
        expect(changed.querySelector('a')!.getAttribute('href')).toBe('/host-link');
    });
});
