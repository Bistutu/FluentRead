// ==UserScript==
// @name         流畅阅读
// @license      GPL-3.0 license
// @namespace    https://fr.unmeta.cn/
// @version      0.6
// @description  基于上下文语境的人工智能翻译引擎，为部分网站提供精准翻译，让所有人都能够拥有基于母语般的阅读体验。程序Github开源：https://github.com/Bistutu/FluentRead，欢迎 star。
// @author       ThinkStu
// @match        *://*/*
// @icon         data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAMAAAD04JH5AAAAAXNSR0IB2cksfwAAAAlwSFlzAAALEwAACxMBAJqcGAAAAtlQTFRFAAAA/3ci/4Aq/wAA/24f/3Af/28g/28f/28e/28f/28f/3Ag/3Ma/24f/24g/3Af/28f/2sh/28e/28f/28f/20h/3Ag9oxQ/3Ag/20e/28g5cWx3OLi7amB/28f/28e/28f/3Ag/28f/24f/3Ec/28f/28d/28g/28f/3Yn/28f/3Af/28e/24d/28e/3Af/H0r8qdO7LZz58SY4tO9/3Ee/28e+4IvwIxMjnFKXVZJKztH+oY06ZdetkSprje00G6BrTW3oSHJy2eI7J1W6Jdc5ZJi4oxm3oZr4o5l6Zhb0nJ+qzG5x2COxFySwVeXv1OavE+eukqiuEantUKpsj2usDmyqzG7qC29pSjCpCXE7J1X3YNvz22DwleXtEGspiq/qi67t0am24Jv7JxYsTqxu0uh1np4pyy/pyrAzWqF76FUxl6QqS297qBUoyXE13p3vlGc4Ypo0XCAuEelpinAtUGrtUKrrTW2pSnCyWSKsjywuUmkvU+ewVWYyWKMzGiH1HV813t23IFw34dr55Ng6ppa76BUrjmyvlKcpCjC65tZ5pNg24By3YVt8aZP03N94otnqTC7qzO4u02gx1+QtkKpyWOMwFWZzmuFv1KbzmqFzWqGw1mVxFuTymSLyWONymWKu0ui1XZ676JS7p9V5ZBi4o1m4Ilp3oZsqC682n5zpSjBy2aJ3YRuxl2R5JBjpy295pNhuUeloyTE2X508aVQ76NT8KRQrja055Rf2Ht2vE2gxV2S449k03R8rDS3qjG5tEGr6JVfwliWxFmU6JZdt0Wn4Yto7Z5X3YRtsz+tsj6u445k8KNS7Z9WvlCe3IJv2Hx1uUmj2n9yyWKNvE6g13p2z2yE6Zlb1nd5x2CPpCbE76FTrzi0tkOpwVaX0XF/3INvv1Kc1HR91XZ739nT2+Hh2+Pj3OLi6rp+8adO+Ycy86dQ/Hsp8qdN+oIu/Xcm/HspehNLBAAAAPN0Uk5TAA8GATpyuvH7/7+AFGSyW7cfj/6uNrn/QCqx////lWX8IMh0CcNOiLwN7ilcYV57//////9vZ43/////cP/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////PgEC/wIDfQKC/wN/vi3GgxgAABTlJREFUeJzt2/lbFVUYB/CrmXWxfcPC277vA1SAmjpBhgghASWhllbSIpKKkJomCZEQFWW0SGmalYC2WGS7kWaL2Wqb7XtpaH9B931n7p0zyzlzYs6509Mz70933nOe8/046x0ebyjErn79+rvMkFZ7DNhz4F57h0VW0qBB3PH77Luf0Ox4cRL2P0BOPCfhwIMOlpfPIRhwiMx4d8GhhxFzkwWVWTCYlX/4EfHwlCECKxIxAEkswJFS4jUDzy446mh9jvB4ECS77oJjjtWniP/3YyW7AY7T8yNy8oek6OvT8o8/QTIgdh7QToITY2eJrPzYQaABTooBJJ0CroCTw7IPgX4WUACnnBq/CfkDOM24WcnbBSzA6eEECFiAM8Jh+QQW4MywuSIRCQgW4Kywrc5WPFdqWjov4BwpgGilcQLOlQVQUtN9BiipfgOMo+AXQPEdkO43IM1vQCoH4LwAEAACQAAIAO6AjMwst8rMlAjIHMpTWfIAXPnOAiEAvh3wHwAM7SNgWAAIAAEgAASAAOAGyODM7+vT0BWgZPEBnL4TiQFwHYSsDId8UYC+VwAIAAHg/wAYfv6Ikb4CRqmqegEzJDvnwtEX5Y6RA8jNi+arY/MLLi4cV3RJcUnpqEsvG6+WFV4Og2PKJ0ycdIUaqysn508RDLjqapVS1yjK1AqH/rXXXS8ScAMtX52mVE53HqmoEgi4kQooVmZQx2aKA8ykZczKUSqNreqS2TW1Nxnbo8WdhHNm44pz5908v2DBLSMX1t26KLe+4TYcK69RG29fDMNN2uTmO4o0wDyBV4FSBis2O11hWCoBiFZLNTaMS9IzoAkXvJOW34DDREM7M+4SB7gb1mul7gDMu4fs3AudJeIAdbBeDRVQBcP3kZ026NwvDvAArPcgFfCQbXgpdNrFAR6G9R6hAnB4GdmZCJ3l4gCPwnorVj7WlFO/6vEnnsy2AHA4j+yshk6HMMCyTssdqMsMmAu9cqKxBmetFAVYa78HPmUCPA2tZ4hGLTSeNbY9AtbZAc+R+c9jqzu+/cJkbKwRBlhvy+9sIgEvQqvipZdfeRU3X3sd5xQpwgBTqonsig2Nb7T3mI5AS3zwzZaqjWO1j9M3iQNoj8O3Nq/KeVtxqoX2Q6SuW0TO8ApYAkuudQyHWu6Q/45phlfAOFiT/qV4vi3/XcuD0yvgPVi0w5obr1kwPN6IX7/COsMrYBosu4UKGAHDLVMLa7T8PPsMjwDrdW4t/LYCJ30XTqx9XzSgGS99av5WjMWPH2gXo2jAh7BqKRWwBYZX48fuUhR8JBiAr0UfUwGfwHCJ9rkHb9uLrS9oHgGfwqIbqQC8TW3TNyaoBEcUAF9MllIB+TBcENsqRkG7eYoJ4JzPAkyCJT+jAtD3eWzrC+27w5ciAa2w4gwqAC//uvhmh3YvNs0nAbT/4E8HaLcB0wPYVBtgeLOx/RXO7yTvxjogpW+ATbBeGTVfey1qIBrbsNO61RFA/YUDHYCvRY10wPbo8Hay8fU3KCBej3VAhH4GMM+Bb82rWes71fqs7sGHx/cOgCT6rwsYgOy2th/o+Up314/Wx1999GtRbaUNwPyFidg/03X/9DP58NIAvzB/X5KAvxP+yspPBOA3vwHM/AQA2EcgAQB2vnyAyw6QD3DJlw5w2wGyAb+75csGsO8B8gGuByBaMgF/cORLBfzJA9ghEbCTB/CXPEAvT34otEsagGsHhOxngSgA1xkANXi3FAB3vu0oCAH08u5/fScM27X771jt6PVcO/9dfILrHxqGWhuSTXKrAAAAAElFTkSuQmCC
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @connect      fr.unmeta.cn
// @connect      127.0.0.1
// @connect      www.iflyrec.com
// @connect      edge.microsoft.com
// @connect      api-edge.cognitive.microsofttranslator.com
// @run-at       document-end
// @downloadURL https://update.greasyfork.org/scripts/482986/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB.user.js
// @updateURL https://update.greasyfork.org/scripts/482986/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB.meta.js
// ==/UserScript==

