/**
 * @file src/features/vocabulary/ui/public.ts
 * 文件职责：向学习中心公开词汇与原文收藏界面，同时保持领域公共入口不依赖 UI。
 * 主要内容：静态导出 VocabularyBook 组件，由消费方决定挂载与导航生命周期。
 * 模块边界：此入口仅供 UI 组合使用；后台、服务和纯算法应使用 vocabulary/public.ts 的数据合同。
 */
export {default as VocabularyBook} from './VocabularyBook.vue';
export {default as MaterialWorkspace} from './MaterialWorkspace.vue';
