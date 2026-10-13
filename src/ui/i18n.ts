/**
 * @file src/ui/i18n.ts
 *
 * 文件职责：把 core i18n 的纯翻译能力接入 Vue，并在每个扩展 UI runtime 中
 * 订阅共享配置、即时切换语言和安全迁移尚未 key 化的旧文案。
 * 主要内容：提供 createUiI18nPlugin、useUiI18n 和 v-ui-i18n 指令；语言切换时按需加载资源包，
 * 选择以调用身份串行提交字段补丁，旧资源、旧失败和已销毁 runtime 不得回写新选择；资源到达后通过 bundleRevision 刷新渲染与旧文案扫描；源语言界面跳过无效全树扫描，切回源语言时仍恢复旧文案。指令只扫描
 * 显式标记或传入的自有 UI 根节点，扫描容器与扩展 document 元信息权限分离；插件在正常卸载或构建失败时释放订阅、watch、observer 和延迟扫描；跳过代码、文本编辑器和用户内容及其后代文本，避免把网页正文
 * 或翻译结果误当成扩展文案。
 * 模块边界：这里负责 Vue 响应式和配置 patch，不定义语言文案；文案资源与纯
 * fallback 规则在 src/core/i18n，配置持久化仍由 services/config/store 负责。
 */

import {
    inject,
    readonly,
    ref,
    watch,
    type App,
    type Directive,
    type InjectionKey,
    type Plugin,
    type Ref,
} from 'vue';
import browser from 'webextension-polyfill';
import {
    config,
    configReady,
    requestConfigPatch,
    getConfigRevision,
    subscribeConfig,
} from '@/src/services/config/store';
import {
    DEFAULT_UI_LANGUAGE,
    hasUiLanguageBundle,
    normalizeUiLanguage,
    translate,
    translateLegacyText,
    type TranslationParams,
    type UiLanguage,
} from '@/src/core/i18n';
import {ensureUiLanguageBundle} from '@/src/platform/i18n/uiLanguageBundles';

export interface UiI18nContext {
    language: Readonly<Ref<UiLanguage>>;
    /** 当前语言资源包注册后递增；依赖它的渲染与旧文案扫描会在资源到达后自动刷新。 */
    bundleRevision: Readonly<Ref<number>>;
    t: (key: string, params?: TranslationParams) => string;
    translateLegacy: (value: string) => string;
    /** 当前选择保存成功返回 true；被新选择、外部配置或销毁取代返回 false，当前保存失败仍抛错。 */
    setLanguage: (value: unknown) => Promise<boolean>;
    dispose: () => void;
}

interface LocalizableServiceOption {
    value: string;
    label: string;
    description?: string;
    searchTerms?: string[];
}

interface ServiceProfileSummary {
    id: string;
    endpoint: string;
    models: string[];
}

/** 在 UI 边界复用本次标签译文；profile 按需索引且保留重复 ID 首项，原始名称仍用于搜索。 */
export function localizeServiceOptions<T extends LocalizableServiceOption>(
    options: readonly T[],
    profiles: readonly ServiceProfileSummary[],
    translateLegacy: (value: string) => string,
): Array<T & {searchTerms: string[]}> {
    // 单项查询沿用 find 的提前停止；批量查询只扫描未见过的前缀，不预扫整个目录。
    const profileIndex = options.length > 1 && profiles.length > 1
        ? new Map<string, ServiceProfileSummary>() : undefined;
    let profileCursor = 0;
    return options.map((option) => {
        let profile = profileIndex ? profileIndex.get(option.value) : profiles.find((item) => item.id === option.value);
        while (profileIndex && !profile && profileCursor < profiles.length) {
            const next = profiles[profileCursor++], id = next.id;
            if (!profileIndex.has(id)) profileIndex.set(id, next);
            if (id === option.value) profile = profileIndex.get(id);
        }
        const label = translateLegacy(option.label);
        return {
            ...option,
            label,
            description: option.description ? translateLegacy(option.description) : option.description,
            searchTerms: [...(option.searchTerms || []), option.label, label, ...(profile ? [profile.endpoint, ...profile.models] : [])],
        };
    });
}

