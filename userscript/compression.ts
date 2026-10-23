import {inflateWithPako} from '@/userscript/pakoRuntime';
import {decodeUserscriptData} from './dataEncoding';

/** 解开内嵌的 gzip 文本，兼容旧 Base64 与独立版静态数据编码；旧内核继续使用既有 pako。 */
export async function inflateGzipBase64(base64: string): Promise<string> {
    const bytes = decodeUserscriptData(base64);
    if (typeof DecompressionStream === 'function') {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new Response(stream).text();
    }
    return inflateWithPako(bytes);
}
