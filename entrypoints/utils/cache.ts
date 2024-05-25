// localStorage
import {Config} from "./model";
import {customModelString} from "./option";

const prefix = "flcache_"    // fluent read cache

// 构建缓存 key
function buildKey(config: Config, message: string) {
    let service = config.service
    let model = config.model[service] === customModelString ? config.customModel[service] : config.model[service]
    // 前缀_服务_模型_目标语言_消息
    return [prefix, config.style, service, model, config.to, message].join('_')
}

export const cache = {
    set(set: Set<any>, key: any, expire: number) {
        set.add(key);
        if (expire >= 0) setTimeout(() => set.delete(key), expire);
    },
    // local 系列为特化的缓存方法，用于操作翻译缓存
    localSet(config: Config, key: string, value: string) {
        localStorage.setItem(buildKey(config, key), value)
    },
    localSetDual(config: Config, key: string, value: string) {
        this.localSet(config, value, key)
        this.localSet(config, key, value)
    },
    localGet(config: Config, origin: string) {
        return localStorage.getItem(buildKey(config, origin))
    },
    localRemove(config: Config, origin: string) {
        let result: any = localStorage.getItem(buildKey(config, origin))
        localStorage.removeItem(buildKey(config, origin))
        localStorage.removeItem(buildKey(config, result))
    },
    // 24h 清理一次缓存（每次页面打开即 main.js 时都应该调用）
    cleaner() {
        const lastSessionTimestamp = localStorage.getItem('flLastSessionTimestamp');
        let currentTime = new Date().getTime()

        if (!lastSessionTimestamp) {
            localStorage.setItem('flLastSessionTimestamp', currentTime.toString());
        } else if (currentTime - parseInt(lastSessionTimestamp) > 24 * 3600000) {
            // }else if (currentTime - parseInt(lastSessionTimestamp) > 20000) {
            this.clean()
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
}

export function stringifyNode(node: any): string {
    const serializer = new XMLSerializer();
    let outerHTML = serializer.serializeToString(node);
    // 移除多余的空白符
    outerHTML = outerHTML.replace(/\s{2,}/g, ' ').trim();
    return outerHTML;
}

