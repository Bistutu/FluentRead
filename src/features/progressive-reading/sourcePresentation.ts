/**
 * @file src/features/progressive-reading/sourcePresentation.ts
 * 文件职责：将渐进阅读的真实原文位置转换为可平铺显示的辅助标记片段。
 * 主要内容：核对有界提示坐标与原文词面，按全部有效边界分段，并在重叠位置保留每个提示的原始索引。
 * 模块边界：纯展示结构不修改、归一化或截短原文，不决定颜色、帮助文案或交互，不读取 DOM、学习状态和媒体进度。
 */

export interface ReadingSourceRange {start: number; end: number; term: string}
export interface ReadingSourceSegment {text: string; start: number; end: number; indices: number[]}

// 短语和逻辑提示分别最多 24 与 32 项；额外留少量余量，避免不可信输入形成任意数量的展示节点。
const MAX_SOURCE_RANGES = 64;

/** 完整保留 UTF-16 原文及空白；各片段连续且无嵌套，索引始终指向调用方传入的提示。 */
export function readingSourceSegments(text: string, ranges: readonly ReadingSourceRange[]): ReadingSourceSegment[] {
  if (!text) return [];
  const valid = ranges.slice(0, MAX_SOURCE_RANGES).flatMap((range, index) => {
    if (!range || !Number.isInteger(range.start) || !Number.isInteger(range.end)
      || range.start < 0 || range.end <= range.start || range.end > text.length
      || text.slice(range.start, range.end) !== range.term) return [];
    return [{start: range.start, end: range.end, index}];
  });
  const boundaries = [...new Set([0, text.length, ...valid.flatMap(range => [range.start, range.end])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    return {text: text.slice(start, end), start, end,
      indices: valid.filter(range => range.start <= start && range.end >= end).map(range => range.index)};
  });
}
