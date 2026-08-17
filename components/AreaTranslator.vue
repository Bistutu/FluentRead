<template>
  <div v-show="isSelecting || phase !== 'idle'" class="fr-area-translator-root" @pointerdown.stop>
    <div v-if="isSelecting && selectionRect" class="fr-area-selection" :style="areaStyle(selectionRect)" aria-hidden="true">
      <span>松开鼠标翻译</span>
    </div>

    <div v-else-if="phase === 'loading' && activeRect && !capturePending" class="fr-area-loading" :style="areaStyle(activeRect)" role="status" aria-live="polite">
      <span class="fr-area-spinner" aria-hidden="true" />
      <span>正在识别并翻译…</span>
    </div>

    <section v-else-if="phase === 'translated' && activeRect" class="fr-area-result" :class="{ 'fr-dark-theme': isDarkTheme }" :style="areaStyle(activeRect)" role="dialog" aria-label="圈选翻译结果">
      <img :src="translatedImage" alt="圈选翻译结果" draggable="false" />
      <div class="fr-area-toolbar">
        <span>圈选翻译</span>
        <button type="button" aria-label="关闭圈选翻译结果" title="关闭" @click="clearResult">×</button>
      </div>
    </section>

    <section v-else-if="phase === 'error' && activeRect" class="fr-area-error" :class="{ 'fr-dark-theme': isDarkTheme }" :style="errorStyle(activeRect)" role="alert">
      <strong>圈选翻译失败</strong>
      <span>{{ errorMessage }}</span>
      <div>
        <button type="button" @click="retryTranslation">重试</button>
        <button type="button" @click="clearResult">关闭</button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { config } from '@/entrypoints/utils/config';
import { captureVisibleAreaInExtension, translateCapturedAreaInExtension } from '@/entrypoints/utils/areaTranslationClient';
import { isUsableAreaRect, normalizeAreaRect, type AreaPoint, type AreaRect } from '@/entrypoints/utils/areaTranslationCore';

type AreaPhase = 'idle' | 'selecting' | 'loading' | 'translated' | 'error';

const phase = ref<AreaPhase>('idle');
const selectionRect = ref<AreaRect | null>(null);
const activeRect = ref<AreaRect | null>(null);
const translatedImage = ref('');
const errorMessage = ref('');
const isDarkTheme = ref(false);
const capturePending = ref(false);

let areaHotkeyPressed = false;
let pointerDown = false;
let startPoint: AreaPoint | null = null;
let translationRequestId = 0;
let systemThemeMedia: MediaQueryList | null = null;

function areaStyle(rect: AreaRect): Record<string, string> {
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}

function errorStyle(rect: AreaRect): Record<string, string> {
  const width = Math.min(340, Math.max(230, rect.width));
  return {
    ...areaStyle(rect),
    width: `${width}px`,
    height: 'auto',
  };
}

