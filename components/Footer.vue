<template>
  <p style="margin: 0">你已经翻译
    <el-text class="mx-1" type="success">{{ computedCount }}</el-text>
    次
  </p>
  <el-link class="left" :type="buttonType" @click="clearCache" :disabled="buttonDisabled">
    <el-icon v-if="showLoading">
      <Loading class="el-icon-loading"/>
    </el-icon>
    {{ buttonText }}
  </el-link>
  <el-link class="right" href="https://github.com/Bistutu/FluentRead" target="_blank">
    <el-icon style="margin-right: 1px;font-size: 1.25em">
      <Star/>
    </el-icon>
    GitHub开源
  </el-link>
</template>

<script lang="ts" setup>
import {computed, reactive, ref} from 'vue';
import {Star} from "@element-plus/icons-vue";
import {Config} from "../entrypoints/utils/model";
import {config as importedConfig} from "@/entrypoints/utils/config";
import { storage } from '@wxt-dev/storage';
import browser from 'webextension-polyfill';

// 实际上是 el-link 而不是 el-button
const buttonDisabled = ref(false);
const buttonText = ref('清除翻译缓存');
const buttonType = ref('');

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
    
    // 成功清除后的UI反馈
    setTimeout(() => {
      buttonText.value = "清除完成";
      buttonType.value = 'success';
      showLoading.value = false;
    }, 500);

    // 恢复按钮状态
    setTimeout(() => {
      buttonDisabled.value = false;
      buttonText.value = '清除翻译缓存';
      buttonType.value = '';
    }, 1500);

  } catch (error) {
    console.error('清除缓存失败:', error);
    buttonText.value = "清除失败";
    buttonType.value = 'danger';
    
    // 恢复按钮状态
    setTimeout(() => {
      buttonDisabled.value = false;
      buttonText.value = '清除翻译缓存';
      buttonType.value = '';
      showLoading.value = false;
    }, 1500);
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
.left {
  float: left;
  margin: 0 0 0 1em;
}

.right {
  float: right;
  margin: 0 1em 0 0;
}

.el-icon-loading {
  animation: rotating 2s linear infinite;
}

@keyframes rotating {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
