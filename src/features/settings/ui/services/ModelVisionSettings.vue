<!--
 @file src/features/settings/ui/services/ModelVisionSettings.vue
 文件职责：展示当前模型的手动识图设置、规则或测试缓存结论，并提供真实图片检测与取消操作；检测说明由父级放在字段标签旁的提示里。
 主要内容：用三选一分段按钮手动指定能力，先持久保存当前配置再发送带身份指纹的测试消息；只在已有结论或服务不支持时显示状态行（尚未确认属于默认状态，说明收在标签提示里），合并重复的能力结论与测试反馈，保留运行中、失败和取消信息；切换模型、凭据、服务或卸载时取消旧任务，忽略过期响应，订阅独立本地测试缓存；只在所属页面与模型页签活跃时工作，配置等待和测试消息有独立预算，隐藏或停用取消旧任务，成功后的缓存刷新不阻塞检测完成。
 模块边界：UI 只从共享纯契约读取消息名称，不加载探测实现或正文候选；不发送模型 HTTP、不提供凭据或图片、不修改自动探测结论；请求由共享服务与后台实际适配器执行，手动选择保留用户优先级。
-->
<template>
  <div class="connection-field-control model-vision-setting">
    <div class="model-vision-controls">
      <SegmentedControl
        v-model="override" compact data-testid="model-vision-capability"
        :label="t('settings.services.visionCapability')" :options="capabilityOptions" :disabled="!transportSupported"
      />
      <el-button
        data-testid="model-vision-probe" :disabled="!transportSupported"
        :title="busy ? undefined : t('settings.services.visionProbeAction')" :aria-label="busy ? undefined : t('settings.services.visionProbeAction')"
        @click="busy ? cancel() : probe()"
      >
        {{ t(busy ? 'settings.services.visionProbeCancel' : 'settings.services.visionProbeShort') }}
      </el-button>
    </div>
    <small v-if="showCapabilityMessage" class="model-vision-status" :class="`is-${capabilityTone}`" data-testid="model-vision-status" role="status">{{ t(capabilityMessage) }}</small>
    <small v-if="distinctFeedback" role="status" data-testid="model-vision-probe-feedback">{{ distinctFeedback }}</small>
  </div>
</template>
<script setup lang="ts">
import {computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch} from 'vue'
import browser from 'webextension-polyfill'
import type {Config} from '@/src/core/config/model'
import {supportsVisionTransport} from '@/src/core/config/vision'
import {createVisionProbeIdentity, type VisionProbeResult} from '@/src/core/config/visionProbe'
import {VISION_PROBE_MESSAGE, VISION_PROBE_CANCEL_MESSAGE} from '@/src/services/translation/types'
import {useVisionProbeStatus} from './useVisionProbeStatus'
import {requestConfigSave, waitForConfigPersistenceQueue} from '@/src/services/config/store'
import {useUiI18n} from '@/src/ui/i18n'
import SegmentedControl from '../components/SegmentedControl.vue'
import {waitForSettingsTask} from '../../model/taskWait'

const props = withDefaults(defineProps<{config: Config; service: string; model: string; active?: boolean}>(), {active: true})
const {t} = useUiI18n()
const viewActive = ref(true)
const active = computed(() => viewActive.value && props.active)
const {result: capabilityStatus, refresh} = useVisionProbeStatus(() => props.config, () => props.service, () => props.model, () => active.value)
const busy = ref(false)
const feedback = ref('')
const identity = computed(() => active.value ? createVisionProbeIdentity(props.config, props.service, props.model) : null)
const transportSupported = computed(() => supportsVisionTransport(props.service, props.model))
const capabilityOptions = computed(() => [
  {value: 'auto', label: t('settings.services.visionAuto')},
  {value: 'supported', label: t('settings.services.visionSupported')},
  {value: 'unsupported', label: t('settings.services.visionTextOnly')},
])
const override = computed({
  get: () => typeof props.config.modelVision[props.service]?.[props.model] === 'boolean'
    ? props.config.modelVision[props.service][props.model] ? 'supported' : 'unsupported' : 'auto',
  set: (value: string | number) => {
    if (!active.value || !props.model || !transportSupported.value) return
    const next = {...props.config.modelVision[props.service]}
    if (value === 'auto') delete next[props.model]
    else next[props.model] = value === 'supported'
    if (Object.keys(next).length) props.config.modelVision[props.service] = next
    else delete props.config.modelVision[props.service]
  },
})
const capabilityMessage = computed(() => {
  if (!transportSupported.value) return 'settings.services.visionTransportUnsupported'
  if (capabilityStatus.value.source === 'probe') return capabilityStatus.value.capability === 'supported' ? 'settings.services.visionProbeSupported' : 'settings.services.visionProbeUnsupported'
  const capability = capabilityStatus.value.capability
  return capability === 'supported' ? 'settings.services.visionConfirmed' : capability === 'unsupported'
    ? 'settings.services.visionTextOnlyMessage' : 'settings.services.visionUnknown'
})
// “尚未确认”是默认状态，说明收在标签旁的提示里；只有得出结论或服务不支持时才占一行。
const showCapabilityMessage = computed(() => capabilityMessage.value !== 'settings.services.visionUnknown')
const capabilityTone = computed(() => !transportSupported.value ? 'muted'
  : capabilityStatus.value.capability === 'supported' ? 'success'
    : capabilityStatus.value.source === 'probe' ? 'warning' : 'muted')
