import { checkConfig, skipNode } from "../utils/check";
import { services, servicesType } from "../utils/option";
import { insertFailedTip, insertLoadingSpinner } from "../utils/icon";
import { styles } from "@/entrypoints/utils/constant";
import {
    getOpenShadowRoots,
    grabAllNode,
    grabNode,
    isTranslationControl,
    LLMStandardHTML,
    resolveNodeAtPoint,
    smashTruncationStyle,
} from "@/entrypoints/main/dom";
import { detectlang } from "@/entrypoints/utils/common";
import { config } from "@/entrypoints/utils/config";
import { translateText, translateTextBatch, cancelAllTranslations } from "@/entrypoints/utils/translateApi";
import {
    appendBilingualTranslation,
    createSafeTranslationFragment,
    replaceWithSafeTranslation,
} from "@/entrypoints/main/translationRenderer";
import {
    beginTranslation,
    discardTranslation,
    getTranslationState,
    markTranslationComplete,
    markTranslationError,
    restoreAllTranslations,
    restoreTranslation,
    setBilingualContent,
    setRenderedStyleAttribute,
    setSpinner,
    setTranslatedHTML,
} from "@/entrypoints/main/translationState";

const TRANSLATION_ARTIFACT_SELECTOR = [
    ".fluent-read-bilingual-content",
    ".fluent-read-loading",
    ".fluent-read-retry-wrapper",
    '[data-fr-translation-owned="true"]',
].join(",");

type TranslationResult = string | ControlTranslationResult;

interface ControlTextPart {
    node: Text;
    prefix: string;
    suffix: string;
    source: string;
}

interface ControlTranslationResult {
    kind: "control";
    changed: boolean;
    apply: () => string;
}

interface FullPageSession {
    active: boolean;
    generation: number;
    observer: IntersectionObserver;
    mutationObserver: MutationObserver;
    roots: Set<Node>;
    pending: Set<HTMLElement>;
    scheduled: Set<HTMLElement>;
    inFlight: number;
    draining: boolean;
    flushTimer: number | null;
}

let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let fullPageSession: FullPageSession | null = null;
let sessionSequence = 0;

function notifyFullPageTranslationState(isTranslated: boolean): void {
    void browser.runtime.sendMessage({
        type: "fullPageTranslationState",
        isTranslated,
    }).catch(() => {
        // 后台可能正在重载；页面内的翻译状态不应因此失败。
    });
}

function asHTMLElement(node: unknown): HTMLElement | null {
    return node instanceof HTMLElement ? node : null;
}

function normalizeComparableText(text: string): string {
    return text.replace(/[\s\u3000]+/g, " ").trim();
}

function isTranslationArtifact(node: Node): boolean {
    if (!(node instanceof Element)) return false;
    return Boolean(node.matches(TRANSLATION_ARTIFACT_SELECTOR) || node.closest(TRANSLATION_ARTIFACT_SELECTOR));
}

function isProtectedTextNode(node: Text): boolean {
    const parent = node.parentElement;
    if (!parent) return true;
    if (isTranslationArtifact(parent)) return true;
    if (parent.closest('[aria-hidden="true"]')) return true;
    const tag = parent.tagName.toLowerCase();
    return ["script", "style", "noscript", "pre", "code", "kbd", "samp", "var", "math", "svg"].includes(tag);
}

