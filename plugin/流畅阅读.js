// ==UserScript==
// @name         流畅阅读
// @namespace    https://fr.unmeta.cn/
// @version      0.1
// @description  基于上下文语境的人工智能翻译引擎，为部分网站提供精准翻译，让所有人都能够拥有基于母语般的阅读体验
// @author       ThinkStu
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      fr.unmeta.cn
// @connect      127.0.0.1
// @run-at       document-start
// ==/UserScript==


// URL 相关
const METHOD = "POST";
let url = new URL(window.location.href.split('?')[0]);

// cacheKey
const checkKey = "fluent_read_check";
const pageKey = "page:%s";

// 时间
// const expiringTime = 86400000; // 24小时
const expiringTime = 10000; // 10秒
const debouncedTime = 200; // 200毫秒

// 服务端地址
// const readLink = "https://fr.unmeta.cn/read";
// const preReadLink = "https://fr.unmeta.cn/preread";
const readLink = "http://127.0.0.1:80/read";
const preReadLink = "http://127.0.0.1:80/preread";

// 防抖包装观察函数
const debouncedObserveDOM = debounce(observeDOM, debouncedTime);

(function () {
    'use strict';

    // 初始化，判断是否需要清空缓存
    clearCacheIfNeeded()

    // 检查是否需要拉取数据
    checkNeedToRun(function (shouldRun) {
        if (shouldRun) {
            // 添加监听器：使用MutationObserver监听DOM变化，并配置和启动观察器
            const observer = new MutationObserver(function (mutations, obs) {
                mutations.forEach(mutation => {
                    // TODO deleted
                    // console.log("变更记录: ", mutation.target);

                    // 处理每个变更记录（包含 body）
                    if (["div", "button", "svg", "span", "nav", "body"].includes(mutation.target.tagName.toLowerCase())) {
                        handleDOMUpdate(mutation.target);
                    }
                });
            });
            observer.observe(document, {childList: true, subtree: true});

            // handleDOMUpdate(document.body);
            handleDOMUpdate(document.body);
        }
    });
})();

// 异步返回 callback，表示是否需要拉取数据
function checkNeedToRun(callback) {
    // 1、检查缓存
    let data = GM_getValue(checkKey, undefined);
    if (data !== undefined && data !== null) {
        data.includes(url.host) ? callback(true) : callback(false);
        return;
    }

    // 2、网络请求
    GM_xmlhttpRequest({
        method: METHOD,
        url: preReadLink,
        onload: function (response) {
            let data = JSON.parse(response.responseText).Data;
            // 设置缓存
            GM_setValue(checkKey, data);

            data !== null && data.includes(url.host) ? callback(true) : callback(false);
        },
        onerror: function (error) {
            console.error("请求失败: ", error);
            callback(false);
        }
    });
}


// 初始化函数
function clearCacheIfNeeded() {

    let lastRun = GM_getValue("lastRun");
    let now = new Date().getTime();

    if (lastRun === null || lastRun === undefined || now - lastRun > expiringTime) {

        console.log("清空所有缓存");

        // 清除所有通过 GM_setValue 存储的数据
        const values = GM_listValues();
        for (let i = 0; i < values.length; i++) {
            GM_deleteValue(values[i]);
        }

        GM_setValue("lastRun", now.toString());
    }
}

// 处理 DOM 更新
function handleDOMUpdate(node) {
    let cached = getPageCached();
    if (cached !== null && cached !== undefined) {
        parseDfs(node, cached);
    } else {
        debouncedObserveDOM();
    }
}

// 监听器配置
function observeDOM() {
    sendRequest(function (respMap) {
        parseDfs(document.body, respMap);
    });
}

function getPageCached() {
    const cachedData = GM_getValue(pageKey.replace("%s", url.host), undefined);
    if (cachedData !== undefined && cachedData !== null) {
        return cachedData;
    }
    return null;
}


// 发送请求获取 host 对应的翻译数据
function sendRequest(callback) {

    let param = {
        page: url.origin, TargetType: 1, HashList: []
    };

    GM_xmlhttpRequest({
        method: METHOD,
        url: readLink,
        data: JSON.stringify(param),
        onload: function (response) {
            if (callback) {
                let parse = JSON.parse(response.responseText);
                GM_setValue(pageKey.replace("%s", url.host), parse.Data);
                callback(parse.Data);
            }
        },
        onerror: function (error) {
            console.error("请求失败: ", error);
        }
    });
}


// 递归提取节点的文本内容
function parseDfs(node, respMap) {
    // 检查node是否为null
    if (node === null || node === undefined) {
        return;
    }

    switch (true) {
        // 元素节点
        case node.nodeType === Node.ELEMENT_NODE:
            // console.log("元素节点》 ", node);
            if (["head","path", "script", "style", "img", "noscript"].includes(node.tagName.toLowerCase())
                // 适配 OpenAI
                || node.hasAttribute("data-message-author-role")
            ) {
                return;
                // console.log("忽略节点: ", node);
            }
            if (["input", "button", "textarea"].includes(node.tagName.toLowerCase())) {
                processInput(node, respMap);
            }
            break;
        // 文本节点
        case node.nodeType === Node.TEXT_NODE:
            // console.log("文本节点》 ", node);
            processTextNode(node, respMap);
            break;
    }

    // 递归处理子节点
    let child = node.firstChild;
    while (child) {
        parseDfs(child, respMap);
        child = child.nextSibling;
    }
}

// 处理 input placeholder
function processInput(node, respMap) {
    if (node.placeholder) {
        let placeholder = node.placeholder.replace(/\u00A0/g, ' ').trim();
        if (placeholder.length > 0 && isNonChinese(placeholder)) {

            signature(url.host + placeholder).then((value) => {
                // 在这里添加一个检查以确保 respMap 是有效的
                if (respMap && respMap[value] !== undefined && respMap[value] !== "") {
                    node.placeholder = respMap[value];
                }
            }).catch((error) => {
                // 处理任何可能的错误
                console.error("Error in signature promise: ", error);
            });
        }
    }
    if (node.value) {
        let value = node.value.replace(/\u00A0/g, ' ').trim();
        if (value.length > 0 && isNonChinese(value)) {
            signature(url.host + value).then((value) => {
                // 在这里添加一个检查以确保 respMap 是有效的
                if (respMap && respMap[value] !== undefined && respMap[value] !== "") {
                    node.value = respMap[value];
                }
            }).catch((error) => {
                // 处理任何可能的错误
                console.error("Error in signature promise: ", error);
            });
        }
    }
}

// 处理文本内容
function processTextNode(node, respMap) {
    let text = node.textContent.replace(/\u00A0/g, ' ').trim();

    if (text.length > 0 && isNonChinese(text)) {
        // 执行相关操作，例如打印
        // console.log(text);
        signature(url.host + text).then((value) => {
            // 在这里添加一个检查以确保 respMap 是有效的
            if (respMap && respMap[value] !== undefined && respMap[value] !== "") {
                node.textContent = respMap[value];
            }
        }).catch((error) => {
            // 处理任何可能的错误
            console.error("Error in signature promise: ", error);
        });
    }
}

// 防抖函数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

// 判断字符串是否不包含中文
function isNonChinese(text) {
    return !/[\u4e00-\u9fa5]/.test(text);
}

// 计算SHA-1散列，取最后20个字符
async function signature(text) {
    if (text === "") {
        return "";
    }
    const hashBuffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.slice(-20);
}