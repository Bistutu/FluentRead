import { describe, expect, it } from 'vitest';
import { imageBufferToDataUrl, normalizeRemoteImageUrl } from '@/entrypoints/utils/imageFetch';
import { getOcrLanguages, normalizeOcrLines, scaleOcrBox, selectChangedTranslations } from '@/entrypoints/utils/imageTranslationCore';
import { inpaintTextRegions } from '@/entrypoints/utils/imageInpainting';

describe('图片翻译 OCR 工具', () => {
    it('按源语言选择最小 OCR 语言集', () => {
        expect(getOcrLanguages('en')).toEqual(['eng']);
        expect(getOcrLanguages('zh-Hans')).toEqual(['chi_sim', 'eng']);
        expect(getOcrLanguages('ja')).toEqual(['jpn', 'eng']);
        expect(getOcrLanguages('auto')).toEqual(['eng', 'chi_sim', 'jpn']);
    });

    it('把 OCR 坐标按图片显示尺寸缩放', () => {
        expect(scaleOcrBox(
            { x0: 100, y0: 50, x1: 500, y1: 150 },
            1000,
            500,
            500,
            250,
        )).toEqual({ left: 50, top: 25, width: 200, height: 50 });
    });

    it('过滤空 OCR 行并保留文本框', () => {
        const lines = normalizeOcrLines([
            {
                paragraphs: [{
                    lines: [
                        { text: ' Hello   world ', bbox: { x0: 0, y0: 0, x1: 20, y1: 10 } },
                        { text: '   ', bbox: { x0: 0, y0: 0, x1: 20, y1: 10 } },
                    ],
                }],
            } as never,
        ]);

        expect(lines).toEqual([{ text: 'Hello world', bbox: { x0: 0, y0: 0, x1: 20, y1: 10 } }]);
    });

    it('不为微软原样返回的 OCR 行生成翻译覆盖层', () => {
        const lines = [
            { text: '中文标题', bbox: { x0: 0, y0: 0, x1: 40, y1: 12 } },
            { text: 'Hello world', bbox: { x0: 0, y0: 20, x1: 80, y1: 32 } },
        ];

        expect(selectChangedTranslations(lines, ['中文标题', '你好世界'])).toEqual([{
            text: '你好世界',
            bbox: { x0: 0, y0: 20, x1: 80, y1: 32 },
        }]);
    });

    it('优先使用紧凑的 OCR word 框，避免整行控件被合并成一个大框', () => {
        const lines = normalizeOcrLines([
            {
                paragraphs: [{
                    lines: [{
                        text: 'ignored wide line',
                        bbox: { x0: 0, y0: 0, x1: 200, y1: 30 },
                        words: [
                            { text: 'Translate', confidence: 90, bbox: { x0: 20, y0: 8, x1: 75, y1: 20 } },
                            { text: 'the', confidence: 90, bbox: { x0: 80, y0: 8, x1: 100, y1: 20 } },
                            { text: 'following', confidence: 90, bbox: { x0: 106, y0: 8, x1: 164, y1: 20 } },
                            { text: 'button', confidence: 90, bbox: { x0: 240, y0: 8, x1: 280, y1: 20 } },
                        ],
                    }],
                }],
            },
        ]);

        expect(lines).toEqual([
            { text: 'Translate the following', bbox: { x0: 20, y0: 8, x1: 164, y1: 20 } },
            { text: 'button', bbox: { x0: 240, y0: 8, x1: 280, y1: 20 } },
        ]);
    });

    it('只允许通过扩展后台读取网页图片地址', () => {
        expect(normalizeRemoteImageUrl('https://cdn.example.com/image.png')).toBe('https://cdn.example.com/image.png');
        expect(() => normalizeRemoteImageUrl('data:image/png;base64,AA==')).toThrow('只支持网页图片地址');
    });

    it('把远程图片字节转换成 OCR 可读取的数据地址', () => {
        const data = imageBufferToDataUrl(new Uint8Array([1, 2, 255]).buffer, 'image/png; charset=binary');
        expect(data).toBe('data:image/png;base64,AQL/');
    });

    it('用周边像素修复文字区域，而不是用整块纯色覆盖', () => {
        const width = 9;
        const height = 5;
        const source = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const offset = (y * width + x) * 4;
                source[offset] = x * 20;
                source[offset + 1] = y * 30;
                source[offset + 2] = 100;
                source[offset + 3] = 255;
            }
        }
        // 模拟文字像素：修复后不应继续保留这个明显的黑色残影。
        const textPixel = (2 * width + 4) * 4;
        source[textPixel] = 0;
        source[textPixel + 1] = 0;
        source[textPixel + 2] = 0;
        const result = inpaintTextRegions(source, width, height, [{
            text: 'text',
            bbox: { x0: 3, y0: 1, x1: 6, y1: 4 },
        }]);

        const centre = textPixel;
        expect(result[centre]).toBeGreaterThan(source[centre]);
        expect(result[centre + 1]).toBeGreaterThan(source[centre + 1]);
        expect(result[centre + 2]).toBe(100);
        expect(result[centre + 3]).toBe(255);
    });
});