// region 常量与变量

// URL 相关
const POST = "POST";
const url = new URL(location.href.split('?')[0]);
// cacheKey 与 时间
const checkKey = "fluent_read_check";
const microsoft_token = "microsoft_token";
let ctrlPressed = false;
let hoverTimer;
const expiringTime = 86400000 / 4;
// 服务请求地址
// const source = "http://127.0.0.1"
const source = "https://fr.unmeta.cn"
const read = "%s/read".replace("%s", source), preread = "%s/preread".replace("%s", source);
// 预编译正则表达式
const timeRegex = /^(a|an|\d+)\s+(minute|hour|day|month|year)(s)?\s+ago$/; // "2 days ago"
const paginationRegex = /^(\d+)\s*-\s*(\d+)\s+of\s+([\d,]+)$/; // "10 - 20 of 300"
const lastReleaseRegex = /Last Release on (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{1,2}),\s(\d{4})/; // "Last Release on Jul 4, 2022"
const dependencyRegex = /(Test|Provided|Compile) Dependencies \((\d+)\)/; // "Compile Dependencies (5)"
const rankRegex = /#(\d+) in\s*(.*)/; // "#3 in Algorithms"
const artifactsRegex = /^([\d,]+)\s+artifacts$/; // "1,024 artifacts"
const vulnerabilityRegex = /^(\d+)\s+vulnerabilit(y|ies)$/; // "3 vulnerabilities"
const repositoriesRegex = /Indexed (Repositories|Artifacts) \(([\d.]+)M?\)/; //  Indexed Repositories (100)
const packagesRegex = /([\d,]+) indexed packages/;  // 12,795,152 indexed packages
const joinedRegex = /Joined ((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec).*\s\d{1,2},?\s\d{4}$)/;  // Joined March 27, 2022
const moreRegex = /\+(\d+) more\.\.\./; // More 100
const commentsRegex = /(\d+)\sComments/;    // 数字 Comments
const gamesRegex = /(\d{1,3}(?:,\d{3})*)( games| Collections)/;
const combinedDateRegex = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec).*\s\d{1,2},?\s\d{4}$|^\d{1,2}\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec).*,?\s\d{4}$|^\d{1,2}\/\d{1,2}\/\d{4}$/i;
const emailRegex = /^Receive feedback emails \((.*)\)$/;
const verifyDomain = /To verify ownership of (.*), navigate to your DNS provider and add a TXT record with this value:/
const autoSavedRegex = /Auto-saved (\d{2}):(\d{2}):(\d{2})/;
// 特例适配
const maven = "mvnrepository.com";
const docker = "hub.docker.com";
const nexusmods = "www.nexusmods.com"
const openai = "openai.com"
const chatGPT = "chat.openai.com"
const coze = "www.coze.com"
// 文本类型
const textContent = 0
const placeholder = 1
const inputValue = 2
const ariaLabel = 3
// 适配器与剪枝、预处理 map
let adapterFnMap = new (Map);
let skipStringMap = new Map();
let preprocess = new Map();
// DOM 防抖，单位毫秒
let throttleObserveDOM = throttle(observeDOM, 3000);
// 剪枝 set
let pruneSet = new Set();
// 其余常量
const typeMap = {'Test': '测试', 'Provided': '提供', 'Compile': '编译'};

