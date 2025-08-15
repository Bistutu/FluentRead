import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:3000',
        storageQuota: 10000000,
        pretendToBeVisual: true,
        resources: 'usable'
      }
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('test'),
  },
});