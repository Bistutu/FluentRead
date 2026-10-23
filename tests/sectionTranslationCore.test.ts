import {parseHTML} from 'linkedom';
import {describe, expect, it, vi} from 'vitest';
import {
    describeSectionScope,
    expandSectionElement,
    isSectionPickerUi,
    resolveSectionElement,
    resolveSectionLabel,
    type SectionGeometry,
    type SectionLabelSummary,
    type SectionRect,
} from '@/src/features/section-translation/core';
import {TranslationCandidateCore} from '@/src/core/translation/public';

const PAGE = `<html><body>
<div id="app">
  <div id="same-box">
    <article id="readme" class="markdown-body entry-content">
      <p id="para">Hello <strong id="bold">world</strong> <a id="link" href="#">link</a></p>
      <p id="translated">Source<span class="fluent-read-bilingual-content" data-fr-translation-owned="true"><span id="translation">译文</span></span></p>
      <figure id="figure"><img id="image" alt=""><figcaption>Caption</figcaption></figure>
      <ul id="list"><li id="item"><button id="button"><svg id="icon"><path id="path"></path></svg></button></li></ul>
      <div id="collapsed"><span id="collapsed-text">tiny</span></div>
      <div id="contents-wrapper"><div id="contents-child">text</div></div>
    </article>
  </div>
</div>
<div id="fluent-read-floating-ball-container"><span id="ball-label">ball</span></div>
<div data-fluent-read-ui="section-picker"><div id="picker-part"></div></div>
</body></html>`;

function setup(overrides: Record<string, {display?: string; rect?: SectionRect}> = {}) {
    const {document} = parseHTML(PAGE);
    const byId = (id: string) => document.getElementById(id)!;
    const display = new Map<Element, string>([
        [byId('bold'), 'inline'],
        [byId('link'), 'inline'],
        [byId('icon'), 'inline'],
        [byId('path'), 'inline'],
        [byId('button'), 'inline-block'],
        [byId('image'), 'inline'],
        [byId('collapsed-text'), 'inline'],
        [byId('contents-wrapper'), 'contents'],
        [byId('translation'), 'inline'],
    ]);
    const rects = new Map<Element, SectionRect>([
        [byId('app'), {left: 0, top: 0, width: 1000, height: 3000}],
        [byId('same-box'), {left: 20, top: 40, width: 800, height: 2000}],
        [byId('readme'), {left: 20, top: 40, width: 800, height: 2000}],
        [byId('collapsed'), {left: 20, top: 900, width: 800, height: 0}],
    ]);
    for (const [id, value] of Object.entries(overrides)) {
        if (value.display !== undefined) display.set(byId(id), value.display);
        if (value.rect) rects.set(byId(id), value.rect);
    }
    const geometry: SectionGeometry = {
        display: (element) => display.get(element) ?? 'block',
        rect: (element) => rects.get(element) ?? {left: 30, top: 60, width: 400, height: 40},
    };
    return {document, byId, geometry};
}

