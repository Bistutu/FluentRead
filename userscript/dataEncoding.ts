/**
 * @file userscript/dataEncoding.ts
 * 文件职责：恢复独立脚本内嵌静态资源的二进制编码，兼容原有 Base64 数据。
 * 主要内容：识别带填充标记的 ASCII Base85，校验字符、块范围与尾部填充，并逐字节恢复构建期的 gzip 数据。
 * 模块边界：只处理字节表示，不解压、不解析或执行内容，不改变 UTF-8、pako、浏览器解压及资源加载语义。
 */

export const USERSCRIPT_DATA_PREFIX = '~85:';
// 可直接写入单引号或双引号的 JavaScript 字符串；不包含反斜杠、空白或非 ASCII 字符。
export const USERSCRIPT_DATA_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~';

const digits = new Int16Array(128).fill(-1);
for (let index = 0; index < USERSCRIPT_DATA_ALPHABET.length; index += 1) {
    digits[USERSCRIPT_DATA_ALPHABET.charCodeAt(index)] = index;
}

/** 解码构建生成的资源；既有 Base64 的合法空白与异常行为继续由浏览器 atob 决定。 */
export function decodeUserscriptData(value: string): Uint8Array {
    if (!value.startsWith(USERSCRIPT_DATA_PREFIX)) {
        return Uint8Array.from(atob(value), character => character.charCodeAt(0));
    }
    const padding = value.charCodeAt(4) - 48;
    const encodedLength = value.length - 5;
    if (!Number.isInteger(padding) || padding < 0 || padding > 3
        || encodedLength % 5 !== 0 || (encodedLength === 0 && padding !== 0)) {
        throw new Error('Invalid userscript resource encoding');
    }
    const bytes = new Uint8Array(encodedLength / 5 * 4 - padding);
    let offset = 0;
    for (let index = 5; index < value.length; index += 5) {
        let block = 0;
        for (let digitIndex = index; digitIndex < index + 5; digitIndex += 1) {
            const digit = digits[value.charCodeAt(digitIndex)];
            if (digit === undefined || digit < 0) throw new Error('Invalid userscript resource character');
            block = block * 85 + digit;
        }
        if (block > 0xffffffff) throw new Error('Invalid userscript resource block');
        for (let shift = 24; shift >= 0; shift -= 8) {
            const byte = (block >>> shift) & 0xff;
            if (offset < bytes.length) bytes[offset] = byte;
            else if (byte !== 0) throw new Error('Invalid userscript resource padding');
            offset += 1;
        }
    }
    return bytes;
}