function collectTextParts(root: HTMLElement): ControlTextPart[] {
    const parts: ControlTextPart[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current = walker.nextNode();
    while (current) {
        const node = current as Text;
        const value = node.nodeValue || "";
        const match = value.match(/^(\s*)([\s\S]*?\S)(\s*)$/);
        if (match && !isProtectedTextNode(node)) {
            parts.push({ node, prefix: match[1], source: match[2], suffix: match[3] });
        }
        current = walker.nextNode();
    }
    return parts;
}

function isBatchFriendlyService(): boolean {
    return config.service === services.microsoft || config.service === services.freeTranslation;
}

/**
 * 对机器翻译的 HTML 克隆逐个替换文本节点。标签、链接、图标和原文 DOM
 * 都不直接交给服务端，避免响应把网页结构打碎；微软/免费翻译的数组接口
 * 还可以把同一段中的多个文本节点合并成一次请求。
 */
async function translateElementHTML(node: HTMLElement): Promise<string> {
    const clone = node.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(TRANSLATION_ARTIFACT_SELECTOR).forEach((child) => child.remove());
    const parts = collectTextParts(clone);
    if (parts.length === 0) return clone.innerHTML;

    const origins = parts.map((part) => part.source);
    const translations = isBatchFriendlyService()
        ? await translateTextBatch(origins, document.title, { useCache: false })
        : await Promise.all(origins.map((origin) => translateText(origin, document.title)));
    translations.forEach((translation, index) => {
        const part = parts[index];
        if (part) part.node.nodeValue = `${part.prefix}${translation}${part.suffix}`;
    });
    return clone.innerHTML;
}

/**
 * 按钮、role=button 等交互控件必须保持原有 DOM 结构和行为，因此即使当前
 * 页面选择了双语模式，也只替换控件内的可见文本，不追加第二段译文。
 */
async function translateControlText(node: HTMLElement): Promise<ControlTranslationResult> {
    const parts = collectTextParts(node);
    if (parts.length === 0) return { kind: "control", changed: false, apply: () => node.innerHTML };

    const origins = parts.map((part) => part.source);
    const translations = isBatchFriendlyService()
        ? await translateTextBatch(origins, document.title, { useCache: false })
        : await Promise.all(origins.map((origin) => translateText(origin, document.title)));
    const changed = translations.some((translation, index) =>
        normalizeComparableText(translation) !== normalizeComparableText(origins[index] || ""),
    );

    return {
        kind: "control",
        changed,
        apply: () => {
            translations.forEach((translation, index) => {
                const part = parts[index];
                if (part?.node.isConnected) {
                    part.node.nodeValue = `${part.prefix}${translation}${part.suffix}`;
                }
            });
            return node.innerHTML;
        },
    };
}

async function createTranslationRequest(node: HTMLElement, kind: "content" | "control"): Promise<TranslationResult> {
    if (kind === "control") return translateControlText(node);

    if (servicesType.isMachine(config.service)) {
        if (isBatchFriendlyService()) return translateElementHTML(node);
        return translateText(node.innerHTML, document.title);
    }

    // AI 服务继续使用结构化 HTML 输入，响应再经过白名单解析；这比把一个
    // article/div 的所有内容压成纯文本更能保持链接、强调和换行的语义。
    return translateText(LLMStandardHTML(node), document.title);
}

function getSafeTranslationText(text: string): string {
    const fragment = createSafeTranslationFragment(text);
    return fragment.textContent || "";
}

function markFailedTranslation(
    node: HTMLElement,
    attempt: NonNullable<ReturnType<typeof beginTranslation>>,
    spinner: HTMLElement | undefined,
    error: unknown,
): void {
    spinner?.remove();
    if (!node.isConnected || !markTranslationError(node, attempt.state, attempt.generation)) {
        discardTranslation(node, attempt.state);
        return;
    }
    insertFailedTip(node, error instanceof Error ? error.message : String(error || "翻译失败"), spinner);
}

async function renderTranslation(
    node: HTMLElement,
    attempt: NonNullable<ReturnType<typeof beginTranslation>>,
    request: Promise<TranslationResult>,
): Promise<void> {
    const { state, generation } = attempt;
    const spinner = state.spinner;

    try {
        const result = await request;
        spinner?.remove();

        if (!node.isConnected || !markTranslationComplete(node, state, generation)) {
            discardTranslation(node, state);
            return;
        }

        if (state.kind === "control") {
            const controlResult = result as ControlTranslationResult;
            if (!controlResult.changed) {
                discardTranslation(node, state);
                return;
            }
            const translatedHTML = controlResult.apply();
            setTranslatedHTML(node, translatedHTML);
            return;
        }

        const translatedText = typeof result === "string" ? result : "";
        const translatedPlainText = getSafeTranslationText(translatedText);
        if (!translatedPlainText || normalizeComparableText(translatedPlainText) === normalizeComparableText(state.sourceText)) {
            discardTranslation(node, state);
            return;
        }

        if (state.mode === "bilingual") {
            const content = appendBilingualTranslation(node, translatedText);
            setBilingualContent(node, content);
            setRenderedStyleAttribute(node);
        } else {
            // 翻译后文本通常比原文更长，先解除宿主页面的 line-clamp/max-height，
            // 但状态机会在恢复时按“样式没有被网站改写”条件精确写回原值。
            smashTruncationStyle(node);
            replaceWithSafeTranslation(node, translatedText);
            setTranslatedHTML(node, node.innerHTML);
            setRenderedStyleAttribute(node);
        }
    } catch (error) {
        markFailedTranslation(node, attempt, spinner, error);
    }
}

async function translateTarget(
    node: HTMLElement,
    displayMode: "bilingual" | "single",
    slide: boolean,
): Promise<void> {
    if (!node.isConnected) return;

    const current = getTranslationState(node);
    if (current?.phase === "loading") return;
    if (current?.phase === "translated") {
        // 滑动触发只对当前鼠标下的新目标翻译，不在移动过程中反复恢复原文。
        if (!slide) restoreTranslation(node);
        return;
    }
    if (current?.phase === "error") restoreTranslation(node);

    if (skipNode(node)) return;
    const sourceText = node.textContent || "";
    if (!normalizeComparableText(sourceText)) return;

    // 只有明确检测到目标语言时才跳过，检测失败不应该让页面整段漏译。
    try {
        const detected = detectlang(normalizeComparableText(sourceText));
        if (detected && detected === config.to) return;
    } catch {
        // 语言检测只是优化，不影响正常翻译流程。
    }

    const kind = isTranslationControl(node) ? "control" : "content";
    const attempt = beginTranslation(node, displayMode, kind);
    if (!attempt) return;

    // 请求必须在 spinner 插入前创建；微软 HTML 克隆和文本节点快照不能把
    // 插件自己的 loading 元素送到服务端。
    const request = createTranslationRequest(node, kind);
    const spinner = insertLoadingSpinner(node);
    setSpinner(node, spinner);
    await renderTranslation(node, attempt, request);
}

function scheduleFullPageDrain(session: FullPageSession): void {
    if (!session.active || session.flushTimer !== null) return;
    session.flushTimer = window.setTimeout(() => {
        session.flushTimer = null;
        drainFullPage(session);
    }, 0);
}

function drainFullPage(session: FullPageSession): void {
    if (!session.active || session.draining) return;
    session.draining = true;
    const maxConcurrent = 3;

    while (session.active && session.inFlight < maxConcurrent && session.pending.size > 0) {
        const iterator = session.pending.values().next();
        const node = iterator.value as HTMLElement | undefined;
        if (!node) break;
        session.pending.delete(node);
        session.inFlight += 1;
        void translateTarget(node, config.display === styles.bilingualTranslation ? "bilingual" : "single", true)
            .finally(() => {
                session.inFlight -= 1;
                if (session.active) scheduleFullPageDrain(session);
            });
    }
    session.draining = false;
}

function addFullPageBlocks(session: FullPageSession, root: Node): void {
    if (!session.active) return;
    for (const node of grabAllNode(root)) {
        const target = asHTMLElement(node);
        if (!target || !target.isConnected || session.scheduled.has(target)) continue;
        if (getTranslationState(target)?.phase === "translated") continue;
        session.scheduled.add(target);
        session.observer.observe(target);
    }
}

function observeFullPageRoot(session: FullPageSession, root: Node): void {
    if (session.roots.has(root)) return;
    session.roots.add(root);
    session.mutationObserver.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        characterDataOldValue: true,
        attributes: true,
        attributeFilter: ["style", "class", "hidden", "aria-hidden", "translate", "data-notranslate"],
    });
}

