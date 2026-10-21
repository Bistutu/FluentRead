/**
 * @file src/features/video-subtitle/reading/thai.ts
 * 文件职责：为泰语视频字幕提供基于音节规则与不规则词典的本地 RTGS 罗马字。
 * 主要内容：复用纯 JavaScript 词法与音节解析，处理隐含元音、韵尾和前置元音；出现无法解析的低置信度回退时保留原字幕。
 * 模块边界：只在按需加载的专属 Worker 中执行，不访问网络或生成 HTML；RTGS 不表达声调和长短元音，不等于完整语音音标。
 */
import {analyze} from 'thai-rtgs';

export function romanizeThai(text: string): string {
    const result = analyze(text, {keepNonThai: true, case: 'lower', thaiDigits: 'keep'});
    // 不把无法解析的字母表回退及其重复符号输出伪装成可跟读发音。
    return result.warnings.length === 0 ? result.output : text;
}
