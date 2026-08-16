export const MAX_REMOTE_IMAGE_BYTES = 16 * 1024 * 1024;

export function normalizeRemoteImageUrl(source: string): string {
    let url: URL;
    try {
        url = new URL(source);
    } catch {
        throw new Error('图片地址无效');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('只支持网页图片地址');
    }

    return url.href;
}

export function imageBufferToDataUrl(buffer: ArrayBuffer, contentType: string): string {
    if (buffer.byteLength > MAX_REMOTE_IMAGE_BYTES) {
        throw new Error('图片文件过大');
    }

    const mimeType = contentType.split(';', 1)[0]?.trim().toLowerCase();
    if (!mimeType?.startsWith('image/')) {
        throw new Error('远程地址不是图片');
    }

    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }

    return `data:${mimeType};base64,${btoa(binary)}`;
}
