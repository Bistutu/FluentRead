/**
 * 单词学习卡片的数据适配层。
 *
 * 这里不把大型词典打进扩展包，而是调用公开的结构化词典服务，并把
 * 不同服务的响应归一化为同一份小数据结构。服务不可用时按顺序尝试
 * Free Dictionary API、WiktApi、Wiktionary REST 和 Datamuse；这样单个
 * 免费服务的限流或维护不会直接让划词卡片失效。
 */

export type WordDictionaryProviderId = 'free-dictionary' | 'wiktapi' | 'wiktionary-rest' | 'datamuse';

export interface WordPronunciation {
    text?: string;
    audio?: string;
    label?: string;
}

export interface WordDefinition {
    definition: string;
    example?: string;
    translatedDefinition?: string;
    translatedExample?: string;
}

export interface WordMeaning {
    partOfSpeech: string;
    definitions: WordDefinition[];
}

export interface WordDictionarySource {
    id: WordDictionaryProviderId;
    label: string;
    url: string;
}

export interface WordCardData {
    word: string;
    normalizedWord: string;
    phonetics: WordPronunciation[];
    meanings: WordMeaning[];
    origin?: string;
    sources: WordDictionarySource[];
}

interface FreeDictionaryEntry {
    word?: unknown;
    phonetic?: unknown;
    phonetics?: unknown;
    origin?: unknown;
    meanings?: unknown;
    sourceUrls?: unknown;
}

interface WiktApiEntry {
    word?: unknown;
    lang_code?: unknown;
    pos?: unknown;
    senses?: unknown;
    sounds?: unknown;
}

interface WiktApiResponse {
    word?: unknown;
    entries?: unknown;
}

interface DatamuseWord {
    word?: unknown;
    tags?: unknown;
    defs?: unknown;
}

interface WiktionaryDefinitionEntry {
    partOfSpeech?: unknown;
    language?: unknown;
    definitions?: unknown;
}

const MAX_WORD_LENGTH = 64;
const LOOKUP_TIMEOUT_MS = 4_000;
const MAX_DEFINITIONS_PER_MEANING = 6;
const MAX_MEANINGS = 6;

const SOURCE_INFO: Record<WordDictionaryProviderId, WordDictionarySource> = {
    'free-dictionary': {
        id: 'free-dictionary',
        label: 'Free Dictionary API',
        url: 'https://dictionaryapi.dev/',
    },
    wiktapi: {
        id: 'wiktapi',
        label: 'WiktApi / Wiktionary',
        url: 'https://wiktapi.dev/',
    },
    'wiktionary-rest': {
        id: 'wiktionary-rest',
        label: 'Wiktionary',
        url: 'https://en.wiktionary.org/',
    },
    datamuse: {
        id: 'datamuse',
        label: 'Datamuse',
        url: 'https://www.datamuse.com/api/',
    },
};

