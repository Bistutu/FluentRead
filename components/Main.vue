<template>
  <!-- 开关 -->
  <el-row class="margin-bottom margin-left-2em">
    <el-col :span="20" class="lightblue rounded-corner">
      <span class="popup-text popup-vertical-left">插件状态</span>
    </el-col>

    <el-col :span="4">
      <el-switch
          v-model="config.on"
          inline-prompt
          active-text="开"
          inactive-text="关"
      />
    </el-col>
  </el-row>

  <!-- 占位符 -->
  <div v-if="!config.on">
    <el-empty description="插件处于禁用状态"/>
  </div>

  <div v-show="config.on">
    <!--    翻译模式-->
    <el-row class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip
            class="box-item"
            effect="dark"
            content="流畅阅读目前支持“仅译文”和“双语对照”两种翻译模式"
            placement="top-start"
        >
          <span class="popup-text popup-vertical-left">翻译模式<el-icon class="icon-margin"><ChatDotRound/></el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.style" placeholder="请选择翻译模式">
          <el-option
              class="select-left"
              v-for="item in options.display"
              :key="item.value"
              :label="item.label"
              :value="item.value"
          />
        </el-select>
      </el-col>
    </el-row>

    <!--    如果选择了“双语翻译样式，则应显示译文显示样式”-->
    <el-row v-show="config.style === 1" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">译文样式</span>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.display" placeholder="请选择译文显示样式">
          <el-option
              class="select-left"
              v-for="item in options.styles"
              :key="item.value"
              :label="item.label"
              :value="item.value"
          />
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
          <el-option
              class="select-left"
              v-for="item in compute.filteredServices"
              :key="item.value"
              :label="item.label"
              :value="item.value"
              :disabled="item.disabled"
          />
        </el-select>
        </b>
      </el-col>
    </el-row>

    <el-row class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">

        <el-tooltip
            class="box-item"
            effect="dark"
            content="流畅阅读会自动识别源语言，目标语言需设置"
            placement="top-start"
        >
        </el-tooltip>
        <span class="popup-text popup-vertical-left">目标语言<el-icon class="icon-margin"><ChatDotRound/></el-icon></span>


      </el-col>
      <el-col :span="12">
        <el-select v-model="config.to" placeholder="请选择目标语言">
          <el-option
              class="select-left"
              v-for="item in options.to"
              :key="item.value"
              :label="item.label"
              :value="item.value"
          />
        </el-select>
      </el-col>
    </el-row>

    <el-row class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">快捷键</span>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.hotkey" placeholder="翻译快捷键">
          <el-option
              class="select-left"
              v-for="item in options.keys"
              :key="item.value"
              :label="item.label"
              :value="item.value"
              :disabled="item.disabled"
          />
        </el-select>
      </el-col>
    </el-row>

    <!-- token -->
    <el-row v-show="compute.showToken" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip
            class="box-item"
            effect="dark"
            content="你的令牌将存储在本地，流畅阅读不会获取你的任何token信息。对应服务的token获取方式请自行搜索，如：Kimi api"
            placement="top-start"
        >
          <span class="popup-text popup-vertical-left">token令牌<el-icon class="icon-margin"><ChatDotRound/></el-icon></span>
        </el-tooltip>

      </el-col>
      <el-col :span="12">
        <el-input v-model="config.token[config.service]" type="password" show-password placeholder="请输入令牌"/>
      </el-col>
    </el-row>

    <!-- 使用AkSk -->
    <el-row v-show="compute.showAkSk" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">API Key</span>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.ak" placeholder="请输入Access Key"/>
      </el-col>
    </el-row>
    <el-row v-show="compute.showAkSk" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">Secret Key</span>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.sk" type="password" placeholder="请输入Secret Key"/>
      </el-col>
    </el-row>

    <!--  使用 appid、key -->
    <el-row v-show="compute.showAppIdKey" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">APPID</span>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.appid" placeholder="请输入 appid"/>
      </el-col>
    </el-row>
    <el-row v-show="compute.showAppIdKey" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">Key</span>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.key" type="password" placeholder="请输入 Key"/>
      </el-col>
    </el-row>

    <!--  Coze需显示 robot_id -->
    <el-row v-show="compute.showRobotId" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip
            class="box-item"
            effect="dark"
            content="如何获取 Bot ID？国内版，请访问：coze.cn/docs/developer_guides/coze_api_overview"
            placement="top-start"
        >
          <span class="popup-text popup-vertical-left">Bot ID<el-icon class="icon-margin"><ChatDotRound/></el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.robot_id[config.service]" placeholder="请输入机器人ID"/>
      </el-col>
    </el-row>

    <!-- 本地大模型配置 -->
    <el-row v-show="compute.showCustom" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip
            class="box-item"
            effect="dark"
            content="目前仅支持OpenAI格式的请求接口，如http://localhost:3000/v1/chat/completions，其中 localhost:11434 可更换为任意值。
                     如果使用的是 ollama，则需要使用 OLLAMA_ORIGINS=chrome-extension://* ollama serve 启动 ollama 以允许跨域访问。"
            placement="top-start"
        >
          <span class="popup-text popup-vertical-left">自定义接口<el-icon class="icon-margin"><ChatDotRound/></el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.custom" placeholder="请输入自定义接口地址"/>
      </el-col>
    </el-row>

    <!--  模型 -->
    <el-row v-show="compute.showModel" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <span class="popup-text popup-vertical-left">模型</span>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.model[config.service]" placeholder="请选择模型">
          <el-option
              class="select-left"
              v-for="item in compute.model"
              :key="item"
              :label="item"
              :value="item"
          />
        </el-select>
      </el-col>
    </el-row>

    <el-row v-show="compute.showCustomModel" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip
            class="box-item"
            effect="dark"
            content="注意：自定义模型名称需要与服务商提供的模型名称一致，否则无法使用！"
            placement="top-start"
        >
          <span class="popup-text popup-vertical-left">自定义模型<el-icon class="icon-margin"><ChatDotRound/></el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.customModel[config.service]" placeholder="例如：gemma:7b"/>
      </el-col>
    </el-row>

    <!-- 高级选项-->
    <el-collapse>
      <el-collapse-item title="高级选项" style="margin-left: 2em;" :disabled="compute.showMachine">
        <!-- 使用代理转发 -->
        <el-row v-show="compute.showProxy" class="margin-bottom">
          <el-col :span="8" class="lightblue rounded-corner">
            <el-tooltip
                class="box-item"
                effect="dark"
                content="使用代理可以解决网络无法访问的问题，如不熟悉代理设置请留空！"
                placement="top-start"
            >
              <span class="popup-text popup-vertical-left">代理地址<el-icon class="icon-margin"><ChatDotRound/></el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="16">

            <el-input v-model="config.proxy[config.service]" placeholder="默认不使用代理"/>
          </el-col>
        </el-row>
        <!-- 角色和模板 -->
        <el-row v-show="compute.showAI" class="margin-bottom">
          <el-col :span="8" class="lightblue rounded-corner">
            <el-tooltip
                class="box-item"
                effect="dark"
                content="以系统身份 system 发送的对话，常用于指定 AI 要扮演的角色"
                placement="top-start"
            >
              <span class="popup-text popup-vertical-left">system<el-icon class="icon-margin"><ChatDotRound/></el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="16">
            <el-input type="textarea" v-model="config.system_role[config.service]" maxlength="8192"
                      placeholder="system message "/>
          </el-col>
        </el-row>
        <el-row v-show="compute.showAI" class="margin-bottom">
          <el-col :span="8" class="lightblue rounded-corner">
            <el-tooltip
                class="box-item"
                effect="dark"
                content="以用户身份 user 发送的对话，其中&#123;&#123;to&#125;&#125;表示目标语言，&#123;&#123;origin&#125;&#125;表示待翻译的文本内容，两者不可缺少。"
                placement="top-start"
            >
              <span class="popup-text popup-vertical-left">user<el-icon class="icon-margin"><ChatDotRound/></el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="16">
            <el-input type="textarea"
                      v-model="config.user_role[config.service]"
                      maxlength="8192"
                      placeholder="user message template"/>
          </el-col>
        </el-row>
      </el-collapse-item>
    </el-collapse>
  </div>

