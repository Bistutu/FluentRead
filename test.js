// ==UserScript==
// @name         滚动文本提取器
// @namespace    http://your.domain.com
// @version      0.1
// @description  提取滚动范围内的文本，并使用 Set 避免重复输出。
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 创建一个 Set 用于存储唯一的文本
    const textSet = new Set();

    // 从元素及其子元素中提取文本的函数
    function extractText(element) {
        if (!element) return;
        const nodes = element.childNodes;
        nodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                textSet.add(node.textContent.trim());
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                extractText(node);
            }
        });
    }

    // 处理滚动事件的函数
    function handleScroll() {
        const elements = document.querySelectorAll('*');
        elements.forEach(element => {
            const rect = element.getBoundingClientRect();
            if (rect.top >= 0 && rect.bottom <= window.innerHeight) {
                extractText(element);
            }
        });

        // 输出唯一的文本
        textSet.forEach(text => {
            console.log(text);
        });
    }

    // 监听滚动事件
    window.addEventListener('scroll', handleScroll);
})();
