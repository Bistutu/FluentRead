/**
 * @file src/platform/offscreen/requests.ts
 * 文件职责：在共享 Offscreen client 上提供按现有消息 type 关联的本地推理端口。
 * 主要内容：关联请求和响应 DTO，在发送前及回包后校验序列化数据；不创建新的队列、文档或取消状态。
 * 模块边界：文档与截止时间归 client，纯契约归 core；未知回包只存在于实际 runtime 边界。
 */
import {parseOffscreenRequest, parseOffscreenResponse, type KnownOffscreenRequest, type OffscreenRequestMap, type OffscreenRequestType, type OffscreenResponseMap} from '@/src/core/messaging/offscreen';
import type {OffscreenClient, OffscreenSendOptions} from './client';

type LocalInferenceSendOptions = Omit<OffscreenSendOptions, 'cancelMessage'> & {
    readonly cancelMessage?: KnownOffscreenRequest<'VIDEO_AI_CANCEL' | 'CANCEL_LOCAL_TRANSLATION_OFFSCREEN' | 'CANCEL_LOCAL_TTS_OFFSCREEN' | 'READING_ANNOTATION_CANCEL'>;
};
export async function sendOffscreenRequest<const K extends OffscreenRequestType>(
    client: OffscreenClient, message: {type: K} & OffscreenRequestMap[NoInfer<K>], options?: LocalInferenceSendOptions,
): Promise<OffscreenResponseMap[K]> {
    parseOffscreenRequest(message.type, message);
    if (options?.cancelMessage) parseOffscreenRequest(options.cancelMessage.type, options.cancelMessage);
    const response = await client.send<unknown, typeof message>(message, options);
    return parseOffscreenResponse<K>(message.type, response);
}
export async function sendOffscreenRequestIfPresent<const K extends OffscreenRequestType>(
    client: OffscreenClient, message: {type: K} & OffscreenRequestMap[NoInfer<K>], options?: Omit<OffscreenSendOptions, 'cancelMessage'>,
): Promise<OffscreenResponseMap[K] | undefined> {
    parseOffscreenRequest(message.type, message);
    const response = await client.sendIfPresent<unknown, typeof message>(message, options);
    return response === undefined ? undefined : parseOffscreenResponse<K>(message.type, response);
}
