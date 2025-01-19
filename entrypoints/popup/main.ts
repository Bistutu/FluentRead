import {createApp} from 'vue';
import './style.css';
import App from './App.vue';
import 'element-plus/dist/index.css'
import { ChatDotRound, Setting } from '@element-plus/icons-vue'

import {
  ElRow,
  ElCol,
  ElContainer,
  ElHeader,
  ElMain,
  ElFooter,
  ElSelect,
  ElOption,
  ElOptionGroup,
  ElInput,
  ElSwitch,
  ElCollapse,
  ElCollapseItem,
  ElTooltip,
  ElEmpty,
  ElIcon,
  ElMessage,
  ElLink,
  ElText
} from 'element-plus'

const app = createApp(App);

// 按需注册组件
const components = [
  ElRow,
  ElCol,
  ElContainer,
  ElHeader,
  ElMain,
  ElFooter,
  ElSelect,
  ElOption,
  ElOptionGroup,
  ElInput,
  ElSwitch,
  ElCollapse,
  ElCollapseItem,
  ElTooltip,
  ElEmpty,
  ElIcon,
  ElLink,
  ElText
]

components.forEach(component => {
  if (component.name) {
    app.component(component.name, component)
  }
})

// 注册使用到的图标
app.component('ChatDotRound', ChatDotRound)
app.component('Setting', Setting)

app.mount('#app');
