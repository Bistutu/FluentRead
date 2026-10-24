import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/src/services/config/store', () => ({config: {style: 1, to: 'zh-Hans'}}));
vi.mock('@/src/core/config/catalog', () => ({options: {styles: []}}));

import {getCurrentTranslationCore, TranslationCandidateCore, type TranslationCandidate} from '@/src/core/translation/public';
import {appendBilingualTranslation, materializeCandidate, refreshBilingualTranslation} from '@/src/features/full-page-translation/content/renderer';
import {beginTranslation, getTranslationState, markTranslationComplete, markTranslationError, resolveTranslationStateNode, restoreAllTranslations,
    restoreTranslation, setBilingualContent, setRenderedStyleAttribute} from '@/src/features/full-page-translation/content/state';
import {getCurrentTranslationStateSourceText, isTranslationArtifactCurrent} from '@/src/features/full-page-translation/content/translationStability';

function withRealm(html: string, callback: (document: Document) => void) {
    const {document} = parseHTML(`<html><head></head><body><main>${html}</main></body></html>`);
    const view = document.defaultView!;
    const bindings: Record<string, unknown> = {document, window: view, Node: view.Node, Element: view.Element,
        HTMLElement: view.HTMLElement, DOMParser: class {
            parseFromString(text: string) {return parseHTML(`<html><body>${text}</body></html>`).document;}
        }};
    const saved = new Map(Object.keys(bindings).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(bindings)) Object.defineProperty(globalThis, key, {configurable: true, value});
    const computedDescriptor = Object.getOwnPropertyDescriptor(view, 'getComputedStyle');
    const defaultDisplays: Record<string, string> = {LI: 'list-item', SPAN: 'inline', STRONG: 'inline'};
    const computedStyle = vi.fn((element: HTMLElement) => ({
        display: element.style.display || (defaultDisplays[element.tagName] ?? 'block'),
        getPropertyValue(property: string) {return element.style.getPropertyValue(property);},
    }));
    Object.defineProperty(view, 'getComputedStyle', {configurable: true, value: computedStyle});
    try {callback(document);} finally {
        restoreAllTranslations();
        if (computedDescriptor) Object.defineProperty(view, 'getComputedStyle', computedDescriptor);
        else Reflect.deleteProperty(view, 'getComputedStyle');
        for (const [key, descriptor] of saved) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
    }
}

function contentCandidate(source: HTMLElement, forced = false): TranslationCandidate {
    const core = forced ? new TranslationCandidateCore({adapters: [{id: 'forced-inline-layout', matches: () => true,
        decide: element => element === source ? {kind: 'force-target', candidateKind: 'content', reason: 'fixture-prose'} : {kind: 'pass'},
    }]}) : getCurrentTranslationCore();
    const full = core.discover(source.ownerDocument).find(item => item.element === source)!;
    expect(full?.kind).toBe('content');
    expect(full.nodes).toBeUndefined();
    expect(core.resolve(source.firstChild!)?.element).toBe(source);
    return full;
}

