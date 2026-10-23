import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  cjkUnigrams, hasMeaningfulQuery, isExpired,
  jaccard, rankRecords, tokenizeBigram, tokenSetBigram, type MemoryRecord, type RankOptions,
} from '@/src/core/harness/memorySearch';

const NOW = Date.parse('2026-09-05T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
function memory(id: string, content: string, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {id, content, kind: 'note', tags: [], scope: 'user', project: null, importance: 1,
    createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(),
    accessedAt: null, accessCount: 0, expiresAt: null, ...overrides};
}
function rankOne(record: MemoryRecord, query: string, options: RankOptions = {}) {
  const [hit] = rankRecords([record], query, 1, options);
  expect(hit).toBeDefined();
  expect(hit.reasons).toBeDefined();
  return {...hit, reasons: hit.reasons!};
}
afterEach(() => vi.restoreAllMocks());

describe('adapted Harness memory lexical retrieval', () => {
  it('tokenizes ASCII runs and overlapping CJK bigrams while retaining isolated CJK characters', () => {
    expect(tokenizeBigram('Read_read 42 苹果树，学！')).toEqual(['read_read', '42', '苹果', '果树', '学']);
    expect(tokenSetBigram('READ read 苹果苹果')).toEqual(new Set(['read', '苹果', '果苹']));
    expect(tokenizeBigram('!?')).toEqual([]);
    expect(cjkUnigrams('苹果苹果 Apple')).toEqual(new Set(['苹', '果']));
    expect(cjkUnigrams('only english')).toEqual(new Set());
  });

  it('distinguishes real overlap from empty sets and unrelated vocabulary', () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
    expect(jaccard(new Set(['apple', 'pear']), new Set(['apple', 'book']))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(['apple']), new Set())).toBe(0);
    expect(hasMeaningfulQuery('ok了吗')).toBe(false);
    expect(hasMeaningfulQuery('吗a学!')).toBe(false);
    expect(hasMeaningfulQuery('苹果')).toBe(true);
    expect(hasMeaningfulQuery('Learn')).toBe(true);
    expect(hasMeaningfulQuery('!?')).toBe(false);
  });

  it('ranks repeated query terms more strongly and caps the reported BM25 contribution', () => {
    expect(rankRecords([memory('text', 'apples')], '!?', 1, {now: NOW})).toEqual([]);
    expect(rankRecords([memory('empty', '')], 'apple', 1, {now: NOW})).toEqual([]);
    const ranked = rankRecords([memory('once', 'apple'), memory('repeated', 'apple apple apple')], 'apple pear', 2, {now: NOW});
    expect(ranked.map(hit => hit.record.id)).toEqual(['repeated', 'once']);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(rankOne(memory('full', 'apple pear peach berry'), 'apple pear peach berry', {now: NOW}).reasons).toContain('bm25:2.00(+2.00)');
  });

  it('returns no hit for empty input, unrelated content or isolated single-character CJK coincidence', () => {
    const unrelated = memory('noise', '水果摊');
    for (const query of ['  ', 'apples', '苹果']) {
      expect(rankRecords([unrelated], query, 1, {now: NOW})).toEqual([]);
    }
  });

  it('reports exact, tag and query-word matches independently of optional importance boosts', () => {
    const exact = rankOne(memory('exact', 'Read naturally', {tags: ['READ naturally']}), 'READ naturally', {now: NOW});
    expect(exact.score).toBeGreaterThan(0);
    expect(exact.reasons).toContain('substring:整串命中(+3.0)');
    expect(exact.reasons.some(reason => reason.startsWith('tag:'))).toBe(true);
    expect(exact.reasons.some(reason => reason.startsWith('qword:'))).toBe(true);
    expect(exact.reasons.some(reason => reason.startsWith('importance:'))).toBe(false);
    const tagOnly = rankOne(memory('tag', 'No textual overlap', {tags: ['APPLE']}), 'apple', {now: NOW});
    expect(tagOnly.score).toBe(1.5);
    expect(tagOnly.reasons[0]).toBe('base:tag(1.5)');
  });

  it('combines Chinese substring, bigram and unigram evidence without mutating records', () => {
    const record = memory('cn', '苹果的自然表达');
    const snapshot = structuredClone(record);
    const explained = rankOne(record, '苹果', {now: NOW});
    expect(explained.score).toBeGreaterThan(3);
    expect(explained.reasons.some(reason => reason.startsWith('bigram:'))).toBe(true);
    expect(explained.reasons.some(reason => reason.startsWith('unigram:'))).toBe(true);
    expect(explained.reasons.some(reason => reason.startsWith('bm25:'))).toBe(true);
    expect(record).toEqual(snapshot);
    expect(rankOne(memory('number', '42'), '42', {now: NOW}).score).toBeGreaterThan(0);
  });

  it('applies the recency half-life and uses later recall activity without making old access dates newer', () => {
    const recent = memory('recent', 'grammar');
    const old = memory('old', 'grammar', {updatedAt: new Date(NOW - 90 * DAY).toISOString()});
    const baseline = rankOne(recent, 'grammar', {now: NOW}).score;
    expect(rankOne(old, 'grammar', {now: NOW}).score).toBeCloseTo(baseline / 2);
    expect(rankOne(old, 'grammar', {now: NOW, recencyHalfLifeDays: 180}).score).toBeCloseTo(baseline * Math.sqrt(0.5));
    expect(rankOne({...old, accessedAt: new Date(NOW).toISOString()}, 'grammar', {now: NOW}).score).toBeCloseTo(baseline);
    expect(rankOne({...recent, accessedAt: old.updatedAt}, 'grammar', {now: NOW}).score).toBeCloseTo(baseline);
  });

  it('caps access boosts, honors importance and limits detailed reasons to eight', () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const baseline = rankOne(memory('base', 'grammar'), 'grammar').score;
    const weighted = rankOne(memory('weighted', 'grammar', {importance: 3, accessCount: 1_000_000}), 'grammar');
    expect(weighted.score).toBeCloseTo(baseline * 2.5 * 1.5);
    expect(weighted.reasons.some(reason => reason.startsWith('importance:'))).toBe(true);
    expect(weighted.reasons.some(reason => reason.startsWith('access:'))).toBe(true);
    const manyReasons = rankOne(memory('many', 'grammar clause noun verb apple', {tags: ['grammar clause noun verb apple'], importance: 3, accessCount: 10}), 'grammar clause noun verb apple');
    expect(manyReasons.reasons).toHaveLength(8);
  });

  it('excludes expired and zero-score records, keeps ties stable and obeys the requested limit', () => {
    const first = memory('first', 'grammar');
    const second = memory('second', 'grammar');
    const expired = memory('expired', 'grammar', {expiresAt: new Date(NOW).toISOString()});
    const future = memory('future', 'grammar', {expiresAt: new Date(NOW + 1).toISOString()});
    expect(isExpired(expired, NOW)).toBe(true);
    expect(isExpired(future, NOW)).toBe(false);
    expect(isExpired(first, NOW)).toBe(false);
    const all = [first, expired, memory('noise', 'oranges'), second, future];
    expect(rankRecords(all, 'grammar', 2, {now: NOW}).map(hit => hit.record.id)).toEqual(['first', 'second']);
    expect(rankRecords(all, 'grammar', -1, {now: NOW})).toEqual([]);
    expect(rankRecords(all, '', 3, {now: NOW})).toEqual([]);
    expect(rankRecords([], 'grammar', 3, {now: NOW})).toEqual([]);
    expect(all.map(item => item.id)).toEqual(['first', 'expired', 'noise', 'second', 'future']);
  });

  it('uses injected wall time defaults consistently for ranking and expiry', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(NOW);
    expect(isExpired(memory('expired', 'grammar', {expiresAt: new Date(NOW).toISOString()}))).toBe(true);
    clock.mockClear();
    const hits = rankRecords([memory('weak', 'grammar', {importance: 1}), memory('strong', 'grammar', {importance: 3})], 'grammar', 3);
    expect(clock).toHaveBeenCalledOnce();
    expect(hits.map(hit => hit.record.id)).toEqual(['strong', 'weak']);
    expect(hits.every(hit => hit.reasons!.length > 0)).toBe(true);
  });
});
