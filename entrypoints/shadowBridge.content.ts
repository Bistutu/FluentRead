const SHADOW_EVENT = 'fluentread-open-shadow-root';
const ROUTE_EVENT = 'fluentread-route-change';
const DISPOSE_EVENT = 'fluentread-shadow-bridge-dispose';
const BRIDGE_STATE = '__fluentReadShadowBridgeState__';

interface ShadowBridgeState {
    owner: symbol;
    original: typeof Element.prototype.attachShadow;
    wrapper: typeof Element.prototype.attachShadow;
    originalPushState: History['pushState'];
    originalReplaceState: History['replaceState'];
    pushStateWrapper: History['pushState'];
    replaceStateWrapper: History['replaceState'];
    dispose: () => void;
}

/**
 * Open ShadowRoots attached after the initial scan do not emit light-DOM
 * mutations. A tiny main-world bridge reports only the host element; the
 * isolated content script still owns all inspection and translation policy.
 */
export default defineContentScript({
    matches: ['<all_urls>'],
    runAt: 'document_start',
    world: 'MAIN',
    globalName: false,
    main() {
        const pageWindow = window as typeof window & {[BRIDGE_STATE]?: ShadowBridgeState};
        const previous = pageWindow[BRIDGE_STATE];
        previous?.dispose();

        const owner = Symbol('fluentread-shadow-bridge');
        const original = Element.prototype.attachShadow;
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;
        const navigationApi = (pageWindow as typeof window & {navigation?: EventTarget}).navigation;
        const dispatchRouteChange = () => document.dispatchEvent(new CustomEvent(ROUTE_EVENT));
        const wrapper: typeof Element.prototype.attachShadow = function attachShadow(
            this: Element,
            init: ShadowRootInit,
        ): ShadowRoot {
            const root = Reflect.apply(original, this, [init]) as ShadowRoot;
            if (init.mode === 'open') {
                this.dispatchEvent(new CustomEvent(SHADOW_EVENT, {bubbles: true, composed: true}));
            }
            return root;
        };
        const pushStateWrapper: History['pushState'] = function pushState(
            this: History,
            data: unknown,
            unused: string,
            url?: string | URL | null,
        ) {
            const previousUrl = location.href;
            const result = Reflect.apply(originalPushState, this, [data, unused, url]);
            if (location.href !== previousUrl) dispatchRouteChange();
            return result;
        };
        const replaceStateWrapper: History['replaceState'] = function replaceState(
            this: History,
            data: unknown,
            unused: string,
            url?: string | URL | null,
        ) {
            const previousUrl = location.href;
            const result = Reflect.apply(originalReplaceState, this, [data, unused, url]);
            if (location.href !== previousUrl) dispatchRouteChange();
            return result;
        };
        const dispose = () => {
            const current = pageWindow[BRIDGE_STATE];
            if (current?.owner !== owner) return;
            if (Element.prototype.attachShadow === wrapper) Element.prototype.attachShadow = original;
            if (history.pushState === pushStateWrapper) history.pushState = originalPushState;
            if (history.replaceState === replaceStateWrapper) history.replaceState = originalReplaceState;
            window.removeEventListener('popstate', dispatchRouteChange);
            window.removeEventListener('hashchange', dispatchRouteChange);
            navigationApi?.removeEventListener('navigate', dispatchRouteChange);
            document.removeEventListener(DISPOSE_EVENT, dispose);
            delete pageWindow[BRIDGE_STATE];
        };
        Element.prototype.attachShadow = wrapper;
        try {
            history.pushState = pushStateWrapper;
            history.replaceState = replaceStateWrapper;
        } catch {
            // Hardened pages may expose non-writable history methods. Preserve
            // the ShadowRoot bridge and popstate/hashchange invalidation even
            // when same-document pushState interception is unavailable.
            if (history.pushState === pushStateWrapper) history.pushState = originalPushState;
            if (history.replaceState === replaceStateWrapper) history.replaceState = originalReplaceState;
        }
        window.addEventListener('popstate', dispatchRouteChange);
        window.addEventListener('hashchange', dispatchRouteChange);
        navigationApi?.addEventListener('navigate', dispatchRouteChange);
        pageWindow[BRIDGE_STATE] = {
            owner,
            original,
            wrapper,
            originalPushState,
            originalReplaceState,
            pushStateWrapper,
            replaceStateWrapper,
            dispose,
        };
        document.addEventListener(DISPOSE_EVENT, dispose);
    },
});
