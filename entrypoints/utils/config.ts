import { Config } from "@/entrypoints/utils/model";
import { storage } from '@wxt-dev/storage';

// 声明 config 类型, new Config() 会设置好所有默认值
export let config: Config = new Config();
export const configReady = loadConfig();

// 检查从存储中解析出的对象是否是有效的Config对象
function isConfigObjectValid(obj: any): obj is Config {
    if (typeof obj !== 'object' || obj === null) {
        return false;
    }
    // 检查一些关键属性是否存在，以判断配置是否有效
    return 'on' in obj && 'service' in obj && 'from' in obj && 'to' in obj;
}

// 异步加载配置并应用
async function loadConfig() {
    try {
        const value = await storage.getItem('local:config');
        if (typeof value === 'string' && value.trim().length > 0) {
            const parsedConfig = JSON.parse(value);
            if (isConfigObjectValid(parsedConfig)) {
                // 如果配置有效，合并到当前 config 中
                Object.assign(config, parsedConfig);
                return; // 加载成功，直接返回
            }
        }
        // 如果存储中没有配置、配置为空或无效，则将当前带有默认值的 config 对象存入存储
        await storage.setItem('local:config', JSON.stringify(config));
    } catch (error) {
        console.error('Error loading or validating config:', error);
        // 出错时也尝试保存一次默认配置
        try {
            await storage.setItem('local:config', JSON.stringify(new Config()));
        } catch (saveError) {
            console.error('Failed to save default config after an error:', saveError);
        }
    }
}

// 监控配置变化并更新 config
storage.watch('local:config', (newValue: any, oldValue: any) => {
    if (typeof newValue === 'string' && newValue.trim().length > 0) {
        try {
            const parsedConfig = JSON.parse(newValue);
            if (isConfigObjectValid(parsedConfig)) {
                // 如果新的配置有效，更新 config
                Object.assign(config, parsedConfig);
            } else {
                console.warn('An invalid configuration was detected in storage.watch. Ignoring.');
            }
        } catch (error) {
            console.error('Error parsing new config in storage.watch:', error);
        }
    }
});