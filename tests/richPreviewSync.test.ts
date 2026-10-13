/**
 * @file tests/richPreviewSync.test.ts
 * 文件职责：验证富文本预览在译文逐段到达时原位更新，而不是重新载入整页。
 * 主要内容：目录从预览标题收集并把原文与译文配对，目录项能滚动到对应标题，翻译进行中的标记可以设置与清除；未变化的节点保持同一个对象（滚动位置与选区因此不丢），文字、属性、新增、替换和删除的子树按新 HTML 同步；预览框不可访问或无法解析时返回 false；刷新间隔随文档规模放慢并有上下限。
 * 模块边界：使用 linkedom 的真实 DOM 语义测试同步算法；预览 HTML 的生成与页面何时刷新由各自的测试覆盖。
 */
import {parseHTML} from 'linkedom';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {collectRichOutline, markRichPreviewBusy, richPreviewInterval, richPreviewPosition, scrollRichOutline, syncPreviewChildren, syncRichPreview} from '@/src/features/document-translation/ui/richPreviewSync';

const page = (body: string, attributes = '') => parseHTML(`<!doctype html><html><head></head><body${attributes}>${body}</body></html>`).document as unknown as Document;
const parse = (html: string) => parseHTML(html).document as unknown as Document;

afterEach(() => vi.unstubAllGlobals());

