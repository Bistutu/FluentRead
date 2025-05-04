<template>
  <!-- 开关 -->
  <el-row class="margin-bottom margin-left-2em">
    <el-col :span="20" class="lightblue rounded-corner">
      <span class="popup-text popup-vertical-left">插件状态</span>
    </el-col>

    <el-col :span="4" class="flex-end">
      <el-switch v-model="config.on" inline-prompt active-text="开" inactive-text="关" />
    </el-col>
  </el-row>

  <!-- 占位符 -->
  <div v-if="!config.on">
    <el-empty description="插件处于禁用状态" />
  </div>

  <div v-show="config.on">
    <!-- 即时翻译 -->
<!--    <el-row class="margin-bottom margin-left-2em">-->
<!--      <el-col :span="12" class="lightblue rounded-corner">-->
<!--        <el-tooltip class="box-item" effect="dark" content="开启后访问英文页面时会自动翻译" placement="top-start" :show-after="500">-->
<!--          <span class="popup-text popup-vertical-left">即时翻译<el-icon class="icon-margin">-->
<!--              <ChatDotRound />-->
<!--            </el-icon></span>-->
<!--        </el-tooltip>-->
<!--      </el-col>-->
<!--      <el-col :span="12" class="flex-end">-->
<!--        <el-switch v-model="config.autoTranslate" inline-prompt active-text="开" inactive-text="关"-->
<!--          @change="handleSwitchChange" />-->
<!--      </el-col>-->
<!--    </el-row>-->

  <!-- 缓存开关 -->
  <el-row class="margin-bottom margin-left-2em">
    <el-col :span="20" class="lightblue rounded-corner">
      <el-tooltip class="box-item" effect="dark" content="开启缓存可以提高翻译速度，减少重复请求，但可能导致翻译结果不是最新的" placement="top-start" :show-after="500">
        <span class="popup-text popup-vertical-left">缓存翻译结果<el-icon class="icon-margin">
            <ChatDotRound />
          </el-icon></span>
      </el-tooltip>
    </el-col>

    <el-col :span="4" class="flex-end">
      <el-switch v-model="config.useCache" inline-prompt active-text="开" inactive-text="关"/>
    </el-col>
  </el-row>

    <!-- 添加悬浮球开关 -->
    <el-row v-if="config.on" class="margin-bottom margin-left-2em margin-top-1em">
      <el-col :span="20" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="（测试版）控制是否显示屏幕边缘的即时翻译悬浮球，用于对整个网页进行翻译" placement="top-start" :show-after="500">
        <span class="popup-text popup-vertical-left">
          <span class="new-feature-badge">新</span>
          全文翻译悬浮球
          <el-icon class="icon-margin">
            <ChatDotRound />
          </el-icon>
        </span>
        </el-tooltip>
      </el-col>

      <el-col :span="4" class="flex-end">
        <el-switch v-model="floatingBallEnabled" inline-prompt active-text="开" inactive-text="关" />
      </el-col>
    </el-row>

    <!-- 悬浮球快捷键选择 -->
    <el-row v-if="config.on && floatingBallEnabled" class="margin-bottom margin-left-2em margin-top-1em">
      <el-col :span="14" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="（测试版）设置快捷键以便快速切换全文翻译状态，无需鼠标点击悬浮球" placement="top-start" :show-after="500">
        <span class="popup-text popup-vertical-left">
          <span class="new-feature-badge">新</span>
          全文翻译快捷键
          <el-icon class="icon-margin">
            <ChatDotRound />
          </el-icon>
        </span>
        </el-tooltip>
      </el-col>
      <el-col :span="10" class="flex-end">
        <el-select v-model="config.floatingBallHotkey" placeholder="选择快捷键" size="small" style="width: 100%">
          <el-option v-for="item in options.floatingBallHotkeys" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <!--    翻译模式-->
    <el-row class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">翻译模式</span>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.display" placeholder="请选择翻译模式">
          <el-option class="select-left" v-for="item in options.display" :key="item.value" :label="item.label"
            :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <!--    译文样式选择器-->
    <el-row v-show="config.display === 1" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="选择双语模式下译文的显示样式，提供多种美观的效果" placement="top-start"
          :show-after="500">
          <span class="popup-text popup-vertical-left">译文样式<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.style" placeholder="请选择译文显示样式">
          <el-option-group v-for="group in styleGroups" :key="group.value" :label="group.label">
            <el-option v-for="item in group.options" :key="item.value" :label="item.label" :value="item.value"
              :class="item.class" />
          </el-option-group>
        </el-select>
      </el-col>
    </el-row>

    <!-- 翻译服务 -->
    <el-row class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="机器翻译：快速稳定，适合日常使用；AI翻译：更自然流畅，需要配置令牌" placement="top-start"
          :show-after="500">
          <span class="popup-text popup-vertical-left">翻译服务<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
        </el-tooltip>
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

    <!-- 目标语言 -->
    <el-row class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">目标语言</span>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.to" placeholder="请选择目标语言">
          <el-option class="select-left" v-for="item in options.to" :key="item.value" :label="item.label"
            :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <!-- 快捷键 -->
    <el-row class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">快捷键</span>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.hotkey" placeholder="请选择快捷键">
          <el-option class="select-left" v-for="item in options.keys" :key="item.value" :label="item.label"
            :value="item.value" :disabled="item.disabled" :class="{ 'select-divider': item.disabled }" />
        </el-select>
      </el-col>
    </el-row>

    <!-- token -->
    <el-row v-show="compute.showToken" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark"
          content="API访问令牌仅保存在本地，用于访问翻译服务。获取方式请参考对应服务的官方文档；翻译服务为 ollama 时，token 可为任意值" placement="top-start"
          :show-after="500">
          <span class="popup-text popup-vertical-left">访问令牌<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.token[config.service]" type="password" show-password placeholder="请输入API访问令牌" />
      </el-col>
    </el-row>

    <!-- 使用AkSk -->
    <el-row v-show="compute.showAkSk" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="百度文心一言API密钥对，用于访问翻译服务" placement="top-start"
          :show-after="500">
          <span class="popup-text popup-vertical-left">API Key<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.ak" placeholder="请输入Access Key" />
      </el-col>
    </el-row>
    <el-row v-show="compute.showAkSk" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="百度文心一言API密钥对，用于访问翻译服务" placement="top-start"
          :show-after="500">
          <span class="popup-text popup-vertical-left">Secret Key<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.sk" type="password" placeholder="请输入Secret Key" />
      </el-col>
    </el-row>

    <!--  Coze需显示 robot_id -->
    <el-row v-show="compute.showRobotId" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="Coze机器人ID，可在Coze开发者文档中查看获取方式" placement="top-start"
          :show-after="500">
          <span class="popup-text popup-vertical-left">机器人ID<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.robot_id[config.service]" placeholder="请输入Coze机器人ID" />
      </el-col>
    </el-row>

    <!-- 本地大模型配置 -->
    <el-row v-show="compute.showCustom" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="目前仅支持OpenAI格式的请求接口，如http://localhost:3000/v1/chat/completions，其中 localhost:11434 可更换为任意值。
                     ollama 配置请参考：https://fluent.thinkstu.com/guide/faq.html" placement="top-start" :show-after="500">
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
          placement="top-start" :show-after="500">
          <span class="popup-text popup-vertical-left">{{ config.service === 'doubao' ? '接入点' : '自定义模型' }}<el-icon
              class="icon-margin">
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
            <el-tooltip class="box-item" effect="dark" content="使用代理可以解决网络无法访问的问题，如不熟悉代理设置请留空！" placement="top-start"
              :show-after="500">
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
              placement="top-start" :show-after="500">
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
              placement="top-start" :show-after="500">
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
        <!-- 恢复默认模板按钮 -->
        <el-row v-show="compute.showAI" class="margin-bottom">
          <el-col :span="24" style="text-align: right;">
            <el-button type="primary" link @click="resetTemplate">
              <el-icon>
                <Refresh />
              </el-icon>
              恢复默认模板
            </el-button>
          </el-col>
        </el-row>
      </el-collapse-item>
    </el-collapse>

    <!-- 主题设置 -->
    <el-row class="margin-bottom margin-left-2em margin-top-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">主题设置</span>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.theme" placeholder="请选择主题模式">
          <el-option class="select-left" v-for="item in options.theme" :key="item.value" :label="item.label"
            :value="item.value" />
        </el-select>
      </el-col>
    </el-row>
  </div>

  <el-row v-if="showRefreshTip" class="refresh-tip margin-bottom">
    <el-col :span="19" class="lightblue rounded-corner">
      <span class="popup-text popup-vertical-left">设置已更新 需刷新页面生效</span>
    </el-col>
    <el-col :span="5">
      <el-button class="refresh-button" type="primary" @click="refreshPage">
        刷新
      </el-button>
    </el-col>
  </el-row>

