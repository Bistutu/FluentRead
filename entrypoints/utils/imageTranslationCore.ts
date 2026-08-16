export interface OcrLine {
    text: string;
    bbox: {
        x0: number;
        y0: number;
        x1: number;
        y1: number;
    };
}

const OCR_LANGUAGES = ['eng', 'chi_sim', 'jpn'] as const;

export function getOcrLanguages(sourceLanguage: string): string[] {
    if (sourceLanguage === 'en') return ['eng'];
    if (sourceLanguage === 'zh-Hans') return ['chi_sim', 'eng'];
    if (sourceLanguage === 'ja') return ['jpn', 'eng'];
    return [...OCR_LANGUAGES];
}

export function scaleOcrBox(
    bbox: OcrLine['bbox'],
    imageWidth: number,
    imageHeight: number,
    renderedWidth: number,
    renderedHeight: number,
) {
    return {
        left: Math.max(0, (bbox.x0 / imageWidth) * renderedWidth),
        top: Math.max(0, (bbox.y0 / imageHeight) * renderedHeight),
        width: Math.max(1, ((bbox.x1 - bbox.x0) / imageWidth) * renderedWidth),
        height: Math.max(1, ((bbox.y1 - bbox.y0) / imageHeight) * renderedHeight),
    };
}

export function normalizeOcrLines(
    blocks: Array<{
        paragraphs?: Array<{
            lines?: Array<{
                text: string;
                bbox: OcrLine['bbox'];
                words?: Array<{ text: string; confidence?: number; bbox: OcrLine['bbox'] }>;
            }>;
        }>;
    }> | null | undefined,
): OcrLine[] {
    if (!blocks) return [];

    const normalized: OcrLine[] = [];
    blocks.flatMap(block => block.paragraphs || []).flatMap(paragraph => paragraph.lines || []).forEach(line => {
        const words = (line.words || [])
            .map(word => ({
                text: word.text.replace(/[\s\u3000]+/g, ' ').trim(),
                confidence: word.confidence ?? 100,
                bbox: word.bbox,
            }))
            .filter(word => word.text.length > 0 && word.confidence >= 25
                && word.bbox.x1 > word.bbox.x0 && word.bbox.y1 > word.bbox.y0)
            .sort((left, right) => left.bbox.x0 - right.bbox.x0);

        if (words.length === 0) {
            const text = line.text.replace(/[\s\u3000]+/g, ' ').trim();
            if (text && line.bbox.x1 > line.bbox.x0 && line.bbox.y1 > line.bbox.y0) {
                normalized.push({ text, bbox: line.bbox });
            }
            return;
        }

        let current = [words[0]];
        const flush = () => {
            if (current.length === 0) return;
            const bbox = current.reduce((result, word) => ({
                x0: Math.min(result.x0, word.bbox.x0),
                y0: Math.min(result.y0, word.bbox.y0),
                x1: Math.max(result.x1, word.bbox.x1),
                y1: Math.max(result.y1, word.bbox.y1),
            }), {...current[0].bbox});
            const text = current.map(word => word.text).reduce((result, word) => {
                if (!result) return word;
                const previousHasCjk = /[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]$/.test(result);
                const nextHasCjk = /^[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(word);
                return previousHasCjk || nextHasCjk ? `${result}${word}` : `${result} ${word}`;
            }, '');
            if (text) normalized.push({ text, bbox });
        };

        for (let index = 1; index < words.length; index += 1) {
            const previous = current[current.length - 1];
            const next = words[index];
            const previousHeight = previous.bbox.y1 - previous.bbox.y0;
            const verticalOverlap = Math.min(previous.bbox.y1, next.bbox.y1) - Math.max(previous.bbox.y0, next.bbox.y0);
            const gap = next.bbox.x0 - previous.bbox.x1;
            const sameRow = verticalOverlap >= Math.min(previousHeight, next.bbox.y1 - next.bbox.y0) * 0.35;
            // 英文单词间距可能接近一个字高；同一 OCR 行内合并，跨控件的大间距仍保持分开。
            if (sameRow && gap <= Math.max(6, previousHeight * 4)) {
                current.push(next);
            } else {
                flush();
                current = [next];
            }
        }
        flush();
    });
    return normalized;
}
