<template>
  <section class="settings-section service-connection-section">
    <div v-if="compute.credentialWarning" class="credential-warning" role="alert">
      <strong>配置提醒</strong>
      <span>{{ compute.credentialWarning }}</span>
    </div>
    <div class="subsection-heading">
      <div>
        <strong>连接参数</strong>
        <small class="connection-test-hint">会发送一条很短的测试请求，可能产生少量用量。</small>
      </div>
    </div>

    <Teleport defer to=".detail-hero">
      <button
        type="button"
        class="connection-test-button"
        data-connection-test-button
        :disabled="connectionTestBusy"
        @click="testConnection"
      >
        {{ connectionTestBusy ? '检查中…' : '检查连接' }}
      </button>
    </Teleport>

    <div
      v-if="connectionTestMessage"
      class="connection-test-result"
      :class="`is-${connectionTestState}`"
      data-connection-test-status
      role="status"
      aria-live="polite"
    >
      <strong>{{ connectionTestState === 'testing' ? '检查中' : connectionTestState === 'success' ? '连接正常' : '连接失败' }}</strong>
      <span>{{ connectionTestMessage }}</span>
    </div>

    <div v-show="compute.showAI && compute.showToken" class="api-key-policy">
      <div class="api-key-policy-copy">
        <div class="api-key-policy-title">
          <strong>API Key 鉴权</strong>
          <el-tooltip class="box-item" effect="dark" content="关闭后，当前模型可在没有 API Key 时发起请求。" placement="top-start" :show-after="500">
            <el-icon aria-label="API Key 鉴权说明"><InfoFilled /></el-icon>
          </el-tooltip>
          <span class="api-key-policy-status" :class="{ 'is-off': !compute.requireApiKey }">
            {{ compute.requireApiKey ? '需要' : '免 Key' }}
          </span>
        </div>
        <small class="api-key-policy-model">{{ config.model[service] || '未选择' }}</small>
      </div>
      <el-switch v-model="compute.requireApiKey" aria-label="当前模型是否需要 API Key" size="small" />
    </div>

    <el-row v-show="compute.showToken" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="API访问令牌仅保存在本地，用于访问翻译服务。获取方式请参考对应服务的官方文档；翻译服务为 ollama 时，token 可为任意值" placement="top-start" :show-after="500">
          <span class="popup-text popup-vertical-left">访问令牌<el-icon class="icon-margin"><InfoFilled /></el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12"><el-input v-model="config.token[service]" type="password" show-password placeholder="请输入API访问令牌" /></el-col>
    </el-row>
    <p v-if="compute.showMiniMaxRegion && minimaxKeyMismatch" class="minimax-key-note is-warning">
      {{ minimaxKeyMismatch }}
    </p>

    <el-row v-show="compute.showMiniMaxRegion" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="按量付费和 Token Plan 使用不同的账户权益；请按控制台中 Key 的来源选择。" placement="top-start" :show-after="500">
          <span class="popup-text popup-vertical-left">MiniMax 计费方式<el-icon class="icon-margin"><InfoFilled /></el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.minimaxBillingPlan" aria-label="MiniMax 计费方式" placeholder="请选择 MiniMax 计费方式">
          <el-option class="select-left" v-for="item in options.minimaxBillingPlan" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <el-row v-show="compute.showMiniMaxRegion" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="选择与 MiniMax Key 来源一致的 API 区域。Token Plan Key（sk-cp-）和按量付费 Key 不能互换。" placement="top-start" :show-after="500">
          <span class="popup-text popup-vertical-left">MiniMax 区域<el-icon class="icon-margin"><InfoFilled /></el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.minimaxRegion" aria-label="MiniMax API 区域" placeholder="请选择 MiniMax API 区域">
          <el-option class="select-left" v-for="item in options.minimaxRegion" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <div v-show="compute.showMiniMaxRegion" class="minimax-endpoint" data-minimax-endpoint>
      <span>当前 API 地址</span>
      <code>{{ minimaxEndpoint }}</code>
    </div>

    <p v-if="compute.showMiMoRegion && mimoKeyMismatch" class="mimo-key-note is-warning">
      {{ mimoKeyMismatch }}
    </p>

    <el-row v-show="compute.showMiMoRegion" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="按量付费和 Token Plan 使用不同的账户权益；请按小米 MiMo 控制台中 Key 的来源选择。" placement="top-start" :show-after="500">
          <span class="popup-text popup-vertical-left">小米 MiMo 计费方式<el-icon class="icon-margin"><InfoFilled /></el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.mimoBillingPlan" aria-label="小米 MiMo 计费方式" placeholder="请选择小米 MiMo 计费方式">
          <el-option class="select-left" v-for="item in options.mimoBillingPlan" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <el-row v-show="compute.showMiMoRegion" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="Token Plan 必须使用购买页面提供的集群地址；中国、新加坡和欧洲集群的 tp- Key 不能混用。按量付费统一使用 api.xiaomimimo.com。" placement="top-start" :show-after="500">
          <span class="popup-text popup-vertical-left">MiMo API 集群<el-icon class="icon-margin"><InfoFilled /></el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.mimoRegion" aria-label="小米 MiMo API 集群" placeholder="请选择小米 MiMo API 集群">
          <el-option class="select-left" v-for="item in options.mimoRegion" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <div v-show="compute.showMiMoRegion" class="mimo-endpoint" data-mimo-endpoint>
      <span>当前 API 地址</span>
      <code>{{ mimoEndpoint }}</code>
    </div>

    <el-row v-show="compute.showAzureOpenaiEndpoint" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="Azure OpenAI 服务端点地址，必须包含完整的部署信息。" placement="top-start" :show-after="500">
          <span class="popup-text popup-vertical-left">Azure 端点<el-icon class="icon-margin"><InfoFilled /></el-icon></span>
        </el-tooltip>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.azureOpenaiEndpoint" placeholder="https://your-resource.openai.azure.com/openai/deployments/your-model/chat/completions?api-version=2024-02-15-preview" :class="{ 'input-error': config.azureOpenaiEndpoint && !isValidAzureEndpoint(config.azureOpenaiEndpoint) }" />
        <div v-if="config.azureOpenaiEndpoint && !isValidAzureEndpoint(config.azureOpenaiEndpoint)" class="error-text">端点地址格式不正确，请确保包含 openai.azure.com 域名和 /chat/completions 路径</div>
      </el-col>
    </el-row>

    <el-row v-show="compute.showDeepLX" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="DeepLX API 服务地址，默认为本地地址。如果使用远程 DeepLX 服务，请修改为对应的服务地址" placement="top-start" :show-after="500"><span class="popup-text popup-vertical-left">服务地址</span></el-tooltip>
      </el-col>
      <el-col :span="12"><el-input v-model="config.deeplx" placeholder="http://localhost:1188/translate" /></el-col>
    </el-row>

    <el-row v-show="compute.showAkSk" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><el-tooltip effect="dark" content="服务商提供的访问密钥。" placement="top-start" :show-after="300"><span class="popup-text popup-vertical-left">API Key<el-icon class="icon-margin"><InfoFilled /></el-icon></span></el-tooltip></el-col>
      <el-col :span="12"><el-input v-model="config.ak" placeholder="请输入Access Key" /></el-col>
    </el-row>
    <el-row v-show="compute.showAkSk" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><el-tooltip effect="dark" content="服务商提供的私密密钥，请妥善保管。" placement="top-start" :show-after="300"><span class="popup-text popup-vertical-left">Secret Key<el-icon class="icon-margin"><InfoFilled /></el-icon></span></el-tooltip></el-col>
      <el-col :span="12"><el-input v-model="config.sk" type="password" placeholder="请输入Secret Key" /></el-col>
    </el-row>

    <el-row v-show="compute.showYoudao" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><el-tooltip effect="dark" content="有道翻译服务提供的 App Key。" placement="top-start" :show-after="300"><span class="popup-text popup-vertical-left">App Key<el-icon class="icon-margin"><InfoFilled /></el-icon></span></el-tooltip></el-col>
      <el-col :span="12"><el-input v-model="config.youdaoAppKey" placeholder="有道 AppKey" /></el-col>
    </el-row>
    <el-row v-show="compute.showYoudao" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><el-tooltip effect="dark" content="有道翻译服务提供的 App Secret。" placement="top-start" :show-after="300"><span class="popup-text popup-vertical-left">App Secret<el-icon class="icon-margin"><InfoFilled /></el-icon></span></el-tooltip></el-col>
      <el-col :span="12"><el-input v-model="config.youdaoAppSecret" type="password" show-password placeholder="有道 AppSecret" /></el-col>
    </el-row>

    <el-row v-show="compute.showTencent" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><el-tooltip effect="dark" content="腾讯云翻译服务提供的 SecretId。" placement="top-start" :show-after="300"><span class="popup-text popup-vertical-left">Secret ID<el-icon class="icon-margin"><InfoFilled /></el-icon></span></el-tooltip></el-col>
      <el-col :span="12"><el-input v-model="config.tencentSecretId" placeholder="腾讯云 SecretId" /></el-col>
    </el-row>
    <el-row v-show="compute.showTencent" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><el-tooltip effect="dark" content="腾讯云翻译服务提供的 SecretKey。" placement="top-start" :show-after="300"><span class="popup-text popup-vertical-left">Secret Key<el-icon class="icon-margin"><InfoFilled /></el-icon></span></el-tooltip></el-col>
      <el-col :span="12"><el-input v-model="config.tencentSecretKey" type="password" show-password placeholder="腾讯云 SecretKey" /></el-col>
    </el-row>

    <el-row v-show="compute.showRobotId" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><el-tooltip effect="dark" content="填写对应 Coze 机器人的 ID。" placement="top-start" :show-after="300"><span class="popup-text popup-vertical-left">机器人ID<el-icon class="icon-margin"><InfoFilled /></el-icon></span></el-tooltip></el-col>
      <el-col :span="12"><el-input v-model="config.robot_id[service]" placeholder="请输入Coze机器人ID" /></el-col>
    </el-row>

    <el-row v-show="compute.showCustom" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><el-tooltip effect="dark" content="填写兼容翻译请求的自定义接口地址。" placement="top-start" :show-after="300"><span class="popup-text popup-vertical-left">自定义接口<el-icon class="icon-margin"><InfoFilled /></el-icon></span></el-tooltip></el-col>
      <el-col :span="12"><el-input v-model="config.custom" placeholder="请输入自定义接口地址" /></el-col>
    </el-row>
    <el-row v-show="compute.showNewAPI" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><el-tooltip effect="dark" content="填写 New API 服务的接口地址。" placement="top-start" :show-after="300"><span class="popup-text popup-vertical-left">NewAPI接口<el-icon class="icon-margin"><InfoFilled /></el-icon></span></el-tooltip></el-col>
      <el-col :span="12"><el-input v-model="config.newApiUrl" placeholder="请输入您的New API接口地址" /></el-col>
    </el-row>

    <el-row v-show="compute.showCustomModel" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><el-tooltip effect="dark" content="填写服务商支持的模型标识；选择自定义模型后，网页翻译会使用这里的值。" placement="top-start" :show-after="300"><span class="popup-text popup-vertical-left">{{ service === 'doubao' ? '接入点' : '自定义模型' }}<el-icon class="icon-margin"><InfoFilled /></el-icon></span></el-tooltip></el-col>
      <el-col :span="12"><el-input v-model="config.customModel[service]" placeholder="例如：gemma:7b" /></el-col>
    </el-row>

    <el-row v-show="compute.showDeepseekApiType" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><el-tooltip effect="dark" content="选择 DeepSeek 接口使用的 API 格式。" placement="top-start" :show-after="300"><span class="popup-text popup-vertical-left">API 格式<el-icon class="icon-margin"><InfoFilled /></el-icon></span></el-tooltip></el-col>
      <el-col :span="12"><el-select v-model="config.deepseekApiType" placeholder="请选择 API 格式"><el-option class="select-left" v-for="item in options.deepseekApiType" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-col>
    </el-row>
    <el-row v-show="compute.showDeepseekThinkingMode" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><el-tooltip effect="dark" content="控制 DeepSeek 是否启用思考过程。" placement="top-start" :show-after="300"><span class="popup-text popup-vertical-left">思考模式<el-icon class="icon-margin"><InfoFilled /></el-icon></span></el-tooltip></el-col>
      <el-col :span="12"><el-select v-model="config.deepseekThinkingMode" placeholder="请选择思考模式"><el-option class="select-left" v-for="item in options.deepseekThinkingMode" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-col>
    </el-row>

    <el-row v-show="compute.showCustomBody" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><el-tooltip effect="dark" content="填写要合并到翻译请求中的 JSON 参数对象。" placement="top-start" :show-after="300"><span class="popup-text popup-vertical-left">自定义请求体<el-icon class="icon-margin"><InfoFilled /></el-icon></span></el-tooltip></el-col>
      <el-col :span="12">
        <el-input v-model="config.customBody[service]" :class="{ 'input-error': !isValidCustomBody(config.customBody[service]) }" placeholder='例如：{"thinking": {"type": "disabled"}}' />
        <div v-if="!isValidCustomBody(config.customBody[service])" class="error-text">请输入合法的 JSON 对象，否则该配置将被忽略</div>
      </el-col>
    </el-row>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import { InfoFilled } from '@element-plus/icons-vue'
