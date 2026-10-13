/**
 * @file src/services/translation/context/discourse.ts
 *
 * 文件职责：在单篇材料内保存有界的原文证据和已译段落，为后续翻译提供可核对的篇章参考。
 * 主要内容：按材料、语言及正文版本隔离状态，检索当前章节、相邻段落和相关早先定义，保留用户确认译法并拒绝取消或过期回写；为会话请求复用提取保留译法证据、排除定位元数据的语义身份。
 * 模块边界：纯内存翻译服务，不访问 DOM、存储或模型，不推断实体关系；采集身份和生命周期由网页及文档适配器负责，术语库仍由既有翻译链路优先应用。
 */

export const discourseContextLimits = Object.freeze({
    blocks: 256,
    sourceCharacters: 64_000,
    blockCharacters: 1_000,
    pairs: 64,
    referenceCharacters: 2_400,
});

export interface DiscourseBlock {
    id: string;
    section: string;
    source: string;
    position: string;
}

interface StoredBlock extends DiscourseBlock {
    key: string;
    sectionKey: string;
    sourceRevision: string;
    index: number;
}

interface TranslationPair {
    block: StoredBlock;
    source: string;
    translation: string;
    confirmed: boolean;
}

interface Evidence {
    kind: 'definition' | 'nearby' | 'section_opening' | 'previous_machine' | 'user_confirmed';
    blockId: string;
    section: string;
    position: string;
    source: string;
    translation?: string;
}

const metadataCharacters = 160;
const referencePolicy = {
    precedence: 'user_glossary > user_confirmed > previous_machine',
    ambiguity: 'Evidence only. Preserve ambiguity and different meanings; do not merge names or invent referents. Previous machine translations may be wrong.',
};
const definitionMarker = /\([^)]{1,120}\)|（[^）]{1,120}）|\b(?:is|means|refers to|stands for|denotes|defined as|called|known as)\b|称为|指的是|表示|代表/iu;
const strongDefinitionMarker = /\([^)]{1,120}\)|（[^）]{1,120}）|\b(?:means|refers to|stands for|denotes|defined as|called|known as)\b|称为|指的是|表示|代表/iu;
const pronouns = /\b(?:he|she|him|her|his|their|they|them|I|my|our|we)\b/iu;
const stopWords = new Set('this that these those with from into about after before have has had been being their they them then when where what which would could should there here also only some more such very does not are was were the and for but while behind under over each both keep keeps can will must may original present previous source result record page content translation changed current earlier later paragraph definition software chapter same kept until generation'.split(' '));
const words = (text: string): string[] => text.match(/[A-Za-z][A-Za-z0-9_-]{1,39}/gu) ?? [];
const hasResolvedSection = (section: string): boolean => !/^(?:unresolved-section|outside-budget):/u.test(section);
const escapeReference = (value: string): string => value.replace(/</gu, '\\u003c').replace(/>/gu, '\\u003e');
const encode = (value: unknown): string => escapeReference(JSON.stringify(value));

/** 批处理只按章节合组；非法或未知结构仍用原参考串隔离，避免误合并。 */
export function discourseScope(context: string | undefined): string {
    if (!context) return '';
    try {
        const parsed = JSON.parse(context);
        return parsed && typeof parsed.section === 'string' ? parsed.section : context;
    } catch {
        return context;
    }
}

