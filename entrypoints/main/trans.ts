import { checkConfig, skipNode } from "../utils/check";
import { services, servicesType } from "../utils/option";
import { insertFailedTip, insertLoadingSpinner } from "../utils/icon";
import { styles } from "@/entrypoints/utils/constant";
import { beautyHTML, getOpenShadowRoots, grabAllNode, LLMStandardHTML, resolveNodeAtPoint } from "@/entrypoints/main/dom";
import { detectlang, throttle } from "@/entrypoints/utils/common";
import { config } from "@/entrypoints/utils/config";
import { translateText, translateTextBatch, cancelAllTranslations } from '@/entrypoints/utils/translateApi';
import { getPageTranslationContext } from '@/entrypoints/utils/pageContext';
import { appendBilingualTranslation, replaceWithSafeTranslation } from "@/entrypoints/main/translationRenderer";
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

let hoverTimer: any; // 鼠标悬停计时器
export let originalContents = new Map(); // 保存原始内容
const originalNodes = new Map<string, Element>(); // 保存全文翻译节点，支持 Shadow DOM 恢复
let isAutoTranslating = false; // 控制是否继续翻译新内容
let observer: IntersectionObserver | null = null; // 保存观察器实例
let mutationObserver: MutationObserver | null = null; // 保存 DOM 变化观察器实例

// 使用自定义属性标记已翻译的节点
const TRANSLATED_ATTR = 'data-fr-translated';
const TRANSLATED_ID_ATTR = 'data-fr-node-id'; // 添加节点ID属性

let nodeIdCounter = 0; // 节点ID计数器

// 恢复原文内容
export function restoreOriginalContent() {
    // 取消所有等待中的翻译任务
    cancelAllTranslations();

    // 先恢复指定节点翻译状态机管理的节点，避免用字符串 innerHTML 覆盖真实节点。
    restoreAllTranslations();
    
    const restoreLegacyNode = (node: Element, nodeId: string | null) => {
        if (!nodeId) return;
        if (nodeId && originalContents.has(nodeId)) {
            const originalContent = originalContents.get(nodeId);
            // 指定节点状态机可能已经恢复过真实 ChildNode；只有内容仍然不同才做兼容恢复。
            if (node.innerHTML !== originalContent) node.innerHTML = originalContent;
            node.removeAttribute(TRANSLATED_ATTR);
            node.removeAttribute(TRANSLATED_ID_ATTR);
            
            // 移除可能添加的翻译相关类
            node.classList.remove('fluent-read-bilingual');
        }
    };

    // 1. 遍历普通 DOM 与已记录的 Shadow DOM 节点。
    document.querySelectorAll(`[${TRANSLATED_ATTR}="true"]`).forEach(node => {
        restoreLegacyNode(node, node.getAttribute(TRANSLATED_ID_ATTR));
    });
    originalNodes.forEach((node, nodeId) => {
        restoreLegacyNode(node, nodeId);
    });
    
    // 2. 移除所有翻译内容元素
    document.querySelectorAll('.fluent-read-bilingual-content').forEach(element => {
        element.remove();
    });
    
    // 3. 移除所有翻译过程中添加的加载动画和错误提示
    document.querySelectorAll('.fluent-read-loading, .fluent-read-retry-wrapper').forEach(element => {
        element.remove();
    });
    
    // 4. 清空存储的原始内容
    originalContents.clear();
    originalNodes.clear();
    
    // 5. 停止所有观察器
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
    }
    
    // 6. 重置所有翻译相关的状态
    isAutoTranslating = false;
    nodeIdCounter = 0; // 重置节点ID计数器
    
    // 7. 消除可能存在的全局样式污染
    const tempStyleElements = document.querySelectorAll('style[data-fr-temp-style]');
    tempStyleElements.forEach(el => el.remove());
}

