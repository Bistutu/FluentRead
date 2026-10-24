import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {registerManpagePreparation, unregisterManpagePreparation} from '@/src/core/translation/manpage';

vi.mock('@/src/services/config/store', () => ({config: {
    animations: false, translationLoadingStyle: 'minimal', service: 'deepseek', style: 1, to: 'zh-Hans',
    customOpenAIProviders: [], compositeTranslationProviders: [],
}}));
vi.mock('@/src/core/config/catalog', () => ({options: {styles: [], services: [{value: 'deepseek', label: 'DeepSeek'}]}}));
vi.mock('@/src/features/page-notice/public', () => ({showPageNotice: vi.fn()}));

import {insertFailedTip, insertLoadingSpinner} from '@/src/features/full-page-translation/ui/translationIndicators';
import {appendBilingualTranslation} from '@/src/features/full-page-translation/content/renderer';
import {beginTranslation, getTranslationState, markTranslationComplete, markTranslationError, restoreAllTranslations,
    restoreTranslation, setBilingualContent, setRenderedStyleAttribute, setRetryWrapper, setSpinner} from '@/src/features/full-page-translation/content/state';
import {isTranslationArtifactCurrent} from '@/src/features/full-page-translation/content/translationStability';
import {clearOrphanedTranslationArtifacts, isTextEquivalentHostReplacement, normalizeOrphanedTranslationArtifacts, normalizeOrphanedTranslationOwner, restorePageTranslationContent} from '@/src/features/full-page-translation/content/orphanArtifacts';

let document: Document;
let bindings: Map<string, PropertyDescriptor | undefined>;
const preparations: Array<{pre: Element; paragraphs: Element[]}> = [];

beforeEach(() => {
    document = parseHTML('<html><head></head><body></body></html>').document;
    const view = document.defaultView!;
    const values: Record<string, unknown> = {document, window: view, Node: view.Node, Element: view.Element,
        HTMLElement: view.HTMLElement, DOMParser: class {
            parseFromString(text: string) {return parseHTML(`<html><body>${text}</body></html>`).document;}
        }};
    bindings = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, {configurable: true, value});
});