</template>

<script lang="ts" setup>
// Main 处理配置信息
import {computed, ref, watch} from 'vue'
import {models, options, servicesType} from "../entrypoints/utils/option";
import {Config} from "@/entrypoints/utils/model";

// 配置信息
let config = ref(new Config());
storage.getItem('local:config').then((value) => {
  // 检查value是否为字符串类型
  if (typeof value === 'string' && value) {
    Object.assign(config.value, JSON.parse(value));
  }
});
storage.watch('local:config', (newValue, oldValue) => {
  // console.log('配置变化，获取存储', newValue, oldValue)
  if (typeof newValue === 'string' && newValue) {
    Object.assign(config.value, JSON.parse(newValue));
  }
});

// 监听菜单栏配置变化
watch(config, (newValue, oldValue) => {
  // console.log('配置变化，修改存储', newValue, oldValue)
  storage.setItem('local:config', JSON.stringify(newValue));
}, {deep: true});

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
  // 10、是否使用 appid、key
  showAppIdKey: computed(() => servicesType.isUseAppIdKey(config.value.service)),
  // 11、判断是否为“双语模式”，控制一些翻译服务的显示
  filteredServices: computed(() => options.services.filter((service: any) => !(service.value === 'google' && config.value.style !== 1))),
  // 12、判断是否为 coze
  showRobotId: computed(() => servicesType.isCoze(config.value.service)),
})

</script>

<style scoped>
.select-left {
  text-align: left;
  font-size: 1.15em;
}

.icon-margin {
  margin-left: 0.25em;
}
</style>