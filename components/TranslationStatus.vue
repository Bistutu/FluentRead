<template>
  <div class="translation-status-container" v-if="isVisible && isFloatingBallTranslating && !userClosed">
    <div class="translation-status-card">
      <div class="translation-status-header">
        <div class="translation-status-title">翻译进度</div>
        <div class="translation-status-close" @click="close">×</div>
      </div>
      <div class="translation-status-content">
        <div class="translation-status-row">
          <div class="translation-status-label">当前活跃任务:</div>
          <div class="translation-status-value">{{ status.activeTranslations }} / {{ status.maxConcurrent }}</div>
        </div>
        <div class="translation-status-row">
          <div class="translation-status-label">等待中的任务:</div>
          <div class="translation-status-value">{{ status.pendingTranslations }}</div>
        </div>
        <div class="translation-status-progress">
          <div class="translation-status-progress-bar" :style="progressStyle"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { getTranslationStatus } from '../entrypoints/utils/translateApi';

// 组件状态
const isVisible = ref(false);
const isFloatingBallTranslating = ref(false);
const userClosed = ref(false); // 用户是否关闭了状态框
const status = ref({
  activeTranslations: 0,
  pendingTranslations: 0,
  maxConcurrent: 6,
  isQueueFull: false,
  totalTasksInProcess: 0
});

// 计算进度条样式
const progressStyle = computed(() => {
  const percent = status.value.activeTranslations / status.value.maxConcurrent * 100;
  return {
    width: `${percent}%`,
    backgroundColor: percent > 80 ? '#ff7675' : percent > 50 ? '#fdcb6e' : '#00cec9'
  };
});

// 关闭状态卡片
const close = () => {
  userClosed.value = true; // 标记用户已关闭
};

// 重置关闭状态 - 当用户离开页面后重置
const resetClosedState = () => {
  // 监听页面可见性变化
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // 当页面不可见时（用户切换标签页或最小化），重置状态
      setTimeout(() => {
        userClosed.value = false;
      }, 1000);
    }
  });
  
  // 监听 URL 变化
  const lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      userClosed.value = false;
    }
  });
  
  // 观察 document 的子节点变化，这可能发生在 URL 变化时
  urlObserver.observe(document, { subtree: true, childList: true });
  
  return () => {
    document.removeEventListener('visibilitychange', () => {});
    urlObserver.disconnect();
  };
};

// 更新状态的定时器
let statusUpdateTimer: number;

// 创建更新状态的函数
const updateStatus = () => {
  const currentStatus = getTranslationStatus();
  status.value = currentStatus;
  
  // 只有当有活跃任务或等待任务时才显示状态卡片
  isVisible.value = currentStatus.activeTranslations > 0 || currentStatus.pendingTranslations > 0;
};

// 监听悬浮球翻译状态变化
const listenToFloatingBallState = () => {
  // 监听自定义事件: 翻译开始
  const handleTranslationStarted = () => {
    isFloatingBallTranslating.value = true;
    // 当新的翻译开始时，如果是同一页面内重新开始翻译，也要重置用户关闭状态
    if (!isVisible.value) {
      userClosed.value = false;
    }
  };
  
  // 监听自定义事件: 翻译结束
  const handleTranslationEnded = () => {
    isFloatingBallTranslating.value = false;
  };
  
  // 添加事件监听器
  document.addEventListener('fluentread-translation-started', handleTranslationStarted);
  document.addEventListener('fluentread-translation-ended', handleTranslationEnded);
  
  // 返回清理函数
  return {
    cleanup: () => {
      document.removeEventListener('fluentread-translation-started', handleTranslationStarted);
      document.removeEventListener('fluentread-translation-ended', handleTranslationEnded);
    }
  };
};

// 存储事件监听器的清理函数
let eventListenerCleanup: { cleanup: () => void };
let resetClosedStateCleanup: () => void;

// 组件挂载时启动定时器和事件监听
onMounted(() => {
  updateStatus(); // 立即执行一次更新
  statusUpdateTimer = window.setInterval(updateStatus, 500);
  eventListenerCleanup = listenToFloatingBallState();
  resetClosedStateCleanup = resetClosedState();
});

// 组件卸载时清理定时器和事件监听
onUnmounted(() => {
  clearInterval(statusUpdateTimer);
  eventListenerCleanup.cleanup();
  resetClosedStateCleanup();
});
</script>

<style scoped>
.translation-status-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9999;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
}

.translation-status-card {
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  width: 220px;
  transition: all 0.3s ease;
  border: 1px solid #e0e0e0;
}

.translation-status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background-color: #3498db;
  color: white;
  font-weight: bold;
}

.translation-status-close {
  cursor: pointer;
  font-size: 16px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: background-color 0.2s ease;
}

.translation-status-close:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

.translation-status-content {
  padding: 12px;
}

.translation-status-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 13px;
}

.translation-status-label {
  color: #666;
}

.translation-status-value {
  font-weight: 600;
  color: #333;
}

.translation-status-progress {
  height: 6px;
  background-color: #f1f1f1;
  border-radius: 3px;
  overflow: hidden;
  margin-top: 10px;
}

.translation-status-progress-bar {
  height: 100%;
  transition: width 0.3s ease, background-color 0.3s ease;
}

/* 暗黑模式支持 - 使用 :root[class="dark"] 选择器匹配 FluentRead 的主题系统 */
:root[class="dark"] .translation-status-card {
  background-color: #2d3436;
  border-color: #4d4d4d;
  color: #dfe6e9;
}

:root[class="dark"] .translation-status-header {
  background-color: #2980b9;
}

:root[class="dark"] .translation-status-label {
  color: #b2bec3;
}

:root[class="dark"] .translation-status-value {
  color: #dfe6e9;
}

:root[class="dark"] .translation-status-progress {
  background-color: #3d3d3d;
}

/* 保留媒体查询以支持自动模式 */
@media (prefers-color-scheme: dark) {
  :root:not([class="light"]) .translation-status-card {
    background-color: #2d3436;
    border-color: #4d4d4d;
    color: #dfe6e9;
  }
  
  :root:not([class="light"]) .translation-status-header {
    background-color: #2980b9;
  }
  
  :root:not([class="light"]) .translation-status-label {
    color: #b2bec3;
  }
  
  :root:not([class="light"]) .translation-status-value {
    color: #dfe6e9;
  }
  
  :root:not([class="light"]) .translation-status-progress {
    background-color: #3d3d3d;
  }
}
</style> 