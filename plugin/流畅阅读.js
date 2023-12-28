// ==UserScript==
// @name         流畅阅读
// @license      GPL-3.0 license
// @namespace    https://fr.unmeta.cn/
// @version      0.2
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
// @run-at       document-end
// @downloadURL https://update.greasyfork.org/scripts/482986/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB.user.js
// @updateURL https://update.greasyfork.org/scripts/482986/%E6%B5%81%E7%95%85%E9%98%85%E8%AF%BB.meta.js
// ==/UserScript==


// URL 相关
const METHOD = "POST";
let url = new URL(window.location.href.split('?')[0]);

// cacheKey
const checkKey = "fluent_read_check";

// 时间
const expiringTime = 86400000 / 4;
const debouncedTime = 200; // 200毫秒

// 服务端地址
//const readLink = "https://fr.unmeta.cn/read";
//const preReadLink = "https://fr.unmeta.cn/preread";
const readLink = "http://127.0.0.1:80/read";
const preReadLink = "http://127.0.0.1:80/preread";
// const url
const Maven = "mvnrepository.com";
const DockerHub = "hub.docker.com";

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
                    if (mutation.target === null || mutation.target === undefined) return;

                    // console.log("变更记录: ", mutation.target);
                    // 处理每个变更记录（包含 body）
                    if (["div", "button", "svg", "span", "nav", "body"].includes(mutation.target.tagName.toLowerCase())) {
                        handleDOMUpdate(mutation.target);
                    }
                });
            });
            observer.observe(document.body, {childList: true, subtree: true});

            handleDOMUpdate(document.body);
        }
    });
    // remove all cache
    document.addEventListener('keydown', function (event) {
        if (event.key === 'F2') {
            console.log('Cache cleared!');
            let listValues = GM_listValues();
            listValues.forEach(e => {
                GM_deleteValue(e)
            })
        }
    });
})();

// 异步返回 callback，表示是否需要拉取数据
function checkNeedToRun(callback) {
    // 1、检查缓存
    let PagesMapCache = GM_getValue(checkKey, undefined);
    if (PagesMapCache !== undefined && PagesMapCache !== null) {
        PagesMapCache[url.host] ? callback(true) : callback(false);
        return;
    }

    // 2、网络请求
    GM_xmlhttpRequest({
        method: METHOD,
        url: preReadLink,
        onload: function (response) {
            let pagesMap = JSON.parse(response.responseText).Data;
            // 设置缓存
            GM_setValue(checkKey, pagesMap);

            pagesMap !== null && pagesMap !== undefined && pagesMap[url.host] ? callback(true) : callback(false);
        },
        onerror: function (error) {
            console.error("请求失败: ", error);
            callback(false);
        }
    });
}


// 初始化函数
function clearCacheIfNeeded() {
    const lastRun = GM_getValue("lastRun");
    const now = new Date().getTime();

    if (lastRun === null || lastRun === undefined || now - lastRun > expiringTime) {
        console.log("time to start");
        updateCache();
        GM_setValue("lastRun", now.toString());
    }
}

function updateCache() {
    GM_xmlhttpRequest({
        method: METHOD,
        url: preReadLink,
        onload: handleCacheUpdateResponse,
        onerror: (error) => console.error("请求失败: ", error)
    });
}

function handleCacheUpdateResponse(response) {
    const pagesMap = JSON.parse(response.responseText).Data;
    const pageMapCache = GM_getValue(checkKey) || {};

    GM_setValue(checkKey, pagesMap);

    const listValues = GM_listValues();

    listValues.forEach(host => {

        if (pageMapCache[host] !== pagesMap[host]) {
            GM_deleteValue(host);
            console.log("删除缓存: ", host);
        }
    });
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
    const cachedData = GM_getValue(url.host, undefined);
    if (cachedData !== undefined && cachedData !== null) {
        return cachedData;
    }
    return null;
}


