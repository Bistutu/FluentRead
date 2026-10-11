/**
 * @file src/features/full-page-translation/content/routeLifecycle.ts
 * 文件职责：在全文翻译会话跨 SPA 页面时重置旧页面的请求取消域、发现工作和临时判定。
 * 主要内容：清理重试熔断、无需变更证据、旧发现迭代器和扫描冷却；使旧请求失效并登记当前文档根的增量重扫，保留已提交译文和用户局部恢复的所有权。
 * 模块边界：只操作传入会话和既有请求生命周期；DOM 观察与发现由 runtime 注入，不扫描页面、不请求 provider，也不决定网站规则或手动恢复意图。
 */
import type {TranslationDiscoveryStep} from '@/src/core/translation/public';
import {createBilingualRemountCapitulationRegistry} from './bilingualRemount';
import {invalidateFullPageRequestSessionForRoute, type FullPageRequestSessionState} from './requestSession';
import type {FullPageTranslationCacheEntry} from './translationRequest';
import type {FullPageLifecycleRetry} from './translationStability';

export interface FullPageRouteLifecycleSession extends FullPageRequestSessionState {
    active: boolean;
    translationSlotCache: Map<string, FullPageTranslationCacheEntry>;
    bilingualRemountCapitulations: ReturnType<typeof createBilingualRemountCapitulationRegistry>;
    lifecycleRetries: WeakMap<Node, FullPageLifecycleRetry>;
    unchangedCandidates: WeakMap<Node, FullPageLifecycleRetry>;
    activeDiscovery: {root: Node; steps: Generator<TranslationDiscoveryStep>} | null;
    dirtyRoots: Set<Node>;
    dirtyRootsBroadMode: boolean;
    broadRescanCooldowns: WeakMap<Node, number>;
}

interface FullPageRouteRootHooks<TSession extends FullPageRouteLifecycleSession> {
    observe(session: TSession, root: Node): void;
    rescan(session: TSession, root: Node): void;
}

/** 新路由只登记一个脏根；既有 discoverSteps 将分片发现开放 ShadowRoot 并挂载观察器。 */
export function resetFullPageRouteSession<TSession extends FullPageRouteLifecycleSession>(
    session: TSession | null,
    root: Node | null,
    hooks: FullPageRouteRootHooks<TSession>,
): void {
    if (!session?.active) return;
    session.bilingualRemountCapitulations = createBilingualRemountCapitulationRegistry();
    session.lifecycleRetries = new WeakMap();
    session.unchangedCandidates = new WeakMap();
    invalidateFullPageRequestSessionForRoute(session);
    session.activeDiscovery = null;
    session.dirtyRoots.clear();
    session.dirtyRootsBroadMode = false;
    session.broadRescanCooldowns = new WeakMap();
    // URL 可以改变站点适配规则；宿主复用原节点而未产生 mutation 时也需要重扫。
    if (!root) return;
    hooks.observe(session, root);
    hooks.rescan(session, root);
}
