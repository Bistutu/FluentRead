/**
 * @file src/shared/onnx/modelResidency.ts
 * 文件职责：为本地推理会话提供有界、按设备内存调整的空闲保温策略。
 * 主要内容：已知不超过 4 GB 的设备保温一分钟，其余已知设备三分钟；缺少可靠内存信息时保温两分钟，减少阅读停顿后的重复初始化。
 * 模块边界：只计算空闲时长，不加载模型、不估算实际堆或显存；调用方负责保护活跃和排队请求，并在取消、超时、模型移除及页面卸载时释放资源。
 */
export function localModelIdleMs(memory: unknown = (globalThis.navigator as {deviceMemory?: number} | undefined)?.deviceMemory): number {
    if (typeof memory !== 'number' || !Number.isFinite(memory) || memory <= 0) return 120_000;
    return memory <= 4 ? 60_000 : 180_000;
}
