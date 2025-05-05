<template>
  <teleport to="body">
    <!-- 小红点指示器 -->
    <div v-if="showIndicator" 
         class="selection-indicator" 
         :style="indicatorStyle" 
         @mouseenter="showTooltip = true"
         @mouseleave="showTooltip = false">
    </div>
    
    <!-- 翻译结果弹窗 -->
    <div v-if="showTooltip" class="translation-tooltip" :style="tooltipStyle">
      <div class="tooltip-header">
        <span>翻译结果</span>
        <button class="close-btn" @click="closeTooltip">×</button>
      </div>
      <div class="tooltip-content">
        <div v-if="isLoading" class="loading-spinner"></div>
        <div v-else-if="error" class="error-message">{{ error }}</div>
        <div v-else>
          <div class="original-text">{{ selectedText }}</div>
          <div class="translation-result">{{ translationResult }}</div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { translateText } from '@/entrypoints/utils/translateApi';
import { config } from '@/entrypoints/utils/config';

// 状态变量
const selectedText = ref('');
const translationResult = ref('');
const selectionRect = ref<DOMRect | null>(null);
const showIndicator = ref(false);
const showTooltip = ref(false);
const isLoading = ref(false);
const error = ref('');

// 计算小红点指示器的样式
const indicatorStyle = computed(() => {
  if (!selectionRect.value) return {};
  
  return {
    left: `${selectionRect.value.right}px`,
    top: `${selectionRect.value.top}px`,
    transform: 'translate(10px, -50%)'
  };
});

// 计算弹窗的样式
const tooltipStyle = computed(() => {
  if (!selectionRect.value) return {};
  
  // 确保弹窗不会超出视口
  const left = Math.min(
    selectionRect.value.right + 15,
    window.innerWidth - 300
  );
  
  return {
    left: `${left}px`,
    top: `${selectionRect.value.top}px`,
    maxWidth: '300px',
    maxHeight: '200px'
  };
});

// 处理文本选择事件
const handleTextSelection = () => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    hideIndicator();
    return;
  }
  
  const selectedTextContent = selection.toString().trim();
  if (!selectedTextContent) {
    hideIndicator();
    return;
  }
  
  // 获取选中文本位置信息
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  
  // 保存选中文本和位置
  selectedText.value = selectedTextContent;
  selectionRect.value = rect;
  showIndicator.value = true;
};

// 隐藏指示器
const hideIndicator = () => {
  showIndicator.value = false;
  showTooltip.value = false;
};

// 关闭翻译弹窗
const closeTooltip = () => {
  showTooltip.value = false;
};

// 获取翻译结果
const getTranslation = async () => {
  if (!selectedText.value) return;
  
  isLoading.value = true;
  error.value = '';
  
  try {
    // 使用当前配置的翻译服务进行翻译
    const result = await translateText(selectedText.value);
    translationResult.value = result;
  } catch (err) {
    error.value = '翻译失败，请重试';
    console.error('Translation error:', err);
  } finally {
    isLoading.value = false;
  }
};

// 监听事件
onMounted(() => {
  document.addEventListener('mouseup', handleTextSelection);
  document.addEventListener('selectionchange', () => {
    // 延迟一下处理，避免选择过程中频繁触发
    setTimeout(handleTextSelection, 100);
  });
  
  // 监听鼠标移动到指示器上的事件
  watch(showTooltip, async (newValue: boolean) => {
    if (newValue) {
      // 当显示弹窗时，加载翻译结果
      await getTranslation();
    }
  });
});

// 清理事件监听
onBeforeUnmount(() => {
  document.removeEventListener('mouseup', handleTextSelection);
  document.removeEventListener('selectionchange', handleTextSelection);
});
</script>

<style scoped>
.selection-indicator {
  position: fixed;
  width: 12px;
  height: 12px;
  background-color: #ff4d4f;
  border-radius: 50%;
  cursor: pointer;
  z-index: 9999;
  box-shadow: 0 0 5px rgba(0, 0, 0, 0.3);
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0% {
    transform: translate(10px, -50%) scale(1);
    box-shadow: 0 0 0 0 rgba(255, 77, 79, 0.7);
  }
  70% {
    transform: translate(10px, -50%) scale(1.1);
    box-shadow: 0 0 0 10px rgba(255, 77, 79, 0);
  }
  100% {
    transform: translate(10px, -50%) scale(1);
    box-shadow: 0 0 0 0 rgba(255, 77, 79, 0);
  }
}

.translation-tooltip {
  position: fixed;
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  z-index: 10000;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.tooltip-header {
  padding: 8px 12px;
  background-color: #f5f5f5;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e8e8e8;
}

.close-btn {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: #999;
  padding: 0;
  margin: 0;
  line-height: 1;
}

.close-btn:hover {
  color: #666;
}

.tooltip-content {
  padding: 12px;
  overflow-y: auto;
  max-height: 200px;
}

.original-text {
  margin-bottom: 8px;
  color: #666;
  font-size: 14px;
  word-break: break-word;
}

.translation-result {
  color: #333;
  font-size: 15px;
  font-weight: 500;
  word-break: break-word;
}

.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #f3f3f3;
  border-top: 2px solid #3498db;
  border-radius: 50%;
  margin: 10px auto;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.error-message {
  color: #ff4d4f;
  text-align: center;
  padding: 10px;
}

/* 暗黑模式适配 */
:root.dark .translation-tooltip {
  background-color: #1f1f1f;
  border: 1px solid #333;
}

:root.dark .tooltip-header {
  background-color: #2a2a2a;
  border-bottom: 1px solid #444;
}

:root.dark .original-text {
  color: #aaa;
}

:root.dark .translation-result {
  color: #ddd;
}

:root.dark .close-btn {
  color: #bbb;
}

:root.dark .close-btn:hover {
  color: #ddd;
}
</style> 