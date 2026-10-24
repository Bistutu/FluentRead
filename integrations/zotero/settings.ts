/**
 * @file integrations/zotero/settings.ts
 * 文件职责：归一化 Zotero 独立插件的本地设置，并验证自定义翻译接口的传输边界。
 * 主要内容：默认自动识别并翻译为简体中文，设置字段有界；仅允许 HTTPS 或本机回环 HTTP，拒绝 URL 凭据及查询参数，密钥只保留在独立设置字段。
 * 模块边界：纯配置规则，不读写 Zotero 偏好、不发起翻译，不从浏览器扩展读取凭据。
 */
import type {TranslationSettings} from './contracts';

export const defaultSettings: TranslationSettings = Object.freeze({
    sourceLanguage: 'auto', targetLanguage: 'zh-Hans', service: 'microsoft',
    endpoint: '', model: '', apiKey: '', glossary: '', output: 'bilingual', autoOpen: true,
});

const bounded = (value: unknown, limit: number) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const language = (value: unknown, fallback: string, auto = false) => {
    const text = bounded(value, 32);
    return (auto && text === 'auto' || /^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/iu.test(text)) ? text : fallback;
};

/** 完整接口和常见根地址均可填写；验证错误不包含原始 URL 或凭据。 */
export function normalizeCompatibleEndpoint(value: string): string {
    let url: URL;
    try {url = new URL(value.trim());} catch {throw new Error('请填写有效的翻译接口地址');}
    const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
        throw new Error('翻译接口须使用 HTTPS；本机模型可使用回环 HTTP 地址');
    }
    if (url.username || url.password || url.search || url.hash) {
        throw new Error('接口地址不能包含账号、密码、查询参数或片段；请将密钥填入 API Key');
    }
    const path = url.pathname.replace(/\/+$/u, '');
    if (!path) url.pathname = '/v1/chat/completions';
    else if (/\/v\d+$/u.test(path)) url.pathname = `${path}/chat/completions`;
    else url.pathname = path;
    return url.toString();
}

export function normalizeSettings(value: unknown): TranslationSettings {
    const data = value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) as Partial<TranslationSettings> : {};
    let endpoint = '';
    const candidate = bounded(data.endpoint, 2048);
    if (candidate) {try {endpoint = normalizeCompatibleEndpoint(candidate);} catch { /* 损坏或含凭据的旧地址不进入任务快照。 */ }}
    return {
        sourceLanguage: language(data.sourceLanguage, defaultSettings.sourceLanguage, true),
        targetLanguage: language(data.targetLanguage, defaultSettings.targetLanguage),
        service: data.service === 'compatible' ? 'compatible' : 'microsoft',
        endpoint, model: bounded(data.model, 200), apiKey: bounded(data.apiKey, 16_384),
        glossary: bounded(data.glossary, 20_000), output: data.output === 'translated' ? 'translated' : 'bilingual',
        autoOpen: typeof data.autoOpen === 'boolean' ? data.autoOpen : defaultSettings.autoOpen,
    };
}