function resolveStatefulMutationTarget(element: Element): HTMLElement | false {
    let current: Element | null = element;
    while (current) {
        if (current instanceof HTMLElement && getTranslationState(current)) return current;
        const candidate = grabNode(current);
        if (candidate instanceof HTMLElement && getTranslationState(candidate)) return candidate;
        current = current.parentElement;
    }
    return false;
}

function isOwnMutation(mutation: MutationRecord): boolean {
    // 不能用“位于任意插件节点内”作为判断：站点可能直接改写双语 wrapper
    // 的文本，必须让这类 mutation 进入 stale/retranslate 分支。加载/错误节点
    // 没有宿主正文，才可以直接视为插件自身变化。
    if (mutation.target instanceof Element &&
        mutation.target.matches(".fluent-read-loading, .fluent-read-retry-wrapper")) return true;
    const mutationElement = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
    const target = mutationElement ? resolveStatefulMutationTarget(mutationElement) : false;
    const state = target ? getTranslationState(target as HTMLElement) : undefined;
    if (!target || !state || state.phase !== "translated") return false;
    if (state.kind === "control" && state.translatedHTML === (target as Element)?.innerHTML) return true;
    if (state.mode === "single" && state.translatedHTML === (target as Element)?.innerHTML) return true;
    if (state.bilingualContent?.isConnected) {
        const wrapper = state.bilingualContent;
        const mutationParent = mutation.target instanceof Element
            ? mutation.target
            : mutation.target.parentElement;

        // wrapper 内部的变化只有在内容仍等于插件最后写入的快照时才算插件自身；
        // 如果站点脚本改写了译文，必须让后续分支恢复并重新排队。
        if (mutationParent && (mutationParent === wrapper || wrapper.contains(mutationParent))) {
            return wrapper.innerHTML === state.bilingualHTML;
        }

        // 插件会先插入 loading，完成后再移除 loading 并插入译文 wrapper。
        // 这两类 childList mutation 都可能落在宿主节点上；只要所有增删节点
        // 都是扩展 artifact，且插件自己的最终快照仍然存在，就不能触发重译。
        // 若 wrapper 已被宿主移除，则保留 false，让后续逻辑恢复并重新排队。
        if (mutation.type === "childList") {
            const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
            if (changedNodes.length > 0 && changedNodes.every(isTranslationArtifact)) {
                if (state.kind === "control" || state.mode === "single") {
                    return state.translatedHTML === target.innerHTML;
                }
                return state.bilingualContent?.isConnected === true &&
                    state.bilingualContent.innerHTML === state.bilingualHTML;
            }
        }

        // 双语渲染会临时修改宿主节点的 style；只有值仍是插件记录的值时才忽略。
        if (mutation.type === "attributes" && mutation.attributeName === "style") {
            return target.getAttribute("style") === state.renderedStyleAttribute;
        }
        if (mutation.type === "attributes" && mutation.attributeName === "class") {
            return target.getAttribute("class") === state.renderedClassAttribute;
        }
    }
    return mutation.addedNodes.length > 0 && Array.from(mutation.addedNodes).every(isTranslationArtifact);
}

