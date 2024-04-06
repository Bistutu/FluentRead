// 面向切面编程，后置函数编写
import {html} from 'js-beautify';

// 格式化翻译后文本
export function beautyHTML(text: string): string {
    // 1、js-beautify格式化代码
    // 2、正则表达式匹配 <   a> 则将其替换为 <a>（因为 js-beautify 只能将 <   a> 格式化为 < a>）
    // return html(text).replace(/<\s+/g, "<")
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



