/**
 * @file src/features/full-page-translation/content/orphanArtifacts.ts
 * 文件职责：清理宿主 clone/remount 后失去状态所有权的 FluentRead 轻 DOM 产物，并保住仅译文模式中的宿主原文。
 * 主要内容：以完整的手册反馈外框为单位移除直属双语/loading/retry 孤儿，避免把活跃反馈内部节点误当无主 owner；恢复全文原文及篇章证据后清理旧版标记并解包合成段落，解包 single-slot 的 light DOM 文本，排除译文产物判定同源重挂，并跳过仍由活动 WeakMap 状态管理的真实产物。
 * 模块边界：本文件处理原文恢复和明确带 FluentRead owned 标记的孤儿 DOM，不发现候选、不发请求，也不删除仅凭同名 class 无法证明所有权的宿主节点。
 */
import {
    getTranslationOwnersForRemovedNode,
    getTranslationState, unwrapUnownedSingleTextSlots, restoreAllTranslations, resetAllBilingualArtifactHostWriteBudgets,
} from '@/src/features/full-page-translation/content/state';
import {getOpenShadowRoots} from '@/src/core/translation/public';
import {resetPageDiscourseContext} from '@/src/services/translation/context/pageDiscourse';
import {clearTranslationFailedHost} from '../core/hostMarkers';
// 槽身份属于状态层；同一无损解包规则同时服务 discovery 和 restore/discard。
export {unwrapUnownedSingleTextSlots as normalizeOrphanedSingleSlots}
    from '@/src/features/full-page-translation/content/state';

const MANPAGE_FEEDBACK_SELECTOR = '.fluent-read-manpage-feedback[data-fr-translation-owned="true"]';
const REMOVABLE_ORPHAN_ARTIFACT_SELECTOR = [
    '.fluent-read-bilingual-content[data-fr-translation-owned="true"]',
    '.fluent-read-loading[data-fr-translation-owned="true"]',
    '.fluent-read-retry-wrapper[data-fr-translation-owned="true"]',
    MANPAGE_FEEDBACK_SELECTOR,
].join(',');
const normalizedOwnerClassMutations = new WeakSet<HTMLElement>();
const OWNED_ARTIFACT_SELECTOR = '[data-fr-translation-owned="true"]';

function asHTMLElement(node: Element | null): HTMLElement | null {
    if (!node) return null;
    const HTMLElementConstructor = node.ownerDocument.defaultView?.HTMLElement;
    return HTMLElementConstructor && node instanceof HTMLElementConstructor
        ? node as HTMLElement
        : null;
}

function queryElements(root: Node, selector: string): Element[] {
    const elements: Element[] = [];
    if (root.nodeType === 1 && (root as Element).matches(selector)) elements.push(root as Element);
    const queryRoot = root as Node & ParentNode;
    if (typeof queryRoot.querySelectorAll === 'function') {
        elements.push(...Array.from(queryRoot.querySelectorAll(selector)));
    }
    return elements;
}

function normalizedNodeText(node: Node): string {
    if (node.nodeType === 3) return (node as Text).data;
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    if (element.matches(OWNED_ARTIFACT_SELECTOR)) return '';
    const clone = element.cloneNode(true) as Element;
    queryElements(clone, OWNED_ARTIFACT_SELECTOR).forEach((artifact) => artifact.remove());
    return clone.textContent!;
}

/** 只合并明确的手册反馈外框；任意宿主 owned 标记不能成为阻止孤儿清理的边界。 */
function completeFeedbackArtifact(artifact: Element): Element {
    let feedback = artifact.closest(MANPAGE_FEEDBACK_SELECTOR);
    if (!feedback) return artifact;
    for (let outer = feedback.parentElement?.closest(MANPAGE_FEEDBACK_SELECTOR); outer; outer = feedback.parentElement?.closest(MANPAGE_FEEDBACK_SELECTOR)) {
        feedback = outer;
    }
    return feedback;
}

/** 清理一个没有活动状态、但仍携带直属扩展产物的克隆 owner。 */
export function normalizeOrphanedTranslationOwner(node: HTMLElement): void {
    if (getTranslationState(node)) return;
    const feedback = completeFeedbackArtifact(node);
    if (feedback !== node || node.matches(MANPAGE_FEEDBACK_SELECTOR)) {
        // dirty root 可以直接指向内层 loading/retry；所有权始终属于完整外框的实际父节点。
        const owner = asHTMLElement(feedback.parentElement);
        if (owner) normalizeOrphanedTranslationOwner(owner);
        return;
    }
    const orphaned = Array.from(node.children).filter((child) =>
        child.matches(REMOVABLE_ORPHAN_ARTIFACT_SELECTOR) && !getTranslationState(child as HTMLElement));
    if (orphaned.length === 0) return;

    orphaned.forEach((child) => child.remove());
    const nextClassName = Array.from(node.classList)
        .filter((className) => className !== 'fluent-read-bilingual' && className !== 'fluent-read-failure')
        .join(' ');
    if (node.getAttribute('class') !== (nextClassName || null)) {
        normalizedOwnerClassMutations.add(node);
        if (nextClassName) node.setAttribute('class', nextClassName);
        else node.removeAttribute('class');
    }
}

