/**
 * @file entrypoints/selection/main.ts
 * 文件职责：启动原生 PDF 右键划词的独立结果窗口。
 * 主要内容：把固定挂载点交给 app 组合根，保持 WXT 页面入口不持有浏览器菜单、原文或翻译逻辑。
 * 模块边界：入口只绑定页面生命周期，令牌领取、严格选区和卡片复用归 src/app/selection。
 */
import {mountNativePdfSelectionApp} from '@/src/app/selection/page';

mountNativePdfSelectionApp('#app');