function attachFullPageMutationHandling(session: FullPageSession): void {
    session.mutationObserver = new MutationObserver((mutations) => {
        if (!session.active) return;
        for (const mutation of mutations) {
            if (isOwnMutation(mutation)) continue;

            if (mutation.type === "childList") {
                const mutationElement = mutation.target instanceof Element
                    ? mutation.target
                    : mutation.target.parentElement;
                const changedTarget = mutationElement ? resolveStatefulMutationTarget(mutationElement) : false;
                const changedState = changedTarget instanceof HTMLElement
                    ? getTranslationState(changedTarget)
                    : undefined;

                // React/Vue 等页面可能在翻译完成后重建控件或内容块。若 DOM
                // 已不再等于插件写入的译文，先放弃旧节点快照，再把新节点
                // 重新排入全文队列，避免按钮短暂翻译后又恢复成英文。
                if (changedTarget instanceof HTMLElement && changedState?.phase === "translated") {
                    restoreTranslation(changedTarget);
                    session.scheduled.delete(changedTarget);
                    session.pending.add(changedTarget);
                    session.observer.observe(changedTarget);
                }

                for (const added of Array.from(mutation.addedNodes)) {
                    if (isTranslationArtifact(added)) continue;
                    if (added.nodeType === Node.ELEMENT_NODE) {
                        addFullPageBlocks(session, added);
                        for (const root of getOpenShadowRoots(added)) observeFullPageRoot(session, root);
                    }
                }
                if (mutation.addedNodes.length > 0) scheduleFullPageDrain(session);
            } else if (mutation.type === "characterData") {
                const target = mutation.target.parentElement
                    ? resolveStatefulMutationTarget(mutation.target.parentElement)
                    : false;
                if (target instanceof HTMLElement) {
                    const state = getTranslationState(target);
                    if (state?.phase === "translated") restoreTranslation(target);
                    session.scheduled.delete(target);
                    session.pending.add(target);
                    session.observer.observe(target);
                    scheduleFullPageDrain(session);
                }
            } else if (mutation.type === "attributes") {
                const mutationElement = mutation.target instanceof Element ? mutation.target : null;
                if (!mutationElement) continue;

                const target = resolveStatefulMutationTarget(mutationElement);
                if (target) {
                    const state = getTranslationState(target);
                    if (state?.phase === "translated") restoreTranslation(target);
                    session.scheduled.delete(target);
                    session.pending.add(target);
                    session.observer.observe(target);
                    scheduleFullPageDrain(session);
                } else {
                    // hidden/aria-hidden/style/class 变化可能让原先被屏蔽的子树重新可见。
                    addFullPageBlocks(session, mutationElement);
                    scheduleFullPageDrain(session);
                }
            }
        }
    });
}