</template>

<script lang="ts" setup>

// Main 处理配置信息
import { computed, ref, watch, onUnmounted } from 'vue'
import { models, options, servicesType, defaultOption } from "../entrypoints/utils/option";
import { Config } from "@/entrypoints/utils/model";
import { storage } from '@wxt-dev/storage';
import { ChatDotRound, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import browser from 'webextension-polyfill';

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
  // TODO 监听配置变化，显示刷新提示
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

// 计算样式分组
const styleGroups = computed(() => {
  const groups = options.styles.filter(item => item.disabled);
  return groups.map(group => ({
    ...group,
    options: options.styles.filter(item => !item.disabled && item.group === group.value)
  }));
});

// 恢复默认模板
const resetTemplate = () => {
  ElMessageBox.confirm(
    '确定要恢复默认的 system 和 user 模板吗？此操作将覆盖当前的自定义模板。',
    '恢复默认模板',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    }
  ).then(() => {
    config.value.system_role[config.value.service] = defaultOption.system_role;
    config.value.user_role[config.value.service] = defaultOption.user_role;
    ElMessage({
      message: '已成功恢复默认翻译模板',
      type: 'success',
      duration: 2000
    });
  }).catch(() => {
    // 用户取消操作，不做任何处理
  });
};

// 悬浮球开关的计算属性
const floatingBallEnabled = computed({
  get: () => !config.value.disableFloatingBall,
  set: (value) => {
    config.value.disableFloatingBall = !value;
    // 向所有激活的标签页发送消息
    browser.tabs.query({}).then(tabs => {
      tabs.forEach(tab => {
        if (tab.id) {
          browser.tabs.sendMessage(tab.id, { 
            type: 'toggleFloatingBall',
            isEnabled: value 
          }).catch(() => {
            // 忽略发送失败的错误（可能是页面未加载内容脚本）
          });
        }
      });
    });
  }
});

