<template>
  <div class="footer-container">
    <p class="translation-count">你已经翻译
      <el-text class="count-number" type="primary">{{ computedCount }}</el-text>
      次
    </p>
    <div class="footer-links">
      <el-link class="action-link left" :class="{ 'failed': buttonText === '清除失败' }" @click="clearCache"
        :disabled="buttonDisabled">
        <el-icon v-if="showLoading">
          <Loading class="el-icon-loading" />
        </el-icon>
        {{ buttonText }}
      </el-link>
      <el-link class="action-link right" href="https://github.com/Bistutu/FluentRead" target="_blank">
        <el-icon class="github-icon">
          <Star />
        </el-icon>
        GitHub开源
      </el-link>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, reactive, ref } from 'vue';
import { Star, Loading } from "@element-plus/icons-vue";
import { Config } from "../entrypoints/utils/model";
import { storage } from '@wxt-dev/storage';
import browser from 'webextension-polyfill';

// 实际上是 el-link 而不是 el-button
const buttonDisabled = ref(false);
const buttonText = ref('清除翻译缓存');

const showLoading = ref(false);

async function clearCache() {
  try {
    buttonDisabled.value = true;
    buttonText.value = "正在清除...";
    showLoading.value = true;

    // 获取当前标签页
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.id) {
      throw new Error('No active tab found');
    }

    // 发送消息到 content.js
    await browser.tabs.sendMessage(tabs[0].id, { type: 'clearCache' });

    // 恢复按钮状态
    setTimeout(() => {
      buttonDisabled.value = false;
      buttonText.value = '清除翻译缓存';
      showLoading.value = false;
    }, 1000);

  } catch (error) {
    console.error('清除缓存失败:', error);
    buttonText.value = "清除失败";

    // 恢复按钮状态
    setTimeout(() => {
      buttonDisabled.value = false;
      buttonText.value = '清除翻译缓存';
      showLoading.value = false;
    }, 1000);
  }
}

// 获取配置，用于显示翻译次数
let localConfig = reactive(new Config());

storage.getItem('local:config').then((value) => {
  if (typeof value === 'string' && value) Object.assign(localConfig, JSON.parse(value));
});

storage.watch('local:config', (newValue, oldValue) => {
  if (typeof newValue === 'string' && newValue) Object.assign(localConfig, JSON.parse(newValue));
});

const computedCount = computed(() => localConfig.count);


</script>

<style scoped>
.footer-container {
  background: var(--el-bg-color);
  margin: 0 -16px;
  padding: 10px 16px;
}

.translation-count {
  margin: 0;
  font-size: 1.2em;
  color: var(--el-text-color-regular);
  text-align: center;
  margin-bottom: 8px;
}

.count-number {
  font-weight: 600;
  font-size: 1.1em;
  margin: 0 3px;
  color: var(--el-color-success);
}

.footer-links {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 16px;
}

.action-link {
  font-size: 1.2em;
  transition: all 1s ease;
  text-decoration: none !important;
  display: flex;
  align-items: center;
  gap: 4px;
}

.action-link:hover {
  opacity: 0.8;
}

.action-link:active {
  transform: scale(0.98);
}

.github-icon {
  font-size: 1.2em;
  margin-right: 4px;
}

:deep(.el-icon-loading) {
  animation: rotating 1s linear infinite;
}

@keyframes rotating {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.clearing {
  color: var(--el-color-success) !important;
}

.failed {
  color: var(--el-color-danger) !important;
}

/* 暗色主题适配 */
@media (prefers-color-scheme: dark) {
  .footer-container {
    background: var(--el-bg-color-darker);
  }
}
</style>
