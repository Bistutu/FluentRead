import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/src/services/config/store', () => ({config: {style: 1, to: 'zh-Hans'}}));
vi.mock('@/src/core/config/catalog', () => ({options: {styles: []}}));

import {
    applyTranslationsToSnapshot,
    collectLiveTranslationTextSlots,
    createTranslationSourceSnapshot,
    getCurrentTranslationCore,
} from '@/src/core/translation/public';
import {
    appendBilingualTranslation,
    refreshBilingualTranslation,
} from '@/src/features/full-page-translation/content/renderer';
import {
    beginTranslation,
    getTranslationOwnersForIndexedNode,
    getTranslationState,
    hasBilingualArtifactHostWriteBudget,
    isBilingualArtifactDriftOnly,
    isOwnedBilingualArtifactAttached,
    isTrustedBilingualArtifactWithHostClass,
    markTranslationComplete,
    restoreAllTranslations,
    restoreTranslation,
    setBilingualContent,
    setRenderedStyleAttribute,
    tryRepairBilingualTranslationArtifact,
} from '@/src/features/full-page-translation/content/state';
import {isTranslationArtifactCurrent} from
    '@/src/features/full-page-translation/content/translationStability';
import {
    createBilingualRemountCapitulationRegistry,
    stabilizeBilingualArtifact,
    transferEquivalentBilingualOwners,
} from '@/src/features/full-page-translation/content/bilingualRemount';
import {
    syncTranslationAppearanceStyles,
    TRANSLATION_APPEARANCE_STYLE_ID,
} from '@/src/app/content/translationAppearance';

const OWNED_WRAPPER = '.fluent-read-bilingual-content[data-fr-translation-owned="true"]';