// 监听开关变化
const handleSwitchChange = () => {
  showRefreshTip.value = true;
};

// 处理悬浮球开关变化
const toggleFloatingBall = (val: boolean) => {
  // 向所有激活的标签页发送消息
  browser.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      if (tab.id) {
        browser.tabs.sendMessage(tab.id, { 
          type: 'toggleFloatingBall',
          isEnabled: val 
        }).catch(() => {
          // 忽略发送失败的错误（可能是页面未加载内容脚本）
        });
      }
    });
  });
};

// 显示刷新提示
const showRefreshTip = ref(false);

// 刷新页面
const refreshPage = async () => {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]?.id) {
    browser.tabs.reload(tabs[0].id);
    showRefreshTip.value = false; // 刷新后隐藏提示
  }
};

</script>

<style scoped>

.select-left {
  text-align: left;
}

.flex-end {
  display: flex;
  justify-content: flex-end;
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

/* 添加自适应样式 */
:deep(.el-select) {
  width: 100%;
}

:deep(.el-input) {
  width: 100%;
}

.margin-bottom {
  margin-bottom: 10px;
}

.margin-left-2em {
  margin-left: 1em;
  margin-right: 1em;
}

.margin-top-2em {
  margin-top: 1em;
}

.margin-top-1em {
  margin-top: 0.5em;
}

/* 设置滚动条样式 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-thumb {
  background: #ddd;
  border-radius: 3px;
}

::-webkit-scrollbar-track {
  background: #f5f5f5;
  border-radius: 3px;
}

.refresh-tip {
  margin: 0 1em;
}

.refresh-button {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 0.5em 1em;
  color: #fff;
  background-color: #409eff;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.3s, color 0.3s;
}

.refresh-button:hover {
  background-color: #66b1ff;
  color: #fff;
}

.new-feature-badge {
  display: inline-block;
  font-size: 12px;
  background-color: #f56c6c;
  color: white;
  padding: 1px 6px;
  border-radius: 10px;
  margin-right: 8px;
  font-weight: bold;
  animation: bounce 1s infinite alternate;
}

@keyframes pulse-glow {
  0% {
    box-shadow: 0 2px 8px rgba(64, 158, 255, 0.1);
  }
  100% {
    box-shadow: 0 2px 12px rgba(64, 158, 255, 0.5);
  }
}

@keyframes bounce {
  0% {
    transform: translateY(0);
  }
  100% {
    transform: translateY(-3px);
  }
}
</style>