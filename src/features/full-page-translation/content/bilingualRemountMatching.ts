/**
 * @file src/features/full-page-translation/content/bilingualRemountMatching.ts
 * 文件职责：为同一宿主 mutation 边界的双语 owner 换代建立结构索引，避免旧/新段落两两验证。
 * 主要内容：缓存可信旧状态，按相对路径、语义范围和结构签名索引新节点，以共享候选组汇总歧义与译文差异；同批普通 owner 在相同识别范围下共享祖先保护读数，显式外壳例外仍按 owner 单独判断，同一只读阶段按父节点建立兄弟位置索引，保留严格位置配对和溢出身份校验。
 * 模块边界：只计算交接配对，缓存与匹配组区分自动外壳策略来源，不改写 DOM、不提交翻译状态、不发起请求；交接与布局恢复由 bilingualRemount 执行。
 */
import {
    getTranslationOverflowGenerationIdentity,
    getTranslationSourceStructureSignature,
    getTranslationState,
    isTranslationSourceStructureOverflow,
    isTrustedBilingualArtifactWithHostClass,
    type TranslationState,
} from './state';
import {collectLiveTranslationTextSlots, createTranslationTextProtectionCache, getCurrentTranslationCore,
    type TranslationScope, type TranslationTextProtectionCache} from '@/src/core/translation/public';

export interface BilingualRemountPair {
    previousOwner: HTMLElement;
    replacementOwner: HTMLElement;
    depth: number;
    boundary: Node;
    previousRoot: Node;
    replacementRoot: Node;
}

/** indexes 仅在同一同步只读阶段复用，DOM 写入后必须重建。 */
export function nodePathWithin(
    root: Node, target: Node, indexes?: WeakMap<Node, Map<Node, number>>,
): number[] | null {
    if (root === target) return [];
    const path: number[] = [];
    let current: Node | null = target;
    while (current && current !== root) {
        const parent: Node | null = current.parentNode;
        if (!parent) return null;
        let index: number;
        if (indexes) {
            let positions = indexes.get(parent);
            if (!positions) {
                positions = new Map<Node, number>();
                const siblings = parent.childNodes;
                for (let position = 0; position < siblings.length; position++) positions.set(siblings[position]!, position);
                indexes.set(parent, positions);
            }
            index = positions.get(current)!;
        } else index = Array.from(parent.childNodes).indexOf(current as ChildNode);
        path.push(index);
        current = parent;
    }
    return path.reverse();
}

export function nodeAtPath(root: Node, path: readonly number[]): Node | null {
    let current: Node | null = root;
    for (const index of path) {
        current = current?.childNodes.item(index) ?? null;
        if (!current) return null;
    }
    return current;
}

export function asHTMLElement(node: Node | null): HTMLElement | null {
    if (!node || node.nodeType !== 1) return null;
    return node as HTMLElement;
}

function cachedSourceStructureSignature(
    owner: HTMLElement,
    allowTopLevelApplicationShell: boolean,
    cache: WeakMap<HTMLElement, Map<string, string>>,
    protectionCaches: Map<TranslationScope, TranslationTextProtectionCache>,
    state?: TranslationState,
): string {
    let signatures = cache.get(owner);
    if (!signatures) {
        signatures = new Map<string, string>();
        cache.set(owner, signatures);
    }
    const cacheKey = JSON.stringify([allowTopLevelApplicationShell, state?.syntheticSegment, state?.scope ?? 'content', state?.applicationShellPolicyId]);
    const cached = signatures.get(cacheKey);
    if (cached !== undefined) return cached;
    const sourceTextNodes = state?.syntheticSegment ? collectLiveTranslationTextSlots(
        owner,
        getCurrentTranslationCore(state.scope).shouldStayOriginal,
        owner,
        state.allowTopLevelApplicationShell === true
            ? {allowTopLevelApplicationShell: true, protectedElement: owner}
            : {protectedElement: owner},
    ).map((slot) => slot.node) : undefined;
    // 显式外壳例外以本次 owner 为保护边界，不能继承另一 owner 的放行结果。
    let protectionCache: TranslationTextProtectionCache | undefined;
    if (!allowTopLevelApplicationShell) {
        const scope = state?.scope ?? 'content';
        protectionCache = protectionCaches.get(scope);
        if (!protectionCache) {
            protectionCache = createTranslationTextProtectionCache();
            protectionCaches.set(scope, protectionCache);
        }
    }
    const signature = getTranslationSourceStructureSignature(
        owner,
        allowTopLevelApplicationShell,
        sourceTextNodes,
        state?.scope,
        protectionCache,
    );
    signatures.set(cacheKey, signature);
    return signature;
}