describe('rich preview in-place sync', () => {
    it('adds an arriving translation without touching the units around it', () => {
        const current = page('<article><section class="unit"><p class="source">One</p></section><section class="unit"><p class="source">Two</p></section></article>');
        const frame = {contentDocument: current};
        const first = current.querySelector('section')!, second = current.querySelectorAll('section')[1], sourceNode = second.firstChild;
        expect(syncRichPreview(frame, '<!doctype html><html><body><article><section class="unit"><p class="source">One</p></section><section class="unit done"><p class="source">Two</p><p class="translation">二</p></section></article></body></html>', parse)).toBe(true);
        expect(current.querySelector('section')).toBe(first);
        expect(current.querySelectorAll('section')[1]).toBe(second);
        expect(second.firstChild).toBe(sourceNode);
        expect(second.getAttribute('class')).toBe('unit done');
        expect(second.querySelector('.translation')!.textContent).toBe('二');
    });

    it('updates text, replaces nodes of another kind, removes surplus nodes and syncs body attributes', () => {
        const current = page('<p id="a" data-old="1">old<!--note--></p><p>second</p><div>third</div><span>extra</span>', ' class="light" data-stale="1"');
        const paragraph = current.querySelector('#a')!;
        expect(syncRichPreview({contentDocument: current}, '<html><body class="dark"><p id="a" lang="zh">new<!--changed--></p><h2>heading</h2>plain text</body></html>', parse)).toBe(true);
        expect(current.body.getAttribute('class')).toBe('dark');
        expect(current.body.hasAttribute('data-stale')).toBe(false);
        expect(current.querySelector('#a')).toBe(paragraph);
        expect(paragraph.getAttribute('lang')).toBe('zh');
        expect(paragraph.hasAttribute('data-old')).toBe(false);
        expect(paragraph.firstChild!.nodeValue).toBe('new');
        expect(paragraph.lastChild!.nodeValue).toBe('changed');
        expect(Array.from(current.body.childNodes, node => node.nodeName)).toEqual(['P', 'H2', '#text']);
        expect(current.body.textContent).toBe('newheadingplain text');
        // 内容相同时什么都不改写。
        const heading = current.querySelector('h2')!, text = heading.firstChild!;
        syncPreviewChildren(current.body, parse('<html><body class="dark"><p id="a" lang="zh">new<!--changed--></p><h2>heading</h2>plain text</body></html>').body);
        expect(current.querySelector('h2')).toBe(heading);
        expect(heading.firstChild).toBe(text);
    });

    it('reports failure when the frame is missing, not loaded or the markup cannot be parsed', () => {
        const current = page('<p>kept</p>');
        expect(syncRichPreview(null, '<p>x</p>', parse)).toBe(false);
        expect(syncRichPreview({}, '<p>x</p>', parse)).toBe(false);
        expect(syncRichPreview({contentDocument: {body: null} as unknown as Document}, '<p>x</p>', parse)).toBe(false);
        expect(syncRichPreview({contentDocument: current}, '<p>x</p>', () => null)).toBe(false);
        // 没有浏览器解析器的环境同样退回整页载入。
        expect(syncRichPreview({contentDocument: current}, '<p>x</p>')).toBe(false);
        expect(current.body.innerHTML).toBe('<p>kept</p>');
        vi.stubGlobal('DOMParser', class {parseFromString(html: string) {return parse(html);}});
        expect(syncRichPreview({contentDocument: current}, '<html><body><p>browser</p></body></html>')).toBe(true);
        expect(current.body.innerHTML).toBe('<p>browser</p>');
    });

    it('collects an outline that pairs each heading with its translation in every preview structure', () => {
        const markdown = page('<article><section><h1 class="reader-source">Guide</h1><h1 class="reader-translation fluentread-translation">指南</h1></section><section><h2 class="reader-source">Not yet translated</h2></section><section><h2 class="reader-translation fluentread-translation">只有译文</h2></section><h3>  </h3><section><h3 class="reader-source">Deep   title</h3><p>gap</p></section><section><h3 class="fluentread-translation">不相邻的译文标题</h3></section></article>');
        expect(collectRichOutline({contentDocument: markdown})).toEqual([
            {index: 0, level: 1, source: 'Guide', translation: '指南'},
            {index: 2, level: 2, source: 'Not yet translated', translation: ''},
            {index: 3, level: 2, source: '只有译文', translation: ''},
            {index: 5, level: 3, source: 'Deep title', translation: ''},
            {index: 6, level: 3, source: '不相邻的译文标题', translation: ''},
        ]);
        const html = page('<h1>Chapter one<span data-fluent-read-document-translation="true">第一章</span></h1><h2>Plain</h2>');
        expect(collectRichOutline({contentDocument: html})).toEqual([{index: 0, level: 1, source: 'Chapter one', translation: '第一章'}, {index: 1, level: 2, source: 'Plain', translation: ''}]);
        expect(collectRichOutline(null)).toEqual([]);
        expect(collectRichOutline({contentDocument: {body: null} as unknown as Document})).toEqual([]);
    });

    it('scrolls to an outline heading and marks the preview as translating', () => {
        const current = page('<h1>One</h1><p>text</p><h2>Two</h2>');
        const scrolled: string[] = [];
        current.querySelectorAll('h1,h2').forEach(heading => {(heading as unknown as {scrollIntoView: (options: unknown) => void}).scrollIntoView = () => {scrolled.push(heading.textContent!);};});
        expect(scrollRichOutline({contentDocument: current}, 1)).toBe(true);
        expect(scrolled).toEqual(['Two']);
        expect(scrollRichOutline({contentDocument: current}, 9)).toBe(false);
        expect(scrollRichOutline(undefined, 0)).toBe(false);
        markRichPreviewBusy({contentDocument: current}, true);
        expect(current.body.hasAttribute('data-translating')).toBe(true);
        markRichPreviewBusy({contentDocument: current}, false);
        expect(current.body.hasAttribute('data-translating')).toBe(false);
        expect(() => markRichPreviewBusy(null, true)).not.toThrow();
    });

    it('reports how far the preview has been scrolled', () => {
        const at = (scrollTop: number, scrollHeight: number) => ({contentDocument: {scrollingElement: {scrollTop, scrollHeight}} as unknown as Document});
        expect(richPreviewPosition(at(3000, 12000))).toBe(0.25);
        expect(richPreviewPosition(at(99999, 12000))).toBe(1);
        expect(richPreviewPosition(at(-5, 12000))).toBe(0);
        expect(richPreviewPosition(at(10, 0))).toBe(0);
        expect(richPreviewPosition({contentDocument: {scrollingElement: null} as unknown as Document})).toBe(0);
        expect(richPreviewPosition(null)).toBe(0);
    });

    it('slows the refresh down for long documents within fixed bounds', () => {
        expect(richPreviewInterval(0)).toBe(250);
        expect(richPreviewInterval(4000)).toBe(500);
        expect(richPreviewInterval(1_000_000)).toBe(2000);
    });
});
