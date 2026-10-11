/**
 * @file userscript/translationInsights.ts
 * 文件职责：为只在 HTTP(S) 页面运行的 GF 产物提供翻译统计旁路端口。
 * 主要内容：保留共享 broker 所需的两个代次和记录合同，代次恒为零，记录不读取事件、不创建数据库也不落库。
 * 模块边界：只由 GF 的精确 repository alias 接入；扩展、标准与 standalone 保留原统计仓库。新增统计调用或协议必须重新审核此边界。
 */
import type {ModelUsageEvent} from '@/src/services/model-usage/types';
import type {TranslationRequestStatsEvent} from '@/src/services/translation-stats/types';

export const modelUsageRepository = {
    captureGeneration(): number {return 0;},
    async recordMany(_events: readonly ModelUsageEvent[], _expectedGeneration = 0): Promise<number> {return 0;},
};

export const translationStatsRepository = {
    captureGeneration(): number {return 0;},
    record(_event: TranslationRequestStatsEvent, _expectedGeneration = 0): void {},
};
