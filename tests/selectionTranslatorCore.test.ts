import { describe, expect, it } from 'vitest';
import {
    calculateSelectionPopupPosition,
    chooseSelectionRect,
    isSameLanguage,
    isSelectionExcludedTagName,
    normalizeSelectionText,
    normalizeSpeechLanguage,
} from '@/entrypoints/utils/selectionTranslatorCore';
import { buildEdgeTtsSsml, edgeTtsVoiceForLanguage } from '@/entrypoints/utils/edgeTts';

describe('selection translator core geometry', () => {
    const rects = [
        { top: 100, right: 300, bottom: 124, left: 80, width: 220, height: 24 },
        { top: 124, right: 180, bottom: 148, left: 80, width: 100, height: 24 },
    ];

    it('anchors a forward multi-line selection at its visual end', () => {
        expect(chooseSelectionRect(rects, true)).toEqual(rects[1]);
        expect(chooseSelectionRect(rects, false)).toEqual(rects[0]);
    });

    it('keeps the popup above the selection when there is room', () => {
        expect(calculateSelectionPopupPosition({ ...rects[0], top: 300, bottom: 324 }, { width: 360, height: 160 }, { width: 1200, height: 800 })).toEqual({
            left: 80,
            top: 130,
            placement: 'top',
        });
    });

    it('flips below and clamps to the viewport near the top edge', () => {
        expect(calculateSelectionPopupPosition({ top: 20, right: 30, bottom: 42, left: 4, width: 26, height: 22 }, { width: 360, height: 160 }, { width: 390, height: 300 })).toEqual({
            left: 12,
            top: 52,
            placement: 'bottom',
        });
    });
});

describe('selection translator text and speech language normalization', () => {
    it('matches detected languages with configured language families', () => {
        expect(isSameLanguage('zh-Hans', 'zh-Hant')).toBe(true);
        expect(isSameLanguage('eng', 'en')).toBe(true);
        expect(isSameLanguage('ja', 'en')).toBe(false);
        expect(isSameLanguage('und', 'en')).toBe(false);
        expect(isSameLanguage('en', 'auto')).toBe(false);
    });

    it('normalizes browser whitespace without changing words', () => {
        expect(normalizeSelectionText('  hello\u00a0  world\n   again  ')).toBe('hello world\nagain');
    });

    it('classifies atomic and interactive elements as non-text selections', () => {
        for (const tagName of ['img', 'svg', 'video', 'canvas', 'button', 'input', 'textarea', 'select', 'code', 'pre']) {
            expect(isSelectionExcludedTagName(tagName)).toBe(true);
        }
        expect(isSelectionExcludedTagName('p')).toBe(false);
        expect(isSelectionExcludedTagName('span')).toBe(false);
    });

    it('maps translation language codes to browser speech language codes', () => {
        expect(normalizeSpeechLanguage('zh-Hans')).toBe('zh-CN');
        expect(normalizeSpeechLanguage('en')).toBe('en-US');
        expect(normalizeSpeechLanguage('auto', 'zh-CN')).toBe('zh-CN');
        expect(normalizeSpeechLanguage('invalid value')).toBe('en-US');
    });

    it('uses stable Edge TTS voices instead of the first system voice', () => {
        expect(edgeTtsVoiceForLanguage('en-US')).toBe('en-US-AvaMultilingualNeural');
        expect(edgeTtsVoiceForLanguage('en')).toBe('en-US-AvaMultilingualNeural');
        expect(edgeTtsVoiceForLanguage('zh-Hans')).toBe('zh-CN-XiaoxiaoMultilingualNeural');
    });

    it('escapes selection text before putting it into SSML', () => {
        const ssml = buildEdgeTtsSsml('A < B & C', 'en-US-AvaMultilingualNeural');
        expect(ssml).toContain('A &lt; B &amp; C');
        expect(ssml).not.toContain('A < B & C');
    });
});
