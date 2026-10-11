/**
 * @file tests/progressiveReadingSourcePresentation.test.ts
 * 文件职责：验证渐进阅读原文标记分段的保真、重叠索引和不可信范围边界。
 * 主要内容：覆盖无提示、相邻与交叉范围、重复词面、Unicode 与空白、有限输入预算及输入不变性。
 * 模块边界：只验证纯展示结构；不代替 Vue 标记交互、样式或真实浏览器验收。
 */
import {describe, expect, it} from 'vitest';
import {readingSourceSegments, type ReadingSourceRange, type ReadingSourceSegment} from '@/src/features/progressive-reading/sourcePresentation';

function expectComplete(text: string, segments: ReadingSourceSegment[]) {
  expect(segments.map(segment => segment.text).join('')).toBe(text);
  if (!text) {expect(segments).toEqual([]); return;}
  expect(segments[0].start).toBe(0);
  expect(segments.at(-1)?.end).toBe(text.length);
  for (const [index, segment] of segments.entries()) {
    expect(segment.end).toBeGreaterThan(segment.start);
    expect(segment.text).toBe(text.slice(segment.start, segment.end));
    if (index) expect(segment.start).toBe(segments[index - 1].end);
  }
}

describe('渐进阅读原文辅助标记的连续展示结构', () => {
  it('没有原文时没有展示片段，有提示也不会创建空标记', () => {
    expect(readingSourceSegments('', [])).toEqual([]);
    expect(readingSourceSegments('', [{start: 0, end: 1, term: 'x'}])).toEqual([]);
    expectComplete('', readingSourceSegments('', []));
  });

  it('没有提示时完整保留原文、空白与标签样文本', () => {
    const text = '  <img src="x">\r\n\tRaw & readable.\u00a0 ';
    const result = readingSourceSegments(text, []);
    expect(result).toEqual([{text, start: 0, end: text.length, indices: []}]);
    expectComplete(text, result);
  });

  it('一个段内表达只分出原文前后与被标记词面', () => {
    const text = 'We take into account the cost.';
    const result = readingSourceSegments(text, [{start: 3, end: 20, term: 'take into account'}]);
    expect(result).toEqual([
      {text: 'We ', start: 0, end: 3, indices: []},
      {text: 'take into account', start: 3, end: 20, indices: [0]},
      {text: ' the cost.', start: 20, end: text.length, indices: []},
    ]);
    expectComplete(text, result);
  });

  it('整段标记没有额外空片段，头尾相邻范围不制造间隙', () => {
    expect(readingSourceSegments('only', [{start: 0, end: 4, term: 'only'}])).toEqual([
      {text: 'only', start: 0, end: 4, indices: [0]},
    ]);
    const result = readingSourceSegments('ifonly', [{start: 0, end: 2, term: 'if'}, {start: 2, end: 6, term: 'only'}]);
    expect(result).toEqual([
      {text: 'if', start: 0, end: 2, indices: [0]},
      {text: 'only', start: 2, end: 6, indices: [1]},
    ]);
    expectComplete('ifonly', result);
  });

  it('only if 的嵌套条件与范围标记平铺且保留每个原始索引', () => {
    const text = 'It works only if we agree.';
    const ranges = [{start: 14, end: 16, term: 'if'}, {start: 9, end: 16, term: 'only if'}, {start: 9, end: 13, term: 'only'}];
    const result = readingSourceSegments(text, ranges);
    expect(result).toEqual([
      {text: 'It works ', start: 0, end: 9, indices: []},
      {text: 'only', start: 9, end: 13, indices: [1, 2]},
      {text: ' ', start: 13, end: 14, indices: [1]},
      {text: 'if', start: 14, end: 16, indices: [0, 1]},
      {text: ' we agree.', start: 16, end: text.length, indices: []},
    ]);
    expectComplete(text, result);
  });

  it('交叉范围与同位置不同线索都保留，不嵌套也不丢重复索引', () => {
    const ranges = [{start: 0, end: 3, term: 'abc'}, {start: 2, end: 5, term: 'cde'}, {start: 0, end: 3, term: 'abc'}];
    const result = readingSourceSegments('abcdef', ranges);
    expect(result).toEqual([
      {text: 'ab', start: 0, end: 2, indices: [0, 2]},
      {text: 'c', start: 2, end: 3, indices: [0, 1, 2]},
      {text: 'de', start: 3, end: 5, indices: [1]},
      {text: 'f', start: 5, end: 6, indices: []},
    ]);
    expectComplete('abcdef', result);
    expect(readingSourceSegments('unless', [{start: 0, end: 6, term: 'unless'}, {start: 0, end: 6, term: 'unless'}])).toEqual([
      {text: 'unless', start: 0, end: 6, indices: [0, 1]},
    ]);
  });

  it('只按坐标标记重复词面，后文同词不会自动全部变成提示', () => {
    const text = 'may, may and may.';
    const result = readingSourceSegments(text, [{start: 5, end: 8, term: 'may'}]);
    expect(result).toEqual([
      {text: 'may, ', start: 0, end: 5, indices: []},
      {text: 'may', start: 5, end: 8, indices: [0]},
      {text: ' and may.', start: 8, end: text.length, indices: []},
    ]);
    expectComplete(text, result);
  });

  it.each([
    {start: -1, end: 2, term: 'ab'}, {start: NaN, end: 2, term: 'ab'}, {start: Infinity, end: 2, term: 'ab'},
    {start: 0.5, end: 2, term: 'ab'}, {start: 0, end: 2.5, term: 'ab'}, {start: 0, end: NaN, term: 'ab'},
    {start: 0, end: Infinity, term: 'ab'}, {start: 1, end: 1, term: ''}, {start: 2, end: 1, term: ''},
    {start: 0, end: 4, term: 'abc'}, {start: 0, end: 2, term: 'AB'}, {start: 0, end: 2, term: ''},
    null, undefined,
  ])('拒绝不可信范围 %j，不错标也不改原文', invalid => {
    const ranges = [invalid, {start: 1, end: 2, term: 'b'}] as ReadingSourceRange[];
    const result = readingSourceSegments('abc', ranges);
    expect(result).toEqual([
      {text: 'a', start: 0, end: 1, indices: []},
      {text: 'b', start: 1, end: 2, indices: [1]},
      {text: 'c', start: 2, end: 3, indices: []},
    ]);
    expectComplete('abc', result);
  });

  it('只有不可信范围时仍是一段完整原文', () => {
    expect(readingSourceSegments('source', [{start: 0, end: 6, term: 'changed'}])).toEqual([
      {text: 'source', start: 0, end: 6, indices: []},
    ]);
  });

  it('保留 UTF-16 坐标、代理对、组合字符及跨行短语，不做归一化', () => {
    const text = '前😀 cafe\u0301\r\nonly\tif\u00a0后';
    const emojiStart = text.indexOf('😀'), wordStart = text.indexOf('cafe'), clueStart = text.indexOf('only');
    const ranges = [
      {start: emojiStart, end: emojiStart + 2, term: '😀'},
      {start: wordStart, end: wordStart + 5, term: 'cafe\u0301'},
      {start: clueStart, end: clueStart + 7, term: 'only\tif'},
    ];
    const result = readingSourceSegments(text, ranges);
    expect(result.filter(segment => segment.indices.length).map(segment => segment.text)).toEqual(['😀', 'cafe\u0301', 'only\tif']);
    expect(result.some(segment => segment.text === '\r\n')).toBe(true);
    expectComplete(text, result);
    expect(readingSourceSegments('cafe\u0301', [{start: 0, end: 5, term: 'café'}])).toEqual([
      {text: 'cafe\u0301', start: 0, end: 5, indices: []},
    ]);
  });

  it('只检查前 64 个输入范围，后续项不能增加节点或扫描预算', () => {
    const text = 'a '.repeat(1000);
    const ranges = Array.from({length: 1000}, (_, index) => ({start: index * 2, end: index * 2 + 1, term: 'a'}));
    const result = readingSourceSegments(text, ranges);
    expect(result.filter(segment => segment.indices.length)).toHaveLength(64);
    expect(result.flatMap(segment => segment.indices)).toEqual(Array.from({length: 64}, (_, index) => index));
    expect(result.length).toBeLessThanOrEqual(129);
    expect(result.at(-1)?.text).toBe(text.slice(127));
    expectComplete(text, result);

    const notInspected = {get start(): number {throw new Error('预算外范围不应访问');}, end: 1, term: 'a'};
    const firstInvalid = Array.from({length: 64}, () => ({start: -1, end: 1, term: 'a'}));
    expect(readingSourceSegments('a', [...firstInvalid, notInspected])).toEqual([{text: 'a', start: 0, end: 1, indices: []}]);
  });

  it('冻结输入可重复使用，改动返回片段不会污染原文范围或下一次计算', () => {
    const ranges = Object.freeze([Object.freeze({start: 4, end: 7, term: 'may'}), Object.freeze({start: 0, end: 2, term: 'We'})]);
    const first = readingSourceSegments('We  may act.', ranges), again = readingSourceSegments('We  may act.', ranges);
    expect(first).toEqual(again);
    first[0].indices.push(99); first[0].text = 'changed';
    expect(readingSourceSegments('We  may act.', ranges)).toEqual(again);
    expect(ranges).toEqual([{start: 4, end: 7, term: 'may'}, {start: 0, end: 2, term: 'We'}]);
    expectComplete('We  may act.', again);
  });
});