// endregion

(function () {
    'use strict';
    // 初始化
    init()
    // 检查是否需要拉取数据
    checkRun(function (shouldRun) {
        // 如果 host 包含在 preread 中，shouldRun 为 true，则开始解析 DOM 树并设置监听器
        if (shouldRun) {
            // 1、添加监听器，使用 MutationObserver 监听 DOM 变化
            const observer = new MutationObserver(function (mutations, obs) {
                mutations.forEach(mutation => {
                    if (isEmpty(mutation.target)) return;
                    // console.log("原先变更记录：", mutation.target);
                    // 如果不包含下面节点，则处理
                    if (!["img", "noscript"].includes(mutation.target.tagName.toLowerCase())) {
                        handleDOMUpdate(mutation.target);
                    }
                });
            });
            observer.observe(document.body, {childList: true, subtree: true});

            // 2、手动开启一次解析 DOM 树
            handleDOMUpdate(document.body);
        }
    });

    // 快捷键 F2，清空所有缓存
    document.addEventListener('keydown', function (event) {
        if (event.key === 'F2') {
            let listValues = GM_listValues();
            listValues.forEach(e => {
                GM_deleteValue(e)
            })
            console.log('Cache cleared!');
        }
    });

    document.addEventListener('keydown', event => {
        if (event.key === "Control") ctrlPressed = true;
    });

    document.addEventListener('keyup', event => {
        if (event.key === "Control") ctrlPressed = false
    });

    // 当浏览器或标签页失去焦点时，重置 ctrlPressed
    window.addEventListener('blur', () => ctrlPressed = false)

    // 增加鼠标监听事件
    document.body.addEventListener('mousemove', function (event) {
        if (event.target && !["body", "script", "img", "noscript"].includes(event.target.tagName.toLowerCase())) {
            // 只有当 ctrl 被按下时才开始计时
            if (!ctrlPressed) return

            clearTimeout(hoverTimer); // 清除之前的计时器
            hoverTimer = setTimeout(() => {
                // 若触发特殊节点，则从父节点开始向下查找
                if (["p", "th", "td"].includes(event.target.parentNode.tagName.toLowerCase())) {
                    process(event.target.parentNode, 0); // 从父节点开始，向下查找
                    return
                }
                process(event.target, 0); // 从当前元素开始，向下查找
            }, 50);

        }
    });
})();