/** 识别并只消费一次孤儿 owner 清理产生的 class MutationRecord。 */
export function consumeOrphanedOwnerClassMutation(node: HTMLElement): boolean {
    if (!normalizedOwnerClassMutations.has(node)) return false;
    normalizedOwnerClassMutations.delete(node);
    return true;
}

/** 同父级、同原文的替换属于框架重挂，不改变 AI 页面上下文。 */
export function isTextEquivalentHostReplacement(mutation: MutationRecord): boolean {
    if (mutation.type !== 'childList' || mutation.addedNodes.length === 0 || mutation.removedNodes.length === 0) {
        return false;
    }
    const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
    const isTranslationRemount = changedNodes.some((node) =>
        getTranslationOwnersForRemovedNode(node).length > 0 ||
        queryElements(node, '[data-fr-translation-owned="true"]').length > 0);
    if (!isTranslationRemount) return false;
    const text = (nodes: NodeList) => Array.from(nodes)
        .map(normalizedNodeText)
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
    const addedText = text(mutation.addedNodes);
    return addedText.length > 0 && addedText === text(mutation.removedNodes);
}

/** 在候选发现前清理 dirty root 中的双语、加载与失败孤儿。 */
export function normalizeOrphanedTranslationArtifacts(root: Node): void {
    const owners = new Set<HTMLElement>();
    queryElements(root, REMOVABLE_ORPHAN_ARTIFACT_SELECTOR).forEach((artifact) => {
        const owner = asHTMLElement(completeFeedbackArtifact(artifact).parentElement);
        if (owner) owners.add(owner);
    });
    owners.forEach(normalizeOrphanedTranslationOwner);
}

/** 恢复全文后的旧版/克隆产物清理；先解包原文，且不触及仍有状态所有权的节点。 */
export function clearOrphanedTranslationArtifacts(root: Node): void {
    const queryRoot = root as Node & ParentNode;
    if (typeof queryRoot.querySelectorAll !== 'function') return;
    unwrapUnownedSingleTextSlots(root);
    const orphanOwners = new Set<Element>();
    const artifacts = new Set<Element>();
    // 只把明确可移除工件自身纳入 root 清理，不扩大到任意带 owned 属性的宿主根。
    if (root.nodeType === 1 && (root as Element).matches(REMOVABLE_ORPHAN_ARTIFACT_SELECTOR)) {
        artifacts.add(completeFeedbackArtifact(root as Element));
    }
    queryRoot.querySelectorAll(OWNED_ARTIFACT_SELECTOR).forEach(element => artifacts.add(completeFeedbackArtifact(element)));
    artifacts.forEach((element) => {
        // 宿主给真实 owner 复制反馈 class/owned 属性，也不能越过 WeakMap 状态删除原文。
        if (getTranslationState(element as HTMLElement)) return;
        const owner = element.parentElement;
        const htmlOwner = asHTMLElement(owner);
        if (htmlOwner && getTranslationState(htmlOwner)) return;
        if (owner) orphanOwners.add(owner);
        element.remove();
    });
    orphanOwners.forEach((owner) => {
        const htmlOwner = asHTMLElement(owner);
        if (htmlOwner) clearTranslationFailedHost(htmlOwner);
    });
    queryRoot.querySelectorAll('[data-fr-translation-segment="true"]').forEach((segment) => {
        if (!segment.parentNode || getTranslationState(asHTMLElement(segment) as HTMLElement)) return;
        segment.replaceWith(...Array.from(segment.childNodes));
    });
}

/** 恢复真实原文后兼容升级前遗留的 wrapper/属性，覆盖开放 Shadow DOM。 */
export function restorePageTranslationContent(): void {
    resetPageDiscourseContext();
    resetAllBilingualArtifactHostWriteBudgets();
    restoreAllTranslations();
    const roots: Node[] = [document.documentElement, ...getOpenShadowRoots(document.documentElement)];
    roots.forEach(clearOrphanedTranslationArtifacts);
}
