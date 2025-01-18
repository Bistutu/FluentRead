<template>
  <!-- 开关 -->
  <el-row class="margin-bottom margin-left-2em">
    <el-col :span="20" class="lightblue rounded-corner">
      <span class="popup-text popup-vertical-left">插件状态</span>
    </el-col>

    <el-col :span="4">
      <el-switch v-model="config.on" inline-prompt active-text="开" inactive-text="关" />
    </el-col>
  </el-row>

  <!-- 占位符 -->
  <div v-if="!config.on">
    <el-empty description="插件处于禁用状态" />
  </div>

  <div v-show="config.on">
    <!--    翻译模式-->
    <el-row class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="流畅阅读目前支持【仅译文】和【双语对照】两种翻译模式" placement="top-start">
          <span class="popup-text popup-vertical-left">翻译模式<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.display" placeholder="请选择翻译模式">
          <el-option class="select-left" v-for="item in options.display" :key="item.value" :label="item.label"
            :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <!--    如果选择了"双语翻译样式，则应显示译文显示样式"-->
    <el-row v-show="config.display === 1" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">译文样式</span>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.style" placeholder="请选择译文显示样式">
          <el-option class="select-left" v-for="item in options.styles" :key="item.value" :label="item.label"
            :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <!-- 翻译服务 -->
    <el-row class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">翻译服务</span>
      </el-col>
      <el-col :span="12">
        <b>
          <el-select v-model="config.service" placeholder="请选择翻译服务">
            <el-option class="select-left" v-for="item in compute.filteredServices" :key="item.value"
              :label="item.label" :value="item.value" :disabled="item.disabled" 
              :class="{ 'select-divider': item.disabled }" />
          </el-select>
        </b>
      </el-col>
    </el-row>

    <el-row class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">

        <el-tooltip class="box-item" effect="dark" content="流畅阅读会自动识别源语言，目标语言需设置" placement="top-start">
        </el-tooltip>
        <span class="popup-text popup-vertical-left">目标语言<el-icon class="icon-margin">
            <ChatDotRound />
          </el-icon></span>


      </el-col>
      <el-col :span="12">
        <el-select v-model="config.to" placeholder="请选择目标语言">
          <el-option class="select-left" v-for="item in options.to" :key="item.value" :label="item.label"
            :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <el-row class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">快捷键</span>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.hotkey" placeholder="翻译快捷键">
          <el-option class="select-left" v-for="item in options.keys" :key="item.value" :label="item.label"
            :value="item.value" :disabled="item.disabled" 
            :class="{ 'select-divider': item.disabled }" />
        </el-select>
      </el-col>
    </el-row>

    <!-- token -->
    <el-row v-show="compute.showToken" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark"
          content="你的令牌将存储在本地，流畅阅读不会获取你的任何token信息。对应服务的token获取方式请自行搜索，如：Kimi api" placement="top-start">
          <span class="popup-text popup-vertical-left">token令牌<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
        </el-tooltip>

      </el-col>
      <el-col :span="12">
        <el-input v-model="config.token[config.service]" type="password" show-password placeholder="请输入令牌" />
      </el-col>
    </el-row>

    <!-- 使用AkSk -->
    <el-row v-show="compute.showAkSk" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">API Key</span>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.ak" placeholder="请输入Access Key" />
      </el-col>
    </el-row>
    <el-row v-show="compute.showAkSk" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">Secret Key</span>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.sk" type="password" placeholder="请输入Secret Key" />
      </el-col>
    </el-row>

    <!--  Coze需显示 robot_id -->
    <el-row v-show="compute.showRobotId" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark"
          content="如何获取 Bot ID？国内版，请访问：coze.cn/docs/developer_guides/coze_api_overview" placement="top-start">
          <span class="popup-text popup-vertical-left">Bot ID<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.robot_id[config.service]" placeholder="请输入机器人ID" />
      </el-col>
    </el-row>

    <!-- 本地大模型配置 -->
    <el-row v-show="compute.showCustom" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="目前仅支持OpenAI格式的请求接口，如http://localhost:3000/v1/chat/completions，其中 localhost:11434 可更换为任意值。
                     如果使用的是 ollama，则需要使用 OLLAMA_ORIGINS=chrome-extension://* ollama serve 启动 ollama 以允许跨域访问。"
          placement="top-start">
          <span class="popup-text popup-vertical-left">自定义接口<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.custom" placeholder="请输入自定义接口地址" />
      </el-col>
    </el-row>

    <!--  模型 -->
    <el-row v-show="compute.showModel" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">模型</span>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.model[config.service]" placeholder="请选择模型">
          <el-option class="select-left" v-for="item in compute.model" :key="item" :label="item" :value="item" />
        </el-select>
      </el-col>
    </el-row>

    <el-row v-show="compute.showCustomModel" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" 
          :content="config.service === 'doubao' ? '豆包的model为接入点，获取方式见官方文档：https://console.volcengine.com/ark/region:ark+cn-beijing/endpoint' : '注意：自定义模型名称需要与服务商提供的模型名称一致，否则无法使用！'" 
          placement="top-start">
          <span class="popup-text popup-vertical-left">{{config.service === 'doubao' ? '接入点' : '自定义模型'}}<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.customModel[config.service]" placeholder="例如：gemma:7b" />
      </el-col>
    </el-row>

    <!-- 高级选项-->
    <el-collapse>
      <el-collapse-item title="高级选项" style="margin-left: 2em;" :disabled="compute.showMachine">
        <!-- 使用代理转发 -->
        <el-row v-show="compute.showProxy" class="margin-bottom">
          <el-col :span="8" class="lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark" content="使用代理可以解决网络无法访问的问题，如不熟悉代理设置请留空！" placement="top-start">
              <span class="popup-text popup-vertical-left">代理地址<el-icon class="icon-margin">
                  <ChatDotRound />
                </el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="16">

            <el-input v-model="config.proxy[config.service]" placeholder="默认不使用代理" />
          </el-col>
        </el-row>
        <!-- 角色和模板 -->
        <el-row v-show="compute.showAI" class="margin-bottom">
          <el-col :span="8" class="lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark" content="以系统身份 system 发送的对话，常用于指定 AI 要扮演的角色"
              placement="top-start">
              <span class="popup-text popup-vertical-left">system<el-icon class="icon-margin">
                  <ChatDotRound />
                </el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="16">
            <el-input type="textarea" v-model="config.system_role[config.service]" maxlength="8192"
              placeholder="system message " />
          </el-col>
        </el-row>
        <el-row v-show="compute.showAI" class="margin-bottom">
          <el-col :span="8" class="lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark"
              content="以用户身份 user 发送的对话，其中&#123;&#123;to&#125;&#125;表示目标语言，&#123;&#123;origin&#125;&#125;表示待翻译的文本内容，两者不可缺少。"
              placement="top-start">
              <span class="popup-text popup-vertical-left">user<el-icon class="icon-margin">
                  <ChatDotRound />
                </el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="16">
            <el-input type="textarea" v-model="config.user_role[config.service]" maxlength="8192"
              placeholder="user message template" />
          </el-col>
        </el-row>
      </el-collapse-item>
    </el-collapse>

    <!-- 主题设置 -->
    <el-row class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="设置界面主题，可跟随系统自动切换" placement="top-start">
          <span class="popup-text popup-vertical-left">主题设置<el-icon class="icon-margin">
              <Setting />
            </el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.theme" placeholder="请选择主题模式">
          <el-option class="select-left" v-for="item in options.theme" :key="item.value" :label="item.label"
            :value="item.value" />
        </el-select>
      </el-col>
    </el-row>
  </div>

