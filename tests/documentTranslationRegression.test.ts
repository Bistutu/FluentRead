import {describe, expect, it} from 'vitest';

import {
    getDocumentFormat,
    parseDocument,
    renderDocument,
} from '@/entrypoints/utils/documentTranslation';

import {DOCUMENT_EXAMPLES, loadExample} from './documentTranslationExamples';

describe('document translation example regression corpus', () => {
    it.each(DOCUMENT_EXAMPLES)('$fileName covers parse, translate-output, and reparse', (example) => {
        const source = loadExample(example.fileName);
        const format = getDocumentFormat(example.fileName);
        expect(format, `${example.fileName} must be recognized`).toBe(example.format);

        const parsed = parseDocument(example.fileName, source);
        expect(parsed.segments.length, `${example.fileName} must contain translatable segments`).toBeGreaterThan(0);

        const translations = parsed.segments.map((segment) => `Translated: ${segment.source}`);
        const translatedOutput = renderDocument(parsed, translations, 'translated');
        for (const marker of example.markers) {
            expect(translatedOutput, `${example.fileName} must preserve ${marker}`).toContain(marker);
        }
        expect(translatedOutput).toContain('Translated:');

        const reparsed = parseDocument(example.fileName, translatedOutput);
        expect(
            reparsed.segments,
            `${example.fileName} export must remain parseable with the same segment count`,
        ).toHaveLength(parsed.segments.length);

        const bilingualOutput = renderDocument(parsed, translations, 'bilingual');
        expect(bilingualOutput, `${example.fileName} bilingual export must include translations`).toContain('Translated:');
    });

    it('keeps JSON non-string values unchanged in the example export', () => {
        const parsed = parseDocument('sample.json', loadExample('sample.json'));
        const translations = parsed.segments.map((segment) => `Translated: ${segment.source}`);
        const result = JSON.parse(renderDocument(parsed, translations, 'translated')) as {
            meta: {keepNumber: number; items: string[]};
        };

        expect(result.meta.keepNumber).toBe(42);
        expect(result.meta.items).toHaveLength(2);
    });
});
