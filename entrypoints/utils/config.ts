// 获得配置并监控变化
import { Config } from "@/entrypoints/utils/model";

export let config: Config = new Config();

(async () => {
    try {
        const value = await storage.getItem('local:config');
        if (typeof value === 'string' && value) {
            Object.assign(config, JSON.parse(value));
        }
    } catch (error) {
        console.error('Error getting config:', error);
    }
})();

storage.watch('local:config', (newValue, oldValue) => {
    if (typeof newValue === 'string' && newValue) {
        Object.assign(config, JSON.parse(newValue));
    }
});