import type { Config } from '@/entrypoints/utils/model'
import { options as optionConfig } from '@/entrypoints/utils/option'
import { isValidCustomBody } from '@/entrypoints/utils/custom-body'
import browser from 'webextension-polyfill'
import { requestConfigSave } from '@/entrypoints/utils/config'
import { CONNECTION_TEST_MESSAGE, getMimoEndpoint, MINIMAX_ENDPOINTS } from '@/entrypoints/utils/constant'

const props = defineProps<{
  config: Config
  service: string
  compute: Record<string, any>
  options: typeof optionConfig
  isValidAzureEndpoint: (endpoint: string) => boolean
}>()

const config = toRef(props, 'config')
const service = toRef(props, 'service')
const compute = toRef(props, 'compute')
const options = toRef(props, 'options')
const isValidAzureEndpoint = toRef(props, 'isValidAzureEndpoint')

const minimaxKeyKind = computed(() => {
  const token = config.value.token[service.value]?.trim() || ''
  return token.startsWith('sk-cp-') ? 'token-plan' : token ? 'other' : 'empty'
})

const minimaxKeyMismatch = computed(() => {
  if (minimaxKeyKind.value === 'empty') return ''
  if (config.value.minimaxBillingPlan === 'token-plan' && minimaxKeyKind.value !== 'token-plan') {
    return '当前选择的是 Token Plan，但 Key 不是 sk-cp- 开头；请确认 Key 来源，Token Plan 订阅必须有效。'
  }
  if (config.value.minimaxBillingPlan === 'payg' && minimaxKeyKind.value === 'token-plan') {
    return '当前选择的是按量付费，但检测到 sk-cp- Token Plan Key；两类 Key 不能互换，请切换计费方式或更换 Key。'
  }
  return config.value.minimaxBillingPlan === 'token-plan'
    ? '当前使用 Token Plan Key；请确认 Token Plan 订阅有效。'
    : ''
})

