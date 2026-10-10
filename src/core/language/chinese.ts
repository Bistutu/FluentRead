/**
 * @file src/core/language/chinese.ts
 *
 * 文件职责：统一中文语言别名与语言标签中的书写体系，为配置、供应商映射和界面元数据提供轻量的纯标签边界。
 * 主要内容：中文语言码经 codes.ts 的通用标签解析确定简繁，脚本子标签优先于地区；裸 zh 保留既有简体默认值，其他语言或无法确定书写体系的标签只去除首尾空白。导出 normalizeChineseLanguageCode、getChineseScript 与 ChineseScript 类型。
 * 模块边界：本文件只解析语言标签，不读取汉字字符表、不构造正文检测正则，也不反向导出中文正文算法；字形证据由 chineseText.ts 负责，整体语言识别由 identify.ts 与 detect.ts 组合，不访问配置、浏览器、网络或翻译服务。
 */

import {normalizeLanguageCode} from './codes';

export type ChineseScript = 'Hans' | 'Hant';

/**
 * 把能确定书写体系的中文标签改写为 zh-Hans/zh-Hant，脚本子标签优先于地区，旧版裸 zh 沿用简体默认值；
 * 其他语言、冲突脚本或无法确定简繁的中文标签原样保留（仅去除首尾空白），供供应商映射表继续使用。
 */
export function normalizeChineseLanguageCode(value: string): string {
    const trimmed = value.trim();
    const normalized = normalizeLanguageCode(trimmed);
    return normalized === 'zh-Hans' || normalized === 'zh-Hant' ? normalized : trimmed;
}

export function getChineseScript(value: string): ChineseScript | undefined {
    const normalized = normalizeLanguageCode(value);
    if (normalized === 'zh-Hans') return 'Hans';
    if (normalized === 'zh-Hant') return 'Hant';
    return undefined;
}
