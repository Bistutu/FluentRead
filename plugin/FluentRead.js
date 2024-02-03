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
// @connect      aip.baidubce.com
// @connect      dashscope.aliyuncs.com
// @connect      open.bigmodel.cn
// @connect      translate.googleapis.com
// @connect      api.openai.com
// @run-at       document-end
// @downloadURL https://update.greasyfork.org/scripts/482986/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB.user.js
// @updateURL https://update.greasyfork.org/scripts/482986/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB.meta.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.0.0/crypto-js.min.js
// ==/UserScript==

// region 常量与变量

// URL 相关
const POST = "POST";
const url = new URL(location.href.split('?')[0]);
// cacheKey 与 时间
const checkKey = "fluent_read_check";
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
const openai_web = "openai.com"
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
// DOM 防抖，单位毫秒
let throttleObserveDOM = throttle(observeDOM, 3000);
// 剪枝 set
let pruneSet = new Set();
// 其余常量
const typeMap = {'Test': '测试', 'Provided': '提供', 'Compile': '编译'};
// 翻译模型
const transModel = {    // 翻译模型枚举
    // --- LLM翻译 ---
    openai: "openai",   // openai GPT
    yiyan: "yiyan", // 百度文心一言
    tongyi: "tongyi",   // 阿里通义千问
    zhipu: "zhipu", // 清华智谱
    // --- 机器翻译 ---
    microsoft: "microsoft",
    google: "google",
}
const transFnMap = new Map();   // 翻译函数 map
// token 管理器
const tokenManager = {
    // 检验键值并设置 token
    setToken: function (key, value) {
        transFnMap[key] ? GM_setValue("token_" + key, value) : null;
    },

    // 获取 token
    getToken: function (key) {
        return GM_getValue("token_" + key, null);
    }
};

// 鼠标悬停去重 set
let sentenceSet = new Set();

// endregion