export const UI_I18N_KEY: InjectionKey<UiI18nContext> = Symbol('fluentread-ui-i18n');

export function createUiI18nContext(): UiI18nContext {
    const languageState = ref<UiLanguage>(normalizeUiLanguage(config.uiLanguage || DEFAULT_UI_LANGUAGE));
    const bundleRevisionState = ref(0);
    let disposed = false;
    let renderRevision = 0;
    type LanguageChange = {
        language: UiLanguage;
        previousLanguage: UiLanguage;
        stage: 'loading' | 'queued' | 'persisting';
        invalidated: boolean;
        baseRevision?: number;
    };
    let currentChange: LanguageChange | undefined;
    let languageWriteQueue = Promise.resolve();
    const ownedWrites = new Set<LanguageChange>();

    const applyLanguage = (value: unknown): void => {
        if (disposed) return;
        const nextLanguage = normalizeUiLanguage(value);
        const revision = ++renderRevision;
        languageState.value = nextLanguage;
        // 普通配置变化频繁触发订阅；资源已注册时不做任何额外刷新。未注册时先按中文回退渲染，
        // 资源到达后只刷新仍在使用该语言的界面。
        if (hasUiLanguageBundle(nextLanguage)) return;
        void ensureUiLanguageBundle(nextLanguage).then((loaded) => {
            if (loaded && !disposed && revision === renderRevision) bundleRevisionState.value += 1;
        }).catch(() => undefined);
    };

    applyLanguage(languageState.value);
    const applyConfigLanguage = (value: unknown): void => {
        if (disposed) return;
        const nextLanguage = normalizeUiLanguage(value);
        // store 在 requestConfigPatch 内同步发布乐观值，拒绝前可能发布权威回滚。
        // 同 revision 的原语言是自己的回滚；外部同值的新 revision 不能复活旧请求。
        const owner = [...ownedWrites].find(change => {
            if (nextLanguage === change.language) {
                change.baseRevision ??= getConfigRevision();
                return true;
            }
            return nextLanguage === change.previousLanguage && change.baseRevision !== undefined
                && getConfigRevision() === change.baseRevision;
        });
        if (!owner && nextLanguage !== languageState.value && currentChange) currentChange.invalidated = true;
        if (owner && currentChange && owner !== currentChange && !currentChange.invalidated
            && currentChange.stage !== 'loading') {
            currentChange.previousLanguage = nextLanguage;
            return;
        }
        applyLanguage(nextLanguage);
    };
    const unsubscribe = subscribeConfig(nextConfig => applyConfigLanguage(nextConfig.uiLanguage));
    void configReady.then(() => {
        applyConfigLanguage(config.uiLanguage);
    }).catch(() => undefined);

    const language = readonly(languageState);
    const bundleRevision = readonly(bundleRevisionState);
    const t = (key: string, params?: TranslationParams): string => {
        void bundleRevision.value;
        return translate(key, language.value, params);
    };
    const translateLegacy = (value: string): string => {
        void bundleRevision.value;
        return translateLegacyText(value, language.value);
    };

    async function setLanguage(value: unknown): Promise<boolean> {
        if (disposed) return false;
        const change: LanguageChange = {
            language: normalizeUiLanguage(value),
            previousLanguage: currentChange && !currentChange.invalidated && currentChange.stage === 'queued'
                ? currentChange.previousLanguage : languageState.value,
            stage: 'loading',
            invalidated: false,
        };
        currentChange = change;
        const current = () => !disposed && currentChange === change && !change.invalidated;
        try {
            // 先取得资源，再预览最新选择；等待前驱存储期间也不能显示旧提交的回声。
            await Promise.all([ensureUiLanguageBundle(change.language), configReady]);
            if (!current()) return false;
            change.stage = 'queued';
            applyLanguage(change.language);
            const predecessor = languageWriteQueue;
            const write = predecessor.then(async () => {
                if (!current()) return false;
                change.stage = 'persisting';
                ownedWrites.add(change);
                try {
                    await requestConfigPatch(
                        {uiLanguage: change.language, uiLanguageSetupCompleted: true},
                        browser.runtime.sendMessage.bind(browser.runtime),
                    );
                    return current();
                } catch (error) {
                    if (!current() || (change.baseRevision !== undefined
                        && getConfigRevision() !== change.baseRevision)) return false;
                    // 真实 store 通常已回读权威值；只在仍显示本次乐观值时恢复自己的前驱。
                    if (languageState.value === change.language) applyLanguage(change.previousLanguage);
                    throw error;
                } finally {
                    ownedWrites.delete(change);
                }
            });
            languageWriteQueue = write.then(() => undefined, () => undefined);
            return await write;
        } catch (error) {
            if (!current()) return false;
            throw error;
        } finally {
            if (currentChange === change) currentChange = undefined;
        }
    }

    return {
        language,
        bundleRevision,
        t,
        translateLegacy,
        setLanguage,
        dispose() {
            if (disposed) return;
            disposed = true;
            currentChange = undefined;
            unsubscribe();
        },
    };
}