const layouts = ['flex', 'inline-flex', 'grid', 'inline-grid'];
describe('纯文本 flex/grid 双语译文共用原布局项', () => {
    it.each(layouts.flatMap(display => [false, true].map(before => ({display, before}))))(
        '实际候选物化后原译文仍属同一布局项、支持refresh并精确恢复：%j', ({display, before}) => {
            withRealm(`<div id="source" style="display:${display}">Read this source.<!--source anchor--> Keep all original words.</div>`, document => {
                const source = document.querySelector<HTMLElement>('#source')!;
                const originalHTML = source.innerHTML;
                const originalNodes = [...source.childNodes];
                const sourceText = source.textContent!;
                const candidate = contentCandidate(source, display.startsWith('inline-'));
                for (let round = 0; round < 2; round++) {
                    const result = materializeCandidate(candidate)!;
                    expect(result.synthetic).toBe(true);
                    expect(result.node).not.toBe(source);
                    expect(result.node.classList.contains('fluent-read-source-line')).toBe(true);
                    expect(source.childNodes).toHaveLength(1);
                    expect(source.firstChild).toBe(result.node);
                    expect([...result.node.childNodes]).toEqual(originalNodes);
                    // runtime 为所有 synthetic owner 添加同一身份；状态及恢复仍走真实生产入口。
                    const attempt = beginTranslation(result.node, 'bilingual', 'content', true, sourceText,
                        originalNodes.filter(node => node.nodeType === 3) as Text[])!;
                    result.node.setAttribute('data-fr-translation-segment', 'true');
                    markTranslationComplete(result.node, attempt.state, attempt.generation);
                    const content = appendBilingualTranslation(result.node, '这是本次的中文译文。', {translationBeforeOriginal: before});
                    setBilingualContent(result.node, content);
                    setRenderedStyleAttribute(result.node);
                    expect(content.parentElement).toBe(result.node);
                    expect(content.parentElement!.parentElement).toBe(source);
                    expect(result.node.firstChild === content).toBe(before);
                    expect(getCurrentTranslationStateSourceText(result.node, attempt.state)).toBe(sourceText);
                    expect(attempt.state.syntheticHost).toBe(source);
                    expect(isTranslationArtifactCurrent(result.node, attempt.state)).toBe(true);
                    const refreshed = refreshBilingualTranslation(result.node, content, '这是更新后的译文。', {translationBeforeOriginal: before});
                    setBilingualContent(result.node, refreshed);
                    setRenderedStyleAttribute(result.node);
                    expect(refreshed).toBe(content);
                    expect(source.childNodes).toHaveLength(1);
                    expect(result.node.firstChild === content).toBe(before);
                    expect(isTranslationArtifactCurrent(result.node, attempt.state)).toBe(true);
                    expect(restoreTranslation(result.node)).toBe(true);
                    expect(getTranslationState(result.node)).toBeUndefined();
                    expect(source.innerHTML).toBe(originalHTML);
                    expect([...source.childNodes]).toEqual(originalNodes);
                    expect(source.style.display).toBe(display);
                }
            });
        });

    it.each(layouts)('仅译文模式不为纯文本%s容器创建额外布局项包装', display => {
        withRealm(`<div id="source" style="display:${display}">A readable source sentence.</div>`, document => {
            const source = document.querySelector<HTMLElement>('#source')!;
            const html = source.innerHTML;
            const candidate = contentCandidate(source, display.startsWith('inline-'));
            expect(materializeCandidate(candidate, false)).toEqual({node: source, synthetic: false});
            expect(source.innerHTML).toBe(html);
        });
    });

    it.each([
        '<div id="source" style="display:flex">Text <span>separate item</span></div>',
        '<div id="source" style="display:grid">Text <svg aria-hidden="true"></svg></div>',
        '<button id="source" style="display:flex">Open the requested document</button>',
        '<p id="source">This ordinary paragraph keeps its owner.</p>',
        '<ul><li id="source" style="list-style-position:inside">This list item keeps its native marker.</li></ul>',
    ])('多元素布局、控件、普通段落及列表保持原物化路径：%s', html => {
        withRealm(html, document => {
            const source = document.querySelector<HTMLElement>('#source')!;
            const original = source.innerHTML;
            const candidate: TranslationCandidate = {element: source, kind: source.localName === 'button' ? 'control' : 'content', reason: 'verified-existing-owner'};
            expect(materializeCandidate(candidate)).toEqual({node: source, synthetic: false});
            expect(source.innerHTML).toBe(original);
        });
    });

    it('原已有显式run在关闭纯text分组时仍物化，不改变来源集合', () => {
        withRealm('<div id="source" style="display:flex">Readable text.</div>', document => {
            const source = document.querySelector<HTMLElement>('#source')!;
            const nodes = [...source.childNodes];
            const result = materializeCandidate({element: source, kind: 'content', nodes, reason: 'existing-run'}, false)!;
            expect(result.synthetic).toBe(true);
            expect([...result.node.childNodes]).toEqual(nodes);
        });
    });

    it.each(['', '<!--unreadable anchor-->', '   '])('没有可读直属Text时不创建空布局包装：%j', text => {
        withRealm(`<div id="source" style="display:flex">${text}</div>`, document => {
            const source = document.querySelector<HTMLElement>('#source')!;
            const candidate: TranslationCandidate = {element: source, kind: 'content', reason: 'stale-empty-source'};
            expect(materializeCandidate(candidate)).toEqual({node: source, synthetic: false});
            expect(source.innerHTML).toBe(text);
        });
    });

    it('超预算与不可度量容器保留原路径，不猜测宿主布局', () => {
        withRealm('<div id="source" style="display:flex">Readable text.</div>', document => {
            const source = document.querySelector<HTMLElement>('#source')!;
            for (let index = 0; index < 2048; index++) source.appendChild(document.createComment('anchor'));
            const candidate: TranslationCandidate = {element: source, kind: 'content', reason: 'bounded-content'};
            expect(materializeCandidate(candidate)).toEqual({node: source, synthetic: false});
            source.replaceChildren(document.createTextNode('Still readable text.'));
            Object.defineProperty(document.defaultView!, 'getComputedStyle', {configurable: true, value: () => {throw new Error('Detached view');}});
            expect(materializeCandidate(candidate)).toEqual({node: source, synthetic: false});
        });
    });
});


