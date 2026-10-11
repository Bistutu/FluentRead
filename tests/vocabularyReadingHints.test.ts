import {describe, expect, it, vi} from 'vitest';
import {createVocabularyBookHandler, type VocabularyBookBackgroundDependencies} from '@/src/features/vocabulary/background';
import {matchVocabularyReadingHints, vocabularyReadingHintSnapshot} from '@/src/features/vocabulary/domain/readingHints';
import type {VocabularyEntry, VocabularyReviewLog} from '@/src/features/vocabulary/learningModel';
import {VOCABULARY_BOOK_MESSAGE} from '@/src/features/vocabulary/protocol';

function entry(overrides: Partial<VocabularyEntry> = {}): VocabularyEntry {
    return {id: 'account', term: 'account', kind: 'expression', sourceLanguage: 'en', status: 'mastered', masteryLevel: 5,
        normalizedTerm: (overrides.term ?? 'account').normalize('NFKC').toLowerCase(),
        lastReviewedAt: 10, translations: {'zh-cn': {text: '考虑', updatedAt: 1}}, contexts: [{text: 'We take this into account.', capturedAt: 1}],
        ...overrides} as VocabularyEntry;
}

function log(rating: VocabularyReviewLog['rating'], reviewedAt = 10, id = 'log'): VocabularyReviewLog {
    return {id, entryId: 'account', rating, reviewedAt, beforeLevel: 0, afterLevel: 5, nextReviewAt: 20};
}

function dependencies(entries: VocabularyEntry[] = [entry()], vocabularyEnabled = true) {
    const repository = {
        list: vi.fn(async () => entries), getReviewLogs: vi.fn(async () => [log('manual-mastered')]),
        upsert: vi.fn(), setMastery: vi.fn(), relearn: vi.fn(), review: vi.fn(),
    };
    const deps = {configReady: Promise.resolve(), isVocabularyBookEnabled: () => vocabularyEnabled,
        vocabularyBook: repository, broadcastChanged: vi.fn(), logOperationFailure: vi.fn()} as unknown as VocabularyBookBackgroundDependencies;
    return {repository, deps};
}