// region read
// read：异步返回 callback，表示是否需要拉取数据
function checkRun(callback) {
    // 1、检查缓存
    let pageMapCache = GM_getValue(checkKey, false);
    if (pageMapCache) {
        pageMapCache[url.host] ? callback(true) : callback(false);
    }

    // 2、网络请求
    const lastRun = GM_getValue("lastRun", undefined);
    const now = new Date().getTime();

    if (isEmpty(lastRun) || now - lastRun > expiringTime) {
        console.log("开始更新 preread 缓存");
        GM_xmlhttpRequest({
            method: POST,
            url: preread,
            onload: function (response) {
                // pagesMap 是新获取的数据，pageMapCache 是从缓存中获取的旧数据
                let pagesMap = JSON.parse(response.responseText).Data;
                pagesMap[url.host] ? callback(true) : callback(false);
                // 将 fluent_read_check 设置为新的缓存
                GM_setValue(checkKey, pagesMap);
                // 检查 preread 名单判断是否需要更新对应 host 的 read 数据
                const listValues = GM_listValues();
                listValues.forEach(host => {
                    if (pageMapCache[host] !== pagesMap[host]) {
                        GM_deleteValue(host);
                        console.log("删除过期的缓存数据：", host);
                    }
                });
                GM_setValue("lastRun", now.toString()); // 请求成功后设置当前时间
            },
            onerror: (error) => console.error("请求失败: ", error)
        });
    }
}

// read：处理 DOM 更新
function handleDOMUpdate(node) {
    // 如果数据存在则直接解析，否则发起网络请求
    let cachedData = GM_getValue(url.host, undefined);
    cachedData ? parseDfs(node, cachedData) : throttleObserveDOM();
}

// read：监听器配置
function observeDOM() {
    GM_xmlhttpRequest({
        method: POST,
        url: read,
        data: JSON.stringify({page: url.origin}),   // 请求参数
        onload: function (response) {
            console.log("新的 read 请求：", url.host);

            let respMap = JSON.parse(response.responseText).Data;
            GM_setValue(url.host, respMap);
            parseDfs(document.body, respMap);
        },
        onerror: function (error) {
            console.error("请求失败: ", error);
        }
    });
}


