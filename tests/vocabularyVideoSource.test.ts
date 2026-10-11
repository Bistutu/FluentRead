import 'fake-indexeddb/auto';
import {afterEach, describe, expect, it} from 'vitest';
import {FluentReadVocabularyBookDatabase, VocabularyBookRepository, mergeVocabularyContexts, sanitizeVocabularyContext} from '@/src/features/vocabulary/repository';
import {sanitizeVocabularyVideoSource, sanitizeVocabularyVideoUrl, vocabularySourceContext, vocabularySourceLink} from '@/src/features/vocabulary/source';
import type {VocabularyContext, VocabularyVideoSource} from '@/src/features/vocabulary/learningModel';

const URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const VIDEO: VocabularyVideoSource = {platform: 'youtube', startMs: 1_250, endMs: 4_600};
const CONTEXT: VocabularyContext = {text: 'Earlier. We can learn this sentence. Later.', sourceUrl: URL, pageTitle: 'A real video', capturedAt: 10, video: VIDEO};
const databases: FluentReadVocabularyBookDatabase[] = [];
afterEach(async () => {
    for (const db of databases.splice(0)) {db.close(); await db.delete();}
});

describe('video learning source validation and links', () => {
    it('accepts only bounded integer original timeline positions for supported platforms', () => {
        expect(sanitizeVocabularyVideoSource(VIDEO)).toEqual(VIDEO);
        expect(sanitizeVocabularyVideoSource({platform: 'x', startMs: 0, endMs: 604_800_000})).toEqual({platform: 'x', startMs: 0, endMs: 604_800_000});
        for (const value of [undefined, null, [], '', 1, {}, {platform: 'local'},
            {...VIDEO, startMs: undefined}, {...VIDEO, endMs: undefined}, {...VIDEO, startMs: 0.5}, {...VIDEO, endMs: 4.5},
            {...VIDEO, startMs: Infinity}, {...VIDEO, endMs: NaN}, {...VIDEO, startMs: -1},
            {...VIDEO, endMs: VIDEO.startMs}, {...VIDEO, endMs: 0}, {...VIDEO, endMs: 604_800_001}]) {
            expect(sanitizeVocabularyVideoSource(value)).toBeUndefined();
        }
    });

    it('canonicalizes supported YouTube URLs while retaining the only required video query', () => {
        for (const source of [URL, `${URL}&token=private#chapter`, 'http://youtube.com/watch?v=dQw4w9WgXcQ',
            'https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
            'https://youtu.be/dQw4w9WgXcQ?si=tracking', 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
            'https://www.youtube.com/embed/dQw4w9WgXcQ/', 'https://www.youtube.com/live/dQw4w9WgXcQ']) {
            expect(sanitizeVocabularyVideoUrl(source, 'youtube')).toBe(URL);
        }
        for (const source of [null, 'x'.repeat(2_049), 'not a URL', 'blob:https://youtube.com/id', 'file:///video.mp4',
            'https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ', 'https://user@youtube.com/watch?v=dQw4w9WgXcQ',
            'https://:pass@youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com:123/watch?v=dQw4w9WgXcQ',
            'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://youtube.com/', 'https://youtube.com/watch',
            'https://youtube.com/watch?v=', 'https://youtube.com/watch?v=short', 'https://youtu.be/short',
            'https://youtu.be/dQw4w9WgXcQ/extra']) {
            expect(sanitizeVocabularyVideoUrl(source, 'youtube')).toBeUndefined();
        }
    });

    it('keeps X post and video identities and rejects home, search and unsupported hosts', () => {
        for (const host of ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']) {
            expect(sanitizeVocabularyVideoUrl(`https://${host}/reader/status/12345?token=private`, 'x')).toBe('https://x.com/reader/status/12345');
            expect(sanitizeVocabularyVideoUrl(`https://${host}/reader/status/12345/video/2/?tracking=1`, 'x')).toBe('https://x.com/reader/status/12345/video/2');
        }
        for (const source of ['https://x.com/home', 'https://x.com/search?q=video', 'https://x.com/reader/status/abc',
            'https://x.com/reader/status/12345/video/0', 'https://x.com.evil.test/reader/status/12345', URL]) {
            expect(sanitizeVocabularyVideoUrl(source, 'x')).toBeUndefined();
        }
    });

    it('returns original time ranges, precise YouTube links and an X runtime fragment without invented URLs', () => {
        expect(vocabularySourceLink(CONTEXT)).toEqual({href: `${URL}&t=1.25s`, timeLabel: '00:01–00:04', unavailable: false});
        expect(vocabularySourceLink({sourceUrl: 'https://x.com/reader/status/123/video/2', video: {platform: 'x', startMs: 65_000, endMs: 3_666_000}}))
            .toEqual({href: 'https://x.com/reader/status/123/video/2#fluentread-video=65000,3666000', timeLabel: '01:05–61:06', unavailable: false});
        expect(vocabularySourceLink({video: VIDEO})).toEqual({timeLabel: '00:01–00:04', unavailable: true});
        expect(vocabularySourceLink({sourceUrl: 'blob:local-video', video: VIDEO})).toEqual({timeLabel: '00:01–00:04', unavailable: true});
        expect(vocabularySourceLink(undefined)).toEqual({unavailable: false});
        expect(vocabularySourceLink({})).toEqual({unavailable: false});
        expect(vocabularySourceLink({sourceUrl: 'javascript:alert(1)'})).toEqual({unavailable: true});
        expect(vocabularySourceLink({sourceUrl: 'invalid URL'})).toEqual({unavailable: true});
        expect(vocabularySourceLink({sourceUrl: 'https://user:pass@example.test/article?chapter=2#paragraph'}))
            .toEqual({href: 'https://example.test/article?chapter=2#paragraph', unavailable: false});
        expect(vocabularySourceLink({sourceUrl: 'http://example.test/article'})).toEqual({href: 'http://example.test/article', unavailable: false});
    });

    it('selects the latest recoverable source even when the sentence has no additional cloze context', () => {
        const plain = {text: 'No source.', capturedAt: 1};
        const older = {...CONTEXT, capturedAt: 2};
        const newer = {...CONTEXT, capturedAt: 3, sourceUrl: undefined};
        const equal = {...CONTEXT, capturedAt: 3, pageTitle: 'Equal timestamp'};
        expect(vocabularySourceContext({contexts: []})).toBeUndefined();
        expect(vocabularySourceContext({contexts: [plain]})).toBeUndefined();
        expect(vocabularySourceContext({contexts: [plain, newer, older, equal]})).toBe(equal);
        const article = {text: 'Article.', capturedAt: 5, sourceUrl: 'https://example.test/article'};
        expect(vocabularySourceContext({contexts: [newer, article]})).toBe(article);
    });
});

