/**
 * @file src/features/video-subtitle/content/video-ai/requestSession.ts
 * 文件职责：把完整与实时采集器各自的本地会话映射到同一后台流的唯一识别请求代际。
 * 主要内容：为每次采集开始分配单调增长的后台 generation，冻结模型和来源语言，只交付与对应采集器本地会话匹配的请求身份，销毁后禁止创建请求但保留终止资源所需的旧身份。
 * 模块边界：不发送消息、不终止 Worker、不提前释放真实传输；runtime 用身份调用既有后台协议，采集器继续拥有音轨、音频上下文和本地结果提交资格。
 */
export type VideoAiCaptureKind = 'full' | 'live';
export interface VideoAiRequestIdentity {
    readonly streamId: string;
    readonly generation: number;
    readonly model: string;
    readonly sourceLanguage: string;
}

export class VideoAiRequestSession {
    private disposed = false;
    private generation = 0;
    private readonly requests = new Map<VideoAiCaptureKind, {localGeneration: number; identity: VideoAiRequestIdentity}>();

    constructor(private readonly streamId: string) {}

    start(kind: VideoAiCaptureKind, localGeneration: number, model: string, sourceLanguage: string): VideoAiRequestIdentity | null {
        if (this.disposed) return null;
        const identity = Object.freeze({streamId: this.streamId, generation: ++this.generation, model, sourceLanguage});
        this.requests.set(kind, {localGeneration, identity});
        return identity;
    }

    read(kind: VideoAiCaptureKind, localGeneration: number): VideoAiRequestIdentity | null {
        const request = this.requests.get(kind);
        return request?.localGeneration === localGeneration ? request.identity : null;
    }

    dispose(): void {
        this.disposed = true;
        // 采集器 destroy 的最后一次取消仍需读到旧 generation；两个有限记录随 runtime 一起释放。
    }
}