describe('渐进阅读收藏提示的纯匹配和保守掌握证据', () => {
    it('多词表达优先于短词并保留原文坐标，不匹配词内子串或整句收藏', () => {
        const source = '😀 Take\tinto account accountability; account.';
        const phrase = entry({id: 'phrase', term: 'take into account'});
        const results = matchVocabularyReadingHints(source, [entry(), phrase, entry({id: 'sentence', term: source, kind: 'sentence'})]);
        expect(results.map(match => [match.entry.id, source.slice(match.start, match.end)])).toEqual([
            ['phrase', 'Take\tinto account'], ['account', 'account'],
        ]);
        expect(results[0].start).toBe(3);
        expect(matchVocabularyReadingHints(source, [])).toEqual([]);
    });

    it('提示命中上限为 24，重复表达也在到达上限时停止', () => {
        const matches = matchVocabularyReadingHints('account '.repeat(30), [entry()]);
        expect(matches).toHaveLength(24);
        expect(matches.at(-1)?.end).toBe(191);
    });

    it('只投影目标语已有译文与最小字段，使用 NFC 和空白核对相同语境', () => {
        const saved = entry({contexts: [{text: 'café account', capturedAt: 1, sourceUrl: 'https://private.test/', pageTitle: 'private'}], note: 'private note'});
        const match = {entry: saved, start: 6, end: 13, ambiguous: false};
        expect(vocabularyReadingHintSnapshot('  café\naccount ', 'zh-cn', match, [log('manual-mastered')])).toEqual({
            id: 'account', term: 'account', sourceLanguage: 'en', reference: '考虑', start: 6, end: 13,
            explicitMastered: true, sameContext: true,
        });
        expect(vocabularyReadingHintSnapshot('A bank account.', 'de', match, [log('manual-mastered')])).toMatchObject({
            reference: '', explicitMastered: true, sameContext: false,
        });
        expect(vocabularyReadingHintSnapshot('CAFÉ account', 'zh-cn', match, [log('manual-mastered')]).sameContext).toBe(false);
    });

    it('连续 good 达到掌握、缺失日志、陈旧日志和重新学习都不视为明确掌握', () => {
        const match = {entry: entry(), start: 0, end: 7, ambiguous: false};
        for (const logs of [[], [log('good')], [log('manual-mastered', 9)], [log('manual-mastered', 8), log('relearn')]]) {
            expect(vocabularyReadingHintSnapshot('account', 'zh-cn', match, logs).explicitMastered).toBe(false);
        }
        expect(vocabularyReadingHintSnapshot('account', 'zh-cn', {...match, entry: entry({status: 'learning'})}, [log('manual-mastered')]).explicitMastered).toBe(false);
        expect(vocabularyReadingHintSnapshot('account', 'zh-cn', {...match, entry: entry({contexts: []})}, [log('manual-mastered')]).sameContext).toBe(false);
    });

    it('以最新学习时间为准，同一时间出现不同操作时保守保持提示', () => {
        const match = {entry: entry(), start: 0, end: 7, ambiguous: false};
        expect(vocabularyReadingHintSnapshot('account', 'zh-cn', match, [log('manual-mastered'), log('again', 2)]).explicitMastered).toBe(true);
        expect(vocabularyReadingHintSnapshot('account', 'zh-cn', match, [log('manual-mastered', 10, 'a'), log('relearn', 10, 'z')]).explicitMastered).toBe(false);
        expect(vocabularyReadingHintSnapshot('account', 'zh-cn', match, [log('manual-mastered', 10, 'z'), log('good', 10, 'a')]).explicitMastered).toBe(false);
        expect(vocabularyReadingHintSnapshot('account', 'zh-cn', match, [log('manual-mastered', 10, 'z'), log('manual-mastered', 10, 'a')]).explicitMastered).toBe(true);
    });

    it('跨源语言的同一规范表达不因索引选择某条收藏而退场，其他表达不受影响', () => {
        const text = 'We take this into account.';
        const english = entry();
        const french = entry({id: 'french-account', term: 'ACCOUNT', sourceLanguage: 'fr'});
        const unrelated = entry({id: 'phrase', term: 'take this', sourceLanguage: 'fr'});
        for (const expressions of [[english, french, unrelated], [french, english, unrelated]]) {
            const matches = matchVocabularyReadingHints(text, expressions);
            const ambiguous = matches.find(match => match.entry.normalizedTerm === 'account')!;
            expect(ambiguous.ambiguous).toBe(true);
            expect(vocabularyReadingHintSnapshot(text, 'zh-cn', ambiguous, [log('manual-mastered')])).toMatchObject({sameContext: true, explicitMastered: false});
            expect(matches.find(match => match.entry.id === 'phrase')?.ambiguous).toBe(false);
        }
        const sameLanguage = matchVocabularyReadingHints(text, [english, entry({id: 'duplicate'})])[0];
        expect(sameLanguage.ambiguous).toBe(false);
        expect(vocabularyReadingHintSnapshot(text, 'zh-cn', sameLanguage, [log('manual-mastered')]).explicitMastered).toBe(true);
    });
});

