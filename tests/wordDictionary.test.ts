import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    isSingleEnglishWord,
    lookupWord,
    mergeWordCardData,
    normalizeEnglishWord,
    parseDatamuseWord,
    parseFreeDictionaryEntry,
    parseWiktApiEntry,
    selectPronunciations,
} from '@/entrypoints/utils/wordDictionary';

function response(payload: unknown, ok = true, status = ok ? 200 : 503): Response {
    return {
        ok,
        status,
        json: async () => payload,
    } as Response;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('word selection normalization', () => {
    it('accepts one English word and normalizes smart apostrophes', () => {
        expect(normalizeEnglishWord('  Don’t  ')).toBe("don't");
        expect(isSingleEnglishWord('mother-in-law')).toBe(true);
        expect(isSingleEnglishWord('hello world')).toBe(false);
        expect(isSingleEnglishWord('hello!')).toBe(false);
        expect(isSingleEnglishWord('你好')).toBe(false);
    });
});

describe('word dictionary provider adapters', () => {
    it('normalizes Free Dictionary fields including IPA, audio, meanings and examples', () => {
        const card = parseFreeDictionaryEntry({
            word: 'hello',
            phonetics: [{ text: '/həˈloʊ/', audio: 'https://api.example.test/hello-us.mp3' }],
            meanings: [{
                partOfSpeech: 'noun',
                definitions: [{ definition: 'a greeting', example: 'Hello, everyone.' }],
            }],
            sourceUrls: ['https://en.wiktionary.org/wiki/hello'],
        }, 'hello');

        expect(card.phonetics).toEqual([{ text: '/həˈloʊ/', audio: 'https://api.example.test/hello-us.mp3', label: '美式' }]);
        expect(card.meanings).toEqual([{
            partOfSpeech: '名词',
            definitions: [{ definition: 'a greeting', example: 'Hello, everyone.' }],
        }]);
        expect(card.sources[0]?.url).toBe('https://dictionaryapi.dev/');
    });

    it('collapses duplicate IPA rows while keeping the first playable audio', () => {
        const card = parseFreeDictionaryEntry({
            word: 'single',
            phonetics: [
                { text: '/ˈsɪŋɡəl/', audio: 'https://api.example.test/single-us.mp3' },
                { text: '/ˈsɪŋɡəl/', audio: 'https://api.example.test/single-uk.mp3' },
            ],
        }, 'single');

        expect(card.phonetics).toHaveLength(1);
        expect(card.phonetics[0]?.audio).toBe('https://api.example.test/single-us.mp3');
    });

    it('keeps one preferred stressed pronunciation for each regional variety', () => {
        const pronunciations = selectPronunciations([
            { text: '/jə/', audio: 'https://api.example.test/you-au-us-unstressed.mp3', label: '美式' },
            { text: '/ju/', audio: 'https://api.example.test/you-us-stressed.mp3', label: '美式' },
            { text: '/juː/', audio: 'https://api.example.test/you-uk-stressed.mp3', label: '英式' },
            { text: '/jʉː/' },
        ]);

        expect(pronunciations.map(pronunciation => pronunciation.label)).toEqual(['美式', '英式']);
        expect(pronunciations.map(pronunciation => pronunciation.text)).toEqual(['/ju/', '/juː/']);
    });

    it('normalizes structured WiktApi senses and Wikimedia audio', () => {
        const card = parseWiktApiEntry({
            word: 'hello',
            pos: 'interjection',
            lang_code: 'en',
            senses: [{ glosses: ['a greeting'], examples: [{ text: 'Hello there.' }] }],
            sounds: [{ ipa: '/həˈloʊ/', mp3_url: 'https://upload.wikimedia.org/hello.mp3', tags: ['General-American'] }],
        }, 'hello');

        expect(card.meanings[0]?.partOfSpeech).toBe('感叹词');
        expect(card.meanings[0]?.definitions[0]).toEqual({ definition: 'a greeting', example: 'Hello there.' });
        expect(card.phonetics[0]).toEqual({ text: '/həˈloʊ/', audio: 'https://upload.wikimedia.org/hello.mp3', label: '美式' });
    });

    it('parses Datamuse definitions and pronunciation metadata', () => {
        const card = parseDatamuseWord({
            word: 'hello',
            tags: ['n', 'pron:/həˈloʊ/'],
            defs: ['n\tA greeting. ', 'n\tA salutation. '],
        }, 'hello');

        expect(card.phonetics[0]?.text).toBe('/həˈloʊ/');
        expect(card.meanings[0]).toEqual({
            partOfSpeech: '名词',
            definitions: [{ definition: 'A greeting.' }, { definition: 'A salutation.' }],
        });
    });
});

describe('word dictionary fallback chain', () => {
    it('continues from a failed primary provider to WiktApi', async () => {
        const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('dictionaryapi.dev')) return response({ message: 'unavailable' }, false);
            if (url.includes('api.wiktapi.dev')) {
                return response({
                    word: 'fallbackword',
                    entries: [{
                        lang_code: 'en',
                        pos: 'noun',
                        senses: [{ glosses: ['a fallback definition'] }],
                        sounds: [{ ipa: '/ˈfɔːlbæk/' }],
                    }],
                });
            }
            throw new Error('unexpected provider: ' + url);
        });
        vi.stubGlobal('fetch', fetchMock);

        const card = await lookupWord('fallbackword');

        expect(card?.meanings[0]?.definitions[0]?.definition).toBe('a fallback definition');
        expect(card?.phonetics[0]?.text).toBe('/ˈfɔːlbæk/');
        expect(card?.sources.map(item => item.id)).toEqual(['wiktapi']);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(warningSpy).toHaveBeenCalledOnce();
    });

    it('merges missing pronunciation fields from a backup without duplicating definitions', () => {
        const first = parseFreeDictionaryEntry({
            word: 'hello',
            phonetics: [{ text: '/həˈloʊ/' }],
            meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'a greeting' }] }],
        }, 'hello');
        const second = parseWiktApiEntry({
            word: 'hello',
            pos: 'noun',
            senses: [{ glosses: ['a greeting'] }],
            sounds: [{ ipa: '/həˈləʊ/', mp3_url: 'https://upload.wikimedia.org/hello-uk.mp3' }],
        }, 'hello');

        const merged = mergeWordCardData(first, second);

        expect(merged.meanings).toHaveLength(1);
        expect(merged.meanings[0]?.definitions).toHaveLength(1);
        expect(merged.phonetics).toHaveLength(2);
        expect(merged.sources.map(item => item.id)).toEqual(['free-dictionary', 'wiktapi']);
    });
});