afterEach(() => {
    restoreAllTranslations();
    preparations.forEach(({pre, paragraphs}) => unregisterManpagePreparation(pre, paragraphs));
    preparations.length = 0;
    vi.restoreAllMocks();
    for (const [key, descriptor] of bindings) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

function preparedParagraph() {
    document.body.innerHTML = '<pre><span id="source" data-fr-manpage-paragraph="true">       Original manual explanation.\n</span></pre>';
    const owner = document.querySelector<HTMLElement>('#source')!;
    const pre = owner.parentElement!;
    registerManpagePreparation(pre, [owner]);
    preparations.push({pre, paragraphs: [owner]});
    return {owner, pre, source: owner.firstChild as Text};
}

describe('man7加载及重试指示器的水平布局隔离', () => {
    it.each([false, true])('运行时登记的手册loading占独立行，保留cache=%s及原Text身份并能精确恢复', cache => {
        const {owner, pre, source} = preparedParagraph();
        const original = pre.innerHTML;
        const attempt = beginTranslation(owner, 'bilingual', 'content', false, source.data, [source])!;
        const indicator = insertLoadingSpinner(owner, cache);
        setSpinner(owner, indicator);
        expect(indicator.style.getPropertyValue('display')).toBe('block');
        expect(indicator.getAttribute('data-fr-translation-owned')).toBe('true');
        const visualHost = indicator.querySelector<HTMLElement>('.fluent-read-loading')!;
        expect(visualHost.hasAttribute('data-fr-cache')).toBe(cache);
        expect(visualHost.style.getPropertyValue('display')).toBe('inline-flex');
        expect(visualHost.style.getPropertyValue('width')).toBe('16px');
        expect(owner.querySelectorAll('.fluent-read-loading')).toHaveLength(1);
        expect(indicator.classList.contains('fluent-read-manpage-feedback')).toBe(true);
        expect(owner.firstChild).toBe(source);
        expect(attempt.state.spinner).toBe(indicator);
        expect(restoreTranslation(owner)).toBe(true);
        expect(getTranslationState(owner)).toBeUndefined();
        expect(pre.innerHTML).toBe(original);
        expect(owner.firstChild).toBe(source);
    });

    it('运行时登记的手册retry外框占独立行，按真实状态恢复反馈、失败标记及原文', () => {
        const {owner, pre, source} = preparedParagraph();
        const original = pre.innerHTML;
        const attempt = beginTranslation(owner, 'bilingual', 'content', false, source.data, [source])!;
        expect(markTranslationError(owner, attempt.state, attempt.generation)).toBe(true);
        const wrapper = insertFailedTip(owner, 'provider unavailable', () => true);
        setRetryWrapper(owner, wrapper);
        setRenderedStyleAttribute(owner);
        expect(wrapper.style.getPropertyValue('display')).toBe('block');
        expect(wrapper.getAttribute('data-fr-translation-owned')).toBe('true');
        expect(wrapper.querySelector('.fluent-read-retry')).not.toBeNull();
        expect(wrapper.querySelector('.fluent-read-reason')).not.toBeNull();
        expect(owner.getAttribute('data-fr-translation-failed')).toBe('true');
        expect(restoreTranslation(owner)).toBe(true);
        expect(pre.innerHTML).toBe(original);
        expect(owner.firstChild).toBe(source);
    });

    it('legacy void重试删除整个自有块包装，不留下空反馈或失败标记', () => {
        const {owner, source} = preparedParagraph();
        const original = owner.innerHTML;
        const retry = vi.fn();
        const wrapper = insertFailedTip(owner, 'provider unavailable', retry);
        wrapper.querySelector<HTMLElement>('.fluent-read-retry')!.click();
        expect(retry).toHaveBeenCalledOnce();
        expect(wrapper.isConnected).toBe(false);
        expect(owner.querySelector('.fluent-read-manpage-feedback')).toBeNull();
        expect(owner.querySelector('.fluent-read-retry-wrapper')).toBeNull();
        expect(owner.hasAttribute('data-fr-translation-failed')).toBe(false);
        expect(owner.innerHTML).toBe(original);
        expect(owner.firstChild).toBe(source);
    });

    it.each([true, false])('runtime boolean重试返回%s时保留整块反馈供状态机接管', accepted => {
        const {owner, source} = preparedParagraph();
        const retry = vi.fn(() => accepted);
        const wrapper = insertFailedTip(owner, 'provider unavailable', retry);
        wrapper.querySelector<HTMLElement>('.fluent-read-retry')!.click();
        expect(retry).toHaveBeenCalledOnce();
        expect(wrapper.isConnected).toBe(true);
        expect(wrapper.classList.contains('fluent-read-manpage-feedback')).toBe(true);
        expect(wrapper.querySelector('.fluent-read-retry-wrapper')).not.toBeNull();
        expect(owner.firstChild).toBe(source);
    });

    it.each([
        '<pre id="source" data-fr-manpage-paragraph="true">Ordinary pre is not a runtime paragraph.</pre>',
        '<pre><span id="source" data-fr-manpage-paragraph="true">Forged source paragraph.</span></pre>',
        '<p id="source" data-fr-manpage-paragraph="true">Ordinary paragraph is unchanged.</p>',
    ])('公开属性与普通PRE不能启用专属指示器布局：%s', html => {
        document.body.innerHTML = html;
        const owner = document.querySelector<HTMLElement>('#source')!;
        const source = owner.firstChild;
        const spinner = insertLoadingSpinner(owner);
        expect(spinner.style.getPropertyValue('display')).toBe('inline-flex');
        const retry = insertFailedTip(owner, 'provider unavailable', () => true);
        expect(retry.style.getPropertyValue('display')).not.toBe('block');
        expect(owner.firstChild).toBe(source);
    });

    it('同PRE内只登记一个段落不会把相邻伪造段落授予专属布局', () => {
        document.body.innerHTML = '<pre><span id="real">Registered source.\n</span><span id="fake" data-fr-manpage-paragraph="true">Forged neighbor.\n</span></pre>';
        const pre = document.querySelector('pre')!;
        const real = document.querySelector<HTMLElement>('#real')!;
        const fake = document.querySelector<HTMLElement>('#fake')!;
        registerManpagePreparation(pre, [real]);
        preparations.push({pre, paragraphs: [real]});
        expect(insertLoadingSpinner(real).style.getPropertyValue('display')).toBe('block');
        expect(insertLoadingSpinner(fake).style.getPropertyValue('display')).toBe('inline-flex');
        expect(insertFailedTip(fake, 'provider unavailable', () => true).style.getPropertyValue('display')).not.toBe('block');
    });

    it.each(['loading', 'retry'])('相邻参数先提交、前段%s后移除时，实际renderer不保留临时占位造成的过期缩进', kind => {
        document.body.innerHTML = '<pre><span id="previous" data-fr-manpage-paragraph="true">           %d  Previous parameter.\n</span>' +
            '<span id="next" data-fr-manpage-paragraph="true">           %e  Following parameter explanation.\n               Continued explanation remains readable.\n</span></pre>';
        const pre = document.querySelector<HTMLElement>('pre')!;
        const previous = document.querySelector<HTMLElement>('#previous')!;
        const next = document.querySelector<HTMLElement>('#next')!;
        const previousSource = previous.firstChild as Text;
        const nextSource = next.firstChild as Text;
        const originalHTML = pre.innerHTML;
        registerManpagePreparation(pre, [previous, next]);
        preparations.push({pre, paragraphs: [previous, next]});
        const view = document.defaultView!;
        const computedDescriptor = Object.getOwnPropertyDescriptor(view, 'getComputedStyle');
        Object.defineProperty(view, 'getComputedStyle', {configurable: true, value: (element: HTMLElement) => ({
            display: element.classList.contains('fluent-read-bilingual-content') ? 'block' : element.localName === 'span' ? 'inline' : 'block',
            borderLeftWidth: '0px', whiteSpace: element.style.getPropertyValue('white-space') || 'pre',
            getPropertyValue(property: string) {return element.style.getPropertyValue(property);},
        })});
        Object.defineProperty(pre, 'getBoundingClientRect', {configurable: true,
            value: () => ({left: 20, right: 660, width: 640, top: 0, bottom: 100, height: 100})});
        const createElement = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((...args) => {
            const element = createElement(...args);
            if (element.localName === 'span') Object.defineProperty(element, 'getBoundingClientRect', {configurable: true,
                value: () => ({left: 20, right: 660, width: 640, top: 0, bottom: 50, height: 50})});
            return element;
        });
        // 浏览器PRE中，前段换行后的inline UI会占用下一段首行；block UI不参与该行。
        const transientWidth = () => {
            const indicator = previous.querySelector<HTMLElement>('.fluent-read-loading,.fluent-read-retry-wrapper');
            const feedback = indicator?.closest<HTMLElement>('.fluent-read-manpage-feedback');
            return indicator && feedback?.style.getPropertyValue('display') !== 'block' ? kind === 'loading' ? 18 : 48 : 0;
        };
        Object.defineProperty(document, 'createRange', {configurable: true, value: () => {
            let text: Text, offset: number;
            return {setStart(node: Text, index: number) {text = node; offset = index;}, setEnd() {},
                getBoundingClientRect() {
                    const prefix = text.data.slice(0, offset);
                    const column = prefix.length - prefix.lastIndexOf('\n') - 1;
                    const shift = text === nextSource && !prefix.includes('\n') ? transientWidth() : 0;
                    const left = 20 + column * 10 + shift;
                    return {left, right: left + 10, width: 10, height: 16};
                }};
        }});
        try {
            const previousAttempt = beginTranslation(previous, 'bilingual', 'content', false, previousSource.data, [previousSource])!;
            if (kind === 'loading') setSpinner(previous, insertLoadingSpinner(previous));
            else {
                markTranslationError(previous, previousAttempt.state, previousAttempt.generation);
                setRetryWrapper(previous, insertFailedTip(previous, 'provider unavailable', () => true));
                setRenderedStyleAttribute(previous);
            }
            const nextAttempt = beginTranslation(next, 'bilingual', 'content', false, nextSource.data, [nextSource])!;
            markTranslationComplete(next, nextAttempt.state, nextAttempt.generation);
            const content = appendBilingualTranslation(next, '后一个参数的中文说明会先提交。');
            setBilingualContent(next, content);
            setRenderedStyleAttribute(next);
            expect(content.style.getPropertyValue('padding-left')).toBe('150px');
            expect(content.style.getPropertyValue('text-indent')).toBe('-40px');
            expect(transientWidth()).toBe(0);
            expect(restoreTranslation(previous)).toBe(true);
            // 前段 UI 消失后不触发额外重排也应准确；原问题会留下18px或retry宽度的误差。
            expect(Number.parseFloat(content.style.getPropertyValue('padding-left')) +
                Number.parseFloat(content.style.getPropertyValue('text-indent'))).toBe(110);
            expect(isTranslationArtifactCurrent(next, nextAttempt.state)).toBe(true);
            expect(next.querySelectorAll('.fluent-read-bilingual-content')).toHaveLength(1);
            expect(nextSource.data).toContain('%e  Following parameter');
            expect(restoreTranslation(next)).toBe(true);
            expect(pre.innerHTML).toBe(originalHTML);
            expect(previous.firstChild).toBe(previousSource);
            expect(next.firstChild).toBe(nextSource);
        } finally {
            if (computedDescriptor) Object.defineProperty(view, 'getComputedStyle', computedDescriptor);
            else Reflect.deleteProperty(view, 'getComputedStyle');
        }
    });
});


function activeFeedback(kind: 'loading' | 'retry') {
    const fixture = preparedParagraph();
    const original = fixture.pre.innerHTML;
    const attempt = beginTranslation(fixture.owner, 'bilingual', 'content', false, fixture.source.data, [fixture.source])!;
    let feedback: HTMLElement;
    if (kind === 'loading') {
        feedback = insertLoadingSpinner(fixture.owner);
        setSpinner(fixture.owner, feedback);
    } else {
        markTranslationError(fixture.owner, attempt.state, attempt.generation);
        feedback = insertFailedTip(fixture.owner, 'provider unavailable', () => true);
        setRetryWrapper(fixture.owner, feedback);
        setRenderedStyleAttribute(fixture.owner);
    }
    const inner = feedback.querySelector<HTMLElement>(kind === 'loading' ? '.fluent-read-loading' : '.fluent-read-retry-wrapper')!;
    return {...fixture, feedback, inner, state: attempt.state, original};
}

const cleanupEntries = ['owner', 'normalize', 'clear'] as const;
function cleanupFeedback(entry: typeof cleanupEntries[number], root: HTMLElement, inner: HTMLElement) {
    if (entry === 'owner') normalizeOrphanedTranslationOwner(inner);
    else if (entry === 'normalize') normalizeOrphanedTranslationArtifacts(root);
    else clearOrphanedTranslationArtifacts(root);
}

describe('man7嵌套反馈的孤儿清理所有权', () => {
    it.each(['loading', 'retry'].flatMap(kind => cleanupEntries.map(entry => ({kind: kind as 'loading' | 'retry', entry}))))(
        '三个清理入口均保留活跃反馈的外框、内层和WeakMap状态：%j', ({kind, entry}) => {
            const fixture = activeFeedback(kind);
            const outerHTML = fixture.feedback.outerHTML;
            cleanupFeedback(entry, fixture.pre, fixture.inner);
            expect(fixture.feedback.parentElement).toBe(fixture.owner);
            expect(fixture.inner.parentElement).toBe(fixture.feedback);
            expect(fixture.feedback.outerHTML).toBe(outerHTML);
            expect(getTranslationState(fixture.owner)).toBe(fixture.state);
            expect(fixture.owner.firstChild).toBe(fixture.source);
            expect(restoreTranslation(fixture.owner)).toBe(true);
            expect(fixture.pre.innerHTML).toBe(fixture.original);
        });

    it.each(['loading', 'retry'].flatMap(kind => cleanupEntries.map(entry => ({kind: kind as 'loading' | 'retry', entry}))))(
        '克隆无state反馈整块清理，不删活跃原反馈也不遗留空外框：%j', ({kind, entry}) => {
            const fixture = activeFeedback(kind);
            const clone = fixture.owner.cloneNode(true) as HTMLElement;
            clone.id = 'cloned-owner';
            fixture.pre.appendChild(clone);
            const source = clone.firstChild;
            const clonedFeedback = clone.querySelector<HTMLElement>('.fluent-read-manpage-feedback')!;
            const inner = clonedFeedback.querySelector<HTMLElement>(kind === 'loading' ? '.fluent-read-loading' : '.fluent-read-retry-wrapper')!;
            expect(getTranslationState(clone)).toBeUndefined();
            cleanupFeedback(entry, clone, inner);
            expect(clonedFeedback.isConnected).toBe(false);
            expect(clone.querySelector('.fluent-read-manpage-feedback')).toBeNull();
            expect(clone.querySelector('.fluent-read-loading,.fluent-read-retry-wrapper')).toBeNull();
            expect(clone.firstChild).toBe(source);
            expect(clone.textContent).toBe(fixture.source.data);
            expect(fixture.feedback.parentElement).toBe(fixture.owner);
            expect(fixture.inner.parentElement).toBe(fixture.feedback);
            expect(getTranslationState(fixture.owner)).toBe(fixture.state);
        });

    it.each(['normalize', 'clear'].flatMap(entry => ['loading', 'retry'].map(kind => ({entry, kind: kind as 'loading' | 'retry'}))))(
        'dirty root仅指向内层时仍以完整外框清理：%j', ({entry, kind}) => {
            const fixture = activeFeedback(kind);
            const clone = fixture.owner.cloneNode(true) as HTMLElement;
            clone.id = 'cloned-dirty-owner';
            fixture.pre.appendChild(clone);
            const feedback = clone.querySelector<HTMLElement>('.fluent-read-manpage-feedback')!;
            const inner = feedback.querySelector<HTMLElement>(kind === 'loading' ? '.fluent-read-loading' : '.fluent-read-retry-wrapper')!;
            if (entry === 'normalize') normalizeOrphanedTranslationArtifacts(inner);
            else clearOrphanedTranslationArtifacts(inner);
            expect(feedback.isConnected).toBe(false);
            expect(clone.querySelector('[data-fr-translation-owned="true"]')).toBeNull();
            expect(clone.firstChild!.nodeType).toBe(3);
        });

    it.each(['loading', 'retry'] as const)('全文恢复清理活跃及克隆%s反馈，保留每份原文节点', kind => {
        const fixture = activeFeedback(kind);
        const clone = fixture.owner.cloneNode(true) as HTMLElement;
        clone.id = 'clone-after-restore';
        fixture.pre.appendChild(clone);
        const clonedSource = clone.firstChild;
        restorePageTranslationContent();
        expect(getTranslationState(fixture.owner)).toBeUndefined();
        expect(fixture.pre.querySelector('.fluent-read-manpage-feedback,.fluent-read-loading,.fluent-read-retry-wrapper')).toBeNull();
        expect(fixture.owner.firstChild).toBe(fixture.source);
        expect(clone.firstChild).toBe(clonedSource);
        expect(clone.textContent).toBe(fixture.source.data);
        expect(clone.hasAttribute('data-fr-translation-failed')).toBe(false);
    });

    it('嵌套的明确反馈外框按最外层归属清理，脱离文档的外框不会被拆空', () => {
        document.body.innerHTML = '<p id="owner">Source<span class="fluent-read-manpage-feedback" data-fr-translation-owned="true"><span class="fluent-read-manpage-feedback" data-fr-translation-owned="true"><span class="fluent-read-loading" data-fr-translation-owned="true"></span></span></span></p>';
        const owner = document.querySelector<HTMLElement>('#owner')!;
        const feedback = owner.querySelector<HTMLElement>('.fluent-read-manpage-feedback')!;
        const inner = owner.querySelector<HTMLElement>('.fluent-read-loading')!;
        normalizeOrphanedTranslationOwner(inner);
        expect(owner.innerHTML).toBe('Source');
        expect(feedback.querySelector('.fluent-read-loading')).toBe(inner);
        expect(() => normalizeOrphanedTranslationOwner(feedback)).not.toThrow();
        expect(feedback.querySelector('.fluent-read-loading')).toBe(inner);
    });

    it('同名宿主class或任意owned标记不能升级为完整反馈所有权边界', () => {
        document.body.innerHTML = '<p id="source"><span id="host" class="fluent-read-manpage-feedback">Original host text<span class="fluent-read-loading" data-fr-translation-owned="true"></span></span>' +
            '<span id="arbitrary" data-fr-translation-owned="true">Arbitrary wrapper<span class="fluent-read-loading" data-fr-translation-owned="true"></span></span></p>';
        const host = document.querySelector<HTMLElement>('#host')!;
        const arbitrary = document.querySelector<HTMLElement>('#arbitrary')!;
        normalizeOrphanedTranslationArtifacts(document.querySelector('#source')!);
        expect(host.isConnected).toBe(true);
        expect(host.textContent).toBe('Original host text');
        expect(host.querySelector('.fluent-read-loading')).toBeNull();
        expect(arbitrary.isConnected).toBe(true);
        expect(arbitrary.textContent).toBe('Arbitrary wrapper');
        expect(arbitrary.querySelector('.fluent-read-loading')).toBeNull();
    });
});


describe('反馈孤儿边界与原文所有权', () => {
    it.each(cleanupEntries)('真实active owner被宿主复制反馈公开属性时，%s仍以WeakMap状态保护全部原文', entry => {
        const fixture = activeFeedback('loading');
        fixture.owner.classList.add('fluent-read-manpage-feedback');
        fixture.owner.setAttribute('data-fr-translation-owned', 'true');
        const original = fixture.owner.outerHTML;
        if (entry === 'owner') normalizeOrphanedTranslationOwner(fixture.owner);
        else if (entry === 'normalize') normalizeOrphanedTranslationArtifacts(fixture.pre);
        else clearOrphanedTranslationArtifacts(fixture.pre);
        expect(fixture.owner.parentElement).toBe(fixture.pre);
        expect(fixture.owner.outerHTML).toBe(original);
        expect(fixture.owner.firstChild).toBe(fixture.source);
        expect(fixture.feedback.parentElement).toBe(fixture.owner);
        expect(fixture.inner.parentElement).toBe(fixture.feedback);
        expect(getTranslationState(fixture.owner)).toBe(fixture.state);
    });

    it('没有明确孤儿产物的普通owner保留原文、宿主class和全部节点身份', () => {
        document.body.innerHTML = '<p id="ordinary" class="host-class">Ordinary original text <span>with inline details.</span></p>';
        const owner = document.querySelector<HTMLElement>('#ordinary')!;
        const html = owner.outerHTML;
        const nodes = [...owner.childNodes];
        normalizeOrphanedTranslationOwner(owner);
        expect(owner.outerHTML).toBe(html);
        expect([...owner.childNodes]).toEqual(nodes);
    });

    it('框架替换中的原始Text仍参与正文比较，独立反馈UI变化不改变同源判定', () => {
        const previousText = document.createTextNode('Original   source text.');
        const nextText = document.createTextNode('Original source text.');
        const previousFeedback = document.createElement('span');
        previousFeedback.className = 'fluent-read-manpage-feedback';
        previousFeedback.setAttribute('data-fr-translation-owned', 'true');
        previousFeedback.textContent = 'Old retry UI';
        const nextFeedback = previousFeedback.cloneNode(true) as HTMLElement;
        nextFeedback.textContent = 'New loading UI';
        const mutation = {type: 'childList', addedNodes: [nextText, nextFeedback], removedNodes: [previousText, previousFeedback]} as unknown as MutationRecord;
        expect(isTextEquivalentHostReplacement(mutation)).toBe(true);
        nextText.data = 'Changed original source.';
        expect(isTextEquivalentHostReplacement(mutation)).toBe(false);
    });
});
