/**
 * @file src/features/selection-translation/content/runtime.ts
 * 文件职责：管理 SelectionTranslator Vue 覆盖层在内容脚本中的单例挂载、异步所有权校验与卸载，避免配置快速切换时旧 Promise 污染新实例。
 * 主要内容：缓存 ContentScriptContext，维护 mountRequestId、实例与 Shadow UI 句柄；普通翻译与学习卡片共用 closed Shadow Root，通过 modal host 控制器承接组件选区，并在划词总开关关闭或请求过期时恢复 DOM 所有权并移除。
 * 模块边界：运行时只负责编排组件生命周期，不读取 Selection API、不调用翻译或 TTS；这些行为归 Vue 组件与控制器，Shadow DOM 创建由 platform/shadow-ui 提供。
 */
import SelectionTranslator from '@/src/features/selection-translation/ui/SelectionTranslator.vue';
import { config } from '@/src/services/config/store';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import {createVueShadowUi, type VueShadowMount} from '@/src/platform/shadow-ui';
import {createModalDialogHostController} from './modalDialogHost';

let selectionTranslatorInstance: any = null;
let selectionTranslatorUi: ShadowRootContentScriptUi<VueShadowMount> | null = null;
let mountingPromise: Promise<any> | null = null;
let mountRequestId = 0;
let contentScriptContext: ContentScriptContext | null = null;
let modalDialogHost: ReturnType<typeof createModalDialogHostController> | null = null;

/**
 * 挂载选词翻译组件
 */
export function mountSelectionTranslator(ctx?: ContentScriptContext) {
  if (ctx) contentScriptContext = ctx;

  // 如果已存在实例或配置禁用了此功能，则不创建
  if (selectionTranslatorInstance || mountingPromise || (config.disableSelectionTranslator || config.selectionTranslatorMode === 'disabled')) {
    return mountingPromise;
  }

  if (!contentScriptContext) return;

  const requestId = ++mountRequestId;
  mountingPromise = createVueShadowUi(contentScriptContext, {
    name: 'fluent-read-selection-translator-ui',
    hostId: 'fluent-read-selection-translator-container',
    component: SelectionTranslator,
    zIndex: 2_147_483_646,
    // 词卡包含复制、朗读和翻译动作，closed root 防止宿主页通过合成 DOM 事件调用这些能力。
    mode: 'closed',
    props: {
      onSelectionRangeChange: (range: Range | null) => {
        if (requestId !== mountRequestId) return;
        modalDialogHost?.placeForRange(range);
      },
      onFocusedCardDismiss: () => {
        if (requestId !== mountRequestId) return;
        modalDialogHost?.restoreFromFocusedCard();
      },
    },
  }).then((ui) => {
    // 异步创建结束后复核代次和开关，旧请求不得覆盖较新的挂载状态。
    if (requestId !== mountRequestId || (config.disableSelectionTranslator || config.selectionTranslatorMode === 'disabled')) {
      ui.remove();
      return null;
    }

    ui.shadowHost?.style?.setProperty('position', 'static', 'important');
    modalDialogHost = ui.shadowHost?.style
      ? createModalDialogHostController(ui.shadowHost)
      : null;
    selectionTranslatorUi = ui;
    selectionTranslatorInstance = ui.mounted?.instance ?? null;
    return selectionTranslatorInstance;
  }).finally(() => {
    if (requestId === mountRequestId) mountingPromise = null;
  });

  return mountingPromise;
}

/**
 * 卸载选词翻译组件
 */
export function unmountSelectionTranslator() {
  // 先使未完成的挂载失效，再清空 UI 与实例引用。
  mountRequestId++;
  mountingPromise = null;
  modalDialogHost?.dispose();
  modalDialogHost = null;
  selectionTranslatorUi?.remove();
  selectionTranslatorUi = null;
  selectionTranslatorInstance = null;
}
