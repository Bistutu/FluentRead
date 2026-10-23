import {installOptionsApp} from '@/src/app/options';
import OptionsApp from '@/src/app/options/OptionsApp.vue';
import {createVueShadowUi, type VueShadowMount} from '@/src/platform/shadow-ui';
import type {ShadowRootContentScriptUi} from 'wxt/utils/content-script-ui/shadow-root';
import {getUserscriptFunction} from './api';
import {installUserscriptInterfaceFontPreviews, type UserscriptInterfaceFontPreviewMount} from './interfaceFontPreviews';
import {
    buildUserscriptSettingsHash,
    buildUserscriptSettingsUrl,
    isUserscriptSettingsUrl,
    USERSCRIPT_SETTINGS_HASH,
} from './settingsPage';

export {buildUserscriptSettingsUrl, isUserscriptSettingsUrl};

let settingsUi: ShadowRootContentScriptUi<VueShadowMount> | null = null;
let settingsMountPromise: Promise<void> | null = null;
let settingsGeneration = 0;
let tabOpenSequence = 0;
let settingsPreviewFonts: UserscriptInterfaceFontPreviewMount | null = null;
let hiddenBallHost: HTMLElement | null = null;
let previousBallSuspendedAttribute: string | null = null;
let ballObserver: MutationObserver | null = null;

function restoreHiddenBallHost(): void {
    if (hiddenBallHost && hiddenBallHost.getAttribute('data-fluent-read-ui-suspended') === 'true') {
        if (previousBallSuspendedAttribute !== null) {
            hiddenBallHost.setAttribute('data-fluent-read-ui-suspended', previousBallSuspendedAttribute);
        } else {
            hiddenBallHost.removeAttribute('data-fluent-read-ui-suspended');
        }
    }
    hiddenBallHost = null;
    previousBallSuspendedAttribute = null;
}

function restoreFloatingBall(): void {
    ballObserver?.disconnect();
    ballObserver = null;
    restoreHiddenBallHost();
}

function hideFloatingBallBehindOverlay(): void {
    if (typeof document === 'undefined' || ballObserver) return;
    const sync = () => {
        const nextHost = document.querySelector<HTMLElement>(
            '#fluent-read-floating-ball-container[data-fluent-read-userscript-host="fluent-read-floating-ball-ui"]',
        );
        if (nextHost === hiddenBallHost) return;
        restoreHiddenBallHost();
        if (!nextHost) return;
        hiddenBallHost = nextHost;
        previousBallSuspendedAttribute = nextHost.getAttribute('data-fluent-read-ui-suspended');
        nextHost.setAttribute('data-fluent-read-ui-suspended', 'true');
    };
    if (typeof MutationObserver !== 'undefined') {
        ballObserver = new MutationObserver(sync);
        ballObserver.observe(document.documentElement, {childList: true, subtree: true});
    }
    sync();
}

function showInPageFallback(ctx: unknown, section?: string): void {
    void mountSettingsUi(ctx, section).catch((error) => {
        console.error('[FluentRead userscript] 设置标签页和页内回退都未能打开', error);
    });
}

