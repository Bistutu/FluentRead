import {parseHTML} from 'linkedom';
import {registerManpagePreparation, unregisterManpagePreparation} from '@/src/core/translation/manpage';
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
    ensureTranslationTruncationLayout,
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
                getBoundingClientRect: {value: () => ({x: 0, y: 8000, left: 0, right: 640, top: 8000, bottom: 8120, width: 640, height: 120})},
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


describe('man7 双语渲染的换行生命周期', () => {
    it('append 与 refresh 折叠手册硬断行，保留行内链接和原文节点', async () => {
        await withDocumentRealm(document => {
            const base = document.createElement('base');
            base.setAttribute('href', 'https://example.com/');
            document.head.appendChild(base);
            document.body.innerHTML = '<pre><span id="manual">       Original explanation.\n       Continuation remains unchanged.\n</span></pre>';
            const owner = document.querySelector<HTMLElement>('#manual')!;
            const pre = owner.parentElement!;
            const source = owner.firstChild!;
            const original = source.nodeValue;
            registerManpagePreparation(pre, [owner]);
            try {
                const content = appendBilingualTranslation(owner, '译文第一部分<br><a href="https://example.com/">链接</a>\n第二部分', {longParagraphLineBreak: false});
                expect(content.style.whiteSpace).toBe('normal');
                expect(content.querySelector('br')).toBeNull();
                expect(content.textContent).toBe('译文第一部分 链接\n第二部分');
                expect(content.querySelector('a')!.getAttribute('href')).toBe('https://example.com/');
                const refreshed = refreshBilingualTranslation(owner, content, '更新译文<br>后续文字', {longParagraphLineBreak: false});
                expect(refreshed).toBe(content);
                expect(refreshed.querySelector('br')).toBeNull();
                expect(refreshed.textContent).toBe('更新译文 后续文字');
                expect(owner.firstChild).toBe(source);
                expect(source.nodeValue).toBe(original);
                expect(owner.querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(1);
                content.remove();
                expect(owner.textContent).toBe(original);
            } finally { unregisterManpagePreparation(pre, [owner]); }
        });
    });

    it('译文前置保留显式长段落按句换行选项', async () => {
        await withDocumentRealm(document => {
            document.body.innerHTML = '<pre><span id="manual">       Original manual explanation.\n</span></pre>';
            const owner = document.querySelector<HTMLElement>('#manual')!;
            const pre = owner.parentElement!;
            const source = owner.firstChild;
            registerManpagePreparation(pre, [owner]);
            try {
                const content = appendBilingualTranslation(owner, '这是一段用于验证显式按句换行开关的较长译文。'.repeat(8),
                    {longParagraphLineBreak: true, translationBeforeOriginal: true});
                expect(owner.firstChild).toBe(content);
                expect(content.querySelectorAll('br').length).toBeGreaterThan(0);
                expect(source!.parentNode).toBe(owner);
                expect(content.style.whiteSpace).toBe('normal');
            } finally { unregisterManpagePreparation(pre, [owner]); }
        });
    });
});


/** 只替代浏览器字形度量，实际 renderer、活动状态、外观同步与 resize 观察器仍走生产入口。 */
function committedManpageFixture(document: Document, beforeOriginal = false, marker = false) {
    document.body.innerHTML = '<pre><span id="manual">       Original explanation continues.\n       Continuation remains unchanged.\n</span></pre>';
    const owner = document.querySelector<HTMLElement>('#manual')!;
    const pre = owner.parentElement!;
    const source = owner.firstChild as Text;
    const sourceHTML = owner.innerHTML;
    const sourceColumns = source.data.split('\n')[0]!.length;
    registerManpagePreparation(pre, [owner]);
    const layout = supportedLayout(document);
    let sourceAdvance = 10;
    const originalComputedStyle = layout.getComputedStyle.getMockImplementation()!;
    layout.getComputedStyle.mockImplementation((element: HTMLElement) => ({
        ...originalComputedStyle(element), borderLeftWidth: '0px',
        paddingLeft: element.classList.contains('fluent-read-translation-text')
            ? `${8 * Number(document.getElementById(TRANSLATION_APPEARANCE_STYLE_ID)?.textContent?.match(/font-size: (\d+)%/u)?.[1] ?? 100) / 100}px` : '0px',
    }));
    Object.defineProperty(pre, 'getBoundingClientRect', {configurable: true,
        value: () => ({left: 0, right: 640, top: 0, bottom: 100, width: 640, height: 100})});
    const rangeDescriptor = Object.getOwnPropertyDescriptor(document, 'createRange');
    Object.defineProperty(document, 'createRange', {configurable: true, value: () => {
        let text: Text, offset: number;
        return {
            setStart(node: Text, start: number) {text = node; offset = start;}, setEnd() {},
            getBoundingClientRect() {
                const prefix = text.data.slice(0, offset);
                const column = prefix.length - prefix.lastIndexOf('\n') - 1;
                return {left: column * sourceAdvance, right: (column + 1) * sourceAdvance, width: sourceAdvance, height: 16};
            },
        };
    }});
    const attempt = beginTranslation(owner, 'bilingual', 'content', false, source.data, [source])!;
    markTranslationComplete(owner, attempt.state, attempt.generation);
    const content = appendBilingualTranslation(owner,
        marker ? '<span>这是带逐行标记的手册译文。</span>' : '这是手册译文。',
        {translationBeforeOriginal: beforeOriginal, longParagraphLineBreak: false});
    if (marker) content.firstElementChild!.className = 'fluent-read-translation-text';
    setBilingualContent(owner, content);
    setRenderedStyleAttribute(owner);
    ensureTranslationTruncationLayout(owner);
    let restored = false;
    return {owner, pre, source, sourceHTML, sourceColumns, content, state: attempt.state, generation: attempt.generation,
        setSourceAdvance(value: number) {sourceAdvance = value;},
        restore() {
            if (restored) return;
            restored = true;
            restoreTranslation(owner);
            unregisterManpagePreparation(pre, [owner]);
            layout.restore();
            if (rangeDescriptor) Object.defineProperty(document, 'createRange', rangeDescriptor);
            else Reflect.deleteProperty(document, 'createRange');
        },
    };
}

function expectManpageSnapshot(fixture: ReturnType<typeof committedManpageFixture>, padding: number, width: number) {
    const content = fixture.state.bilingualContent!;
    expect(content.style.getPropertyValue('padding-left')).toBe(`${padding}px`);
    expect(content.style.getPropertyValue('max-width')).toBe(`${width}px`);
    expect(fixture.state.bilingualContentTemplate!.getAttribute('style')).toBe(content.getAttribute('style'));
    expect(fixture.state.bilingualOuterHTML).toBe(content.outerHTML);
    expect(isTrustedBilingualArtifactWithHostClass(content, fixture.state)).toBe(true);
    expect(fixture.state.generation).toBe(fixture.generation);
    expect(fixture.state.phase).toBe('translated');
    expect(getTranslationState(fixture.owner)).toBe(fixture.state);
}

// 多轮微任务包括既有观察器和合并后的布局复核，不依赖计时器或真实字体安装。
async function flushLayoutCheckpoint(): Promise<void> {
    for (let index = 0; index < 6; index++) await Promise.resolve();
}

describe('man7 已提交译文的持续布局复核', () => {
    it.each([false, true])('源字形变化后由 resize 更新缩进与栏宽，并保持译文位置及精确恢复：before=%s', async before => {
        await withDocumentRealm(async document => {
            const fixture = committedManpageFixture(document, before);
            try {
                expectManpageSnapshot(fixture, 70, fixture.sourceColumns * 10);
                const source = fixture.source;
                const originalTemplate = fixture.state.bilingualContentTemplate!;
                const originalTemplateHTML = originalTemplate.outerHTML;
                fixture.setSourceAdvance(14);
                document.defaultView!.dispatchEvent(new document.defaultView!.Event('resize'));
                await flushLayoutCheckpoint();
                expectManpageSnapshot(fixture, 98, fixture.sourceColumns * 14);
                expect(originalTemplate.outerHTML).toBe(originalTemplateHTML);
                expect(fixture.owner.firstChild === fixture.content).toBe(before);
                expect(fixture.source).toBe(source);
                expect(fixture.source.data).toBe(fixture.sourceHTML);
                expectOrdinaryRendering(fixture.content);
                fixture.restore();
                expect(fixture.owner.innerHTML).toBe(fixture.sourceHTML);
                expect(fixture.owner.firstChild).toBe(source);
            } finally { fixture.restore(); }
        });
    });

    it('无屏外隔离时字号外观更新仍在新 CSS 生效后重算逐行标记留白，不重新请求或改动原文', async () => {
        await withDocumentRealm(async document => {
            const fixture = committedManpageFixture(document, false, true);
            try {
                expectManpageSnapshot(fixture, 62, fixture.sourceColumns * 10);
                expectOrdinaryRendering(fixture.content);
                const source = fixture.source;
                const contentChildren = [...fixture.content.childNodes];
                const controller = fixture.state.controller;
                syncTranslationAppearanceStyles(document, {fontScale: 150});
                expect(document.getElementById(TRANSLATION_APPEARANCE_STYLE_ID)!.textContent)
                    .toContain('font-size: 150% !important');
                await flushLayoutCheckpoint();
                expectManpageSnapshot(fixture, 58, fixture.sourceColumns * 10);
                expect([...fixture.content.childNodes]).toEqual(contentChildren);
                expect(fixture.state.controller).toBe(controller);
                expect(controller.signal.aborted).toBe(false);
                expect(fixture.source).toBe(source);
                expect(source.data).toBe(fixture.sourceHTML);
                syncTranslationAppearanceStyles(document, null);
                await flushLayoutCheckpoint();
                expectManpageSnapshot(fixture, 62, fixture.sourceColumns * 10);
            } finally { fixture.restore(); }
        });
    });

    it('可信克隆重挂后按当前源字形更新布局，旧工件及模板保持不变', async () => {
        await withDocumentRealm(document => {
            const fixture = committedManpageFixture(document, true);
            try {
                const oldContent = fixture.content;
                const oldHTML = oldContent.outerHTML;
                const clone = oldContent.cloneNode(true) as HTMLElement;
                oldContent.replaceWith(clone);
                expect(tryRepairBilingualTranslationArtifact(fixture.owner, fixture.state)).toBe('repaired');
                fixture.setSourceAdvance(12);
                ensureTranslationTruncationLayout(fixture.owner);
                expectManpageSnapshot(fixture, 84, fixture.sourceColumns * 12);
                expect(fixture.state.bilingualContent).toBe(clone);
                expect(fixture.owner.firstChild).toBe(clone);
                expect(oldContent.outerHTML).toBe(oldHTML);
            } finally { fixture.restore(); }
        });
    });

    it('布局复核不会把宿主篡改的译文或外层样式升级成可信模板', async () => {
        await withDocumentRealm(document => {
            const fixture = committedManpageFixture(document);
            try {
                const template = fixture.state.bilingualContentTemplate!;
                const templateHTML = template.outerHTML;
                fixture.content.textContent = '宿主篡改译文';
                fixture.content.style.setProperty('padding-left', '999px');
                fixture.setSourceAdvance(12);
                ensureTranslationTruncationLayout(fixture.owner);
                expect(fixture.state.bilingualContentTemplate).toBe(template);
                expect(template.outerHTML).toBe(templateHTML);
                expect(fixture.content.style.getPropertyValue('padding-left')).toBe('999px');
                expect(isTrustedBilingualArtifactWithHostClass(fixture.content, fixture.state)).toBe(false);
            } finally { fixture.restore(); }
        });
    });
});

/** 浏览器负责 inside marker 的原生字形，fixture 仅给初始源字形留出可重复的原生标记宽度。 */
function insideListFixture(document: Document, beforeOriginal: boolean, inside = true) {
    document.body.innerHTML = '<ul><li id="item">Original list explanation remains readable.</li><li id="neighbor">A neighboring item is unchanged.</li></ul>';
    const owner = document.querySelector<HTMLElement>('#item')!;
    const source = owner.firstChild as Text;
    const sourceHTML = owner.innerHTML;
    const neighborHTML = document.querySelector('#neighbor')!.outerHTML;
    const layout = supportedLayout(document);
    const originalComputedStyle = layout.getComputedStyle.getMockImplementation()!;
    let sourceFontSize = 16;
    layout.getComputedStyle.mockImplementation((element: HTMLElement) => ({
        ...originalComputedStyle(element), display: element === owner ? 'list-item' : 'block',
        listStylePosition: inside ? 'inside' : 'outside', direction: 'ltr',
        fontSize: `${sourceFontSize * (element === owner ? 1 : Number(document.getElementById(TRANSLATION_APPEARANCE_STYLE_ID)?.textContent?.match(/font-size: (\d+)%/u)?.[1] ?? 100) / 100)}px`,
        paddingLeft: '0px', paddingRight: '0px', borderLeftWidth: '0px', borderRightWidth: '0px',
    }));
    Object.defineProperty(owner, 'getBoundingClientRect', {configurable: true,
        value: () => ({left: 0, right: 640, top: 0, bottom: 60, width: 640, height: 60})});
    const descriptor = Object.getOwnPropertyDescriptor(document, 'createRange');
    Object.defineProperty(document, 'createRange', {configurable: true, value: () => ({
        setStart() {}, setEnd() {}, getBoundingClientRect: () => ({left: 24, right: 32, width: 8, height: 16}),
    })});
    const attempt = beginTranslation(owner, 'bilingual', 'content', false, source.data, [source])!;
    markTranslationComplete(owner, attempt.state, attempt.generation);
    const content = appendBilingualTranslation(owner, '这是一段前置的列表译文。', {translationBeforeOriginal: beforeOriginal});
    setBilingualContent(owner, content);
    setRenderedStyleAttribute(owner);
    return {owner, source, sourceHTML, neighborHTML, content, state: attempt.state,
        setSourceFontSize(value: number) {sourceFontSize = value;},
        restore() {
            restoreTranslation(owner);
            layout.restore();
            if (descriptor) Object.defineProperty(document, 'createRange', descriptor);
            else Reflect.deleteProperty(document, 'createRange');
        },
    };
}

describe('inside 列表前置译文的真实渲染接线', () => {
    it('factory 与 refresh 保持原生标记同行的整体译文盒，并精确恢复原 Text 与邻项', async () => {
        await withDocumentRealm(document => {
            const fixture = insideListFixture(document, true);
            try {
                expect(fixture.owner.firstChild).toBe(fixture.content);
                expect(fixture.content.style.getPropertyValue('display')).toBe('inline-block');
                expect(fixture.content.style.getPropertyValue('inline-size')).toBe('calc(100% - 24px)');
                expect(fixture.content.style.getPropertyValue('box-sizing')).toBe('border-box');
                expect(fixture.source.parentNode).toBe(fixture.owner);
                expect(fixture.source.data).toBe(fixture.sourceHTML);
                const refreshed = refreshBilingualTranslation(fixture.owner, fixture.content, '这是刷新后的列表译文。',
                    {translationBeforeOriginal: true});
                setBilingualContent(fixture.owner, refreshed);
                setRenderedStyleAttribute(fixture.owner);
                expect(refreshed).toBe(fixture.content);
                expect(refreshed.style.getPropertyValue('display')).toBe('inline-block');
                expect(refreshed.style.getPropertyValue('inline-size')).toBe('calc(100% - 24px)');
                expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
                expect(fixture.owner.querySelectorAll(OWNED_WRAPPER)).toHaveLength(1);
                expect(document.querySelector('#neighbor')!.outerHTML).toBe(fixture.neighborHTML);
                expect(restoreTranslation(fixture.owner)).toBe(true);
                expect(fixture.owner.innerHTML).toBe(fixture.sourceHTML);
                expect(fixture.owner.firstChild).toBe(fixture.source);
            } finally { fixture.restore(); }
        });
    });

    it('源字号复核同步marker占位及精确metadata快照，目标字号仅改变译文不改变原生marker间隔', async () => {
        await withDocumentRealm(async document => {
            const fixture = insideListFixture(document, true);
            try {
                const previousTemplate = fixture.state.bilingualContentTemplate!;
                const previousTemplateHTML = previousTemplate.outerHTML;
                const source = fixture.source;
                fixture.setSourceFontSize(20);
                expect(ensureTranslationTruncationLayout(fixture.owner)).toBe(true);
                expect(fixture.content.style.getPropertyValue('inline-size')).toBe('calc(100% - 30px)');
                expect(fixture.content.getAttribute('data-fr-inside-list-inset')).toBe('30');
                expect(fixture.content.getAttribute('data-fr-inside-list-source-size')).toBe('20');
                for (const attribute of ['style', 'data-fr-inside-list-layout', 'data-fr-inside-list-inset', 'data-fr-inside-list-source-size']) {
                    expect(fixture.state.bilingualContentTemplate!.getAttribute(attribute)).toBe(fixture.content.getAttribute(attribute));
                }
                expect(fixture.state.bilingualOuterHTML).toBe(fixture.content.outerHTML);
                expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
                expect(previousTemplate.outerHTML).toBe(previousTemplateHTML);
                syncTranslationAppearanceStyles(document, {fontScale: 150});
                await flushLayoutCheckpoint();
                expect(fixture.content.style.getPropertyValue('inline-size')).toBe('calc(100% - 30px)');
                expect(fixture.content.getAttribute('data-fr-inside-list-inset')).toBe('30');
                expect(fixture.content.getAttribute('data-fr-inside-list-source-size')).toBe('20');
                expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
                expect(fixture.source).toBe(source);
                expect(source.data).toBe(fixture.sourceHTML);
                expect(document.querySelector('#neighbor')!.outerHTML).toBe(fixture.neighborHTML);
            } finally { fixture.restore(); }
        });
    });

    it.each([[false, true], [true, false]])('后置译文或outside标记维持普通渲染：before=%s inside=%s', async (before, inside) => {
        await withDocumentRealm(document => {
            const fixture = insideListFixture(document, before, inside);
            try {
                expect(fixture.owner.firstChild === fixture.content).toBe(before);
                expect(fixture.content.style.getPropertyValue('display')).toBeFalsy();
                expect(fixture.content.style.getPropertyValue('inline-size')).toBeFalsy();
                expect(fixture.source.parentNode).toBe(fixture.owner);
                expect(isTranslationArtifactCurrent(fixture.owner, fixture.state)).toBe(true);
            } finally { fixture.restore(); }
        });
    });
});