const minimaxEndpoint = computed(() => {
  const plan = config.value.minimaxBillingPlan === 'token-plan' ? 'token-plan' : 'payg'
  const region = config.value.minimaxRegion === 'cn' ? 'cn' : 'global'
  return MINIMAX_ENDPOINTS[plan][region]
})

const mimoKeyKind = computed(() => {
  const token = config.value.token[service.value]?.trim() || ''
  if (token.startsWith('tp-')) return 'token-plan'
  if (token.startsWith('sk-')) return 'payg'
  return token ? 'other' : 'empty'
})

const mimoKeyMismatch = computed(() => {
  if (mimoKeyKind.value === 'empty') return ''
  if (config.value.mimoBillingPlan === 'token-plan' && mimoKeyKind.value !== 'token-plan') {
    return '当前选择的是 MiMo Token Plan，但 Key 不是 tp- 开头；请确认 Key 来源和订阅状态。'
  }
  if (config.value.mimoBillingPlan === 'payg' && mimoKeyKind.value === 'token-plan') {
    return '当前选择的是 MiMo 按量付费，但检测到 tp- Token Plan Key；两类 Key 不能互换，请切换计费方式或更换 Key。'
  }
  if (config.value.mimoBillingPlan === 'payg' && mimoKeyKind.value === 'other') {
    return 'MiMo 按量付费 Key 通常以 sk- 开头；请确认 Key 来自 API Keys 页面。'
  }
  return config.value.mimoBillingPlan === 'token-plan'
    ? '当前使用 MiMo Token Plan Key；请确认订阅仍在有效期内。'
    : ''
})

