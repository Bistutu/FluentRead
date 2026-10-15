/** 此事件不包含 URL 查询参数、HTTP 头或请求/响应正文。 */
export interface MeasuredTransportEvent {
    endpoint: string;
    /** 查询串和已知序列化正文的字节数；FormData/请求流无法透明计量时为 null。 */
    requestBytes: number | null;
    responseBytes: number;
    status: number | null;
    networkError: boolean;
    /** fetch 拒绝或正文流结束时，是否观察到已中止的请求/评测信号。 */
    aborted: boolean;
    /** 外层评测信号优先；仅供应商内部的请求信号中止时为 request。 */
    abortSource: 'request' | 'evaluation' | null;
    /** 消费者主动取消响应流，独立于网络失败或 AbortSignal。 */
    consumerCancelled: boolean;
    /** 只有正常读取至 EOF 或响应没有正文时为 true。 */
    bodyComplete: boolean;
    retryAt?: number;
}

export function createMeasuredFetch(fetchImpl: typeof fetch, events: MeasuredTransportEvent[], signal?: AbortSignal): typeof fetch;
