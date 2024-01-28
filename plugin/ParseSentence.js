// ==UserScript==
// @name         ParseSentence
// @namespace    http://tampermonkey.net/
// @version      2024-01-11
// @description  解析获取页面上所有句子
// @author       ThinkStu
// @match        *://*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=openai.com
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let ctrlPressed = false;
    let hoverTimer;

    document.addEventListener('keydown', event => {
        if (event.key === "Control") ctrlPressed = true;
    });

    document.addEventListener('keyup', event => {
        if (event.key === "Control") ctrlPressed = false;
    });

    // 监听到的元素，应该取其 textContent
    document.body.addEventListener('mouseover', function (event) {
        if (ctrlPressed && event.target && !["body", "script", "img", "noscript"].includes(event.target.tagName.toLowerCase())) {
            // 开始计时
            hoverTimer = setTimeout(() => {
                process(event.target, 0);   // 从当前元素开始，向下查找
            }, 200);
        }
    });
    // 如果在指定时间内移出元素，则取消操作与计时
    document.body.addEventListener('mouseout', event => clearTimeout(hoverTimer));
})();

let mySet = new Set();

function process(node, times) {
    if (times > 2) return;  // 最多往下查找2层
    switch (node.nodeType) {
        case Node.ELEMENT_NODE:
            for (let child of node.childNodes) {
                if (mySet.has(child)) continue;
                mySet.add(child);
                process(child, times + 1);
            }
            break;
        case Node.TEXT_NODE:
            // 打印文本
            console.log(node.textContent);
    }
}


