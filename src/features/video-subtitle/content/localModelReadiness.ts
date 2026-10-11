/**
 * @file src/features/video-subtitle/content/localModelReadiness.ts
 * 文件职责：读取本地视频模型缓存状态，并请求后台下载用户确认的模型。
 * 主要内容：规范化模型标识与已下载列表、校验后台响应结构，区分“未下载”与“状态读取失败”，下载失败统一提示检查网络并重试，不把来源或连接诊断展示到播放器菜单。
 * 模块边界：只调用注入的消息端口，不读取 DOM、storage 或播放器状态。
 */
import {
  normalizeVideoLocalTranscriptionModel,
  normalizeVideoLocalTranscriptionModels,
  VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE,
  type VideoLocalTranscriptionModel,
} from '@/src/features/video-subtitle/transcription';

export type LocalVideoModelStatusSender = (message: {
  type: typeof VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE;
}) => Promise<unknown>;
export type LocalVideoModelDownloadSender = (message: {
  type: 'fluentReadPrepareLocalVideoModel';
  model: VideoLocalTranscriptionModel;
}) => Promise<unknown>;

export const LOCAL_VIDEO_MODEL_STATUS_ERROR = '无法读取模型状态，请重试';
export const LOCAL_VIDEO_MODEL_DOWNLOAD_ERROR = '模型下载失败，请检查网络后重试';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidModelList(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  return value.every((model) => typeof model === 'string'
    && normalizeVideoLocalTranscriptionModels([model]).length === 1);
}

function isStatusResponse(value: unknown): value is {success: true; models: unknown[]} {
  return isRecord(value) && value.success === true && isValidModelList(value.models);
}

/**
 * 请求后台返回的已缓存模型列表。后台不可用、返回失败或数据损坏都必须
 * 明确报错，避免把暂时无法读取误导成“模型尚未下载”。
 */
export async function requestDownloadedLocalVideoModels(
  sendMessage: LocalVideoModelStatusSender,
): Promise<VideoLocalTranscriptionModel[]> {
  let response: unknown;
  try {
    response = await sendMessage({type: VIDEO_LOCAL_TRANSCRIPTION_STATE_MESSAGE});
  } catch {
    throw new Error(LOCAL_VIDEO_MODEL_STATUS_ERROR);
  }

  if (!isStatusResponse(response)) throw new Error(LOCAL_VIDEO_MODEL_STATUS_ERROR);
  return normalizeVideoLocalTranscriptionModels(response.models);
}

/** 只下载并登记模型文件，不创建识别会话；成功时返回后台记录的已下载列表。 */
export async function requestLocalVideoModelDownload(
  model: unknown,
  sendMessage: LocalVideoModelDownloadSender,
): Promise<VideoLocalTranscriptionModel[]> {
  const normalizedModel = normalizeVideoLocalTranscriptionModel(model);
  let response: unknown;
  try {
    response = await sendMessage({type: 'fluentReadPrepareLocalVideoModel', model: normalizedModel});
  } catch {
    throw new Error(LOCAL_VIDEO_MODEL_DOWNLOAD_ERROR);
  }
  if (!isRecord(response) || response.success !== true) {
    throw new Error(LOCAL_VIDEO_MODEL_DOWNLOAD_ERROR);
  }
  const models = isValidModelList(response.models) ? normalizeVideoLocalTranscriptionModels(response.models) : [];
  return models.includes(normalizedModel) ? models : [...models, normalizedModel];
}