describe('渐进阅读 readingHints 消息的读取边界', () => {
    const request = (input: unknown = {text: 'We take this into account.', targetLanguage: 'ZH_cn'}) =>
        ({type: VOCABULARY_BOOK_MESSAGE, action: 'readingHints', input});

    it('只读取匹配收藏的日志并返回可对照提示，不写入掌握状态或广播', async () => {
        const {deps, repository} = dependencies([entry(), entry({id: 'other', term: 'elsewhere'})]);
        const result = await createVocabularyBookHandler(deps).handle(request(), {});
        expect(result).toEqual({success: true, data: [{id: 'account', term: 'account', sourceLanguage: 'en', reference: '考虑',
            start: 18, end: 25, explicitMastered: true, sameContext: true}]});
        expect(repository.getReviewLogs).toHaveBeenCalledTimes(1);
        expect(repository.getReviewLogs).toHaveBeenCalledWith('account');
        expect(repository.list).toHaveBeenCalledWith({order: 'recent'});
        expect(repository.upsert).not.toHaveBeenCalled(); expect(repository.setMastery).not.toHaveBeenCalled();
        expect(repository.relearn).not.toHaveBeenCalled(); expect(repository.review).not.toHaveBeenCalled();
        expect(deps.broadcastChanged).not.toHaveBeenCalled();
    });

    it('重复命中只读一次学习日志，无匹配无需读任何日志', async () => {
        const {deps, repository} = dependencies();
        const handler = createVocabularyBookHandler(deps);
        const repeated = await handler.handle(request({text: 'account '.repeat(30), targetLanguage: 'zh-cn'}), {});
        expect(repeated.success && repeated.data).toHaveLength(24);
        expect(repository.getReviewLogs).toHaveBeenCalledTimes(1);
        repository.getReviewLogs.mockClear();
        expect(await handler.handle(request({text: 'No saved expression.', targetLanguage: 'zh-cn'}), {})).toEqual({success: true, data: []});
        expect(repository.getReviewLogs).not.toHaveBeenCalled();
    });

    it('收藏关闭与无痕窗口不给页面读取历史的机会，且不依赖再遇开关', async () => {
        const disabled = dependencies([entry()], false);
        expect(await createVocabularyBookHandler(disabled.deps).handle(request(), {})).toEqual({success: true, data: []});
        expect(disabled.repository.list).not.toHaveBeenCalled();
        const privateWindow = dependencies();
        expect(await createVocabularyBookHandler(privateWindow.deps).handle(request(), {sender: {tab: {incognito: true}}})).toEqual({success: true, data: []});
        expect(privateWindow.repository.list).not.toHaveBeenCalled();
    });

    it('拒绝非法原文和语言而保留合法原文的前后空白坐标', async () => {
        const {deps, repository} = dependencies();
        const handler = createVocabularyBookHandler(deps);
        for (const input of [undefined, [], {text: 42}, {text: '  !😀'}, {text: 'x'.repeat(4097), targetLanguage: 'en'},
            {text: 'account', targetLanguage: undefined}, {text: 'account', targetLanguage: ' '},
            {text: 'account', targetLanguage: 'en/invalid'}, {text: 'account', targetLanguage: 'a'.repeat(65)}]) {
            const invalid = await handler.handle({...request(), input}, {});
            expect(invalid).toMatchObject({success: false, error: {code: 'invalid-input'}});
        }
        expect(repository.list).not.toHaveBeenCalled();
        expect(await handler.handle(request({text: '   account ', targetLanguage: ' en '}), {})).toMatchObject({success: true,
            data: [{start: 3, end: 10, reference: ''}]});
        expect(await handler.handle(request({text: 'x'.repeat(4096), targetLanguage: 'a'.repeat(64)}), {})).toEqual({success: true, data: []});
    });

    it('词书和日志读取失败沿用结构化错误，不将部分状态伪装为明确掌握', async () => {
        const {deps, repository} = dependencies();
        const handler = createVocabularyBookHandler(deps);
        repository.list.mockRejectedValueOnce(new Error('list unavailable'));
        expect(await handler.handle(request(), {})).toMatchObject({success: false, error: {code: 'storage-error', message: 'list unavailable'}});
        repository.getReviewLogs.mockRejectedValueOnce(new Error('logs unavailable'));
        expect(await handler.handle(request(), {})).toMatchObject({success: false, error: {code: 'storage-error', message: 'logs unavailable'}});
    });
});
