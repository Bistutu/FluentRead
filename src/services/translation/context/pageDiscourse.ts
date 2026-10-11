/**
 * @file src/services/translation/context/pageDiscourse.ts
 * 文件职责：把当前网页正文和候选位置适配到有界的单篇篇章状态。
 * 主要内容：有界遍历正文原文、排除输入与扩展译文、按标题分章，准备及提交带取消归属的证据。
 * 模块边界：只读 DOM，不挂载 UI、不请求模型、不持久化；调用方在恢复和卸载时清理。
 */
import {createDiscourseContext, discourseContextLimits, type DiscourseBlock} from './discourse';
import {getPageTranslationMaterialIdentity} from './policy';

const EXCLUDED = 'script,style,noscript,template,svg,math,pre,code,nav,aside,footer,form,button,input,textarea,select,[hidden],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="searchbox"],[role="combobox"],[translate="no"],[data-notranslate],[style*="display: none" i],[style*="visibility: hidden" i],.fluent-read-bilingual-content,.fluent-read-loading,.fluent-read-retry-wrapper';
const BLOCK = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,td,figcaption';
const MAX_NODES = 8192;
let discourse = createDiscourseContext();
let elementIds = new WeakMap<Element, string>();
let nextId = 0;
let sourceRevision = 0;
let knownSources = new Map<Element, string>();
let knownSourceCharacters = 0;
let activeScope = '';
let translatedSources = new Map<Element, string>();
let translatedSourceCharacters = 0;

function id(element: Element): string {
    let value = elementIds.get(element);
    if (!value) { value = String(++nextId); elementIds.set(element, value); }
    return value;
}

/** 整个当前原文单元的提交证明；超过预算时放弃译文参考，而不是只复验千字前缀。 */
function ownerSource(owner: Element, budget = {nodes: 0, characters: 0}): string | null {
    const doc = owner.ownerDocument;
    if (!doc.createTreeWalker) return null;
    const walker = doc.createTreeWalker(owner, 1 | 4, {
        acceptNode: node => node.nodeType === 1 && ((node as Element).matches(EXCLUDED)
            || ((node as Element).matches('[data-fr-translation-owned="true"]')
                && !(node as Element).matches('.fluent-read-single-slot'))) ? 2 : 1,
    });
    let source = '';
    let node: Node | null;
    while ((node = walker.nextNode())) {
        if (++budget.nodes > MAX_NODES) return null;
        if (node.nodeType === 3) {
            const text = (node as Text).data;
            if (budget.characters + text.length > discourseContextLimits.sourceCharacters) return null;
            source += text;
            budget.characters += text.length;
        }
    }
    return source;
}

