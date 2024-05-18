import {checkConfig, hasClassName, skipNode} from "./check";
import {Config} from "../utils/model";
import {getMainDomain, replaceCompatFn, selectCompatFn} from "./compatible";
import {cache} from "../utils/cache";
import {detectlang} from "./detectlang";
import {services} from "../utils/option";
import {insertFailedTip, insertLoadingSpinner} from "./icon";
import {beautyHTML} from "./common";
import {throttle} from "@/entrypoints/utils/tip";

let hoverTimer: any; // 鼠标悬停计时器
let outerHTMLSet = new Set();   // 去重
const url = new URL(location.href.split('?')[0]);

// 当遇到这些 tag 时直接翻译
const directSet = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', "li"]);
// 当遇到这些节点时，不应当翻译
const skipSet = new Set(["html", "body",]); // "iframe" 暂时去除
// button兼容（避免按钮失去响应式点击事件）
const buttonCompatSet = new Set(['button', 'submit', 'reset', 'image', 'file']);

// 1、若某节点的兄弟节点中「只」包含下列节点，则应当翻译其父节点
// 2、llm 模式翻译时，翻译下列节点的 outerHTML 属性
const chileSet = new Set([
    'a', 'b', 'strong', 'span', 'img', 'br', 'em', 'u', 'small', 'sub', 'sup', 'i', 'font',
    'big', 'strike', 's', 'del', 'ins', 'mark', 'cite', 'q', 'abbr', 'acronym', 'dfn', 'svg',
    'code', 'samp', 'kbd', 'var', 'pre', 'address', 'time', 'ruby', 'rb', 'rt', 'rp', 'bdi', 'bdo', 'wbr',
    'details', 'summary', 'menuitem', 'menu', 'dialog', 'slot', 'template', 'shadow', 'content', 'element',
]);

export function handler(config: Config, mouseX: number, mouseY: number, time: number = 0) {

    // 检查配置项是否正确
    if (!checkConfig(config)) return;

    clearTimeout(hoverTimer); // 清除计时器
    hoverTimer = setTimeout(() => {
        // 获取起始节点
        let node = grabNode(config, document.elementFromPoint(mouseX, mouseY));  // 获取最终需要翻译的节点

        // console.log("翻译节点：", node);

        // 跳过不需要翻译的节点
        if (skipNode(node)) return;

        // TODO 2024.5.18
        // 我们需要一个新的 translate 函数，原先的耦合性太强了！先写一个吧，如果效果可以，则抽取出来
        // 判断是否为双语对照模式，如果是则走双语翻译
        if (config.style === 1) {
            let bilingualNode = hasClassName(node, 'fluent-read-bilingual');
            if (bilingualNode) {
                bilingualNode.remove(); // 移除 bilingualNode
                return;
            }
            bilingualTranslate(config, node)
            return;
        }

        // 去重判断
        let outerHTMLTemp = node.outerHTML;
        if (outerHTMLSet.has(outerHTMLTemp)) {
            // console.log('重复节点', node);
            return;
        }
        outerHTMLSet.add(outerHTMLTemp);

        // 检测缓存
        let outerHTMLCache = cache.get(config, node.outerHTML);
        if (outerHTMLCache) {
            // console.log("缓存命中：", outerHTMLCache);
            let spinner = insertLoadingSpinner(node, true);
            setTimeout(() => {  // 延迟 remove 转圈动画与替换文本
                spinner.remove();
                outerHTMLSet.delete(outerHTMLTemp);
                let compatFn = replaceCompatFn[getMainDomain(url.host)];    // 兼容函数
                if (compatFn) {
                    compatFn(node, outerHTMLCache);    // 兼容函数
                } else {
                    node.outerHTML = outerHTMLCache;
                }
                deferCacheRemoval(outerHTMLCache);
            }, 250);
            return;
        }
        // console.log("无缓存：", node.outerHTML);
        // 无缓存，正常翻译
        translate(config, node);
    }, time);
}

