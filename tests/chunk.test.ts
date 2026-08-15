import { describe, expect, it } from 'vitest';
import { findTextChunk, findTextParagraph } from '@/entrypoints/main/chunk';

describe('findTextParagraph', () => {
    it('selects the visual paragraph around the pointer', () => {
        const text = 'First paragraph.\n\nSecond paragraph with a link.\n\nThird paragraph.';
        expect(findTextParagraph(text, 30)).toEqual({ start: 18, end: 47 });
    });

    it('returns null when the text has no paragraph boundary', () => {
        expect(findTextParagraph('One continuous paragraph.', 4)).toBeNull();
    });
});

describe('findTextChunk', () => {
    it('keeps complete sentences within the target size', () => {
        const text = 'First sentence. Second sentence. Third sentence.';
        expect(findTextChunk(text, 20, 20)).toEqual({ start: 16, end: 33 });
    });

    it('splits a sentence that is longer than the target size', () => {
        const text = 'one two three four five six seven eight nine ten';
        const chunk = findTextChunk(text, 25, 20);
        expect(text.slice(chunk.start, chunk.end)).toBe('five six seven eight ');
    });

    it('returns the whole short block', () => {
        expect(findTextChunk('Short text.', 3)).toEqual({ start: 0, end: 11 });
    });
});