</template>

<script lang="ts" setup>
// Main 处理配置信息
import { computed, ref, watch, onUnmounted } from 'vue'
import { models, options, servicesType } from "../entrypoints/utils/option";
import { Config } from "@/entrypoints/utils/model";
import { storage } from '@wxt-dev/storage';
import { Setting } from '@element-plus/icons-vue'

// 初始化深色模式媒体查询
const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

// 更新主题函数
function updateTheme(theme: string) {
  if (theme === 'auto') {
    // 自动模式下，直接使用系统主题
    const isDark = darkModeMediaQuery.matches;
    console.log('isDark', isDark);
    
    document.documentElement.classList.toggle('dark', isDark);
  } else {
    // 手动模式下，使用选择的主题
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }
}

// 配置信息
let config = ref(new Config());

// 从 storage 中获取本地配置
storage.getItem('local:config').then((value: any) => {
  if (typeof value === 'string' && value) {
    const parsedConfig = JSON.parse(value);
    Object.assign(config.value, parsedConfig);
  }
  // 初始应用主题
  updateTheme(config.value.theme || 'auto');
});

// 监听 storage 中 'local:config' 的变化
// 当其他页面修改了配置时,会触发这个监听器
// newValue 是新的配置值,oldValue 是旧的配置值
storage.watch('local:config', (newValue: any, oldValue: any) => {
  // 检查 newValue 是否为非空字符串
  if (typeof newValue === 'string' && newValue) {
    // 将新的配置值解析为对象,并合并到当前的 config.value 中
    // 这样可以保持所有页面的配置同步
    Object.assign(config.value, JSON.parse(newValue));
  }
});

