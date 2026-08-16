import SelectionTranslator from '@/components/SelectionTranslator.vue';
import { config } from '@/entrypoints/utils/config';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import { createVueShadowUi, type VueShadowMount } from '@/entrypoints/utils/shadowUi';

let selectionTranslatorInstance: any = null;
let app: any = null;
let selectionTranslatorUi: ShadowRootContentScriptUi<VueShadowMount> | null = null;
let mountingPromise: Promise<any> | null = null;
let mountRequestId = 0;
let contentScriptContext: ContentScriptContext | null = null;

/**
 * 挂载选词翻译组件
 */
export function mountSelectionTranslator(ctx?: ContentScriptContext) {
  if (ctx) contentScriptContext = ctx;

  // 如果已存在实例或配置禁用了此功能，则不创建
  if (selectionTranslatorInstance || mountingPromise || config.disableSelectionTranslator || config.selectionTranslatorMode === 'disabled') {
    return mountingPromise;
  }

  if (!contentScriptContext) return;

  const requestId = ++mountRequestId;
  mountingPromise = createVueShadowUi(contentScriptContext, {
    name: 'fluent-read-selection-translator-ui',
    hostId: 'fluent-read-selection-translator-container',
    component: SelectionTranslator,
    zIndex: 2_147_483_646,
  }).then((ui) => {
    if (requestId !== mountRequestId || config.disableSelectionTranslator || config.selectionTranslatorMode === 'disabled') {
      ui.remove();
      return null;
    }

    selectionTranslatorUi = ui;
    app = ui.mounted?.app ?? null;
    selectionTranslatorInstance = ui.mounted?.instance ?? null;
    return selectionTranslatorInstance;
  }).finally(() => {
    mountingPromise = null;
  });

  return mountingPromise;
}

/**
 * 卸载选词翻译组件
 */
export function unmountSelectionTranslator() {
  mountRequestId++;
  if (selectionTranslatorUi || (selectionTranslatorInstance && app)) {
    selectionTranslatorUi?.remove();
    selectionTranslatorUi = null;
    selectionTranslatorInstance = null;
    app = null;
  }
}
