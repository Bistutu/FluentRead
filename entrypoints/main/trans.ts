import {checkConfig, hasClassName, skipNode} from "../utils/check";
import {Config} from "../utils/model";
import {cache} from "../utils/cache";
import {options, services, servicesType} from "../utils/option";
import {insertFailedTip, insertLoadingSpinner} from "../utils/icon";
import {styles} from "@/entrypoints/utils/constant";
import {beautyHTML, grabNode, LLMStandardHTML, smashTruncationStyle} from "@/entrypoints/main/dom";
import {detectlang, throttle} from "@/entrypoints/utils/common";
import {getElementDetails} from "@/entrypoints/utils/test";

let hoverTimer: any; // 鼠标悬停计时器
let htmlSet = new Set(); // 防抖
const url = new URL(location.href.split('?')[0]);

export function handleTranslation(config: Config, mouseX: number, mouseY: number, delayTime: number = 0) {
    // 检查配置
    if (!checkConfig(config)) return;

    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {

        let node = grabNode(config, document.elementFromPoint(mouseX, mouseY));

        // 判断是否跳过节点
        if (skipNode(node)) return;

        // 防抖
        let nodeOuterHTML = node.outerHTML;
        if (htmlSet.has(nodeOuterHTML)) return;
        htmlSet.add(nodeOuterHTML);

        // 根据翻译模式进行翻译
        if (config.style === styles.bilingualTranslation) {
            handleBilingualTranslation(config, node, delayTime > 0);  // 根据 delayTime 可判断是否为滑动翻译
        } else {
            handleSingleTranslation(config, node, delayTime > 0);
        }
    }, delayTime);
}

// 双语翻译
function handleBilingualTranslation(config: Config, node: any, slide: boolean) {
    let nodeOuterHTML = node.outerHTML;
    // 如果已经翻译过，250ms 后删除翻译结果
    let bilingualNode = hasClassName(node, 'fluent-read-bilingual');
    if (bilingualNode) {
        if (slide) {
            htmlSet.delete(nodeOuterHTML);
            return;
        }
        let spinner = insertLoadingSpinner(bilingualNode, true);
        setTimeout(() => {
            spinner.remove();
            bilingualNode.remove();
            htmlSet.delete(nodeOuterHTML);
        }, 250);
        return;
    }

    // 检查是否有缓存
    let cached = cache.localGet(config, node.innerText);
    if (cached) {
        let spinner = insertLoadingSpinner(node, true);
        setTimeout(() => {
            spinner.remove();
            htmlSet.delete(nodeOuterHTML);
            bilingualAppendChild(config, node, cached);
        }, 250);
        return;
    }

    // 翻译
    bilingualTranslate(config, node, nodeOuterHTML);
}

function handleSingleTranslation(config: Config, node: any, slide: boolean) {
    let nodeOuterHTML = node.outerHTML;
    let outerHTMLCache = cache.localGet(config, node.outerHTML);
    if (outerHTMLCache) {
        if (slide) {
            htmlSet.delete(nodeOuterHTML);
            return;
        }
        let spinner = insertLoadingSpinner(node, true);
        setTimeout(() => {
            spinner.remove();
            htmlSet.delete(nodeOuterHTML);

            // 创建临时节点 span，获取 outerHTMLCache innerHTML
            let tmpNode = document.createElement("span");
            tmpNode.innerHTML = outerHTMLCache;
            let elementNode = tmpNode.firstChild as HTMLElement;

            // 替换节点内容
            node.innerHTML = elementNode.innerHTML;

            cache.set(htmlSet, outerHTMLCache, 250);
        }, 250);
        return;
    }

    singleTranslate(config, node);
}

function bilingualTranslate(config: Config, node: any, nodeOuterHTML: any) {
    if (detectlang(node.textContent.replace(/[\s\u3000]/g, '')) === config.to) return;

    let origin = node.textContent;
    let spinner = insertLoadingSpinner(node);
    let timeout = setTimeout(() => {
        insertFailedTip(config, node, "timeout", spinner);
    }, 45000);

    config.count++ && storage.setItem('local:config', JSON.stringify(config));

    // 正在翻译...允许失败重试 3 次
    const translating = (failCount = 0) => {
        browser.runtime.sendMessage({context: document.title, origin: origin})
            .then((text: string) => {
                clearTimeout(timeout);
                spinner.remove();
                htmlSet.delete(nodeOuterHTML);
                bilingualAppendChild(config, node, text);
                cache.localSet(config, origin, text);
            })
            .catch(error => {
                clearTimeout(timeout);
                if (failCount < 3) {
                    setTimeout(() => {
                        translating(failCount + 1);
                    }, 1000);
                } else {
                    insertFailedTip(config, node, error.toString() || "", spinner);
                }
            });
    }

    translating();
}

export function singleTranslate(config: Config, node: any) {
    if (detectlang(node.textContent.replace(/[\s\u3000]/g, '')) === config.to) return;

    let origin = servicesType.isMachine(config.service) ? node.outerHTML : LLMStandardHTML(node);
    let spinner = insertLoadingSpinner(node);
    let timeout = setTimeout(() => {
        insertFailedTip(config, node, "timeout", spinner);
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
                cache.localSetDual(config, oldOuterHtml, newOuterHtml);
                cache.set(htmlSet, newOuterHtml, 250);
                htmlSet.delete(oldOuterHtml);
            })
            .catch(error => {
                clearTimeout(timeout);
                if (failCount < 3) {
                    setTimeout(() => {
                        translating(failCount + 1);
                    }, 1000);
                } else {
                    insertFailedTip(config, node, error.toString() || "", spinner);
                }
            });
    }
    translating();
}

export const handleBtnTranslation = throttle((config: Config, node: any) => {
    let origin = node.innerText;
    let rs = cache.localGet(config, origin);
    if (rs) {
        node.innerText = rs;
        return;
    }

    browser.runtime.sendMessage({context: document.title, origin: origin})
        .then((text: string) => {
            cache.localSetDual(config, origin, text);
            node.innerText = text;
        }).catch(error => console.error('调用失败:', error))
}, 250)


function bilingualAppendChild(config: Config, node: any, text: string) {
    let newNode = document.createElement("span");
    newNode.classList.add("fluent-read-bilingual");
    newNode.classList.add(options.styles[config.display].class);
    newNode.innerHTML = text;
    smashTruncationStyle(node);
    node.appendChild(newNode);
}