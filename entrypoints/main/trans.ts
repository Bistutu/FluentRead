import { checkConfig, searchClassName, skipNode } from "../utils/check";
import { cache } from "../utils/cache";
import { options, servicesType } from "../utils/option";
import { insertFailedTip, insertLoadingSpinner } from "../utils/icon";
import { styles } from "@/entrypoints/utils/constant";
import { beautyHTML, grabNode, grabAllNode, LLMStandardHTML, smashTruncationStyle } from "@/entrypoints/main/dom";
import { detectlang, throttle } from "@/entrypoints/utils/common";
import { getMainDomain, replaceCompatFn } from "@/entrypoints/main/compat";
import { config } from "@/entrypoints/utils/config";
import { translateText, cancelAllTranslations } from '@/entrypoints/utils/translateApi';
import { 
  prepareParagraphTranslation, 
  applyParagraphTranslation, 
  detectParagraphs,
  ParagraphTranslationConfig
} from '@/entrypoints/utils/paragraphTranslator';

let hoverTimer: any; // 鼠标悬停计时器
let htmlSet = new Set(); // 防抖
export let originalContents = new Map(); // 保存原始内容
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
    
    // 1. 处理元素模式翻译的节点
    document.querySelectorAll(`[${TRANSLATED_ATTR}="true"]`).forEach(node => {
        const nodeId = node.getAttribute(TRANSLATED_ID_ATTR);
        if (nodeId && originalContents.has(nodeId)) {
            const originalContent = originalContents.get(nodeId);
            node.innerHTML = originalContent;
            node.removeAttribute(TRANSLATED_ATTR);
            node.removeAttribute(TRANSLATED_ID_ATTR);
            
            // 移除可能添加的翻译相关类
            node.classList.remove('fluent-read-bilingual');
        }
    });
    
    // 2. 处理段落模式翻译的节点
    document.querySelectorAll('.fluent-read-paragraph-container[data-translated="true"]').forEach(container => {
        const nodeId = container.getAttribute(TRANSLATED_ID_ATTR);
        if (nodeId && originalContents.has(nodeId)) {
            const originalContent = originalContents.get(nodeId);
            
            // 恢复段落容器的原始内容结构
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = originalContent;
            
            // 将原始节点重新插入到DOM中
            const parent = container.parentNode;
            if (parent) {
                while (tempDiv.firstChild) {
                    parent.insertBefore(tempDiv.firstChild, container);
                }
                parent.removeChild(container);
            }
        } else {
            // 如果没有存储的原始内容，尝试恢复原文
            const originalText = container.getAttribute('data-original-text');
            if (originalText) {
                container.textContent = originalText;
                container.removeAttribute('data-translated');
            }
        }
    });
    
    // 3. 移除所有翻译内容元素
    document.querySelectorAll('.fluent-read-bilingual-content').forEach(element => {
        element.remove();
    });
    
    // 4. 移除所有翻译过程中添加的加载动画和错误提示
    document.querySelectorAll('.fluent-read-loading, .fluent-read-retry-wrapper').forEach(element => {
        element.remove();
    });
    
    // 5. 清空存储的原始内容
    originalContents.clear();
    
    // 6. 停止所有观察器
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
    }
    
    // 7. 重置所有翻译相关的状态
    isAutoTranslating = false;
    htmlSet.clear(); // 清空防抖集合
    nodeIdCounter = 0; // 重置节点ID计数器
    
    // 8. 消除可能存在的全局样式污染
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

    isAutoTranslating = true;

    // 根据翻译模式选择不同的翻译策略
    if (config.translationMode === 'paragraph') {
        autoTranslateParagraphs();
    } else {
        autoTranslateElements();
    }
}

// 按元素翻译（原有逻辑）
function autoTranslateElements() {
    // 获取所有需要翻译的节点
    const nodes = grabAllNode(document.body);
    if (!nodes.length) return;

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
                }
            });
        });
    });

    // 监听整个 body 的变化
    mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// 按段落翻译
