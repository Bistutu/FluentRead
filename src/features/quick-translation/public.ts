/**
 * @file src/features/quick-translation/public.ts
 * 文件职责：提供快捷翻译 feature 的稳定公共入口，让内容脚本组合层无需依赖其内部手势状态。
 * 主要内容：再导出可注入的挂载函数、一次调用的纯配置解析以及组合层需要实现的依赖契约。
 * 模块边界：该 barrel 不读取 store、不注册事件也不执行翻译；实际监听只存在于 content/index.ts。
 */
export {
    mountQuickTranslationContentFeature,
    type QuickTranslationContentDependencies,
} from './content';
export {resolveQuickTranslationInvocation} from './core';
