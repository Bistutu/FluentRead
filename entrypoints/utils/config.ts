import { Config } from "@/entrypoints/utils/model";

// 声明 config 类型
export let config: Config = new Config();

// 异步加载配置并应用
async function loadConfig() {
    try {
        // 获取存储中的配置
        const value = await storage.getItem('local:config');
        if (isValidConfig(value)) {
            // 如果配置有效，合并到当前 config 中
            Object.assign(config, JSON.parse(value));
        }
    } catch (error) {
        console.error('Error getting config:', error);
    }
}

// 检查配置是否有效
function isValidConfig(value: any): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

// 监控配置变化并更新 config
storage.watch('local:config', (newValue: any, oldValue: any) => {
    if (isValidConfig(newValue)) {
        // 如果新的配置有效，更新 config
        Object.assign(config, JSON.parse(newValue));
    }
});

// 调用加载配置函数
loadConfig();