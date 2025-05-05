<template>
  <teleport to="body">
    <!-- 小红点指示器 -->
    <div v-if="showIndicator" 
         class="selection-indicator" 
         :style="indicatorStyle" 
         @mouseenter="handleMouseEnter"
         @mouseleave="handleMouseLeave">
    </div>
    
    <!-- 翻译结果弹窗 -->
    <div v-if="showTooltip" 
         class="translation-tooltip" 
         :style="tooltipStyle"
         @mouseenter="handleMouseEnterTooltip"
         @mouseleave="handleMouseLeaveTooltip">
      <div class="tooltip-header">
        <span>翻译结果<small>（via 流畅阅读）</small></span>
        <div class="tooltip-actions">
          <button class="action-btn" @click="playAudio(selectedText)" title="播放原文">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
            </svg>
          </button>
          <button class="action-btn" @click="playAudio(translationResult)" title="播放译文">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg>
          </button>
          <button class="action-btn" @click="copyTranslation" title="复制译文">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <button class="close-btn" @click="closeTooltip">×</button>
        </div>
      </div>
      <div class="tooltip-content">
        <div v-if="isLoading" class="loading-spinner"></div>
        <div v-else-if="error" class="error-message">{{ error }}</div>
        <div v-else class="translation-container">
          <div class="original-text no-select">
            {{ selectedText }}
            <button class="text-audio-btn" @click="playAudio(selectedText)" title="播放原文">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
              </svg>
            </button>
          </div>
          <div class="translation-result no-select">
            {{ translationResult }}
            <button class="text-audio-btn" @click="playAudio(translationResult)" title="播放译文">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 复制成功提示 -->
    <div v-if="copySuccess" class="copy-success-toast">
      <div class="copy-success-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
      <span>复制译文成功!</span>
    </div>

    <!-- 正在播放音频提示 -->
    <div v-if="isPlaying" class="audio-playing-toast">
      <div class="audio-playing-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
        </svg>
      </div>
      <span>正在播放...</span>
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
const hideTooltipTimer = ref<number | null>(null);
const isHoveringTooltip = ref(false);
const copySuccess = ref(false);
const isPlaying = ref(false);
const audioElement = ref<HTMLAudioElement | null>(null);

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
    maxHeight: '400px' // 增加最大高度以支持更多内容
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

// 鼠标进入指示器
const handleMouseEnter = () => {
  clearHideTooltipTimer();
  showTooltip.value = true;
};

// 鼠标离开指示器
const handleMouseLeave = () => {
  // 如果鼠标不在tooltip上，则设置定时器隐藏tooltip
  if (!isHoveringTooltip.value) {
    setHideTooltipTimer();
  }
};

// 鼠标进入弹窗
const handleMouseEnterTooltip = () => {
  isHoveringTooltip.value = true;
  clearHideTooltipTimer();
};

// 鼠标离开弹窗
const handleMouseLeaveTooltip = () => {
  isHoveringTooltip.value = false;
  setHideTooltipTimer();
};

// 设置隐藏弹窗的定时器
const setHideTooltipTimer = () => {
  clearHideTooltipTimer();
  hideTooltipTimer.value = window.setTimeout(() => {
    showTooltip.value = false;
  }, 250); // 250毫秒后隐藏
};

// 清除隐藏弹窗的定时器
const clearHideTooltipTimer = () => {
  if (hideTooltipTimer.value !== null) {
    clearTimeout(hideTooltipTimer.value);
    hideTooltipTimer.value = null;
  }
};

