/**
 * @file src/app/background/handlers/visionProbe.ts
 * 文件职责：为扩展设置页提供可取消的模型识图测试消息契约。
 * 主要内容：直接消费共享纯消息契约，限制真实设置页来源，首次等待前捕获消息字段，将配置就绪也纳入操作的取消、重复编号和总预算；就绪后验证当前配置身份并冻结快照，通过注入的探测端口执行。
 * 模块边界：不接收图片、凭据、提示词或任意地址，不实现网络与存储，只有应用组合根可选择测试配置。
 */
import type {BackgroundMessageHandler} from '@/src/services/messaging/backgroundRouter';
import {createImageOperationRegistry} from '@/src/features/image-translation/protocol';
import {createVisionProbeIdentity, type VisionProbeResult} from '@/src/core/config/visionProbe';
import type {VisionProbeConfig, VisionProbeOptions} from '@/src/services/translation/visionProbe';
import {VISION_PROBE_MESSAGE, VISION_PROBE_CANCEL_MESSAGE} from '@/src/services/translation/types';
import {freezeVisionProbeConfig} from '@/src/services/translation/visionProbe';
export interface VisionProbeContext {sender?: {url?: string};}
export interface VisionProbeMessage {type: string; service?: unknown; model?: unknown; identity?: unknown; requestId?: unknown;}
export function createVisionProbeHandlers(deps: {
    ready: Promise<void>; getConfig(): VisionProbeConfig;
    isSettingsUrl(url: string): boolean;
    resolve(source: VisionProbeConfig, service: string, model: string, options: VisionProbeOptions): Promise<VisionProbeResult>;
}): BackgroundMessageHandler<VisionProbeContext, VisionProbeMessage>[] {
    const operations = createImageOperationRegistry('vision-probe');
    function assertSender(context: VisionProbeContext) {
        if (!deps.isSettingsUrl(context.sender?.url ?? '')) throw new Error('识图检测仅可从设置页执行');
    }
    return [{type: VISION_PROBE_MESSAGE, async handle(message, context) {
        assertSender(context);
        const {service, model, identity, requestId} = message;
        if (typeof service !== 'string' || !service.trim() || typeof model !== 'string' || !model.trim()) throw new Error('识图检测服务或模型无效');
        const result = await operations.run({requestId, timeoutMs: 30_000}, async options => {
            await deps.ready;
            options.signal.throwIfAborted();
            const source = freezeVisionProbeConfig(deps.getConfig());
            if (identity !== createVisionProbeIdentity(source, service, model)) throw new Error('服务配置已更改，请重新检测');
            return deps.resolve(source, service, model, {force: true, signal: options.signal, timeoutMs: options.timeoutMs});
        });
        return {success: true, ...result};
    }}, {type: VISION_PROBE_CANCEL_MESSAGE, handle(message, context) {
        assertSender(context);
        return operations.cancel((message as typeof message & {requestId?: unknown}).requestId);
    }}];
}
