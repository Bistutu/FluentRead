/**
 * @file userscript/buildDataEncoding.ts
 * 文件职责：在构建期把已有 gzip 静态资源字节编码为紧凑的 ASCII Base85。
 * 主要内容：按四字节生成五个安全 ASCII 字符，显式记录零填充长度，并与运行时共享字母表及识别前缀。
 * 模块边界：仅转换传入字节，不修改图片、CSS、词典、许可、gzip 算法或可执行源码；资源选择由构建插件负责。
 */
import {USERSCRIPT_DATA_ALPHABET, USERSCRIPT_DATA_PREFIX} from './dataEncoding';

export function encodeUserscriptData(bytes: Uint8Array): string {
    let encoded = USERSCRIPT_DATA_PREFIX + (4 - bytes.length % 4) % 4;
    for (let index = 0; index < bytes.length; index += 4) {
        let block = bytes[index] * 0x1000000 + (bytes[index + 1] ?? 0) * 0x10000
            + (bytes[index + 2] ?? 0) * 0x100 + (bytes[index + 3] ?? 0);
        let characters = '';
        for (let digit = 0; digit < 5; digit += 1) {
            characters = USERSCRIPT_DATA_ALPHABET[block % 85] + characters;
            block = Math.floor(block / 85);
        }
        encoded += characters;
    }
    return encoded;
}
