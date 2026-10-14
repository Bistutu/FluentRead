import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';

import {
    createDocumentDownloadName,
    formatJsonPath,
    getDocumentFormat,
    parseDocument,
    renderDocument,
    type ParsedDocument,
} from '@/src/features/document-translation/core/document';
import {createDocumentPreviewHtml} from '@/src/features/document-translation/core/preview';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('document translation edge contracts', () => {
    it('restores adjacent nested Markdown link and emphasis markers without losing protected code', () => {
        const document = parseDocument('nested.md', '*emphasis* [link](https://example.test/path) `code`', {markdownSentences: true});
        expect(document.segments[0].source).toBe('<g1>emphasis</g1> <g2>link</g2> <g3/>');
        expect(renderDocument(document, ['<g2><g1>链接强调</g1></g2>和<g3/>'], 'translated'))
            .toBe('[*链接强调*](https://example.test/path)和`code`');
    });

    it.each(['</g1>译文<g2/><g3/>', '</g99><g1>译文</g1><g2/><g3/>'])
    ('keeps code and URL when a Markdown translation starts with a misplaced closing marker: %s', translation => {
        const document = parseDocument('broken.md', '*emphasis* `code` https://example.test/path', {markdownSentences: true});
        expect(renderDocument(document, [translation], 'translated')).toBe('译文 `code` https://example.test/path');
    });

    it.each(['', '   ', '\n\t'])('empty reviewed subtitle falls back to source for partial export (%j)', blank => {
        const source = '1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nPending\r\n';
        const document = parseDocument('episode.srt', source);
        const output = renderDocument(document, ['你好', blank], 'translated');
        expect(output).toBe(source.replace('Hello', '你好'));
        expect(parseDocument('episode.srt', output).segments.map(segment => segment.source)).toEqual(['你好', 'Pending']);
        const json = parseDocument('sample.json', '{"title":"Hello"}');
        expect(JSON.parse(renderDocument(json, [blank], 'translated'))).toEqual({title: 'Hello'});
    });

    it('覆盖无扩展名、CR 换行、非常规 JSON 路径和无扩展名下载名', () => {
        expect(getDocumentFormat('README')).toBeNull();
        expect(parseDocument('notes.txt', 'One\r\nTwo\nThree\rFour').segments.map(({source}) => source))
            .toEqual(['One', 'Two', 'Three', 'Four']);
        expect(formatJsonPath(['normal', 'with-dash', 2])).toBe('$.normal["with-dash"][2]');
        expect(createDocumentDownloadName('README', 'translated')).toBe('README.translated');
        expect(createDocumentDownloadName('', 'bilingual')).toBe('.bilingual');
        expect(() => parseDocument('unknown.yaml', 'value')).toThrow('暂不支持该文件格式');
    });

    it('浏览器 DOM 可用时使用 textarea 解码 HTML 实体', () => {
        const textarea = {
            value: '',
            set innerHTML(value: string) {
                this.value = value === 'A&amp;B' ? 'A&B' : value;
            },
        };
        vi.stubGlobal('document', {createElement: () => textarea});

        expect(parseDocument('page.html', '<p>A&amp;B</p>').segments[0].source).toBe('A&B');
    });

    it('容忍未知或无效实体、HTML 注释、伪标签和未闭合保护标签', () => {
        expect(parseDocument('page.html', '<p>&bogus; &#0; &#x41;</p>').segments[0].source)
            .toBe('&bogus; � A');
        expect(parseDocument('page.html', '<!-- note --><p>Hello</p>').segments.map(({source}) => source))
            .toEqual(['Hello']);
        expect(parseDocument('page.html', '<!-- unfinished').segments).toEqual([]);
        expect(parseDocument('page.html', '2 < 3 <p>Hello</p>').segments.map(({source}) => source))
            .toEqual(['2 < 3', 'Hello']);
        expect(parseDocument('page.html', '<script>const value = 1').segments).toEqual([]);
        expect(parseDocument('page.html', '<p title="unfinished"').segments[0].source)
            .toBe('<p title="unfinished"');
    });

    it('把空字幕、损坏 ASS 行和无时间 LRC 行保留为字面量', () => {
        const emptyCue = parseDocument('empty.srt', '00:00:01,000 --> 00:00:02,000\n\n');
        expect(emptyCue.segments).toEqual([]);
        expect(renderDocument(emptyCue, [], 'translated')).toContain('00:00:01,000 --> 00:00:02,000');
        const trailingNumber = parseDocument('trailing.srt', '00:00:01,000 --> 00:00:02,000\nFirst\n2');
        expect(trailingNumber.segments[0].source).toBe('First\n2');

        const malformedAss = parseDocument('broken.ass', 'Dialogue: 0,too,few,fields\nComment: keep');
        expect(malformedAss.segments).toEqual([]);
        expect(renderDocument(malformedAss, [], 'translated')).toContain('Dialogue: 0,too,few,fields');

        const lrc = parseDocument('lyrics.lrc', 'plain line\n[00:01.00]\n');
        expect(lrc.segments).toEqual([]);
        expect(renderDocument(lrc, [], 'translated')).toBe('plain line\n[00:01.00]\n');
    });

    it('保留字幕标签、空译文以及非分组 Markdown 的双语结构', () => {
        const subtitle = parseDocument('episode.srt', '00:00:01,000 --> 00:00:02,000\n<i>Hello</i>\n');
        expect(renderDocument(subtitle, ['你好'], 'bilingual')).toContain('<i>你好</i>');
        expect(renderDocument(subtitle, [''], 'translated')).toContain('<i>Hello</i>');

        const markdown: ParsedDocument = {
            fileName: 'manual.md',
            format: 'markdown',
            label: 'Markdown 文件',
            segments: [{id: 0, source: 'Source'}],
            parts: [{
                kind: 'segment',
                segmentIndex: 0,
                source: 'Source',
                prefix: '',
                suffix: '',
            }],
        };
        expect(renderDocument(markdown, ['译文'], 'bilingual')).toBe('Source\n> 译文');
    });

    it('JSON 渲染跳过失效路径并支持根路径替换', () => {
        const invalidPath: ParsedDocument = {
            fileName: 'data.json',
            format: 'json',
            label: 'JSON 文件',
            parts: [],
            segments: [{id: 0, source: 'source'}],
            jsonValue: {item: 42},
            jsonEntries: [{path: ['item', 'missing'], segmentIndex: 0, prefix: '', suffix: ''}],
        };
        expect(JSON.parse(renderDocument(invalidPath, ['译文'], 'translated'))).toEqual({item: 42});

        const rootPath: ParsedDocument = {
            ...invalidPath,
            jsonValue: ' source ',
            jsonEntries: [{path: [], segmentIndex: 0, prefix: ' ', suffix: ' '}],
        };
        expect(JSON.parse(renderDocument(rootPath, ['译文'], 'bilingual'))).toBe(' source\n译文 ');

        const parsedJson = parseDocument('data.json', '{"blank":"   ","text":" source "}');
        expect(parsedJson.segments.map(({source}) => source)).toEqual(['source']);
        expect(JSON.parse(renderDocument(parsedJson, [], 'translated'))).toEqual({blank: '   ', text: ' source '});
    });

    it('富预览覆盖完整 HTML 壳、Markdown 结构和不支持格式', () => {
        const withHead = parseDocument('page.html', '<html><head><title>Safe</title></head><body><p>Hello</p></body></html>');
        expect(createDocumentPreviewHtml(withHead, ['你好'], 'source')).toContain('<head><meta charset="utf-8">');

        const withoutHead = parseDocument('page.html', '<html><body><p>Hello</p></body></html>');
        expect(createDocumentPreviewHtml(withoutHead, ['你好'], 'translated')).toContain('<html><head>');

        const markdown = parseDocument('guide.md', [
            '```ts',
            'const value = 1;',
            '```',
            '',
            '---',
            '',
            '- Item',
            '',
            '> Quote',
        ].join('\n'));
        const preview = createDocumentPreviewHtml(markdown, ['', '项目', '引用'], 'bilingual');
        expect(preview).toContain('<pre data-reader-unit>');
        expect(preview).toContain('horizontal-rule');
        expect(preview).toContain('reader-unit list-item');
        expect(preview).toContain('reader-unit quote');
        expect(renderDocument(markdown, [], 'bilingual')).toBe(renderDocument(markdown, [], 'translated'));
        expect(createDocumentPreviewHtml(markdown, [], 'source')).toContain('Item');

        const text = parseDocument('notes.txt', 'First\n\nSecond');
        expect(createDocumentPreviewHtml(text, ['第一'], 'translated')).toContain('Second');
        const emptyFirstTranslation = createDocumentPreviewHtml(text, ['', '第二'], 'translated');
        expect(emptyFirstTranslation).toContain('<p class="reader-source">First</p>');
        expect(emptyFirstTranslation).not.toContain('<p class="reader-translation fluentread-translation"></p>');
        expect(emptyFirstTranslation).toContain('<p class="reader-translation fluentread-translation">第二</p>');

        expect(() => createDocumentPreviewHtml(parseDocument('episode.srt', 'WEBVTT\n'), [], 'source'))
            .toThrow('不支持为 srt 生成富文档预览');
    });

    it.each(['txt', 'md'].flatMap(extension => [
        {kind: 'missing', translation: undefined},
        {kind: 'sparse', translation: undefined},
        {kind: 'empty', translation: ''},
        {kind: 'whitespace-only', translation: ' \n\t\u3000'},
        {kind: 'identical', translation: 'Café  world'},
        {kind: 'Unicode-equivalent', translation: 'Cafe\u0301  world'},
        {kind: 'whitespace-equivalent', translation: '  Café \nworld\u3000'},
        {kind: 'Unicode-and-whitespace-equivalent', translation: '  Cafe\u0301 \nworld\u3000'},
    ].map(value => ({extension, ...value}))))('translated $extension preview retains source for $kind translation', ({extension, kind, translation}) => {
        const source = extension === 'md' ? '# Café  world' : 'Café  world';
        const document = parseDocument(`source.${extension}`, source);
        const before = JSON.stringify(document);
        const translations: string[] = kind === 'sparse' ? new Array(1) : translation === undefined ? [] : [translation];
        const html = createDocumentPreviewHtml(document, translations, 'translated');
        const dom = parseHTML(html).document;
        expect(dom.body.textContent).toBe('Café  world');
        expect(dom.querySelectorAll('.reader-source')).toHaveLength(1);
        expect(dom.querySelectorAll('.fluentread-translation, [data-fluent-read-document-translation]')).toHaveLength(0);
        expect(JSON.stringify(document)).toBe(before);
    });

    it.each(['txt', 'md'])('translated %s preview renders a distinct translation once', extension => {
        const document = parseDocument(`source.${extension}`, extension === 'md' ? '# Café  world' : 'Café  world');
        const dom = parseHTML(createDocumentPreviewHtml(document, ['咖啡世界'], 'translated')).document;
        expect(dom.body.textContent).toBe('咖啡世界');
        expect(dom.querySelectorAll('.reader-source')).toHaveLength(0);
        expect(dom.querySelectorAll('.fluentread-translation')).toHaveLength(1);
    });
});
