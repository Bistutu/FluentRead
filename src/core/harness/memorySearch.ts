/**
 * @file src/core/harness/memorySearch.ts
 * 文件职责：移植 dsh-agent-memory 的纯词法记忆检索子集，为用户主动保存的学习要点提供本机相关性排序。
 * 主要内容：保留 ASCII/CJK 二元分词、Jaccard、BM25 信号、命中解释、过期过滤及稳定排序；MemoryRecord 字段沿用上游 spec，不加载其存储与插件。
 * 模块边界：本模块不访问网络、模型、浏览器或数据库，不自动提取或写入记忆；调用者验证记录并决定查询、条数和内容预算。
 * 来源：https://github.com/Culeot/dsh-agent-memory/tree/af709743fb267b536d11343bab43e9a54f96367c
 * 上游：v0.8.4 src/search.ts 与 src/spec.ts；Copyright (c) 2026 dsh-agent-memory contributors，MIT。
 * 源文件 SHA-256：search.ts 6cd4dd693cd3fe1c07eb1a3e2bae217ada5af328669a786f933d346348c7328e；spec.ts fa87808943e5438b5d90194cd259893661365e82d0171f39a2058c51fb936287。
 * 适配：仅保留查询检索路径，移除旧单字 tokenizer、scoreRecord/bm25Signal/explainRecord 包装、hotness/hotRecords；删除不使用的 lastActive 参数及已由命中阈值保证的冗余分支。
 * 完整许可：public/third-party-notices/dsh-agent-memory-MIT.txt。
 */
export interface MemoryRecord {
  id: string;
  content: string;
  kind: 'fact' | 'preference' | 'decision' | 'lesson' | 'todo' | 'note';
  tags: string[];
  scope: 'user' | 'project';
  project: string | null;
  importance: number;
  createdAt: string;
  updatedAt: string;
  accessedAt: string | null;
  accessCount: number;
  expiresAt: string | null;
}

/**
 * Bigram tokenizer: ASCII word runs + CJK bigrams (sliding windows of two
 * consecutive CJK chars; a CJK run shorter than 2 chars contributes single
 * chars). Bigrams carry far more information than single chars, which makes
 * Chinese recall noticeably more precise — "苹果" no longer partially matches
 * "水果摊" through the shared char "果".
 */
export function tokenizeBigram(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  const ascii = /[a-z0-9_]+/g;
  let match: RegExpExecArray | null;
  while ((match = ascii.exec(lower)) !== null) tokens.push(match[0]);
  const cjkRuns = lower.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      tokens.push(run);
    } else {
      for (let i = 0; i < run.length - 1; i += 1) tokens.push(run.slice(i, i + 2));
    }
  }
  return tokens;
}

export function tokenSetBigram(text: string): Set<string> {
  return new Set(tokenizeBigram(text));
}

/** Loose matching signal: pure CJK unigrams (never used alone). */
export function cjkUnigrams(text: string): Set<string> {
  const set = new Set<string>();
  const runs = text.toLowerCase().match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of runs) for (const ch of run) set.add(ch);
  return set;
}

/** Jaccard similarity of two token sets, 0..1. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export interface RankOptions {
  /** Current time as epoch ms; injectable for tests. */
  now?: number;
  /** Recency half-life in days. */
  recencyHalfLifeDays?: number;
}

export interface ScoredRecord {
  record: MemoryRecord;
  score: number;
  /** Human-readable hit reasons (query ranking only; absent for hot set). */
  reasons?: string[];
}

const ACCESS_BOOST_CAP = 1.5;

/** Most-recent activity time: updates and recall hits both refresh freshness. */
function lastActive(record: MemoryRecord): number {
  const updated = Date.parse(record.updatedAt);
  if (record.accessedAt !== null) {
    const accessed = Date.parse(record.accessedAt);
    return accessed > updated ? accessed : updated;
  }
  return updated;
}

