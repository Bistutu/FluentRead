import CryptoJS from 'crypto-js';
import Dexie, { type Table } from 'dexie';

export const TRANSLATION_CACHE_VERSION = 1;
export const TRANSLATION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const TRANSLATION_CACHE_MAX_ENTRIES = 2_000;
export const TRANSLATION_CACHE_MAX_BYTES = 5 * 1024 * 1024;
export const TRANSLATION_CACHE_MAX_ENTRY_BYTES = 256 * 1024;
export const TRANSLATION_CACHE_MEMORY_ENTRIES = 128;

export interface TranslationCacheIdentity {
  [key: string]: unknown;
}

export interface TranslationCacheRecord {
  key: string;
  translation: string;
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  byteSize: number;
}

/**
 * Serialize structured cache identity deterministically. Object property order
 * must not change the cache key, and user text must never be used as a
 * delimiter-separated key component.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value === 'undefined') return 'null';

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item !== 'undefined')
      .sort(([left], [right]) => left.localeCompare(right));

    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(',')}}`;
  }

  return JSON.stringify(String(value));
}

/**
 * Produce a versioned, opaque key from a structured request identity.
 * The version allows future cache schema/key changes without reusing stale
 * entries from an older request contract.
 */
export function buildTranslationCacheKey(identity: TranslationCacheIdentity): string {
  const payload = canonicalize({
    version: TRANSLATION_CACHE_VERSION,
    ...identity,
  });
  const digest = CryptoJS.SHA256(payload).toString(CryptoJS.enc.Hex);
  return `v${TRANSLATION_CACHE_VERSION}:${digest}`;
}

function getByteSize(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).byteLength;
  }
  return value.length * 2;
}

class FluentReadCacheDatabase extends Dexie {
  entries!: Table<TranslationCacheRecord, string>;

  constructor() {
    super('FluentReadTranslationCache');
    this.version(1).stores({
      entries: '&key, expiresAt, lastAccessedAt',
    });
  }
}

export const translationCacheDb = new FluentReadCacheDatabase();

function isExpired(record: TranslationCacheRecord, now: number): boolean {
  return record.expiresAt <= now;
}

/**
 * Background-owned persistent cache with a small hot-memory layer. Cache
 * failures are intentionally swallowed: translation must still work when a
 * browser disables IndexedDB, the profile is in private mode, or the quota is
 * exhausted.
 */
class TranslationCache {
  private readonly memory = new Map<string, TranslationCacheRecord>();

  private remember(record: TranslationCacheRecord): void {
    this.memory.delete(record.key);
    this.memory.set(record.key, record);

    while (this.memory.size > TRANSLATION_CACHE_MEMORY_ENTRIES) {
      const oldestKey = this.memory.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.memory.delete(oldestKey);
    }
  }

  private forget(key: string): void {
    this.memory.delete(key);
  }

  async get(key: string, now = Date.now()): Promise<string | null> {
    const memoryRecord = this.memory.get(key);
    if (memoryRecord) {
      if (isExpired(memoryRecord, now)) {
        this.forget(key);
        void translationCacheDb.entries.delete(key).catch(() => undefined);
        return null;
      }

      memoryRecord.lastAccessedAt = now;
      this.remember(memoryRecord);
      return memoryRecord.translation;
    }

    try {
      const record = await translationCacheDb.entries.get(key);
      if (!record) return null;

      if (isExpired(record, now)) {
        await translationCacheDb.entries.delete(key);
        return null;
      }

      record.lastAccessedAt = now;
      // A cold hit may have been evicted from the hot-memory layer. Persist
      // the access time so the IndexedDB LRU policy remains meaningful too.
      await translationCacheDb.entries.put(record);
      this.remember(record);
      return record.translation;
    } catch (error) {
      console.warn('[FluentRead] translation cache read failed:', error);
      return null;
    }
  }

  async set(key: string, translation: string, now = Date.now()): Promise<boolean> {
    const byteSize = getByteSize(key) + getByteSize(translation);
    if (!translation || byteSize > TRANSLATION_CACHE_MAX_ENTRY_BYTES) {
      return false;
    }

    const record: TranslationCacheRecord = {
      key,
      translation,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt: now + TRANSLATION_CACHE_TTL_MS,
      byteSize,
    };

    try {
      await translationCacheDb.transaction('rw', translationCacheDb.entries, async () => {
        await translationCacheDb.entries.put(record);

        const entries = await translationCacheDb.entries.orderBy('lastAccessedAt').toArray();
        let totalBytes = entries.reduce((total, item) => total + item.byteSize, 0);
        const keysToDelete: string[] = [];

        while (
          entries.length - keysToDelete.length > TRANSLATION_CACHE_MAX_ENTRIES ||
          totalBytes > TRANSLATION_CACHE_MAX_BYTES
        ) {
          const candidate = entries[keysToDelete.length];
          if (!candidate) break;
          keysToDelete.push(candidate.key);
          totalBytes -= candidate.byteSize;
        }

        if (keysToDelete.length > 0) {
          await translationCacheDb.entries.bulkDelete(keysToDelete);
          keysToDelete.forEach((entryKey) => this.forget(entryKey));
        }
      });

      this.remember(record);
      return true;
    } catch (error) {
      console.warn('[FluentRead] translation cache write failed:', error);
      return false;
    }
  }

  async cleanup(now = Date.now()): Promise<void> {
    try {
      await translationCacheDb.entries.where('expiresAt').belowOrEqual(now).delete();
      for (const [key, record] of this.memory) {
        if (isExpired(record, now)) this.memory.delete(key);
      }
    } catch (error) {
      console.warn('[FluentRead] translation cache cleanup failed:', error);
    }
  }

  async clear(): Promise<void> {
    this.memory.clear();
    try {
      await translationCacheDb.entries.clear();
    } catch (error) {
      console.warn('[FluentRead] translation cache clear failed:', error);
      throw error;
    }
  }
}

export const translationCache = new TranslationCache();
