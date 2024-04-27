import {createApp} from 'vue';
import './style.css';
import App from './App.vue';
import ElementPlus, {ElMessage} from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'


const app = createApp(App);

//  导入 element-plus ui，注册所有 element-plus 的图标
app.use(ElementPlus)
for (const [key, component] of Object.entries(ElementPlusIconsVue)) app.component(key, component)

app.mount('#app');
