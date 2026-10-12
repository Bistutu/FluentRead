declare module 'pako' {
    export function ungzip(data: Uint8Array, options?: {to?: string}): string | Uint8Array;
}

/** 独立脚本仅导入锁定 pako 的官方解压入口，保留 ungzip 公开签名。 */
declare module 'pako/lib/inflate.js' {
    export function ungzip(data: Uint8Array): Uint8Array;
    export function ungzip(data: Uint8Array, options?: {to?: string}): string | Uint8Array;
}

/** 同一官方解压入口使用的 UTF-8 helper，保留其原生检测与 JavaScript 回退。 */
declare module 'pako/lib/utils/strings.js' {
    export function buf2string(data: Uint8Array): string;
}
