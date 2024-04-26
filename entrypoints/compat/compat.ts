// 兼容部分网站独特的 DOM 结构

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
        if (node.tagName.toLowerCase() === 'div' && node.classList.contains('im-description')) return true
    },
    ["www.aozora.gr.jp"]: (node: any) => {
        if (node.tagName.toLowerCase() === 'div' && node.classList.contains('main_text')) return true
    },
    ["youtube.com"]: (node: any) => {
        if (node.tagName.toLowerCase() === 'yt-formatted-string') return true
    },
    ['www.webtrees.net']: (node: any) => {
        // class='kmsg'
        if (node.tagName.toLowerCase() === 'div' && node.classList.contains('kmsg')) return true
    },
    ['webtrees.net']: (node: any) => {
        // class='kmsg'
        if (node.tagName.toLowerCase() === 'div' && node.classList.contains('kmsg')) return true
    },
}