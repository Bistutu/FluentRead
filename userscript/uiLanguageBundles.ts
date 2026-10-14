/**
 * @file userscript/uiLanguageBundles.ts
 * 文件职责：按需加载并注册 userscript 的六种非中文界面语言。
 * 主要内容：英文内嵌 gzip；其他语言从静态 JSON 获取并缓存在 GM 私有存储中，注册时补齐缺少的错误恢复与 AI 翻译超时文案，保留已发布远端文件内容与提交号。
 * 模块边界：只注册核心 i18n 资源，不访问宿主网页存储；扩展继续使用自己的按需资源加载器。
 */
import {
    hasUiLanguageBundle,
    normalizeUiLanguage,
    registerUiLanguageBundle,
    type RegisteredUiLanguage,
    type UiLanguageBundle,
} from '@/src/core/i18n';
import type {EnsureUiLanguageBundle, renderWithUiLanguageBundle as RenderWithUiLanguageBundle} from '@/src/platform/i18n/uiLanguageBundles';
import {inflateGzipBase64} from './compression';
import {userscriptFetch} from './http';
import {getStoredValue, setStoredValue} from './storage';
import {aiRequestTimeoutMessages} from '@/src/core/i18n/messages/aiRequestTimeout';

const pending = new Map<RegisteredUiLanguage, Promise<boolean>>();

type RecoveryMessages = Readonly<Record<'learning.panelLoadError' | 'learning.reloadPage', string>>;
// 固定远程词典保持原发布内容；仅在注册时补齐缺少的恢复文案。
const recoveryMessages: Readonly<Partial<Record<RegisteredUiLanguage, RecoveryMessages>>> = {
    'ja-JP': {
        "learning.panelLoadError": "この項目を開けませんでした。ページを再読み込みして、もう一度お試しください。",
        "learning.reloadPage": "ページを再読み込み",
    },
    'ko-KR': {
        "learning.panelLoadError": "이 항목을 열 수 없습니다. 페이지를 새로고침한 후 다시 시도하세요.",
        "learning.reloadPage": "페이지 새로고침",
    },
    'fr-FR': {
        "learning.panelLoadError": "Cette section n’a pas pu être ouverte. Rechargez la page pour réessayer.",
        "learning.reloadPage": "Recharger la page",
    },
    'ru-RU': {
        "learning.panelLoadError": "Не удалось открыть этот раздел. Перезагрузите страницу и попробуйте снова.",
        "learning.reloadPage": "Перезагрузить страницу",
    },
    'es-ES': {
        "learning.panelLoadError": "No se pudo abrir esta sección. Recarga la página para volver a intentarlo.",
        "learning.reloadPage": "Recargar página",
    },
};

async function inflateBundle(base64: string): Promise<UiLanguageBundle> {
    return JSON.parse(await inflateGzipBase64(base64)) as UiLanguageBundle;
}

function isBundle(value: unknown): value is UiLanguageBundle {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = value as Partial<UiLanguageBundle>;
    return Boolean(candidate.messages && typeof candidate.messages === 'object' && !Array.isArray(candidate.messages)
        && Object.values(candidate.messages).every((message) => typeof message === 'string')
        && candidate.legacyText && typeof candidate.legacyText === 'object' && !Array.isArray(candidate.legacyText)
        && Object.values(candidate.legacyText).every((message) => typeof message === 'string')
        && Array.isArray(candidate.legacyPatterns?.early)
        && Array.isArray(candidate.legacyPatterns?.late)
        && [...candidate.legacyPatterns.early, ...candidate.legacyPatterns.late].every((entry) => Array.isArray(entry)
            && typeof entry[0] === 'string' && typeof entry[1] === 'string'
            && (entry[2] === undefined || (Array.isArray(entry[2]) && entry[2].every(Number.isSafeInteger)))));
}

async function fetchRemoteBundle(fileName: string): Promise<UiLanguageBundle> {
    const cacheKey = `fluentread:ui-language:${fileName}`;
    const cached = await getStoredValue<UiLanguageBundle>(cacheKey).catch(() => null);
    if (isBundle(cached)) return cached;

    const sources = [
        `https://cdn.jsdelivr.net/gh/FluentRead/FluentRead@${__FLUENTREAD_USERSCRIPT_RESOURCE_COMMIT__}/userscript/languages/${fileName}`,
        `https://raw.githubusercontent.com/FluentRead/FluentRead/${__FLUENTREAD_USERSCRIPT_RESOURCE_COMMIT__}/userscript/languages/${fileName}`,
    ];
    let lastError: unknown;
    for (const url of sources) {
        try {
            const response = await userscriptFetch(url, {credentials: 'omit'});
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const bundle = await response.json();
            if (!isBundle(bundle)) throw new TypeError('界面语言资源格式无效');
            // GM 私有存储只是离线缓存；缓存失败不影响本次显示。
            await setStoredValue(cacheKey, bundle).catch(() => undefined);
            return bundle;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError;
}

export const ensureUiLanguageBundle: EnsureUiLanguageBundle = (value) => {
    const language = normalizeUiLanguage(value);
    if (hasUiLanguageBundle(language)) return Promise.resolve(true);
    const registered = language as RegisteredUiLanguage;
    const embedded = registered === 'en-US' ? globalThis.__FLUENTREAD_USERSCRIPT_DATA__?.english : undefined;
    const compressed = __FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__[registered];
    const remoteFile = __FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__[registered];
    if (!embedded && !compressed && !remoteFile) return Promise.resolve(false);
    const existing = pending.get(registered);
    if (existing) return existing;
    const request = (embedded ? Promise.resolve(embedded) : compressed ? inflateBundle(compressed) : fetchRemoteBundle(remoteFile))
        .then((bundle) => {
            if (!isBundle(bundle)) throw new TypeError('界面语言资源格式无效');
            const recovery = recoveryMessages[registered];
            registerUiLanguageBundle(registered, {...bundle, messages: {
                ...recovery, ...bundle.messages, ...aiRequestTimeoutMessages[registered],
            }});
            return true;
        })
        .catch((error: unknown) => {
            console.warn('[FluentRead] userscript 界面语言资源不可用', error);
            return false;
        })
        .finally(() => pending.delete(registered));
    pending.set(registered, request);
    return request;
};

export const renderWithUiLanguageBundle: typeof RenderWithUiLanguageBundle = (language, render) => {
    render();
    if (hasUiLanguageBundle(normalizeUiLanguage(language))) return;
    void ensureUiLanguageBundle(language).then((loaded) => { if (loaded) render(); });
};
