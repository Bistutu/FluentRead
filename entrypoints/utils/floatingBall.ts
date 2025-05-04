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

    },
    // 添加翻译状态变化事件监听
    onTranslationToggle: (isTranslating: boolean) => {
      if (isTranslating && !isTranslated) {
        // 触发即时翻译
        autoTranslateEnglishPage();
        isTranslated = true;
      } else if (!isTranslating && isTranslated) {
        // 恢复原文
        restoreOriginalContent();
        isTranslated = false;
        
        // 恢复后确保状态同步
        floatingBallInstance.$el.classList.remove('is-translating');
      }
    }
  });

  // 挂载应用
  floatingBallInstance = app.mount(container);
  
  // 监听自定义事件，用于通过快捷键触发悬浮球
  document.addEventListener('fluentread-toggle-translation', toggleFloatingBallTranslation);

  return floatingBallInstance;
}

/**
 * 切换悬浮球翻译状态
 */
export function toggleFloatingBallTranslation() {
  if (!floatingBallInstance) return;
  
  const isDev = process.env.NODE_ENV === 'development';
  
  if (isTranslated) {
    // 如果当前是翻译状态，恢复原文
    restoreOriginalContent();
    isTranslated = false;
    
    // 更新悬浮球UI状态
    floatingBallInstance.isTranslating = false;
    
    // 兼容Vue组件暴露的元素
    const element = floatingBallInstance.element || floatingBallInstance.$el;
    if (element) {
      element.classList.remove('translating', 'is-translating');
    }
    
    if (isDev) {
      console.log('[FluentRead] 通过快捷键取消翻译');
    }
  } else {
    // 如果当前是原文状态，执行翻译
    // 先标记状态
    isTranslated = true;
    floatingBallInstance.isTranslating = true;
    
    // 兼容Vue组件暴露的元素
    const element = floatingBallInstance.element || floatingBallInstance.$el;
    if (element) {
      element.classList.add('translating', 'is-translating');
    }
    
    // 执行翻译
    autoTranslateEnglishPage();
    
    if (isDev) {
      console.log('[FluentRead] 通过快捷键激活翻译');
    }
  }
}

// 悬浮球动画效果
function addFloatingBallAnimation(type: 'translate' | 'restore') {
  if (!floatingBallInstance) return;
  
  const ball = floatingBallInstance.element;
  const originalBackground = ball.style.background;
  const originalTransition = ball.style.transition;
  
  // 设置过渡效果
  ball.style.transition = 'all 0.3s ease';
  
  // 根据类型设置不同动画
  if (type === 'translate') {
    // 翻译激活动画
    ball.style.transform = 'scale(1.2)';
    ball.style.boxShadow = '0 0 15px rgba(0, 128, 255, 0.8)';
    ball.style.background = '#4285f4';
  } else {
    // 恢复原文动画
    ball.style.transform = 'scale(1.2)';
    ball.style.boxShadow = '0 0 15px rgba(76, 175, 80, 0.8)';
    ball.style.background = '#4caf50';
  }
  
  // 恢复原状
  setTimeout(() => {
    if (!floatingBallInstance) return;
    ball.style.transform = '';
    ball.style.boxShadow = '';
    ball.style.background = originalBackground;
    
    // 恢复原来的过渡设置
    setTimeout(() => {
      if (floatingBallInstance) {
        ball.style.transition = originalTransition;
      }
    }, 300);
  }, 300);
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
    document.removeEventListener('fluentread-toggle-translation', toggleFloatingBallTranslation);
    
    // 获取容器
    const container = document.getElementById('fluent-read-floating-ball-container');
    
    // 卸载 Vue 应用
    app.unmount();
    floatingBallInstance = null;
    app = null;
    
    // 移除容器
    if (container) {
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