function materializedState(document: Document, display = 'flex', scope: 'content' | 'all' = 'content', synthetic = true) {
    const source = document.createElement('div');
    source.style.display = display;
    source.textContent = 'Readable source for retry mapping.';
    document.querySelector('main')!.appendChild(source);
    const original = source.firstChild as Text;
    const candidate: TranslationCandidate = {element: source, kind: 'content', scope, reason: 'direct-layout-retry'};
    const result = materializeCandidate(candidate)!;
    expect(result.synthetic).toBe(true);
    result.node.setAttribute('data-fr-translation-segment', 'true');
    const attempt = beginTranslation(result.node, 'bilingual', 'content', synthetic, original.data, [original], false, undefined, scope)!;
    return {source, original, candidate, result, attempt};
}

describe('纯文本布局owner的已有状态映射与失败重试', () => {
    it.each(['flex', 'grid'].flatMap(display => ['loading', 'error', 'translated'].map(phase => ({display, phase}))))(
        '旧parent候选仍映射到唯一已登记合成状态并在恢复后回到parent：%j', ({display, phase}) => {
            withRealm('', document => {
                const fixture = materializedState(document, display);
                if (phase === 'error') expect(markTranslationError(fixture.result.node, fixture.attempt.state, fixture.attempt.generation)).toBe(true);
                if (phase === 'translated') {
                    expect(markTranslationComplete(fixture.result.node, fixture.attempt.state, fixture.attempt.generation)).toBe(true);
                    const content = appendBilingualTranslation(fixture.result.node, '已有的中文译文。');
                    setBilingualContent(fixture.result.node, content);
                    setRenderedStyleAttribute(fixture.result.node);
                }
                expect(fixture.attempt.state.phase).toBe(phase);
                expect(resolveTranslationStateNode(fixture.candidate)).toBe(fixture.result.node);
                expect(getTranslationState(resolveTranslationStateNode(fixture.candidate)!)).toBe(fixture.attempt.state);
                expect(restoreTranslation(fixture.result.node)).toBe(true);
                expect(resolveTranslationStateNode(fixture.candidate)).toBe(fixture.source);
                expect(fixture.source.firstChild).toBe(fixture.original);
                expect(fixture.source.childNodes).toHaveLength(1);
            });
        });

    it('公开class/segment属性不能把没有状态登记的伪造子节点映射成owner', () => {
        withRealm('<div id="source" style="display:flex"><span class="fluent-read-source-line" data-fr-translation-segment="true">Unregistered source.</span></div>', document => {
            const source = document.querySelector<HTMLElement>('#source')!;
            const candidate: TranslationCandidate = {element: source, kind: 'content', scope: 'content', reason: 'forged-source-line'};
            expect(resolveTranslationStateNode(candidate)).toBe(source);
        });
    });

    it.each(['text', 'element'])('存在额外%s布局子节点时不把parent认领为单一合成owner', shape => {
        withRealm('', document => {
            const fixture = materializedState(document);
            fixture.source.appendChild(shape === 'text' ? document.createTextNode('Host addition.') : document.createElement('img'));
            expect(resolveTranslationStateNode(fixture.candidate)).toBe(fixture.source);
        });
    });

    it.each(['kind', 'scope', 'synthetic', 'host', 'class', 'segment'])('拒绝身份不一致的合成状态：%s', mismatch => {
        withRealm('', document => {
            const fixture = materializedState(document, 'flex', 'content', mismatch !== 'synthetic');
            let candidate = fixture.candidate;
            if (mismatch === 'kind') candidate = {...candidate, kind: 'control'};
            if (mismatch === 'scope') candidate = {...candidate, scope: 'all'};
            if (mismatch === 'host') {
                const replacement = document.createElement('div');
                document.querySelector('main')!.appendChild(replacement);
                replacement.appendChild(fixture.result.node);
                candidate = {...candidate, element: replacement};
            }
            if (mismatch === 'class') fixture.result.node.classList.remove('fluent-read-source-line');
            if (mismatch === 'segment') fixture.result.node.removeAttribute('data-fr-translation-segment');
            expect(resolveTranslationStateNode(candidate)).toBe(candidate.element);
        });
    });
});