describe('video context persistence and privacy', () => {
    it('persists a large complete sentence with both neighbors, while ordinary contexts retain their 500 character limit', async () => {
        const term = `${'We keep learning with enough context '.repeat(50).trim()}.`;
        const text = [`${'Before '.repeat(110).trim()}.`, term, `${'After '.repeat(110).trim()}.`].join(' ');
        expect(text.length).toBeGreaterThan(500); expect(text.length).toBeLessThan(6_000);
        const context = {...CONTEXT, text};
        expect(sanitizeVocabularyContext({...context, video: undefined})!.text).toHaveLength(500);
        expect(sanitizeVocabularyContext({...context, video: {...VIDEO, endMs: -1}})!.text).toHaveLength(500);
        expect(sanitizeVocabularyContext({...context, text: 'a'.repeat(6_001)})!.text).toHaveLength(6_000);
        expect(mergeVocabularyContexts([context], [{...context, text: `${text} Different trailing context.`}])).toHaveLength(2);
        const db = new FluentReadVocabularyBookDatabase(`VideoVocabularyLong-${crypto.randomUUID()}`); databases.push(db);
        const repository = new VocabularyBookRepository(db);
        const saved = await repository.upsert({sourceLanguage: 'en', targetLanguage: 'zh-CN', term, translation: '完整句子的译文', kind: 'sentence', context}, 10);
        expect(saved.contexts[0]!.text).toBe(text);
        const exported = await repository.exportData({includePrivateContext: true});
        await repository.clear();
        await repository.importData(JSON.parse(JSON.stringify(exported)), 20);
        expect((await repository.get(saved.id))!.contexts[0]).toEqual(context);
    });

    it('validates platform, timestamp and URL metadata without throwing away a recoverable local sentence', () => {
        expect(sanitizeVocabularyContext({...CONTEXT, sourceUrl: `${URL}&token=private`}, 20)).toEqual(CONTEXT);
        expect(sanitizeVocabularyContext({...CONTEXT, sourceUrl: 'blob:local-video'}, 20)).toEqual({...CONTEXT, sourceUrl: undefined});
        expect(sanitizeVocabularyContext({...CONTEXT, video: {...VIDEO, endMs: -1}}, 20)).toEqual({text: CONTEXT.text, capturedAt: 10, pageTitle: 'A real video'});
    });

    it('deduplicates the same fragment but retains identical text at different positions and detaches metadata', () => {
        const later = {...CONTEXT, video: {...VIDEO, startMs: 10_000, endMs: 13_000}, capturedAt: 20};
        const x = {...CONTEXT, video: {...VIDEO, platform: 'x' as const}, capturedAt: 30};
        const changedEnd = {...CONTEXT, video: {...VIDEO, endMs: 5_000}, capturedAt: 40};
        const merged = mergeVocabularyContexts([CONTEXT], [{...CONTEXT, capturedAt: 11}, later, x, changedEnd]);
        expect(merged).toHaveLength(4);
        expect(merged.map(context => context.video)).toEqual([VIDEO, later.video, x.video, changedEnd.video]);
        merged[0]!.video!.startMs = 999;
        expect(CONTEXT.video!.startMs).toBe(1_250);
    });

    it('round-trips video contexts and confirmed explanation privately, while public export omits all source data', async () => {
        const db = new FluentReadVocabularyBookDatabase(`VideoVocabulary-${crypto.randomUUID()}`); databases.push(db);
        const repository = new VocabularyBookRepository(db);
        const input = {sourceLanguage: 'en', targetLanguage: 'zh-CN', term: 'We can learn this sentence.', translation: '我们可以学习这个句子。', note: 'Confirmed explanation', kind: 'sentence' as const, context: CONTEXT};
        const original = await repository.upsert(input, 10);
        const repeated = await repository.upsert(input, 11);
        expect(repeated.id).toBe(original.id); expect(repeated.contexts).toHaveLength(1);
        const later = await repository.upsert({...input, context: {...CONTEXT, video: {...VIDEO, startMs: 10_000, endMs: 13_000}, capturedAt: 20}}, 20);
        expect(later.id).toBe(original.id); expect(later.contexts).toHaveLength(2);
        const publicExport = await repository.exportData();
        expect(publicExport.entries[0]!.contexts).toEqual([{capturedAt: 10}, {capturedAt: 20}]);
        expect(JSON.stringify(publicExport)).not.toContain('youtube');
        expect(JSON.stringify(publicExport)).not.toContain('A real video');
        const privateExport = await repository.exportData({includePrivateContext: true});
        expect(privateExport.entries[0]!.contexts).toEqual(later.contexts);
        privateExport.entries[0]!.contexts[0]!.video!.startMs = 777;
        expect((await repository.get(original.id))!.contexts[0]!.video!.startMs).toBe(1_250);
        const exported = await repository.exportData({includePrivateContext: true});
        await repository.clear();
        await expect(repository.importData(JSON.parse(JSON.stringify(exported)), 30)).resolves.toMatchObject({inserted: 1});
        const restored = await repository.get(original.id);
        expect(restored!.contexts).toEqual(later.contexts);
        expect(restored!.note).toBe('Confirmed explanation');
        expect(vocabularySourceLink(vocabularySourceContext(restored!)).href).toBe(`${URL}&t=10s`);
        exported.entries[0]!.contexts.push({...CONTEXT, sourceUrl: 'https://evil.test/video', video: {...VIDEO, platform: 'x'}});
        exported.entries[0]!.contexts.push({...CONTEXT, video: {...VIDEO, startMs: -1}});
        await repository.importData(exported, 40);
        expect((await repository.get(original.id))!.contexts.some(context => context.video?.platform === 'x' && !context.sourceUrl)).toBe(true);
        expect((await repository.get(original.id))!.contexts.every(context => !context.video || context.video.startMs >= 0)).toBe(true);
    });
});
