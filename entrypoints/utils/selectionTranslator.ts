import { createApp } from 'vue';
import SelectionTranslator from '@/components/SelectionTranslator.vue';
import { config } from '@/entrypoints/utils/config';
import { storage } from '@wxt-dev/storage';

let selectionTranslatorInstance: any = null;
let app: any = null;

/**
 * 挂载选词翻译组件
 */
export function mountSelectionTranslator() {
  // 如果已存在实例或配置禁用了此功能，则不创建
  if (selectionTranslatorInstance || config.disableSelectionTranslator || config.selectionTranslatorMode === 'disabled') {
    return;
  }

  // 创建容器元素
  const container = document.createElement('div');
  container.id = 'fluent-read-selection-translator-container';
  document.body.appendChild(container);

  // 创建Vue应用实例
  app = createApp(SelectionTranslator);

  // 挂载应用
  selectionTranslatorInstance = app.mount(container);

  return selectionTranslatorInstance;
}

/**
 * 卸载选词翻译组件
 */
export function unmountSelectionTranslator() {
  if (selectionTranslatorInstance && app) {
    // 获取容器
    const container = document.getElementById('fluent-read-selection-translator-container');
    
    // 卸载Vue应用
    app.unmount();
    selectionTranslatorInstance = null;
    app = null;
    
    // 移除容器
    if (container) {
      container.remove();
    }
  }
}

/**
 * 切换选词翻译组件的启用状态
 */
export function toggleSelectionTranslator() {
  if (selectionTranslatorInstance) {
    unmountSelectionTranslator();
    config.disableSelectionTranslator = true;
  } else {
    config.disableSelectionTranslator = false;
    mountSelectionTranslator();
  }
  
  // 保存配置到存储
  saveConfig();
}

/**
 * 保存配置到存储
 */
function saveConfig() {
  // 使用插件提供的存储API保存配置
  storage.setItem('local:config', JSON.stringify(config)).catch((error) => {
    console.error('Failed to save config:', error);
  });
} 