const SHADOW_EVENT = 'fluentread-open-shadow-root';
const DISPOSE_EVENT = 'fluentread-shadow-bridge-dispose';
const BRIDGE_STATE = '__fluentReadShadowBridgeState__';

interface ShadowBridgeState {
    owner: symbol;
    original: typeof Element.prototype.attachShadow;
    wrapper: typeof Element.prototype.attachShadow;
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
        const dispose = () => {
            const current = pageWindow[BRIDGE_STATE];
            if (current?.owner !== owner) return;
            if (Element.prototype.attachShadow === wrapper) Element.prototype.attachShadow = original;
            document.removeEventListener(DISPOSE_EVENT, dispose);
            delete pageWindow[BRIDGE_STATE];
        };
        Element.prototype.attachShadow = wrapper;
        pageWindow[BRIDGE_STATE] = {owner, original, wrapper, dispose};
        document.addEventListener(DISPOSE_EVENT, dispose);
    },
});