/** 使用真实 DOM、状态机及渲染器；仅提供 Node 环境缺少的浏览器全局。 */
async function withDocumentRealm(callback: (document: Document) => void | Promise<void>): Promise<void> {
    const {document} = parseHTML('<html><head></head><body></body></html>');
    const realm = document.defaultView as unknown as Record<string, unknown>;
    const bindings: Record<string, unknown> = {
        document, window: document.defaultView,
        DOMParser: class FixtureDOMParser {
            parseFromString(source: string): Document {
                return parseHTML(`<html><head></head><body>${source}</body></html>`).document;
            }
        },
        Element: realm.Element, HTMLElement: realm.HTMLElement, Node: realm.Node,
        MutationObserver: realm.MutationObserver, ShadowRoot: realm.ShadowRoot,
    };
    const descriptors = new Map(Object.keys(bindings).map(name =>
        [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const [name, value] of Object.entries(bindings)) {
        Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
    }
    try { await callback(document); }
    finally {
        restoreAllTranslations();
        for (const [name, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
        }
    }
}

function markOptimized(content: HTMLElement): void {
    content.setAttribute('data-fr-rendering-contained', 'true');
    content.style.setProperty('content-visibility', 'auto');
    content.style.setProperty('contain-intrinsic-block-size', 'auto 120px');
}

function expectOrdinaryRendering(content: HTMLElement): void {
    expect(content.hasAttribute('data-fr-rendering-contained')).toBe(false);
    expect(content.style.getPropertyValue('content-visibility')).toBeFalsy();
    expect(content.style.getPropertyValue('contain-intrinsic-block-size')).toBeFalsy();
}

function committedFixture(document: Document, manuallyOptimize = true) {
    const base = document.createElement('base');
    base.setAttribute('href', 'https://example.com/');
    document.head.appendChild(base);
    document.body.innerHTML = '<p id="owner" style="color: red">Translate this sentence. ' +
        '<a id="source-link" href="https://example.com/read" title="Source hint">Read the details.</a> ' +
        '<code id="source-code">const value = "source";  value++;</code></p>';
    const owner = document.querySelector<HTMLElement>('#owner')!;
    const sourceHTML = owner.innerHTML;
    const sourceChildren = Array.from(owner.childNodes);
    const code = owner.querySelector<HTMLElement>('#source-code')!;
    const codeText = code.firstChild;
    const codeHTML = code.outerHTML;
    const core = getCurrentTranslationCore();
    const extractionOptions = {protectedElement: owner};
    const snapshot = createTranslationSourceSnapshot(owner, core.shouldStayOriginal, undefined, extractionOptions);
    const slots = collectLiveTranslationTextSlots(owner, core.shouldStayOriginal, undefined, extractionOptions);
    const sources = snapshot.slots.map(slot => slot.source);
    const translations = ['这句话已翻译。', '阅读详情。'];
    expect(sources).toEqual(['Translate this sentence.', 'Read the details.']);
    const attempt = beginTranslation(owner, 'bilingual', 'content', false,
        sources.join(' '), slots.map(slot => slot.node))!;
    expect(markTranslationComplete(owner, attempt.state, attempt.generation)).toBe(true);
    const content = appendBilingualTranslation(owner, applyTranslationsToSnapshot(snapshot, translations),
        {targetLanguage: 'zh-Hans', style: 1});
    content.style.color = 'teal';
    content.style.fontFamily = 'serif';
    content.setAttribute('data-fixture-preserved', 'keep');
    if (manuallyOptimize) markOptimized(content);
    setBilingualContent(owner, content, {sources, translations, targetLanguage: 'zh-Hans', style: 1});
    setRenderedStyleAttribute(owner);
    return {owner, content, state: attempt.state, generation: attempt.generation,
        sourceHTML, sourceChildren, code, codeText, codeHTML, sourceNodes: slots.map(slot => slot.node)};
}

function expectRestored(fixture: ReturnType<typeof committedFixture>): void {
    expect(restoreTranslation(fixture.owner)).toBe(true);
    expect(getTranslationState(fixture.owner)).toBeUndefined();
    expect(fixture.owner.innerHTML).toBe(fixture.sourceHTML);
    const restoredChildren = Array.from(fixture.owner.childNodes);
    expect(restoredChildren).toHaveLength(fixture.sourceChildren.length);
    restoredChildren.forEach((node, index) => expect(node).toBe(fixture.sourceChildren[index]));
    expect(fixture.owner.querySelector('#source-code')).toBe(fixture.code);
    expect(fixture.code.firstChild).toBe(fixture.codeText);
    expect(fixture.code.outerHTML).toBe(fixture.codeHTML);
    expect(fixture.owner.querySelector(OWNED_WRAPPER)).toBeNull();
}

function expectSynchronizedOrdinaryArtifact(fixture: ReturnType<typeof committedFixture>, content: HTMLElement): void {
    expectOrdinaryRendering(content);
    expectOrdinaryRendering(fixture.state.bilingualContentTemplate!);
    expect(fixture.state.bilingualContent).toBe(content);
    expect(fixture.state.bilingualOuterHTML).toBe(content.outerHTML);
    expect(fixture.state.bilingualContentTemplate!.outerHTML).toBe(content.outerHTML);
    expect(fixture.state.sourceTextNodes).toEqual(fixture.sourceNodes);
    expect(content.style.color).toBe('teal');
    expect(content.style.fontFamily).toBe('serif');
    expect(content.getAttribute('data-fixture-preserved')).toBe('keep');
    expect(getTranslationOwnersForIndexedNode(content)).toEqual([fixture.owner]);
    expect(isOwnedBilingualArtifactAttached(fixture.owner, fixture.state)).toBe(true);
}

/** 为首次真实 append 提供可控 CSS 支持和稳定几何，refresh 不能靠 unsupported 逃过契约。 */
function supportedLayout(document: Document) {
    const view = document.defaultView!;
    const patches: Array<{target: object; key: string; descriptor?: PropertyDescriptor}> = [];
    const patch = (target: object, key: string, value: unknown) => {
        patches.push({target, key, descriptor: Object.getOwnPropertyDescriptor(target, key)});
        Object.defineProperty(target, key, {configurable: true, writable: true, value});
    };
    const supports = vi.fn(() => true);
    const getComputedStyle = vi.fn((element: HTMLElement) => ({
        display: 'block', writingMode: 'horizontal-tb', position: 'static', boxSizing: 'content-box',
        blockSize: '120px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px',
        overflowX: 'visible', overflowY: 'visible', height: 'auto',
        getPropertyValue(property: string) {
            return element.style.getPropertyValue(property) ||
                (property === 'content-visibility' ? 'visible' : property === 'contain' ? 'none' : '');
        },
    }));
    patch(view, 'CSS', {supports});
    patch(view, 'innerHeight', 600);
    patch(view, 'getComputedStyle', getComputedStyle);
    patch(document.documentElement, 'scrollHeight', 3000);
    const createElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((...args) => {
        const element = createElement(...args);
        if (element.tagName === 'SPAN') {
            Object.defineProperties(element, {
                clientWidth: {value: 640}, clientHeight: {value: 120},
                scrollWidth: {value: 640}, scrollHeight: {value: 120},
                getBoundingClientRect: {value: () => ({x: 0, y: 8000, width: 640, height: 120})},
            });
        }
        return element;
    });
    return {supports, getComputedStyle, restore() {
        createElementSpy.mockRestore();
        for (const {target, key, descriptor} of patches.reverse()) {
            if (descriptor) Object.defineProperty(target, key, descriptor);
            else Reflect.deleteProperty(target, key);
        }
    }};
}

describe('双语屏外渲染的工件生命周期', () => {
    it('同 owner 删除后重挂已有译文，清除旧隔离并同步可信快照，原 Text 与代码精确恢复', async () => {
        await withDocumentRealm(document => {
            const fixture = committedFixture(document);
            const oldTemplate = fixture.state.bilingualContentTemplate!;
            const oldTemplateHTML = oldTemplate.outerHTML;
            fixture.content.remove();
            expect(tryRepairBilingualTranslationArtifact(fixture.owner, fixture.state)).toBe('repaired');
            expect(fixture.owner.querySelector(OWNED_WRAPPER)).toBe(fixture.content);
            expectSynchronizedOrdinaryArtifact(fixture, fixture.content);
            expect(fixture.state.bilingualContentTemplate).not.toBe(oldTemplate);
            expect(oldTemplate.outerHTML).toBe(oldTemplateHTML);
            expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
            expectRestored(fixture);
        });
    });

    it('同 owner 接管可信克隆工件时清除继承的旧尺寸，保留本代所有权和原文', async () => {
        await withDocumentRealm(document => {
            const fixture = committedFixture(document);
            const clone = fixture.content.cloneNode(true) as HTMLElement;
            fixture.content.replaceWith(clone);
            expect(isTrustedBilingualArtifactWithHostClass(clone, fixture.state)).toBe(true);
            expect(tryRepairBilingualTranslationArtifact(fixture.owner, fixture.state)).toBe('repaired');
            expectSynchronizedOrdinaryArtifact(fixture, clone);
            expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
            expect(fixture.state.generation).toBe(fixture.generation);
            expectRestored(fixture);
        });
    });

    it('可信克隆只有链接 title 漂移时仍撤下隔离，多次核对不重译、不计修复预算、不失去所有权', async () => {
        await withDocumentRealm(document => {
            const fixture = committedFixture(document);
            const clone = fixture.content.cloneNode(true) as HTMLElement;
            const link = clone.querySelector('a')!;
            expect(link.getAttribute('href')).toBe('https://example.com/read');
            link.setAttribute('title', 'Host tooltip');
            fixture.content.replaceWith(clone);
            expect(isTrustedBilingualArtifactWithHostClass(clone, fixture.state)).toBe(false);
            expect(tryRepairBilingualTranslationArtifact(fixture.owner, fixture.state)).toBe('tolerated');
            expectOrdinaryRendering(clone);
            expectOrdinaryRendering(fixture.state.bilingualContentTemplate!);
            expect(fixture.state.bilingualOuterHTML).toBe(clone.outerHTML);
            expect(fixture.state.bilingualContentTemplate!.querySelector('a')!.getAttribute('title')).toBe('Source hint');
            const registry = createBilingualRemountCapitulationRegistry();
            for (let round = 0; round < 5; round += 1) {
                link.setAttribute('title', `Host tooltip ${round}`);
                expect(isBilingualArtifactDriftOnly(fixture.owner, fixture.state)).toBe(true);
                expect(tryRepairBilingualTranslationArtifact(fixture.owner, fixture.state)).toBe('tolerated');
                expect(stabilizeBilingualArtifact(fixture.owner, fixture.state, registry)).toBe('current');
                expect(getTranslationState(fixture.owner)).toBe(fixture.state);
                expect(fixture.state.phase).toBe('translated');
                expect(fixture.state.controller.signal.aborted).toBe(false);
                expect(fixture.state.bilingualContent).toBe(clone);
                expect(isOwnedBilingualArtifactAttached(fixture.owner, fixture.state)).toBe(true);
                expect(getTranslationOwnersForIndexedNode(clone)).toEqual([fixture.owner]);
            }
            expect(fixture.state.generation).toBe(fixture.generation);
            expect(fixture.state.bilingualReplay!.translations).toEqual(['这句话已翻译。', '阅读详情。']);
            expect(hasBilingualArtifactHostWriteBudget(fixture.owner)).toBe(false);
            expectRestored(fixture);
        });
    });

    it('显式 trustedTemplate 接管清理新工件与新模板，仅克隆旧模板而不改其属性', async () => {
        await withDocumentRealm(document => {
            const fixture = committedFixture(document);
            const trustedTemplate = fixture.state.bilingualContentTemplate!;
            const templateHTML = trustedTemplate.outerHTML;
            const clone = fixture.content.cloneNode(true) as HTMLElement;
            fixture.content.replaceWith(clone);
            setBilingualContent(fixture.owner, clone, fixture.state.bilingualReplay, trustedTemplate);
            expectSynchronizedOrdinaryArtifact(fixture, clone);
            expect(fixture.state.bilingualContentTemplate).not.toBe(trustedTemplate);
            expect(trustedTemplate.outerHTML).toBe(templateHTML);
            expect(trustedTemplate.getAttribute('data-fr-rendering-contained')).toBe('true');
            expect(trustedTemplate.style.getPropertyValue('content-visibility')).toBe('auto');
            expect(fixture.state.bilingualContentTemplate!.querySelector('a')!.outerHTML)
                .toBe(trustedTemplate.querySelector('a')!.outerHTML);
            expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
            expectRestored(fixture);
        });
    });

    it('实际 renderer 首次在支持浏览器和稳定几何下启用隔离，refresh 保持原 wrapper 并回到普通渲染', async () => {
        await withDocumentRealm(document => {
            const layout = supportedLayout(document);
            try {
                const fixture = committedFixture(document, false);
                expect(layout.supports.mock.calls).toEqual([
                    ['content-visibility', 'auto'], ['contain-intrinsic-block-size', 'auto 1px'],
                ]);
                expect(fixture.content.getAttribute('data-fr-rendering-contained')).toBe('true');
                expect(fixture.content.style.getPropertyValue('content-visibility')).toBe('auto');
                expect(fixture.content.style.getPropertyValue('contain-intrinsic-block-size')).toBe('auto 120px');
                expect(fixture.state.bilingualContentTemplate!.getAttribute('data-fr-rendering-contained')).toBe('true');
                const supportsCalls = layout.supports.mock.calls.length;
                const result = refreshBilingualTranslation(fixture.owner, fixture.content,
                    '<a href="https://example.com/read" title="New hint">这是一段更新后的更长译文。</a>' +
                    '<code>const value = "source";  value++;</code>', {targetLanguage: 'zh-Hans', style: 1});
                expect(result).toBe(fixture.content);
                expectOrdinaryRendering(result);
                expect(result.textContent).toContain('这是一段更新后的更长译文。');
                expect(result.querySelector('a')!.getAttribute('title')).toBe('New hint');
                expect(result.querySelector('code')!.textContent).toBe('const value = "source";  value++;');
                expect(layout.supports).toHaveBeenCalledTimes(supportsCalls);
                setBilingualContent(fixture.owner, result);
                expectOrdinaryRendering(fixture.state.bilingualContentTemplate!);
                expect(fixture.state.bilingualOuterHTML).toBe(result.outerHTML);
                expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
                expectRestored(fixture);
            } finally { layout.restore(); }
        });
    });
});

describe('外观同步与重挂撤下旧译文尺寸', () => {
    it('真实字号同步清理当前可信工件及模板，保留原文、代次、译文和其它样式', async () => {
        await withDocumentRealm(document => {
            syncTranslationAppearanceStyles(document, {fontScale: 110});
            const fixture = committedFixture(document);
            const template = fixture.state.bilingualContentTemplate!;
            const originalTemplateHTML = template.outerHTML;
            const replay = fixture.state.bilingualReplay;
            const controller = fixture.state.controller;
            const contentNodes = Array.from(fixture.content.childNodes);

            syncTranslationAppearanceStyles(document, {fontScale: 130});

            expect(document.getElementById(TRANSLATION_APPEARANCE_STYLE_ID)!.textContent)
                .toContain('font-size: 130% !important');
            expectSynchronizedOrdinaryArtifact(fixture, fixture.content);
            expect(fixture.state.bilingualContentTemplate).not.toBe(template);
            expect(template.outerHTML).toBe(originalTemplateHTML);
            expect(Array.from(fixture.content.childNodes)).toEqual(contentNodes);
            expect(fixture.state.generation).toBe(fixture.generation);
            expect(fixture.state.bilingualReplay).toBe(replay);
            expect(fixture.state.controller).toBe(controller);
            expect(controller.signal.aborted).toBe(false);
            expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
            expectRestored(fixture);
        });
    });

    it('归一化后的相同 CSS 保留已优化工件与可信模板', async () => {
        await withDocumentRealm(document => {
            syncTranslationAppearanceStyles(document, {fontScale: 120, textColor: '#abc'});
            const fixture = committedFixture(document);
            const contentHTML = fixture.content.outerHTML;
            const template = fixture.state.bilingualContentTemplate!;
            const style = document.getElementById(TRANSLATION_APPEARANCE_STYLE_ID)!;
            const css = style.textContent;

            syncTranslationAppearanceStyles(document, {fontScale: '120', textColor: '#AABBCC'});

            expect(style.textContent).toBe(css);
            expect(document.getElementById(TRANSLATION_APPEARANCE_STYLE_ID)).toBe(style);
            expect(fixture.content.outerHTML).toBe(contentHTML);
            expect(fixture.content.getAttribute('data-fr-rendering-contained')).toBe('true');
            expect(fixture.state.bilingualContentTemplate).toBe(template);
            expect(fixture.state.generation).toBe(fixture.generation);
            expectRestored(fixture);
        });
    });

    it.each([undefined, null, {fontScale: 100}])('无外观规则时默认同步 %j 不撤下隔离', async appearance => {
        await withDocumentRealm(document => {
            const fixture = committedFixture(document);
            const contentHTML = fixture.content.outerHTML;
            const template = fixture.state.bilingualContentTemplate;

            syncTranslationAppearanceStyles(document, appearance);

            expect(document.getElementById(TRANSLATION_APPEARANCE_STYLE_ID)).toBeNull();
            expect(fixture.content.outerHTML).toBe(contentHTML);
            expect(fixture.state.bilingualContentTemplate).toBe(template);
            expectRestored(fixture);
        });
    });

    it('外观同步只清理当前文档，另一文档的活动译文及模板保持原样', async () => {
        await withDocumentRealm(document => {
            const fixture = committedFixture(document);
            const otherDocument = parseHTML('<html><head></head><body></body></html>').document;
            const other = committedFixture(otherDocument);
            const otherHTML = other.content.outerHTML;
            const otherTemplate = other.state.bilingualContentTemplate;
            const otherReplay = other.state.bilingualReplay;

            syncTranslationAppearanceStyles(document, {fontScale: 130});

            expectSynchronizedOrdinaryArtifact(fixture, fixture.content);
            expect(other.content.outerHTML).toBe(otherHTML);
            expect(other.state.bilingualContentTemplate).toBe(otherTemplate);
            expect(other.state.bilingualReplay).toBe(otherReplay);
            expect(other.state.generation).toBe(other.generation);
            expect(other.content.getAttribute('data-fr-rendering-contained')).toBe('true');
            expectRestored(fixture);
            expectRestored(other);
        });
    });

    it.each(['single', 'control', 'loading'] as const)('外观变化不接管 %s 状态中的残留工件', async kind => {
        await withDocumentRealm(document => {
            const fixture = committedFixture(document);
            const owner = document.createElement('p');
            owner.textContent = 'Other source.';
            document.body.appendChild(owner);
            const attempt = beginTranslation(owner, kind === 'single' ? 'single' : 'bilingual',
                kind === 'control' ? 'control' : 'content', false, 'Other source.', [owner.firstChild as Text])!;
            if (kind !== 'loading') expect(markTranslationComplete(owner, attempt.state, attempt.generation)).toBe(true);
            const content = fixture.content.cloneNode(true) as HTMLElement;
            owner.appendChild(content);
            setBilingualContent(owner, content);
            const contentHTML = content.outerHTML;
            const template = attempt.state.bilingualContentTemplate;

            syncTranslationAppearanceStyles(document, {fontScale: 130});

            expectSynchronizedOrdinaryArtifact(fixture, fixture.content);
            expect(content.outerHTML).toBe(contentHTML);
            expect(attempt.state.bilingualContentTemplate).toBe(template);
            expect(attempt.state.generation).toBe(attempt.generation);
            expect(content.getAttribute('data-fr-rendering-contained')).toBe('true');
            expectRestored(fixture);
        });
    });

    it('外观同步不会以清理尺寸为由接管外层属性已被篡改的工件', async () => {
        await withDocumentRealm(document => {
            const fixture = committedFixture(document);
            fixture.content.setAttribute('lang', 'fr');
            const contentHTML = fixture.content.outerHTML;
            const template = fixture.state.bilingualContentTemplate;
            const trustedOuterHTML = fixture.state.bilingualOuterHTML;
            expect(isTrustedBilingualArtifactWithHostClass(fixture.content, fixture.state)).toBe(false);
            expect(isBilingualArtifactDriftOnly(fixture.owner, fixture.state)).toBe(false);

            syncTranslationAppearanceStyles(document, {fontScale: 130});

            expect(fixture.content.outerHTML).toBe(contentHTML);
            expect(fixture.state.bilingualContentTemplate).toBe(template);
            expect(fixture.state.bilingualOuterHTML).toBe(trustedOuterHTML);
            expect(fixture.state.generation).toBe(fixture.generation);
            expectRestored(fixture);
        });
    });

    it('已有链接 title 漂移仍保留提示、译文与所有权，并在外观同步时清理尺寸', async () => {
        await withDocumentRealm(document => {
            const fixture = committedFixture(document);
            const link = fixture.content.querySelector('a')!;
            link.setAttribute('title', 'Host tooltip');
            const replay = fixture.state.bilingualReplay;
            const template = fixture.state.bilingualContentTemplate!;
            const oldTemplateHTML = template.outerHTML;
            expect(isBilingualArtifactDriftOnly(fixture.owner, fixture.state)).toBe(true);

            syncTranslationAppearanceStyles(document, {fontScale: 130});

            expectOrdinaryRendering(fixture.content);
            expectOrdinaryRendering(fixture.state.bilingualContentTemplate!);
            expect(fixture.content.querySelector('a')).toBe(link);
            expect(link.getAttribute('title')).toBe('Host tooltip');
            expect(fixture.state.bilingualContentTemplate!.querySelector('a')!.getAttribute('title')).toBe('Source hint');
            expect(template.outerHTML).toBe(oldTemplateHTML);
            expect(fixture.state.bilingualOuterHTML).toBe(fixture.content.outerHTML);
            expect(fixture.state.bilingualReplay).toBe(replay);
            expect(fixture.state.generation).toBe(fixture.generation);
            expect(getTranslationOwnersForIndexedNode(fixture.content)).toEqual([fixture.owner]);
            expect(isBilingualArtifactDriftOnly(fixture.owner, fixture.state)).toBe(true);
            expect(stabilizeBilingualArtifact(fixture.owner, fixture.state,
                createBilingualRemountCapitulationRegistry())).toBe('current');
            expectRestored(fixture);
        });
    });

    it.each([true, false])('真实等价 owner 接管在 reconcile 前撤下旧尺寸（复制工件 %s）', async copyContent => {
        await withDocumentRealm(document => {
            const fixture = committedFixture(document);
            const previousTemplate = fixture.state.bilingualContentTemplate!;
            const previousTemplateHTML = previousTemplate.outerHTML;
            const replacement = fixture.owner.cloneNode(true) as HTMLElement;
            if (!copyContent) replacement.querySelector(OWNED_WRAPPER)!.remove();
            const sourceChildren = Array.from(replacement.childNodes)
                .filter(node => node.nodeType !== 1 || !(node as Element).matches(OWNED_WRAPPER));
            const code = replacement.querySelector<HTMLElement>('#source-code')!;
            const codeText = code.firstChild;
            const codeHTML = code.outerHTML;
            fixture.owner.replaceWith(replacement);
            const reconcile = vi.fn((owner: HTMLElement) => {
                expect(owner).toBe(replacement);
                const content = owner.querySelector<HTMLElement>(OWNED_WRAPPER)!;
                expect(content.isConnected).toBe(true);
                expectOrdinaryRendering(content);
                expect(content.style.color).toBe('teal');
                expect(content.style.fontFamily).toBe('serif');
                return true;
            });
            const sourceNodes = collectLiveTranslationTextSlots(replacement,
                getCurrentTranslationCore().shouldStayOriginal, undefined,
                {protectedElement: replacement}).map(slot => slot.node);
            const result = transferEquivalentBilingualOwners({
                type: 'childList', target: document.body,
                addedNodes: [replacement], removedNodes: [fixture.owner],
            } as unknown as MutationRecord, () => ({sourceTextNodes: sourceNodes, reconcileLayout: reconcile}));

            expect(reconcile).toHaveBeenCalledOnce();
            expect(result.transfers).toEqual([{previousOwner: fixture.owner, replacementOwner: replacement}]);
            expect(result.capitulations).toEqual([]);
            const state = getTranslationState(replacement)!;
            const content = state.bilingualContent!;
            expect(getTranslationState(fixture.owner)).toBeUndefined();
            expectOrdinaryRendering(content);
            expectOrdinaryRendering(state.bilingualContentTemplate!);
            expect(state.bilingualOuterHTML).toBe(content.outerHTML);
            expect(state.bilingualContentTemplate!.outerHTML).toBe(content.outerHTML);
            expect(previousTemplate.outerHTML).toBe(previousTemplateHTML);
            expect(state.bilingualReplay).toEqual(fixture.state.bilingualReplay);
            expect(state.sourceTextNodes).toEqual(sourceNodes);
            expect(isTranslationArtifactCurrent(replacement, state)).toBe(true);
            expectRestored({...fixture, owner: replacement, state, content, sourceChildren,
                code, codeText, codeHTML, sourceNodes});
        });
    });
});
