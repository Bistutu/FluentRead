/**
 * @file src/features/video-subtitle/content/backgroundClient.ts
 * 文件职责：为字幕播放器提供既有后台消息的类型化调用边界。
 * 主要内容：关联视频转写、预热、取消及模型管理的请求与回复，在实际 runtime 回包上校验共享 DTO，拒绝损坏响应。
 * 模块边界：只调用注入的发送函数，不维护 generation、缓存、浏览器监听器或重试状态。
 */
import {parseMessage} from '@/src/core/messaging/validation';
import {isVideoBackgroundInput, parseVideoBackgroundResponse, type VideoBackgroundRequestMap, type VideoBackgroundRequestType, type VideoBackgroundResponseMap} from '@/src/core/messaging/video';
export async function sendVideoSubtitleRequest<const K extends VideoBackgroundRequestType>(
    send: (message: {type: K} & VideoBackgroundRequestMap[K]) => Promise<unknown>, message: {type: K} & VideoBackgroundRequestMap[NoInfer<K>],
): Promise<VideoBackgroundResponseMap[K]> {
    parseMessage(message, isVideoBackgroundInput, '本地视频 AI');
    return parseVideoBackgroundResponse<K>(message.type, await send(message));
}