function updateTheme(): void {
  isDarkTheme.value = config.theme === 'dark' || (config.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function isAreaHotkey(event: KeyboardEvent): boolean {
  return event.code === 'KeyZ' || (event.key.length === 1 && event.key.toLowerCase() === 'z');
}

function isInsideExtensionUi(target: EventTarget | null): boolean {
  const host = document.getElementById('fluent-read-area-translator-container');
  return Boolean(host && target instanceof Node && host.contains(target));
}

function isEditableTarget(target: EventTarget | null): boolean {
  const activeElement = document.activeElement;
  const element = target instanceof HTMLElement
    ? target
    : activeElement instanceof HTMLElement
      ? activeElement
      : null;
  if (!element) return false;
  if (element.isContentEditable || element.closest('[contenteditable="true"], [contenteditable="plaintext-only"]')) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(element.tagName);
}

function isEnabled(): boolean {
  return config.on !== false && config.selectionAreaEnabled === true;
}

function clearResult(): void {
  translationRequestId += 1;
  capturePending.value = false;
  phase.value = 'idle';
  selectionRect.value = null;
  activeRect.value = null;
  translatedImage.value = '';
  errorMessage.value = '';
}

function cancelSelection(): void {
  pointerDown = false;
  startPoint = null;
  selectionRect.value = null;
  if (phase.value === 'selecting') phase.value = 'idle';
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && (isSelecting.value || phase.value !== 'idle')) {
    event.preventDefault();
    cancelSelection();
    clearResult();
    return;
  }
  if (!isEnabled() || event.repeat || event.isComposing || !isAreaHotkey(event) || isInsideExtensionUi(event.target) || isEditableTarget(event.target)) return;
  areaHotkeyPressed = true;
  event.preventDefault();
}

function handleKeyup(event: KeyboardEvent): void {
  if (!isAreaHotkey(event)) return;
  areaHotkeyPressed = false;
  if (isSelecting.value && !pointerDown) finishSelection();
}

function pointFromEvent(event: PointerEvent): AreaPoint {
  return { x: Math.min(window.innerWidth, Math.max(0, event.clientX)), y: Math.min(window.innerHeight, Math.max(0, event.clientY)) };
}

function handlePointerdown(event: PointerEvent): void {
  if (!areaHotkeyPressed || event.button !== 0 || !isEnabled() || isInsideExtensionUi(event.target) || isEditableTarget(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  pointerDown = true;
  startPoint = pointFromEvent(event);
  selectionRect.value = { left: startPoint.x, top: startPoint.y, width: 0, height: 0 };
  activeRect.value = null;
  translatedImage.value = '';
  errorMessage.value = '';
  phase.value = 'selecting';
  window.getSelection()?.removeAllRanges();
}

function handlePointermove(event: PointerEvent): void {
  if (!isSelecting.value || !startPoint) return;
  event.preventDefault();
  event.stopPropagation();
  selectionRect.value = normalizeAreaRect(startPoint, pointFromEvent(event), { width: window.innerWidth, height: window.innerHeight });
}

function handlePointerup(event: PointerEvent): void {
  if (!isSelecting.value) return;
  event.preventDefault();
  event.stopPropagation();
  pointerDown = false;
  finishSelection();
}

function handlePointercancel(): void {
  if (isSelecting.value) cancelSelection();
}

function handleWindowBlur(): void {
  areaHotkeyPressed = false;
  if (isSelecting.value) cancelSelection();
}

const isSelecting = computed(() => phase.value === 'selecting');

function finishSelection(): void {
  if (!isSelecting.value) return;
  const rect = selectionRect.value;
  cancelSelection();
  if (!rect || !isUsableAreaRect(rect)) return;

  activeRect.value = rect;
  phase.value = 'loading';
  capturePending.value = true;
  void requestTranslation(rect);
}

async function requestTranslation(rect: AreaRect): Promise<void> {
  const requestId = ++translationRequestId;
  errorMessage.value = '';
  try {
    const selection = {
      ...rect,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
    // 先让框选层完全消失，再截图；否则选区边框会被 OCR 当作页面内容。
    await nextTick();
    const screenshot = await captureVisibleAreaInExtension();
    if (requestId !== translationRequestId || activeRect.value !== rect) return;
    capturePending.value = false;
    const result = await translateCapturedAreaInExtension(screenshot, selection, config.from, document.title);
    if (requestId !== translationRequestId || activeRect.value !== rect) return;
    translatedImage.value = result.image;
    phase.value = 'translated';
  } catch (error) {
    if (requestId !== translationRequestId || activeRect.value !== rect) return;
    capturePending.value = false;
    errorMessage.value = error instanceof Error ? error.message : String(error);
    phase.value = 'error';
  }
}

function retryTranslation(): void {
  if (activeRect.value) {
    phase.value = 'loading';
    capturePending.value = true;
    void requestTranslation(activeRect.value);
  }
}

function handleViewportChange(): void {
  if (!isSelecting.value) clearResult();
}

const stopConfigWatch = watch(() => [config.on, config.selectionAreaEnabled, config.theme] as const, ([enabled]) => {
  updateTheme();
  if (!enabled || config.selectionAreaEnabled !== true) {
    areaHotkeyPressed = false;
    cancelSelection();
    clearResult();
  }
});

onMounted(() => {
  updateTheme();
  systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
  systemThemeMedia.addEventListener('change', updateTheme);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('keyup', handleKeyup, true);
  document.addEventListener('pointerdown', handlePointerdown, true);
  document.addEventListener('pointermove', handlePointermove, true);
  document.addEventListener('pointerup', handlePointerup, true);
  document.addEventListener('pointercancel', handlePointercancel, true);
  window.addEventListener('scroll', handleViewportChange, true);
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('blur', handleWindowBlur);
});

onBeforeUnmount(() => {
  systemThemeMedia?.removeEventListener('change', updateTheme);
  document.removeEventListener('keydown', handleKeydown, true);
  document.removeEventListener('keyup', handleKeyup, true);
  document.removeEventListener('pointerdown', handlePointerdown, true);
  document.removeEventListener('pointermove', handlePointermove, true);
  document.removeEventListener('pointerup', handlePointerup, true);
  document.removeEventListener('pointercancel', handlePointercancel, true);
  window.removeEventListener('scroll', handleViewportChange, true);
  window.removeEventListener('resize', handleViewportChange);
  window.removeEventListener('blur', handleWindowBlur);
  stopConfigWatch();
  capturePending.value = false;
  clearResult();
});
</script>

<style scoped>
.fr-area-translator-root { position: fixed; inset: 0; z-index: 2147483647; width: 100vw; height: 100vh; pointer-events: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #25252a; }
.fr-area-selection { position: fixed; box-sizing: border-box; border: 2px solid #ef4b86; border-radius: 9px; background: rgba(239, 75, 134, .12); box-shadow: 0 0 0 1px rgba(255, 255, 255, .8), 0 8px 26px rgba(163, 35, 91, .2); pointer-events: none; }
.fr-area-selection span { position: absolute; left: 8px; top: 8px; padding: 4px 8px; border-radius: 999px; background: rgba(44, 35, 43, .88); color: #fff; font-size: 11px; white-space: nowrap; }
.fr-area-loading, .fr-area-error { position: fixed; box-sizing: border-box; pointer-events: auto; }
.fr-area-loading { display: flex; align-items: center; justify-content: center; gap: 9px; min-width: 190px; min-height: 58px; border: 1px solid rgba(239, 75, 134, .55); border-radius: 12px; background: rgba(38, 31, 39, .8); color: #fff; font-size: 13px; box-shadow: 0 12px 30px rgba(35, 25, 38, .24); backdrop-filter: blur(8px); }
.fr-area-spinner { width: 18px; height: 18px; border: 2px solid rgba(255, 255, 255, .35); border-top-color: #ef4b86; border-radius: 50%; animation: fr-area-spin .7s linear infinite; }
@keyframes fr-area-spin { to { transform: rotate(360deg); } }
.fr-area-result { position: fixed; overflow: hidden; border: 1px solid rgba(28, 28, 36, .14); border-radius: 10px; background: #fff; box-shadow: 0 14px 35px rgba(30, 28, 40, .24); pointer-events: auto; }
.fr-area-result img { display: block; width: 100%; height: 100%; user-select: none; -webkit-user-drag: none; }
.fr-area-toolbar { position: absolute; top: 7px; right: 7px; display: flex; align-items: center; gap: 5px; padding: 3px 4px 3px 8px; border-radius: 999px; background: rgba(30, 27, 34, .82); color: #fff; font-size: 10px; line-height: 22px; pointer-events: none; backdrop-filter: blur(6px); }
.fr-area-toolbar button { width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; background: rgba(255, 255, 255, .14); color: #fff; font-size: 17px; line-height: 18px; cursor: pointer; pointer-events: auto; }
.fr-area-toolbar button:hover, .fr-area-toolbar button:focus-visible { background: rgba(255, 255, 255, .28); outline: none; }
.fr-area-error { display: flex; flex-direction: column; gap: 7px; min-width: 230px; max-width: 340px; padding: 13px; border: 1px solid #f0b4c8; border-radius: 12px; background: rgba(255, 248, 250, .98); color: #6c263d; font-size: 12px; box-shadow: 0 12px 30px rgba(75, 30, 47, .2); }
.fr-area-error strong { font-size: 13px; }
.fr-area-error span { line-height: 1.45; overflow-wrap: anywhere; }
.fr-area-error div { display: flex; gap: 7px; }
.fr-area-error button { padding: 5px 10px; border: 1px solid #e6a3ba; border-radius: 7px; background: #fff; color: #c43b63; cursor: pointer; }
.fr-area-error button:hover, .fr-area-error button:focus-visible { background: #fff0f5; outline: none; }
.fr-dark-theme.fr-area-result { border-color: #53535f; background: #2e2e38; }
.fr-dark-theme.fr-area-error { border-color: #744356; background: rgba(47, 35, 43, .98); color: #ffd8e4; }
.fr-dark-theme.fr-area-error button { border-color: #9d5871; background: #3d2c36; color: #ffd8e4; }
@media (prefers-reduced-motion: reduce) { .fr-area-spinner { animation: none; } }
</style>