(function () {
    'use strict';

    // 初始化
    init()
    // 检查是否需要拉取数据
    checkRun(function (shouldRun) {
        // 如果 host 包含在 preread 中，shouldRun 为 true，则开始解析 DOM 树并设置监听器
        if (!shouldRun) return

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
    });

    // 快捷键 F2，清空所有缓存
    document.addEventListener('keydown', function (event) {
        if (event.key === 'F2') {
            let listValues = GM_listValues();
            listValues.forEach(e => GM_deleteValue(e))
            console.log('Cache cleared!');
        }
    });

    // 快捷键+悬停翻译
    document.addEventListener('keydown', event => {
        if (event.key === "Control") ctrlPressed = true;
    });

    document.addEventListener('keyup', event => {
        if (event.key === "Control") ctrlPressed = false
    });
    // 当浏览器或标签页失去焦点时，重置 ctrlPressed
    window.addEventListener('blur', () => ctrlPressed = false)

    // 增加鼠标监听事件，悬停 50ms 后执行
    document.body.addEventListener('mousemove', event => {
        if (!ctrlPressed) return;   // 如果没有按下 ctrl 键，不执行

        clearTimeout(hoverTimer); // 清除计时器
        hoverTimer = setTimeout(() => {
            let hoveredElement = event.target;
            let textContent = '';

            // 去重判断
            if (sentenceSet.has(hoveredElement)) return;
            sentenceSet.add(hoveredElement);

            // 如果存在子节点
            if (hoveredElement.childNodes.length > 0) {
                // 遍历所有子节点
                hoveredElement.childNodes.forEach(node => {
                    if (node.nodeType === Node.TEXT_NODE) { // 如果是文本节点，添加其文本
                        console.log("文本节点：", node.textContent.trim());
                        textContent += node.textContent.trim() + ' ';
                    } else if (node.nodeType === Node.ELEMENT_NODE && node.innerText) {
                        console.log("元素节点：", node.innerText.trim());
                        // 如果是<code>元素，则保留<code>标签
                        if (node.tagName.toLowerCase() === "code") {
                            textContent += "`" + node.innerText.trim() + "`";
                        } else {
                            textContent += node.innerText.trim() + ' ';
                        }
                    }
                });
            } else {    // 如果没有子节点，直接获取元素的文本
                textContent = hoveredElement.textContent.trim();
            }

            // 检查换行符
            if (textContent && textContent.split("\n").length === 1) {
                console.log("开始翻译: ", textContent);
                translate(hoveredElement, textContent)
            }
        }, 50)
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

// 检测中文率
function calculateChineseRate(text) {
    let chineseCharCount = 0;
    let totalCharCount = text.length;
    for (let i = 0; i < text.length; i++) {
        if (text[i].match(/[\u4E00-\u9FFF]/)) {
            chineseCharCount++;
        }
    }
    return chineseCharCount / totalCharCount;
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
    // 翻译模型
    transFnMap[transModel.yiyan] = yiyan
    transFnMap[transModel.tongyi] = tongyi
    transFnMap[transModel.zhipu] = zhipu
    transFnMap[transModel.microsoft] = microsoft
    transFnMap[transModel.google] = google
    transFnMap[transModel.openai] = openai


    ctrlPressed = false;
    // 填充适配器 map
    adapterFnMap[maven] = procMaven
    adapterFnMap[docker] = procDockerhub
    adapterFnMap[nexusmods] = procNexusmods
    adapterFnMap[openai_web] = procOpenai
    adapterFnMap[chatGPT] = procChatGPT
    adapterFnMap[coze] = procCoze
    // 填充 skip map
    skipStringMap[openai_web] = function (node) {
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

// region 通用翻译处理模块
// 通用翻译程序，参数：节点、待翻译文本
function translate(node, origin) {

    // 检测中文率，如果中文率大于 50% 则不翻译
    if (calculateChineseRate(origin) > 0.5) return;

    let spinner = createLoadingSpinner(node);  // 创建转圈动画并插入

    // todo 从 GM 中取出定义的翻译源（文心一言等配置也需存储在 GM）

    // 调用翻译模型
    transFnMap[transModel.zhipu](origin, text => {
        node.removeChild(spinner);    // 移除转圈动画
        if (!text || origin === text) return;
        // 匹配代码格式文本，替换为 <code>
        const regex = /`(.*?)`/g;
        text = text.replace(regex, (match, p1) => `<code>${p1}</code>`);
        // 将替换后的文本设置为节点的 HTML 内容
        node.innerHTML = text;
    })
}

// 创建转圈动画并插入
function createLoadingSpinner(node) {
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner-fluentread';
    node.appendChild(spinner)
    return spinner;
}

// endregion

// region 微软翻译
function microsoft(origin, callback) {
    // 从 GM 缓存获取 token
    let jwtToken = tokenManager.getToken(transModel.microsoft);
    refreshToken(jwtToken).then(jwtString => {
        // 失败，提前返回
        if (!jwtString) {
            callback(null);
            return;
        }
        GM_xmlhttpRequest({
            method: 'POST',
            url: "https://api-edge.cognitive.microsofttranslator.com/translate?from=&to=zh&api-version=3.0&includeSentenceLength=true",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + jwtString
            },
            data: JSON.stringify([{"Text": origin}]),
            onload: function (response) {
                if (response.status !== 200) {
                    console.log("调用微软翻译失败：", response.status);
                    callback(null);
                    return
                }
                let resultJson = JSON.parse(response.responseText);
                callback(resultJson[0].translations[0].text);
            },
            onerror: error => {
                console.log("调用微软翻译失败：", error);
                callback(null);
            }
        });
    });
}

// 返回有效的令牌或 false
function refreshToken(token) {
    const decodedToken = parseJwt(token);
    const currentTimestamp = Math.floor(Date.now() / 1000); // 当前时间的UNIX时间戳（秒）
    if (decodedToken && currentTimestamp < decodedToken.exp) {
        return Promise.resolve(token);
    }

    // 如果令牌无效或已过期，则尝试获取新令牌
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'GET',
            url: "https://edge.microsoft.com/translate/auth",
            onload: resp => {
                if (resp.status === 200) {
                    let token = resp.responseText;
                    tokenManager.setToken(transModel.microsoft, token);
                    resolve(token);
                } else reject('请求 microsoft translation auth 失败: ' + resp.status);
            },
            onerror: function (error) {
                console.error('请求 microsoft translation auth 发生错误: ', error);
                reject(error);
            }
        });
    });
}


// 解析 jwt，返回解析后对象
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

// endregion

// region 谷歌翻译

function google(origin, callback) {
    let params = {
        'client': 'gtx', 'sl': 'auto', 'tl': 'zh-CN', 'dt': 't',
        'q': encodeURIComponent(origin)
    };

    let queryString = Object.keys(params).map(function (key) {
        return key + '=' + params[key];
    }).join('&');

    GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://translate.googleapis.com/translate_a/single?' + queryString,
        onload: resp => {
            // 如果包含<title>Error 400 (Bad Request)则失败
            if (resp.responseText.includes('Error 400 (Bad Request)')) {
                console.log('Google翻译失败：', resp.responseText);
                callback(null);
                return;
            }
            // 开始解析
            let result = JSON.parse(resp.responseText);
            let sentence = ''
            result[0].forEach(e => sentence += e[0]);
            callback(sentence);
        },
        onerror: error => {
            console.error('Request failed', error);
        }
    });
}

