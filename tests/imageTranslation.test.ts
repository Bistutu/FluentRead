import { describe, expect, it } from 'vitest';
import { imageBufferToDataUrl, normalizeRemoteImageUrl } from '@/entrypoints/utils/imageFetch';
import { getOcrLanguages, normalizeOcrLines, scaleOcrBox } from '@/entrypoints/utils/imageTranslationCore';

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

    it('只允许通过扩展后台读取网页图片地址', () => {
        expect(normalizeRemoteImageUrl('https://cdn.example.com/image.png')).toBe('https://cdn.example.com/image.png');
        expect(() => normalizeRemoteImageUrl('data:image/png;base64,AA==')).toThrow('只支持网页图片地址');
    });

    it('把远程图片字节转换成 OCR 可读取的数据地址', () => {
        const data = imageBufferToDataUrl(new Uint8Array([1, 2, 255]).buffer, 'image/png; charset=binary');
        expect(data).toBe('data:image/png;base64,AQL/');
    });
});
