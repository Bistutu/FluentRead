<template>
  <div class="translation-status-container" v-if="isVisible">
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
  isVisible.value = false;
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

// 组件挂载时启动定时器
onMounted(() => {
  updateStatus(); // 立即执行一次更新
  statusUpdateTimer = window.setInterval(updateStatus, 500);
});

// 组件卸载时清理定时器
onUnmounted(() => {
  clearInterval(statusUpdateTimer);
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

/* 暗黑模式支持 */
@media (prefers-color-scheme: dark) {
  .translation-status-card {
    background-color: #2d3436;
    border-color: #4d4d4d;
  }
  
  .translation-status-header {
    background-color: #2980b9;
  }
  
  .translation-status-label {
    color: #b2bec3;
  }
  
  .translation-status-value {
    color: #dfe6e9;
  }
  
  .translation-status-progress {
    background-color: #3d3d3d;
  }
}
</style> 