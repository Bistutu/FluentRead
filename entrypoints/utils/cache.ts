// localStorage
import {Config} from "./model";
import {customModelString} from "./option";

const prefix = "flcache_"    // fluent read cache

// 构建缓存 key
function buildKey(config: Config, message: string) {
    let service = config.service
    let model = config.model[service] === customModelString ? config.customModel[service] : config.model[service]
    // 前缀_服务_模型_目标语言_消息
    return prefix + service + "_" + model + "_" + config.to + "_" + message
}

export const cache = {
    set(config: Config, origin: string, result: string) {
        localStorage.setItem(buildKey(config, origin), result)
        localStorage.setItem(buildKey(config, result), origin)
    },
    bilingualSet(config: Config, origin: string, result: string) {
        localStorage.setItem(buildKey(config, origin), result)
    },
    get(config: Config, origin: string) {
        return localStorage.getItem(buildKey(config, origin))
    },
    remove(config: Config, origin: string) {
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
            this.clearCurrentHostCache()
            localStorage.setItem('flLastSessionTimestamp', currentTime.toString());
        }
    },
    // 清除当前页面所有由 fluent read 缓存的数据
    clearCurrentHostCache() {
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

// 移除特定样式
export function checkAndRemoveStyle(node: any, styleProperty: any) {
    if (node.style && node.style[styleProperty] !== undefined) {
        console.log('remove style', node.style[styleProperty]);
        // 移除特定样式
        node.style[styleProperty] = '';
    }
}