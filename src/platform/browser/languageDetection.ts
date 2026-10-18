/**
 * @file src/platform/browser/languageDetection.ts
 * 文件职责：把可选的 WebExtension i18n 语言检测能力暴露为无配置的本地检测端口。
 * 主要内容：仅调用已有 i18n.detectLanguage Promise 接口；API 缺失时返回未知，保留原始结果交纯规则校验，不初始化翻译模型、不下载资源，也不向供应商传送检测样本。
 * 模块边界：本文件只拥有浏览器能力访问，不比较目标语言、不缓存或投票；超时、独立取消、并发上限和生命周期由 translation/languagePreflight 服务负责。Userscript 无该 API 时自然回退。
 */

import browser from 'webextension-polyfill';

export function detectBrowserLanguage(text: string): Promise<unknown> | undefined {
    if (typeof browser.i18n?.detectLanguage !== 'function') return undefined;
    return browser.i18n.detectLanguage(text);
}