function autoTranslateParagraphs() {
    const startTime = Date.now();
    const SETUP_TIMEOUT = 10000; // 10秒设置超时
    
    try {
        console.log('[段落翻译] 开始初始化段落翻译模式');
        
        // 设置超时保护
        const timeoutId = setTimeout(() => {
            console.warn('[段落翻译] 初始化超时，降级到元素模式');
            autoTranslateElements();
        }, SETUP_TIMEOUT);
        
        const containers = prepareParagraphTranslation(document.body);
        
        // 清除超时，因为prepareParagraphTranslation已经完成
        clearTimeout(timeoutId);
        
        if (!containers.length) {
            console.log('[段落翻译] 未找到可翻译段落，降级到元素模式');
            autoTranslateElements();
            return;
        }

        console.log(`[段落翻译] 创建了${containers.length}个段落容器，用时${Date.now() - startTime}ms`);

        // 创建观察器来处理段落翻译
        observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && isAutoTranslating) {
                    const container = entry.target as HTMLElement;
                    
                    // 防止重复翻译
                    if (container.hasAttribute('data-translated')) return;
                    
                    // 为节点分配唯一ID
                    const nodeId = `fr-paragraph-${nodeIdCounter++}`;
                    container.setAttribute(TRANSLATED_ID_ATTR, nodeId);
                    
                    // 保存原始内容
                    const originalText = container.getAttribute('data-original-text') || '';
                    originalContents.set(nodeId, container.innerHTML);
                    
                    // 处理段落翻译
                    handleParagraphTranslation(container, originalText);
                    
                    // 停止观察该节点
                    observer.unobserve(container);
                }
            });
        }, {
            root: null,
            rootMargin: '50px',
            threshold: 0.1 // 只要出现10%就开始翻译
        });

        // 开始观察所有段落容器
        containers.forEach((container, index) => {
            try {
                observer?.observe(container);
            } catch (error) {
                console.warn(`[段落翻译] 观察第${index}个容器失败:`, error);
            }
        });

        // 创建 MutationObserver 监听新增的段落（限制频率）
        let mutationTimeout: NodeJS.Timeout | null = null;
        mutationObserver = new MutationObserver((mutations) => {
            if (!isAutoTranslating) return;
            
            // 防抖处理，避免频繁处理
            if (mutationTimeout) {
                clearTimeout(mutationTimeout);
            }
            
            mutationTimeout = setTimeout(() => {
                try {
                    mutations.forEach(mutation => {
                        mutation.addedNodes.forEach(node => {
                            if (node.nodeType === 1) { // 元素节点
                                const newContainers = prepareParagraphTranslation(node as Element);
                                newContainers.forEach(container => {
                                    if (!container.hasAttribute('data-translated')) {
                                        try {
                                            observer?.observe(container);
                                        } catch (error) {
                                            console.warn('[段落翻译] 观察新容器失败:', error);
                                        }
                                    }
                                });
                            }
                        });
                    });
                } catch (error) {
                    console.warn('[段落翻译] 处理DOM变化失败:', error);
                }
            }, 500); // 500ms防抖
        });

        // 监听整个 body 的变化
        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });

        console.log('[段落翻译] 初始化完成');

    } catch (error) {
        console.error('[段落翻译] 初始化失败:', error);
        // 降级到元素翻译模式
        console.log('[段落翻译] 降级到元素翻译模式');
        autoTranslateElements();
    }
}

// 处理段落翻译
async function handleParagraphTranslation(container: HTMLElement, originalText: string) {
    const TRANSLATION_TIMEOUT = 30000; // 30秒翻译超时
    
    if (!originalText || originalText.trim().length === 0) {
        console.warn('[段落翻译] 空文本，跳过翻译');
        return;
    }
    
    // 检查语言
    if (detectlang(originalText.replace(/[\s\u3000]/g, '')) === config.to) {
        console.log('[段落翻译] 目标语言相同，跳过翻译');
        return;
    }
    
    // 显示加载动画
    const spinner = insertLoadingSpinner(container);
    
    // 设置翻译超时
    const timeoutId = setTimeout(() => {
        spinner.remove();
        insertFailedTip(container, "翻译超时", spinner);
        console.warn(`[段落翻译] 翻译超时: ${originalText.substring(0, 100)}...`);
    }, TRANSLATION_TIMEOUT);
    
    try {
        // 调用翻译API
        const translatedText = await translateText(originalText, document.title);
        
        // 清除超时定时器
        clearTimeout(timeoutId);
        
        // 移除加载动画
        spinner.remove();
        
        if (!translatedText || translatedText === originalText) {
            console.log('[段落翻译] 翻译结果无效或相同，跳过');
            return;
        }
        
        // 应用翻译结果
        const isBilingual = config.display === styles.bilingualTranslation;
        try {
            applyParagraphTranslation(container, translatedText, isBilingual);
            
            // 缓存翻译结果
            cache.localSetDual(originalText, translatedText);
            
            console.log(`[段落翻译] 翻译完成: ${originalText.substring(0, 50)}... -> ${translatedText.substring(0, 50)}...`);
            
        } catch (applyError) {
            console.error('[段落翻译] 应用翻译结果失败:', applyError);
            insertFailedTip(container, "应用翻译失败", spinner);
        }
        
    } catch (error) {
        // 清除超时定时器
        clearTimeout(timeoutId);
        
        spinner.remove();
        const errorMsg = error?.toString() || "段落翻译失败";
        insertFailedTip(container, errorMsg, spinner);
        console.error(`[段落翻译] 翻译失败 (${originalText.substring(0, 100)}...):`, error);
    }
}

// 处理鼠标悬停翻译的主函数
export function handleTranslation(mouseX: number, mouseY: number, delayTime: number = 0) {
    // 检查配置
    if (!checkConfig()) return;

    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {

        let node = grabNode(document.elementFromPoint(mouseX, mouseY));

        // 判断是否跳过节点
        if (skipNode(node)) return;

        // 防抖
        let nodeOuterHTML = node.outerHTML;
        if (htmlSet.has(nodeOuterHTML)) return;
        htmlSet.add(nodeOuterHTML);

        // 根据翻译模式进行翻译
        if (config.display === styles.bilingualTranslation) {
            handleBilingualTranslation(node, delayTime > 0);  // 根据 delayTime 可判断是否为滑动翻译
        } else {
            handleSingleTranslation(node, delayTime > 0);
        }
    }, delayTime);
}