type Candidates = ReadonlyMap<HTMLElement, Node>;
const NO_CANDIDATES: Candidates = new Map();

function transferableState(owner: HTMLElement): TranslationState | null {
    const state = getTranslationState(owner);
    const wrapper = state?.bilingualContent;
    const template = state?.bilingualContentTemplate;
    return state?.phase === 'translated' && state.mode === 'bilingual' && state.kind === 'content' &&
        !owner.isConnected && wrapper && template && isTrustedBilingualArtifactWithHostClass(template, state)
        ? state : null;
}

/** 每种路径/范围只扫描新增根一次；同结构重复段落共享候选 Map，不展开完全二分图。 */
export function matchBilingualRemountOwners(
    mutations: readonly MutationRecord[],
    resolveRemovedOwners: (removed: Node) => readonly HTMLElement[],
): BilingualRemountPair[] {
    const addedByBoundary = new Map<Node, Node[]>();
    for (const mutation of mutations) {
        const added = addedByBoundary.get(mutation.target) ?? [];
        for (const node of Array.from(mutation.addedNodes)) added.push(node);
        addedByBoundary.set(mutation.target, added);
    }
    const pathIndexes = new WeakMap<Node, Map<Node, number>>();
    const signatureCache = new WeakMap<HTMLElement, Map<string, string>>();
    const protectionCaches = new Map<TranslationScope, TranslationTextProtectionCache>();
    const states = new Map<HTMLElement, TranslationState | null>();
    const indexes = new Map<Node, Map<string, Map<string, Map<HTMLElement, Node>>>>();
    const entries: Array<{
        mutation: MutationRecord; removedRoot: Node; previousOwner: HTMLElement;
        path: number[]; index: number; candidates: Candidates;
    }> = [];
    const counts = new Map<HTMLElement, number>();
    const previousChoice = new Map<HTMLElement, HTMLElement | null>();
    const groups = new Map<Candidates, Set<HTMLElement>>();

    for (const mutation of mutations) {
        Array.from(mutation.removedNodes).forEach((removedRoot, index) => {
            for (const previousOwner of resolveRemovedOwners(removedRoot)) {
                const path = nodePathWithin(removedRoot, previousOwner, pathIndexes);
                if (!path) continue;
                counts.set(previousOwner, (counts.get(previousOwner) ?? 0) + 1);
                if (!states.has(previousOwner)) states.set(previousOwner, transferableState(previousOwner));
                const state = states.get(previousOwner);
                if (!state) continue;
                const profile = JSON.stringify([
                    path, previousOwner.namespaceURI, previousOwner.localName,
                    state.allowTopLevelApplicationShell === true, state.syntheticSegment, state.scope ?? 'content',
                    state.applicationShellPolicyId,
                    isTranslationSourceStructureOverflow(state.sourceStructureSignature),
                ]);
                let boundaryIndexes = indexes.get(mutation.target);
                if (!boundaryIndexes) {
                    boundaryIndexes = new Map();
                    indexes.set(mutation.target, boundaryIndexes);
                }
                let bySignature = boundaryIndexes.get(profile);
                if (!bySignature) {
                    bySignature = new Map();
                    boundaryIndexes.set(profile, bySignature);
                    for (const addedRoot of addedByBoundary.get(mutation.target)!) {
                        const replacement = asHTMLElement(nodeAtPath(addedRoot, path));
                        if (!replacement || !replacement.isConnected || getTranslationState(replacement) ||
                            replacement.localName !== previousOwner.localName ||
                            replacement.namespaceURI !== previousOwner.namespaceURI || state.syntheticSegment !==
                                (replacement.getAttribute('data-fr-translation-segment') === 'true')) continue;
                        const identity = isTranslationSourceStructureOverflow(state.sourceStructureSignature)
                            ? getTranslationOverflowGenerationIdentity(replacement)
                            : cachedSourceStructureSignature(replacement, state.allowTopLevelApplicationShell === true,
                                signatureCache, protectionCaches, state);
                        const candidates = bySignature.get(identity) ?? new Map<HTMLElement, Node>();
                        candidates.set(replacement, addedRoot);
                        bySignature.set(identity, candidates);
                    }
                }
                const identity = isTranslationSourceStructureOverflow(state.sourceStructureSignature)
                    ? state.sourceOverflowGenerationIdentity : state.sourceStructureSignature;
                let candidates: Candidates = identity === undefined ? NO_CANDIDATES : bySignature.get(identity) ?? NO_CANDIDATES;
                const wrapperParent = state.bilingualContent!.parentNode;
                if (wrapperParent && wrapperParent !== previousOwner) {
                    const root = candidates.get(wrapperParent as HTMLElement);
                    candidates = root ? new Map([[wrapperParent as HTMLElement, root]]) : NO_CANDIDATES;
                }
                entries.push({mutation, removedRoot, previousOwner, path, index, candidates});
                if (candidates.size === 0) continue;
                const onlyCandidate = candidates.keys().next().value!;
                const choice = previousChoice.get(previousOwner);
                previousChoice.set(previousOwner, candidates.size > 1 ||
                    (choice !== undefined && choice !== onlyCandidate) ? null : onlyCandidate);
                const owners = groups.get(candidates) ?? new Set<HTMLElement>();
                owners.add(previousOwner);
                groups.set(candidates, owners);
            }
        });
    }

    // 唯一性只需要区分 0/1/多，输出等价性只需保留首个输出与冲突位。
    const summaries = new Map<HTMLElement, {
        onlyPrevious: HTMLElement | null; output: string | undefined; equivalent: boolean;
    }>();
    for (const [candidates, owners] of groups) {
        const first = owners.values().next().value!;
        const output = states.get(first)!.bilingualOuterHTML;
        const equivalent = Array.from(owners).every((owner) => states.get(owner)!.bilingualOuterHTML === output);
        const onlyPrevious = owners.size === 1 ? first : null;
        for (const replacement of candidates.keys()) {
            const summary = summaries.get(replacement);
            if (summary) {
                if (summary.onlyPrevious !== onlyPrevious) summary.onlyPrevious = null;
                summary.equivalent &&= equivalent && summary.output === output;
            } else summaries.set(replacement, {onlyPrevious, output, equivalent});
        }
    }
    const pairs: BilingualRemountPair[] = [];
    for (const entry of entries) {
        const {previousOwner, candidates, mutation, path} = entry;
        if (counts.get(previousOwner)! > 1 && previousChoice.get(previousOwner) === null) continue;
        const positional = mutation.addedNodes.length === mutation.removedNodes.length
            ? asHTMLElement(nodeAtPath(mutation.addedNodes[entry.index]!, path)) : null;
        let replacement = positional && candidates.has(positional) && summaries.get(positional)!.equivalent
            ? positional : null;
        if (!replacement && candidates.size === 1) {
            const onlyCandidate = candidates.keys().next().value!;
            if (summaries.get(onlyCandidate)!.onlyPrevious === previousOwner) replacement = onlyCandidate;
        }
        if (replacement) pairs.push({
            previousOwner, replacementOwner: replacement, depth: path.length, boundary: mutation.target,
            previousRoot: entry.removedRoot, replacementRoot: candidates.get(replacement)!,
        });
    }
    return pairs;
}
