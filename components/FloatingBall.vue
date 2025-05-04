<template>
  <div class="floating-ball" :class="{
    'floating-ball-expanded': isExpanded,
    'dragging': isDragging,
    'is-translating': isTranslating,
    'animating': isAnimating
  }" :data-position="currentDisplayPosition" @mouseenter="expandBall" @mouseleave="collapseBall" :style="positionStyle"
    @mousedown="startDrag" @click="toggleTranslation" ref="floatingBall">
    <div class="floating-ball-icon">
      <div class="icon-container">
        <svg v-if="iconType === 'simple' && !isTranslating" class="translation-icon" viewBox="0 0 24 24" fill="none"
          xmlns="http://www.w3.org/2000/svg">
          <path
            d="M12.87 15.07L10.33 12.56L10.36 12.53C12.1 10.59 13.34 8.36 14.07 6H17V4H10V2H8V4H1V6H12.17C11.5 7.92 10.44 9.75 9 11.35C8.07 10.32 7.3 9.19 6.69 8H4.69C5.42 9.63 6.42 11.17 7.67 12.56L2.58 17.58L4 19L9 14L12.11 17.11L12.87 15.07Z"
            fill="#333" />
        </svg>
        <svg v-if="iconType === 'simple' && isTranslating" class="translation-icon" viewBox="0 0 24 24" fill="none"
          xmlns="http://www.w3.org/2000/svg">
          <path
            d="M12.87 15.07L10.33 12.56L10.36 12.53C12.1 10.59 13.34 8.36 14.07 6H17V4H10V2H8V4H1V6H12.17C11.5 7.92 10.44 9.75 9 11.35C8.07 10.32 7.3 9.19 6.69 8H4.69C5.42 9.63 6.42 11.17 7.67 12.56L2.58 17.58L4 19L9 14L12.11 17.11L12.87 15.07Z"
            fill="#4caf50" />
        </svg>
        <svg v-if="iconType === 'morden'" class="imt-fb-logo-img-big-bg translation-icon"
          :class="{ 'imt-float-ball-translated': isTranslating }" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
          width="20" height="20">
          <path fill="none" d="M0 0h24v24H0z"></path>
          <path
            d="M5 15v2a2 2 0 0 0 1.85 1.995L7 19h3v2H7a4 4 0 0 1-4-4v-2h2zm13-5l4.4 11h-2.155l-1.201-3h-4.09l-1.199 3h-2.154L16 10h2zm-1 2.885L15.753 16h2.492L17 12.885zM8 2v2h4v7H8v3H6v-3H2V4h4V2h2zm9 1a4 4 0 0 1 4 4v2h-2V7a2 2 0 0 0-2-2h-3V3h3zM6 6H4v3h2V6zm4 0H8v3h2V6z"
            fill="rgba(255,255,255,1)"></path>
        </svg>

        <div class="check-mark" v-if="isTranslating"></div>
        
        <!-- 添加快捷键提示 -->
        <div class="shortcut-tooltip" v-if="showShortcutTooltip">
          {{ shortcutTip }}
        </div>
        
        <!-- 波纹效果容器 -->
        <div class="ripple-container" ref="rippleContainer"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import type { PropType, CSSProperties } from 'vue';

const props = defineProps({
  position: {
    type: String as PropType<'left' | 'right'>,
    default: 'right',
    validator: (value: string) => ['left', 'right'].includes(value)
  },
  showMenu: {
    type: Boolean,
    default: true
  },
  onDocClick: {
    type: Function as PropType<(event: MouseEvent) => void>,
    default: () => { }
  },
  onSettingsClick: {
    type: Function as PropType<(event: MouseEvent) => void>,
    default: () => { }
  },
  onPositionChanged: {
    type: Function as PropType<(newPosition: 'left' | 'right') => void>,
    default: () => { }
  },
  onTranslationToggle: {
    type: Function as PropType<(isTranslating: boolean) => void>,
    default: () => { }
  },
  iconType: {
    type: String as PropType<'simple' | 'morden'>,
    default: 'morden',
    validator: (value: string) => ['simple', 'morden'].includes(value)
  },
  showShortcutTooltip: {
    type: Boolean,
    default: false
  },
  shortcutTip: {
    type: String,
    default: ''
  }
});

