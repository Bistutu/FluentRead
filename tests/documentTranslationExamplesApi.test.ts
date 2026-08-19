import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    config: {service: 'microsoft'},
    translateText: vi.fn(),
    translateTextBatch: vi.fn(),
}));

vi.mock('@/entrypoints/utils/config', () => ({
    config: mocks.config,
    configReady: Promise.resolve(),
}));

vi.mock('@/entrypoints/utils/option', () => ({
    services: {microsoft: 'microsoft', freeTranslation: 'freeTranslation'},
}));

vi.mock('@/entrypoints/utils/translateApi', () => ({
    translateText: mocks.translateText,
    translateTextBatch: mocks.translateTextBatch,
}));

import {getDocumentFormat, parseDocument, renderDocument} from '@/entrypoints/utils/documentTranslation';
import {translateDocumentSegments} from '@/entrypoints/utils/documentTranslationApi';
import {DOCUMENT_EXAMPLES, loadExample} from './documentTranslationExamples';

beforeEach(() => {
    mocks.config.service = 'microsoft';
    mocks.translateText.mockReset();
    mocks.translateTextBatch.mockReset();
    mocks.translateTextBatch.mockImplementation(async (origins: string[]) => origins.map((origin) => `Translated: ${origin}`));
});

describe('document translation examples API regression', () => {
    it.each(DOCUMENT_EXAMPLES)('$fileName passes through translation and export', async (example) => {
        const source = loadExample(example.fileName);
        const parsed = parseDocument(example.fileName, source);
        const progress: number[] = [];

        expect(getDocumentFormat(example.fileName)).toBe(example.format);
        const translations = await translateDocumentSegments(parsed.segments, {
            fileName: example.fileName,
            onProgress: ({completed}) => progress.push(completed),
        });
        expect(translations).toHaveLength(parsed.segments.length);
        expect(progress.at(-1)).toBe(parsed.segments.length);

        const output = renderDocument(parsed, translations, 'translated');
        const reparsed = parseDocument(example.fileName, output);
        expect(reparsed.segments).toHaveLength(parsed.segments.length);
        for (const marker of example.markers) {
            expect(output, `${example.fileName} export must preserve ${marker}`).toContain(marker);
        }
    });
});