// 隐藏指示器
const hideIndicator = () => {
  showIndicator.value = false;
  setHideTooltipTimer();
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

// 复制翻译文本
const copyTranslation = () => {
  if (!translationResult.value) return;
  
  // 使用navigator.clipboard API复制文本
  navigator.clipboard.writeText(translationResult.value)
    .then(() => {
      // 显示复制成功消息
      copySuccess.value = true;
      // 1.5秒后隐藏消息
      setTimeout(() => {
        copySuccess.value = false;
      }, 1500);
    })
    .catch(err => {
      console.error('复制失败:', err);
    });
};

// 播放文本语音
const playAudio = (text: string) => {
  if (!text) return;
  
  // 停止当前正在播放的音频
  if (audioElement.value) {
    audioElement.value.pause();
    audioElement.value = null;
  }
  
  // 检测语言
  const language = detectLanguage(text);
  
  // 创建语音合成URL
  const speechUrl = createSpeechUrl(text, language);
  
  // 创建音频元素
  const audio = new Audio(speechUrl);
  audioElement.value = audio;
  
  // 显示正在播放状态
  isPlaying.value = true;
  
  // 监听播放结束事件
  audio.onended = () => {
    isPlaying.value = false;
    audioElement.value = null;
  };
  
  // 监听错误事件
  audio.onerror = (e) => {
    console.error('音频播放失败:', e);
    isPlaying.value = false;
    audioElement.value = null;
    
    // 尝试使用Web Speech API作为备选
    tryWebSpeechAPI(text, language);
  };
  
  // 开始播放
  audio.play().catch(err => {
    console.error('音频播放出错:', err);
    isPlaying.value = false;
    audioElement.value = null;
    
    // 尝试使用Web Speech API作为备选
    tryWebSpeechAPI(text, language);
  });
};

// 检测语言
const detectLanguage = (text: string): string => {
  // 简单的语言检测，可根据实际需求完善
  // 检测是否包含中文字符
  const hasChinese = /[\u4e00-\u9fa5]/.test(text);
  if (hasChinese) return 'zh-CN';
  
  // 检测是否包含日文字符
  const hasJapanese = /[\u3040-\u30ff]/.test(text);
  if (hasJapanese) return 'ja-JP';
  
  // 检测是否包含韩文字符
  const hasKorean = /[\uAC00-\uD7A3]/.test(text);
  if (hasKorean) return 'ko-KR';
  
  // 检测是否包含俄文字符
  const hasRussian = /[\u0400-\u04FF]/.test(text);
  if (hasRussian) return 'ru-RU';
  
  // 检测是否包含德文特殊字符
  const hasGerman = /[äöüßÄÖÜ]/.test(text);
  if (hasGerman) return 'de-DE';
  
  // 检测是否包含法文特殊字符
  const hasFrench = /[àâçéèêëîïôùûüÿæœÀÂÇÉÈÊËÎÏÔÙÛÜŸÆŒ]/.test(text);
  if (hasFrench) return 'fr-FR';
  
  // 检测是否包含西班牙文特殊字符
  const hasSpanish = /[áéíóúüñÁÉÍÓÚÜÑ]/.test(text);
  if (hasSpanish) return 'es-ES';
  
  // 默认返回英语
  return 'en-US';
};

// 创建语音合成URL
const createSpeechUrl = (text: string, language: string): string => {
  // 使用Google Text-to-Speech API
  const encodedText = encodeURIComponent(text);
  return `https://translate.google.com/translate_tts?ie=UTF-8&tl=${language}&client=tw-ob&q=${encodedText}`;
};

// 使用Web Speech API作为备选方案
const tryWebSpeechAPI = (text: string, language: string) => {
  // 检查浏览器是否支持Web Speech API
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.onend = () => {
      isPlaying.value = false;
    };
    utterance.onerror = () => {
      isPlaying.value = false;
    };
    
    isPlaying.value = true;
    window.speechSynthesis.speak(utterance);
  } else {
    console.error('此浏览器不支持语音合成');
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
  clearHideTooltipTimer();
  
  // 停止所有音频播放
  if (audioElement.value) {
    audioElement.value.pause();
    audioElement.value = null;
  }
  
  // 停止Web Speech API
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
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
  width: 300px; /* 固定宽度 */
  transition: opacity 0.2s ease;
}

.tooltip-header {
  padding: 8px 12px;
  background-color: #f5f5f5;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e8e8e8;
  position: sticky; /* 使header粘性定位 */
  top: 0;
  z-index: 1;
}

.tooltip-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.action-btn, .copy-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: #666;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 4px;
  transition: background-color 0.2s, color 0.2s;
}