/**
 * Minimum matching strength (base score) for a record to be considered a hit.
 * Base contributions: substring hit = 3, tag hit = 1.5, bigram Jaccard ≤ 2,
 * unigram Jaccard ≤ 0.8 (pure single-char coincidence can never reach 1.0).
 * A threshold of 1.0 therefore keeps every strong match (substring/tag/decent
 * bigram) while discarding pure single-char noise — the source of "unrelated
 * association" on short queries like "ok了吗".
 */
export const MATCH_BASE_MIN = 1.0;

/** Common filler words that carry no retrieval information. */
const STOPWORDS = new Set([
  '的', '了', '吗', '呢', '啊', '哦', '嗯', '哟', '吧', '呀', '哈', '嘿', '喂',
  '是', '在', '和', '与', '或', '及', '把', '被', '给', '向', '从', '到', '于', '对', '就', '都', '也', '还', '但', '而', '则', '且',
  '我', '你', '他', '她', '它', '咱', '您', '们',
  '这', '那', '哪', '什', '么', '怎', '为', '何', '啥',
  '可', '以', '能', '好', '不', '别', '请', '先', '再', '又', '很', '太', '真', '挺', '会', '想', '要', '帮', '看', '说', '做', '弄', '搞', '整',
  'ok', 'ok了', '好的', '嗯嗯', '哈哈', '谢谢', '感谢', '谢了', '可以了', '明白了', '懂了', '知道', '看看', '请问',
]);

/**
 * Whether a query carries enough retrieval information to bother searching.
 * Short/filler queries ("ok了吗", "可以吗") would otherwise surface weak
 * matches — pure token waste. Requires ≥2 meaningful CJK chars or ≥1 ASCII
 * word of length ≥3.
 */
export function hasMeaningfulQuery(query: string): boolean {
  let meaningfulCjk = 0;
  for (const ch of query) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x4e00 && code <= 0x9fff && !STOPWORDS.has(ch)) meaningfulCjk += 1;
  }
  const asciiWords = query.toLowerCase().match(/[a-z]{3,}/g);
  return meaningfulCjk >= 2 || (asciiWords !== null && asciiWords.length >= 1);
}

/**
 * BM25-style term-frequency signal (single-document collection, no idf).
 * Query bigram tokens are matched against content bigram frequencies with
 * length normalization: short content is rewarded for hits, long content is
 * not penalized for wordiness. Scaled and capped so it can only add up to
 * +2.0 to the base score.
 */
function bm25Tokens(qTokens: ReadonlySet<string>, cTokens: readonly string[]): number {
  const contentLen = Math.max(1, cTokens.length);
  const freq = new Map<string, number>();
  for (const t of cTokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  const k1 = 1.2;
  const b = 0.75;
  let sum = 0;
  for (const t of qTokens) {
    const tf = freq.get(t) ?? 0;
    if (tf === 0) continue;
    const norm = contentLen / 40;
    sum += (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * norm));
  }
  return Math.min(2.0, sum * 0.4);
}

export interface ExplainResult {
  score: number;
  /** Human-readable reasons, best-contributing first. */
  reasons: string[];
}

function prepareQuery(query: string) {
  const text = query.trim();
  return {
    text, lower: text.toLowerCase(),
    words: new Set(text.match(/[\u4e00-\u9fff]{2,}|[a-z][a-z0-9_]{2,}/gi) ?? []),
    bigrams: tokenSetBigram(text), unigrams: cjkUnigrams(text),
  };
}

