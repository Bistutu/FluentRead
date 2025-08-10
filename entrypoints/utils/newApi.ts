import { config } from "@/entrypoints/utils/config";
import {customModelString, services} from "@/entrypoints/utils/option";
import { storage } from '@wxt-dev/storage';

let containerEl: HTMLElement | null = null;

/**
 * 挂载New API 组件
 */
export function mountNewApiComponent() {
  // 如果已存在实例或配置禁用了此功能，则不创建
  if (containerEl) {
    return;
  }

  // 创建容器元素
  const container = document.createElement('div');
  container.id = 'fluent-new-api-container';
  document.body.appendChild(container);
  containerEl = container;

  container.addEventListener('fluent:prefill', async (e) => {
    const customEvent = e as CustomEvent;
    const payload = (customEvent?.detail) || {};

    const id = payload.id || '';

    if (id !== 'new-api') return; // 只处理 New API 的事件

    const baseUrl = payload.baseUrl || '';
    const apiKey = payload.apiKey || '';
    const model = payload.model || '';
    const maskedKey = apiKey ? apiKey.slice(0, 3) + '***' + apiKey.slice(-3) : '(空)';

    const confirmed = window.confirm(
      `检测到 New API 配置：\n- 接口地址: ${baseUrl || '(空)'}\n- API Key: ${maskedKey}\n- 模型: ${model || '(空)'}\n\n是否应用该配置并切换到 New API？`
    );
    if (!confirmed) return;

    config.newApiUrl = baseUrl;
    config.token[services.newapi] = apiKey;
    config.service = services.newapi;
    if (model && model !== '') {
      config.model[config.service] = customModelString
      config.customModel[config.service] = model;
    }


    try {
      await storage.setItem('local:config', JSON.stringify(config));
    } catch (error) {
      console.error('Error saving config:', error);
    }
  });

  return container;
}

/**
 * 卸载New API 组件
 */
export function unmountNewApiComponent() {
  const container = document.getElementById('fluent-new-api-container');
  if (container) container.remove();
  containerEl = null;
}