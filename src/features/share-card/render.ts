/**
 * @file src/features/share-card/render.ts
 * 文件职责：用本地 Canvas 排版双语摘录，生成预览与导出共用的高清 PNG；署名消费调用方提供的本地化品牌文本，默认显示中文名称。
 * 主要内容：相同译文保留原文且不重复展示；按八套主题字体真实度量换行，珊瑚上下分区，月白与蓝图双栏，晴空与落日居中，流光彩字，抹茶与书页衬线摘录；容量不足时拒绝裁切，取消或失败时释放位图与编码监听。
 * 模块边界：不截图宿主页面、不加载远程字体或图片、不上传文字；消费摘录与外观，装饰委托 themes，剪贴板及下载由导出适配器负责。
 */
import type {ShareCardPreferences} from '@/src/core/config/shareCard';
import {hasDistinctTranslation} from '@/src/core/translation/result';
import {cardGraphemes, cleanCardText, SHARE_CARD_MAX_HEIGHT, validateCardExcerpt, wrapCardText, type ShareCardExcerpt} from './core';
import {CARD_SECONDARY_FONT, CARD_THEMES, cardPrismInk, paintCardBackground} from './themes';

export class ShareCardRenderError extends Error {
    constructor(public readonly reason: 'empty' | 'long' | 'square' | 'canvas') { super(reason); }
}
const WIDTH = 640;
const SCALE = 1.5;
export interface RenderedShareCard {canvas: HTMLCanvasElement; blob: Blob; width: number; height: number}