// todo 支持回译
function bilingualTranslate(config: Config, node: any) {
    console.log("翻译节点：", node)

    // 正则表达式去除所有空格后再检查语言类型
    if (detectlang(node.textContent.replace(/[\s\u3000]/g, '')) === config.to) return;

    // 待翻译文本
    let origin = node.innerText

    // 插入转圈动画
    let spinner = insertLoadingSpinner(node);
    let timeout = setTimeout(() => {
        insertFailedTip(config, node, "timeout", spinner);
    }, 45000);

    config.count++; // 翻译次数 +1
    storage.setItem('local:config', JSON.stringify(config));  // 更新配置

    // 调用翻译服务（正在翻译ing...），允许失败重试 3 次、间隔 500ms
    const translating = (failCount = 0) => {

        // 判断缓存
        let rs = cache.get(config, origin);
        if (rs) {
            clearTimeout(timeout) // 取消超时
            spinner.remove()      // 移除 spinner

            // 格式化 html 翻译结果
            rs = beautyHTML(rs)

            if (!rs || origin === rs) return;

            // 追加至原文后面
            let newNode = document.createElement("div");
            newNode.innerHTML = rs;
            newNode.classList.add("fluent-read-bilingual");
            node.appendChild(newNode);

            return;
        }

        browser.runtime.sendMessage({context: document.title, origin: origin})
            .then((text: string) => {
                clearTimeout(timeout) // 取消超时
                spinner.remove()      // 移除 spinner

                // 格式化 html 翻译结果
                text = beautyHTML(text)

                console.log("翻译前的句子：", origin);
                console.log("翻译后的句子：", text);

                if (!text || origin === text) return;

                // 追加至原文后面
                let newNode = document.createElement("div");
                newNode.innerHTML = text;
                newNode.classList.add("fluent-read-bilingual");
                node.appendChild(newNode);

                cache.bilingualSet(config, origin, text);

                // todo 缓存、回译（也就是删掉译文？）

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

// 按钮翻译节流
const btnTransThrottle = throttle(btnTrans, 250);

function btnTrans(config: Config, child: any) {
    if (services.isMachine(config.service)) {
        // 机器翻译 innerHTML
        let rs = cache.get(config, child.innerHTML);
        if (rs) {
            child.innerHTML = rs;
            return;
        }
        // background.ts
        browser.runtime.sendMessage({context: document.title, origin: child.innerHTML})
            .then((text: string) => {
                cache.set(config, child.innerHTML, text)
                child.innerHTML = text
            }).catch(error => console.error('调用失败:', error))
    } else {
        // LLM 翻译 textContent
        let rs = cache.get(config, child.textContent);
        if (rs) {
            child.textContent = rs;
            return;
        }
        // background.ts
        browser.runtime.sendMessage({context: document.title, origin: child.textContent})
            .then((text: string) => {
                cache.set(config, child.textContent, text)
                child.textContent = text
            }).catch(error => console.error('调用失败:', error))
    }
}

// 返回最终应该翻译的父节点或 false
function grabNode(config: Config, node: any): any {
    let curTag = node.tagName.toLowerCase();    // 当前 tag

    // 1、全局节点与空节点、input 节点、文字过多的节点、class="notranslate" 的节点不翻译
    if (!node || skipSet.has(curTag) || curTag === 'input' || node.classList.contains('notranslate')
        || node.textContent.length > 3072 || (node.outerHTML && node.outerHTML.length > 4096)) {

        return false;
    }

    // 2、普通适配，遇到这些标签则直接翻译节点
    if (directSet.has(curTag)) {
        return node;
    }

    // 3、button 按钮适配
    if (curTag === 'button' || (curTag === 'span' && node.parentNode && node.parentNode.tagName.toLowerCase() === 'button')) {
        // 翻译按钮内部而不是整个按钮，避免按钮失去响应式点击事件
        if (node.textContent.trim() !== '') btnTransThrottle(config, node)
        return false;
    }

    // 4、特殊适配，根据域名进行特殊处理
    let fn = selectCompatFn[getMainDomain(url.host)];
    if (fn && fn(node)) return node;

    // 4、如果遇到 span，则首先该节点就符合翻译条件
    if (curTag === "span" || node.nodeType === Node.TEXT_NODE || detectChildMeta(node)) {
        return grabNode(config, node.parentNode) || node;   // 递归向上寻找最后一个符合的父节点
    }

    // 5、如果节点是div并且不符合一般翻译条件，可翻译首行文本
    if (curTag === 'div' || curTag === 'label') {
        // 遍历子节点，寻找首个文本节点或 a 标签节点
        let child = node.firstChild;
        while (child) {
            if (child.nodeType === Node.TEXT_NODE && child.textContent.trim() !== '') {
                // background.ts
                browser.runtime.sendMessage({context: document.title, origin: child.textContent})
                    .then((text: string) => child.textContent = text)
                    .catch(error => console.error('调用失败:', error))

                return false; // 只翻译首行文本，不再进行后续步骤
            }
            child = child.nextSibling;
        }
    }

    // console.log('不翻译节点：', node);

    return false
}

export function translate(config: Config, node: any) {

    // console.log("翻译节点：", node)

    // 正则表达式去除所有空格后再检查语言类型
    // 如果源语言与目标语言相同，则不翻译
    if (detectlang(node.textContent.replace(/[\s\u3000]/g, '')) === config.to) return;

    // origin 是待翻译文本；机器翻译 origin = outerHTML；LLM 翻译 origin = llmGetText(node)
    let origin = services.isMachine(config.service) ? node.outerHTML : llmGetText(node);

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

                cache.set(config, oldOuterHtml, newOuterHtml);  // 设置缓存
                // 延迟删除 newOuterHtml，立即删除 oldOuterHtml
                deferCacheRemoval(newOuterHtml);
                outerHTMLSet.delete(oldOuterHtml);
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

// 检测子元素中是否包含指定标签以外的元素
function detectChildMeta(parent: any): boolean {
    let child = parent.firstChild;
    while (child) {
        if (child.nodeType === Node.ELEMENT_NODE && !chileSet.has(child.nodeName.toLowerCase())) {
            return false;
        }
        child = child.nextSibling;
    }
    return true;
}

// 延迟删除缓存，避免短时间内重复翻译
function deferCacheRemoval(key: any, time = 250) {
    outerHTMLSet.add(key);
    setTimeout(() => {
        outerHTMLSet.delete(key);
    }, time);
}

// LLM 模式获取翻译文本
function llmGetText(node: any) {
    let text = "";
    // 遍历所有子节点
    node.childNodes.forEach((child: any) => {
        if (child.nodeType === Node.TEXT_NODE) {
            text += child.nodeValue;    // 文本节点，直接添加至 text
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            // 检查是否为特定节点
            if (chileSet.has(child.tagName.toLowerCase())) {
                text += child.outerHTML;
            } else {
                text += llmGetText(child); // 递归
            }
        }
    });
    return text;
}