interface TrackedText {
    source: string;
    lastRendered: string;
}

interface TrackedAttribute {
    source: string;
    lastRendered: string;
}

interface UiI18nDirectiveState {
    lastScanLanguage?: UiLanguage;
    observer: MutationObserver;
    context: UiI18nContext;
    refreshQueued: boolean;
    refreshTimer?: ReturnType<typeof setTimeout>;
    refreshing: boolean;
    disposed: boolean;
    refreshAgain: boolean;
    text: WeakMap<Text, TrackedText>;
    attributes: WeakMap<HTMLElement, Map<string, TrackedAttribute>>;
    stopLanguageWatch: () => void;
    refresh: () => void;
}

const TRANSLATABLE_ATTRIBUTES = ['aria-label', 'aria-description', 'placeholder', 'title', 'alt'] as const;
const NON_UI_TEXT_SELECTOR = '[data-i18n-ignore], code, pre, script, style, textarea';
const NON_UI_ELEMENT_TAGS = new Set(['SCRIPT', 'STYLE']);

function isIgnoredElement(element: Element | null): boolean {
    return Boolean(element?.closest('[data-i18n-ignore]'))
        || (element ? NON_UI_ELEMENT_TAGS.has(element.tagName) : true);
}

function isIgnoredTextElement(element: Element | null): boolean {
    // 跟读等正文组件会嵌套 span；内容祖先的排除规则必须继续保护这些后代文本。
    return !element || Boolean(element.closest(NON_UI_TEXT_SELECTOR));
}

const UI_MUTATION_OBSERVER_OPTIONS: MutationObserverInit = {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TRANSLATABLE_ATTRIBUTES],
};

function isRelevantUiMutation(record: MutationRecord): boolean {
    if (record.type === 'attributes') return !isIgnoredElement(record.target as Element);
    if (record.type === 'characterData') {
        return !isIgnoredTextElement((record.target as Text).parentElement);
    }
    const target = record.target.nodeType === Node.ELEMENT_NODE
        ? record.target as Element
        : record.target.parentElement;
    if (!target || isIgnoredElement(target)) return false;
    return record.addedNodes.length === 0
        || Array.from(record.addedNodes).some((node) => (
            node.nodeType !== Node.ELEMENT_NODE || !isIgnoredElement(node as Element)
        ));
}

function observeUiRoot(root: HTMLElement, observer: MutationObserver): void {
    observer.observe(root, UI_MUTATION_OBSERVER_OPTIONS);
}

function scheduleUiRefresh(root: HTMLElement, state: UiI18nDirectiveState): void {
    if (state.disposed) return;
    if (state.refreshing) {
        state.refreshAgain = true;
        return;
    }
    if (state.refreshQueued) return;
    state.refreshQueued = true;
    state.refreshTimer = setTimeout(() => {
        state.refreshTimer = undefined;
        state.refreshQueued = false;
        if (state.disposed || !root.isConnected) return;
        state.refreshing = true;
        state.observer.disconnect();
        try {
            scanUiRoot(root, state.context, state);
        } finally {
            state.refreshing = false;
            if (!state.disposed && root.isConnected) observeUiRoot(root, state.observer);
            if (!state.disposed && state.refreshAgain) {
                state.refreshAgain = false;
                scheduleUiRefresh(root, state);
            }
        }
    }, 0);
}