// read：递归提取节点文本
function parseDfs(node, respMap) {
    if (isEmpty(node)) return;

    // console.log("当前节点：", node)
    switch (node.nodeType) {
        // 1、元素节点
        case Node.ELEMENT_NODE:
            // console.log("元素节点： ", node);
            // 根据 host 获取 skip 函数，判断是否需要跳过
            let skipFn = skipStringMap[url.host];
            if (skipFn && skipFn(node)) return;
            // todo 前置操作，暂未使用
            let preFn = preprocess[url.host];
            preFn ? preFn(node) : null;
            // aria 提示信息
            if (node.hasAttribute("aria-label")) processNode(node, ariaLabel, respMap);
            // 按钮与文本域节点
            if (["input", "button", "textarea"].includes(node.tagName.toLowerCase())) {
                if (node.placeholder) processNode(node, placeholder, respMap);
                if (node.value && (node.tagName.toLowerCase() === "button" || ["submit", "button"].includes(node.type))) processNode(node, inputValue, respMap);
            }
            break;
        // 2、文本节点
        case  Node.TEXT_NODE:
            let fn = adapterFnMap[url.host];    // 根据 host 获取 adapter 函数，判断是否需要特殊处理
            isEmpty(fn) ? processNode(node, textContent, respMap) : fn(node, respMap);
            return; // 文本节点无子节点，return
    }
    let child = node.firstChild;
    while (child) {
        parseDfs(child, respMap);
        child = child.nextSibling;
    }
}

function processNode(node, attr, respMap) {
    let text;
    switch (attr) {
        case textContent:
            text = node.textContent;
            break;
        case placeholder:
            text = node.placeholder;
            break;
        case inputValue:
            text = node.value;
            break;
        case ariaLabel:
            text = node.getAttribute('aria-label');
            break;
    }

    if (shouldPrune(text)) return;

    let formattedText = format(text);
    if (formattedText && NotChinese(formattedText)) {
        signature(url.host + formattedText).then(sign => respMap[sign] ? replaceText(attr, node, respMap[sign]) : null)
    }
}

// endregion

// region 通用函数
// 计算SHA-1散列，取最后20个字符
async function signature(text) {
    if (!text) return "";
    const hashBuffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.slice(-20);
}

// 防抖限流函数
function throttle(fn, interval) {
    let last = 0;   // 维护上次执行的时间
    return function () {
        const now = Date.now();
        // 根据当前时间和上次执行时间的差值判断是否频繁
        if (now - last >= interval) {
            last = now;
            fn();
        }
    };
}

// 判断是否为空元素
function isEmpty(node) {
    return node ? false : true;
}

// 验证并解析日期格式，如果格式不正确则返回false
function parseDateOrFalse(dateString) {
    // 正则表达式，用于检查常见的日期格式（如 YYYY-MM-DD）
    if (!combinedDateRegex.test(dateString)) return false;
    // 尝试解析日期，如果无效返回 false
    const date = new Date(dateString);
    return !isNaN(date.getTime()) ? date : false;
}

// 判断字符串是否不包含中文
function NotChinese(text) {
    return !/[\u4e00-\u9fa5]/.test(text);
}

// 判断是否应该剪枝
function shouldPrune(text) {
    let has = pruneSet.has(text);
    // if (has) console.log("已处理的节点，跳过：", text)
    return has;
}

// 文本格式化
function format(text) {
    return text.replace(/\u00A0/g, ' ').trim();
}

// 替换文本
function replaceText(type, node, value) {
    switch (type) {
        case textContent:
            node.textContent = value;
            break;
        case placeholder:
            node.placeholder = value;
            break;
        case inputValue:
            node.value = value;
            break;
        case ariaLabel:
            node.setAttribute('aria-label', value);
            break;
    }
    pruneSet.add(value)    // 剪枝
}

function init() {
    ctrlPressed = false;
    // 填充适配器 map
    adapterFnMap[maven] = procMaven
    adapterFnMap[docker] = procDockerhub
    adapterFnMap[nexusmods] = procNexusmods
    adapterFnMap[openai] = procOpenai
    adapterFnMap[chatGPT] = procChatGPT
    adapterFnMap[coze] = procCoze
    // 填充 skip map
    skipStringMap[openai] = function (node) {
        return node.hasAttribute("data-message-author-role") || node.hasAttribute("data-projection-id")
    }
    skipStringMap[nexusmods] = function (node) {
        return node.classList.contains("desc") || node.classList.contains("material-icons") || node.classList.contains("material-icons-outlined")
    }
    skipStringMap[coze] = function (node) {
        return node.classList.contains("auto-hide-last-sibling-br")
            || node.classList.contains("jwzzTyL0ME4eVCKuxpDL")
            || node.classList.contains("XnSvnXQFZ4QHrFiqJPSG")
            || node.classList.contains("NcsIaDLOKk0l8CjedpJc")
            || ["code"].includes(node.tagName.toLowerCase())
    }
    // 预处理
    preprocess[maven] = function (node) {
        return false
    }
    preprocess[docker] = function (node) {
        return false
    }

    // 插入CSS：转圈动画
    const style = document.createElement('style');
    style.innerHTML = `
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
    .loading-spinner-fluentread {
        border: 2px solid #f3f3f3;
        border-top: 2px solid blue;
        border-radius: 50%;
        width: 12px;
        height: 12px;
        animation: spin 1s linear infinite;
        display: inline-block;
    }`;
    document.head.appendChild(style);
}

