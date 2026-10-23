import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';
import {
    collectLiveTranslationTextSlots,
    extractTranslationText,
    TranslationCandidateCore,
} from '@/src/core/translation/public';
import {createTranslationCore} from './helpers/translationCore';
import {
    classifyGenericCandidate,
    findTranslationControlOwner,
    getDirectInlineRuns,
    isTranslationControlElement,
} from '@/src/core/translation/layout';
import {maxComposedAncestorDepth} from '@/src/core/translation/dom';
import {
    beginTranslation,
    markTranslationComplete,
    restoreTranslation,
    setLiveTranslationSourceSnapshot,
    setTextSlotsApplied,
} from '@/src/features/full-page-translation/content/state';

const fixtureHTML = readFileSync(new URL('./fixtures/translation-pages/button-controls.html', import.meta.url), 'utf8');

function fixture(url = 'https://example.test/controls', scope: 'content' | 'all' = 'content') {
    const {document, window} = parseHTML(fixtureHTML);
    const core = createTranslationCore({url: new URL(url), scope});
    Object.defineProperty(window, 'getComputedStyle', {
        configurable: true,
        value: (element: Element) => ({
            display: element.getAttribute('data-display') ??
                (['SPAN', 'A'].includes(element.tagName) ? 'inline' : 'block'),
            getPropertyValue: () => '',
        }),
    });
    return {document, window, core};
}

