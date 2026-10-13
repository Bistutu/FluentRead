/**
 * @file src/features/video-subtitle/domain/public.ts
 * 文件职责：提供视频字幕设置可直接消费的纯本地模型与缓存消息协议，避免模型卡片加载播放器页面运行时。
 * 主要内容：导出现有 Tiny/Base/Small 模型选项、默认推荐模型、下载状态键与查询消息、模型配置归一化函数和字幕缓存管理消息常量，所有值与识别端共用原始定义。
 * 模块边界：只重导出 transcription.ts 与 transcriptionCache.ts 的既有纯契约，不导入 content/runtime、字幕挂载、DOM、翻译客户端、音频采集或模型初始化；应用层仍从 feature 根公共入口装配播放器生命周期。
 */
export {
    VIDEO_LOCAL_TRANSCRIPTION_MODELS,
    VIDEO_LOCAL_TRANSCRIPTION_STATE_KEY,
    VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE,
    normalizeVideoLocalTranscriptionModels,
    VIDEO_LOCAL_TRANSCRIPTION_RECOMMENDED_MODEL,
} from '../transcription';

export type {VideoLocalTranscriptionModel} from '../transcription';
export {
    VIDEO_AI_SUBTITLE_CACHE_CLEAR_MESSAGE,
    VIDEO_AI_SUBTITLE_CACHE_STATS_MESSAGE,
} from '../transcriptionCache';