.action-btn:hover, .copy-btn:hover {
  background-color: rgba(0, 0, 0, 0.05);
  color: #333;
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
  overflow-y: auto; /* 添加垂直滚动 */
  max-height: 350px; /* 增加最大高度 */
  scrollbar-width: thin; /* 细滚动条 */
  scrollbar-color: rgba(0, 0, 0, 0.3) transparent;
}

.original-text {
  margin-bottom: 8px;
  color: #666;
  font-size: 14px;
  word-break: break-word;
  padding-bottom: 8px;
  border-bottom: 1px dashed #eee;
  position: relative;
}

.translation-result {
  color: #333;
  font-size: 15px;
  font-weight: 500;
  word-break: break-word;
  margin-top: 8px;
  line-height: 1.5;
  position: relative;
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

/* 文本内播放按钮 */
.text-audio-btn {
  position: absolute;
  right: 4px;
  top: 4px;
  background: none;
  border: none;
  cursor: pointer;
  color: #999;
  opacity: 0;
  transition: opacity 0.2s, color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 4px;
}

.original-text:hover .text-audio-btn,
.translation-result:hover .text-audio-btn {
  opacity: 1;
}

.text-audio-btn:hover {
  color: #1890ff;
  background-color: rgba(24, 144, 255, 0.1);
}

/* 自定义滚动条样式 */
.tooltip-content::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.tooltip-content::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.3);
  border-radius: 3px;
}

.tooltip-content::-webkit-scrollbar-track {
  background-color: transparent;
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
  border-bottom: 1px dashed #444;
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

:root.dark .tooltip-content::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.3);
}

.translation-container {
  position: relative;
}

.no-select {
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  cursor: default;
}

/* 移除不需要的选择样式 */
.user-select-text::selection {
  background-color: #409eff;
  color: white;
}

.translation-result, .original-text {
  padding: 8px;
  border-radius: 4px;
  transition: background-color 0.15s ease;
}

.translation-result:hover, .original-text:hover {
  background-color: rgba(0, 0, 0, 0.03);
}

:root.dark .translation-result:hover, 
:root.dark .original-text:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.copy-success-toast {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 12px 20px;
  border-radius: 8px;
  font-size: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 10010;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  animation: toast-fade 1.5s ease forwards;
}

.copy-success-icon {
  color: #52c41a;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 播放中提示 */
.audio-playing-toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background-color: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  z-index: 10010;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
  animation: audio-wave 1.5s ease infinite;
}

.audio-playing-icon {
  color: #1890ff;
  display: flex;
  align-items: center;
  justify-content: center;
}

@keyframes audio-wave {
  0% { transform: scale(1); }
  50% { transform: scale(1.03); }
  100% { transform: scale(1); }
}

@keyframes toast-fade {
  0% { opacity: 0; transform: translate(-50%, -40%); }
  20% { opacity: 1; transform: translate(-50%, -50%); }
  80% { opacity: 1; transform: translate(-50%, -50%); }
  100% { opacity: 0; transform: translate(-50%, -60%); }
}

:root.dark .copy-success-toast,
:root.dark .audio-playing-toast {
  background-color: rgba(0, 0, 0, 0.85);
}

:root.dark .copy-success-icon {
  color: #73d13d;
}

:root.dark .audio-playing-icon {
  color: #69c0ff;
}

:root.dark .action-btn,
:root.dark .copy-btn,
:root.dark .text-audio-btn {
  color: #bbb;
}

:root.dark .action-btn:hover,
:root.dark .copy-btn:hover {
  background-color: rgba(255, 255, 255, 0.1);
  color: #eee;
}

:root.dark .text-audio-btn:hover {
  color: #69c0ff;
  background-color: rgba(24, 144, 255, 0.15);
}
</style> 