// endregion


// region 三方翻译

// feat: 微软翻译

// 返回有效的令牌或 false
function refreshToken(token) {
    const decodedToken = parseJwt(token);
    const currentTimestamp = Math.floor(Date.now() / 1000); // 当前时间的UNIX时间戳（秒）

    // 如果令牌有效且未过期，则立即返回true
    if (decodedToken && currentTimestamp < decodedToken.exp) {
        // console.log('令牌有效');
        return Promise.resolve(token);
    }

    // 如果令牌无效或已过期，则尝试获取新令牌
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'GET',
            url: "https://edge.microsoft.com/translate/auth",
            onload: function (response) {
                if (response.status === 200) {
                    let token = response.responseText;
                    GM_setValue('microsoft_token', token);
                    resolve(token);
                } else reject('请求 microsoft translation auth 失败: ' + response.status);
            },
            onerror: function (error) {
                console.error('请求 microsoft translation auth 发生错误: ', error);
                reject(error);
            }
        });
    });
}


// 解析 jwt，返回对象
function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

// 微软翻译接口
function microsoft_trans(origin, callback) {
    // 从 GM 缓存获取 token
    let jwtToken = GM_getValue('microsoft_token', undefined);
    refreshToken(jwtToken).then(rs => {
        // 失败，提前返回
        if (!rs) {
            callback(null);
            return;
        }
        GM_xmlhttpRequest({
            method: 'POST',
            url: "https://api-edge.cognitive.microsofttranslator.com/translate?from=&to=zh&api-version=3.0&includeSentenceLength=true",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + rs
            },
            data: JSON.stringify([{"Text": origin}]),
            onload: function (response) {
                if (response.status === 200) {
                    let resultJson = JSON.parse(response.responseText);
                    callback(resultJson[0].translations[0].text);
                } else {
                    console.log("调用微软翻译失败：", response.status);
                    callback(null);
                }
            },
            onerror: function (error) {
                console.log("调用微软翻译失败：", error);
                callback(null);
            }
        });
    });
}

let mySet = new Set();

function process(node, times) {
    if (times > 2) return; // 最多往下查找2层
    switch (node.nodeType) {
        case Node.ELEMENT_NODE:
            for (let child of node.childNodes) {
                if (mySet.has(child) || ["body", "script", "img", "noscript"].includes(node.tagName.toLowerCase())) continue;
                mySet.add(child);
                process(child, times + 1);
            }
            break;
        case Node.TEXT_NODE:
            if (!node.textContent || !NotChinese(node.textContent)) return; // 包含为空或中文则跳过

            // 创建转圈动画的元素
            let spinner = createLoadingSpinner();
            let textParent = node.parentNode;
            let textSibling = node.nextSibling;
            textParent.insertBefore(spinner, textSibling); // 插入动画元素

            microsoft_trans(node.textContent, text => {
                // 移除转圈动画元素
                textParent.removeChild(spinner);

                if (!text || node.textContent === text) return

                console.log("翻译结果：", text);
                node.textContent = text;    // 替换文本
            });
    }
}


// 这是创建转圈动画元素的函数
function createLoadingSpinner() {
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner-fluentread';
    return spinner;
}

// endregion

// region 文心一言

let access_token_wxyy = "";