/** Return a safe lowercase English headword, or null for a phrase/non-word selection. */
export function normalizeEnglishWord(value: string): string | null {
    const normalized = String(value || '').trim().normalize('NFC').replaceAll('’', "'");
    if (normalized.length === 0 || normalized.length > MAX_WORD_LENGTH) return null;
    if (!/^[A-Za-z]+(?:[-'][A-Za-z]+)*$/u.test(normalized)) return null;
    return normalized.toLowerCase();
}

export function isSingleEnglishWord(value: string): boolean {
    return normalizeEnglishWord(value) !== null;
}

function textValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function safeHttpUrl(value: unknown): string | undefined {
    const candidate = textValue(value);
    if (!candidate) return undefined;
    try {
        const url = new URL(candidate.startsWith('//') ? `https:${candidate}` : candidate);
        return url.protocol === 'https:' ? url.toString() : undefined;
    } catch {
        return undefined;
    }
}

function stripHtml(value: unknown): string {
    const raw = textValue(value);
    if (!raw) return '';
    return raw
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizePartOfSpeech(value: unknown): string {
    const valueText = textValue(value);
    if (!valueText) return '其他';
    const normalized = valueText.toLowerCase();
    const labels: Record<string, string> = {
        adj: '形容词',
        adjective: '形容词',
        adv: '副词',
        adverb: '副词',
        article: '冠词',
        conjunction: '连词',
        determiner: '限定词',
        interjection: '感叹词',
        intj: '感叹词',
        noun: '名词',
        n: '名词',
        preposition: '介词',
        prep: '介词',
        pronoun: '代词',
        pron: '代词',
        verb: '动词',
        v: '动词',
    };
    return labels[normalized] || valueText;
}

function uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    return values.filter(value => {
        const key = value.toLocaleLowerCase();
        if (!value || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function createPartialCard(normalizedWord: string, source: WordDictionarySource): WordCardData {
    return {
        word: normalizedWord,
        normalizedWord,
        phonetics: [],
        meanings: [],
        sources: [source],
    };
}

function addSource(card: WordCardData, source: WordDictionarySource): void {
    if (!card.sources.some(item => item.id === source.id)) card.sources.push(source);
}

function addMeaning(card: WordCardData, partOfSpeech: unknown, definitions: WordDefinition[]): void {
    const cleanDefinitions = definitions
        .map(definition => {
            const definitionText = stripHtml(definition.definition);
            const example = stripHtml(definition.example);
            return {
                definition: definitionText,
                ...(example ? { example } : {}),
            };
        })
        .filter(definition => definition.definition)
        .slice(0, MAX_DEFINITIONS_PER_MEANING);
    if (cleanDefinitions.length === 0) return;

    const label = normalizePartOfSpeech(partOfSpeech);
    const existing = card.meanings.find(meaning => meaning.partOfSpeech === label);
    if (existing) {
        const seen = new Set(existing.definitions.map(definition => definition.definition.toLocaleLowerCase()));
        for (const definition of cleanDefinitions) {
            if (!seen.has(definition.definition.toLocaleLowerCase()) && existing.definitions.length < MAX_DEFINITIONS_PER_MEANING) {
                existing.definitions.push(definition);
                seen.add(definition.definition.toLocaleLowerCase());
            }
        }
        return;
    }

    if (card.meanings.length < MAX_MEANINGS) card.meanings.push({ partOfSpeech: label, definitions: cleanDefinitions });
}

function addPronunciation(card: WordCardData, pronunciation: WordPronunciation): void {
    const text = textValue(pronunciation.text);
    const audio = safeHttpUrl(pronunciation.audio);
    if (!text && !audio) return;
    const existing = card.phonetics.find(item => text
        ? textValue(item.text).toLocaleLowerCase() === text.toLocaleLowerCase()
        : safeHttpUrl(item.audio) === audio);
    if (existing) {
        if (!existing.audio && audio) existing.audio = audio;
        if (!existing.label && pronunciation.label) existing.label = pronunciation.label;
        return;
    }
    card.phonetics.push({
        ...(text ? { text } : {}),
        ...(audio ? { audio } : {}),
        ...(pronunciation.label ? { label: pronunciation.label } : {}),
    });
}

function addPronunciations(card: WordCardData, pronunciations: WordPronunciation[]): void {
    for (const pronunciation of pronunciations.slice(0, 8)) addPronunciation(card, pronunciation);
}

function pronunciationRegion(pronunciation: WordPronunciation): '美式' | '英式' | null {
    if (pronunciation.label === '美式' || pronunciation.label === '英式') return pronunciation.label;
    return null;
}

function pronunciationScore(pronunciation: WordPronunciation): number {
    const metadata = `${pronunciation.audio || ''} ${pronunciation.text || ''}`.toLowerCase();
    let score = pronunciation.audio ? 2 : 0;
    if (/stressed|primary|strong/.test(metadata)) score += 4;
    if (/unstressed|weak/.test(metadata)) score -= 2;
    if (pronunciation.text?.includes('ˈ')) score += 1;
    return score;
}

/** Keep the primary pronunciation for each regional variety instead of showing every source variant. */
export function selectPronunciations(pronunciations: WordPronunciation[]): WordPronunciation[] {
    const regional = new Map<'美式' | '英式', WordPronunciation>();
    const unlabelled: WordPronunciation[] = [];

    for (const pronunciation of pronunciations) {
        const region = pronunciationRegion(pronunciation);
        if (!region) {
            unlabelled.push(pronunciation);
            continue;
        }
        const current = regional.get(region);
        if (!current || pronunciationScore(pronunciation) > pronunciationScore(current)) regional.set(region, pronunciation);
    }

    if (regional.size > 0) {
        return (['美式', '英式'] as const).flatMap(region => {
            const pronunciation = regional.get(region);
            return pronunciation ? [pronunciation] : [];
        });
    }

    return unlabelled.slice(0, 2);
}

function hasUsefulData(card: WordCardData | null): card is WordCardData {
    return Boolean(card && (card.meanings.length > 0 || card.phonetics.length > 0));
}

export function mergeWordCardData(base: WordCardData | null, addition: WordCardData): WordCardData {
    const card = base || createPartialCard(addition.normalizedWord, addition.sources[0] || SOURCE_INFO['free-dictionary']);
    card.word = card.word || addition.word;
    card.normalizedWord = addition.normalizedWord || card.normalizedWord;
    if (!card.origin && addition.origin) card.origin = addition.origin;
    addPronunciations(card, addition.phonetics);
    for (const meaning of addition.meanings) addMeaning(card, meaning.partOfSpeech, meaning.definitions);
    for (const source of addition.sources) addSource(card, source);
    return card;
}

function sourceWithWord(source: WordDictionarySource, normalizedWord: string): WordDictionarySource {
    const sourceUrl = source.id === 'wiktionary-rest'
        ? `https://en.wiktionary.org/wiki/${encodeURIComponent(normalizedWord)}`
        : source.url;
    return { ...source, url: sourceUrl };
}

export function parseFreeDictionaryEntry(entry: FreeDictionaryEntry, normalizedWord: string): WordCardData {
    const source = sourceWithWord(SOURCE_INFO['free-dictionary'], normalizedWord);
    const card = createPartialCard(normalizedWord, source);
    const entryWord = textValue(entry.word);
    if (entryWord) card.word = entryWord;

    const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
    addPronunciations(card, phonetics.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const value = item as Record<string, unknown>;
        const audio = safeHttpUrl(value.audio);
        const text = textValue(value.text);
        if (!text && !audio) return [];
        const label = audio?.toLowerCase().includes('-uk') ? '英式' : audio?.toLowerCase().includes('-us') ? '美式' : undefined;
        return [{ text, audio, label }];
    }));
    const phonetic = textValue(entry.phonetic);
    if (phonetic) addPronunciation(card, { text: phonetic });

    const meanings = Array.isArray(entry.meanings) ? entry.meanings : [];
    for (const meaning of meanings) {
        if (!meaning || typeof meaning !== 'object') continue;
        const value = meaning as Record<string, unknown>;
        const definitions = Array.isArray(value.definitions) ? value.definitions : [];
        addMeaning(card, value.partOfSpeech, definitions.flatMap(definition => {
            if (!definition || typeof definition !== 'object') return [];
            const item = definition as Record<string, unknown>;
            return [{ definition: textValue(item.definition), example: textValue(item.example) }];
        }));
    }
    const origin = stripHtml(entry.origin);
    if (origin) card.origin = origin;
    return card;
}

export function parseWiktApiEntry(entry: WiktApiEntry, normalizedWord: string): WordCardData {
    const source = sourceWithWord(SOURCE_INFO.wiktapi, normalizedWord);
    const card = createPartialCard(normalizedWord, source);
    const entryWord = textValue(entry.word);
    if (entryWord) card.word = entryWord;

    const senses = Array.isArray(entry.senses) ? entry.senses : [];
    for (const sense of senses) {
        if (!sense || typeof sense !== 'object') continue;
        const value = sense as Record<string, unknown>;
        const glosses = Array.isArray(value.glosses) ? value.glosses.map(textValue) : [];
        const examples = Array.isArray(value.examples) ? value.examples : [];
        const example = examples.find(item => item && typeof item === 'object' && textValue((item as Record<string, unknown>).text));
        addMeaning(card, entry.pos, glosses.map(definition => ({
            definition,
            example: example && typeof example === 'object' ? textValue((example as Record<string, unknown>).text) : undefined,
        })));
    }

    const sounds = Array.isArray(entry.sounds) ? entry.sounds : [];
    addPronunciations(card, sounds.flatMap(sound => {
        if (!sound || typeof sound !== 'object') return [];
        const value = sound as Record<string, unknown>;
        const text = textValue(value.ipa) || textValue(value.enpr);
        const audio = safeHttpUrl(value.mp3_url) || safeHttpUrl(value.ogg_url) || safeHttpUrl(value.audio);
        const tags = Array.isArray(value.tags) ? value.tags.map(textValue).join(' ') : '';
        const label = /received-pronunciation|british|uk/i.test(tags) ? '英式' : /general-american|american|us/i.test(tags) ? '美式' : undefined;
        return [{ text, audio, label }];
    }));
    return card;
}

export function parseDatamuseWord(entry: DatamuseWord, normalizedWord: string): WordCardData {
    const source = sourceWithWord(SOURCE_INFO.datamuse, normalizedWord);
    const card = createPartialCard(normalizedWord, source);
    if (textValue(entry.word).toLowerCase() !== normalizedWord) return card;

    const tags = Array.isArray(entry.tags) ? entry.tags.map(textValue) : [];
    const pronunciation = tags.find(tag => tag.toLowerCase().startsWith('pron:'))?.slice(5).trim();
    if (pronunciation) addPronunciation(card, { text: pronunciation });
    const definitions = Array.isArray(entry.defs) ? entry.defs : [];
    const definitionsByPartOfSpeech = new Map<string, WordDefinition[]>();
    for (const item of definitions) {
        const value = textValue(item);
        if (!value) continue;
        const separator = value.indexOf('\t');
        const partOfSpeech = separator >= 0 ? value.slice(0, separator) : '其他';
        const definition = separator >= 0 ? value.slice(separator + 1) : value;
        const list = definitionsByPartOfSpeech.get(partOfSpeech) || [];
        list.push({ definition });
        definitionsByPartOfSpeech.set(partOfSpeech, list);
    }
    for (const [partOfSpeech, definitionsForPart] of definitionsByPartOfSpeech) addMeaning(card, partOfSpeech, definitionsForPart);
    return card;
}

function parseWiktionaryRestEntry(entry: WiktionaryDefinitionEntry, normalizedWord: string): WordCardData {
    const source = sourceWithWord(SOURCE_INFO['wiktionary-rest'], normalizedWord);
    const card = createPartialCard(normalizedWord, source);
    const definitions = Array.isArray(entry.definitions) ? entry.definitions : [];
    for (const definition of definitions) {
        if (!definition || typeof definition !== 'object') continue;
        const value = definition as Record<string, unknown>;
        const text = stripHtml(value.definition);
        const examples = Array.isArray(value.examples) ? value.examples : [];
        const example = examples.find(item => item && typeof item === 'object' && stripHtml((item as Record<string, unknown>).example));
        addMeaning(card, entry.partOfSpeech, [{
            definition: text,
            example: example && typeof example === 'object' ? stripHtml((example as Record<string, unknown>).example) : undefined,
        }]);
    }
    return card;
}

async function fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            credentials: 'omit',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`dictionary request failed: ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

async function lookupFreeDictionary(normalizedWord: string): Promise<WordCardData | null> {
    const payload = await fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalizedWord)}`);
    if (!Array.isArray(payload)) return null;
    return payload.reduce<WordCardData | null>((card, entry) => {
        if (!entry || typeof entry !== 'object') return card;
        return mergeWordCardData(card, parseFreeDictionaryEntry(entry as FreeDictionaryEntry, normalizedWord));
    }, null);
}

async function lookupWiktApi(normalizedWord: string): Promise<WordCardData | null> {
    const payload = await fetchJson(`https://api.wiktapi.dev/v1/en/word/${encodeURIComponent(normalizedWord)}`);
    if (!payload || typeof payload !== 'object') return null;
    const rawEntries = (payload as WiktApiResponse).entries;
    const entries: unknown[] = Array.isArray(rawEntries) ? rawEntries : [];
    return entries.reduce<WordCardData | null>((card, entry) => {
        if (!entry || typeof entry !== 'object') return card;
        const item = entry as WiktApiEntry;
        if (textValue(item.lang_code) && textValue(item.lang_code) !== 'en') return card;
        return mergeWordCardData(card, parseWiktApiEntry(item, normalizedWord));
    }, null);
}

async function lookupWiktionaryRest(normalizedWord: string): Promise<WordCardData | null> {
    const payload = await fetchJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(normalizedWord)}`);
    if (!payload || typeof payload !== 'object') return null;
    const rawEnglishEntries = (payload as Record<string, unknown>).en;
    const englishEntries: unknown[] = Array.isArray(rawEnglishEntries) ? rawEnglishEntries : [];
    return englishEntries.reduce<WordCardData | null>((card, entry) => {
        if (!entry || typeof entry !== 'object') return card;
        return mergeWordCardData(card, parseWiktionaryRestEntry(entry as WiktionaryDefinitionEntry, normalizedWord));
    }, null);
}

async function lookupDatamuse(normalizedWord: string): Promise<WordCardData | null> {
    const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(normalizedWord)}&md=dpr&ipa=1&max=8`;
    const payload = await fetchJson(url);
    if (!Array.isArray(payload)) return null;
    return payload.reduce<WordCardData | null>((card, entry) => {
        if (!entry || typeof entry !== 'object') return card;
        const item = parseDatamuseWord(entry as DatamuseWord, normalizedWord);
        return item.meanings.length > 0 || item.phonetics.length > 0 ? mergeWordCardData(card, item) : card;
    }, null);
}

const PROVIDERS: Array<{ id: WordDictionaryProviderId; lookup: (word: string) => Promise<WordCardData | null> }> = [
    { id: 'free-dictionary', lookup: lookupFreeDictionary },
    { id: 'wiktapi', lookup: lookupWiktApi },
    { id: 'wiktionary-rest', lookup: lookupWiktionaryRest },
    { id: 'datamuse', lookup: lookupDatamuse },
];

const wordLookupCache = new Map<string, WordCardData | null>();
const WORD_LOOKUP_CACHE_SIZE = 80;

function cacheWordResult(word: string, result: WordCardData | null): WordCardData | null {
    if (!result) return null;
    if (wordLookupCache.size >= WORD_LOOKUP_CACHE_SIZE) {
        const oldest = wordLookupCache.keys().next().value;
        if (oldest) wordLookupCache.delete(oldest);
    }
    wordLookupCache.set(word, result);
    return result;
}

function finalizeWordCard(card: WordCardData | null): WordCardData | null {
    if (!card) return null;
    card.phonetics = selectPronunciations(card.phonetics);
    return card;
}

/** Look up one English word with multiple free/open-data fallbacks. */
export async function lookupWord(value: string): Promise<WordCardData | null> {
    const normalizedWord = normalizeEnglishWord(value);
    if (!normalizedWord) return null;
    if (wordLookupCache.has(normalizedWord)) return wordLookupCache.get(normalizedWord) || null;

    let merged: WordCardData | null = null;
    for (const provider of PROVIDERS) {
        try {
            const result = await provider.lookup(normalizedWord);
            if (hasUsefulData(result)) merged = mergeWordCardData(merged, result);
            // Definitions plus IPA are enough for the card. Audio still falls
            // back to the existing Edge/browser speech chain in the component.
            if (merged && merged.meanings.length > 0 && merged.phonetics.length > 0) break;
        } catch (error) {
            // Provider failures are intentionally isolated. The next service is
            // the backup; the page UI should not expose provider internals.
            console.warn(`[FluentRead] word provider ${provider.id} unavailable`, error);
        }
    }

    return cacheWordResult(normalizedWord, finalizeWordCard(merged));
}
