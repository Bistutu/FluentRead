import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TRANSLATION_CACHE_MAX_ENTRY_BYTES,
  TRANSLATION_CACHE_TTL_MS,
  buildTranslationCacheKey,
  canonicalize,
  translationCache,
  translationCacheDb,
} from '@/entrypoints/utils/translationCache';

describe('translation cache identity', () => {
  it('canonicalizes object properties independent of insertion order', () => {
    expect(canonicalize({ b: 2, a: 1 })).toBe(canonicalize({ a: 1, b: 2 }));
  });

  it('uses an opaque versioned digest instead of delimiter-concatenated text', () => {
    const base = { sourceText: 'a_b', targetLanguage: 'zh-Hans', service: 'microsoft' };
    const key = buildTranslationCacheKey(base);
    const differentTextKey = buildTranslationCacheKey({ ...base, sourceText: 'a' });

    expect(key).toMatch(/^v1:[0-9a-f]{64}$/);
    expect(differentTextKey).not.toBe(key);
  });

  it('isolates cache entries when request identity changes', () => {
    const base = { sourceText: 'same', targetLanguage: 'zh-Hans', service: 'microsoft' };

    expect(buildTranslationCacheKey(base)).not.toBe(
      buildTranslationCacheKey({ ...base, targetLanguage: 'en' }),
    );
    expect(buildTranslationCacheKey(base)).not.toBe(
      buildTranslationCacheKey({ ...base, service: 'google' }),
    );
  });
});

describe('translation cache persistence policy', () => {
  afterEach(async () => {
    await translationCache.clear();
  });

  it('returns entries before TTL and expires them at TTL', async () => {
    const key = 'test-ttl';
    const createdAt = 1_000;

    await expect(translationCache.set(key, '译文', createdAt)).resolves.toBe(true);
    await expect(translationCache.get(key, createdAt + TRANSLATION_CACHE_TTL_MS - 1)).resolves.toBe('译文');
    await expect(translationCache.get(key, createdAt + TRANSLATION_CACHE_TTL_MS)).resolves.toBeNull();
  });

  it('cleans legacy records according to createdAt and the current 24-hour TTL', async () => {
    const createdAt = 1_000;
    await translationCacheDb.entries.put({
      key: 'legacy-ttl',
      translation: '旧译文',
      createdAt,
      lastAccessedAt: createdAt,
      // Simulate a record written before the TTL was reduced from 7 days.
      expiresAt: createdAt + 7 * TRANSLATION_CACHE_TTL_MS,
      byteSize: 20,
    });

    await translationCache.cleanup(createdAt + TRANSLATION_CACHE_TTL_MS);
    await expect(translationCacheDb.entries.get('legacy-ttl')).resolves.toBeUndefined();
  });

  it('does not persist entries larger than the per-entry limit', async () => {
    const oversized = 'x'.repeat(TRANSLATION_CACHE_MAX_ENTRY_BYTES);

    await expect(translationCache.set('too-large', oversized, 1_000)).resolves.toBe(false);
    await expect(translationCache.get('too-large', 1_000)).resolves.toBeNull();
  });
});
