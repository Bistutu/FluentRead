/**
 * @file tests/documentTextWrappedParagraphs.test.ts
 * 文件职责：验证纯文本里按固定宽度折行的段落作为一个片段翻译，而标题、列表、短行和各自成句的行仍然逐行处理。
 * 主要内容：折行段落合并后的送翻原文（折行处是空格，中日韩文字之间不留空格）、仅译文与双语导出、Windows 换行、缩进一致才合并；全大写标题、句末标点、列表与编号、分隔线、过短的行不合并；Markdown 不受影响。
 * 模块边界：只测试纯解析与渲染，不发起翻译；阅读预览与页面交互由各自的测试覆盖。
 */
import {describe, expect, it} from 'vitest';
import {parseDocument, renderDocument} from '@/src/features/document-translation/core/document';

const sources = (text: string, name = 'notes.txt') => parseDocument(name, text).segments.map(segment => segment.source);

describe('hard-wrapped plain-text paragraphs', () => {
    const wrapped = ['The budget for the second quarter was approved', 'without changes, although Luis asked for a review', 'of travel costs before the summer.'];
    const notes = ['MEETING NOTES FOR THE ORCHARD PROJECT AND ITS PARTNERS', '', 'Attendees: Dana, Luis, Mei', 'Date: 12 March', '', ...wrapped, '',
        '- Design freeze moves to the end of April and', '- Testing starts one week after the freeze has', '', 'Action items for everyone attending the meeting', '* Dana sends the plan', '', '---', 'Next meeting: 26 March'];

    it('translates a wrapped paragraph as one segment and leaves headings, short lines and lists alone', () => {
        expect(sources(notes.join('\n'))).toEqual([
            'MEETING NOTES FOR THE ORCHARD PROJECT AND ITS PARTNERS', 'Attendees: Dana, Luis, Mei', 'Date: 12 March', wrapped.join(' '),
            '- Design freeze moves to the end of April and', '- Testing starts one week after the freeze has', 'Action items for everyone attending the meeting', '* Dana sends the plan', '---', 'Next meeting: 26 March',
        ]);
        // 没有译文时原样导出；Windows 换行同样合并，换行符留在原处。
        expect(renderDocument(parseDocument('notes.txt', notes.join('\r\n')), [], 'translated')).toBe(notes.join('\r\n'));
        expect(sources(notes.join('\r\n'))[3]).toBe(wrapped.join(' '));
    });

    it('writes the translation as one line and keeps the original lines in bilingual output', () => {
        const text = `${wrapped.join('\n')}\n\nA closing line that is long enough to set the wrap width.\n`;
        const parsed = parseDocument('notes.txt', text);
        expect(parsed.segments.map(segment => segment.source)).toEqual([wrapped.join(' '), 'A closing line that is long enough to set the wrap width.']);
        expect(renderDocument(parsed, ['第二季度的预算照原样通过，不过路易斯要求在夏天之前复核差旅费用。', '结尾的一行。'], 'translated'))
            .toBe('第二季度的预算照原样通过，不过路易斯要求在夏天之前复核差旅费用。\n\n结尾的一行。\n');
        expect(renderDocument(parsed, ['第二季度的预算照原样通过。', '结尾的一行。'], 'bilingual'))
            .toBe(`${wrapped.join('\n')}\n第二季度的预算照原样通过。\n\nA closing line that is long enough to set the wrap width.\n结尾的一行。\n`);
    });

    it('joins wrapped CJK lines without a space and requires matching indentation', () => {
        const cjk = ['第二季度的预算没有改动就通过了，不过路易斯要求在夏天', '到来之前复核一次差旅费用，并把结果发给所有与会的人'];
        expect(sources(cjk.join('\n'))).toEqual([cjk.join('')]);
        // 中日韩文字与拉丁单词相接的折行处仍补一个空格。
        expect(sources('第二季度的预算没有改动就通过了，负责人是\nLuis 并且他要求在夏天到来之前复核一次差旅费用')).toEqual(['第二季度的预算没有改动就通过了，负责人是 Luis 并且他要求在夏天到来之前复核一次差旅费用']);
        // 缩进不同的下一行是另一块内容（引文、代码、署名），不并进来。
        expect(sources(`${wrapped[0]}\n    ${wrapped[1]}`)).toEqual([wrapped[0], wrapped[1]]);
    });

    it('does not merge lines that end a sentence, numbered items or anything in Markdown', () => {
        expect(sources('This line is long enough and ends its sentence here.\nThis one starts another sentence of similar length')).toHaveLength(2);
        expect(sources('The first numbered step is long enough to look wrapped\n2) the second step follows on the next line here')).toHaveLength(2);
        expect(sources('An introduction that is long enough to look like wrapped\n(a) but the next line is a lettered item in a list')).toHaveLength(2);
        expect(sources('“He said the meeting would be moved to next week.”\nNobody objected, and the room was booked again')).toHaveLength(2);
        expect(sources(wrapped.join('\n'), 'notes.md')).toEqual(wrapped);
        expect(sources('')).toEqual([]);
    });
});