// 发送请求获取 host 对应的翻译数据
function sendRequest(callback) {

    let param = {page: url.origin};

    GM_xmlhttpRequest({
        method: METHOD,
        url: readLink,
        data: JSON.stringify(param),
        onload: function (response) {
            if (callback) {
                let parse = JSON.parse(response.responseText);
                GM_setValue(url.host, parse.Data);
                callback(parse.Data);

                console.log("新请求: ", url.host);
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
            if (["head", "path", "script", "style", "img", "noscript"].includes(node.tagName.toLowerCase())
                // 适配 OpenAI
                || node.hasAttribute("data-message-author-role")
                // 适配 stackoverflow
                || node.classList.contains("s-post-summary--content")
                || node.classList.contains("thread-item")
            ) {
                // console.log("忽略节点: ", node);
                return;
            }
            if (["input", "button", "textarea"].includes(node.tagName.toLowerCase())) {
                processInput(node, respMap);
            }
            break;
        // 文本节点
        case node.nodeType === Node.TEXT_NODE:
            // console.log("文本节点》 ", node);
            switch (url.host) {
                case  Maven:
                    processTextNode_maven(node, respMap);
                    break;
                case DockerHub:
                    processTextNode_dockerhub(node, respMap);
                    break;
                default:
                    processTextNode(node, respMap);
            }
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

        // console.log(text);
        signature(url.host + text).then((value) => {
            // 添加一个检查以确保 respMap 是有效的
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

// 适配 maven
function processTextNode_maven(node, respMap) {
    let text = node.textContent.replace(/\u00A0/g, ' ').trim();

    if (text.length > 0 && isNonChinese(text)) {
        // 如果是 Maven，且为日期格式，则改变其格式 May 09, 2019 变为 2019-05-09
        if (text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{1,2},\s\d{4}$/)) {
            let date = new Date(text);
            let year = date.getFullYear();
            let month = date.getMonth() + 1; // 月份是从0开始的
            let day = date.getDate();
            // 确保月份和日期为两位数
            month = month < 10 ? '0' + month : month;
            day = day < 10 ? '0' + day : day;
            text = year + "-" + month + "-" + day;
            node.textContent = text;
            return
        } else {
            let match = text.match(/Last Release on (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{1,2}),\s(\d{4})/);
            if (match) {
                let date = new Date(match[1] + " " + match[2] + ", " + match[3]);
                let year = date.getFullYear();
                let month = date.getMonth() + 1; // 月份是从0开始的
                let day = date.getDate();
                // 构建新的日期格式
                text = `最近更新 ${year}年${month}月${day}日`;
                node.textContent = text;
                return;
            }
            // 处理依赖类型的翻译
            let dependencyMatch = text.match(/(Test|Provided|Compile) Dependencies \((\d+)\)/);
            if (dependencyMatch) {
                let type = dependencyMatch[1];
                let count = dependencyMatch[2];
                switch (type) {
                    case 'Test':
                        text = `测试依赖 Test (${count})`;
                        break;
                    case 'Provided':
                        text = `提供依赖 Provided (${count})`;
                        break;
                    case 'Compile':
                        text = `编译依赖 Compile (${count})`;
                        break;
                    // 可以根据需要添加更多的情况
                }

                node.textContent = text;
                return;
            }
        }
        // 处理 "#数字 in" 格式的字符串
        let rankMatch = text.match(/#(\d+) in\s*(.*)/);
        if (rankMatch) {
            let number = rankMatch[1];
            let context = rankMatch[2]; // 如 "MvnRepository" 或为空

            if (context) {
                text = `第 ${number} 位 ${context}`;
            } else {
                text = `第 ${number} 位 `;
            }

            node.textContent = text;
            return;
        }
        // 处理 "21,687 artifacts" 到 "被引用 21,687 次" 的转换
        // 处理 artifacts 的翻译
        // 处理 artifacts 被引用的翻译
        let artifactsMatch = text.match(/^([\d,]+)\s+artifacts$/);
        if (artifactsMatch) {
            let count = artifactsMatch[1];
            text = `被引用 ${count} 次`;
            node.textContent = text;
            return;
        }
        // 处理漏洞数量的翻译
        let vulnerabilityMatch = text.match(/^(\d+)\s+vulnerabilit(y|ies)$/);
        if (vulnerabilityMatch) {
            let count = vulnerabilityMatch[1];
            text = `${count}个漏洞`;
            node.textContent = text;
            return;
        }

        // 如果都不符合，则进行普通哈希替换
        processTextNode(node, respMap)
    }
}

function processTextNode_dockerhub(node, respMap) {
    let text = node.textContent.replace(/\u00A0/g, ' ').trim();

    if (text.length > 0 && isNonChinese(text)) {


        // 如果都不符合，则进行普通哈希替换
        processTextNode(node, respMap)
    }
}