function scanUiRoot(root: HTMLElement, context: UiI18nContext, state: UiI18nDirectiveState): void {
    if (isIgnoredElement(root)) return;
    // 模板的旧文案本身就是简体中文；冷启动与普通中文交互无需遍历整个 DOM。
    // 非中文切回中文必须扫描一次，恢复之前由此 observer 翻译的文本和属性。
    if (context.language.value === DEFAULT_UI_LANGUAGE
        && (!state.lastScanLanguage || state.lastScanLanguage === DEFAULT_UI_LANGUAGE)) return;
    state.lastScanLanguage = context.language.value;

    const document = root.ownerDocument;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
        const textNode = node as Text;
        const parent = textNode.parentElement;
        if (parent && !isIgnoredTextElement(parent)) {
            const current = textNode.data;
            if (current.trim()) {
                const tracked = state.text.get(textNode);
                const source = tracked && current === tracked.lastRendered ? tracked.source : current;
                const translated = context.translateLegacy(source);
                if (translated !== current) textNode.data = translated;
                state.text.set(textNode, {source, lastRendered: translated});
            }
        }
        node = walker.nextNode();
    }

    const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    for (const element of elements) {
        if (isIgnoredElement(element)) continue;
        for (const attribute of TRANSLATABLE_ATTRIBUTES) {
            const current = element.getAttribute(attribute);
            if (!current?.trim()) continue;
            let trackedAttributes = state.attributes.get(element);
            if (!trackedAttributes) {
                trackedAttributes = new Map();
                state.attributes.set(element, trackedAttributes);
            }
            const tracked = trackedAttributes.get(attribute);
            const source = tracked && current === tracked.lastRendered ? tracked.source : current;
            const translated = context.translateLegacy(source);
            if (translated !== current) element.setAttribute(attribute, translated);
            trackedAttributes.set(attribute, {source, lastRendered: translated});
        }
    }
}

function disposeUiState(state: UiI18nDirectiveState): void {
    if (state.disposed) return;
    state.disposed = true;
    try {
        state.stopLanguageWatch();
    } finally {
        try {
            if (state.refreshTimer !== undefined) clearTimeout(state.refreshTimer);
            state.refreshTimer = undefined;
        } finally {
            state.observer.disconnect();
        }
    }
}

function createUiI18nDirective(context: UiI18nContext): Directive<HTMLElement> & {dispose(): void} {
    // 部分 render 失败时 Vue 尚未拥有可卸载的根节点；插件仍须释放已经创建的指令资源。
    const states = new Map<HTMLElement, UiI18nDirectiveState>();
    let disposed = false;

    return {
        mounted(root) {
            if (disposed) return;
            const state = {} as UiI18nDirectiveState;
            state.context = context;
            state.observer = new MutationObserver((records) => {
                if (records.some(isRelevantUiMutation)) scheduleUiRefresh(root, state);
            });
            state.refresh = () => scheduleUiRefresh(root, state);
            state.refreshQueued = false;
            state.refreshing = false;
            state.disposed = false;
            state.refreshAgain = false;
            state.text = new WeakMap();
            state.attributes = new WeakMap();
            state.stopLanguageWatch = watch([context.language, context.bundleRevision], () => {
                state.refresh();
            }, {flush: 'post'});
            states.set(root, state);
            try {
                observeUiRoot(root, state.observer);
                state.refresh();
            } catch (error) {
                states.delete(root);
                try { disposeUiState(state); } catch { /* 保留初始化错误。 */ }
                throw error;
            }
        },
        updated(root) {
            const state = states.get(root);
            if (state) scheduleUiRefresh(root, state);
        },
        beforeUnmount(root) {
            const state = states.get(root);
            if (!state) return;
            states.delete(root);
            disposeUiState(state);
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            const owned = Array.from(states.values());
            states.clear();
            let firstError: unknown;
            let failed = false;
            for (const state of owned) {
                try { disposeUiState(state); } catch (error) {
                    if (!failed) { failed = true; firstError = error; }
                }
            }
            if (failed) throw firstError;
        },
    };
}

