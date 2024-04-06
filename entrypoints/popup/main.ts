import {createApp} from 'vue';
import './style.css';
import App from './App.vue';
import ElementPlus, {ElMessage} from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'


const app = createApp(App);
app.use(ElementPlus)    // 导入 element-plus ui
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {   // 注册所有 element-plus 的图标
    app.component(key, component)
}

app.mount('#app');