function stopFullPageSession(): void {
    if (!fullPageSession) return;
    fullPageSession.active = false;
    if (fullPageSession.flushTimer !== null) window.clearTimeout(fullPageSession.flushTimer);
    fullPageSession.observer.disconnect();
    fullPageSession.mutationObserver.disconnect();
    fullPageSession.pending.clear();
    fullPageSession = null;
}

/**
 * 恢复全文翻译。全文和悬浮翻译共享同一份节点状态，因此这里无需再用
 * data-fr-node-id + innerHTML 覆盖页面，也能处理 Shadow DOM 和动态节点。
 */
export function restoreOriginalContent(): void {
    stopFullPageSession();
    cancelAllTranslations();
    restoreAllTranslations();

    // 兼容升级前遗留的 wrapper/属性；新状态机不会依赖这些标记，但旧页面
    // 不应在扩展热更新后留下半截译文。
    const roots: Node[] = [document.documentElement, ...getOpenShadowRoots(document.documentElement)];
    for (const root of roots) {
        if (!(root instanceof Element || root instanceof DocumentFragment || root instanceof Document)) continue;
        root.querySelectorAll?.(".fluent-read-bilingual-content, .fluent-read-loading, .fluent-read-retry-wrapper").forEach((element) => element.remove());
        root.querySelectorAll?.(".fluent-read-bilingual").forEach((element) => element.classList.remove("fluent-read-bilingual"));
    }
    notifyFullPageTranslationState(false);
}

/**
 * 启动全文翻译会话：根固定为 documentElement，使用较大的预取窗口和并发
 * 限制，并持续观察新增 DOM/open ShadowRoot。这样 body 被 SPA 替换后仍能
 * 继续工作，也不会一次性给整页发出数百个请求。
 */
export function autoTranslateEnglishPage(): void {
    if (!checkConfig() || fullPageSession?.active) return;
    const root = document.documentElement;
    if (!root) return;

    const observer = new IntersectionObserver((entries) => {
        const session = fullPageSession;
        if (!session?.active) return;
        for (const entry of entries) {
            const node = entry.target as HTMLElement;
            if (entry.isIntersecting && !session.pending.has(node)) session.pending.add(node);
        }
        scheduleFullPageDrain(session);
    }, {
        root: null,
        rootMargin: "600px 0px",
        threshold: 0.01,
    });

    const session: FullPageSession = {
        active: true,
        generation: ++sessionSequence,
        observer,
        mutationObserver: new MutationObserver(() => undefined),
        roots: new Set(),
        pending: new Set(),
        scheduled: new Set(),
        inFlight: 0,
        draining: false,
        flushTimer: null,
    };
    fullPageSession = session;
    attachFullPageMutationHandling(session);
    observeFullPageRoot(session, root);
    addFullPageBlocks(session, root);
    for (const shadowRoot of getOpenShadowRoots(root)) observeFullPageRoot(session, shadowRoot);
    notifyFullPageTranslationState(true);
}

/**
 * 处理鼠标悬浮/快捷键翻译。坐标只负责找到内容块，真正的翻译调用与全文
 * 会话共用 translateTarget，因此按钮、富文本和恢复行为不会出现两套规则。
 */
export function handleTranslation(mouseX: number, mouseY: number, delayTime = 0): void {
    if (!checkConfig()) return;
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
        const node = asHTMLElement(resolveNodeAtPoint(mouseX, mouseY));
        if (!node) return;
        void translateTarget(node, config.display === styles.bilingualTranslation ? "bilingual" : "single", delayTime > 0);
    }, delayTime);
}

export function handleBilingualTranslation(node: unknown, slide: boolean): void {
    const target = asHTMLElement(node);
    if (!target) return;
    void translateTarget(target, "bilingual", slide);
}

export function handleSingleTranslation(node: unknown, slide: boolean): void {
    const target = asHTMLElement(node);
    if (!target) return;
    void translateTarget(target, "single", slide);
}
