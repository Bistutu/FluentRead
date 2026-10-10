/**
 * @file src/features/image-translation/ui/public.ts
 * 文件职责：向设置页面公开图片 OCR 和漫画配置组件，避免网页运行入口装载仅设置页使用的样式。
 * 主要内容：静态导出 ImageOcrSettings 与 MangaSettings，由设置组合层决定按需加载和挂载时机。
 * 模块边界：此入口仅供 UI 组合使用；网页图片翻译、区域翻译与漫画生命周期继续使用 image-translation/public.ts 的运行契约。
 */
export {default as ImageOcrSettings} from './ImageOcrSettings.vue';
export {default as MangaSettings} from './MangaSettings.vue';