const isExpanded = ref(false);
const positionStyle = ref<CSSProperties>({});
const isDragging = ref(false);
const startX = ref(0);
const startY = ref(0);
const draggedY = ref<number | null>(null);
const internalPosition = ref<'left' | 'right' | null>(null);
const isTranslating = ref(false);
const dragStartTime = ref(0);
const floatingBall = ref<HTMLElement | null>(null);
const rippleContainer = ref<HTMLElement | null>(null);
const isAnimating = ref(false);
const showShortcutTooltip = ref(false);
const shortcutTip = ref('快捷键: Alt+T');

const currentDisplayPosition = computed(() => internalPosition.value || props.position);

const expandBall = () => {
  if (isDragging.value) return;
  isExpanded.value = true;
};

const collapseBall = () => {
  if (isDragging.value) return;
  if (floatingBall.value?.matches(':hover')) return;
  isExpanded.value = false;
};

const updatePositionStyle = () => {
  if (isDragging.value) return;

  const newTop = draggedY.value !== null ? `${draggedY.value}px` : '50%';

  positionStyle.value = {
    top: newTop,
    left: undefined,
    right: undefined,
    transform: undefined
  };
};

const startDrag = (event: MouseEvent) => {
  if (event.button !== 0 || !floatingBall.value) return;

  isDragging.value = true;
  isExpanded.value = false;
  startX.value = event.clientX;
  startY.value = event.clientY;
  dragStartTime.value = Date.now();

  const rect = floatingBall.value.getBoundingClientRect();
  const currentElementX = rect.left;
  const currentElementY = rect.top;

  positionStyle.value = {
    left: `${currentElementX}px`,
    top: `${currentElementY}px`,
    right: 'auto',
    transform: 'none'
  };

  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', stopDrag);

  event.preventDefault();
};

const drag = (event: MouseEvent) => {
  if (!isDragging.value || !floatingBall.value) return;

  const rect = floatingBall.value.getBoundingClientRect();
  const offsetX = event.clientX - startX.value;
  const offsetY = event.clientY - startY.value;

  const newX = rect.left + offsetX;
  const newY = rect.top + offsetY;

  // 确保悬浮球不会超出屏幕边界
  const maxX = window.innerWidth - rect.width;
  const maxY = window.innerHeight - rect.height;

  positionStyle.value = {
    left: `${Math.max(0, Math.min(newX, maxX))}px`,
    top: `${Math.max(0, Math.min(newY, maxY))}px`,
    right: 'auto',
    transform: 'none'
  };

  startX.value = event.clientX;
  startY.value = event.clientY;
};

const stopDrag = (event: MouseEvent) => {
  if (!isDragging.value || !floatingBall.value) return;

  document.removeEventListener('mousemove', drag);
  document.removeEventListener('mouseup', stopDrag);

  isDragging.value = false;

  const dragDuration = Date.now() - dragStartTime.value;
  const movedX = Math.abs(event.clientX - startX.value);
  const movedY = Math.abs(event.clientY - startY.value);
  const isDragGesture = dragDuration > 200 || movedX > 5 || movedY > 5;

  const rect = floatingBall.value.getBoundingClientRect();
  const finalY = rect.top;

  const newPosition = event.clientX < window.innerWidth / 2 ? 'left' : 'right';

  draggedY.value = finalY;
  internalPosition.value = newPosition;

  // 无论位置是否变化，都通知父组件，以便触发拖动状态更新
  props.onPositionChanged(newPosition);

  nextTick(() => {
    updatePositionStyle();
  });
};

const handleDocClick = (event: MouseEvent) => {
  event.stopPropagation();
  props.onDocClick(event);
};

const handleSettingsClick = (event: MouseEvent) => {
  event.stopPropagation();
  props.onSettingsClick(event);
};

// 新增：添加波纹效果
const addRippleEffect = (color: string = '#4caf50') => {
  if (!rippleContainer.value) return;
  
  const ripple = document.createElement('div');
  ripple.classList.add('ripple');
  ripple.style.backgroundColor = color;
  
  rippleContainer.value.appendChild(ripple);
  
  // 触发波纹动画
  setTimeout(() => {
    ripple.classList.add('active');
    
    // 动画结束后移除波纹元素
    setTimeout(() => {
      if (rippleContainer.value?.contains(ripple)) {
        rippleContainer.value.removeChild(ripple);
      }
    }, 600);
  }, 10);
};

