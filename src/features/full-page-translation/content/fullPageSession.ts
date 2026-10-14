/**
 * @file src/features/full-page-translation/content/fullPageSession.ts
 * 文件职责：作为一次全文翻译的状态与资源所有者，配对创建候选队列、请求取消域、动态 DOM 索引及幂等销毁。
 * 主要内容：集中声明会话数据，接收已冻结配置和观察器端口，建立独立结果、重试与用户取消记录；销毁先撤销提交资格，再取消等待、计时器、观察器和订阅，清空强引用与结果缓存并结束进度。
 * 模块边界：不读取全局配置、不创建页面候选、不调度 provider 或写译文 DOM；runtime 注入观察器回调及展示/来源稳定端口，requestSession 继续管理真实传输取消和缓存代次。
 */
import type {FullPageTranslationMode} from '@/src/core/config/model';
import type {TranslationCandidate, TranslationDiscoveryStep, TranslationScope} from '@/src/core/translation/public';
import {createFullPageOutcomeRegistry} from '../core/outcomes';
import {createBilingualRemountCapitulationRegistry} from './bilingualRemount';
import {clearFullPageQueueState, createFullPageQueueState, type FullPageQueueState} from './fullPageQueue';
import type {ModalPrioritySession} from './modalSession';
import {createFullPageRequestSessionState, disposeFullPageRequestSession, type FullPageRequestSessionState} from './requestSession';
import type {FullPageTranslationCacheEntry, FullPageTranslationConfigSnapshot} from './translationRequest';
import type {FullPageLifecycleRetry} from './translationStability';
import type {FullPageScrollController} from './viewportStability';

export interface FullPageSession extends FullPageRequestSessionState, ModalPrioritySession, FullPageQueueState {
    dispose(): void;
    translationMode: FullPageTranslationMode;
    scope: TranslationScope;
    /** 会话启动时冻结所有会改变译文或 DOM 表达的配置，防止设置热更新混入当前页面。 */
    translationConfig: FullPageTranslationConfigSnapshot;
    progressSessionId: number;
    progressPublishScheduled: boolean;
    outcomes: ReturnType<typeof createFullPageOutcomeRegistry<HTMLElement>>;
    unsubscribeOutcomeChanges: () => void;
    observer: IntersectionObserver;
    mutationObserver: MutationObserver;
    shadowEventController: AbortController;
    /** 可见性锚点 -> 等待该锚点进入视口的候选。 */
    observedCandidates: Map<HTMLElement, Map<Node, TranslationCandidate>>;
    /** 最近一次 IO 通知为可见的锚点；同锚点迟到的候选需立即入队。 */
    visibleCandidateAnchors: WeakSet<HTMLElement>;
    /** 候选元素 -> 候选 key；与可见性锚点分开保存，便于精确清理。 */
    candidateOwnerKeys: Map<HTMLElement, Set<Node>>;
    /** 宿主 owner/祖先 -> 其下活跃翻译目标，避免 mutation 时全局扫描状态。 */
    statefulTargetsByAncestor: Map<Element, Set<HTMLElement>>;
    /** 活跃目标 -> 上述索引中为它登记的精确祖先 key。 */
    statefulAncestorsByTarget: WeakMap<HTMLElement, readonly Element[]>;
    /** provider 请求在途时失效候选的有界即时重试记录。 */
    lifecycleRetries: WeakMap<Node, FullPageLifecycleRetry>;
    /** 限定在本次全文会话内的 provider/语言“无需变更”判定。 */
    unchangedCandidates: WeakMap<Node, FullPageLifecycleRetry>;
    /**
     * 用户在本次全文会话中显式恢复的候选标识。来源快照允许真实宿主编辑
     * 清除取消墓碑，同时让扩展自身产生的恢复 mutation 继续排除该片段。
     * 按节点弱关联，不因保留取消记录而延长已被宿主删除节点的生命周期。
     */
    userCancelledCandidates: WeakMap<Node, string>;
    /** 用户滚动期间暂停新增翻译/重排，等待虚拟列表稳定后再继续。 */
    scrollController: FullPageScrollController;
    /** 宿主连续拒绝 wrapper 后，对稳定边界内的同源候选停止写 DOM。 */
    bilingualRemountCapitulations: ReturnType<typeof createBilingualRemountCapitulationRegistry>;
    /**
     * 本次全文会话已经请求过的翻译结果。宿主框架可能在样式/布局 mutation 后
     * 重新挂载同一段正文；此缓存避免生命周期抖动再次发出相同 provider 请求。
     */
    translationSlotCache: Map<string, FullPageTranslationCacheEntry>;
    draining: boolean;
    flushTimer: number | null;
    dirtyRoots: Set<Node>;
    mutationFlushTimer: number | null;
    activeDiscovery: {root: Node; steps: Generator<TranslationDiscoveryStep>} | null;
    broadRescanRoots: WeakSet<Node>;
    dirtyRootsBroadMode: boolean;
    pruneTimer: number | null;
    pruneIterator: Iterator<TranslationCandidate> | null;
    pruneRequested: boolean;
    statefulAttributeTimers: Map<HTMLElement, {timer: number; boundaryTimer?: number}>;
    statefulAttributeRescanTargets: WeakSet<HTMLElement>;
}
interface FullPageSessionPorts {
    root: HTMLElement;
    translationMode: FullPageTranslationMode;
    scope: TranslationScope;
    translationConfig: FullPageTranslationConfigSnapshot;
    progressSessionId: number;
    observer: IntersectionObserver;
    mutationObserver: MutationObserver;
    scrollController: FullPageScrollController;
    createAbortError(): Error;
    clearTimeout(timer: number): void;
    clearModalPresentation(): void;
    releaseSourceStability(session: FullPageSession): void;
    finishProgress(sessionId: number): void;
}

