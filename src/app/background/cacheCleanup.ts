/**
 * @file src/app/background/cacheCleanup.ts
 * 文件职责：在扩展后台启动阶段安装翻译缓存的周期维护任务，避免长期运行或反复唤醒后积累过期记录。
 * 主要内容：定义专用 alarm 名称，启动时执行一次清理；合并仍在执行的维护，观察存储与闹钟错误，缺失闹钟时创建每日任务，失败后允许下次命名事件重试。
 * 模块边界：这里只编排 browser.alarms 与 app 层翻译 runtime，不实现缓存淘汰算法、存储细节或翻译请求；这些能力由 translation broker 和 cache 服务负责。
 */
import {cleanupTranslationCache} from '@/src/app/translation/runtime';

export const TRANSLATION_CACHE_CLEANUP_ALARM = 'fluentread-translation-cache-cleanup';

interface BrowserAlarm {
    name: string;
}

/**
 * 注册翻译缓存维护任务。
 *
 * 步骤 1：worker 每次启动都先做一次轻量清理。
 * 步骤 2：复用已有 alarm；仅在缺失时创建每日任务，兼容 MV2 与 MV3 重启。
 */
export function installTranslationCacheCleanup(): void {
    let cleaning: Promise<void> | undefined;
    const cleanup = () => {
        if (cleaning) return;
        cleaning = Promise.resolve().then(cleanupTranslationCache)
            .catch(() => {console.warn('[FluentRead] 翻译缓存清理失败，将在下次维护时重试');})
            .finally(() => {cleaning = undefined;});
    };
    cleanup();
    browser.alarms.onAlarm.addListener((alarm: BrowserAlarm) => {
        if (alarm.name === TRANSLATION_CACHE_CLEANUP_ALARM) cleanup();
    });

    void Promise.resolve().then(() => browser.alarms.get(TRANSLATION_CACHE_CLEANUP_ALARM)).then(async (alarm: BrowserAlarm | undefined) => {
        if (!alarm) {
            await browser.alarms.create(TRANSLATION_CACHE_CLEANUP_ALARM, {
                delayInMinutes: 1,
                periodInMinutes: 24 * 60,
            });
        }
    }).catch(() => {console.warn('[FluentRead] 翻译缓存定期维护任务安装失败');});
}