function openSettingsTab(ctx: unknown, section?: string): boolean {
    const sequence = ++tabOpenSequence;
    const generation = settingsGeneration;
    const fallback = () => {
        if (sequence === tabOpenSequence && generation === settingsGeneration) showInPageFallback(ctx, section);
    };
    const settingsUrl = buildUserscriptSettingsUrl(window.location.href, section);
    if (settingsUrl === window.location.href) return false;

    // Android WebView 的脚本管理器可能无视 active 参数，在后台打开标签页。
    // 在移动端直接挂载页内设置，让点击悬浮球后立即看到操作结果。
    if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)) return false;

    // Tampermonkey/Violentmonkey 等管理器提供的专用 API 可显式激活新标签页。
    // 未提供此能力时直接使用页内面板；普通 window.open 可能只在后台
    // 创建标签页，让用户误以为点击设置没有反应。
    const legacyOpenInTab = getUserscriptFunction('GM_openInTab');
    if (legacyOpenInTab) {
        try {
            const result = legacyOpenInTab(settingsUrl, {active: true, insert: true, setParent: true});
            void Promise.resolve(result).catch(fallback);
            return true;
        } catch {
            // 部分管理器只声明 API 但运行时不可用，继续尝试现代接口。
        }
    }

    const modernOpenInTab = getUserscriptFunction(undefined, 'openInTab');
    if (modernOpenInTab) {
        try {
            // Userscripts for Safari uses a boolean background flag and returns
            // a Promise. Invoke it before any async work so the current click
            // remains a valid user gesture for opening a new tab.
            void Promise.resolve(modernOpenInTab(settingsUrl, false))
                .catch(fallback);
            return true;
        } catch {
            // 直接使用页内面板。
        }
    }
    return false;
}

export async function openUserscriptSettings(ctx: unknown, section?: string): Promise<void> {
    if (!isUserscriptSettingsUrl(window.location.href) && openSettingsTab(ctx, section)) return;
    await mountSettingsUi(ctx, section);
}

async function mountSettingsUi(ctx: unknown, section?: string): Promise<void> {
    const separateSettingsPage = isUserscriptSettingsUrl(window.location.href);
    if (separateSettingsPage && section) {
        const nextHash = buildUserscriptSettingsHash(section);
        if (window.location.hash !== nextHash) window.location.hash = nextHash;
    }
    if (settingsUi) return;
    if (settingsMountPromise) return settingsMountPromise;
    const generation = settingsGeneration;
    const previewFonts = installUserscriptInterfaceFontPreviews();
    settingsPreviewFonts = previewFonts;
    if (!separateSettingsPage) hideFloatingBallBehindOverlay();
    const mountPromise = (async () => {
        const ui = await createVueShadowUi(ctx as never, {
            name: 'fluent-read-userscript-settings-ui',
            hostId: 'fluent-read-userscript-settings-container',
            component: OptionsApp,
            props: (container) => {
                const root = container.getRootNode();
                const shadowRoot = root instanceof ShadowRoot ? root : null;
                return {
                    appearanceRoot: shadowRoot?.host instanceof HTMLElement ? shadowRoot.host : null,
                    queryRoot: root,
                    settingsHashPrefix: separateSettingsPage ? USERSCRIPT_SETTINGS_HASH : undefined,
                    initialSection: separateSettingsPage ? undefined : section,
                    locationRouting: separateSettingsPage ? undefined : 'internal',
                    onClose: separateSettingsPage ? undefined : closeUserscriptSettings,
                };
            },
            configureApp: (app, container) => {
                installOptionsApp(app, {documentRoot: null, uiRoot: container});
                app.onUnmount(previewFonts.dispose);
            },
            viewport: true,
            zIndex: 2_147_483_647,
            mode: 'closed',
        });
        if (generation !== settingsGeneration) {
            previewFonts.dispose();
            ui.remove();
        } else settingsUi = ui;
    })();
    settingsMountPromise = mountPromise;
    try {
        await mountPromise;
    } catch (error) {
        previewFonts.dispose();
        if (settingsPreviewFonts === previewFonts) settingsPreviewFonts = null;
        if (generation === settingsGeneration) restoreFloatingBall();
        throw error;
    } finally {
        if (settingsMountPromise === mountPromise) settingsMountPromise = null;
    }
}

export function closeUserscriptSettings(): void {
    settingsGeneration += 1;
    settingsMountPromise = null;
    const ui = settingsUi;
    settingsUi = null;
    const previewFonts = settingsPreviewFonts;
    settingsPreviewFonts = null;
    try {
        previewFonts?.dispose();
        ui?.remove();
    } finally {
        restoreFloatingBall();
    }
}
