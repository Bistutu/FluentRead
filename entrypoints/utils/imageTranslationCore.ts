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
    blocks: Array<{ paragraphs?: Array<{ lines?: Array<{ text: string; bbox: OcrLine['bbox'] }> }> }> | null | undefined,
): OcrLine[] {
    if (!blocks) return [];

    return blocks
        .flatMap(block => block.paragraphs || [])
        .flatMap(paragraph => paragraph.lines || [])
        .map(line => ({
            text: line.text.replace(/[\s\u3000]+/g, ' ').trim(),
            bbox: line.bbox,
        }))
        .filter(line => line.text.length > 0 && line.bbox.x1 > line.bbox.x0 && line.bbox.y1 > line.bbox.y0);
}
