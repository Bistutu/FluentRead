/**
 * @file src/ui/i18n/types.ts
 * 文件职责：定义 Vue 界面语言适配器的公共类型契约。
 * 主要内容：描述当前语言、资源修订号、稳定键与旧文案翻译、异步语言保存和释放能力。
 * 模块边界：只依赖 Vue Ref 与 core i18n 类型；不创建响应式状态、不订阅配置、不加载语言资源或扫描 DOM。
 */
import type {Ref} from 'vue';
import type {TranslationParams, UiLanguage} from '@/src/core/i18n/types';

export interface UiI18nContext {
    language: Readonly<Ref<UiLanguage>>;
    /** 当前语言资源包注册后递增；依赖它的渲染与旧文案扫描会在资源到达后自动刷新。 */
    bundleRevision: Readonly<Ref<number>>;
    t: (key: string, params?: TranslationParams) => string;
    translateLegacy: (value: string) => string;
    /** 当前选择保存成功返回 true；被新选择、外部配置或销毁取代返回 false，当前资源加载或保存失败仍抛错。 */
    setLanguage: (value: unknown) => Promise<boolean>;
    dispose: () => void;
}
