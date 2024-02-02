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
        if (event.key === "Control") ctrlPressed = false
    });

    // 当浏览器或标签页失去焦点时，重置 ctrlPressed
    window.addEventListener('blur', () => ctrlPressed = false)


    // 去重 set
    let sentenceSet = new Set();

    // 增加鼠标监听事件
    document.addEventListener('mousemove', (event) => {
        if (!ctrlPressed) return;

        clearTimeout(hoverTimer); // 清除之前的计时器
        hoverTimer = setTimeout(() => {
            let hoveredElement = event.target;
            let textContent = '';

            // 去重判断
            if (sentenceSet.has(hoveredElement)) return;

            // 如果存在子节点
            if (hoveredElement.childNodes.length > 0) {
                // 遍历所有子节点
                hoveredElement.childNodes.forEach(node => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        // 如果是文本节点，添加其文本
                        textContent += node.textContent.trim() + ' ';
                    } else if (node.nodeType === Node.ELEMENT_NODE && node.innerText) {
                        textContent += node.innerText.trim() + ' ';
                    }
                });
            } else {    // 如果没有子节点，直接获取元素的文本
                textContent = hoveredElement.textContent.trim();
            }

            // 检查换行符
            if (textContent && textContent.split("\n").length === 1) {
                sentenceSet.add(hoveredElement);
                console.log("Hovered Text: ", textContent);
            }
        }, 50)
    });
})();