/** 请求复用忽略段落重挂的定位差异，但保留章节、定义和确认译法；未知协议按原串隔离。 */
export function discourseRequestIdentity(context: string | undefined, origins: readonly string[]): string | undefined {
    if (!context || context.length > discourseContextLimits.referenceCharacters) return context;
    try {
        const parsed = JSON.parse(context);
        if (!parsed || parsed.version !== 1 || typeof parsed.section !== 'string' || !Array.isArray(parsed.evidence)
            || ['precedence', 'ambiguity'].some(field => parsed[field] !== undefined && typeof parsed[field] !== 'string')) return context;
        const sources = new Set(origins);
        const seen = new Set<string>();
        const evidence: Array<Pick<Evidence, 'kind' | 'section' | 'source' | 'translation'>> = [];
        for (const item of parsed.evidence) {
            if (!item || !['definition', 'nearby', 'section_opening', 'previous_machine', 'user_confirmed'].includes(item.kind)
                || !['blockId', 'section', 'position', 'source'].every(field => typeof item[field] === 'string')
                || (item.translation !== undefined && typeof item.translation !== 'string')) return context;
            // 同源机器译文已经由本次原文的缓存结果代表；用户确认仍可修正旧结果。
            if ((item.kind === 'nearby' || item.kind === 'previous_machine') && sources.has(item.source)) continue;
            const entry = {kind: item.kind, section: item.section, source: item.source, translation: item.translation};
            const key = encode(entry);
            if (!seen.has(key)) { evidence.push(entry); seen.add(key); }
        }
        return encode({version: 1, section: parsed.section, precedence: parsed.precedence, ambiguity: parsed.ambiguity, evidence});
    } catch {
        return context;
    }
}

/** 同章批量请求复用完整证据项，仍遵守同一参考预算，不拼接或执行源文中的标签。 */
export function mergeDiscourseContexts(contexts: readonly string[]): string {
    const first = contexts[0] ?? '';
    const escaped = first.length <= discourseContextLimits.referenceCharacters ? escapeReference(first) : '';
    const fallback = escaped.length <= discourseContextLimits.referenceCharacters ? escaped : '';
    if (!first) return '';
    try {
        const parsed = contexts.slice(0, discourseContextLimits.pairs).map(context => {
            if (context.length > discourseContextLimits.referenceCharacters) throw new Error('reference budget');
            return JSON.parse(context);
        });
        if (parsed.some(value => !value || value.version !== 1 || typeof value.section !== 'string' || typeof value.position !== 'string' || !Array.isArray(value.evidence) || value.section !== parsed[0].section)) return fallback;
        const reference = {
            version: 1,
            section: parsed[0].section.slice(0, metadataCharacters),
            positions: [...new Set<string>(parsed.map(value => value.position.slice(0, metadataCharacters)))].slice(0, 8),
            ...referencePolicy,
            evidence: [] as Evidence[],
        };
        if (encode(reference).length > discourseContextLimits.referenceCharacters) return fallback;
        const seen = new Set<string>();
        for (const value of parsed) {
            for (const evidence of value.evidence) {
                if (!evidence || !['kind', 'blockId', 'section', 'position', 'source'].every(field => typeof evidence[field] === 'string') || (evidence.translation !== undefined && typeof evidence.translation !== 'string')) return fallback;
                const key = encode(evidence);
                if (seen.has(key) || encode({...reference, evidence: [...reference.evidence, evidence]}).length > discourseContextLimits.referenceCharacters) continue;
                reference.evidence.push(evidence);
                seen.add(key);
            }
        }
        return encode(reference);
    } catch {
        return fallback;
    }
}

/** 双独立滚动校验覆盖未保存的尾部，避免超出预算的正文变化被误当成同一版本。 */
function fingerprint(values: Iterable<string>): string {
    let first = 2_166_136_261;
    let second = 5_381;
    for (const value of values) {
        const framed = `${value.length}:`;
        for (const text of [framed, value]) {
            for (let index = 0; index < text.length; index += 1) {
                const code = text.charCodeAt(index);
                first = Math.imul(first ^ code, 16_777_619);
                second = Math.imul(second, 33) ^ code;
            }
        }
    }
    return `${first >>> 0}:${second >>> 0}`;
}

function* snapshotValues(materialId: string, languageKey: string, blocks: readonly DiscourseBlock[]) {
    yield materialId;
    yield languageKey;
    yield String(blocks.length);
    for (const block of blocks) {
        yield block.id;
        yield block.section;
        yield block.source;
        yield block.position;
    }
}

function tokensFor(origins: readonly string[]): Map<string, boolean> {
    const tokens = new Map<string, boolean>();
    for (const origin of origins) {
        for (const word of words(origin)) {
            const key = word.toLowerCase();
            if (stopWords.has(key) || (word.length < 4 && !/^[A-Z][A-Z0-9]{1,11}$/u.test(word))) continue;
            // 普通人名不能跨章借用；只跨章检索缩写和原文中以小写出现的概念。
            const acrossSections = /^[A-Z][A-Z0-9]{1,11}$/u.test(word) || /^[a-z]/u.test(word);
            tokens.set(key, acrossSections || tokens.get(key) === true);
        }
    }
    return tokens;
}