/** 只观察明确传入的 UI 根；扩展 body 可覆盖页面 Teleport，自有 Shadow 子树不扩大到宿主。 */
function observeUiDocument(root: HTMLElement, context: UiI18nContext): () => void {
    const state = {} as UiI18nDirectiveState;
    state.context = context;
    const refresh = (): void => scheduleUiRefresh(root, state);
    state.observer = new MutationObserver((records) => {
        if (records.some(isRelevantUiMutation)) scheduleUiRefresh(root, state);
    });
    state.refreshQueued = false;
    state.refreshing = false;
    state.disposed = false;
    state.refreshAgain = false;
    state.text = new WeakMap();
    state.attributes = new WeakMap();
    state.refresh = refresh;
    state.stopLanguageWatch = watch([context.language, context.bundleRevision], refresh, {flush: 'post'});
    try {
        observeUiRoot(root, state.observer);
        refresh();
    } catch (error) {
        try { disposeUiState(state); } catch { /* 保留初始化错误。 */ }
        throw error;
    }
    return () => disposeUiState(state);
}

let fallbackContext: UiI18nContext | null = null;

export function useUiI18n(): UiI18nContext {
    const injected = inject(UI_I18N_KEY, null);
    if (injected) return injected;
    fallbackContext ??= createUiI18nContext();
    return fallbackContext;
}

export interface UiI18nPluginOptions {
    /** 仅用于扩展专属 document 页面；不要传入宿主网页的 body。 */
    documentRoot?: HTMLElement | null;
    /** 仅扫描调用方拥有的 UI 子树；undefined 沿用 documentRoot，null 禁止自动扫描。 */
    uiRoot?: HTMLElement | null;
    /** 扩展专属页面的标题资源 key；不传则只同步 html[lang]。 */
    documentTitleKey?: string;
}

export function createUiI18nPlugin(options: UiI18nPluginOptions = {}): Plugin {
    return {
        install(app: App) {
            const context = createUiI18nContext();
            const directive = createUiI18nDirective(context);
            const cleanup = [() => context.dispose(), () => directive.dispose()];
            let disposed = false;
            const dispose = (): void => {
                if (disposed) return;
                disposed = true;
                let firstError: unknown;
                let failed = false;
                for (const stop of cleanup) {
                    try { stop(); } catch (error) {
                        if (!failed) { failed = true; firstError = error; }
                    }
                }
                cleanup.length = 0;
                if (failed) throw firstError;
            };
            // Vue 的原生 unmount 在 mount 成功前不运行组件或 app 清理 hook。
            // 插件拥有的订阅和 observer 在入口先释放；根 mixin 共用同一个幂等清理。
            if (typeof app.unmount === 'function') {
                const unmount = app.unmount.bind(app);
                app.unmount = () => {
                    try { dispose(); } finally { unmount(); }
                };
            }
            const updateDocumentMetadata = (): void => {
                if (!options.documentRoot) return;
                document.documentElement.lang = context.language.value;
                if (options.documentTitleKey) {
                    document.title = context.t(options.documentTitleKey);
                }
            };
            try {
                const uiRoot = options.uiRoot === undefined ? options.documentRoot : options.uiRoot;
                if (uiRoot) cleanup.push(observeUiDocument(uiRoot, context));
                updateDocumentMetadata();
                cleanup.push(watch([context.language, context.bundleRevision], updateDocumentMetadata, {flush: 'post'}));
                app.provide(UI_I18N_KEY, context);
                app.config.globalProperties.$fluentT = context.t;
                app.directive('ui-i18n', directive);
                app.mixin({
                    beforeUnmount() {
                        if (this.$root === this) dispose();
                    },
                });
            } catch (error) {
                try { dispose(); } catch { /* 保留插件安装错误。 */ }
                throw error;
            }
        },
    };
}
