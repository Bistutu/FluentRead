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
  <el-link class="right" href="https://fr.unmeta.cn/introduce" target="_blank">
    <el-icon style="margin-right: 1px;font-size: 1.25em">
      <Star/>
    </el-icon>
    插件介绍
  </el-link>
</template>

<script lang="ts" setup>
import {computed, reactive, ref} from 'vue';
import {Star} from "@element-plus/icons-vue";
import {Config} from "../entrypoints/utils/model";

// 实际上是 el-link 而不是 el-button
const buttonDisabled = ref(false);
const buttonText = ref('清除翻译缓存');
const buttonType = ref('');

const showLoading = ref(false);

async function clearCache() {
  buttonDisabled.value = true;
  buttonText.value = "正在清除...";
  showLoading.value = true; // 开始显示 Loading 图标

  // 发送消息到 content.js 告知清除缓存
  await sendMessageToContentScript({message: 'clearCache'}, function () {
    // 1秒后显示清除完成，隐藏 Loading 图标
    setTimeout(() => {
      buttonText.value = "清除完成";
      buttonType.value = 'success';
      showLoading.value = false;
    }, 1000);
    // 过3秒恢复原始文本，取消禁止状态
    setTimeout(() => {
      buttonDisabled.value = false;
      buttonText.value = '清除翻译缓存';
      buttonType.value = '';
    }, 2000);
  });
}

// 发送消息到 content.js，参数：消息体，回调函数（恢复函数）
async function sendMessageToContentScript(message: any, recover: Function) {
  const tabs = await browser.tabs.query({active: true, currentWindow: true});
  if (tabs[0] && typeof tabs[0].id === 'number') {
    await browser.tabs.sendMessage(tabs[0].id, message);  // 发送消息到 content.js 清除缓存
    recover();
  }
}

// 获取配置，用于显示翻译次数
let config = reactive(new Config());

storage.getItem('local:config').then((value) => {
  if (typeof value === 'string' && value) Object.assign(config, JSON.parse(value));
});

storage.watch('local:config', (newValue, oldValue) => {
  if (typeof newValue === 'string' && newValue) Object.assign(config, JSON.parse(newValue));
});

const computedCount = computed(() => config.count);

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
