/**
 * @file src/features/personal-corrections/types.ts
 * 文件职责：定义网页校订浮层与已有全文翻译公开端口之间的契约。
 * 主要内容：原译文对、只读语言和语境、精确受影响句子预览与撤销后的页面刷新能力。
 * 模块边界：仅声明类型；不持有宿主 DOM、不持久化内容，也不改变翻译调度与公共缓存。
 */
import type {CorrectionQuery} from '@/src/core/personal-corrections/public';
import type {personalCorrections} from '@/src/services/personal-corrections/public';

export interface PersonalCorrectionPair extends CorrectionQuery {
  translation: string;
  apply(translation: string, recordId?: string): boolean;
  isCurrent(): boolean;
}

export interface PersonalCorrectionUiPorts {
  readPair(element: Element): PersonalCorrectionPair | null;
  listVisiblePairs(query: CorrectionQuery): PersonalCorrectionPair[];
  refreshVisible(): Promise<void> | void;
  /** 测试只替换持久化边界，实际网页默认使用本地个人校订服务。 */
  service?: typeof personalCorrections;
}
