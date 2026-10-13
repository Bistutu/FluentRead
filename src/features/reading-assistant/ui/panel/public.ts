/**
 * @file src/features/reading-assistant/ui/panel/public.ts
 * 文件职责：向划词翻译公开完整阅读卡，保持真实卡片交互与样式的统一所有权。
 * 主要内容：仅导出 ReadingPanel，由宿主传入选区、偏好、活动状态及已有译文并处理卡片事件。
 * 模块边界：阅读卡继续管理自身的请求、历史和卸载清理；纯回答展示与数据客户端通过各自出口提供。
 */
export {default as ReadingPanel} from '../ReadingPanel.vue';
