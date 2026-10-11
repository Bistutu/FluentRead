import {describe, expect, it, vi} from 'vitest';

import {
  LOCAL_VIDEO_MODEL_DOWNLOAD_ERROR,
  LOCAL_VIDEO_MODEL_STATUS_ERROR,
  requestDownloadedLocalVideoModels,
  requestLocalVideoModelDownload,
} from '@/src/features/video-subtitle/content/localModelReadiness';

describe('local video model readiness port', () => {
  it('returns the normalized, de-duplicated list of cached models', async () => {
    const sendMessage = vi.fn(async (message: {type: string}) => {
      expect(message).toEqual({type: 'fluentReadGetLocalVideoModelState'});
      return {success: true, models: ['base', 'tiny', 'tiny']};
    });

    await expect(requestDownloadedLocalVideoModels(sendMessage)).resolves.toEqual(['base', 'tiny']);
  });

  it('treats a valid empty list as nothing downloaded without confusing it with a failed read', async () => {
    await expect(requestDownloadedLocalVideoModels(vi.fn(async () => ({success: true, models: []})))).resolves.toEqual([]);
  });

  it.each([
    undefined,
    null,
    {success: false, models: []},
    {success: true},
    {success: true, models: null},
    {success: true, models: 'tiny'},
    {success: true, models: ['tiny', 'not-a-model']},
    {success: true, models: ['']},
    {success: true, models: [42]},
  ])('rejects malformed or unsuccessful response %#', async (response) => {
    await expect(requestDownloadedLocalVideoModels(vi.fn(async () => response))).rejects.toThrow(LOCAL_VIDEO_MODEL_STATUS_ERROR);
  });

  it('maps a rejected message port to the actionable status error', async () => {
    await expect(requestDownloadedLocalVideoModels(
      vi.fn(async () => { throw new Error('background unavailable'); }),
    )).rejects.toThrow(LOCAL_VIDEO_MODEL_STATUS_ERROR);
  });
});

describe('local video model download port', () => {
  it('requests only the confirmed normalized model and returns the recorded list', async () => {
    const sendMessage = vi.fn(async (message: {type: string; model: string}) => {
      expect(message).toEqual({type: 'fluentReadPrepareLocalVideoModel', model: 'small'});
      return {success: true, model: 'small', models: ['base', 'small']};
    });
    await expect(requestLocalVideoModelDownload('unknown', sendMessage)).resolves.toEqual(['base', 'small']);
    await expect(requestLocalVideoModelDownload('base', vi.fn(async () => ({success: true}))))
      .resolves.toEqual(['base']);
  });

  it.each([
    '模型文件下载失败（404）',
    'Hugging Face / HF Mirror / ModelScope connection failed',
    'https://hf-mirror.com/onnx-community/whisper-tiny/resolve/main/config.json returned 503',
  ])('shows an actionable error without exposing background diagnostics: %s', async error => {
    await expect(requestLocalVideoModelDownload('tiny', vi.fn(async () => ({success: false, error}))))
      .rejects.toThrow(LOCAL_VIDEO_MODEL_DOWNLOAD_ERROR);
  });

  it('maps missing responses and rejected message ports to the actionable download error', async () => {
    await expect(requestLocalVideoModelDownload('tiny', vi.fn(async () => undefined)))
      .rejects.toThrow(LOCAL_VIDEO_MODEL_DOWNLOAD_ERROR);
    await expect(requestLocalVideoModelDownload('tiny', vi.fn(async () => { throw new Error('Extension context invalidated'); })))
      .rejects.toThrow(LOCAL_VIDEO_MODEL_DOWNLOAD_ERROR);
    await expect(requestLocalVideoModelDownload('tiny', vi.fn(async () => { throw new Error('https://huggingface.co/ unavailable'); })))
      .rejects.toThrow(LOCAL_VIDEO_MODEL_DOWNLOAD_ERROR);
    await expect(requestLocalVideoModelDownload('tiny', vi.fn(async () => { throw 'port closed'; })))
      .rejects.toThrow(LOCAL_VIDEO_MODEL_DOWNLOAD_ERROR);
  });
});
