/**
 * @file userscript/buildGzip.ts
 * 文件职责：在 userscript 构建期统一编码静态资源，避免宿主 Node/zlib 编码器版本影响内嵌 gzip 字节。
 * 主要内容：复用锁定的 pako 2.1.0 和 level 9，先保留原 memLevel 8，再依次比较 7/9，仅用更短的标准 gzip 替换；相同长度保持先前字节。
 * 构建成本：每份静态数据增加两次有限压缩，运行时仍读取同一标准格式，不增加解码路径。
 * 模块边界：仅供构建配置与插件使用，不改变输入数据、运行时解压端口、依赖或产物大小上限。
 */
import {createRequire} from 'node:module';

const gzip = createRequire(import.meta.url)('pako').gzip as
    (data: Uint8Array, options: {level: 9; memLevel: 7 | 8 | 9}) => Uint8Array;

export function gzipUserscriptBuildData(data: Uint8Array): Buffer {
    let best = gzip(data, {level: 9, memLevel: 8});
    for (const memLevel of [7, 9] as const) {
        const candidate = gzip(data, {level: 9, memLevel});
        if (candidate.byteLength < best.byteLength) best = candidate;
    }
    return Buffer.from(best);
}