export async function renderShareCard(excerpt: ShareCardExcerpt, preferences: ShareCardPreferences, signal?: AbortSignal, brandName = '流畅阅读'): Promise<RenderedShareCard> {
    signal?.throwIfAborted();
    const invalid = validateCardExcerpt(excerpt);
    if (invalid) throw new ShareCardRenderError(invalid);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) { canvas.width = 0; canvas.height = 0; throw new ShareCardRenderError('canvas'); }
    try {
        const theme = CARD_THEMES[preferences.theme];
        const {inset} = theme;
        const fullWidth = WIDTH - inset * 2;
        const distinct = hasDistinctTranslation(excerpt.original, excerpt.translation);
        const columns = distinct && (preferences.theme === 'pearl' || preferences.theme === 'blueprint');
        const centered = preferences.theme === 'sky' || preferences.theme === 'sunset';
        const textWidth = columns ? (fullWidth - 40) / 2 : fullWidth;
        const firstFont = (size: number) => theme.font.replace('{size}', String(size));
        const secondFont = (size: number) => `400 ${size}px ${CARD_SECONDARY_FONT}`;
        const firstText = cleanCardText(distinct && preferences.translationFirst ? excerpt.translation : excerpt.original);
        const secondText = distinct ? cleanCardText(preferences.translationFirst ? excerpt.original : excerpt.translation) : '';
        let fontSize = {small: 23, medium: 28, large: 32}[preferences.fontSize];
        const wrap = (text: string, font: string) => {
            context.font = font;
            return wrapCardText(text, textWidth, value => context.measureText(value).width);
        };
        let first: string[] = [], second: string[] = [], contentHeight = 0;
        let footer = '';
        if (preferences.showSource && excerpt.source.trim()) {
            // 保持原有 160 个 UTF-16 单元上限，边界只落在完整字素之后。
            for (const grapheme of cardGraphemes(cleanCardText(excerpt.source))) {
                if (footer.length + grapheme.length > 160) break;
                footer += grapheme;
            }
        }
        context.font = secondFont(11);
        const footerLines = footer ? wrapCardText(footer, fullWidth - (preferences.showBrand ? 110 : 0), value => context.measureText(value).width) : [];
        const footerHeight = Math.max(footerLines.length * 17, preferences.showBrand ? 17 : 0);
        const gap = distinct ? (preferences.theme === 'coral' ? 45 : 32) : 0;
        const padding = (columns ? 105 : 105 + gap) + footerHeight;
        while (true) {
            first = wrap(firstText, firstFont(fontSize));
            second = distinct ? wrap(secondText, secondFont(fontSize - 7)) : [];
            const firstHeight = first.length * fontSize * 1.4, secondHeight = second.length * (fontSize - 7) * 1.6;
            contentHeight = columns ? Math.max(firstHeight, secondHeight) : firstHeight + secondHeight;
            if (preferences.format !== 'square' || contentHeight + padding <= WIDTH) break;
            fontSize -= 1;
            if (fontSize < 23) throw new ShareCardRenderError('square');
        }
        const height = preferences.format === 'square' ? WIDTH : Math.max(300, Math.ceil(contentHeight + padding));
        if (height > SHARE_CARD_MAX_HEIGHT) throw new ShareCardRenderError('long');
        canvas.width = WIDTH * SCALE;
        canvas.height = Math.ceil(height * SCALE);
        context.scale(SCALE, SCALE);
        const top = 46 + Math.max(0, height - contentHeight - padding) / 2;
        const split = top + first.length * fontSize * 1.4 + 20;
        paintCardBackground(context, preferences.theme, WIDTH, height, split);
        context.textBaseline = 'top';
        let y = top;
        const drawLines = (lines: string[], font: string, lineHeight: number, color: string | CanvasGradient, x: number = inset) => {
            context.font = font; context.fillStyle = color;
            // 以每段首个强方向字符判定方向，数字前缀不会强制阿拉伯语变成从左到右。
            const strong = lines.join('').match(/[\p{L}]/u)?.[0] ?? '';
            const rtl = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u.test(strong);
            context.direction = rtl ? 'rtl' : 'ltr'; context.textAlign = centered ? 'center' : rtl ? 'right' : 'left';
            for (const line of lines) { context.fillText(line, centered ? WIDTH / 2 : rtl ? x + textWidth : x, y); y += lineHeight; }
            context.direction = 'ltr'; context.textAlign = 'left';
        };
        const ink = preferences.theme === 'prism' ? cardPrismInk(context, WIDTH, top) : theme.ink;
        drawLines(first, firstFont(fontSize), fontSize * 1.4, ink);
        if (columns) {
            context.fillStyle = preferences.theme === 'blueprint' ? '#90bcd166' : '#e4e5ec'; context.fillRect(WIDTH / 2, top, 1, contentHeight);
            y = top;
        } else if (distinct) {
            if (preferences.theme !== 'coral') {
                context.fillStyle = theme.accent;
                context.fillRect(centered ? WIDTH / 2 - 12 : inset, y + 10, 24, 1);
            }
            y += gap;
        }
        drawLines(second, secondFont(fontSize - 7), (fontSize - 7) * 1.6, theme.secondary, columns ? WIDTH / 2 + 20 : inset);
        y = height - 33 - footerHeight;
        context.font = secondFont(11); context.fillStyle = theme.muted;
        for (const line of footerLines) { context.fillText(line, inset, y); y += 17; }
        if (preferences.showBrand) {
            context.font = `500 10px ${CARD_SECONDARY_FONT}`; context.fillStyle = theme.accent;
            context.textAlign = 'right'; context.fillText(brandName, WIDTH - inset, height - 49);
        }
        const blob = await new Promise<Blob>((resolve, reject) => {
            const abort = () => { signal?.removeEventListener('abort', abort); reject(signal?.reason); };
            signal?.addEventListener('abort', abort, {once: true});
            try {
                canvas.toBlob(value => {
                    signal?.removeEventListener('abort', abort);
                    if (value) resolve(value);
                    else reject(new ShareCardRenderError('canvas'));
                }, 'image/png');
            } catch (error) { signal?.removeEventListener('abort', abort); reject(error); }
        });
        return {canvas, blob, width: canvas.width, height: canvas.height};
    } catch (error) {
        // toBlob 已取得快照；失败/取消后释放本地位图，迟到回调不能重建资源。
        canvas.width = 0; canvas.height = 0;
        throw error;
    }
}