/** 初始化和释放由同一个会话所有者维护，runtime 只提供当前页面的副作用端口。 */
export function createFullPageSessionState(ports: FullPageSessionPorts): FullPageSession {
    let disposed = false;
    const session: FullPageSession = {
        active: true,
        dispose: () => dispose(),
        modal: null,
        modalDirty: true,
        translationMode: ports.translationMode,
        scope: ports.scope,
        translationConfig: ports.translationConfig,
        progressSessionId: ports.progressSessionId,
        progressPublishScheduled: false,
        outcomes: createFullPageOutcomeRegistry<HTMLElement>(),
        unsubscribeOutcomeChanges: () => {},
        observer: ports.observer,
        mutationObserver: ports.mutationObserver,
        shadowEventController: new AbortController(),
        roots: new Set(),
        ...createFullPageQueueState(),
        scheduled: new Map(),
        observedCandidates: new Map(),
        visibleCandidateAnchors: new WeakSet(),
        candidateOwnerKeys: new Map(),
        statefulTargetsByAncestor: new Map(),
        statefulAncestorsByTarget: new WeakMap(),
        lifecycleRetries: new WeakMap(),
        unchangedCandidates: new WeakMap(),
        userCancelledCandidates: new WeakMap(),
        inFlightCandidates: new Map(),
        scrollController: ports.scrollController,
        bilingualRemountCapitulations: createBilingualRemountCapitulationRegistry(),
        translationSlotCache: new Map(),
        ...createFullPageRequestSessionState(),
        draining: false,
        flushTimer: null,
        dirtyRoots: new Set(),
        mutationFlushTimer: null,
        activeDiscovery: null,
        broadRescanRoots: new WeakSet([ports.root]),
        broadRescanCooldowns: new WeakMap(),
        dirtyRootsBroadMode: false,
        pruneTimer: null,
        pruneIterator: null,
        pruneRequested: false,
        statefulAttributeTimers: new Map(),
        statefulAttributeRescanTargets: new WeakSet(),
    };

    function dispose(): void {
        if (disposed) return;
        disposed = true;
        session.active = false;
        session.unsubscribeOutcomeChanges();
        session.outcomes.clear();
        ports.clearModalPresentation();
        session.modal = null;
        session.modalDirty = false;
        disposeFullPageRequestSession(session, ports.createAbortError());
        if (session.flushTimer !== null) ports.clearTimeout(session.flushTimer);
        if (session.mutationFlushTimer !== null) ports.clearTimeout(session.mutationFlushTimer);
        if (session.pruneTimer !== null) ports.clearTimeout(session.pruneTimer);
        session.scrollController.dispose();
        ports.releaseSourceStability(session);
        session.statefulAttributeTimers.forEach(({timer, boundaryTimer}) => {
            ports.clearTimeout(timer);
            if (boundaryTimer !== undefined) ports.clearTimeout(boundaryTimer);
        });
        session.observer.disconnect();
        session.mutationObserver.disconnect();
        session.shadowEventController.abort();
        session.roots.clear();
        clearFullPageQueueState(session);
        session.scheduled.clear();
        session.observedCandidates.clear();
        session.visibleCandidateAnchors = new WeakSet();
        session.candidateOwnerKeys.clear();
        session.statefulTargetsByAncestor.clear();
        session.statefulAncestorsByTarget = new WeakMap();
        session.inFlightCandidates.clear();
        session.userCancelledCandidates = new WeakMap();
        session.translationSlotCache.clear();
        session.dirtyRoots.clear();
        session.dirtyRootsBroadMode = false;
        session.activeDiscovery = null;
        session.pruneIterator = null;
        session.pruneRequested = false;
        session.statefulAttributeTimers.clear();
        session.statefulAttributeRescanTargets = new WeakSet();
        ports.finishProgress(session.progressSessionId);
    }
    return session;
}