const mimoEndpoint = computed(() => {
  return getMimoEndpoint(config.value.mimoBillingPlan, config.value.mimoRegion)
})

type ConnectionTestState = 'idle' | 'testing' | 'success' | 'error'

const connectionTestBusy = ref(false)
const connectionTestState = ref<ConnectionTestState>('idle')
const connectionTestMessage = ref('')

function resetConnectionTest(): void {
  connectionTestState.value = 'idle'
  connectionTestMessage.value = ''
}

async function testConnection(): Promise<void> {
  if (connectionTestBusy.value) return

  connectionTestBusy.value = true
  connectionTestState.value = 'testing'
  connectionTestMessage.value = '正在保存当前配置并请求服务…'

  try {
    await requestConfigSave(config.value, browser.runtime.sendMessage.bind(browser.runtime))
    const response = await browser.runtime.sendMessage({
      type: CONNECTION_TEST_MESSAGE,
      service: service.value,
    }) as {success?: boolean; durationMs?: number; error?: string} | undefined

    if (!response?.success) {
      throw new Error(response?.error || '连接测试失败')
    }

    connectionTestState.value = 'success'
    connectionTestMessage.value = `已完成真实翻译请求${typeof response.durationMs === 'number' ? `（${response.durationMs} ms）` : ''}。`
  } catch (error) {
    connectionTestState.value = 'error'
    connectionTestMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    connectionTestBusy.value = false
  }
}

