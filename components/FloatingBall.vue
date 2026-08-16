<template>
  <div
    ref="floatingBall"
    class="fr-floating-ball"
    :class="{
      'floating-ball-expanded': isExpanded,
      dragging: isDragging,
      'is-translating': isTranslating,
      animating: isAnimating && config.animations,
      'static-mode': !config.animations,
    }"
    :data-position="currentDisplayPosition"
    :style="positionStyle"
    @mouseenter="expandBall"
    @mouseleave="collapseBall"
  >
    <button
      ref="mainButton"
      class="floating-ball-main"
      type="button"
      :aria-label="mainButtonLabel"
      :aria-pressed="isTranslating"
      :title="mainButtonTitle"
      @focus="expandBall"
      @blur="collapseBall"
      @pointerdown="startDrag"
      @pointerup="finishPointerInteraction"
      @pointercancel="cancelPointerInteraction"
    >
      <span class="floating-ball-icon" aria-hidden="true">
        <svg class="translation-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M12.87 15.07 10.33 12.56l.03-.03A16.6 16.6 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17A16.8 16.8 0 0 1 9 11.35 15.7 15.7 0 0 1 6.69 8h-2A18.3 18.3 0 0 0 7.67 12.56L2.58 17.58 4 19l5-5 3.11 3.11z"
            fill="currentColor"
          />
        </svg>
        <span v-if="isTranslating" class="check-mark" />
      </span>
      <span class="floating-ball-label">{{ isTranslating ? '恢复原文' : '翻译全文' }}</span>
    </button>

    <div v-show="isExpanded && !isDragging && showMenu" class="floating-ball-menu" role="group" aria-label="悬浮球工具">
      <button
        class="floating-ball-action"
        type="button"
        aria-label="打开 FluentRead 设置"
        title="打开设置"
        @pointerdown.stop
        @click.stop="handleSettingsClick"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m19.43 12.98 1.25.98-1.5 2.6-1.5-.6a7.3 7.3 0 0 1-1.69.98L15.77 18h-3l-.22-1.06a7.3 7.3 0 0 1-1.69-.98l-1.5.6-1.5-2.6 1.25-.98a6.7 6.7 0 0 1 0-1.96l-1.25-.98 1.5-2.6 1.5.6a7.3 7.3 0 0 1 1.69-.98L12.77 6h3l.22 1.06c.6.24 1.16.57 1.69.98l1.5-.6 1.5 2.6-1.25.98a6.7 6.7 0 0 1 0 1.96Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
          <circle cx="14.27" cy="12" r="2.4" stroke="currentColor" stroke-width="1.7" />
        </svg>
      </button>
    </div>

    <div v-if="showShortcutTooltip" class="shortcut-tooltip" role="status">{{ shortcutTip }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PropType, CSSProperties } from 'vue';
import { config } from '@/entrypoints/utils/config';

const DRAG_THRESHOLD = 6;
const BALL_SIZE = 42;

const props = defineProps({
  position: {
    type: String as PropType<'left' | 'right'>,
    default: 'right',
    validator: (value: string) => ['left', 'right'].includes(value),
  },
  showMenu: {
    type: Boolean,
    default: true,
  },
  onSettingsClick: {
    type: Function as PropType<(event: MouseEvent) => void>,
    default: () => {},
  },
  onPositionChanged: {
    type: Function as PropType<(newPosition: 'left' | 'right') => void>,
    default: () => {},
  },
  onTranslationToggle: {
    type: Function as PropType<(isTranslating: boolean) => void>,
    default: () => {},
  },
});

interface PointerDragState {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
}

const isExpanded = ref(false);
const positionStyle = ref<CSSProperties>({});
const isDragging = ref(false);
const draggedY = ref<number | null>(null);
const internalPosition = ref<'left' | 'right' | null>(null);
const isTranslating = ref(false);
const floatingBall = ref<HTMLElement | null>(null);
const mainButton = ref<HTMLButtonElement | null>(null);
const showShortcutTooltip = ref(false);
const shortcutTip = ref('快捷键：Alt+T');
const dragState = ref<PointerDragState | null>(null);
const isAnimating = ref(false);
let animationTimer: ReturnType<typeof setTimeout> | undefined;
let tooltipTimer: ReturnType<typeof setTimeout> | undefined;

const currentDisplayPosition = computed(() => internalPosition.value || props.position);
const mainButtonLabel = computed(() => isTranslating.value ? '恢复网页原文' : '翻译整个网页');
const mainButtonTitle = computed(() => `${mainButtonLabel.value}；按住拖动调整位置`);

function expandBall() {
  if (!isDragging.value) isExpanded.value = true;
}

