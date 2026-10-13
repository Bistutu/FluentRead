/**
 * @file src/features/image-translation/services/ocrPixels.ts
 * 文件职责：在 OCR 独占的 RGBA 像素副本上合成透明通道，避免识别内核丢弃透明信息后让文字与背景失去对比。
 * 主要内容：不透明输入只扫描 alpha 并保持像素不变；透明输入按可见前景的 alpha 加权亮度选择黑色或白色背景，原地合成为不透明像素，并返回是否需要写回识别画布。
 * 模块边界：该纯函数不创建画布、不解码图片、不旋转坐标、不修改用于译图渲染的原图；调用方必须传入独占且完整的 RGBA 像素副本。
 */

export function flattenOcrAlpha(pixels: Uint8ClampedArray): boolean {
    let hasTransparency = false;
    for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] !== 255) {
            hasTransparency = true;
            break;
        }
    }
    if (!hasTransparency) return false;

    let foregroundAlpha = 0;
    let foregroundBrightness = 0;
    for (let index = 0; index < pixels.length; index += 4) {
        const alpha = pixels[index + 3];
        if (alpha === 0) continue;
        foregroundAlpha += alpha;
        foregroundBrightness += alpha * (0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]);
    }
    const background = foregroundAlpha > 0 && foregroundBrightness >= 128 * foregroundAlpha ? 0 : 255;
    for (let index = 0; index < pixels.length; index += 4) {
        const alpha = pixels[index + 3];
        if (alpha === 255) continue;
        const opacity = alpha / 255;
        const backgroundPart = background * (1 - opacity);
        pixels[index] = pixels[index] * opacity + backgroundPart;
        pixels[index + 1] = pixels[index + 1] * opacity + backgroundPart;
        pixels[index + 2] = pixels[index + 2] * opacity + backgroundPart;
        pixels[index + 3] = 255;
    }
    return true;
}