// 监听菜单栏配置变化
// 当配置发生改变时,将新的配置序列化为 JSON 字符串并保存到 storage 中
// deep: true 表示深度监听对象内部属性的变化
watch(config, (newValue: any, oldValue: any) => {
  // console.log('配置变化，修改存储', newValue, oldValue)
  storage.setItem('local:config', JSON.stringify(newValue));
}, { deep: true });

// 计算属性
let compute = ref({
  // 1、是否是AI服务
  showAI: computed(() => servicesType.isAI(config.value.service)),
  // 2、是否是机器翻译
  showMachine: computed(() => servicesType.isMachine(config.value.service)),
  // 3、是否显示代理
  showProxy: computed(() => servicesType.isUseProxy(config.value.service)),
  // 4、是否显示模型
  showModel: computed(() => servicesType.isUseModel(config.value.service)),
  // 5、是否显示token
  showToken: computed(() => servicesType.isUseToken(config.value.service)),
  // 6、是否显示 AkSk
  showAkSk: computed(() => servicesType.isUseAkSk(config.value.service)),
  // 7、获取模型列表
  model: computed(() => models.get(config.value.service) || []),
  // 8、是否需要自定义接口
  showCustom: computed(() => servicesType.isCustom(config.value.service)),
  // 9、是否自定义模型
  showCustomModel: computed(() => servicesType.isAI(config.value.service) && config.value.model[config.value.service] === "自定义模型"),
  // 10、判断是否为"双语模式"，控制一些翻译服务的显示
  filteredServices: computed(() => options.services.filter((service: any) =>
    !([service.google].includes(service.value) && config.value.display !== 1))
  ),
  // 11、判断是否为 coze
  showRobotId: computed(() => servicesType.isCoze(config.value.service)),
})

// 监听主题变化
watch(() => config.value.theme, (newTheme) => {
  updateTheme(newTheme || 'auto');
});

// 使用 onchange 监听系统主题变化
darkModeMediaQuery.onchange = (e) => {
  if (config.value.theme === 'auto') {
    updateTheme('auto');
  }
};

// 组件卸载时清理
onUnmounted(() => {
  darkModeMediaQuery.onchange = null;
});

</script>

<style scoped>
.select-left {
  text-align: left;
}

.select-divider {
  background: #f2f6fc;
  color: #409eff;
  font-size: 12px;
  padding: 4px 12px;
  cursor: default;
  font-weight: 500;
  letter-spacing: 1px;
  text-transform: uppercase;
  border-bottom: 1px solid #e4e7ed;
  margin: 4px 0;
  pointer-events: none;
  opacity: 0.9;
}

.icon-margin {
  margin-left: 0.25em;
}
</style>