/** 同一轮排名只解析查询一次；每条正文的分词同时供 Jaccard 与 BM25 使用。 */
function explainPreparedRecord(record: MemoryRecord, query: ReturnType<typeof prepareQuery>, options: RankOptions & {now: number}): ExplainResult {
  const q = query.text;
  if (q === '') return { score: 0, reasons: [] };

  const contentLower = record.content.toLowerCase();
  const queryLower = query.lower;
  const reasons: string[] = [];
  const baseParts: string[] = [];
  let base = 0;

  if (contentLower.includes(queryLower)) {
    base += 3;
    baseParts.push('substring(3.0)');
    reasons.push('substring:整串命中(+3.0)');
  }
  const matchedTags = record.tags.filter((tag) => tag.toLowerCase().includes(queryLower));
  if (matchedTags.length > 0) {
    base += 1.5;
    baseParts.push('tag(1.5)');
    reasons.push(`tag:${matchedTags.join('/')} 命中(+1.5)`);
  }

  const qWords = query.words;
  let qwordHits = 0;
  for (const w of qWords) {
    if (contentLower.includes(w.toLowerCase())) {
      base += 1.2;
      qwordHits += 1;
      reasons.push(`qword:${w}(+1.2)`);
    }
  }
  if (qwordHits > 0) baseParts.push(`qword(${qwordHits}×1.2)`);

  const qBigrams = query.bigrams;
  const contentTokens = tokenizeBigram(record.content);
  const cBigrams = new Set(contentTokens);
  const bigramJ = jaccard(qBigrams, cBigrams);
  if (bigramJ > 0) {
    base += bigramJ * 2;
    baseParts.push(`bigram(${(bigramJ * 2).toFixed(2)})`);
    reasons.push(`bigram:${bigramJ.toFixed(2)}(+${(bigramJ * 2).toFixed(2)})`);
  }

  const qUnis = query.unigrams;
  const cUnis = cjkUnigrams(record.content);
  const uniJ = jaccard(qUnis, cUnis);
  if (uniJ > 0) {
    base += uniJ * 0.8;
    baseParts.push(`unigram(${(uniJ * 0.8).toFixed(2)})`);
    reasons.push(`unigram:${uniJ.toFixed(2)}(+${(uniJ * 0.8).toFixed(2)})`);
  }

  const bm = bm25Tokens(qBigrams, contentTokens);
  if (bm > 0) {
    base += bm;
    baseParts.push(`bm25(${bm.toFixed(2)})`);
    reasons.push(`bm25:${bm.toFixed(2)}(+${bm.toFixed(2)})`);
  }

  if (base < MATCH_BASE_MIN) return { score: 0, reasons };

  const importanceBoost = 1 + (record.importance - 1) * 0.75; // 1.0 / 1.75 / 2.5
  const halfLifeDays = options.recencyHalfLifeDays ?? 90;
  const now = options.now;
  const ageMs = now - lastActive(record);
  const recencyBoost = Math.pow(0.5, ageMs / (halfLifeDays * 24 * 3600 * 1000));
  const accessBoost = Math.min(ACCESS_BOOST_CAP, 1 + Math.log(1 + record.accessCount) * 0.15);

  const score = base * importanceBoost * recencyBoost * accessBoost;
  if (importanceBoost > 1) reasons.push(`importance:${record.importance}(×${importanceBoost.toFixed(2)})`);
  const ageDays = ageMs / (24 * 3600 * 1000);
  reasons.push(`recency:${ageDays.toFixed(1)} 天前活跃(×${recencyBoost.toFixed(2)})`);
  if (record.accessCount > 0) reasons.push(`access:${record.accessCount} 次(×${accessBoost.toFixed(2)})`);
  reasons.unshift(`base:${baseParts.join('+')}`);
  return { score, reasons: reasons.slice(0, 8) };
}

/** Retired records: expired by TTL. */
export function isExpired(record: MemoryRecord, now: number = Date.now()): boolean {
  return record.expiresAt !== null && Date.parse(record.expiresAt) <= now;
}

/**
 * Rank non-expired records against a query and return the top `limit`.
 * Records with score 0 are dropped; ties keep insertion order (stable).
 */
export function rankRecords(records: readonly MemoryRecord[], query: string, limit: number, options: RankOptions = {}): ScoredRecord[] {
  const now = options.now ?? Date.now();
  const scored: ScoredRecord[] = [];
  const prepared = prepareQuery(query);
  for (const record of records) {
    if (isExpired(record, now)) continue;
    const explained = explainPreparedRecord(record, prepared, { ...options, now });
    if (explained.score > 0) scored.push({ record, score: explained.score, reasons: explained.reasons });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, limit));
}
