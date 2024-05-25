import {checkConfig, hasClassName, skipNode} from "./check";
import {Config} from "../utils/model";
import {getMainDomain, replaceCompatFn} from "./compatible";
import {cache} from "../utils/cache";
import {detectlang} from "./detectlang";
import {options, services} from "../utils/option";
import {insertFailedTip, insertLoadingSpinner} from "./icon";
import {beautyHTML} from "./common";
import {throttle} from "@/entrypoints/utils/tip";
import {styles} from "@/entrypoints/utils/constant";
import {smashTruncationStyle} from "@/entrypoints/main/css";
import {grabNode, LLMStandardHTML} from "@/entrypoints/main/dom";

// todo 需重构、分离

let hoverTimer: any; // 鼠标悬停计时器
let htmlSet = new Set();   // 去重
const url = new URL(location.href.split('?')[0]);

export function handler(config: Config, mouseX: number, mouseY: number, time: number = 0, slide = false) {

    // 检查配置项是否正确
    if (!checkConfig(config)) return;

    clearTimeout(hoverTimer); // 清除计时器
    hoverTimer = setTimeout(() => {
        // 获取起始节点
        let node = grabNode(config, document.elementFromPoint(mouseX, mouseY));  // 获取最终需要翻译的节点

        // console.log("翻译节点：", node);

        // 跳过不需要翻译的节点
        if (skipNode(node)) return;

        // 去重判断
        let nodeOuterHTML = node.outerHTML;
        if (htmlSet.has(nodeOuterHTML)) {
            // console.log('重复节点', node);
            return;
        }
        htmlSet.add(nodeOuterHTML);

        // TODO 2024.5.18 下述代码需重构
        // 判断是否为双语对照模式，如果是则走双语翻译
        if (config.style === styles.bilingualComparison) {
            // 如果已经翻译过，则移除译文
            let bilingualNode = hasClassName(node, 'fluent-bilingual-tag');
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
            // 判断缓存
            let cached = cache.localGet(config, node.innerText);
            if (cached) {
                let spinner = insertLoadingSpinner(node, true);
                if (!cached || origin === cached) {
                    htmlSet.delete(nodeOuterHTML);
                    return;
                }
                // 250 ms 后移除 spinner
                setTimeout(() => {
                    spinner.remove();
                    htmlSet.delete(nodeOuterHTML);
                    bilingualAppendChild(config, node, cached);  // 追加至原文后面
                }, 250);

                return;
            }

            bilingualTranslate(config, node, nodeOuterHTML)
            return;
        }

        // else 为仅译文模式

        // 检测缓存
        let outerHTMLCache = cache.localGet(config, node.outerHTML);
        if (outerHTMLCache) {
            if (slide) {
                htmlSet.delete(nodeOuterHTML);
                return;
            }
            // console.log("缓存命中：", outerHTMLCache);
            let spinner = insertLoadingSpinner(node, true);
            setTimeout(() => {  // 延迟 remove 转圈动画与替换文本
                spinner.remove();
                htmlSet.delete(nodeOuterHTML);
                let compatFn = replaceCompatFn[getMainDomain(url.host)];    // 兼容函数
                if (compatFn) {
                    compatFn(node, outerHTMLCache);    // 兼容函数
                } else {
                    node.outerHTML = outerHTMLCache;
                }
                cache.set(htmlSet, outerHTMLCache, 250);
            }, 250);
            return;
        }
        // console.log("无缓存：", node.outerHTML);
        // 无缓存，正常翻译
        translate(config, node);
    }, time);
}

// 双语模式追加翻译结果+控制样式
function bilingualAppendChild(config: Config, node: any, text: string) {

    let newNode = document.createElement("span");

    newNode.classList.add("fluent-bilingual-style", "fluent-bilingual-tag")  // 样式、标记
    newNode.classList.add(options.styles[config.display].class);   // 控制译文显示样式

    newNode.innerHTML = text;

    // 移除特定样式，这些样式会影响翻译结果的显示
    smashTruncationStyle(node);

    node.appendChild(newNode);
}


// 按钮翻译节流
export const btnTransThrottle = throttle(btnTrans, 250);

function btnTrans(config: Config, child: any) {
    if (services.isMachine(config.service)) {
        // 机器翻译 innerHTML
        let rs = cache.localGet(config, child.innerHTML);
        if (rs) {
            child.innerHTML = rs;
            return;
        }
        // background.ts
        browser.runtime.sendMessage({context: document.title, origin: child.innerHTML})
            .then((text: string) => {
                cache.localSetDual(config, child.innerHTML, text)
                child.innerHTML = text
            }).catch(error => console.error('调用失败:', error))
    } else {
        // LLM 翻译 textContent
        let rs = cache.localGet(config, child.textContent);
        if (rs) {
            child.textContent = rs;
            return;
        }
        // background.ts
        browser.runtime.sendMessage({context: document.title, origin: child.textContent})
            .then((text: string) => {
                cache.localSetDual(config, child.textContent, text)
                child.textContent = text
            }).catch(error => console.error('调用失败:', error))
    }
}


