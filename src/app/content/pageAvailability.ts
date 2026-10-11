/**
 * @file src/app/content/pageAvailability.ts
 * 文件职责：统一协调 content 总开关、站点禁用、YouTube SPA 路由与页面功能的 activate/dispose 边界。
 * 主要内容：幂等启停 MAIN-world bridge 和页面 feature，限制失效挂载重试次数，维护视频字幕路由挂载；按排除普通锚点的页面身份记录自动翻译意图，使新 SPA 页面可重新启动、手动恢复后的同页保持原文，并让自动翻译不受非必要 UI 的异步挂载阻塞。
 * 模块边界：本模块不读取全局配置、不操作具体功能 DOM；composition root 注入当前可用性、挂载器和全文状态，具体 feature 保留自己的清理实现。
 */
import {shouldAutoTranslatePage} from '@/src/features/site-rules/domain';

interface ContentAutoTranslationConfig {
    on: boolean;
    autoTranslate: boolean;
    alwaysTranslateDomains: string[];
    disabledExtensionDomains: string[];
}

export function shouldAutomaticallyTranslatePage(
    href: string,
    config: ContentAutoTranslationConfig,
): boolean {
    return shouldAutoTranslatePage(href, config);
}

/** 普通页内锚点只是阅读位置；路径、查询与 #/、#!/ 风格的 SPA 路由代表新页面。 */
export function getAutoTranslationPageIdentity(href: string): string {
    try {
        const url = new URL(href);
        if (!/^#!?\//.test(url.hash)) url.hash = '';
        return url.href;
    } catch {
        return href.split('#', 1)[0]!;
    }
}

export interface ContentPageAvailabilityDependencies {
    isEnabled(): boolean;
    isPageFeaturesActive(): boolean;
    isVideoPage(): boolean;
    getPageIdentity?(): string;
    shouldAutomaticallyTranslate(): boolean;
    isFullPageTranslationActive(): boolean;
    setMainWorldBridgesEnabled(enabled: boolean): void;
    activatePageFeatures(): Promise<void>;
    disposePageFeatures(): void;
    mountVideoSubtitle(): () => void;
    autoTranslate(): void;
}

export interface ContentPageAvailabilityRuntime {
    needsLifecycleReconcile(): boolean;
    reconcile(): Promise<void>;
    refreshAutoTranslation(): void;
    syncVideoSubtitlePage(): void;
    disposeVideoSubtitlePage(): void;
}

/** 创建一个 document 私有的可用性协调器，避免配置订阅和路由事件各自维护半套状态。 */
export function createContentPageAvailabilityRuntime(
    dependencies: ContentPageAvailabilityDependencies,
): ContentPageAvailabilityRuntime {
    let videoSubtitlePageActive = false;
    let disposeVideoSubtitle: (() => void) | null = null;
    let shouldAutomaticallyTranslate = false;
    let autoTranslationPageIdentity: string | null = null;
    let reconcileTail = Promise.resolve();
    let disabledStateApplied = false;

    const disposeVideoSubtitlePage = (): void => {
        disposeVideoSubtitle?.();
        disposeVideoSubtitle = null;
        videoSubtitlePageActive = false;
    };
    const syncVideoSubtitlePage = (): void => {
        const shouldMount = dependencies.isEnabled() && dependencies.isVideoPage();
        if (shouldMount === videoSubtitlePageActive) return;
        disposeVideoSubtitlePage();
        if (!shouldMount) return;
        disposeVideoSubtitle = dependencies.mountVideoSubtitle();
        videoSubtitlePageActive = true;
    };
    const refreshAutoTranslation = (): void => {
        if (!dependencies.isEnabled()) {
            shouldAutomaticallyTranslate = false;
            autoTranslationPageIdentity = null;
            return;
        }
        const pageIdentity = getAutoTranslationPageIdentity(dependencies.getPageIdentity?.() ?? '');
        const nextValue = dependencies.shouldAutomaticallyTranslate();
        const shouldStartNow = nextValue && (!shouldAutomaticallyTranslate || autoTranslationPageIdentity !== pageIdentity);
        shouldAutomaticallyTranslate = nextValue;
        // 同页面已尝试过即保留用户之后的恢复意图；新页面与规则重新开启才重新授权。
        autoTranslationPageIdentity = pageIdentity;
        if (shouldStartNow && !dependencies.isFullPageTranslationActive()) dependencies.autoTranslate();
    };
    const disablePageRuntime = (): void => {
        shouldAutomaticallyTranslate = false;
        autoTranslationPageIdentity = null;
        if (disabledStateApplied) return;
        disabledStateApplied = true;
        dependencies.setMainWorldBridgesEnabled(false);
        disposeVideoSubtitlePage();
        dependencies.disposePageFeatures();
    };
    const reconcileLatest = async (): Promise<void> => {
        // activate 可能跨越配置写入或站点规则变化；每次 await 后都重新读取权威状态。
        for (let attempt = 0; attempt < 2; attempt += 1) {
            if (!dependencies.isEnabled()) {
                disablePageRuntime();
                return;
            }
            disabledStateApplied = false;
            dependencies.setMainWorldBridgesEnabled(true);
            const activation = dependencies.activatePageFeatures();
            // composition root 在首个 await 前发布 featureController 并安装样式。
            // 全文会话自持 DOM observer 和取消域，不必等待 share-card 等 UI 完成。
            if (dependencies.isEnabled() && dependencies.isPageFeaturesActive()) refreshAutoTranslation();
            await activation;
            if (!dependencies.isEnabled()) {
                disablePageRuntime();
                return;
            }
            // 失效期间 dispose 会让刚完成的 activation 过期；重新激活而不是发布半激活状态。
            if (!dependencies.isPageFeaturesActive()) continue;
            dependencies.setMainWorldBridgesEnabled(true);
            syncVideoSubtitlePage();
            refreshAutoTranslation();
            return;
        }
        // 持续失效的挂载不能占满微任务队列；释放半挂载状态，等待下一次真实状态变更。
        disablePageRuntime();
    };
    const reconcile = (): Promise<void> => {
        // 关闭必须同步回收，不能排在仍可能悬挂的 activation 后面。
        if (!dependencies.isEnabled()) {
            disablePageRuntime();
        }
        const task = reconcileTail.then(reconcileLatest);
        // 单个激活失败不能毒化后续配置变更；调用方仍会收到本次异常。
        reconcileTail = task.catch(() => undefined);
        return task;
    };

    return {
        needsLifecycleReconcile: () => dependencies.isEnabled() !== dependencies.isPageFeaturesActive(),
        reconcile,
        refreshAutoTranslation,
        syncVideoSubtitlePage,
        disposeVideoSubtitlePage,
    };
}
