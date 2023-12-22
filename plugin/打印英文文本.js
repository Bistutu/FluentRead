// ==UserScript==
// @name         打印英文文本
// @namespace    https://fr.unmeta.cn/
// @version      0.1
// @description  获取页面上的所有英文文本，并在控制台打印
// @author       ThinkStu
// @icon         [icon URL]
// @match        *://*/*
// @grant        none
// ==/UserScript==

let s = new Set();
const debouncedTime = 1000;
const debouncedObserveDOM = debounce(echo, debouncedTime);


(function () {
    'use strict';

    parseDfs(document.body);
    debouncedObserveDOM();

    // 使用MutationObserver监听DOM变化，配置和启动观察器
    const observer = new MutationObserver(function (mutations, obs) {
        mutations.forEach(mutation => {

            // 处理每个变更记录
            if (["div", "span", "nav"].includes(mutation.target.tagName.toLowerCase())) {
                parseDfs(mutation.target)
                debouncedObserveDOM();
            }
        });
    });
    observer.observe(document.body, {childList: true, subtree: true});

})();

function echo() {
    console.log(s);
}


// 递归提取节点的文本内容
function parseDfs(node) {
    switch (true) {
        case node.nodeType === Node.ELEMENT_NODE && ["head", "script", "style", "img", "noscript"].includes(node.tagName.toLowerCase()):
            break
        case node.nodeType === Node.ELEMENT_NODE && ["input", "textarea"].includes(node.tagName.toLowerCase()):
            processInput(node);
            break
        case node.nodeType === Node.TEXT_NODE :
            parseText(node);
    }

    let child = node.firstChild;
    while (child) {
        parseDfs(child);
        child = child.nextSibling;
    }
}

function parseText(node) {
    let text = node.textContent.replace(/\u00A0/g, ' ').trim();
    if (text.length > 0 && isNonChinese(text)) {
        s.add(text);
    }
}

function processInput(node) {
    let placeholder = node.placeholder.replace(/\u00A0/g, ' ').trim();
    let value = node.value.replace(/\u00A0/g, ' ').trim();

    if (placeholder.length > 0 && isNonChinese(placeholder)) {
        s.add(placeholder);
    }
    if (value.length > 0 && isNonChinese(value)) {
        s.add(value);
    }
}

// 判断字符串是非中文
function isNonChinese(text) {
    return !/[\u4e00-\u9fa5]/.test(text);
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