function bilingualTranslate(config: Config, node: any, nodeOuterHTML: any) {
    // 正则表达式去除所有空格后再检查语言类型
    if (detectlang(node.textContent.replace(/[\s\u3000]/g, '')) === config.to) return;
    // 待翻译文本
    let origin = node.innerText
    // 插入转圈动画
    let spinner = insertLoadingSpinner(node);
    // 超时控制
    let timeout = setTimeout(() => {
        insertFailedTip(config, node, "timeout", spinner);
    }, 45000);

    // 调用翻译服务（正在翻译ing...），允许失败重试 3 次、间隔 500ms
    const translating = (failCount = 0) => {

        config.count++ && storage.setItem('local:config', JSON.stringify(config));  // 翻译次数 +1，更新配置

        browser.runtime.sendMessage({context: document.title, origin: origin})
            .then((text: string) => {
                clearTimeout(timeout) // 取消超时
                spinner.remove()      // 移除 spinner
                setTimeout(() => {
                    bilingualAppendChild(config, node, text);
                    htmlSet.delete(nodeOuterHTML);
                }, 150);

                // 相同也不应该隐藏，否则可能会造成用户误解
                // if (!text || origin === text) return;

                cache.localSet(config, origin, text);
            })
            .catch(error => {
                clearTimeout(timeout);
                if (failCount < 3) { // 如果失败次数小于3次，重新尝试
                    // 延迟 500ms 后重试
                    setTimeout(() => {
                        translating(failCount + 1);
                    }, 500);
                } else { // 达到3次失败后，显示失败提示
                    insertFailedTip(config, node, error.toString() || "", spinner);
                }
            });
    }

    translating();   // 开始翻译
}

export function translate(config: Config, node: any) {

    // console.log("翻译节点：", node)

    // 正则表达式去除所有空格后再检查语言类型
    // 如果源语言与目标语言相同，则不翻译
    if (detectlang(node.textContent.replace(/[\s\u3000]/g, '')) === config.to) return;

    // origin 是待翻译文本；机器翻译 origin = outerHTML；LLM 翻译 origin = llmGetText(node)
    let origin = services.isMachine(config.service) ? node.outerHTML : LLMStandardHTML(node);

    let spinner = insertLoadingSpinner(node);   // 插入转圈动画
    let timeout = setTimeout(() => {
        insertFailedTip(config, node, "timeout", spinner);
    }, 45000);

    config.count++; // 翻译次数 +1
    storage.setItem('local:config', JSON.stringify(config));  // 更新配置

    // 调用翻译服务（正在翻译ing...），允许失败重试 3 次、间隔 500ms
    const translating = (failCount = 0) => {
        browser.runtime.sendMessage({context: document.title, origin: origin})
            .then((text: string) => {
                clearTimeout(timeout) // 取消超时
                spinner.remove()      // 移除 spinner

                // 格式化 html 翻译结果
                text = beautyHTML(text)

                // console.log("翻译前的句子：", origin);
                // console.log("翻译后的句子：", text);

                if (!text || origin === text) return;

                let oldOuterHtml = node.outerHTML  // 保存旧的 outerHTML

                let newOuterHtml = text
                if (services.isMachine(config.service)) {
                    // 1、机器翻译
                    if (!node.parentNode) return;
                    let compatFn = replaceCompatFn[getMainDomain(url.host)];
                    if (compatFn) {
                        oldOuterHtml = node.outerHTML;
                        compatFn(node, text);
                        newOuterHtml = node.outerHTML;
                    } else {
                        node.outerHTML = text;
                    }
                } else {
                    // 2、LLM 翻译
                    node.innerHTML = text;
                    newOuterHtml = node.outerHTML;
                }

                cache.localSetDual(config, oldOuterHtml, newOuterHtml);  // 设置缓存
                // 延迟删除 newOuterHtml，立即删除 oldOuterHtml
                cache.set(htmlSet, newOuterHtml, 250);
                htmlSet.delete(oldOuterHtml);
            })
            .catch(error => {
                clearTimeout(timeout);
                if (failCount < 3) { // 如果失败次数小于3次，重新尝试
                    // 延迟 500ms 后重试
                    setTimeout(() => {
                        translating(failCount + 1);
                    }, 500);
                } else { // 达到3次失败后，显示失败提示
                    insertFailedTip(config, node, error.toString() || "", spinner);
                }
            });
    }

    translating();   // 开始翻译
}