function matchingTokens(source: string, tokens: ReadonlyMap<string, boolean>): string[] {
    return words(source).map(word => word.toLowerCase()).filter(word => tokens.has(word));
}

function definitionExcerpt(source: string, tokens: ReadonlyMap<string, boolean>): string {
    const sentences = source.match(/[^.!?。！？]+[.!?。！？]?/gu) ?? [];
    if (!sentences.some(sentence => definitionMarker.test(sentence) && matchingTokens(sentence, tokens).length > 0)) return '';
    const ranked = sentences.map((sentence, index) => ({sentence: sentence.trim(), index, score: definitionScore(sentence, tokens)})).filter(item => matchingTokens(item.sentence, tokens).length > 0).sort((left, right) => right.score - left.score || left.index - right.index);
    let remaining = 480;
    const included = [] as typeof ranked;
    for (const item of ranked) {
        if (item.sentence.length <= remaining) {
            included.push(item);
            remaining -= item.sentence.length + 1;
        }
    }
    return included.sort((left, right) => left.index - right.index).map(item => item.sentence).join(' ') || ranked[0].sentence.slice(0, 480);
}

function definitionScore(source: string, tokens: ReadonlyMap<string, boolean>): number {
    const matches = new Set(matchingTokens(source, tokens));
    const acronyms = words(source).filter(word => /^[A-Z][A-Z0-9]{1,11}$/u.test(word) && tokens.has(word.toLowerCase())).length;
    return matches.size * 3 + acronyms * 4 + (strongDefinitionMarker.test(source) ? 10 : definitionMarker.test(source) ? 1 : 0);
}

function evidenceFor(block: StoredBlock, kind: Evidence['kind'], source: string, translation?: string): Evidence {
    const evidence: Evidence = {
        kind,
        blockId: block.id,
        section: block.section,
        position: block.position,
        source: source.slice(0, 480),
    };
    if (translation !== undefined) evidence.translation = translation.slice(0, 480);
    return evidence;
}