// 双语翻译
export function handleBilingualTranslation(node: any, slide: boolean) {
    let nodeOuterHTML = node.outerHTML;
    // 如果已经翻译过，250ms 后删除翻译结果
    let bilingualNode = searchClassName(node, 'fluent-read-bilingual');
    if (bilingualNode) {
        if (slide) {
            htmlSet.delete(nodeOuterHTML);
            return;
        }
        let spinner = insertLoadingSpinner(bilingualNode as HTMLElement, true);
        setTimeout(() => {
            spinner.remove();
            const content = searchClassName(bilingualNode as HTMLElement, 'fluent-read-bilingual-content');
            if (content && content instanceof HTMLElement) content.remove();
            (bilingualNode as HTMLElement).classList.remove('fluent-read-bilingual');
            htmlSet.delete(nodeOuterHTML);
        }, 250);
        return;
    }

    // 检查是否有缓存
    let cached = cache.localGet(node.textContent);
    if (cached) {
        let spinner = insertLoadingSpinner(node, true);
        setTimeout(() => {
            spinner.remove();
            htmlSet.delete(nodeOuterHTML);
            bilingualAppendChild(node, cached);
        }, 250);
        return;
    }

    // 翻译
    bilingualTranslate(node, nodeOuterHTML);
}

// 单语翻译
export function handleSingleTranslation(node: any, slide: boolean) {
    let nodeOuterHTML = node.outerHTML;
    let outerHTMLCache = cache.localGet(node.outerHTML);


    if (outerHTMLCache) {
        // handleTranslation 已处理防抖 故删除判断 原bug 在保存完成后 刷新页面 可以取得缓存 直接return并没有翻译
        let spinner = insertLoadingSpinner(node, true);
        setTimeout(() => {
            spinner.remove();
            htmlSet.delete(nodeOuterHTML);

            // 兼容部分网站独特的 DOM 结构
            let fn = replaceCompatFn[getMainDomain(document.location.hostname)];
            if (fn) fn(node, outerHTMLCache);
            else node.outerHTML = outerHTMLCache;

        }, 250);
        return;
    }

    singleTranslate(node);
}


function bilingualTranslate(node: any, nodeOuterHTML: any) {
    if (detectlang(node.textContent.replace(/[\s\u3000]/g, '')) === config.to) return;

    let origin = node.textContent;
    let spinner = insertLoadingSpinner(node);
    
    // 使用队列管理的翻译API
    translateText(origin, document.title)
        .then((text: string) => {
            spinner.remove();
            htmlSet.delete(nodeOuterHTML);
            bilingualAppendChild(node, text);
        })
        .catch((error: Error) => {
            spinner.remove();
            insertFailedTip(node, error.toString() || "翻译失败", spinner);
        });
}


export function singleTranslate(node: any) {
    if (detectlang(node.textContent.replace(/[\s\u3000]/g, '')) === config.to) return;

    let origin = servicesType.isMachine(config.service) ? node.innerHTML : LLMStandardHTML(node);
    let spinner = insertLoadingSpinner(node);
    
    // 使用队列管理的翻译API
    translateText(origin, document.title)
        .then((text: string) => {
            spinner.remove();
            
            text = beautyHTML(text);
            
            if (!text || origin === text) return;
            
            let oldOuterHtml = node.outerHTML;
            node.innerHTML = text;
            let newOuterHtml = node.outerHTML;
            
            // 缓存翻译结果
            cache.localSetDual(oldOuterHtml, newOuterHtml);
            cache.set(htmlSet, newOuterHtml, 250);
            htmlSet.delete(oldOuterHtml);
        })
        .catch((error: Error) => {
            spinner.remove();
            insertFailedTip(node, error.toString() || "翻译失败", spinner);
        });
}

export const handleBtnTranslation = throttle((node: any) => {
    let origin = node.innerText;
    let rs = cache.localGet(origin);
    if (rs) {
        node.innerText = rs;
        return;
    }

    config.count++ && storage.setItem('local:config', JSON.stringify(config));

    browser.runtime.sendMessage({ context: document.title, origin: origin })
        .then((text: string) => {
            cache.localSetDual(origin, text);
            node.innerText = text;
        }).catch((error: any) => console.error('调用失败:', error))
}, 250)


function bilingualAppendChild(node: any, text: string) {
    node.classList.add("fluent-read-bilingual");
    let newNode = document.createElement("span");
    newNode.classList.add("fluent-read-bilingual-content");
    // find the style
    const style = options.styles.find(s => s.value === config.style && !s.disabled);
    if (style?.class) {
        newNode.classList.add(style.class);
    }
    newNode.append(text);
    smashTruncationStyle(node);
    node.appendChild(newNode);
}