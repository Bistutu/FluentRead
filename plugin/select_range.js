// ==UserScript==
// @name         demo
// @namespace    http://tampermonkey.net/
// @version      2024-01-28
// @description  try to take over the world!
// @author       You
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// ==/UserScript==


let hoverTimer;

// prune set
let pruneSet = new Set();

(function () {
    'use strict';
    // 为整个文档添加一个鼠标移动事件监听器
    clearTimeout(hoverTimer); // 清除计时器
    hoverTimer = setTimeout(() => {
        document.addEventListener('mousemove', function (event) {
            let paragraph = getMouseOverParagraph(event.clientX, event.clientY);
            if (pruneSet.has(paragraph)) return
            pruneSet.add(paragraph)
            if (paragraph) {
                console.log('找到段落:', paragraph);
            }
        });
    }, 50);

})();

// 定义一个函数，根据鼠标指针的位置获取当前鼠标悬停的段落元素
function getMouseOverParagraph(clientX2, clientY2) {
    // 从鼠标指针位置创建一个文本范围
    let range = getRangeFromPoint(clientX2, clientY2);
    // 如果范围为null，即没有找到元素，则返回
    if (range == null)
        return;

    // 定义一个检查非文本元素的函数
    let checkTheUnTextElement = () => {
            // 从指定的点获取最上层的元素
            let pointElement = document.elementFromPoint(
                clientX2,
                clientY2
            );
            // 如果没有找到元素，返回
            if (!pointElement)
                return;
            // 检查是否有实际的内部元素（可能在shadow DOM内）
            let realInnerElement = findElementInShadow(
                pointElement,
                clientX2,
                clientY2
            );
            // 检查找到的元素是否是BUTTON，如果是，返回这个BUTTON，如果不是，返回它的块级父元素
            return realInnerElement === pointElement ? pointElement.nodeName === "BUTTON" ? pointElement : void 0 : getBlockParentNode(realInnerElement);
        },
        // 定义一个检查文本节点的函数
        checkTheTextNode = () => {
            // 调整range的开始和结束位置，以包含开始容器的文本节点
            range.setStartBefore(range.startContainer), range.setEndAfter(range.startContainer);
            // 获取当前范围的边界矩形
            let rect = range.getBoundingClientRect();
            // 检查鼠标位置是否在文本范围内，如果是，返回这个范围的块级父元素
            if (!(rect.left > clientX2 || rect.right < clientX2 || rect.top > clientY2 || rect.bottom < clientY2))
                return getBlockParentNode(range.startContainer);
        },
        // 定义一个变量来存储找到的元素
        findedElement;
    // 检查开始容器的节点类型是否为文本节点，调用相应的检查函数
    return range.startContainer.nodeType !== Node.TEXT_NODE ? findedElement = checkTheUnTextElement() : findedElement = checkTheTextNode(), findedElement;
}

function getBlockParentNode(startNode) {
    return startNode.nodeType === Node.TEXT_NODE ? startNode.parentNode : startNode;
}

function getRangeFromPoint(x4, y4) {
    if (document.caretPositionFromPoint) {
        let position = document.caretPositionFromPoint(x4, y4);
        if (position) {
            let range = document.createRange(), offsetNode = position.offsetNode;
            if (!offsetNode || offsetNode.nodeType !== Node.TEXT_NODE)
                return null;
            range.setStart(offsetNode, position.offset), range.setEnd(offsetNode, position.offset);
            return range;
        }
        return null;
    } else
        return document.caretRangeFromPoint ? document.caretRangeFromPoint(x4, y4) : null;
}


function findElementInShadow(ele, x4, y4) {
    let findCount = 0, finder = (ele2, x5, y5, preShadow) => {
        if (++findCount > 100 || preShadow === ele2)
            return ele2;
        let innerShadowDom = ele2.shadowRoot;
        if (!innerShadowDom || typeof innerShadowDom.elementFromPoint != "function")
            return ele2;
        let innerDom = innerShadowDom.elementFromPoint(x5, y5);
        return innerDom ? finder(innerDom, x5, y5, ele2) : ele2;
    };
    return finder(ele, x4, y4);
}