describe('局部翻译区域判定', () => {
    it('命中行内文字时收敛到最近的块级段落，而不是高亮单个词', () => {
        const {byId, geometry} = setup();
        expect(resolveSectionElement(byId('bold'), geometry)).toBe(byId('para'));
        expect(resolveSectionElement(byId('link'), geometry)).toBe(byId('para'));
        expect(resolveSectionElement(byId('para'), geometry)).toBe(byId('para'));
    });

    it('表单命名控件遮蔽 tagName 时仍能描述和扩大选区', () => {
        const {document, byId, geometry} = setup();
        const form = document.createElement('form');
        form.innerHTML = '<input name="tagName"><p>Readable source in a form</p>';
        byId('readme').appendChild(form);
        Object.defineProperty(form, 'tagName', {value: form.querySelector('input')});
        expect(resolveSectionElement(form, geometry)).toBe(form);
        expect(describeSectionScope(form)).toBe('sectionTranslation.scope.region');
        expect(expandSectionElement(form, geometry)).toBe(byId('readme'));
    });

    it('命中译文、图片和图标时回到它们所在的内容块', () => {
        const {byId, geometry} = setup();
        expect(resolveSectionElement(byId('translation'), geometry)).toBe(byId('translated'));
        expect(resolveSectionElement(byId('image'), geometry)).toBe(byId('figure'));
        expect(resolveSectionElement(byId('path'), geometry)).toBe(byId('item'));
    });

    it('跳过零尺寸与 display: contents 的包装层', () => {
        const {byId, geometry} = setup();
        expect(resolveSectionElement(byId('collapsed-text'), geometry)).toBe(byId('readme'));
        expect(resolveSectionElement(byId('contents-child'), geometry)).toBe(byId('contents-child'));
        const hidden = setup({'contents-child': {display: 'none'}});
        expect(resolveSectionElement(hidden.byId('contents-child'), hidden.geometry)).toBe(hidden.byId('readme'));
        // 取不到计算样式时按块级处理，不会因此丢失可选区域。
        const unknown = setup({para: {display: ''}});
        expect(resolveSectionElement(unknown.byId('para'), unknown.geometry)).toBe(unknown.byId('para'));
    });

    it('FluentRead 自己的界面、空命中与只剩 body 时不产生选区', () => {
        const {document, byId, geometry} = setup();
        expect(resolveSectionElement(null, geometry)).toBeNull();
        expect(resolveSectionElement(byId('ball-label'), geometry)).toBeNull();
        expect(resolveSectionElement(byId('picker-part'), geometry)).toBeNull();
        expect(resolveSectionElement(document.body, geometry)).toBeNull();
        expect(resolveSectionElement(document.documentElement, geometry)).toBeNull();
        expect(isSectionPickerUi(byId('picker-part'))).toBe(true);
        expect(isSectionPickerUi(byId('para'))).toBe(false);
        // 没有 closest 的节点（如文本节点被当作元素传入）不会抛错。
        expect(isSectionPickerUi({} as Element)).toBe(false);
    });

    it('向外扩大时跳过盒子完全重合的包装层，到页面根部为止', () => {
        const {byId, geometry} = setup();
        expect(expandSectionElement(byId('para'), geometry)).toBe(byId('readme'));
        // readme 与 same-box 盒子重合，一次扩大直接到达真正更大的 app。
        expect(expandSectionElement(byId('readme'), geometry)).toBe(byId('app'));
        expect(expandSectionElement(byId('app'), geometry)).toBeNull();
        // 中间的行内或零尺寸祖先不作为扩大结果。
        expect(expandSectionElement(byId('collapsed-text'), geometry)).toBe(byId('readme'));
        // 落在 FluentRead 界面内部时不会扩大到界面宿主之外。
        expect(expandSectionElement(byId('picker-part'), geometry)).toBeNull();
        // 脱离文档的节点链走到尽头时同样停止扩大。
        const {document} = setup();
        const detached = document.createElement('section');
        const child = document.createElement('p');
        detached.appendChild(child);
        expect(expandSectionElement(child, geometry)).toBeNull();
    });

    it.each([false, true])('界面宿主内的开放 Shadow DOM 不参与选区或扩大（嵌套：%s）', (nested) => {
        const {document, byId, geometry} = setup();
        const host = byId('fluent-read-floating-ball-container');
        const root = host.attachShadow({mode: 'open'});
        const wrapper = document.createElement('section');
        const inner = document.createElement('p');
        root.appendChild(wrapper);
        if (nested) wrapper.attachShadow({mode: 'open'}).appendChild(inner);
        else wrapper.appendChild(inner);
        expect(isSectionPickerUi(inner)).toBe(true);
        expect(resolveSectionElement(inner, geometry)).toBeNull();
        expect(expandSectionElement(inner, geometry)).toBeNull();
    });

    it('已经脱离文档的译文工件不会把空父级传给选区判定', () => {
        const {document, geometry} = setup();
        const artifact = document.createElement('span');
        artifact.className = 'fluent-read-bilingual-content';
        expect(resolveSectionElement(artifact, geometry)).toBeNull();
    });

    it.each([512, 513])('解析超深行内树只读取前 512 个元素（目标深度：%s）', (depth) => {
        const {document} = setup();
        const region = document.createElement('section');
        document.body.appendChild(region);
        let hit: Element = region;
        for (let index = 1; index < depth; index++) {
            const next = document.createElement('span');
            hit.appendChild(next);
            hit = next;
        }
        const display = vi.fn((element: Element) => element === region ? 'block' : 'inline');
        const geometry = {display, rect: () => ({left: 0, top: 0, width: 100, height: 100})};
        expect(resolveSectionElement(hit, geometry)).toBe(depth === 512 ? region : null);
        expect(display.mock.calls.length).toBeLessThanOrEqual(512);
    });

    it.each([512, 513])('扩大超深同盒包装树只读取前 512 个祖先（目标深度：%s）', (depth) => {
        const {document} = setup();
        const region = document.createElement('section');
        document.body.appendChild(region);
        let inner: Element = region;
        for (let index = 0; index < depth; index++) {
            const next = document.createElement('div');
            inner.appendChild(next);
            inner = next;
        }
        const display = vi.fn(() => 'block');
        const geometry = {display, rect: (element: Element) => ({left: 0, top: 0, width: element === region ? 200 : 100, height: 100})};
        expect(expandSectionElement(inner, geometry)).toBe(depth === 512 ? region : null);
        expect(display.mock.calls.length).toBeLessThanOrEqual(512);
    });


});