watch(service, resetConnectionTest)
</script>

<style scoped>
.credential-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 16px;
  padding: 11px 13px;
  border: 1px solid #f3d19e;
  border-radius: 10px;
  color: #8a5a00;
  background: #fdf6ec;
  font-size: 12px;
  line-height: 1.5;
  animation: credential-warning-breathe 2.8s ease-in-out infinite;
}

.subsection-heading {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 16px;
}

.subsection-heading > div:first-child {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 9px;
}

.connection-test-hint {
  color: #9098a8;
  font-size: 11px;
  font-weight: 400;
}

.connection-test-button {
  flex: 0 0 auto;
  align-self: flex-start;
  margin-left: auto;
  padding: 8px 14px;
  border: 1px solid #ef4776;
  border-radius: 9px;
  color: #c52f58;
  background: #fff4f7;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: 160ms ease;
}

.connection-test-button:hover:not(:disabled) {
  color: #fff;
  background: #ef4776;
  box-shadow: 0 6px 14px rgba(214, 50, 96, .18);
}

.connection-test-button:disabled {
  cursor: wait;
  opacity: .65;
}

.connection-test-result {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 14px;
  padding: 10px 12px;
  border: 1px solid #dfe3eb;
  border-radius: 10px;
  color: #667187;
  background: #f7f8fa;
  font-size: 12px;
  line-height: 1.5;
}