const distinctFeedback = computed(() => feedback.value === t(capabilityMessage.value) ? '' : feedback.value)
let generation = 0
let activeProbe: {id: string; controller: AbortController} | undefined
function cancelMessage(id: string): void {
  try {void browser.runtime.sendMessage({type: VISION_PROBE_CANCEL_MESSAGE, requestId: id}).catch(() => undefined)} catch { /* 页面退出时端口可能已释放。 */ }
}
function cancel(showFeedback = true): void {
  generation++
  busy.value = false
  if (activeProbe) {activeProbe.controller.abort();cancelMessage(activeProbe.id);activeProbe = undefined}
  if (showFeedback && active.value) feedback.value = t('settings.services.visionProbeCancelled')
}
async function probe(): Promise<void> {
  if (!active.value || busy.value || !props.model || !transportSupported.value) return
  const current = ++generation
  const testedConfig = props.config, testedService = props.service, testedModel = props.model, testedIdentity = identity.value
  const operation = {id: crypto.randomUUID(), controller: new AbortController()}
  activeProbe = operation
  const isCurrent = () => active.value && current === generation && props.config === testedConfig && identity.value === testedIdentity
  const wait = <T>(task: Promise<T>, timeout: number, key: string) => waitForSettingsTask(task, operation.controller.signal, timeout, t(key))
  let completed = false
  busy.value = true
  feedback.value = t('settings.services.visionProbeRunning')
  try {
    await wait(waitForConfigPersistenceQueue(), 10_000, 'settings.services.keys.configTimeout')
    if (!isCurrent()) return
    await wait(requestConfigSave(testedConfig, browser.runtime.sendMessage.bind(browser.runtime)), 10_000, 'settings.services.keys.configTimeout')
    if (!isCurrent()) return
    const result = await wait(browser.runtime.sendMessage({type: VISION_PROBE_MESSAGE, service: testedService, model: testedModel,
      identity: testedIdentity, requestId: operation.id}), 45_000, 'settings.services.keys.responseTimeout') as VisionProbeResult & {success?: boolean; error?: string}
    if (!isCurrent()) return
    if (!result?.success) throw new Error(result?.error || t('settings.services.visionProbeFailed'))
    completed = true
    feedback.value = t(result.capability === 'supported' ? 'settings.services.visionProbeSupported'
      : result.capability === 'unsupported' ? 'settings.services.visionProbeUnsupported' : 'settings.services.visionProbeUnknown')
    void refresh().catch(() => undefined)
  } catch (error) {
    if (isCurrent()) feedback.value = t('settings.services.visionProbeFailed') + (error instanceof Error ? ` ${error.message}` : '')
  } finally {
    if (activeProbe === operation) {
      activeProbe = undefined;operation.controller.abort()
      if (!completed) cancelMessage(operation.id)
    }
    if (current === generation) busy.value = false
  }
}
watch(() => active.value ? [props.config, props.service, props.model, identity.value] : null, () => {cancel(false);feedback.value = ''}, {flush: 'sync'})
onActivated(() => {viewActive.value = true})
onDeactivated(() => {viewActive.value = false})
onBeforeUnmount(() => {viewActive.value = false})
</script>
<style scoped>
.model-vision-controls { display: flex; align-items: center; gap: 8px; width: 100%; }
.model-vision-controls :deep(.segmented-control) { flex: 1; min-width: 0; max-width: 360px; }
.model-vision-controls :deep(.el-button) { flex: none; margin: 0; height: 38px; padding: 0 14px; border-radius: 10px; font-size: 12px; }
.model-vision-setting { gap: 6px; }
@container (max-width: 480px) { .model-vision-controls { flex-wrap: wrap; } .model-vision-controls :deep(.segmented-control) { flex-basis: 100%; max-width: none; } }
.model-vision-setting small { color: var(--muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.model-vision-status { display: flex; align-items: center; gap: 6px; }
.model-vision-status::before { content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .55; }
.model-vision-setting .model-vision-status.is-success { color: var(--el-color-success); }
.model-vision-setting .model-vision-status.is-warning { color: var(--el-color-danger); }
.model-vision-status.is-success::before, .model-vision-status.is-warning::before { opacity: 1; }
</style>
