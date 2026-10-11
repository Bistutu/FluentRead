/**
 * 同一 userscript 沙箱内的成对端口；消息在发送时克隆，按 FIFO 微任务交付。
 * 已入队的结果必须先于断连通知送达，兼容共享 streamPort 的 post(result)/disconnect。
 * 不使用页面事件、网络端口或持久化；sender 由组合根提供，客户端不能从 payload 改写。
 */
import type {ReadingSender} from '@/src/features/reading-assistant/background';

type MessageListener = (message: unknown) => void;
type DisconnectListener = () => void;

export interface UserscriptRuntimePort {
    readonly name: string;
    readonly sender?: ReadingSender;
    postMessage(message: unknown): void;
    disconnect(): void;
    onMessage: {addListener(listener: MessageListener): void; removeListener(listener: MessageListener): void; hasListener(listener: MessageListener): boolean};
    onDisconnect: {addListener(listener: DisconnectListener): void; removeListener(listener: DisconnectListener): void; hasListener(listener: DisconnectListener): boolean};
}

export function createUserscriptPortPair(name: string, sender: ReadingSender): readonly [UserscriptRuntimePort, UserscriptRuntimePort] {
    const messages = [new Set<MessageListener>(), new Set<MessageListener>()];
    const disconnects = [new Set<DisconnectListener>(), new Set<DisconnectListener>()];
    let closed = false;
    const emit = <T extends (...args: any[]) => void>(listeners: Set<T>, ...args: Parameters<T>) => {
        let failed = false;
        let firstError: unknown;
        for (const listener of [...listeners]) {
            try {listener(...args);} catch (error) {
                if (!failed) {failed = true; firstError = error;}
            }
        }
        // 监听器异常不能冒充正常完成，也不能阻止其它 owner 释放资源。
        if (failed) throw firstError;
    };
    const disconnect = () => {
        if (closed) return;
        closed = true;
        // 不以 closed 丢弃已入队消息：共享服务端在 terminal packet 后立即 disconnect。
        queueMicrotask(() => {
            let failed = false;
            let firstError: unknown;
            for (const listeners of disconnects) {
                try {emit(listeners);} catch (error) {
                    if (!failed) {failed = true; firstError = error;}
                }
            }
            messages.forEach(listeners => listeners.clear());
            disconnects.forEach(listeners => listeners.clear());
            if (failed) throw firstError;
        });
    };
    const owner = structuredClone(sender);
    if (owner.tab) Object.freeze(owner.tab);
    Object.freeze(owner);
    const ports = [0, 1].map(index => ({
        name,
        ...(index === 1 ? {sender: owner} : {}),
        postMessage(message: unknown) {
            if (closed) throw new Error('阅读连接已断开');
            const copy = structuredClone(message);
            queueMicrotask(() => emit(messages[1 - index], copy));
        },
        disconnect,
        onMessage: {
            addListener(listener: MessageListener) {messages[index].add(listener);},
            removeListener(listener: MessageListener) {messages[index].delete(listener);},
            hasListener(listener: MessageListener) {return messages[index].has(listener);},
        },
        onDisconnect: {
            addListener(listener: DisconnectListener) {disconnects[index].add(listener);},
            removeListener(listener: DisconnectListener) {disconnects[index].delete(listener);},
            hasListener(listener: DisconnectListener) {return disconnects[index].has(listener);},
        },
    } satisfies UserscriptRuntimePort));
    return [ports[0], ports[1]];
}
