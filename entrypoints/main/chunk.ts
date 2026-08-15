export interface TextChunk {
    start: number;
    end: number;
}

type Segment = { segment: string; index: number };

const fallbackSentencePattern = /[^.!?。！？\n]+(?:[.!?。！？]+["'”’）)\]]*|\n+|$)/g;
const paragraphBreakPattern = /\r?\n[^\S\r\n]*\r?\n+/g;

export function findTextParagraph(text: string, offset: number): TextChunk | null {
    const breaks = Array.from(text.matchAll(paragraphBreakPattern));
    if (breaks.length === 0) return null;

    const chunks: TextChunk[] = [];
    let start = 0;

    for (const match of breaks) {
        chunks.push(trimChunk(text, start, match.index));
        start = match.index + match[0].length;
    }
    chunks.push(trimChunk(text, start, text.length));

    const position = Math.min(Math.max(offset, 0), Math.max(text.length - 1, 0));
    return chunks.find(chunk => chunk.start < chunk.end && position >= chunk.start && position < chunk.end) ?? null;
}

function trimChunk(text: string, start: number, end: number): TextChunk {
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    return { start, end };
}

function sentenceChunks(text: string): TextChunk[] {
    const Segmenter = (Intl as typeof Intl & {
        Segmenter?: new (locale?: string, options?: { granularity: 'sentence' }) => {
            segment(input: string): Iterable<Segment>;
        };
    }).Segmenter;

    if (Segmenter) {
        return Array.from(new Segmenter(undefined, { granularity: 'sentence' }).segment(text), part => ({
            start: part.index,
            end: part.index + part.segment.length,
        }));
    }

    return Array.from(text.matchAll(fallbackSentencePattern), match => ({
        start: match.index,
        end: match.index + match[0].length,
    }));
}

function splitLongChunk(text: string, chunk: TextChunk, maxLength: number): TextChunk[] {
    const result: TextChunk[] = [];
    let start = chunk.start;

    while (chunk.end - start > maxLength) {
        const preferredStart = start + Math.floor(maxLength * 0.65);
        const slice = text.slice(preferredStart, start + maxLength + 1);
        const breakAt = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'), slice.lastIndexOf('\t'));
        const end = breakAt >= 0 ? preferredStart + breakAt + 1 : start + maxLength;
        result.push({ start, end });
        start = end;
    }

    result.push({ start, end: chunk.end });
    return result;
}

export function findTextChunk(text: string, offset: number, maxLength = 480): TextChunk {
    const sentences = sentenceChunks(text).flatMap(chunk => splitLongChunk(text, chunk, maxLength));
    if (sentences.length === 0) return { start: 0, end: text.length };

    const groups: TextChunk[] = [];
    let current = sentences[0];

    for (const sentence of sentences.slice(1)) {
        if (sentence.end - current.start > maxLength) {
            groups.push(current);
            current = sentence;
        } else {
            current = { start: current.start, end: sentence.end };
        }
    }
    groups.push(current);

    const position = Math.min(Math.max(offset, 0), Math.max(text.length - 1, 0));
    return groups.find(chunk => position >= chunk.start && position < chunk.end) ?? groups.at(-1)!;
}
