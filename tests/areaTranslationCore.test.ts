import { describe, expect, it } from 'vitest';
import { areaRectToImageCrop, isUsableAreaRect, normalizeAreaRect } from '@/entrypoints/utils/areaTranslationCore';

describe('圈选翻译区域几何', () => {
    it('支持从任意方向拖拽，并把矩形限制在视口内', () => {
        expect(normalizeAreaRect({ x: 500, y: 400 }, { x: -20, y: 40 }, { width: 480, height: 360 })).toEqual({
            left: 0,
            top: 40,
            width: 480,
            height: 320,
        });
    });

    it('过滤过小的误触区域', () => {
        expect(isUsableAreaRect({ left: 0, top: 0, width: 11, height: 40 })).toBe(false);
        expect(isUsableAreaRect({ left: 0, top: 0, width: 12, height: 12 })).toBe(true);
    });

    it('把 CSS 视口矩形映射为高 DPI 截图像素坐标', () => {
        expect(areaRectToImageCrop({
            left: 50,
            top: 25,
            width: 200,
            height: 100,
            viewportWidth: 500,
            viewportHeight: 250,
        }, 1000, 500)).toEqual({ left: 100, top: 50, width: 400, height: 200 });
    });
});
