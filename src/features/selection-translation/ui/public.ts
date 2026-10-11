/**
 * @file src/features/selection-translation/ui/public.ts
 * 文件职责：向其他阅读界面提供纯文本跟读展示的公共入口。
 * 主要内容：重导出已有 SpeechFollowText 组件，使学习面板复用相同词面高亮与估算说明。
 * 模块边界：仅组装展示出口，不把 Vue 或浏览器依赖引入朗读协议公共面，不创建播放或合成请求。
 */
export {default as SpeechFollowText} from './SpeechFollowText.vue';