function collapseBall() {
  if (!isDragging.value && !mainButton.value?.matches(':focus')) isExpanded.value = false;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function updatePositionStyle() {
  if (isDragging.value) return;

  positionStyle.value = {
    top: draggedY.value === null ? '50%' : `${clamp(draggedY.value, 0, Math.max(0, window.innerHeight - BALL_SIZE))}px`,
    left: undefined,
    right: undefined,
    transform: undefined,
  };
}

function startDrag(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return;

  event.preventDefault();
  isExpanded.value = false;
  isDragging.value = true;
  dragState.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  };

  const startLeft = clamp(event.clientX - BALL_SIZE / 2, 0, Math.max(0, window.innerWidth - BALL_SIZE));
  const startTop = clamp(event.clientY - BALL_SIZE / 2, 0, Math.max(0, window.innerHeight - BALL_SIZE));
  positionStyle.value = {
    left: `${startLeft}px`,
    top: `${startTop}px`,
    right: 'auto',
    transform: 'none',
  };

  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', finishPointerInteraction);
  window.addEventListener('pointercancel', cancelPointerInteraction);
}

function handlePointerMove(event: PointerEvent) {
  const currentDrag = dragState.value;
  if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;

  if (Math.hypot(event.clientX - currentDrag.startX, event.clientY - currentDrag.startY) > DRAG_THRESHOLD) {
    currentDrag.moved = true;
  }

  const nextLeft = clamp(event.clientX - BALL_SIZE / 2, 0, Math.max(0, window.innerWidth - BALL_SIZE));
  const nextTop = clamp(event.clientY - BALL_SIZE / 2, 0, Math.max(0, window.innerHeight - BALL_SIZE));
  positionStyle.value = {
    left: `${nextLeft}px`,
    top: `${nextTop}px`,
    right: 'auto',
    transform: 'none',
  };
}

function finishPointerInteraction(event: PointerEvent) {
  const currentDrag = dragState.value;
  if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;

  removePointerListeners();
  dragState.value = null;
  isDragging.value = false;

  if (currentDrag.moved) {
    const rect = floatingBall.value?.getBoundingClientRect();
    const finalTop = rect?.top ?? event.clientY - BALL_SIZE / 2;
    const nextPosition = event.clientX < window.innerWidth / 2 ? 'left' : 'right';
    draggedY.value = clamp(finalTop, 0, Math.max(0, window.innerHeight - BALL_SIZE));
    internalPosition.value = nextPosition;
    props.onPositionChanged(nextPosition);
    nextTick(updatePositionStyle);
    return;
  }

  toggleTranslation();
}

function cancelPointerInteraction(event: PointerEvent) {
  const currentDrag = dragState.value;
  if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;

  removePointerListeners();
  dragState.value = null;
  isDragging.value = false;
  updatePositionStyle();
}

function removePointerListeners() {
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', finishPointerInteraction);
  window.removeEventListener('pointercancel', cancelPointerInteraction);
}

function triggerAnimation() {
  if (!config.animations) return;

  if (animationTimer) clearTimeout(animationTimer);
  if (tooltipTimer) clearTimeout(tooltipTimer);
  isAnimating.value = true;
  showShortcutTooltip.value = true;
  isExpanded.value = true;
  tooltipTimer = setTimeout(() => {
    showShortcutTooltip.value = false;
  }, 1800);
  animationTimer = setTimeout(() => {
    isAnimating.value = false;
    animationTimer = undefined;
  }, 500);
}

function toggleTranslation() {
  isTranslating.value = !isTranslating.value;
  triggerAnimation();
  props.onTranslationToggle(isTranslating.value);
}

function handleExternalToggle() {
  if (!floatingBall.value) return;
  toggleTranslation();
}

function handleSettingsClick(event: MouseEvent) {
  props.onSettingsClick(event);
}

function handleDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') isExpanded.value = false;
}

onMounted(() => {
  internalPosition.value = props.position;
  updatePositionStyle();
  window.addEventListener('resize', updatePositionStyle);
  document.addEventListener('keydown', handleDocumentKeydown);
  document.addEventListener('fluentread-toggle-translation', handleExternalToggle);
});

onBeforeUnmount(() => {
  removePointerListeners();
  window.removeEventListener('resize', updatePositionStyle);
  document.removeEventListener('keydown', handleDocumentKeydown);
  document.removeEventListener('fluentread-toggle-translation', handleExternalToggle);
  if (animationTimer) clearTimeout(animationTimer);
  if (tooltipTimer) clearTimeout(tooltipTimer);
});

