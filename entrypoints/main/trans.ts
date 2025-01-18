import {checkConfig, searchClassName, skipNode} from "../utils/check";
import {cache} from "../utils/cache";
import {options, servicesType} from "../utils/option";
import {insertFailedTip, insertLoadingSpinner} from "../utils/icon";
import {styles} from "@/entrypoints/utils/constant";
import {beautyHTML, grabNode, LLMStandardHTML, smashTruncationStyle} from "@/entrypoints/main/dom";
import {detectlang, throttle} from "@/entrypoints/utils/common";
import {getMainDomain, replaceCompatFn} from "@/entrypoints/main/compat";
import {config} from "@/entrypoints/utils/config";

let hoverTimer: any; // 鼠标悬停计时器
let htmlSet = new Set(); // 防抖

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

        // 翻译服务
        // console.log('翻译服务：', config.service)

        // 根据翻译模式进行翻译
        if (config.display === styles.bilingualTranslation) {
            handleBilingualTranslation(node, delayTime > 0);  // 根据 delayTime 可判断是否为滑动翻译
        } else {
            handleSingleTranslation(node, delayTime > 0);
        }
    }, delayTime);
}

// 双语翻译
function handleBilingualTranslation(node: any, slide: boolean) {
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

function handleSingleTranslation(node: any, slide: boolean) {
    let nodeOuterHTML = node.outerHTML;
    let outerHTMLCache = cache.localGet(node.outerHTML);
    if (outerHTMLCache) {
        if (slide) {
            htmlSet.delete(nodeOuterHTML);
            return;
        }
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
    let timeout = setTimeout(() => {
        insertFailedTip(node, "timeout", spinner);
    }, 45000);

    config.count++ && storage.setItem('local:config', JSON.stringify(config));

    // 正在翻译...允许失败重试 3 次
    const translating = (failCount = 0) => {
        browser.runtime.sendMessage({context: document.title, origin: origin})
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

export function singleTranslate(node: any) {
    if (detectlang(node.textContent.replace(/[\s\u3000]/g, '')) === config.to) return;

    let origin = servicesType.isMachine(config.service) ? node.innerHTML : LLMStandardHTML(node);

    let spinner = insertLoadingSpinner(node);
    let timeout = setTimeout(() => {
        insertFailedTip(node, "timeout", spinner);
    }, 45000);

    config.count++ && storage.setItem('local:config', JSON.stringify(config));

    // 正在翻译...允许失败重试 3 次
    const translating = (failCount = 0) => {
        browser.runtime.sendMessage({context: document.title, origin: origin})
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

    browser.runtime.sendMessage({context: document.title, origin: origin})
        .then((text: string) => {
            cache.localSetDual(origin, text);
            node.innerText = text;
        }).catch((error: any) => console.error('调用失败:', error))
}, 250)


function bilingualAppendChild(node: any, text: string) {
    node.classList.add("fluent-read-bilingual");
    let newNode = document.createElement("span");
    newNode.classList.add("fluent-read-bilingual-content");
    newNode.classList.add(options.styles[config.style].class);
    newNode.innerHTML = text;
    smashTruncationStyle(node);
    node.appendChild(newNode);
}