/**
 * @file userscript/buildGzip.ts
 * 文件职责：在 userscript 构建期统一编码静态资源，避免宿主 Node/zlib 编码器版本影响内嵌 gzip 字节。
 * 主要内容：复用锁定的 pako 2.1.0，以固定 level 9 返回标准 gzip Buffer。
 * 模块边界：仅供构建配置与插件使用，不改变输入数据、运行时解压端口、依赖或产物大小上限。
 */
import {createRequire} from 'node:module';

const gzip = createRequire(import.meta.url)('pako').gzip as
    (data: Uint8Array, options: {level: 9}) => Uint8Array;

export function gzipUserscriptBuildData(data: Uint8Array): Buffer {
    return Buffer.from(gzip(data, {level: 9}));
}