function chatWXYY(origin, callback) {
    GM_xmlhttpRequest({
        method: "POST",
        url: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_pro?access_token=' + access_token_wxyy,
        headers: {"Content-Type": "application/json"},
        data: JSON.stringify({
            'messages': [{
                "role": "user",
                "content": "汉化，请你翻译：A minimal Docker image based on Alpine Linux with a complete package index and only 5 MB in size!"
            },]
        }),
        onload: function (response) {
            // 请求成功
            console.log("#>> onload", response.responseText);
            let res = JSON.parse(response.responseText);
            callback(res.result);
        },
        onerror: error => {
            console.log("#>> onerror", error)
            callback(null)
        }
    })
}

// 根据ak与sk获取文心一言 access_token TODO 理解 refresh_token 的使用
function getWxYYAccessToken(ak, sk) {
    GM_xmlhttpRequest({
        method: "POST",
        url: 'https://aip.baidubce.com/oauth/2.0/token',
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        data: 'grant_type=client_credentials&client_id=' + ak + '&client_secret=' + sk,
        onload: function (response) {
            let res = JSON.parse(response.responseText);
            if (res.access_token) access_token_wxyy = res.access_token;
        },
        onerror: error => console.log('Failed to refresh access token:', error)
    });
}

// endregion

// region 第三方特例

// 适配 coze
function procCoze(node, respMap) {
    let text = format(node.textContent);
    if (text && NotChinese(text)) {
        // "Auto-saved 21:28:58"
        let autoSavedMatch = text.match(autoSavedRegex);
        if (autoSavedMatch) {
            node.textContent = `自动保存于 ${autoSavedMatch[1]}:${autoSavedMatch[2]}:${autoSavedMatch[3]}`;
            return;
        }

        processNode(node, textContent, respMap);
    }
}

// 适配 nexusmods
function procNexusmods(node, respMap) {
    let text = format(node.textContent)
    if (text && NotChinese(text)) {
        // 使用正则表达式匹配 text
        let commentsMatch = text.match(commentsRegex);
        if (commentsMatch) {
            node.textContent = `${parseInt(commentsMatch[1], 10)} 条评论`;
            return;
        }
        // TODO 翻译待修正
        let gamesMatch = text.match(gamesRegex);
        if (gamesMatch) {
            let type = gamesMatch[2] === " games" ? "份游戏" : "个收藏";  // 判断是游戏还是收藏
            node.textContent = `${gamesMatch[1]}${type}`;
            return;
        }

        let dateOrFalse = parseDateOrFalse(text);
        if (dateOrFalse) {
            node.textContent = `${dateOrFalse.getFullYear()}-${String(dateOrFalse.getMonth() + 1).padStart(2, '0')}-${String(dateOrFalse.getDate()).padStart(2, '0')}`
        }

        processNode(node, textContent, respMap);
    }
}

function procOpenai(node, respMap) {
    let text = format(node.textContent);
    if (text && NotChinese(text)) {
        let dateOrFalse = parseDateOrFalse(text);
        if (dateOrFalse) {
            node.textContent = `${dateOrFalse.getFullYear()}-${dateOrFalse.getMonth() + 1}-${dateOrFalse.getDate()}`;
            return;
        }

        processNode(node, textContent, respMap);
    }
}

function procChatGPT(node, respMap) {
    let text = format(node.textContent);
    if (text && NotChinese(text)) {
        // 提取电子邮件地址
        let emailMatch = text.match(emailRegex);
        if (emailMatch) {
            node.textContent = `接收反馈邮件（${emailMatch[1]}）`;
            return;
        }
        // 验证域名
        let verifyDomainMatch = text.match(verifyDomain);
        if (verifyDomainMatch) {
            node.textContent = `要验证 ${verifyDomainMatch[1]} 的所有权，请转到您的DNS提供商并添加一个带有以下值的TXT记录：`;
            return;
        }
        // 处理日期格式
        let dateOrFalse = parseDateOrFalse(text);
        if (dateOrFalse) {
            node.textContent = `${dateOrFalse.getFullYear()}-${String(dateOrFalse.getMonth() + 1).padStart(2, '0')}-${String(dateOrFalse.getDate()).padStart(2, '0')}`;
            return;
        }

        processNode(node, textContent, respMap);
    }
}


