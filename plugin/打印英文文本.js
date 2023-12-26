// ==UserScript==
// @name         打印英文文本
// @namespace    https://fr.unmeta.cn/
// @version      0.1
// @description  获取页面上的所有英文文本，并在控制台打印
// @author       ThinkStu
// @icon         [icon URL]
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

let s = new Set();
const debouncedTime = 1000;
const debounced = debounce(echo, debouncedTime);


(function () {
    'use strict';

    document.addEventListener('keydown', function (event) {
        if (event.key === 'F3') {
            console.log('清空Set');
            s.clear();
        }
    });

    setTimeout(() => {
        parseDfs(document.body);
        debounced();

        // 使用MutationObserver监听DOM变化，配置和启动观察器
        const observer = new MutationObserver(function (mutations, obs) {
            mutations.forEach(mutation => {
                let node = mutation.target;

                // 处理每个变更记录
                if (["div", "span", "nav"].includes(node.tagName.toLowerCase())) {
                    parseDfs(node);
                    debounced();
                }
            });
        });
        observer.observe(document.body, {childList: true, subtree: true});
    }, 2000); // 延迟时间设置为2000毫秒（2秒）

})();

function echo() {
    // 将Set转换为数组
    let arrayFromSet = Array.from(s);
    // 对数组进行字母排序，忽略大小写
    arrayFromSet.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    // 输出排序后的数组，保持原始大小写
    console.log(arrayFromSet);
}

// 递归提取节点的文本内容
function parseDfs(node) {

    // TODO 限定条件，跳过一些不必要的处理
    if (node.nodeType === Node.ELEMENT_NODE && (node.hasAttribute("data-message-author-role")
        || node.classList.contains("post-layout")
        // || node.hasAttribute("data-post-id")
        || node.classList.contains("s-post-summary--content")
        || node.classList.contains("d-block")
        || node.classList.contains("s-prose")
        || node.classList.contains("question-hyperlink")
        || node.classList.contains("user-info")
        || node.classList.contains("js-post-body")
        || node.id === "inline_related_var_a_less"
        || node.id === "hot-network-questions"
    )) {
        // console.log("忽略节点: ", node);
        return;
    }

    switch (true) {
        case node.nodeType === Node.ELEMENT_NODE && ["head", "picture", "script", "style", "img", "noscript"].includes(node.tagName.toLowerCase()):
            return
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
    if (text.length > 0 && isNonChinese(text) && isEnglish(text)) {
        s.add(text);
    }
}

function processInput(node) {
    let placeholder = node.placeholder.replace(/\u00A0/g, ' ').trim();
    let value = node.value.replace(/\u00A0/g, ' ').trim();

    if (placeholder.length > 0 && isNonChinese(placeholder) && isEnglish(placeholder)) {
        s.add(placeholder);
    }
    if (value.length > 0 && isNonChinese(value) && isEnglish(value)) {
        s.add(value);
    }
}

// 判断字符串是非中文
function isNonChinese(text) {
    return !/[\u4e00-\u9fa5]/.test(text);
}

// 判断字符串是英文
function isEnglish(text) {
    for (let i = 0; i < text.length; i++) {
        let v = text.charCodeAt(i);
        if ((v >= 'a'.charCodeAt(0) && v <= 'z'.charCodeAt(0)) || (v >= 'A'.charCodeAt(0) && v <= 'Z'.charCodeAt(0))) {
            return true;
        }
    }
    return false;
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