describe('交互控件翻译所有权回归', () => {
    it.each((['content', 'all'] as const).flatMap(scope =>
        ['https://example.test/controls', 'https://github.com/FluentRead/FluentRead/pull/451'].map(url => ({scope, url}))))(
        '$scope 范围 $url 的嵌套 flex/grid 标签属于同一个单行控件候选', ({scope, url}) => {
            const {document, core} = fixture(url, scope);
            const candidates = core.discover(document);
            for (const id of ['merge-button', 'save-button', 'menu-action', 'split-button']) {
                const owner = document.getElementById(id)!;
                expect(candidates.filter((candidate) => owner.contains(candidate.element)))
                    .toEqual([expect.objectContaining({element: owner, kind: 'control', reason: 'generic-control'})]);
                expect(core.resolve(owner)).toMatchObject({element: owner, kind: 'control'});
                for (const label of owner.querySelectorAll('[data-display]')) {
                    expect(core.inspect(label).candidate).toBeNull();
                    expect(core.resolve(label.firstChild)).toMatchObject({element: owner, kind: 'control'});
                    expect(getDirectInlineRuns(label)).toEqual([]);
                }
                expect(getDirectInlineRuns(owner)).toEqual([]);
            }
            expect(candidates.find((candidate) => candidate.element.id === 'prose')?.kind).toBe('content');
            expect(candidates.some((candidate) => candidate.element.id === 'merge-menu')).toBe(false);
        },
    );

    it('按钮的译文复用文本节点，保留图标、点击、计数和恢复后再次翻译', () => {
        const {document, window, core} = fixture();
        const owner = document.getElementById('save-button')!;
        const originalHTML = owner.innerHTML;
        const originalNodes = Array.from(owner.querySelectorAll('*'));
        const click = vi.fn();
        owner.addEventListener('click', click);
        const candidate = core.resolve(owner.querySelector('.button-label'))!;
        expect(candidate.kind).toBe('control');

        for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
            const parts = collectLiveTranslationTextSlots(candidate.element, core.shouldStayOriginal);
            expect(parts.map((part) => part.source)).toEqual(['Save changes']);
            const nodes = parts.map((part) => part.node);
            const attempt = beginTranslation(candidate.element, 'bilingual', candidate.kind, false, 'Save changes', nodes)!;
            expect(markTranslationComplete(candidate.element, attempt.state, attempt.generation, false)).toBe(true);
            setLiveTranslationSourceSnapshot(candidate.element, nodes);
            parts[0]!.node.nodeValue = '保存更改';
            setTextSlotsApplied(candidate.element, nodes);

            expect(owner.querySelector('.button-label')?.textContent).toBe('保存更改');
            expect(owner.querySelector('.fluent-read-bilingual-content')).toBeNull();
            expect(Array.from(owner.querySelectorAll('*'))).toEqual(originalNodes);
            expect(owner.querySelector('[aria-hidden]')?.textContent).toBe('✓');
            expect(owner.getAttribute('href')).toBe('#saved');
            owner.querySelector('.button-label')!.dispatchEvent(new window.Event('click', {bubbles: true}));
            expect(click).toHaveBeenCalledTimes(attemptIndex + 1);
            restoreTranslation(candidate.element);
            expect(owner.innerHTML).toBe(originalHTML);
            expect(core.resolve(owner.firstChild)).toMatchObject({element: owner, kind: 'control'});
        }
        const split = document.getElementById('split-button')!;
        expect(collectLiveTranslationTextSlots(split, core.shouldStayOriginal).map((part) => part.source))
            .toEqual(['Review', 'changes']);
        expect(split.querySelector('.badge')?.textContent).toBe('23');
    });

    it.each(['content', 'all'] as const)(
        '%s 范围下同一排工具栏里的按钮、按钮化链接、表单标签和自定义控件都是替换式控件候选',
        (scope) => {
            const {document, core} = fixture('https://example.test/controls', scope);
            const candidates = core.discover(document);
            const kindOf = (id: string) => candidates.find((candidate) =>
                candidate.element === document.getElementById(id))?.kind;
            for (const id of ['button-link', 'hint-link', 'upload-label', 'custom-action', 'preview-tab']) {
                expect(kindOf(id), id).toBe('control');
                expect(core.resolve(document.getElementById(id)!.firstChild), id)
                    .toMatchObject({element: document.getElementById(id), kind: 'control'});
            }
            // 正文仍然是内容，保留上下双语对照。
            expect(kindOf('shell-prose')).toBe('content');
            expect(kindOf('prose')).toBe('content');
            // 句子形态的折叠问句在正文范围仍是要读的内容；全部节点范围本就把整页视为
            // 应用界面，这里保持既有语义不变。
            expect(kindOf('faq-question')).toBe(scope === 'all' ? 'control' : 'content');
        },
    );

    it('按钮型 input 的标签进入控件候选，具名 submit 与输入框内容保持不动', () => {
        const {document, core} = fixture();
        const candidates = core.discover(document);
        const byId = (id: string) => candidates.find((candidate) =>
            candidate.element === document.getElementById(id));

        for (const id of ['submit-anonymous', 'button-input', 'reset-input']) {
            expect(byId(id), id).toMatchObject({kind: 'control', reason: 'generic-control-value'});
        }
        expect(extractTranslationText(document.getElementById('button-input')!)).toBe('Preview changes');

        // 具名 submit 的 value 会随表单提交，改写会破坏站点动作；其余输入框是用户数据。
        expect(byId('submit-named')).toBeUndefined();
        expect(byId('text-input')).toBeUndefined();
        expect(byId('empty-submit')).toBeUndefined();
        expect(extractTranslationText(document.getElementById('text-input')!)).toBe('');
    });

    it('按钮语义判定覆盖原生标签、按钮型 input、ARIA 角色和按钮类名', () => {
        const {document} = fixture();
        for (const id of ['submit-anonymous', 'button-input', 'reset-input', 'merge-button',
            'button-link', 'preview-tab', 'menu-action']) {
            expect(isTranslationControlElement(document.getElementById(id)!), id).toBe(true);
        }
        // 具名 submit 的标签要随表单提交，不能按按钮改写。
        expect(isTranslationControlElement(document.getElementById('submit-named')!)).toBe(false);
        expect(isTranslationControlElement(document.getElementById('text-input')!)).toBe(false);
    });

    it('空标签和整句文案都不按控件替换，避免把正文压缩成单行译文', () => {
        const {document, core} = fixture();
        const toolbar = document.getElementById('toolbar')!;
        const empty = document.createElement('a');
        empty.setAttribute('href', '#empty');
        empty.setAttribute('data-display', 'inline-block');
        const sentence = document.createElement('a');
        sentence.setAttribute('href', '#sentence');
        sentence.setAttribute('data-display', 'inline-block');
        sentence.textContent = 'This release note explains every behaviour change that shipped this week';
        toolbar.append(empty, sentence);

        expect(classifyGenericCandidate(empty, core.shouldStayOriginal)).toBeNull();
        expect(classifyGenericCandidate(sentence, core.shouldStayOriginal)?.kind).not.toBe('control');
    });

    it('图标按钮旁的文字只解析到自己的内联段，不把无文字按钮并入其中', () => {
        const {document, core} = fixture();
        document.body.innerHTML = '<main><div id="row" data-display="block">Loose label' +
            '<button id="icon"><span aria-hidden="true">★</span></button></div></main>';
        const icon = document.getElementById('icon')!;
        // 只有图标的按钮没有可译文字，既不自成候选，也不会被旁边文字的内联段收编；
        // 指针命中它时回退到外层可读块，图标本身保持原样。
        expect(core.inspect(icon).candidate).toBeNull();
        expect(core.resolve(icon)).toMatchObject({element: document.getElementById('row'), kind: 'content'});
        expect(core.discover(document).some((candidate) =>
            candidate.nodes?.includes(icon as unknown as ChildNode))).toBe(false);
    });

    it('显式非控件角色、不可聚焦容器和非法 tabindex 不会被当成按钮', () => {
        const {document, core} = fixture();
        for (const id of ['decorative', 'broken-focus', 'focus-shell']) {
            const element = document.getElementById(id)!;
            expect(isTranslationControlElement(element), id).toBe(false);
            expect(core.discover(document).some((candidate) =>
                candidate.element === element && candidate.kind === 'control'), id).toBe(false);
        }
    });

    it('宿主动态添加或移除按钮角色时重新计算标签的所有权', () => {
        const {document, core} = fixture();
        const owner = document.getElementById('menu-action')!;
        const label = owner.firstElementChild!;
        expect(core.resolve(label)?.element).toBe(owner);
        owner.removeAttribute('role');
        expect(core.resolve(label)).toMatchObject({element: label, kind: 'content'});
        owner.setAttribute('role', ' BUTTON ');
        expect(core.discover(owner)).toEqual([expect.objectContaining({element: owner, kind: 'control'})]);
        expect(core.resolve(label)).toMatchObject({element: owner, kind: 'control'});
    });

    it('只重扫新出现的内部标签时仍发现整个控件，并拒绝提升受保护子树', () => {
        const {document, core} = fixture();
        const owner = document.getElementById('merge-button')!;
        const label = owner.querySelector('.button-label')!;
        label.textContent = '';
        expect(core.discover(label)).toEqual([]);
        label.textContent = 'Merge pull request';
        expect(core.discover(label)).toEqual([expect.objectContaining({element: owner, kind: 'control'})]);
        label.setAttribute('translate', 'no');
        expect(core.discover(label)).toEqual([]);
        label.removeAttribute('translate');
        const excluded = new TranslationCandidateCore({adapters: [{
            id: 'blocked-label', matches: () => true,
            decide: (element) => element === label
                ? {kind: 'prune-subtree', reason: 'controlled-label'}
                : {kind: 'pass'},
        }]});
        expect(excluded.discover(label)).toEqual([]);
    });

    it('嵌套操作按钮与外层块级标签分别拥有文本，全文和悬浮都不重复吞并整个卡片', () => {
        const {document, core} = fixture();
        document.body.innerHTML = '<main><div id="card" role="button"><div id="label">Open details</div><button id="menu">More options</button></div></main>';
        const label = document.getElementById('label')!;
        const menu = document.getElementById('menu')!;
        expect(core.discover(document)).toEqual([
            expect.objectContaining({element: label, kind: 'control'}),
            expect.objectContaining({element: menu, kind: 'control'}),
        ]);
        expect(core.resolve(label.firstChild)).toMatchObject({element: label, kind: 'control'});
        expect(core.resolve(menu.firstChild)).toMatchObject({element: menu, kind: 'control'});
        expect(core.resolve(document.getElementById('card'))).toBeNull();
    });

    it('嵌套控件旁的直接文字只物化自己的 control run，保留子按钮原位与图标身份', () => {
        const {document, core} = fixture();
        document.body.innerHTML = '<main><div id="card" role="button">Open details <span aria-hidden="true">★</span><button id="menu">More options</button> now</div></main>';
        const owner = document.getElementById('card')!;
        const menu = document.getElementById('menu')!;
        const icon = owner.querySelector('[aria-hidden]')!;
        const candidates = core.discover(document);
        const runs = candidates.filter((candidate) => candidate.element === owner);
        expect(candidates.filter((candidate) => candidate.element === menu))
            .toEqual([expect.objectContaining({kind: 'control'})]);
        expect(runs).toHaveLength(2);
        for (const run of runs) {
            expect(run.kind).toBe('control');
            expect(run.nodes).not.toContain(menu);
            expect(core.resolve(run.nodes![0])).toMatchObject({element: owner, kind: 'control', nodes: run.nodes});
        }
        const segment = document.createElement('span');
        segment.setAttribute('data-fr-translation-segment', 'true');
        owner.insertBefore(segment, owner.firstChild);
        for (const node of runs[0]!.nodes!) segment.appendChild(node);
        expect(core.resolve(segment.firstChild)).toMatchObject({element: segment, kind: 'control'});
        expect(menu.parentElement).toBe(owner);
        expect(owner.querySelector('[aria-hidden]')).toBe(icon);
        expect(icon.textContent).toBe('★');
    });

    it('异常宽控件的嵌套边界检查有界，避免整体翻译吞并未经检查的子控件', () => {
        const {document} = fixture();
        const owner = document.createElement('button');
        owner.append('Open details');
        for (let index = 0; index < 2049; index += 1) owner.appendChild(document.createElement('span'));
        document.body.appendChild(owner);
        expect(classifyGenericCandidate(owner)).toBeNull();
    });

    it('精确适配器的控件内部标签默认继承 control，并继续遵守排除规则', () => {
        const {document} = fixture();
        const owner = document.getElementById('merge-button')!;
        const label = owner.querySelector('.button-label')!;
        const core = new TranslationCandidateCore({adapters: [{
            id: 'button-labels', matches: () => true,
            decide: (element) => element === label
                ? {kind: 'force-target', reason: 'exact-label'}
                : {kind: 'pass'},
        }]});
        expect(core.inspect(label).candidate).toMatchObject({element: label, kind: 'control'});
        expect(core.discover(owner)).toEqual([expect.objectContaining({element: label, kind: 'control'})]);
        owner.setAttribute('translate', 'no');
        expect(core.discover(owner)).toEqual([]);
        expect(core.resolve(label)).toBeNull();
    });

    it('控件边界沿开放 Shadow DOM 继承，同时限制异常深度', () => {
        const {document} = fixture();
        const owner = document.createElement('div');
        owner.setAttribute('role', 'button');
        document.body.appendChild(owner);
        const shadow = owner.attachShadow({mode: 'open'});
        const label = document.createElement('div');
        label.textContent = 'Open settings';
        shadow.appendChild(label);
        expect(findTranslationControlOwner(label)).toBe(owner);
        expect(classifyGenericCandidate(label)).toBeNull();
        const detached = document.createElement('div');
        expect(findTranslationControlOwner(detached)).toBeNull();
        let nested = owner;
        for (let index = 0; index <= maxComposedAncestorDepth; index += 1) {
            const child = document.createElement('div');
            nested.appendChild(child);
            nested = child;
        }
        expect(findTranslationControlOwner(nested)).toBeNull();
    });
});
