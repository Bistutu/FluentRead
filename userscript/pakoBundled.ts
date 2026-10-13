import {ungzip} from 'pako/lib/inflate.js';
import {buf2string} from 'pako/lib/utils/strings.js';

/** 无远程依赖构建在旧内核中使用随脚本打包的 pako。 */
export function inflateWithPako(bytes: Uint8Array): string {
    return String(ungzip(bytes, {to: 'string'}));
}

/** 二进制纯数据恢复保留官方 ungzip 的 Uint8Array 输出，不经过字符串转换。 */
export function inflateBytesWithPako(bytes: Uint8Array): Uint8Array {
    return ungzip(bytes);
}

/** 复用同一官方 UTF-8 解码器的原生检测与旧内核 JavaScript 回退。 */
export function decodeUtf8WithPako(bytes: Uint8Array): string {
    return buf2string(bytes);
}
