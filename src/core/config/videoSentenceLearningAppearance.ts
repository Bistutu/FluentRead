/**
 * @file src/core/config/videoSentenceLearningAppearance.ts
 * 文件职责：定义完整句学习面板的独立外观配置、默认值与有界 CSS 变量契约。
 * 主要内容：归一化紧凑或舒适布局、背景不透明度、字号、面板宽度和初始四角位置，默认让主要空间留给原句与译文；预览和播放器复用同一套变量。
 * 模块边界：仅转换纯配置，不读取媒体、DOM 或存储；拖动位置属于播放器本次会话，不写入配置或同步数据。
 */

export type VideoSentenceLearningLayout = 'compact' | 'comfortable';
export type VideoSentenceLearningPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

export interface VideoSentenceLearningAppearance {
    layout: VideoSentenceLearningLayout;
    backgroundOpacity: number;
    fontScale: number;
    width: number;
    position: VideoSentenceLearningPosition;
}

export const VIDEO_SENTENCE_LEARNING_APPEARANCE_RANGES = {
    backgroundOpacity: {min: 60, max: 100},
    fontScale: {min: 90, max: 130},
    width: {min: 300, max: 520},
} as const;

export const DEFAULT_VIDEO_SENTENCE_LEARNING_APPEARANCE: Readonly<VideoSentenceLearningAppearance> = {
    layout: 'compact',
    backgroundOpacity: 94,
    fontScale: 100,
    width: 360,
    position: 'top-right',
};

function normalizeNumber(value: unknown, fallback: number, range: {min: number; max: number}): number {
    const number = typeof value === 'number' ? value
        : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
    return Number.isFinite(number) ? Math.min(range.max, Math.max(range.min, Math.round(number))) : fallback;
}

export function normalizeVideoSentenceLearningAppearance(value: unknown): VideoSentenceLearningAppearance {
    const source = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
    const defaults = DEFAULT_VIDEO_SENTENCE_LEARNING_APPEARANCE;
    const position = source.position === 'top-left' || source.position === 'bottom-right' || source.position === 'bottom-left'
        ? source.position : defaults.position;
    return {
        layout: source.layout === 'comfortable' ? 'comfortable' : defaults.layout,
        backgroundOpacity: normalizeNumber(source.backgroundOpacity, defaults.backgroundOpacity, VIDEO_SENTENCE_LEARNING_APPEARANCE_RANGES.backgroundOpacity),
        fontScale: normalizeNumber(source.fontScale, defaults.fontScale, VIDEO_SENTENCE_LEARNING_APPEARANCE_RANGES.fontScale),
        width: normalizeNumber(source.width, defaults.width, VIDEO_SENTENCE_LEARNING_APPEARANCE_RANGES.width),
        position,
    };
}

export function getVideoSentenceLearningAppearanceCssVars(value: unknown): Record<string, string> {
    const appearance = normalizeVideoSentenceLearningAppearance(value);
    const compact = appearance.layout === 'compact';
    return {
        '--fluent-read-video-learning-width': `${appearance.width}px`,
        '--fluent-read-video-learning-font-size': `${13 * appearance.fontScale / 100}px`,
        '--fluent-read-video-learning-original-font-size': `${(compact ? 17 : 19) * appearance.fontScale / 100}px`,
        '--fluent-read-video-learning-background': `rgba(24,24,28,${appearance.backgroundOpacity / 100})`,
        '--fluent-read-video-learning-gap': compact ? '8px' : '12px',
        '--fluent-read-video-learning-padding': compact ? '12px' : '16px',
        '--fluent-read-video-learning-line-height': compact ? '1.45' : '1.6',
        '--fluent-read-video-learning-control-height': compact ? '30px' : '36px',
    };
}