/** 每次请求核对有界原文快照；不用观察器或计时器，迟到提交再次核对正文身份。 */
export function preparePageDiscourseContext(owner: Element, origins: readonly string[], languageKey: string, signal?: AbortSignal, onSourceChange?: () => void) {
    if (!owner.isConnected || owner.closest(EXCLUDED) || owner.closest('[data-fr-translation-owned="true"]')) {
        return {context: '', commit(_translations: readonly string[]) {}};
    }
    const doc = owner.ownerDocument;
    const root = owner.closest('article,main,[role="main"]') ?? doc.body;
    const materialId = `${getPageTranslationMaterialIdentity(doc.location?.href ?? doc.URL ?? '')}:${root ? id(root) : ''}`;
    const scope = JSON.stringify([materialId, languageKey]);
    if (activeScope !== scope) {
        activeScope = scope;
        knownSources.clear(); knownSourceCharacters = 0;
        translatedSources.clear(); translatedSourceCharacters = 0;
    }
    const capture = () => {
        const blocks: DiscourseBlock[] = [];
        if (!root || root.closest(EXCLUDED) || !doc.createTreeWalker) return blocks;
        // 已译依据核对完整原文；每次总计最多8192节点/64000字符，无法核对就撤销旧依据。
        const proofBudget = {nodes: 0, characters: 0};
        let changed = false;
        for (const [element, source] of translatedSources) {
            if (!element.isConnected || ownerSource(element, proofBudget) !== source) {
                sourceRevision++; translatedSources.delete(element); translatedSourceCharacters -= source.length;
                changed = true;
            }
        }
        const texts = new Map<Element, string>();
        const walker = doc.createTreeWalker(root, 1 | 4, {
            acceptNode(node) {
                if (node.nodeType === 1) {
                    const element = node as Element;
                    // 仅译文的 light DOM slot 保留的是原文；译文位于 closed shadow root。
                    if (element.matches(EXCLUDED) || (element.matches('[data-fr-translation-owned="true"]')
                        && !element.matches('.fluent-read-single-slot'))) return 2;
                }
                return 1;
            },
        });
        let node: Node | null;
        let visited = 0;
        let characters = 0;
        while ((node = walker.nextNode()) && visited++ < 2048
            && characters < 16000) {
            if (signal?.aborted) break;
            if (node.nodeType !== 3) continue;
            const element = node.parentElement?.closest(BLOCK);
            if (!element || !root.contains(element)) continue;
            if (!texts.has(element) && texts.size >= 64) break;
            const previous = texts.get(element) ?? '';
            const value = (node as Text).data.slice(0, Math.min(
                discourseContextLimits.blockCharacters - previous.length,
                16000 - characters,
            ));
            texts.set(element, previous + value);
            characters += value.length;
        }
        if (visited >= 2048 || characters >= 16000) {
            // 不把预算截止造成的半块文本当成原文版本变化。
            const incomplete = [...texts.keys()].at(-1);
            if (incomplete) texts.delete(incomplete);
        }
        // 固定开篇锚点之后采集当前候选附近的窗口，深处章节也不会退回文章前缀。
        const currentOwner = owner.closest(BLOCK) ?? owner;
        const window: Element[] = [currentOwner];
        // 常见正文每段各包一个布局容器；最多上移8层单子容器，再取邻容器里的正文。
        let anchor = currentOwner;
        for (let depth = 0; depth < 8 && anchor.parentElement && anchor.parentElement !== root
            && anchor.parentElement.children.length === 1; depth++) anchor = anchor.parentElement;
        window.push(anchor);
        let sibling = anchor.previousElementSibling;
        for (let count = 0; sibling && count < 96; count++, sibling = sibling.previousElementSibling) window.push(sibling);
        sibling = anchor.nextElementSibling;
        for (let count = 0; sibling && count < 32; count++, sibling = sibling.nextElementSibling) window.push(sibling);
        const localElements = new Set(window);
        for (const element of window) {
            if (visited >= MAX_NODES || characters >= discourseContextLimits.sourceCharacters) break;
            if (element.closest(EXCLUDED)) continue;
            const localWalker = doc.createTreeWalker(element, 1 | 4, {
                acceptNode(node) {
                    return node.nodeType === 1 && ((node as Element).matches(EXCLUDED)
                        || ((node as Element).matches('[data-fr-translation-owned="true"]')
                            && !(node as Element).matches('.fluent-read-single-slot'))) ? 2 : 1;
                },
            });
            let local: Node | null;
            const localTexts = new Map<Element, string>();
            while ((local = localWalker.nextNode()) && visited++ < MAX_NODES
                && characters < discourseContextLimits.sourceCharacters) {
                if (signal?.aborted) break;
                if (local.nodeType !== 3) continue;
                const block = local.parentElement?.closest(BLOCK) ?? element;
                localElements.add(block);
                if (texts.has(block)) continue;
                const old = localTexts.get(block) ?? '';
                const value = (local as Text).data.slice(0, Math.min(
                    discourseContextLimits.blockCharacters - old.length,
                    discourseContextLimits.sourceCharacters - characters));
                localTexts.set(block, old + value); characters += value.length;
                if (texts.size + localTexts.size >= discourseContextLimits.blocks - 1) break;
            }
            if (visited >= MAX_NODES || characters >= discourseContextLimits.sourceCharacters) {
                const incomplete = [...localTexts.keys()].at(-1);
                if (incomplete) localTexts.delete(incomplete);
            }
            for (const [block, text] of localTexts) texts.set(block, text);
        }
        for (const [element, previous] of knownSources) {
            if (!element.isConnected || (texts.has(element) && texts.get(element) !== previous)) {
                sourceRevision++; knownSources.delete(element); knownSourceCharacters -= previous.length;
                changed = true;
            }
        }
        if (changed) onSourceChange?.();
        for (const [element, text] of texts) {
            knownSourceCharacters += text.length - (knownSources.get(element)?.length ?? 0);
            knownSources.set(element, text);
            while (knownSources.size > discourseContextLimits.blocks || knownSourceCharacters > discourseContextLimits.sourceCharacters) {
                const oldest = knownSources.keys().next().value!;
                knownSourceCharacters -= knownSources.get(oldest)!.length;
                knownSources.delete(oldest);
            }
        }
        // 当本章标题在采集范围之外时，用当前局部窗口独立作用域，不能继承远处开篇作者。
        const localHeadings = [...localElements].filter(element => texts.has(element) && /^H[1-6]$/u.test(element.tagName));
        const nearestHeading = localHeadings.filter(element => element.compareDocumentPosition(currentOwner) & 4)
            .sort((a, b) => a.compareDocumentPosition(b) & 4 ? 1 : -1)[0];
        const hasHeading = [...texts.keys()].some(element => /^H[1-6]$/u.test(element.tagName));
        const unknownSection = `unresolved-section:${id(hasHeading ? currentOwner.parentElement ?? root : root)}`;
        let section = hasHeading ? 'body' : unknownSection;
        let localSection = nearestHeading ? undefined : unknownSection;
        for (const [element, text] of [...texts].sort(([a], [b]) => {
            const position = a.compareDocumentPosition(b);
            return (position & 2) - (position & 4);
        })) {
            if (/^H[1-6]$/u.test(element.tagName)) section = `${id(element)}:${text.slice(0, 120)}`;
            if (localElements.has(element) && /^H[1-6]$/u.test(element.tagName)) localSection = section;
            blocks.push({id: id(element), section: !hasHeading ? unknownSection : localElements.has(element) ? localSection ?? section : section,
                source: text, position: `block ${id(element)}`});
        }
        const blockOwner = owner.closest(BLOCK) ?? owner;
        if (!blocks.some(block => block.id === id(blockOwner))) {
            // 超出扫描预算的段落仍有自身位置；不会无限向后采集或重发整篇。
            blocks.push({id: id(blockOwner), section: `outside-budget:${id(blockOwner)}`,
                source: origins.join('\n').slice(0, discourseContextLimits.blockCharacters), position: 'current passage outside capture budget'});
        }
        return blocks;
    };
    const state = discourse;
    const blocks = capture();
    state.replace(materialId, languageKey, blocks, id(owner.closest(BLOCK) ?? owner), String(sourceRevision));
    const ticket = state.prepare(id(owner.closest(BLOCK) ?? owner), origins, signal);
    const capturedOwnerSource = ownerSource(owner);
    return {
        context: ticket.context,
        commit(translations: readonly string[]) {
            if (signal?.aborted || discourse !== state || activeScope !== scope || !owner.isConnected
                || capturedOwnerSource === null || ownerSource(owner) !== capturedOwnerSource
                || `${getPageTranslationMaterialIdentity(doc.location?.href ?? doc.URL ?? '')}:${root ? id(root) : ''}` !== materialId) return;
            const currentBlocks = capture();
            translatedSourceCharacters += capturedOwnerSource.length - (translatedSources.get(owner)?.length ?? 0);
            translatedSources.delete(owner);
            translatedSources.set(owner, capturedOwnerSource);
            let evicted = false;
            while (translatedSources.size > discourseContextLimits.pairs || translatedSourceCharacters > discourseContextLimits.sourceCharacters) {
                const oldest = translatedSources.keys().next().value!;
                translatedSourceCharacters -= translatedSources.get(oldest)!.length;
                translatedSources.delete(oldest); evicted = true;
            }
            if (evicted) sourceRevision++;
            state.replace(materialId, languageKey, currentBlocks, id(owner.closest(BLOCK) ?? owner), String(sourceRevision));
            // 来源证明预算淘汰会清理旧参考；刚刚完整验证的当前结果可以作为新的首条依据。
            (evicted ? state.prepare(id(owner.closest(BLOCK) ?? owner), origins, signal) : ticket).commit(translations);
        },
    };
}

export function resetPageDiscourseContext(): void {
    discourse.clear();
    discourse = createDiscourseContext();
    elementIds = new WeakMap();
    nextId = 0;
    sourceRevision = 0;
    knownSources = new Map();
    knownSourceCharacters = 0;
    activeScope = '';
    translatedSources = new Map();
    translatedSourceCharacters = 0;
}
