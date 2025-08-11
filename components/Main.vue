<template>
  <!-- 开关 -->
  <el-row class="margin-bottom margin-left-2em">
    <el-col :span="20" class="lightblue rounded-corner">
      <span class="popup-text popup-vertical-left">插件状态</span>
    </el-col>

    <el-col :span="4" class="flex-end">
      <el-switch v-model="config.on" inline-prompt active-text="开" inactive-text="关" @change="handlePluginStateChange" />
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



    <!-- 鼠标悬浮快捷键 -->
    <el-row class="margin-bottom margin-left-2em" :class="{ 'custom-hotkey-row': config.hotkey === 'custom' }">
      <el-col :span="14" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="按住指定快捷键并悬停在文本上进行翻译" placement="top-start" :show-after="500">
        <span class="popup-text popup-vertical-left">
          鼠标悬浮快捷键
          <el-icon class="icon-margin">
            <ChatDotRound />
          </el-icon>
        </span>
        </el-tooltip>
      </el-col>
      <el-col :span="10" class="flex-end">
        <div class="hotkey-config">
          <el-select 
            v-model="config.hotkey" 
            placeholder="请选择快捷键" 
            size="small" 
            style="width: 100%"
            @change="handleMouseHotkeyChange"
          >
            <el-option v-for="item in options.keys" :key="item.value" :label="item.label" :value="item.value" :disabled="item.disabled" :class="{ 'select-divider': item.disabled }" />
          </el-select>
          
          <!-- 自定义快捷键显示（选择自定义时总是显示） -->
          <div v-if="config.hotkey === 'custom'" class="custom-hotkey-display">
            <span class="hotkey-text" v-if="config.customHotkey">
              {{ getCustomMouseHotkeyDisplayName() }}
            </span>
            <span class="hotkey-text placeholder-text" v-else>
              点击设置自定义快捷键
            </span>
            <el-button size="small" type="text" @click="openCustomMouseHotkeyDialog" class="edit-button">
              <el-icon><Edit /></el-icon>
            </el-button>
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 全文翻译快捷键选择 -->
    <el-row v-if="config.on" class="margin-bottom margin-left-2em margin-top-1em" :class="{ 'custom-hotkey-row': config.floatingBallHotkey === 'custom' }">
      <el-col :span="14" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="（测试版）设置快捷键以便快速切换全文翻译状态，无需鼠标点击悬浮球" placement="top-start" :show-after="500">
        <span class="popup-text popup-vertical-left">
          <!-- <span class="new-feature-badge">新</span> -->
          全文翻译快捷键
          <el-icon class="icon-margin">
            <ChatDotRound />
          </el-icon>
        </span>
        </el-tooltip>
      </el-col>
      <el-col :span="10" class="flex-end">
        <div class="hotkey-config">
          <el-select 
            v-model="config.floatingBallHotkey" 
            placeholder="选择快捷键" 
            size="small" 
            style="width: 100%"
            @change="handleHotkeyChange"
          >
            <el-option v-for="item in options.floatingBallHotkeys" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          
          <!-- 自定义快捷键显示（选择自定义时总是显示） -->
          <div v-if="config.floatingBallHotkey === 'custom'" class="custom-hotkey-display">
            <span class="hotkey-text" v-if="config.customFloatingBallHotkey">
              {{ getCustomHotkeyDisplayName() }}
            </span>
            <span class="hotkey-text placeholder-text" v-else>
              点击设置自定义快捷键
            </span>
            <el-button size="small" type="text" @click="openCustomHotkeyDialog" class="edit-button">
              <el-icon><Edit /></el-icon>
            </el-button>
          </div>
        </div>
      </el-col>
    </el-row>


    <!-- 划词翻译模式选择 -->
    <el-row v-if="config.on" class="margin-bottom margin-left-2em margin-top-1em">
      <el-col :span="14" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="选中文本后显示红点，鼠标移到红点上查看翻译结果。可选择关闭、双语显示或只显示译文" placement="top-start" :show-after="500">
      <span class="popup-text popup-vertical-left">
        <!-- <span class="new-feature-badge">新</span> -->
        划词翻译
        <el-icon class="icon-margin">
          <ChatDotRound />
        </el-icon>
      </span>
        </el-tooltip>
      </el-col>
      <el-col :span="10" class="flex-end">
        <el-select v-model="config.selectionTranslatorMode" placeholder="选择模式" size="small" style="width: 100%">
          <el-option label="关闭" value="disabled" />
          <el-option label="双语显示" value="bilingual" />
          <el-option label="只显示译文" value="translation-only" />
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

    <!-- DeepLX URL 配置-->
    <el-row v-show="compute.showDeepLX" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark"
          content="DeepLX API 服务地址，默认为本地地址。如果使用远程 DeepLX 服务，请修改为对应的服务地址" placement="top-start"
          :show-after="500">
          <span class="popup-text popup-vertical-left">服务地址</span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.deeplx" placeholder="http://localhost:1188/translate" />
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

    <!-- 有道翻译配置 -->
    <el-row v-show="compute.showYoudao" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="有道智云翻译API应用ID，用于访问有道翻译服务。可在有道智云控制台获取" placement="top-start"
          :show-after="500">
          <span class="popup-text popup-vertical-left">App Key<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.youdaoAppKey" placeholder="有道 AppKey" />
      </el-col>
    </el-row>
    <el-row v-show="compute.showYoudao" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="有道智云翻译API应用密钥，用于访问有道翻译服务。可在有道智云控制台获取" placement="top-start"
          :show-after="500">
          <span class="popup-text popup-vertical-left">App Secret<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.youdaoAppSecret" type="password" show-password placeholder="有道 AppSecret" />
      </el-col>
    </el-row>

    <!-- 腾讯云机器翻译配置 -->
    <el-row v-show="compute.showTencent" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="腾讯云API访问密钥ID，用于访问腾讯云机器翻译服务。可在腾讯云控制台的访问管理中获取" placement="top-start"
          :show-after="500">
          <span class="popup-text popup-vertical-left">Secret ID<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.tencentSecretId" placeholder="腾讯云 SecretId" />
      </el-col>
    </el-row>
    <el-row v-show="compute.showTencent" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="腾讯云API访问密钥，用于访问腾讯云机器翻译服务。可在腾讯云控制台的访问管理中获取" placement="top-start"
          :show-after="500">
          <span class="popup-text popup-vertical-left">Secret Key<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.tencentSecretKey" type="password" show-password placeholder="腾讯云 SecretKey" />
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

    <!-- NewAPI 配置 -->
    <el-row v-show="compute.showNewAPI" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="填写 New API 的访问地址，如：http://localhost:3000" placement="top-start" :show-after="500">
          <span class="popup-text popup-vertical-left">NewAPI接口<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.newApiUrl" placeholder="请输入您的New API接口地址" />
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
    <el-collapse class="margin-left-2em margin-bottom">
      <el-collapse-item title="高级选项">

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
            <el-switch v-model="config.useCache" inline-prompt active-text="启用" inactive-text="禁用"/>
          </el-col>
        </el-row>

        <!-- 悬浮球开关 -->
      <el-row v-if="config.on" class="margin-bottom margin-left-2em margin-top-1em">
        <el-col :span="20" class="lightblue rounded-corner">
          <el-tooltip class="box-item" effect="dark" content="（测试版）控制是否显示屏幕边缘的即时翻译悬浮球，用于对整个网页进行翻译" placement="top-start" :show-after="500">
          <span class="popup-text popup-vertical-left">
            <!-- <span class="new-feature-badge">新</span> -->
            全文翻译悬浮球
            <el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon>
          </span>
          </el-tooltip>
        </el-col>

        <el-col :span="4" class="flex-end">
          <el-switch v-model="floatingBallEnabled" inline-prompt active-text="启用" inactive-text="禁用" />
        </el-col>
      </el-row>


        <!-- 翻译进度面板 -->
        <el-row class="margin-bottom margin-left-2em">
          <el-col :span="20" class="lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark"
                        content="翻译进度面板（默认关）：关闭后将不再显示右下角的全文翻译进度面板，适合移动端或希望更少打扰的用户。"
                        placement="top-start" :show-after="500">
          <span class="popup-text popup-vertical-left">翻译进度面板<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="4" class="flex-end">
          <el-switch v-model="config.translationStatus" inline-prompt active-text="启动" inactive-text="禁用" />
          </el-col>
        </el-row>

        <!-- 禁用动画设置 -->
        <el-row class="margin-bottom margin-left-2em">
          <el-col :span="20" class="lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark"
                        content="动画效果（默认开）：禁用后将关闭加载/悬浮等动画，以节省GPU资源和电量。适合低配置设备或希望节省资源的用户。"
                        placement="top-start" :show-after="500">
              <span class="popup-text popup-vertical-left">动画效果<el-icon class="icon-margin">
                  <ChatDotRound />
                </el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="4" class="flex-end">
            <el-switch v-model="config.animations" inline-prompt active-text="启动" inactive-text="禁用" />
          </el-col>
        </el-row>

        <!-- 翻译并发数 -->
        <el-row class="margin-bottom margin-left-2em">
          <el-col :span="12" class="lightblue rounded-corner">
            <el-tooltip class="box-item" effect="dark" content="控制同时进行的最大翻译任务数，数值越高翻译速度越快，但可能占用更多系统资源" placement="top-start"
                        :show-after="500">
          <span class="popup-text popup-vertical-left">翻译并发数<el-icon class="icon-margin">
              <ChatDotRound />
            </el-icon></span>
            </el-tooltip>
          </el-col>
          <el-col :span="12">
            <el-input-number
                v-model="config.maxConcurrentTranslations"
                :min="1"
                :max="100"
                :step="1"
                style="width: 100%"
                @change="handleConcurrentChange"
                controls-position="right"
            />
          </el-col>
        </el-row>

        <!-- 使用代理转发 -->
        <el-row v-show="compute.showProxy" class="margin-bottom margin-left-2em">
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
        <el-row v-show="compute.showAI" class="margin-bottom margin-left-2em">
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
        <el-row v-show="compute.showAI" class="margin-bottom margin-left-2em">
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
        <!-- 恢夏默认模板按钮 -->
        <el-row v-show="compute.showAI" class="margin-bottom margin-left-2em">
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
    <!--    -->
  </div>

  <!-- 自定义快捷键对话框 -->
  <CustomHotkeyInput
    v-model="showCustomHotkeyDialog"
    :current-value="config.customFloatingBallHotkey"
    @confirm="handleCustomHotkeyConfirm"
    @cancel="handleCustomHotkeyCancel"
  />

  <!-- 自定义鼠标悬浮快捷键对话框 -->
  <CustomHotkeyInput
    v-model="showCustomMouseHotkeyDialog"
    :current-value="config.customHotkey"
    @confirm="handleCustomMouseHotkeyConfirm"
    @cancel="handleCustomMouseHotkeyCancel"
  />