watch(() => props.position, (newPosition) => {
  if (newPosition === internalPosition.value) return;
  internalPosition.value = newPosition;
  draggedY.value = null;
  updatePositionStyle();
});
</script>

<style scoped>
.fr-floating-ball {
  position: fixed;
  z-index: 9999;
  display: flex;
  width: 42px;
  height: 42px;
  align-items: center;
  transition: width 0.22s ease, transform 0.22s ease;
  user-select: none;
  touch-action: none;
}

.fr-floating-ball[data-position="left"] {
  left: 0;
  justify-content: flex-start;
  transform: translateX(-50%);
}

.fr-floating-ball[data-position="right"] {
  right: 0;
  justify-content: flex-end;
  transform: translateX(50%);
}

.fr-floating-ball-expanded {
  width: 166px;
  transform: translateX(0) !important;
}

.floating-ball-main {
  position: relative;
  z-index: 1;
  display: flex;
  width: 42px;
  height: 42px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 10px;
  overflow: hidden;
  border: 1px solid #e1e5eb;
  border-radius: 22px;
  background: #fff;
  color: #364152;
  box-shadow: 0 5px 18px rgba(15, 23, 42, 0.2);
  cursor: pointer;
  transition: width 0.22s ease, border-color 0.22s ease, background 0.22s ease, box-shadow 0.22s ease;
}

.fr-floating-ball-expanded .floating-ball-main {
  width: 124px;
  border-color: #b9c9f8;
  box-shadow: 0 7px 22px rgba(37, 99, 235, 0.22);
}

.floating-ball-main:hover,
.floating-ball-main:focus-visible {
  outline: none;
  border-color: #6d8ce8;
  box-shadow: 0 8px 24px rgba(37, 99, 235, 0.28);
}

.floating-ball-icon {
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #ed6d8f;
  color: #fff;
}

.translation-icon {
  width: 17px;
  height: 17px;
}

.floating-ball-label {
  max-width: 0;
  overflow: hidden;
  color: #344054;
  font-size: 13px;
  font-weight: 650;
  opacity: 0;
  white-space: nowrap;
  transition: max-width 0.22s ease, opacity 0.16s ease;
}

.fr-floating-ball-expanded .floating-ball-label {
  max-width: 76px;
  opacity: 1;
}

.is-translating .floating-ball-icon {
  background: #3b82f6;
}

.is-translating .floating-ball-main {
  border-color: #86b5f7;
}

.animating .floating-ball-main {
  animation: floating-ball-pulse 0.5s ease;
}

.check-mark {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 9px;
  height: 9px;
  border: 1px solid #fff;
  border-radius: 50%;
  background: #22c55e;
}

.check-mark::after {
  position: absolute;
  top: 1px;
  left: 2px;
  width: 3px;
  height: 5px;
  border-right: 1px solid #fff;
  border-bottom: 1px solid #fff;
  content: '';
  transform: rotate(45deg);
}

.floating-ball-menu {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  margin: 0 6px;
  border: 1px solid #e1e5eb;
  border-radius: 17px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 5px 18px rgba(15, 23, 42, 0.16);
  animation: floating-ball-menu-in 0.18s ease both;
}

.floating-ball-action {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #667085;
  cursor: pointer;
}

.floating-ball-action:hover,
.floating-ball-action:focus-visible {
  outline: none;
  background: #eef2ff;
  color: #3155c7;
}

.floating-ball-action svg {
  width: 18px;
  height: 18px;
}

.shortcut-tooltip {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  z-index: 2;
  padding: 5px 8px;
  border-radius: 6px;
  background: rgba(17, 24, 39, 0.9);
  color: #fff;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  transform: translateX(-50%);
  animation: floating-ball-tooltip-in 0.18s ease both;
}

.dragging {
  transition: none;
}

.dragging .floating-ball-main {
  width: 42px;
  cursor: grabbing;
  border-color: #6d8ce8;
  box-shadow: 0 8px 25px rgba(15, 23, 42, 0.28);
}

.dragging .floating-ball-label,
.static-mode .shortcut-tooltip {
  display: none;
}

@keyframes floating-ball-menu-in {
  from { opacity: 0; transform: translateX(4px) scale(0.92); }
  to { opacity: 1; transform: translateX(0) scale(1); }
}

@keyframes floating-ball-tooltip-in {
  from { opacity: 0; transform: translate(-50%, -3px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

@keyframes floating-ball-pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.06); }
  100% { transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .fr-floating-ball,
  .floating-ball-main,
  .floating-ball-label {
    transition: none;
  }

  .floating-ball-menu,
  .shortcut-tooltip,
  .animating .floating-ball-main {
    animation: none;
  }
}
</style>
