/**
 * @file tests/helpers/virtualModelResponse.ts
 * 文件职责：为模型资源生命周期夹具提供显式标记的虚拟容量和 Response 端口。
 * 主要内容：用一个真实字节表示模型容量，仅对本工厂创建的虚拟缓冲区跳过原生 BodyInit 复制；普通文本、二进制和流继续使用原生 Response。
 * 模块边界：只用于容量、受控校验状态和缓存归属测试，不验证模型内容、原生大文件复制、虚拟响应的 clone 或 bodyUsed 语义。
 */
const virtualBuffers = new WeakSet<ArrayBuffer>();

export function virtualModelBuffer(bytes: number): ArrayBuffer {
    const buffer = new ArrayBuffer(1);
    Object.defineProperty(buffer, 'byteLength', {value: bytes});
    virtualBuffers.add(buffer);
    return buffer;
}

export function createVirtualModelResponsePort(NativeResponse: typeof Response): typeof Response {
    return class extends NativeResponse {
        constructor(body?: BodyInit | null, init?: ResponseInit) {
            const virtual = body instanceof ArrayBuffer && virtualBuffers.has(body) ? body : undefined;
            // 原生 Response 在不同 Node 版本对覆写的 byteLength 处理不同；未由本工厂标记的伪容量始终拒绝。
            if (body instanceof ArrayBuffer && !virtual && body.byteLength !== new Uint8Array(body).byteLength) {
                throw new RangeError('Unmarked virtual model buffer');
            }
            super(virtual ? null : body, init);
            if (virtual) Object.defineProperty(this, 'arrayBuffer', {value: async () => virtual});
        }
    };
}