// 自动翻译整个页面的功能
export function autoTranslateEnglishPage() {
    // 如果已经在翻译中，则返回
    if (isAutoTranslating) return;
    
    // 获取当前页面的语言（暂时注释，存在识别问题）
    // const text = document.documentElement.innerText || '';
    // const cleanText = text.replace(/[\s\u3000]+/g, ' ').trim().slice(0, 500);
    // const language = detectlang(cleanText);
    // console.log('当前页面语言：', language);
    // const to = config.to;
    // if (to.includes(language)) {
    //     console.log('目标语言与当前页面语言相同，不进行翻译');
    //     return;
    // }
    // console.log('当前页面非目标语言，开始翻译');

    // 获取所有需要翻译的节点
    const nodes = grabAllNode(document.body);
    if (!nodes.length) return;

    isAutoTranslating = true;

    // 创建观察器
    observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && isAutoTranslating) {
                const node = entry.target as Element;

                // 去重
                if (node.hasAttribute(TRANSLATED_ATTR)) return;
                
                // 为节点分配唯一ID
                const nodeId = `fr-node-${nodeIdCounter++}`;
                node.setAttribute(TRANSLATED_ID_ATTR, nodeId);
                
                // 保存原始内容
                originalContents.set(nodeId, node.innerHTML);
                originalNodes.set(nodeId, node);
                
                // 标记为已翻译
                node.setAttribute(TRANSLATED_ATTR, 'true');

                if (config.display === styles.bilingualTranslation) {
                    handleBilingualTranslation(node, false);
                } else {
                    handleSingleTranslation(node, false);
                }

                // 停止观察该节点
                observer.unobserve(node);
            }
        });
    }, {
        root: null,
        rootMargin: '50px',
        threshold: 0.1 // 只要出现10%就开始翻译
    });

    // 开始观察所有节点
    nodes.forEach(node => {
        observer?.observe(node);
    });

    const mutationObserverOptions: MutationObserverInit = {
        childList: true,
        subtree: true,
    };

    // 创建 MutationObserver 监听 DOM 变化
    mutationObserver = new MutationObserver((mutations) => {
        if (!isAutoTranslating) return;
        
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) { // 元素节点
                    // 只处理未翻译的新节点
                    const newNodes = grabAllNode(node as Element).filter(
                        n => !n.hasAttribute(TRANSLATED_ATTR)
                    );
                    newNodes.forEach(n => observer?.observe(n));

                    // MutationObserver 不会自动穿透新出现的 ShadowRoot。
                    // 将开放根单独注册，后续动态内容才能进入同一翻译队列。
                    getOpenShadowRoots(node as Element).forEach(shadowRoot => {
                        mutationObserver?.observe(shadowRoot, mutationObserverOptions);
                    });
                }
            });
        });
    });

    // 监听整个 body 的变化
    mutationObserver.observe(document.body, mutationObserverOptions);
    getOpenShadowRoots(document.body).forEach(shadowRoot => {
        mutationObserver?.observe(shadowRoot, mutationObserverOptions);
    });
}

function asTranslationNode(node: unknown): HTMLElement | null {
    return node instanceof HTMLElement ? node : null;
}

function markAttemptError(
    node: HTMLElement,
    attempt: ReturnType<typeof beginTranslation>,
    spinner: HTMLElement | undefined,
    error: unknown,
): void {
    if (!attempt) return;

    spinner?.remove();
    if (!node.isConnected || !markTranslationError(node, attempt.state, attempt.generation)) {
        discardTranslation(node, attempt.state);
        return;
    }

    insertFailedTip(node, error instanceof Error ? error.toString() : String(error || '翻译失败'), spinner);
}

async function renderBilingualResult(
    node: HTMLElement,
    attempt: NonNullable<ReturnType<typeof beginTranslation>>,
    translation: Promise<string> | string,
): Promise<void> {
    const { state, generation } = attempt;
    const spinner = state.spinner;

    try {
        const text = await translation;
        spinner?.remove();

        if (!text || text === state.sourceText) {
            discardTranslation(node, state);
            return;
        }

        if (!markTranslationComplete(node, state, generation)) {
            discardTranslation(node, state);
            return;
        }

        const content = appendBilingualTranslation(node, text);
        setBilingualContent(node, content);
        setRenderedStyleAttribute(node);
    } catch (error) {
        markAttemptError(node, attempt, spinner, error);
    }
}

async function renderSingleResult(
    node: HTMLElement,
    attempt: NonNullable<ReturnType<typeof beginTranslation>>,
    origin: string,
    translation: Promise<string> | string,
): Promise<void> {
    const { state, generation } = attempt;
    const spinner = state.spinner;

    try {
        let text = await translation;
        spinner?.remove();

        text = beautyHTML(text);

        if (!text || text === origin) {
            discardTranslation(node, state);
            return;
        }

        if (!markTranslationComplete(node, state, generation)) {
            discardTranslation(node, state);
            return;
        }

        replaceWithSafeTranslation(node, text);
        setTranslatedHTML(node, node.innerHTML);
    } catch (error) {
        markAttemptError(node, attempt, spinner, error);
    }
}