// endregion

// region openai

function openai(origin, callback) {
    // 获取 token

    let token = tokenManager.getToken(transModel.openai)
    if (!token) return

    let headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
    };

    let data = {
        'model': 'gpt-3.5-turbo',
        'messages': [
            {'role': 'system', 'content': chatMgs.system},
            {'role': 'user', 'content': chatMgs.user.replace("{{origin}}", origin)}]
    };

    GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        headers: headers,
        data: JSON.stringify(data),
        onload: resp => {
            let result = JSON.parse(resp.responseText);
            callback(result.choices[0].message.content);
        },
        onerror: error => {
            console.error('Request failed', error);
        }
    });
}

// endregion

// region 文心一言

const chatMgs = {
    system: "You are a professional, authentic translation engine, only returns translations.",
    user: "Please translate them into cn-zh, please do not explain my original text: {{origin}}"
}
const JSONFormatHeader = {"Content-Type": "application/json"}

// req: API Key、Secret Key
// resp: access_token，有效期默认 30 天
function getYiyanToken() {
    return new Promise((resolve, reject) => {
        // 1、尝试从 GM 中获取 token，并检测是否有效
        let v = tokenManager.getToken(transModel.yiyan)
        if (v && v.token && v.ak && v.sk && v.expiration > Date.now()) {
            resolve(v.token); // 直接返回有效的 token
            return
        }
        // 2、发起网络请求
        GM_xmlhttpRequest({
            method: "POST",
            url: 'https://aip.baidubce.com/oauth/2.0/token',
            data: 'grant_type=client_credentials&client_id=' + v.ak + '&client_secret=' + v.sk,
            onload: resp => {
                let res = JSON.parse(resp.responseText);
                if (res.access_token) {
                    // 获取有效时间范围，单位秒
                    let expiration = new Date().getTime() + res.expires_in * 1000;
                    tokenManager.setToken(transModel.yiyan, {
                        ak: v.ak,
                        sk: v.sk,
                        token: res.access_token,
                        expiration: expiration
                    });
                    resolve(res.access_token);
                } else reject(new Error(res.error_description));
            },
            onerror: error => {
                console.log('Failed to refresh access token:', error);
                reject(error);
            }
        });
    })
}

