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
      <div class="right-links">
        <el-link class="action-link" href="https://fluent.thinkstu.com/" target="_blank">
          <el-icon class="github-icon">
            <Star />
          </el-icon>
          GitHub开源
        </el-link>
      </div>
    </div>
    
    <!-- 赞赏码弹窗 -->
    <div
      title="赞赏作者"
      width="300px"
      align-center
      :show-close="true"
      :close-on-click-modal="true"
      :close-on-press-escape="true"
      class="donate-dialog"
    >
      <div class="donate-content">
        <p class="donate-text">如果您觉得这个插件对您有帮助，<br>可以通过微信👇🏻赞赏作者一杯咖啡
          <el-icon class="donate-icon"><Coffee /></el-icon> </p>
        <div class="qrcode-container">
          <img src="/misc/approve.jpg" alt="赞赏码" class="qrcode-image" />
        </div>
        <p class="donate-thanks">感谢您的支持！❤️</p>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, reactive, ref } from 'vue';
import { Star, Loading, Coffee } from "@element-plus/icons-vue";
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
  margin: -16px;
}

.translation-count {
  margin: 0px;
  font-size: 1.2em;
  color: var(--el-text-color-regular);
  text-align: center;
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

.right-links {
  display: flex;
  gap: 12px;
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

.github-icon, .donate-icon {
  font-size: 1.2em;
  margin-right: 2px;
}

.donate-icon {
  color: var(--el-color-warning);
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

/* 赞赏码弹窗样式 */
.donate-dialog :deep(.el-dialog__header) {
  padding-bottom: 10px;
  margin-right: 0;
  text-align: center;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.donate-dialog :deep(.el-dialog__headerbtn) {
  top: 15px;
}

.donate-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: -5px;
}

.donate-text {
  text-align: center;
  margin-bottom: 15px;
  color: var(--el-text-color-primary);
  line-height: 1.5;
}

.qrcode-container {
  width: 200px;
  height: 200px;
  margin: 0 auto 15px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-light);
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
  transition: transform 0.3s ease;
}

.qrcode-container:hover {
  transform: scale(1.02);
}

.qrcode-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background-color: #fff;
}

.donate-thanks {
  text-align: center;
  margin: 10px 0 15px;
  color: var(--el-color-success);
  font-weight: bold;
}

/* 暗色主题适配 */
@media (prefers-color-scheme: dark) {
  .footer-container {
    background: var(--el-bg-color-darker);
  }
  
  .qrcode-image {
    border: 1px solid var(--el-border-color);
  }
}
</style>
