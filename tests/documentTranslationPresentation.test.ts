import {describe, expect, it} from 'vitest';

import {parseDocument, type BinaryDocumentData, type DocumentFormat, type ParsedDocument} from '@/src/features/document-translation/core/document';
import {
    formatDocumentReaderText,
    hasDocumentPlaceholder,
    DOCUMENT_QUICK_SAMPLES,
    getDocumentExportPreview,
    getDocumentEmptyReaderHint,
    getDocumentReaderSourceClass,
    getDocxPartLabel,
    isRichDocumentFormat,
    isSubtitleDocumentFormat,
} from '@/src/features/document-translation/ui/presentation';

function parsed(format: DocumentFormat, binary?: BinaryDocumentData): ParsedDocument {
    return {
        fileName: `sample.${format}`,
        format,
        label: format,
        parts: [],
        segments: [],
        binary,
    };
}

describe('document translation presentation', () => {
    it('does not read the rest of a large text document to produce its download excerpt', () => {
        const document = parseDocument('long.txt', 'A'.repeat(1700));
        document.parts = [
            {kind: 'literal', value: 'A'.repeat(1700)},
            {get kind() {throw new Error('preview read beyond limit');}} as any,
        ];
        expect(getDocumentExportPreview(document, [], 'translated')).toBe(`${'A'.repeat(1600)}\n…`);
    });

    it('does not clone a large JSON tree for a download excerpt', () => {
        const document = parseDocument('large.json', JSON.stringify(Array.from({length: 1000}, (_, index) => `Value ${index}`)));
        Object.defineProperty(document, 'jsonValue', {get: () => {throw new Error('preview cloned the tree');}});
        expect(getDocumentExportPreview(document, ['翻译结果'], 'translated')).toBe('翻译结果\n\nValue 1\n\nValue 2');
    });

    it('local samples use the normal parser and preserve structure when exported', () => {
        for (const sample of DOCUMENT_QUICK_SAMPLES) {
            const document = parseDocument(sample.name, sample.content);
            expect(document.segments.length).toBeGreaterThan(0);
            const translations = document.segments.map(segment => `译文 ${segment.id + 1}`);
            const preview = getDocumentExportPreview(document, translations, 'translated');
            expect(preview).toContain('译文 1');
            expect(preview).not.toContain(document.segments[0].source);
            expect(parseDocument(sample.name, preview).segments).toHaveLength(document.segments.length);
        }
    });

    it('export preview is bounded and binary excerpts follow the selected mode', () => {
        const document = parseDocument('long.txt', 'A'.repeat(1700));
        expect(getDocumentExportPreview(document, [], 'translated')).toBe(`${'A'.repeat(1600)}\n…`);
        const pdf = parsed('pdf', {kind: 'pdf', bytes: new Uint8Array(), pages: []});
        pdf.segments = [{id: 0, source: 'Original'}, {id: 1, source: 'Pending'}];
        expect(getDocumentExportPreview(pdf, ['译文', ' '], 'translated')).toBe('译文\n\nPending');
        expect(getDocumentExportPreview(pdf, ['译文'], 'bilingual')).toBe('Original\n译文\n\nPending');
    });

    it('区分格式族和空态提示', () => {
        expect(isSubtitleDocumentFormat('vtt')).toBe(true);
        expect(isSubtitleDocumentFormat('txt')).toBe(false);
        expect(isSubtitleDocumentFormat()).toBe(false);
        expect(isRichDocumentFormat('epub')).toBe(true);
        expect(isRichDocumentFormat('pdf')).toBe(false);
        expect(isRichDocumentFormat()).toBe(false);

        expect(getDocumentEmptyReaderHint(parsed('pdf', {kind: 'pdf', bytes: new Uint8Array(), pages: []}))).toBe('document.pdfReading.startHint');
        expect(getDocumentEmptyReaderHint(parsed('ass'))).toContain('时间轴');
        expect(getDocumentEmptyReaderHint(parsed('json'))).toContain('JSON 路径');
        expect(getDocumentEmptyReaderHint(null)).toContain('阅读结构');

    });

    it('把 DOCX 部件路径映射为中文阅读标签', () => {
        expect(getDocxPartLabel('word/document.xml')).toBe('正文');
        expect(getDocxPartLabel('word/header1.xml')).toBe('页眉');
        expect(getDocxPartLabel('word/footer1.xml')).toBe('页脚');
        expect(getDocxPartLabel('word/footnotes.xml')).toBe('脚注');
        expect(getDocxPartLabel('word/endnotes.xml')).toBe('尾注');
        expect(getDocxPartLabel('word/comments.xml')).toBe('文档内容');
    });

    it('把预览片段清理为可读文本并识别 Markdown 标题', () => {
        expect(formatDocumentReaderText('html', ' <b>Hello</b> ')).toBe('Hello');
        expect(formatDocumentReaderText('markdown', ' # **Read** [guide](https://example.com) `now` ![cover](x) '))
            .toBe('Read guide now cover');
        expect(formatDocumentReaderText('ass', ' {\\i1}<i>Hello</i> ')).toBe('Hello');
        expect(formatDocumentReaderText(undefined, '  Plain text  ')).toBe('Plain text');
        expect(formatDocumentReaderText('ass', '{\\i1}Today{\\i0} we build a small\\Nweather\\hstation\\nnow')).toBe('Today we build a small\nweather station\nnow');
        expect(formatDocumentReaderText('srt', 'C:\\New folder\\notes')).toBe('C:\\New folder\\notes');
        expect(formatDocumentReaderText('vtt', '今天我们搭一个 &lt;i&gt; 小 &lt;/i&gt; 气象站，温度 &lt; 5 度')).toBe('今天我们搭一个  小  气象站，温度 &lt; 5 度');
        expect(formatDocumentReaderText('epub', ' Read <a href="#n">the note</a> ')).toBe('Read the note');
        expect(formatDocumentReaderText('markdown', '阅读<g1>指南</g1>并运行<g2/>')).toBe('阅读指南并运行');
        expect([hasDocumentPlaceholder('阅读<g1>指南</g1>'), hasDocumentPlaceholder('运行<g2/>'), hasDocumentPlaceholder('a < g1 > b'), hasDocumentPlaceholder(''), hasDocumentPlaceholder(undefined)]).toEqual([true, true, false, false, false]);
        expect(getDocumentReaderSourceClass('markdown', '## Heading')).toBe('reader-heading');
        expect(getDocumentReaderSourceClass('markdown', 'Paragraph')).toBe('');
        expect(getDocumentReaderSourceClass('html', '## Heading')).toBe('');
    });
});