describe('局部翻译范围语义', () => {
    it.each([
        ['paragraph', ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'li', 'figcaption', 'dt', 'dd']],
        ['list', ['ul', 'ol', 'dl']],
        ['table', ['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th']],
        ['article', ['article', 'main']],
        ['region', ['section', 'div', 'aside', 'figure', 'b']],
    ])('用 %s 阅读语义描述范围，不泄露 HTML id 与 class', (scope, tags) => {
        const {document} = setup();
        for (const tag of tags) {
            const element = document.createElement(tag);
            element.id = 'internal-generated-id';
            element.className = 'implementation-details';
            expect(describeSectionScope(element)).toBe(`sectionTranslation.scope.${scope}`);
        }
    });


});

describe('局部翻译标签文案', () => {
    const summary = (overrides: Partial<SectionLabelSummary>): SectionLabelSummary => ({
        total: 0, active: 0, pending: 0, truncated: false, action: 'translate', ...overrides,
    });

    it('按点击结果区分翻译、恢复原文与无事可做，并使用单数变体', () => {
        expect(resolveSectionLabel(summary({action: 'empty'}))).toEqual({key: 'sectionTranslation.label.empty', tone: 'muted'});
        expect(resolveSectionLabel(summary({action: 'settled', total: 2}))).toEqual({key: 'sectionTranslation.label.settled', tone: 'muted'});
        expect(resolveSectionLabel(summary({action: 'restore', active: 3, total: 3})))
            .toEqual({key: 'sectionTranslation.label.restore', params: {count: 3}, tone: 'restore'});
        expect(resolveSectionLabel(summary({action: 'restore', active: 0, total: 1})))
            .toEqual({key: 'sectionTranslation.label.restoreOne', params: {count: 1}, tone: 'restore'});
        expect(resolveSectionLabel(summary({pending: 5, total: 5})))
            .toEqual({key: 'sectionTranslation.label.translate', params: {count: 5}, tone: 'translate'});
        expect(resolveSectionLabel(summary({pending: 1, total: 1})))
            .toEqual({key: 'sectionTranslation.label.translateOne', params: {count: 1}, tone: 'translate'});
    });

    it('已有部分译文时提示翻译剩余段落，预览被截断时显示下限', () => {
        expect(resolveSectionLabel(summary({pending: 4, active: 2, total: 6})))
            .toEqual({key: 'sectionTranslation.label.translateRemaining', params: {count: 4}, tone: 'translate'});
        expect(resolveSectionLabel(summary({pending: 1, active: 2, total: 3})))
            .toEqual({key: 'sectionTranslation.label.translateRemainingOne', params: {count: 1}, tone: 'translate'});
        expect(resolveSectionLabel(summary({pending: 12, total: 30, truncated: true})))
            .toEqual({key: 'sectionTranslation.label.translateMany', params: {count: 30}, tone: 'translate'});
        expect(resolveSectionLabel(summary({truncated: true})))
            .toEqual({key: 'sectionTranslation.label.translateLarge', tone: 'translate'});
    });
});

describe('翻译核心的页面框架判定', () => {
    const {document} = parseHTML(`<html><body>
        <header id="header"><h1>Title</h1><div id="in-header">menu</div></header>
        <main id="main"><article><aside id="note">note</aside></article><div id="in-main">body</div></main>
        <aside id="sidebar"><div id="in-sidebar">links</div></aside>
        <nav id="nav"><div id="in-nav">nav</div></nav>
    </body></html>`);
    const byId = (id: string) => document.getElementById(id)!;
    const url = new URL('https://example.com/');

    it('正文范围下识别 header/footer/nav/aside 自身与其内部元素', () => {
        const core = new TranslationCandidateCore({url, scope: 'content'});
        expect(core.isWithinStructuralRegion(byId('header'))).toBe(true);
        expect(core.isWithinStructuralRegion(byId('in-header'))).toBe(true);
        expect(core.isWithinStructuralRegion(byId('in-sidebar'))).toBe(true);
        expect(core.isWithinStructuralRegion(byId('in-main'))).toBe(false);
        // 文章内的 aside 是正文的一部分，不属于页面框架。
        expect(core.isWithinStructuralRegion(byId('note'))).toBe(false);
    });

    it('开启侧边栏翻译或使用全部节点范围时不再视为框架', () => {
        const sidebars = new TranslationCandidateCore({url, scope: 'content', includeSidebarRegions: true});
        expect(sidebars.isWithinStructuralRegion(byId('in-sidebar'))).toBe(false);
        expect(sidebars.isWithinStructuralRegion(byId('nav'))).toBe(false);
        expect(sidebars.isWithinStructuralRegion(byId('in-header'))).toBe(true);
        const all = new TranslationCandidateCore({url, scope: 'all'});
        expect(all.isWithinStructuralRegion(byId('in-header'))).toBe(false);
    });
});
