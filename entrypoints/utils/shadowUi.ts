import { createApp, type App as VueApp, type Component } from 'vue';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import {
  createShadowRootUi,
  type ShadowRootContentScriptUi,
} from 'wxt/utils/content-script-ui/shadow-root';

export interface VueShadowMount {
  app: VueApp;
  instance: any;
}

interface VueShadowUiOptions {
  name: string;
  hostId: string;
  component: Component;
  props?: Record<string, unknown>;
  zIndex?: number;
}

const SHADOW_FOUNDATION = `
  :host {
    all: initial !important;
    display: block !important;
    position: relative !important;
    width: 0 !important;
    height: 0 !important;
    overflow: visible !important;
    contain: none !important;
    color-scheme: light dark;
  }

  html,
  body {
    width: 0 !important;
    height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }
`;

/**
 * Mount a Vue widget into an isolated Shadow DOM tree.
 *
 * The host remains in the page document, but both WXT's reset and the explicit
 * host foundation prevent inherited page styles from leaking into the widget.
 */
export async function createVueShadowUi(
  ctx: ContentScriptContext,
  options: VueShadowUiOptions,
): Promise<ShadowRootContentScriptUi<VueShadowMount>> {
  const ui = await createShadowRootUi<VueShadowMount>(ctx, {
    name: options.name,
    position: 'overlay',
    alignment: 'top-left',
    zIndex: options.zIndex ?? 2_147_483_647,
    mode: 'open',
    inheritStyles: false,
    isolateEvents: ['keydown', 'keyup', 'keypress'],
    css: SHADOW_FOUNDATION,
    onMount(container) {
      const app = createApp(options.component, options.props ?? {});
      const instance = app.mount(container);
      return { app, instance };
    },
    onRemove(mounted) {
      mounted?.app.unmount();
    },
  });

  ui.shadowHost.id = options.hostId;
  ui.shadowHost.setAttribute('data-fluent-read-ui', options.name);
  ui.mount();
  return ui;
}
