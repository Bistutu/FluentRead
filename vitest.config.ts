import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// 独立的 Vitest 配置（与 wxt 构建配置互不影响）
export default defineConfig({
    resolve: {
        alias: {
            // 与 wxt 一致：'@' 指向项目根目录
            '@': resolve(__dirname, '.'),
        },
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