function yiyan(origin, callback) {
    if (origin.trim().length === 0) return;
    getYiyanToken().then(token => {
        GM_xmlhttpRequest({
            method: "POST",
            // ERNIE-Bot 4.0 模型，模型定价页面：https://console.bce.baidu.com/qianfan/chargemanage/list
            // api 文档中心：https://cloud.baidu.com/doc/WENXINWORKSHOP/s/clntwmv7t
            url: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions_pro?access_token=' + token,
            headers: JSONFormatHeader,
            data: JSON.stringify({
                'temperature': 0.1, // 随机度
                'disable_search': true, // 禁用搜索
                'messages': [{
                    "role": "user",
                    "content": chatMgs.system + chatMgs.user.replace("{{origin}}", origin)
                }],
            }),
            onload: resp => {
                let res = JSON.parse(resp.responseText);
                callback(res.result);
            },
            onerror: error => {
                console.log("#>> onerror", error);
                callback(null);
            }
        });
    })
}

// endregion

// region 通义千问


function tongyi(origin, callback) {
    // 获取 token
    let token = tokenManager.getToken(transModel.tongyi)
    if (!token) {
        console.log("通义千问：未获取到 token");
        return
    }

    // 发起请求
    GM_xmlhttpRequest({
        method: "POST",
        url: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
        headers: {
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json"
        },
        data: JSON.stringify({
            "model": "qwen-turbo",
            "input": {
                "messages": [
                    {"role": "system", "content": chatMgs.system},
                    {"role": "user", "content": chatMgs.user.replace("{{origin}}", origin)}
                ]
            },
            "parameters": {}
        }),
        onload: resp => {
            let res = JSON.parse(resp.responseText);
            if (resp.status === 200) {
                callback(res.output.text);
            } else {
                console.log("调用通义千问失败：", resp);
                // todo 应展示友好的提示
                callback(null);
            }

        },
        onerror: error => {
            console.error('Request failed:', error);
        }
    });
}

// endregion

// region 智谱

function zhipu(origin, callback) {
    // 获取 tokenObject
    let tokenObject = tokenManager.getToken(transModel.zhipu);
    let token = tokenObject.token;
    if (!token || tokenObject.expiration >= Date.now()) {
        token = generateToken(tokenObject.apikey);
    }

    // 发起请求
    GM_xmlhttpRequest({
        method: "POST",
        url: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + token
        },
        data: JSON.stringify({
            "model": "glm-4",
            "messages": [
                {"role": "system", "content": chatMgs.system},
                {"role": "user", "content": chatMgs.user.replace("{{origin}}", origin)}
            ],
            "stream": false,
            "temperature": 0.1
        }),
        onload: resp => {
            let res = JSON.parse(resp.responseText);
            if (resp.status === 200) {
                callback(res.choices[0].message.content);
            } else {
                console.log("调用智谱失败：", resp);
                callback(null);
            }
        },
        onerror: error => {
            console.error('Error:', error);
        }
    });
}

function generateToken(apiKey) {

    if (!apiKey || !apiKey.includes('.')) {
        console.log("API Key 格式错误：", apiKey)
        return;
    }
    let duration = 3600000 * 24; // 生成的 token 默认24小时后过期

    const [key, secret] = apiKey.split('.');
    let token = generateJWT(secret, {alg: "HS256", sign_type: "SIGN", typ: "JWT"}, {
        api_key: key,
        exp: Math.floor(Date.now() / 1000) + (duration / 1000),
        timestamp: Math.floor(Date.now() / 1000)
    });
    if (!token) return  // 失败则提前返回
    // 存储
    tokenManager.setToken(transModel.zhipu, {apikey: apiKey, token: token, expiration: Date.now() + duration});

    return token;
}

// 生成JWT（JSON Web Token）
function generateJWT(secret, header, payload) {
    // 对header和payload部分进行UTF-8编码，然后转换为Base64URL格式
    const encodedHeader = base64UrlSafe(btoa(JSON.stringify(header)));
    const encodedPayload = base64UrlSafe(btoa(JSON.stringify(payload)));
    // 生成 jwt 签名
    let hmacsha256 = base64UrlSafe(CryptoJS.HmacSHA256(encodedHeader + "." + encodedPayload, secret).toString(CryptoJS.enc.Base64))
    return `${encodedHeader}.${encodedPayload}.${hmacsha256}`;
}

// 将Base64字符串转换为Base64URL格式的函数
function base64UrlSafe(base64String) {
    return base64String.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