/** 创建单篇材料的上下文；调用 replace 后再为当前段 prepare，成功译文通过票据 commit 复用。 */
export function createDiscourseContext() {
    let revision = '';
    let selection = '';
    let generation = 0;
    let blocks: StoredBlock[] = [];
    let frozenInput: WeakRef<readonly DiscourseBlock[]> | undefined;
    let frozenFingerprint = '';
    let focusedSection: {input: WeakRef<readonly DiscourseBlock[]>; start: number; end: number} | undefined;
    const pairs = new Map<string, TranslationPair>();

    function clear() {
        revision = '';
        selection = '';
        generation += 1;
        blocks = [];
        pairs.clear();
        frozenInput = undefined;
        frozenFingerprint = '';
        focusedSection = undefined;
    }

    /** 显式 revision 由采集器保证正文变化时更新，允许同一版本的有界窗口移动而不丢失译文。 */
    function replace(materialId: string, languageKey: string, input: readonly DiscourseBlock[], currentBlockId?: string, ownerRevision?: string) {
        let inputFingerprint = ownerRevision;
        if (inputFingerprint === undefined) {
            inputFingerprint = frozenInput?.deref() === input
                ? frozenFingerprint
                : fingerprint(snapshotValues('', '', input));
        }
        const nextRevision = fingerprint([materialId, languageKey, ownerRevision === undefined ? 'snapshot' : 'owner-revision', inputFingerprint]);
        const numericIndex = Number(currentBlockId);
        const currentIndex = currentBlockId === undefined ? -1
            : Number.isInteger(numericIndex) && numericIndex >= 0 && input[numericIndex]?.id === currentBlockId
                ? numericIndex : input.findIndex(block => block.id === currentBlockId);
        const indices = new Set<number>();
        const include = (start: number, count: number) => {
            for (let index = Math.max(0, start); index < Math.min(input.length, start + count); index += 1) indices.add(index);
        };
        if (currentIndex < 0) {
            include(0, discourseContextLimits.blocks);
        } else {
            if (revision !== nextRevision || focusedSection?.input.deref() !== input || currentIndex < focusedSection.start || currentIndex >= focusedSection.end) {
                let start = currentIndex;
                let end = currentIndex + 1;
                while (start > 0 && input[start - 1].section === input[currentIndex].section) start -= 1;
                while (end < input.length && input[end].section === input[currentIndex].section) end += 1;
                focusedSection = {input: new WeakRef(input), start, end};
            }
            include(0, 64);
            include(focusedSection.start, 96);
            include(Math.max(0, currentIndex - 48), 96);
        }
        const selected = [...indices].sort((left, right) => left - right);
        const nextSelection = fingerprint(snapshotValues(currentBlockId ?? '', '', selected.map(index => input[index])));
        if (revision === nextRevision && selection === nextSelection) return;
        const previousBlocks = blocks;
        if (revision !== nextRevision) clear();
        revision = nextRevision;
        selection = nextSelection;
        if (ownerRevision === undefined && frozenInput?.deref() !== input && Object.isFrozen(input) && input.every(Object.isFrozen)) {
            frozenInput = new WeakRef(input);
            frozenFingerprint = inputFingerprint;
        }
        blocks = [];
        let remaining: number = discourseContextLimits.sourceCharacters;
        const seen = new Set<string>();
        // 焦点窗口均分正文预算，保证长段锚点不能吞掉当前段及章节；非焦点模式保留既有前缀策略。
        const nonEmptyCount = selected.filter(index => input[index].source.length > 0).length;
        const perBlock = currentIndex < 0 ? discourseContextLimits.blockCharacters : Math.min(discourseContextLimits.blockCharacters, Math.floor(discourseContextLimits.sourceCharacters / Math.max(1, nonEmptyCount)));
        for (const index of selected) {
            const candidate = input[index];
            if (currentIndex < 0 && remaining === 0) break;
            const key = fingerprint([candidate.id]);
            if (seen.has(key)) continue;
            seen.add(key);
            const source = candidate.source.slice(0, Math.min(remaining, perBlock));
            remaining -= source.length;
            blocks.push({
                key,
                sectionKey: fingerprint([candidate.section]),
                sourceRevision: fingerprint([candidate.source, candidate.section, candidate.position]),
                id: candidate.id.slice(0, metadataCharacters),
                section: candidate.section.slice(0, metadataCharacters),
                position: candidate.position.slice(0, metadataCharacters),
                source,
                index,
            });
        }
        // 即使采集器漏增 revision，仍拒绝已见段落改写后的迟到译文；窗口未重叠的版本由采集器负责。
        if (ownerRevision !== undefined && previousBlocks.some(previous => blocks.some(block => block.key === previous.key && block.sourceRevision !== previous.sourceRevision))) {
            generation += 1;
            pairs.clear();
        }
    }

    function prepare(blockId: string, origins: readonly string[], signal?: AbortSignal) {
        const currentKey = fingerprint([blockId]);
        const current = blocks.find(block => block.key === currentKey);
        if (!current || signal?.aborted) return {context: '', commit: (_translations: readonly string[], _confirmed?: boolean) => {}};
        const ticketGeneration = generation;
        const originCount = origins.length;
        const originCopies = origins.slice(0, discourseContextLimits.pairs).map(origin => origin.slice(0, discourseContextLimits.blockCharacters));
        const tokens = tokensFor(originCopies);
        const resolvedSection = hasResolvedSection(current.section);
        const localDefinitions = new Set<string>();
        for (const block of blocks) {
            if (block.sectionKey === current.sectionKey) {
                for (const token of matchingTokens(definitionExcerpt(block.source, tokens), tokens)) localDefinitions.add(token);
            }
        }
        const crossTokens = new Map([...tokens].filter(([token, across]) => resolvedSection && across && !localDefinitions.has(token)));
        const previous = blocks.filter(block => block.index < current.index);
        const nearby = previous.filter(block => block.sectionKey === current.sectionKey).slice(-2);
        const hasPronouns = originCopies.some(origin => pronouns.test(origin));
        const sectionOpening = hasPronouns && resolvedSection
            ? previous.find(block => block.sectionKey === current.sectionKey && block.source.length > 0)
            : undefined;
        const liveBlocks = new Map(blocks.map(block => [block.key, block]));
        const eligiblePairs = [...pairs.values()].map(pair => ({...pair, block: liveBlocks.get(pair.block.key)})).filter((pair): pair is TranslationPair => {
            const block = pair.block;
            if (!block) return false;
            if (block.index > current.index) return false;
            if (block.sectionKey !== current.sectionKey) return hasResolvedSection(block.section) && matchingTokens(pair.source, crossTokens).length > 0;
            if (!resolvedSection && block.index !== current.index && !nearby.some(neighbor => neighbor.key === block.key)) return false;
            return block.index === current.index || (hasPronouns && nearby.some(neighbor => neighbor.key === block.key)) || matchingTokens(pair.source, tokens).length > 0;
        }).reverse();
        const definitions = (sameSection: boolean, relevant: ReadonlyMap<string, boolean>) => previous
            .filter(block => resolvedSection && (block.sectionKey === current.sectionKey) === sameSection && (sameSection || hasResolvedSection(block.section)) && block !== sectionOpening)
            .map(block => evidenceFor(block, 'definition', definitionExcerpt(block.source, relevant)))
            .filter(evidence => evidence.source)
            .sort((left, right) => definitionScore(right.source, relevant) - definitionScore(left.source, relevant));
        const candidates: Evidence[] = [
            ...eligiblePairs.filter(pair => pair.confirmed).map(pair => evidenceFor(pair.block, 'user_confirmed', pair.source, pair.translation)),
            ...(sectionOpening && !nearby.includes(sectionOpening) ? [evidenceFor(sectionOpening, 'section_opening', sectionOpening.source)] : []),
            ...definitions(true, tokens),
            ...eligiblePairs.filter(pair => !pair.confirmed).map(pair => evidenceFor(pair.block, 'previous_machine', pair.source, pair.translation)),
            ...nearby.reverse().filter(block => !eligiblePairs.some(pair => pair.block.key === block.key)).map(block => evidenceFor(block, 'nearby', block.source)),
            ...definitions(false, crossTokens),
        ];
        const reference = {
            version: 1,
            section: current.section,
            position: current.position,
            ...referencePolicy,
            evidence: [] as Evidence[],
        };
        const admitted = new Set<string>();
        for (const candidate of candidates) {
            const key = `${candidate.kind}:${candidate.blockId}:${candidate.source}`;
            if (admitted.has(key)) continue;
            const trial = {...reference, evidence: [...reference.evidence, candidate]};
            // 只加入完整 JSON 项，截断字符串仍保持可核对的原文前缀和有效协议。
            while (encode(trial).length > discourseContextLimits.referenceCharacters && candidate.source.length > 80) {
                candidate.source = candidate.source.slice(0, candidate.source.length - 40);
                if (candidate.translation !== undefined) candidate.translation = candidate.translation.slice(0, candidate.source.length);
            }
            if (encode(trial).length > discourseContextLimits.referenceCharacters) continue;
            reference.evidence.push(candidate);
            admitted.add(key);
        }
        let committed = false;
        return {
            context: encode(reference),
            commit(translations: readonly string[], confirmed = false) {
                if (committed || ticketGeneration !== generation || signal?.aborted || translations.length !== originCount) return;
                const liveBlock = blocks.find(block => block.key === current.key);
                if (!liveBlock || liveBlock.sourceRevision !== current.sourceRevision) return;
                committed = true;
                originCopies.forEach((source, index) => {
                    const translation = translations[index].slice(0, discourseContextLimits.blockCharacters);
                    if (!source.trim() || !translation.trim()) return;
                    const key = `${current.key}:${source}`;
                    if (pairs.get(key)?.confirmed && !confirmed) return;
                    pairs.delete(key);
                    pairs.set(key, {block: liveBlock, source, translation, confirmed});
                    if (pairs.size > discourseContextLimits.pairs) {
                        const oldest = [...pairs].find(([, pair]) => !pair.confirmed) ?? [...pairs][0];
                        pairs.delete(oldest[0]);
                    }
                });
            },
        };
    }

    return {replace, prepare, clear};
}