.connection-test-result.is-testing {
  border-color: #c9d9f3;
  color: #45628c;
  background: #f2f7ff;
}

.connection-test-result.is-success {
  border-color: #b8e0cb;
  color: #287447;
  background: #effaf3;
}

.connection-test-result.is-error {
  border-color: #f2c0ca;
  color: #a52c48;
  background: #fff1f4;
}

.minimax-key-note {
  margin: -8px 0 14px 2em;
  color: #6d7890;
  font-size: 11px;
  line-height: 1.5;
}

.mimo-key-note {
  margin: -8px 0 14px 2em;
  color: #6d7890;
  font-size: 11px;
  line-height: 1.5;
}

.minimax-key-note.is-warning {
  color: #a52c48;
}

.mimo-key-note.is-warning {
  color: #a52c48;
}

.minimax-endpoint {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: -4px 0 14px 2em;
  color: #8993a5;
  font-size: 11px;
  line-height: 1.5;
}

.minimax-endpoint code {
  overflow-wrap: anywhere;
  color: #59657b;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.mimo-endpoint {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: -4px 0 14px 2em;
  color: #8993a5;
  font-size: 11px;
  line-height: 1.5;
}

.mimo-endpoint code {
  overflow-wrap: anywhere;
  color: #59657b;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

@media (max-width: 700px) {
  .subsection-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .subsection-heading > div:first-child {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
  }

  .connection-test-button {
    width: 100%;
    margin-left: 0;
  }
}

.credential-warning strong {
  flex: 0 0 auto;
  font-weight: 750;
}

@keyframes credential-warning-breathe {
  0%, 100% { border-color: #f3d19e; box-shadow: 0 0 0 0 rgba(243, 209, 158, 0); }
  50% { border-color: #e8b468; box-shadow: 0 0 0 4px rgba(243, 209, 158, .2); }
}

@media (prefers-reduced-motion: reduce) {
  .credential-warning { animation: none; }
}

.api-key-policy {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0 0 10px;
  padding: 12px 16px;
  border: 1px solid #edf0f5;
  border-radius: 16px;
  background: #fbfcfe;
  transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;
}

.api-key-policy:hover {
  border-color: #e5b4c2;
  background: #fff;
  box-shadow: 0 8px 22px rgba(31, 40, 61, .04);
}

.api-key-policy-copy {
  min-width: 0;
}

.api-key-policy-title {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: #172033;
  font-size: 13px;
}

.api-key-policy-title strong {
  font-weight: 650;
}

.api-key-policy-title .el-icon {
  color: #8b93a4;
  font-size: 13px;
}

.api-key-policy-status {
  display: inline-flex;
  align-items: center;
  margin-left: 3px;
  padding: 2px 7px;
  border: 1px solid #f4c5d2;
  border-radius: 999px;
  color: #c52f58;
  background: #fff2f5;
  font-size: 10px;
  font-weight: 750;
  line-height: 1.3;
}

.api-key-policy-status.is-off {
  border-color: #dfe3eb;
  color: #687286;
  background: #f5f6f8;
}

.api-key-policy-model {
  display: block;
  max-width: 100%;
  margin-top: 4px;
  overflow: hidden;
  color: #909399;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-key-policy :deep(.el-switch) {
  flex: 0 0 auto;
  --el-switch-on-color: #ef4776;
  --el-switch-off-color: #cfd5df;
}
</style>