// 新增：触发动画效果
const triggerAnimation = (type: 'translate' | 'restore') => {
  isAnimating.value = true;
  
  // 添加波纹效果
  addRippleEffect(type === 'translate' ? '#4285f4' : '#4caf50');
  
  // 显示快捷键提示
  showShortcutTooltip.value = true;
  
  // 2秒后隐藏提示
  setTimeout(() => {
    showShortcutTooltip.value = false;
  }, 2000);
  
  // 动画结束后重置状态
  setTimeout(() => {
    isAnimating.value = false;
  }, 500);
};

// 修改原有的toggleTranslation函数
const toggleTranslation = (event: MouseEvent) => {
  const dragDuration = Date.now() - dragStartTime.value;
  const movedX = Math.abs(event.clientX - startX.value);
  const movedY = Math.abs(event.clientY - startY.value);
  const isDragEndClick = dragDuration > 150 || movedX > 5 || movedY > 5;

  // 如果是拖动结束的点击，或者当前正在拖动中，则不触发翻译
  if (isDragEndClick || isDragging.value) {
    return;
  }

  isTranslating.value = !isTranslating.value;
  triggerAnimation(isTranslating.value ? 'translate' : 'restore');
  
  // 触发自定义事件
  if (isTranslating.value) {
    document.dispatchEvent(new CustomEvent('fluentread-translation-started'));
    console.log('[悬浮球] 通过点击开始翻译');
  } else {
    document.dispatchEvent(new CustomEvent('fluentread-translation-ended'));
    console.log('[悬浮球] 通过点击停止翻译');
  }
  
  if (floatingBall.value?.matches(':hover')) {
    isExpanded.value = true;
  }
  props.onTranslationToggle(isTranslating.value);
};

// 新增：响应自定义事件，从外部触发切换
const handleExternalToggle = () => {
  // 切换状态
  isTranslating.value = !isTranslating.value;
  
  // 触发动画
  triggerAnimation(isTranslating.value ? 'translate' : 'restore');
  
  // 触发自定义事件
  if (isTranslating.value) {
    document.dispatchEvent(new CustomEvent('fluentread-translation-started'));
    console.log('[悬浮球] 通过快捷键开始翻译');
  } else {
    document.dispatchEvent(new CustomEvent('fluentread-translation-ended'));
    console.log('[悬浮球] 通过快捷键停止翻译');
  }
  
  // 通知父组件
  props.onTranslationToggle(isTranslating.value);
};

const handleClickOutside = (event: MouseEvent) => {
  if (floatingBall.value?.matches(':hover')) return;
  if (!floatingBall.value?.contains(event.target as Node)) {
    isExpanded.value = false;
  }
};

const handleMouseMove = (event: MouseEvent) => {
  if (floatingBall.value?.contains(event.target as Node)) {
    isExpanded.value = true;
  }
};

