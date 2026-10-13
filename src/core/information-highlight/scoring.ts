/**
 * @file src/core/information-highlight/scoring.ts
 * 文件职责：计算因果模型输入 token 的真实意外度并将 ByteLevel 编码映射回原文。
 * 主要内容：全词表稳定 log-sum-exp、跨块 next-token 对齐、NFC 字素到原 UTF-16 的精确映射和重叠字素合并。
 * 模块边界：纯算法，不加载模型、不下载文件、不修改网页；词表字节编码约定与固定 Qwen tokenizer 一致。
 */
export interface ScoredSpan {start: number; end: number; score: number}
export interface TokenOffset {start: number; end: number}

/** ORT 的 float16 在尚无原生 Float16Array 的浏览器里以 Uint16 位模式暴露。 */
export function floatLogits(type: string, data: ArrayLike<number>): ArrayLike<number> {
    if (type === 'float32' || type === 'float64') return data;
    if (type !== 'float16') throw new Error('INFORMATION_HIGHLIGHT_BAD_LOGITS');
    if (!(data instanceof Uint16Array)) return data;
    return Float32Array.from(data, bits => {
        const sign = bits & 0x8000 ? -1 : 1, exponent = (bits >>> 10) & 31, fraction = bits & 1023;
        return exponent === 0 ? sign * 2 ** -14 * fraction / 1024
            : exponent === 31 ? fraction ? NaN : sign * Infinity : sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
    });
}

/** 在 log 域计算 -log2(P)，避免低概率 token 下溢为 0；不使用采样参数。 */
export function surprisalBits(logits: ArrayLike<number>, offset: number, vocabulary: number, target: number): number {
    if (!Number.isInteger(vocabulary) || vocabulary < 1 || !Number.isInteger(target) || target < 0 || target >= vocabulary
        || !Number.isInteger(offset) || offset < 0 || offset + vocabulary > logits.length) throw new Error('INFORMATION_HIGHLIGHT_BAD_LOGITS');
    let max = -Infinity;
    for (let i = 0; i < vocabulary; i++) {
        const value = logits[offset + i];
        if (!Number.isFinite(value)) throw new Error('INFORMATION_HIGHLIGHT_BAD_LOGITS');
        max = Math.max(max, value);
    }
    let sum = 0;
    for (let i = 0; i < vocabulary; i++) sum += Math.exp(logits[offset + i] - max);
    return Math.max(0, (Math.log(sum) + max - logits[offset + target]) / Math.LN2);
}

/** row(start+j) 预测 ids[start+j+1]；每个输入目标恰好由前一行评分一次。 */
export function scoreCausalChunk(logits: ArrayLike<number>, vocabulary: number, ids: readonly number[], start: number, end: number): number[] {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > ids.length
        || logits.length !== (end - start) * vocabulary) throw new Error('INFORMATION_HIGHLIGHT_BAD_LOGITS');
    const result: number[] = [];
    for (let target = start + 1; target < Math.min(end + 1, ids.length); target++) {
        result.push(surprisalBits(logits, (target - start - 1) * vocabulary, vocabulary, ids[target]));
    }
    return result;
}

const byteDecoder = (() => {
    const bytes = [...Array.from({length: 94}, (_, i) => i + 33), ...Array.from({length: 12}, (_, i) => i + 161), ...Array.from({length: 82}, (_, i) => i + 174)];
    const codes = [...bytes];
    let extra = 0;
    for (let byte = 0; byte < 256; byte++) if (!bytes.includes(byte)) {bytes.push(byte); codes.push(256 + extra++);}
    return new Map(codes.map((code, index) => [String.fromCodePoint(code), bytes[index]]));
})();

/** 规范化只发生在模型输入；原文、DOM 和原 UTF-16 偏移保持完整。 */
export function alignQwenByteTokens(text: string, pieces: readonly string[], addedTokens: ReadonlyMap<string, string> = new Map()): TokenOffset[] {
    const encoder = new TextEncoder();
    const bytes: number[] = [], starts: number[] = [], ends: number[] = [];
    let normalized = '';
    const segments = new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(text);
    for (const segment of segments) {
        const canonical = segment.segment.normalize('NFC');
        normalized += canonical;
        for (const byte of encoder.encode(canonical)) {
            bytes.push(byte); starts.push(segment.index); ends.push(segment.index + segment.segment.length);
        }
    }
    if (normalized !== text.normalize('NFC')) throw new Error('INFORMATION_HIGHLIGHT_ALIGNMENT');
    let cursor = 0;
    const result = pieces.map(piece => {
        const literal = addedTokens.get(piece);
        const tokenBytes = literal !== undefined ? Array.from(encoder.encode(literal)) : Array.from(piece, character => {
            const byte = byteDecoder.get(character);
            if (byte === undefined) throw new Error('INFORMATION_HIGHLIGHT_ALIGNMENT');
            return byte;
        });
        if (!tokenBytes.length || tokenBytes.some((byte, i) => byte !== bytes[cursor + i])) throw new Error('INFORMATION_HIGHLIGHT_ALIGNMENT');
        const start = starts[cursor];
        cursor += tokenBytes.length;
        return {start, end: ends[cursor - 1]};
    });
    if (cursor !== bytes.length) throw new Error('INFORMATION_HIGHLIGHT_ALIGNMENT');
    return result;
}

/** Byte token 可共享同一中文字符/emoji；合并其概率贡献，不能重复绘制重叠 DOM 区间。 */
export function scoredTokenSpans(offsets: readonly TokenOffset[], scores: readonly number[]): ScoredSpan[] {
    if (offsets.length !== scores.length) throw new Error('INFORMATION_HIGHLIGHT_SCORE_COUNT');
    const spans: ScoredSpan[] = [];
    for (let i = 0; i < offsets.length; i++) {
        const {start, end} = offsets[i], score = scores[i];
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || !Number.isFinite(score) || score < 0) throw new Error('INFORMATION_HIGHLIGHT_ALIGNMENT');
        const previous = spans.at(-1);
        if (previous && start < previous.end) {previous.end = Math.max(previous.end, end); previous.score += score;}
        else spans.push({start, end, score});
    }
    return spans;
}
