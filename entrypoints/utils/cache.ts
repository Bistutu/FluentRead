import { customModelString } from "./option";
import { config } from "@/entrypoints/utils/config";

const prefix = "flcache_"; // fluent read cache

// 构建缓存 key
function buildKey(message: string) {
    const { service, model, to, style, customModel } = config;
    const selectedModel = model[service] === customModelString ? customModel[service] : model[service];
    // 前缀_服务_模型_目标语言_消息
    return [prefix, style, service, selectedModel, to, message].join('_');
}

export const cache = {
    // 存入缓存并设置过期时间
    set(set: Set<any>, key: any, expire: number) {
        // 如果禁用缓存，则不执行任何操作
        if (!config.useCache) return;
        
        set.add(key);
        if (expire >= 0) {
            setTimeout(() => set.delete(key), expire);
        }
    },

    // local 系列为特化的缓存方法，用于操作翻译缓存
    localSet(key: string, value: string) {
        // 如果禁用缓存，则不执行任何操作
        if (!config.useCache) return;
        
        localStorage.setItem(buildKey(key), value);
    },

    localSetDual(key: string, value: string) {
        // 如果禁用缓存，则不执行任何操作
        if (!config.useCache) return;
        
        this.localSet(value, key);
        this.localSet(key, value);
    },

    localGet(origin: string) {
        // 如果禁用缓存，则始终返回 null
        if (!config.useCache) return null;
        
        return localStorage.getItem(buildKey(origin));
    },

    localRemove(origin: string) {
        const key = buildKey(origin);
        const result = localStorage.getItem(key);
        localStorage.removeItem(key);
        if (result) {
            localStorage.removeItem(buildKey(result));
        }
    },

    // 24h 清理一次缓存（每次页面打开即 main.js 时都应该调用）
    cleaner() {
        const lastSessionTimestamp = localStorage.getItem('flLastSessionTimestamp');
        const currentTime = Date.now();

        if (!lastSessionTimestamp || currentTime - parseInt(lastSessionTimestamp) > 24 * 3600000) {
            this.clean();
            localStorage.setItem('flLastSessionTimestamp', currentTime.toString());
        }
    },

    // 清除当前 url.host 的翻译缓存
    clean() {
        const keysToDelete = [];
        // 收集所有要删除的键
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) keysToDelete.push(key);
        }
        // 批量删除
        keysToDelete.forEach(key => localStorage.removeItem(key));
    }
};

// 用于节点序列化
export function stringifyNode(node: any): string {
    const serializer = new XMLSerializer();
    let outerHTML = serializer.serializeToString(node);
    // 移除多余的空白符
    return outerHTML.replace(/\s{2,}/g, ' ').trim();
}