onMounted(() => {
  internalPosition.value = props.position;
  updatePositionStyle();
  window.addEventListener('resize', updatePositionStyle);
  document.addEventListener('click', handleClickOutside);
  document.addEventListener('mousemove', handleMouseMove);
  
  // 监听自定义事件
  document.addEventListener('fluentread-toggle-translation', handleExternalToggle);
  
  // 使组件暴露给父组件
  if (floatingBall.value) {
    (floatingBall.value as any).element = floatingBall.value;
    (floatingBall.value as any).isTranslating = isTranslating.value;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', updatePositionStyle);
  document.removeEventListener('mousemove', drag);
  document.removeEventListener('mouseup', stopDrag);
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('mousemove', handleMouseMove);
  
  // 移除自定义事件监听
  document.removeEventListener('fluentread-toggle-translation', handleExternalToggle);
});

watch(() => props.position, (newPosition) => {
  if (newPosition !== internalPosition.value) {
    internalPosition.value = newPosition;
    draggedY.value = null;
    updatePositionStyle();
  }
});

</script>

<style>
.floating-ball {
  position: fixed;
  z-index: 9999;
  transition: all 0.5s cubic-bezier(0.25, 0.1, 0.25, 1);
  cursor: pointer;
  user-select: none;
  touch-action: none;
  border-radius: 50%;
}

.floating-ball-icon {
  width: 34px;
  height: 34px;
  background-color: #ffffff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #333;
  font-weight: bold;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transition: all 0.3s ease;
  border: 1.5px solid #e0e0e0;
  overflow: hidden;
  position: relative;
}

.imt-fb-logo-img-big-bg {
  width: 20px;
  height: 20px;
  margin: 0;
  padding: 3px;
  background-color: #ED6D8F;
  border-radius: 50%;
  margin: 0 3px;
}

.floating-ball-expanded .floating-ball-icon {
  transform: scale(1.05);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
  border-color: #4caf50;
}

.icon-container {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.translation-icon {
  width: 18px;
  height: 18px;
  transition: all 0.3s ease;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
}

.is-translating .translation-icon {
  transform: scale(1.1);
  filter: drop-shadow(0 2px 4px rgba(76, 175, 80, 0.2));
}

.is-translating .floating-ball-icon {
  background-color: #ffffff;
  border-color: #4caf50;
  box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
}

/* 动画相关样式 */
.animating.is-translating .floating-ball-icon {
  animation: pulse-green 0.5s ease;
}

.animating:not(.is-translating) .floating-ball-icon {
  animation: pulse-blue 0.5s ease;
}

@keyframes pulse-green {
  0% {
    transform: scale(1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  50% {
    transform: scale(1.2);
    box-shadow: 0 0 15px rgba(76, 175, 80, 0.8);
  }
  100% {
    transform: scale(1);
    box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
  }
}

@keyframes pulse-blue {
  0% {
    transform: scale(1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  50% {
    transform: scale(1.2);
    box-shadow: 0 0 15px rgba(0, 128, 255, 0.8);
  }
  100% {
    transform: scale(1);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
}

/* 波纹效果 */
.ripple-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 50%;
  pointer-events: none;
}

.ripple {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0;
  height: 0;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  opacity: 0.6;
  transition: all 0.6s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.ripple.active {
  width: 200%;
  height: 200%;
  opacity: 0;
}

/* 快捷键提示 */
.shortcut-tooltip {
  position: absolute;
  bottom: -40px;
  left: 50%;
  transform: translateX(-50%);
  background-color: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  animation: fadeIn 0.3s ease forwards;
}

.shortcut-tooltip:after {
  content: '';
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  border-width: 0 6px 6px 6px;
  border-style: solid;
  border-color: transparent transparent rgba(0, 0, 0, 0.7) transparent;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translate(-50%, 5px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

.check-mark {
  position: absolute;
  bottom: 1.5px;
  right: 1.5px;
  width: 12px;
  height: 12px;
  background-color: #4caf50;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px rgba(76, 175, 80, 0.3);
  animation: pulse 1.5s infinite ease-in-out;
  border: 0.75px solid #ffffff;
}

@keyframes pulse {
  0% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.7);
  }

  70% {
    transform: scale(1);
    box-shadow: 0 0 0 6px rgba(76, 175, 80, 0);
  }

  100% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(76, 175, 80, 0);
  }
}

.check-mark::after {
  content: "";
  display: block;
  width: 4px;
  height: 7px;
  border-right: 1.5px solid white;
  border-bottom: 1.5px solid white;
  transform: rotate(45deg) translate(-0.75px, -0.75px);
}

.floating-ball[data-position="left"] {
  left: 0;
  right: auto;
  transform: translateX(-50%);
}

.floating-ball[data-position="right"] {
  right: 0;
  left: auto;
  transform: translateX(50%);
}

.floating-ball-expanded {
  transform: translateX(0) !important;
}

.floating-ball-menu {
  position: absolute;
  top: 40px;
  left: 0;
  background-color: white;
  border-radius: 16px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  padding: 7px 0;
  width: 34px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.menu-item {
  padding: 7px;
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  color: #666;
  transition: background-color 0.2s;
}

.menu-item:hover {
  background-color: rgba(0, 0, 0, 0.05);
}

.floating-ball.dragging {
  transition: none;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
}

.floating-ball.dragging .floating-ball-icon {
  border-color: #4caf50;
  box-shadow: 0 4px 12px rgba(76, 175, 80, 0.3);
}

.path-animate {
  transition: all 0.5s ease;
}

.path-animate.active {
  filter: drop-shadow(0 0 2px rgba(76, 175, 80, 0.7));
}

.dot-animate {
  r: 1;
  opacity: 0.7;
  transition: all 0.3s ease;
}

.dot-animate.active {
  animation: dotPulse 2s infinite alternate;
}

@keyframes dotPulse {
  0% {
    r: 1;
    opacity: 0.7;
  }

  50% {
    r: 1.5;
    opacity: 1;
  }

  100% {
    r: 1;
    opacity: 0.7;
  }
}
</style>
