import { createApp } from 'vue';
import FloatingBall from '@/components/FloatingBall.vue';
import { config } from '@/entrypoints/utils/config';
import browser from 'webextension-polyfill';
import { storage } from '@wxt-dev/storage';
import { autoTranslateEnglishPage, restoreOriginalContent } from '@/entrypoints/main/trans';

let floatingBallInstance: any = null;
let app: any = null;
let isTranslated = false; // 添加状态变量跟踪翻译状态

/**
 * 创建并挂载悬浮球
 * @param position 悬浮球位置 'left' | 'right'，如果不传入则使用配置中的值
 * @returns 
 */
export function mountFloatingBall(position?: 'left' | 'right') {
  // 如果配置禁用了悬浮球或已存在实例，则不创建
  if (config.disableFloatingBall || floatingBallInstance) {
    return;
  }

  // 使用传入的位置参数或配置中的位置
  const ballPosition = position || config.floatingBallPosition || 'right';
  // 更新配置
  config.floatingBallPosition = ballPosition;

  // 创建容器元素
  const container = document.createElement('div');
  container.id = 'fluent-read-floating-ball-container';
  document.body.appendChild(container);

  // 创建 Vue 应用实例
  app = createApp(FloatingBall, {
    position: ballPosition,
    showMenu: true,
    onDocClick: () => {
    },
    onSettingsClick: () => {
      browser.runtime.sendMessage({ type: 'openOptionsPage' });
    },
    // 添加位置变化事件监听
    onPositionChanged: (newPosition: 'left' | 'right') => {
      // 保存位置到配置
      config.floatingBallPosition = newPosition;
      
      // 保存配置到存储
      saveConfig();
    }
  });

  // 挂载应用
  floatingBallInstance = app.mount(container);

  // 添加事件监听
  const ballElement = container.querySelector('.floating-ball');
  if (ballElement) {
    ballElement.addEventListener('click', handleFloatingBallClick);
  }

  return floatingBallInstance;
}

/**
 * 处理悬浮球点击事件
 */
function handleFloatingBallClick(event: Event) {
  // 防止事件冒泡
  event.stopPropagation();
  
  
  if (!isTranslated) {
    // 触发即时翻译
    autoTranslateEnglishPage();
    isTranslated = true;
  } else {
    // 恢复原文
    restoreOriginalContent();
    isTranslated = false;
  }
}

/**
 * 保存配置到存储
 */
function saveConfig() {
  // 使用插件提供的存储 API 保存配置
  storage.setItem('local:config', JSON.stringify(config)).catch((error) => {
    console.error('Failed to save config:', error);
  });
}

/**
 * 卸载悬浮球
 */
export function unmountFloatingBall() {
  if (floatingBallInstance && app) {
    // 移除事件监听
    const container = document.getElementById('fluent-read-floating-ball-container');
    if (container) {
      const ballElement = container.querySelector('.floating-ball');
      if (ballElement) {
        ballElement.removeEventListener('click', handleFloatingBallClick);
      }
      
      // 卸载 Vue 应用
      app.unmount();
      floatingBallInstance = null;
      app = null;
      
      // 移除容器
      container.remove();
    }
  }
}

/**
 * 切换悬浮球可见性
 */
export function toggleFloatingBall() {
  if (floatingBallInstance) {
    unmountFloatingBall();
    config.disableFloatingBall = true;
  } else {
    config.disableFloatingBall = false;
    mountFloatingBall();
  }
  
  // 保存配置到存储
  saveConfig();
}

/**
 * 切换悬浮球位置
 */
export function toggleFloatingBallPosition() {
  const newPosition = config.floatingBallPosition === 'left' ? 'right' : 'left';
  if (floatingBallInstance) {
    unmountFloatingBall();
    config.floatingBallPosition = newPosition;
    mountFloatingBall(newPosition);
  } else {
    config.floatingBallPosition = newPosition;
  }
  
  // 保存配置到存储
  saveConfig();
} 