// 处理鼠标悬停翻译的主函数。
export function handleTranslation(mouseX: number, mouseY: number, delayTime: number = 0) {
    if (!checkConfig()) return;

    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
        const node = resolveNodeAtPoint(mouseX, mouseY);
        if (!(node instanceof HTMLElement) || skipNode(node)) return;

        if (config.display === styles.bilingualTranslation) {
            handleBilingualTranslation(node, delayTime > 0);
        } else {
            handleSingleTranslation(node, delayTime > 0);
        }
    }, delayTime);
}

// 双语翻译。
export function handleBilingualTranslation(node: unknown, slide: boolean): void {
    const target = asTranslationNode(node);
    if (!target) return;

    const current = getTranslationState(target);
    if (current?.phase === 'loading') return;
    if (current?.phase === 'translated') {
        if (!slide) restoreTranslation(target);
        return;
    }
    if (current?.phase === 'error') restoreTranslation(target);
    if (skipNode(target)) return;

    const origin = target.textContent ?? '';
    const cleanedText = origin.replace(/[\s\u3000]/g, '');
    if (!cleanedText || detectlang(cleanedText) === config.to) return;

    const attempt = beginTranslation(target, 'bilingual');
    if (!attempt) return;

    const spinner = insertLoadingSpinner(target);
    setSpinner(target, spinner);

    void renderBilingualResult(target, attempt, translateText(origin, document.title, {
        pageContext: getPageTranslationContext(origin),
    }));
}

// 单语/仅译文翻译。
export function handleSingleTranslation(node: unknown, slide: boolean): void {
    const target = asTranslationNode(node);
    if (!target) return;

    const current = getTranslationState(target);
    if (current?.phase === 'loading') return;
    if (current?.phase === 'translated') {
        if (!slide) restoreTranslation(target);
        return;
    }
    if (current?.phase === 'error') restoreTranslation(target);
    if (skipNode(target)) return;

    singleTranslate(target);
}

export function singleTranslate(node: unknown): void {
    const target = asTranslationNode(node);
    if (!target) return;

    const origin = servicesType.isMachine(config.service)
        ? target.innerHTML
        : LLMStandardHTML(target);
    const cleanedText = target.textContent?.replace(/[\s\u3000]/g, '') ?? '';
    if (!cleanedText || detectlang(cleanedText) === config.to) return;

    const attempt = beginTranslation(target, 'single');
    if (!attempt) return;

    const translation = config.service === services.microsoft
        ? translateMicrosoftHtml(target)
        : translateText(origin, document.title, {
            pageContext: getPageTranslationContext(origin),
        });

    // 先创建翻译请求，再插入 loading 节点。微软 HTML 翻译会克隆目标
    // 元素；如果顺序相反，loading 节点也会被带进服务响应和最终译文。
    const spinner = insertLoadingSpinner(target);
    setSpinner(target, spinner);

    void renderSingleResult(target, attempt, origin, translation);
}

async function translateMicrosoftHtml(node: HTMLElement): Promise<string> {
    const clone = node.cloneNode(true) as HTMLElement;
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    const textNodes: Array<{node: Text; prefix: string; suffix: string}> = [];
    const texts: string[] = [];

    let currentNode = walker.nextNode();
    while (currentNode) {
        const textNode = currentNode as Text;
        const parentTag = textNode.parentElement?.tagName.toLowerCase();
        const value = textNode.nodeValue || '';
        const match = value.match(/^(\s*)([\s\S]*?\S)(\s*)$/);

        if (match && !['script', 'style', 'noscript'].includes(parentTag || '')) {
            textNodes.push({node: textNode, prefix: match[1], suffix: match[3]});
            texts.push(match[2]);
        }

        currentNode = walker.nextNode();
    }

    if (texts.length === 0) return clone.innerHTML;

    const translations = await translateTextBatch(texts, document.title, {
        pageContext: getPageTranslationContext(texts.join(' ')),
    });
    translations.forEach((translation, index) => {
        const textNodeInfo = textNodes[index];
        if (!textNodeInfo) return;
        const {node: textNode, prefix, suffix} = textNodeInfo;
        textNode.nodeValue = `${prefix}${translation}${suffix}`;
    });

    return clone.innerHTML;
}

export const handleBtnTranslation = throttle((node: any) => {
    const origin = node.innerText;
    translateText(origin, document.title, {
        pageContext: getPageTranslationContext(origin),
    })
        .then((text: string) => {
            node.innerText = text;
        }).catch((error: any) => console.error('调用失败:', error))
}, 250)
