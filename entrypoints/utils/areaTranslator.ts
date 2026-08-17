import AreaTranslator from '@/components/AreaTranslator.vue';
import { config } from '@/entrypoints/utils/config';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import { createVueShadowUi, type VueShadowMount } from '@/entrypoints/utils/shadowUi';

let areaTranslatorInstance: any = null;
let areaTranslatorUi: ShadowRootContentScriptUi<VueShadowMount> | null = null;
let mountingPromise: Promise<any> | null = null;
let mountRequestId = 0;
let contentScriptContext: ContentScriptContext | null = null;

export function mountAreaTranslator(ctx?: ContentScriptContext) {
  if (ctx) contentScriptContext = ctx;
  if (areaTranslatorInstance || mountingPromise || config.selectionAreaEnabled !== true) return mountingPromise;
  if (!contentScriptContext) return;

  const requestId = ++mountRequestId;
  mountingPromise = createVueShadowUi(contentScriptContext, {
    name: 'fluent-read-area-translator-ui',
    hostId: 'fluent-read-area-translator-container',
    component: AreaTranslator,
    zIndex: 2_147_483_647,
  }).then((ui) => {
    if (requestId !== mountRequestId || config.selectionAreaEnabled !== true) {
      ui.remove();
      return null;
    }
    areaTranslatorUi = ui;
    areaTranslatorInstance = ui.mounted?.instance ?? null;
    return areaTranslatorInstance;
  }).finally(() => {
    mountingPromise = null;
  });

  return mountingPromise;
}

export function unmountAreaTranslator(): void {
  mountRequestId += 1;
  areaTranslatorUi?.remove();
  areaTranslatorUi = null;
  areaTranslatorInstance = null;
}
