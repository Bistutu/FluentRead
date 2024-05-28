import {defineConfig} from 'wxt';
import vue from '@vitejs/plugin-vue';
import {resolve} from 'path';
import fs from 'fs';


const packageJson = JSON.parse(fs.readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));


// See https://wxt.dev/api/config.html
export default defineConfig({
    imports: {
        addons: {
            vueTemplate: true,
        },
    },
    vite: () => ({
        plugins: [vue()],
        define: {
            'process.env.VUE_APP_VERSION': JSON.stringify(packageJson.version),
        }
    }),
    manifest: {
        permissions: ['storage'],
    },

});