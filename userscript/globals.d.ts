import type {UiLanguageBundle} from '@/src/core/i18n';

export {};

declare global {
    interface UserscriptXmlHttpResponse {
        finalUrl?: string;
        readyState?: number;
        response?: unknown;
        responseHeaders?: string;
        responseText?: string;
        status: number;
        statusText?: string;
    }

    interface UserscriptXmlHttpRequestDetails {
        method?: string;
        url: string;
        headers?: Record<string, string>;
        data?: unknown;
        responseType?: 'arraybuffer' | 'blob' | 'json' | 'text';
        anonymous?: boolean;
        redirect?: 'follow' | 'error' | 'manual';
        timeout?: number;
        onload?: (response: UserscriptXmlHttpResponse) => void;
        onerror?: (response: UserscriptXmlHttpResponse) => void;
        onabort?: (response: UserscriptXmlHttpResponse) => void;
        ontimeout?: (response: UserscriptXmlHttpResponse) => void;
    }

    interface UserscriptXmlHttpRequestHandle {
        abort?: () => void;
    }

    interface UserscriptModernApi {
        info?: UserscriptManagerInfo;
        getValue?: (key: string, defaultValue?: unknown) => unknown;
        setValue?: (key: string, value: unknown) => unknown;
        deleteValue?: (key: string) => unknown;
        listValues?: () => unknown;
        xmlHttpRequest?: (details: UserscriptXmlHttpRequestDetails) => unknown;
        registerMenuCommand?: (label: string, listener: () => void) => unknown;
        openInTab?: (url: string, openInBackground?: boolean) => unknown;
    }

    var GM: UserscriptModernApi | undefined;
    interface UserscriptManagerInfo {
        isIncognito?: boolean;
        isPrivate?: boolean;
        scriptHandler?: string;
        version?: string;
        platform?: {browserName?: string; os?: string};
    }
    var GM_info: UserscriptManagerInfo | undefined;

    var GM_getValue: undefined | (<T>(key: string, defaultValue?: T) => T | Promise<T>);
    var GM_setValue: undefined | ((key: string, value: unknown) => void | Promise<void>);
    var GM_deleteValue: undefined | ((key: string) => void | Promise<void>);
    var GM_listValues: undefined | (() => string[] | Promise<string[]>);
    var GM_xmlhttpRequest: undefined | ((details: UserscriptXmlHttpRequestDetails) => UserscriptXmlHttpRequestHandle | void);
    var GM_registerMenuCommand: undefined | ((label: string, listener: () => void) => unknown);
    var GM_openInTab: undefined | ((url: string, options?: Record<string, unknown>) => unknown);
    var GM_addStyle: undefined | ((css: string) => unknown);
    var unsafeWindow: Window | undefined;
    var __FLUENTREAD_ICON_DATA__: string | undefined;
    var __FLUENTREAD_APPROVE_DATA__: string | undefined;
    var __fluentReadUserscriptCss: string | undefined;
    var __fluentReadUserscriptCssCompressed: string | undefined;
    var __FLUENTREAD_USERSCRIPT_DATA__: {
        english: UiLanguageBundle;
        zhCNMessages: Record<string, unknown>;
        siteCatalogs: Record<string, unknown>;
        css: string;
    } | undefined;
    var pako: {ungzip(data: Uint8Array, options?: {to?: string}): string | Uint8Array} | undefined;
    const __FLUENTREAD_USERSCRIPT_LANGUAGE_UPDATES__: string;
    const __FLUENTREAD_USERSCRIPT_LANGUAGE_BUNDLES__: Readonly<Record<string, string>>;
    const __FLUENTREAD_USERSCRIPT_REMOTE_LANGUAGES__: Readonly<Record<string, string>>;
    const __FLUENTREAD_USERSCRIPT_RESOURCE_COMMIT__: string;
    const __FLUENTREAD_FULL_OPTIONS__: boolean;
    var browser: any;
    var chrome: any;
}
