import {defineConfig} from 'wxt';
import vue from '@vitejs/plugin-vue';
import {resolve} from 'path';
import fs from 'fs';


const packageJson = JSON.parse(fs.readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

interface FirefoxGeckoSettings {
    id?: string;
    strict_min_version?: string;
    strict_max_version?: string;
    update_url?: string;
    data_collection_permissions?: {
        required?: string[];
        optional?: string[];
    };
}


// See https://wxt.dev/api/config.html
export default defineConfig({
    modules: ['@wxt-dev/webextension-polyfill'],
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
        permissions: ['storage', 'contextMenus', 'offscreen'],
        browser_specific_settings: {
            gecko: {
                data_collection_permissions: {
                    required: ['websiteContent'],
                    optional: ['technicalAndInteraction'],
                },
            } as FirefoxGeckoSettings,
        },
    },

});