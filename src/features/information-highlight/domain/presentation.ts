/**
 * @file src/features/information-highlight/domain/presentation.ts
 * 文件职责：定义智能高亮的共享色板、柔和强度与词项热力呈现，让真实阅读和设置预览使用相同绘制规则。
 * 主要内容：提供六套配色和八档透明度，深色页面整体加浓，以段内分数秩次抵抗极端值，并让深色集中在少数高分词上；三档密度按完整词项单调增加覆盖：少只留深色词，适中加上中间层，多为全部词项并把最浅的几档抬到看得见。
 * 模块边界：纯呈现算法，不计算语言模型概率、不修改原文、不解释事实重要性或保证提速，不访问网页、网络、配置存储及浏览器绘制接口。
 */
import type {InformationHighlightColor, InformationHighlightDensity, InformationHighlightIntensity, InformationHighlightStyle} from '@/src/core/config/informationHighlight';
import type {InformationHighlightSpan} from '../protocol';
import {alignInformationWordSpans} from './keywords';

export const INFORMATION_HIGHLIGHT_COLORS = Object.freeze(['rose', 'amber', 'mint', 'blue', 'violet', 'slate'] as const);
export const INFORMATION_HIGHLIGHT_PALETTES: Readonly<Record<InformationHighlightColor, Readonly<{rgb: string; swatch: string}>>> = Object.freeze({
    rose: Object.freeze({rgb: '244 114 132', swatch: '#f47284'}),
    amber: Object.freeze({rgb: '226 159 33', swatch: '#e29f21'}),
    mint: Object.freeze({rgb: '38 174 128', swatch: '#26ae80'}),
    blue: Object.freeze({rgb: '73 132 218', swatch: '#4984da'}),
    violet: Object.freeze({rgb: '143 116 221', swatch: '#8f74dd'}),
    slate: Object.freeze({rgb: '100 116 139', swatch: '#64748b'}),
});
const heatmapOpacity = Object.freeze([0.04, 0.07, 0.11, 0.16, 0.22, 0.30, 0.39, 0.50]);
export const INFORMATION_HIGHLIGHT_LEVELS = heatmapOpacity.length;
const intensityScale: Readonly<Record<InformationHighlightIntensity, number>> = Object.freeze({soft: 0.6, standard: 1, strong: 1.6});
export interface InformationHeatmapSpan extends InformationHighlightSpan {level: number}

/** 原生高亮与示意预览共用；越界强度收敛到色阶，非法值回到中间柔和强度。 */
export function informationHighlightOpacity(style: InformationHighlightStyle, level = INFORMATION_HIGHLIGHT_LEVELS - 1, intensity: InformationHighlightIntensity = 'standard', dark = false): number {
    const bounded = Number.isFinite(level) ? Math.max(0, Math.min(INFORMATION_HIGHLIGHT_LEVELS - 1, Math.round(level))) : 3;
    const base = style === 'background' ? 0.28 : style === 'underline' ? 0.8 : heatmapOpacity[bounded];
    // 用户选择的浓度整体缩放透明度；上限保证文字在深色档仍清晰可读。
    // 深色页面上同样的透明度显得更暗、浅档几乎看不见，底色整体加浓以保住层次；细线本身已足够醒目。
    return Math.round(Math.min(style === 'underline' ? 1 : 0.8, base * intensityScale[intensity] * (dark && style !== 'underline' ? 1.7 : 1)) * 1000) / 1000;
}

/**
 * 将评分表现为柔和词项热力；同分词项使用同一平均秩次，不因超大离群分数让整段失去层次。
 * 秩次经 1.5 次幂映射到色阶：多数词保持浅色，只有靠前的少数词进入深色，视线才有落点。
 * 每个词的层次不随密度变化；密度决定画到第几层：少只画分数最高的两成，适中画靠前的四成半，多画全部并把最浅的词抬到第 3 档，
 * 这样每升一档都多出一批肉眼看得见的词，而不是只多出几乎透明的底色。
 * 只绘制评分器返回的词项，不为未评分文字补出强度。
 */
export function presentInformationHeatmap(text: string, spans: readonly InformationHighlightSpan[], density: InformationHighlightDensity): InformationHeatmapSpan[] {
    const words = alignInformationWordSpans(text, spans);
    if (!words.length) return [];
    const ranked = [...words].sort((a, b) => a.score - b.score || a.start - b.start);
    const levels = new Map<number, number>();
    for (let start = 0; start < ranked.length;) {
        let end = start + 1;
        while (end < ranked.length && ranked[end].score === ranked[start].score) end++;
        const rank = (start + end - 1) / 2;
        const level = ranked[0].score === ranked[ranked.length - 1].score ? 3 : Math.round((rank / (ranked.length - 1)) ** 1.5 * (INFORMATION_HIGHLIGHT_LEVELS - 1));
        levels.set(ranked[start].score, level);
        start = end;
    }
    const count = Math.ceil(words.length * ({low: 0.2, medium: 0.45, high: 1}[density]));
    return [...words].sort((a, b) => b.score - a.score || a.start - b.start).slice(0, count).sort((a, b) => a.start - b.start)
        .map(span => ({...span, level: Math.max(density === 'high' ? 3 : 0, levels.get(span.score)!)}));
}
