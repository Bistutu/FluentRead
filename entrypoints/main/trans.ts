import { checkConfig, searchClassName, skipNode } from "../utils/check";
import { cache } from "../utils/cache";
import { options, servicesType } from "../utils/option";
import { insertFailedTip, insertLoadingSpinner } from "../utils/icon";
import { styles } from "@/entrypoints/utils/constant";
import { beautyHTML, grabNode, grabAllNode, LLMStandardHTML, smashTruncationStyle } from "@/entrypoints/main/dom";
import { detectlang, throttle } from "@/entrypoints/utils/common";
import { getMainDomain, replaceCompatFn } from "@/entrypoints/main/compat";
import { config } from "@/entrypoints/utils/config";

let hoverTimer: any; // 鼠标悬停计时器
let htmlSet = new Set(); // 防抖

// 使用自定义属性标记已翻译的节点
const TRANSLATED_ATTR = 'data-fr-translated';

// 自动翻译整个页面的功能
export function autoTranslateEnglishPage() {
    // 获取当前页面的语言
    const text = document.documentElement.innerText || '';
    const cleanText = text.replace(/[\s\u3000]+/g, ' ').trim().slice(0, 500);

    const language = detectlang(cleanText);
    console.log('当前页面语言：', language);
    const to = config.to;
    if (to.includes(language)) {
        console.log('目标语言与当前页面语言相同，不进行翻译');
        return;
    }

    console.log('当前页面非目标语言，开始翻译');
    // 获取所有需要翻译的节点
    const nodes = grabAllNode(document.body);
    if (!nodes.length) return;

    // 创建观察器
    const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const node = entry.target as Element;

                // 去重
                if (node.hasAttribute(TRANSLATED_ATTR)) return;
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
        observer.observe(node);
    });

    // 创建 MutationObserver 监听 DOM 变化
    const mutationObserver = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) { // 元素节点
                    // 5. 只处理未翻译的新节点
                    const newNodes = grabAllNode(node as Element).filter(
                        n => !n.hasAttribute(TRANSLATED_ATTR)
                    );
                    newNodes.forEach(n => observer.observe(n));
                }
            });
        });
    });

    // 监听整个 body 的变化
    mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    // 清理函数同时断开两个 observer
    return () => {
        observer.disconnect();
        mutationObserver.disconnect();
    };
}

// 处理鼠标悬停翻译的主函数
// 添加可选参数 forcedService
export function handleTranslation(mouseX: number, mouseY: number, delayTime: number = 0, forcedService?: string) {
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
            handleBilingualTranslation(node, delayTime > 0, forcedService);  // 根据 delayTime 可判断是否为滑动翻译
        } else {
            handleSingleTranslation(node, delayTime > 0, forcedService);
        }
    }, delayTime);
}

// 双语翻译
export function handleBilingualTranslation(node: any, slide: boolean, forcedService?: string) {
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
    bilingualTranslate(node, nodeOuterHTML, forcedService);
}

// 单语翻译
export function handleSingleTranslation(node: any, slide: boolean, forcedService?: string) {
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

    singleTranslate(node, forcedService);
}


function bilingualTranslate(node: any, nodeOuterHTML: any, forcedService?: string) {
    if (detectlang(node.textContent.replace(/[\s\u3000]/g, '')) === config.to) return;

    let origin = node.textContent;
    let spinner = insertLoadingSpinner(node);
    let timeout = setTimeout(() => {
        insertFailedTip(node, "timeout", spinner);
    }, 45000);

    config.count++ && storage.setItem('local:config', JSON.stringify(config));

    // 正在翻译...允许失败重试 3 次
    const translating = (failCount = 0) => {
        browser.runtime.sendMessage({ 
            context: document.title, 
            origin: origin,
            service: forcedService // 添加service参数
        })
            .then((text: string) => {
                clearTimeout(timeout);
                spinner.remove();
                htmlSet.delete(nodeOuterHTML);
                bilingualAppendChild(node, text);
                cache.localSet(origin, text);
            })
            .catch((error: { toString: () => any; }) => {
                clearTimeout(timeout);
                if (failCount < 3) {
                    setTimeout(() => {
                        translating(failCount + 1);
                    }, 1000);
                } else {
                    insertFailedTip(node, error.toString() || "", spinner);
                }
            });
    }

    translating();
}


export function singleTranslate(node: any, forcedService?: string) {
    if (detectlang(node.textContent.replace(/[\s\u3000]/g, '')) === config.to) return;

    let origin = servicesType.isMachine(forcedService || config.service) ? node.innerHTML : LLMStandardHTML(node);

    let spinner = insertLoadingSpinner(node);
    let timeout = setTimeout(() => {
        insertFailedTip(node, "timeout", spinner);
    }, 45000);

    config.count++ && storage.setItem('local:config', JSON.stringify(config));

    // 正在翻译...允许失败重试 3 次
    const translating = (failCount = 0) => {
        browser.runtime.sendMessage({ 
            context: document.title, 
            origin: origin,
            service: forcedService // 添加service参数
        })
            .then((text: string) => {
                clearTimeout(timeout);
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
            .catch((error: { toString: () => any; }) => {
                clearTimeout(timeout);
                if (failCount < 3) {
                    setTimeout(() => {
                        translating(failCount + 1);
                    }, 1000);
                } else {
                    insertFailedTip(node, error.toString() || "", spinner);
                }
            });
    }
    translating();
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