</template>

<script lang="ts" setup>

// Main 处理配置信息
import { computed, ref, watch, onUnmounted } from 'vue'
import { models, options, servicesType, defaultOption } from "../entrypoints/utils/option";
import { Config } from "@/entrypoints/utils/model";
import { storage } from '@wxt-dev/storage';
import { ChatDotRound, Refresh, Edit } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, ElInputNumber } from 'element-plus'
import browser from 'webextension-polyfill';
import { defineAsyncComponent } from 'vue';
const CustomHotkeyInput = defineAsyncComponent(() => import('@/components/CustomHotkeyInput.vue'));
import { parseHotkey } from '@/entrypoints/utils/hotkey';

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
  // 6.5、是否显示有道翻译配置
  showYoudao: computed(() => servicesType.isYoudao(config.value.service)),
  // 6.6、是否显示腾讯云机器翻译配置
  showTencent: computed(() => servicesType.isTencent(config.value.service)),
  // 7、获取模型列表
  model: computed(() => models.get(config.value.service) || []),
  // 8、是否需要自定义接口
  showCustom: computed(() => servicesType.isCustom(config.value.service)),
  // 9、是否显示 DeepLX URL 配置
  showDeepLX: computed(() => config.value.service === 'deeplx'),
  // 10、是否自定义模型
  showCustomModel: computed(() => servicesType.isAI(config.value.service) && config.value.model[config.value.service] === "自定义模型"),
  // 11、判断是否为"双语模式"，控制一些翻译服务的显示
  filteredServices: computed(() => options.services.filter((service: any) =>
    !([service.google].includes(service.value) && config.value.display !== 1))
  ),
  // 12、判断是否为 coze
  showRobotId: computed(() => servicesType.isCoze(config.value.service)),
  // 13、是否显示New API配置
  showNewAPI: computed(() => servicesType.isNewApi(config.value.service)),
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
  get: () => !config.value.disableFloatingBall && config.value.on,
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

