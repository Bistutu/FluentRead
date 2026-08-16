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
    @focusin="expandBall"
    @focusout="collapseBall"
  >
    <button
      v-if="showMenu"
      class="floating-ball-tool floating-ball-translate floating-ball-item"
      type="button"
      :aria-label="isTranslating ? '恢复网页原文' : '翻译整个网页'"
      :aria-pressed="isTranslating"
      :title="isTranslating ? '恢复网页原文' : '翻译整个网页'"
      @pointerdown.stop
      @click.stop="toggleTranslation"
    >
      <svg class="translation-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <text x="0.8" y="12.5" fill="currentColor" font-size="12" font-weight="700" font-family="Arial, sans-serif">A</text>
        <text x="11.8" y="12.5" fill="currentColor" font-size="11.5" font-weight="700" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">文</text>
        <path d="M4 16h16M4 16l2-2M4 16l2 2M20 16l-2-2M20 16l-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span v-if="isTranslating" class="check-mark" aria-hidden="true" />
    </button>

    <button
      class="floating-ball-main floating-ball-item"
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
      <svg class="floating-ball-mascot" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <image v-if="logoUrl" :href="logoUrl" x="0" y="0" width="32" height="32" preserveAspectRatio="none" image-rendering="pixelated" />
      </svg>
      <span v-if="isTranslating" class="check-mark" aria-hidden="true" />
    </button>

    <button
      v-if="showMenu"
      class="floating-ball-tool floating-ball-settings floating-ball-item"
      type="button"
      aria-label="打开 FluentRead 设置"
      title="打开设置"
      @pointerdown.stop
      @click.stop="handleSettingsClick"
    >
      <svg viewBox="6 5 16 15" fill="none" aria-hidden="true">
        <path d="m19.43 12.98 1.25.98-1.5 2.6-1.5-.6a7.3 7.3 0 0 1-1.69.98L15.77 18h-3l-.22-1.06a7.3 7.3 0 0 1-1.69-.98l-1.5.6-1.5-2.6 1.25-.98a6.7 6.7 0 0 1 0-1.96l-1.25-.98 1.5-2.6 1.5.6a7.3 7.3 0 0 1 1.69-.98L12.77 6h3l.22 1.06c.6.24 1.16.57 1.69.98l1.5-.6 1.5 2.6-1.25.98a6.7 6.7 0 0 1 0 1.96Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
        <circle cx="14.27" cy="12" r="2.4" stroke="currentColor" stroke-width="1.7" />
      </svg>
    </button>

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
  logoUrl: {
    type: String,
    default: '',
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
  if (!isDragging.value && !floatingBall.value?.matches(':focus-within')) isExpanded.value = false;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function updatePositionStyle() {
  if (isDragging.value) return;

  const containerHeight = floatingBall.value?.getBoundingClientRect().height || BALL_SIZE;
  const halfHeight = containerHeight / 2;
  const centerY = draggedY.value === null
    ? '50%'
    : `${clamp(draggedY.value, halfHeight, Math.max(halfHeight, window.innerHeight - halfHeight))}px`;

  positionStyle.value = {
    top: centerY,
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

  const containerHeight = floatingBall.value?.getBoundingClientRect().height || BALL_SIZE;
  const startLeft = clamp(event.clientX - BALL_SIZE / 2, 0, Math.max(0, window.innerWidth - BALL_SIZE));
  const startTop = clamp(event.clientY - containerHeight / 2, 0, Math.max(0, window.innerHeight - containerHeight));
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

  const containerHeight = floatingBall.value?.getBoundingClientRect().height || BALL_SIZE;
  const nextLeft = clamp(event.clientX - BALL_SIZE / 2, 0, Math.max(0, window.innerWidth - BALL_SIZE));
  const nextTop = clamp(event.clientY - containerHeight / 2, 0, Math.max(0, window.innerHeight - containerHeight));
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
    const finalCenterY = rect ? rect.top + rect.height / 2 : event.clientY;
    const nextPosition = event.clientX < window.innerWidth / 2 ? 'left' : 'right';
    const halfHeight = (rect?.height || BALL_SIZE) / 2;
    draggedY.value = clamp(finalCenterY, halfHeight, Math.max(halfHeight, window.innerHeight - halfHeight));
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
  z-index: 2147483647;
  display: flex;
  width: 48px;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  color: #596273;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  transition: transform 0.46s cubic-bezier(0.22, 1, 0.36, 1);
  user-select: none;
  touch-action: none;
  will-change: transform;
}

.fr-floating-ball[data-position="left"] {
  left: 0;
  align-items: flex-start;
  transform: translateY(-50%);
}

.fr-floating-ball[data-position="right"] {
  right: 0;
  transform: translateY(-50%);
}

.fr-floating-ball-expanded {
  transform: translateY(-50%) !important;
}

.floating-ball-item {
  position: relative;
  flex: 0 0 auto;
  transform: translateX(48px);
  transition: transform 0.46s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.24s ease, box-shadow 0.24s ease, border-color 0.24s ease, background 0.24s ease;
  will-change: transform;
}

.fr-floating-ball[data-position="left"] .floating-ball-item {
  transform: translateX(-48px);
}

.fr-floating-ball.floating-ball-expanded .floating-ball-item {
  opacity: 1;
  transform: translateX(0) !important;
}

.floating-ball-translate {
  transition-delay: 0.06s;
}

.floating-ball-main {
  position: relative;
  z-index: 1;
  display: flex;
  width: 48px;
  height: 48px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  opacity: 1;
  overflow: visible;
}

.fr-floating-ball:not(.floating-ball-expanded)[data-position="right"] .floating-ball-main {
  transform: translateX(50%);
}

.fr-floating-ball:not(.floating-ball-expanded)[data-position="left"] .floating-ball-main {
  transform: translateX(-50%);
}

.fr-floating-ball-expanded .floating-ball-main {
  filter: drop-shadow(0 8px 10px rgba(15, 23, 42, 0.16));
}

.floating-ball-main:hover,
.floating-ball-main:focus-visible {
  outline: none;
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  filter: drop-shadow(0 8px 12px rgba(240, 106, 146, 0.3));
}

.floating-ball-mascot {
  display: block;
  width: 42px;
  height: 42px;
  pointer-events: none;
  image-rendering: pixelated;
}

.translation-icon {
  width: 21px;
  height: 21px;
}

.floating-ball-tool {
  display: inline-flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid rgba(217, 222, 231, 0.96);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.94);
  color: #626b79;
  cursor: pointer;
  opacity: 0;
}

.fr-floating-ball.floating-ball-expanded .floating-ball-tool {
  opacity: 1;
}

.floating-ball-settings {
  transition-delay: 0.1s;
}

.floating-ball-tool:hover,
.floating-ball-tool:focus-visible {
  outline: none;
  border-color: #f06a92;
  background: #fff7fa;
  color: #ec4d7d;
  box-shadow: 0 8px 22px rgba(240, 106, 146, 0.2);
}

.is-translating .floating-ball-main {
  border-color: transparent;
  box-shadow: none;
  filter: drop-shadow(0 8px 12px rgba(240, 106, 146, 0.3));
}

.animating .floating-ball-main {
  animation: floating-ball-pulse 0.62s cubic-bezier(0.22, 1, 0.36, 1);
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

.floating-ball-settings svg {
  width: 21px;
  height: 21px;
}

.shortcut-tooltip {
  position: absolute;
  top: 50%;
  right: calc(100% + 10px);
  z-index: 2;
  padding: 5px 8px;
  border-radius: 6px;
  background: rgba(17, 24, 39, 0.9);
  color: #fff;
  font-size: 12px;
  white-space: nowrap;
  pointer-events: none;
  transform: translateY(-50%);
  animation: floating-ball-tooltip-in 0.18s ease both;
}

.dragging {
  transition: none;
}

.dragging .floating-ball-main {
  transform: none !important;
  opacity: 1;
  cursor: grabbing;
  border-color: #f06a92;
  box-shadow: 0 8px 25px rgba(240, 106, 146, 0.28);
}

.dragging .floating-ball-tool,
.static-mode .shortcut-tooltip {
  visibility: hidden;
  display: none;
}

@keyframes floating-ball-tooltip-in {
  from { opacity: 0; transform: translate(4px, -50%); }
  to { opacity: 1; transform: translate(0, -50%); }
}

@keyframes floating-ball-pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.06); }
  100% { transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .fr-floating-ball,
  .floating-ball-item,
  .floating-ball-main,
  .floating-ball-tool {
    transition: none;
  }

  .shortcut-tooltip,
  .animating .floating-ball-main {
    animation: none;
  }
}
</style>
