import {describe, expect, it} from 'vitest';

import {
    createDocumentDownloadName,
    getDocumentFormat,
    getDocumentMimeType,
    parseDocument,
    renderDocument,
} from '@/entrypoints/utils/documentTranslation';

describe('document translation parser', () => {
    it('识别首批支持的文件格式并生成下载文件名', () => {
        expect(getDocumentFormat('guide.HTML')).toBe('html');
        expect(getDocumentFormat('notes.markdown')).toBe('markdown');
        expect(getDocumentFormat('episode.ass')).toBe('ass');
        expect(getDocumentFormat('lyrics.lrc')).toBe('lrc');
        expect(getDocumentFormat('data.yaml')).toBeNull();
        expect(createDocumentDownloadName('episode.srt', 'bilingual')).toBe('episode.bilingual.srt');
        expect(createDocumentDownloadName('episode.srt', 'translated')).toBe('episode.translated.srt');
        expect(getDocumentMimeType('html')).toBe('text/html;charset=utf-8');
        expect(getDocumentMimeType('json')).toBe('application/json;charset=utf-8');
        expect(getDocumentMimeType('markdown')).toBe('text/plain;charset=utf-8');
    });

    it('保留 HTML 标签、属性和脚本内容，只替换可见文本', () => {
        const source = '<article><h1>Hello world</h1><a href="https://example.com">Read guide</a><script>const title = "Keep me";</script></article>';
        const document = parseDocument('guide.html', source);
        expect(document.segments.map((segment) => segment.source)).toEqual(['Hello world', 'Read guide']);

        const output = renderDocument(document, ['你好世界', '阅读指南'], 'translated');
        expect(output).toContain('<h1>你好世界</h1>');
        expect(output).toContain('href="https://example.com"');
        expect(output).toContain('>阅读指南</a>');
        expect(output).toContain('const title = "Keep me";');
    });

    it('保留 TXT 换行，并支持 Markdown 代码块和链接保护', () => {
        const txt = parseDocument('notes.txt', 'First line\n\nSecond line\n');
        expect(txt.segments.map((segment) => segment.source)).toEqual(['First line', 'Second line']);
        expect(renderDocument(txt, ['第一行', '第二行'], 'translated')).toBe('第一行\n\n第二行\n');

        const markdown = parseDocument('guide.md', '# Install\n\nUse `npm install` now.\n\n```js\nconst value = 1;\n```\n\n[Guide](https://example.com)');
        expect(markdown.segments.map((segment) => segment.source)).toEqual(['# Install', 'Use', 'now.']);
        const output = renderDocument(markdown, ['# 安装', '使用', '现在。'], 'translated');
        expect(output).toContain('`npm install`');
        expect(output).toContain('const value = 1;');
        expect(output).toContain('[Guide](https://example.com)');
    });

    it('保留 SRT 时间轴、字幕标签和双语行', () => {
        const source = '1\n00:00:01,000 --> 00:00:03,000\n<i>Hello</i> world\n\n2\n00:00:04,000 --> 00:00:05,000\nNext line';
        const document = parseDocument('episode.srt', source);
        expect(document.segments.map((segment) => segment.source)).toEqual(['<i>Hello</i> world', 'Next line']);
        const output = renderDocument(document, ['<i>你好</i> 世界', '下一行'], 'bilingual');
        expect(output).toContain('00:00:01,000 --> 00:00:03,000');
        expect(output).toContain('<i>Hello</i> world\n<i>你好</i> 世界');
        expect(output).toContain('2\n00:00:04,000 --> 00:00:05,000');
    });

    it('保留 VTT 头部和 ASS 对话字段', () => {
        const vtt = parseDocument('episode.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n');
        expect(vtt.segments.map((segment) => segment.source)).toEqual(['Hello']);
        expect(renderDocument(vtt, ['你好'], 'translated')).toContain('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n你好\n');

        const ass = parseDocument('episode.ass', '[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\i1}Hello');
        expect(ass.segments.map((segment) => segment.source)).toEqual(['{\\i1}Hello']);
        const output = renderDocument(ass, ['你好'], 'bilingual');
        expect(output).toContain('Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\i1}Hello\\N{\\i1}你好');
    });

    it('保留 LRC 时间标签，并将 JSON 字符串值重组为合法 JSON', () => {
        const lrc = parseDocument('song.lrc', '[00:01.00]Hello\n[00:02.00]World');
        expect(lrc.segments.map((segment) => segment.source)).toEqual(['Hello', 'World']);
        expect(renderDocument(lrc, ['你好', '世界'], 'bilingual')).toContain('[00:01.00]Hello\n[00:01.00]你好');

        const json = parseDocument('data.json', '{"title":"Hello","items":[{"label":"World"}],"keep":42}');
        expect(json.segments.map((segment) => segment.source)).toEqual(['Hello', 'World']);
        const output = JSON.parse(renderDocument(json, ['你好', '世界'], 'translated')) as {title: string; items: Array<{label: string}>; keep: number};
        expect(output).toEqual({title: '你好', items: [{label: '世界'}], keep: 42});
        expect(() => parseDocument('broken.json', '{')).toThrow('JSON 文件格式无效');
    });
});
