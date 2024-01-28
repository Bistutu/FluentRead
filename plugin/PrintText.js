// ==UserScript==
// @name         打印英文文本
// @namespace    https://fr.unmeta.cn/
// @version      0.1
// @description  获取页面上的所有英文文本，并在控制台打印
// @author       ThinkStu
// @icon         [icon URL]
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

// region 变量与常量
let textSet = new Set();
// 输出文本集信息 + 防抖
const debouncedEcho = debounce(echo, 500);
// 存储的Key
const hostKey = "host_key";
let url = new URL(location.href.split('?')[0]);

//  endregion

(function () {
    'use strict';

    setTimeout(() => {
        parseDfs(document.body);
        // 输出文本集信息
        debouncedEcho();

        // 使用 MutationObserver 监听 DOM 变化，配置和启动观察器
        const observer = new MutationObserver(function (mutations, obs) {
            mutations.forEach(mutation => {
                let node = mutation.target;

                // 处理每个变更记录
                if (["div", "section","main","tbody","tr","td","button", "svg", "span", "nav", "body", "label"].includes(node.tagName.toLowerCase())) {
                    parseDfs(node);
                    debouncedEcho();
                }
            });
        });
        observer.observe(document.body, {childList: true, subtree: true});
    }, 2000); // 延迟时间设置为2000毫秒（2秒）

    // 快捷键 F3 清空 Set 缓存
    document.addEventListener('keydown', function (event) {
        if (event.key === 'F3') {
            // 清空所有缓存
            // textSet.clear();
            let listValues = GM_listValues();
            listValues.forEach(e => {
                GM_deleteValue(e)
            })
            console.log('清空所有文本缓存🥹');
        }
    });
})();

// 递归提取节点的文本内容
function parseDfs(node) {
    // 跳过一些域名
    if (url.host.match(/(www.baidu|www.google)/)) {
        return;
    }

    switch (node.nodeType) {
        // 元素节点
        case Node.ELEMENT_NODE:
            // TODO 限定条件，跳过不必要的 node
            if (isSkip(node) || ["head", "picture", "script", "style", "img", "noscript"].includes(node.tagName.toLowerCase())) {
                // console.log("忽略节点: ", node);
                return;
            }
            if (["input", "textarea"].includes(node.tagName.toLowerCase())) {
                processInput(node);
            }
            if (node.hasAttribute("aria-label")) {
                processAriaLabel(node)
            }
            break
        // 文本节点
        case  Node.TEXT_NODE :
            parseText(node);
    }

    let child = node.firstChild;
    while (child) {
        parseDfs(child);
        child = child.nextSibling;
    }
}

// 正则表达式辅助跳过
const regexMBKB = /^\d+(\.\d+)?(MB|KB|GB|TB)$/;

function parseText(node) {
    let text = node.textContent.replace(/\u00A0/g, ' ').trim();
    if (regexMBKB.test(text)) {
        return;
    }
    if (text.length > 0 && withoutChinese(text) && isEnglish(text)) {
        // 从 GM 中取出 host 对应的值
        process(text);
    }
}

// 真正处理文本
function process(text) {
    let hostValue = GM_getValue(url.host);
    let host;
    if (!Array.isArray(hostValue)) {
        host = new Set();
    } else {
        host = new Set(hostValue);
    }
    host.add(text);
    // 将 Set 转换为数组以存储
    GM_setValue(url.host, Array.from(host));
}

function processInput(node) {
    let placeholder = node.placeholder.replace(/\u00A0/g, ' ').trim();
    let value = node.value.replace(/\u00A0/g, ' ').trim();

    if (placeholder.length > 0 && withoutChinese(placeholder) && isEnglish(placeholder)) {
        process(placeholder);
    }
    if (value.length > 0 && withoutChinese(value) && isEnglish(value)) {
        process(value);
    }
}

// read：处理 aria-label 属性
function processAriaLabel(node) {
    let ariaLabel = node.getAttribute('aria-label').replace(/\u00A0/g, ' ').trim();
    if (ariaLabel) {
        if (ariaLabel.length > 0 && withoutChinese(ariaLabel)) {
            process(ariaLabel);
        }
    }
}

// endregion

// region 通用函数

// read：判断具有特殊属性的节点是否应该被跳过
function isSkip(node) {

    return node.hasAttribute("data-message-author-role")
        // mod模组系列
        || node.classList.contains("mod-image")
        // || node.classList.contains("tile-desc")
        || node.classList.contains("desc")
        // 其余系列
        || node.classList.contains("post-layout")
        || node.hasAttribute("data-post-id")
        || node.classList.contains("s-post-summary--content")
        || node.classList.contains("d-block")
        || node.classList.contains("s-prose")
        || node.classList.contains("question-hyperlink")
        || node.classList.contains("user-info")
        || node.classList.contains("js-post-body")
        || node.id === "inline_related_var_a_less"
        || node.id === "hot-network-questions"
        // coze
        || node.classList.contains("WGuG2UMJJ8wbd0zOu7JN")
        || node.classList.contains("semi-typography")
        || node.classList.contains("flow-markdown-body")
        || node.classList.contains("jwzzTyL0ME4eVCKuxpDL")
        || node.classList.contains("WsIBTuSuHYIPuetXwr1f")
        || node.classList.contains("kJSEgautwioJ9kmI18b8")

}


// 将Set转换为数组，对数组进行字母排序（忽略大小写），并输出排序后的数组
function echo() {
    let listValues = GM_listValues();
    listValues.forEach(key => {
        let value = GM_getValue(key);
        // 打印键和值
        // if (key.match(/.*(\.)?\..*/)) {
        // 在哪个页面就打印哪个页面的数据
        if (key === url.host) {
            console.log(key);
            console.log(value);
        }

    })
}

// 判断字符串是非中文
function withoutChinese(text) {
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


// endregion