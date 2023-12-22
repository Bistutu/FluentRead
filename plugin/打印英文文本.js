// ==UserScript==
// @name         打印页面所有英文文本
// @namespace    https://fr.unmeta.cn/
// @version      0.1
// @description  获取页面上的所有英文文本，并在控制台打印
// @author       ThinkStu
// @icon         [icon URL]
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let s = new Set();


    // 递归提取节点的文本内容
    function parseDfs(node) {
        switch (true) {
            case node.nodeType === Node.ELEMENT_NODE && ["script", "Script", "SCRIPT", "style", "img", "noscript"].includes(node.tagName):
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
            // 在这里执行你想要的操作，例如打印或保存文本
            s.add(text);
        }
    }

    // 判断字符串是非中文
    function isNonChinese(text) {
        return !/[\u4e00-\u9fa5]/.test(text);
    }


    parseDfs(document.body);
    console.log(s);

    // 监听器配置
    function main() {
        parseDfs(document.body);
        console.log(s);
    }

    // 使用MutationObserver监听DOM变化
    const observer = new MutationObserver(function (mutations, obs) {
        main();
    });
    // 配置和启动观察器
    observer.observe(document, {
        childList: true,
        subtree: true
    });

})();