// 监听划词翻译模式变化
watch(() => config.value.selectionTranslatorMode, (newMode) => {
  // 向所有激活的标签页发送消息
  browser.tabs.query({}).then(tabs => {
    tabs.forEach(tab => {
      if (tab.id) {
        browser.tabs.sendMessage(tab.id, { 
          type: 'updateSelectionTranslatorMode',
          mode: newMode 
        }).catch(() => {
          // 忽略发送失败的错误（可能是页面未加载内容脚本）
        });
      }
    });
  });
});

// 监听开关变化
const handleSwitchChange = () => {
  showRefreshTip.value = true;
};

// 处理插件状态变化
const handlePluginStateChange = (val: boolean) => {
  // 如果插件被关闭，确保悬浮球和划词翻译也被关闭
  if (!val) {
    // 处理悬浮球
    if (!config.value.disableFloatingBall) {
      config.value.disableFloatingBall = true;
      // 向所有激活的标签页发送消息，关闭悬浮球
      browser.tabs.query({}).then(tabs => {
        tabs.forEach(tab => {
          if (tab.id) {
            browser.tabs.sendMessage(tab.id, { 
              type: 'toggleFloatingBall',
              isEnabled: false
            }).catch(() => {
              // 忽略发送失败的错误（可能是页面未加载内容脚本）
            });
          }
        });
      });
    }
    
    // 处理划词翻译
    if (config.value.selectionTranslatorMode !== 'disabled') {
      config.value.selectionTranslatorMode = 'disabled';
      // 向所有激活的标签页发送消息，关闭划词翻译
      browser.tabs.query({}).then(tabs => {
        tabs.forEach(tab => {
          if (tab.id) {
            browser.tabs.sendMessage(tab.id, { 
              type: 'updateSelectionTranslatorMode',
              mode: 'disabled'
            }).catch(() => {
              // 忽略发送失败的错误（可能是页面未加载内容脚本）
            });
          }
        });
      });
    }
  }
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

// 自定义快捷键相关
const showCustomHotkeyDialog = ref(false);
const showCustomMouseHotkeyDialog = ref(false);

// 处理快捷键选择变化
const handleHotkeyChange = (value: string) => {
  if (value === 'custom') {
    // 选择自定义后，如果没有设置过自定义快捷键，自动打开设置对话框
    if (!config.value.customFloatingBallHotkey) {
      // 延迟一下，让选择框先完成状态更新
      setTimeout(() => {
        openCustomHotkeyDialog();
      }, 100);
    }
  }
};

// 打开自定义快捷键对话框
const openCustomHotkeyDialog = () => {
  showCustomHotkeyDialog.value = true;
};

// 确认自定义快捷键
const handleCustomHotkeyConfirm = (hotkey: string) => {
  config.value.customFloatingBallHotkey = hotkey;
  config.value.floatingBallHotkey = 'custom';
  
  ElMessage({
    message: hotkey === 'none' ? '已禁用快捷键' : `快捷键已设置为: ${getCustomHotkeyDisplayName()}`,
    type: 'success',
    duration: 2000
  });
};

// 取消自定义快捷键
const handleCustomHotkeyCancel = () => {
  // 如果没有自定义快捷键，回退到默认选项
  if (!config.value.customFloatingBallHotkey) {
    config.value.floatingBallHotkey = 'Alt+T';
  }
};

// 获取自定义快捷键显示名称
const getCustomHotkeyDisplayName = () => {
  if (!config.value.customFloatingBallHotkey) return '';
  
  if (config.value.customFloatingBallHotkey === 'none') {
    return '已禁用';
  }
  
  const parsed = parseHotkey(config.value.customFloatingBallHotkey);
  return parsed.isValid ? parsed.displayName : config.value.customFloatingBallHotkey;
};

// 处理鼠标悬浮快捷键选择变化
const handleMouseHotkeyChange = (value: string) => {
  if (value === 'custom') {
    // 选择自定义后，如果没有设置过自定义快捷键，自动打开设置对话框
    if (!config.value.customHotkey) {
      // 延迟一下，让选择框先完成状态更新
      setTimeout(() => {
        openCustomMouseHotkeyDialog();
      }, 100);
    }
  }
};

// 打开自定义鼠标悬浮快捷键对话框
const openCustomMouseHotkeyDialog = () => {
  showCustomMouseHotkeyDialog.value = true;
};

// 确认自定义鼠标悬浮快捷键
const handleCustomMouseHotkeyConfirm = (hotkey: string) => {
  config.value.customHotkey = hotkey;
  config.value.hotkey = 'custom';
  
  ElMessage({
    message: hotkey === 'none' ? '已禁用快捷键' : `快捷键已设置为: ${getCustomMouseHotkeyDisplayName()}`,
    type: 'success',
    duration: 2000
  });
};

// 取消自定义鼠标悬浮快捷键
const handleCustomMouseHotkeyCancel = () => {
  // 如果没有自定义快捷键，回退到默认选项
  if (!config.value.customHotkey) {
    config.value.hotkey = 'Control';
  }
};

// 获取自定义鼠标悬浮快捷键显示名称
const getCustomMouseHotkeyDisplayName = () => {
  if (!config.value.customHotkey) return '';
  
  if (config.value.customHotkey === 'none') {
    return '已禁用';
  }
  
  const parsed = parseHotkey(config.value.customHotkey);
  return parsed.isValid ? parsed.displayName : config.value.customHotkey;
};

// 处理并发数量变化
const handleConcurrentChange = (currentValue: number | undefined, oldValue: number | undefined) => {
  // 验证并发数量的有效性
  if (currentValue === undefined || currentValue < 1 || currentValue > 100) {
    ElMessage({
      message: '并发数量必须在 1-100 之间',
      type: 'warning',
      duration: 2000
    });
    // 恢复默认值
    config.value.maxConcurrentTranslations = 6;
    return;
  }
  
  // 显示设置已更新的提示
  showRefreshTip.value = true;
  
  ElMessage({
    message: `并发数量已更新为 ${currentValue}`,
    type: 'success',
    duration: 2000
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

/* 自定义快捷键相关样式 */
.hotkey-config {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.custom-hotkey-display {
  display: flex;
  align-items: center;
  padding: 6px 6px 6px 10px;
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-7);
  border-radius: 4px;
  font-size: 12px;
  height: 32px;
  width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}

.hotkey-text {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-weight: 600;
  color: var(--el-color-primary);
  font-size: 13px;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  max-width: calc(100% - 32px);
}

.edit-button {
  padding: 2px 4px;
  margin-left: 4px;
  color: var(--el-color-primary);
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.edit-button:hover {
  background: var(--el-color-primary-light-8);
}

.edit-button .el-icon {
  font-size: 12px;
}

.placeholder-text {
  color: var(--el-text-color-placeholder) !important;
  font-style: italic;
  font-family: inherit !important;
  font-weight: normal !important;
}

/* 自定义快捷键行样式 */
.custom-hotkey-row {
  border-radius: 8px;
  padding: 8px;
  margin: 6px 0 !important;
  background: linear-gradient(135deg, 
    rgba(64, 158, 255, 0.03) 0%, 
    rgba(64, 158, 255, 0.01) 50%, 
    rgba(103, 194, 58, 0.02) 100%);
  transition: all 0.3s ease;
  position: relative;
  border: 1px solid transparent;
}

.custom-hotkey-row::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, 
    rgba(64, 158, 255, 0.2) 0%, 
    rgba(64, 158, 255, 0.1) 30%,
    rgba(103, 194, 58, 0.1) 70%,
    rgba(103, 194, 58, 0.2) 100%);
  border-radius: 8px;
  z-index: -1;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.custom-hotkey-row::after {
  content: '';
  position: absolute;
  top: -1px;
  left: -1px;
  right: -1px;
  bottom: -1px;
  background: linear-gradient(135deg, 
    rgba(64, 158, 255, 0.3), 
    rgba(103, 194, 58, 0.3));
  border-radius: 8px;
  z-index: -2;
  opacity: 0.6;
}

.custom-hotkey-row:hover {
  background: linear-gradient(135deg, 
    rgba(64, 158, 255, 0.05) 0%, 
    rgba(64, 158, 255, 0.03) 50%, 
    rgba(103, 194, 58, 0.04) 100%);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.15);
}

.custom-hotkey-row:hover::before {
  opacity: 0.1;
}

/* 自定义标识徽章 */
.custom-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  background: var(--el-color-primary);
  color: white;
  font-size: 10px;
  border-radius: 10px;
  font-weight: 500;
  margin-left: 6px;
  line-height: 1;
}
</style>
