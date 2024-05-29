// 兼容部分网站独特的 DOM 结构

import {findMatchingElement} from "@/entrypoints/utils/common";

type ReplaceFunction = (node: any, text: any) => any;
type SelectFunction = (url: any) => any;

interface ReplaceCompatFn {
    [domain: string]: ReplaceFunction;
}

interface SelectCompatFn {
    [domain: string]: SelectFunction;
}

// 根据浏览器 url.host 是获取获取主域名
export function getMainDomain(url: any) {
    const parts = url.split('.').reverse();
    return `${parts[1]}.${parts[0]}`
}

// 文本替换环节的兼容函数，主域名 : 兼容函数
export const replaceCompatFn: ReplaceCompatFn = {
    ["youtube.com"]: (node: any, text: any) => {
        // 替换 innerText
        let temp = document.createElement('span');
        temp.innerHTML = text;
        node.innerHTML = temp.innerText;
        return node.outerHTML;
    },
};

// 元素 node 选择环节的兼容函数
export const selectCompatFn: SelectCompatFn = {
    ["mvnrepository.com"]: (node: any) => {
        if (node.tagName.toLowerCase() === 'div' && node.classList.contains('im-description')) return node
    },
    ["aozora.gr.jp"]: (node: any) => {
        if (node.tagName.toLowerCase() === 'div' && node.classList.contains('main_text')) return node
    },
    ["youtube.com"]: (node: any) => {
        if (node.tagName.toLowerCase() === 'yt-formatted-string') return node
    },
    ['webtrees.net']: (node: any) => {
        // class='kmsg'
        if (node.tagName.toLowerCase() === 'div' && node.classList.contains('kmsg')) return node
    },
    ['x.com']: (node: any) => {
        return findMatchingElement(node, 'article div[lang]')   // 帖子
            || findMatchingElement(node, 'div[data-testid="UserDescription"]')  // 个人简介
        ||findMatchingElement(node, 'div.css-146c3p1')  // 右侧边栏用户简介
    }
}