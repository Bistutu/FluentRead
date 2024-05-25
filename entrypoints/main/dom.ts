import {Config} from "@/entrypoints/utils/model";
import {getMainDomain, selectCompatFn} from "@/entrypoints/main/compat";
import {html} from 'js-beautify';
import {handleBtnTranslation} from "@/entrypoints/main/trans";

// 当遇到这些 tag 时直接翻译
const directSet = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', "li"]);
const skipSet = new Set(["html", "body",]);

export const chileSet = new Set([
    'a', 'b', 'strong', 'span', 'img', 'br', 'em', 'u', 'small', 'sub', 'sup', 'i', 'font',
    'big', 'strike', 's', 'del', 'ins', 'mark', 'cite', 'q', 'abbr', 'acronym', 'dfn', 'svg',
    'code', 'samp', 'kbd', 'var', 'pre', 'address', 'time', 'ruby', 'rb', 'rt', 'rp', 'bdi', 'bdo', 'wbr',
    'details', 'summary', 'menuitem', 'menu', 'dialog', 'slot', 'template', 'shadow', 'content', 'element',
]);

const url = new URL(location.href.split('?')[0]);

// 返回最终应该翻译的父节点或 false
export function grabNode(config: Config, node: any): any {
    let curTag = node.tagName.toLowerCase();    // 当前 tag

    // 1、全局节点与空节点、input 节点、文字过多的节点、class="notranslate" 的节点不翻译
    if (!node || skipSet.has(curTag) || curTag === 'input' || node.classList.contains('notranslate')
        || node.textContent.length > 3072 || (node.outerHTML && node.outerHTML.length > 4096)) {
        return false;
    }

    // 2、普通适配，遇到这些标签则直接翻译节点
    if (directSet.has(curTag)) {
        return node;
    }

    // 3、button 按钮适配
    if (curTag === 'button' || (curTag === 'span' && node.parentNode && node.parentNode.tagName.toLowerCase() === 'button')) {
        // 翻译按钮内部而不是整个按钮，避免按钮失去响应式点击事件
        if (node.textContent.trim() !== '') handleBtnTranslation(config, node)
        return false;
    }

    // 4、特殊适配，根据域名进行特殊处理
    let fn = selectCompatFn[getMainDomain(url.host)];
    if (fn && fn(node)) return node;

    // 4、如果遇到 span，则首先该节点就符合翻译条件
    if (curTag === "span" || node.nodeType === Node.TEXT_NODE || detectChildMeta(node)) {
        return grabNode(config, node.parentNode) || node;   // 递归向上寻找最后一个符合的父节点
    }

    // 5、如果节点是div并且不符合一般翻译条件，可翻译首行文本
    if (curTag === 'div' || curTag === 'label') {
        // 遍历子节点，寻找首个文本节点或 a 标签节点
        let child = node.firstChild;
        while (child) {
            if (child.nodeType === Node.TEXT_NODE && child.textContent.trim() !== '') {
                // background.ts
                browser.runtime.sendMessage({context: document.title, origin: child.textContent})
                    .then((text: string) => child.textContent = text)
                    .catch(error => console.error('调用失败:', error))

                return false; // 只翻译首行文本，不再进行后续步骤
            }
            child = child.nextSibling;
        }
    }

    // console.log('不翻译节点：', node);

    return false
}

// 检测子元素中是否包含指定标签以外的元素
function detectChildMeta(parent: any): boolean {
    let child = parent.firstChild;
    while (child) {
        if (child.nodeType === Node.ELEMENT_NODE && !chileSet.has(child.nodeName.toLowerCase())) {
            return false;
        }
        child = child.nextSibling;
    }
    return true;
}

// 仅译文模式下获取 LLM 应当翻译的标准 HTML
export function LLMStandardHTML(node: any) {
    let text = "";
    // 遍历所有子节点
    node.childNodes.forEach((child: any) => {
        if (child.nodeType === Node.TEXT_NODE) {
            text += child.nodeValue;    // 文本节点，直接添加至 text
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            // 检查是否为特定节点
            if (chileSet.has(child.tagName.toLowerCase())) {
                text += child.outerHTML;
            } else {
                text += LLMStandardHTML(child); // 递归
            }
        }
    });
    return text;
}

export function beautyHTML(text: string): string {
    text = replaceSensitiveWords(text);
    return html(text)
}

// 替换 svg 标签中的一些大小写敏感的词（html 不区分大小写，但 svg 标签区分大小写）
function replaceSensitiveWords(text: string): string {
    return text.replace(/viewbox|preserveaspectratio|clippathunits|gradienttransform|patterncontentunits|lineargradient|clippath/gi, (match) => {
        switch (match.toLowerCase()) {
            case 'viewbox':
                return 'viewBox';
            case 'preserveaspectratio':
                return 'preserveAspectRatio';
            case 'clippathunits':
                return 'clipPathUnits';
            case 'gradienttransform':
                return 'gradientTransform';
            case 'patterncontentunits':
                return 'patternContentUnits';
            case 'lineargradient':
                return 'linearGradient';
            case 'clippath':
                return 'clipPath';
            default:
                return match;
        }
    });
}