// 适配 maven
function procMaven(node, respMap) {
    let text = format(node.textContent);
    if (text && NotChinese(text)) {
        // 处理 “Indexed Repositories (1936)” 与 “Indexed Artifacts (1.2M)” 的格式
        let repositoriesMatch = text.match(repositoriesRegex);
        if (repositoriesMatch) {
            let count = parseInt(repositoriesMatch[2], 10);
            node.textContent = repositoriesMatch[1] === "Repositories" ? `索引库数量（${count}）` : `索引包数量（${count * 100}万）`;
            return;
        }
        // 匹配并处理 "indexed packages" 的格式
        let packagesMatch = text.match(packagesRegex);
        if (packagesMatch) {
            let count = parseInt(packagesMatch[1].replace(/,/g, ''), 10);   // 移除数字中的逗号，然后转换为整数
            node.textContent = `${count.toLocaleString()}个索引包`;
            return;
        }
        // 处理“Last Release on”格式的日期
        let lastReleaseMatch = text.match(lastReleaseRegex);
        if (lastReleaseMatch) {
            let date = new Date(`${lastReleaseMatch[1]} ${lastReleaseMatch[2]}, ${lastReleaseMatch[3]}`);
            node.textContent = `最近更新 ${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
            return;
        }
        // 处理日期格式
        let dateOrFalse = parseDateOrFalse(text);
        if (dateOrFalse) {
            node.textContent = `${dateOrFalse.getFullYear()}-${String(dateOrFalse.getMonth() + 1).padStart(2, '0')}-${String(dateOrFalse.getDate()).padStart(2, '0')}`;
            return;
        }
        // 处理依赖类型
        let dependencyMatch = text.match(dependencyRegex);
        if (dependencyMatch) {
            let [_, type, count] = dependencyMatch;
            node.textContent = `${typeMap[type] || type}依赖 ${type} (${count})`;
            return;
        }
        // 处理排名
        let rankMatch = text.match(rankRegex);
        if (rankMatch) {
            node.textContent = `第 ${rankMatch[1]} 位 ${rankMatch[2]}`;
            return;
        }
        // 处理 artifacts 被引用次数
        let artifactsMatch = text.match(artifactsRegex);
        if (artifactsMatch) {
            node.textContent = `被引用 ${artifactsMatch[1]} 次`;
            return;
        }
        // 处理漏洞数量
        let vulnerabilityMatch = text.match(vulnerabilityRegex);
        if (vulnerabilityMatch) {
            node.textContent = `${vulnerabilityMatch[1]}个漏洞`;
            return;
        }

        processNode(node, textContent, respMap);
    }
}

function procDockerhub(node, respMap) {
    let text = format(node.textContent);
    if (text && NotChinese(text)) {
        // 处理更新时间的翻译
        let timeMatch = text.match(timeRegex);
        if (timeMatch) {
            let [_, quantity, unit, isPlural] = timeMatch;
            quantity = (quantity === 'a' || quantity === 'an') ? ' 1' : ` ${quantity}`; // 将 'a' 或 'an' 转换为 '1'
            const unitMap = {'minute': '分钟', 'hour': '小时', 'day': '天', 'month': '月',};  // 单位转换
            unit = unitMap[unit] || unit;
            node.textContent = `${quantity} ${unit}之前`;
            return;
        }
        // 处理分页信息的翻译
        let paginationMatch = text.match(paginationRegex);
        if (paginationMatch) {
            let [_, start, end, total] = paginationMatch;
            total = total.replace(/,/g, ''); // 去除数字中的逗号
            node.textContent = `当前第 ${start} - ${end} 项，共 ${total} `;
            return;
        }
        // 处理 "Joined March 27, 2022"
        let joinedMatch = text.match(joinedRegex);
        if (joinedMatch) {
            const date = new Date(joinedMatch[1]);
            node.textContent = `加入时间：${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            return;
        }
        // 处理 "+5 more..."
        let moreMatch = text.match(moreRegex);
        if (moreMatch) {
            node.textContent = `还有${parseInt(moreMatch[1], 10)}个更多...`;
            return;
        }

        processNode(node, textContent, respMap);
    }
}

// endregion

