<!--
 * @file src/features/settings/ui/services/CustomOpenAIProviderDialog.vue
 * 文件职责：作为添加自定义翻译服务的唯一窗口，提供兼容接口和组合翻译两种类型。
 * 主要内容：共用名称，隔离接口凭据与组合成员草稿；提交沿用原接口契约或发送不含凭据的组合草稿，类型切换、关闭重开、停用与配置替换淘汰旧事件。
 * 模块边界：不生成服务 ID、不修改 Config、不保存凭据或改变默认服务；外层统一创建与持久化，组合复用已有普通服务配置。
 -->
<template>
  <el-dialog :model-value="modelValue && active && ownedOpen" width="min(600px, calc(100vw - 28px))" class="custom-openai-provider-dialog" data-testid="custom-service-dialog" :title="t('settings.services.composite.customTitle')" :close-on-click-modal="false" destroy-on-close :onOpened="actions.focus" :onUpdate:modelValue="actions.update">
    <form class="custom-provider-form" novalidate :onSubmit="withModifiers(actions.submit, ['prevent'])">
      <div class="custom-service-types" role="group" :aria-label="t('settings.services.composite.serviceType')">
        <button type="button" data-testid="custom-service-type-interface" :aria-pressed="serviceType === 'interface'" :disabled="!active" :onClick="actions.type.bind(null, 'interface')">{{ t('settings.services.composite.interfaceType') }}</button>
        <button type="button" data-testid="custom-service-type-composite" :aria-pressed="serviceType === 'composite'" :disabled="!active" :onClick="actions.type.bind(null, 'composite')">{{ t('settings.services.composite.compositeType') }}</button>
      </div>
      <label>
        <span>{{ translateLegacy('服务名称') }}</span>
        <input ref="nameInput" :value="draft.name" :onInput="actions.draft.bind(null, 'name')" type="text" autocomplete="off" data-testid="custom-service-name" :placeholder="serviceType === 'interface' ? translateLegacy('例如：本地 Ollama') : t('settings.services.composite.namePlaceholder')" :maxlength="maximumNameLength" :aria-label="translateLegacy('服务名称')" :aria-invalid="Boolean(nameError)" />
        <small v-if="nameError" class="field-error" role="alert">{{ nameError }}</small>
      </label>
      <template v-if="serviceType === 'interface'">
        <label>
          <span>{{ translateLegacy('接口地址') }}</span>
          <input :value="draft.endpoint" :onInput="actions.draft.bind(null, 'endpoint')" type="url" autocomplete="url" data-testid="custom-service-endpoint" placeholder="http://localhost:11434/v1/chat/completions" :maxlength="maximumEndpointLength" :aria-invalid="Boolean(errors.endpoint)" />
          <small>{{ translateLegacy('支持完整 Chat Completions 地址或以 /v1 结尾的 Base URL；模型须支持 Chat Completions') }}</small>
          <small v-if="errors.endpoint" class="field-error" role="alert">{{ translateLegacy(errors.endpoint) }}</small>
        </label>
        <label>
          <span>API Key <small>{{ translateLegacy('可选') }}</small></span>
          <input :value="draft.apiKey" :onInput="actions.draft.bind(null, 'apiKey')" type="password" autocomplete="new-password" data-testid="custom-service-api-key" :placeholder="translateLegacy('留空表示暂不配置')" />
        </label>
        <label>
          <span>{{ translateLegacy('首个模型') }}</span>
          <input :value="draft.model" :onInput="actions.draft.bind(null, 'model')" type="text" autocomplete="off" spellcheck="false" data-testid="custom-service-model" placeholder="例如：gpt-4.1-mini" :maxlength="maximumModelLength" :aria-invalid="Boolean(errors.model)" :onKeydown="withKeys(withModifiers(actions.close, ['stop']), ['esc'])" />
          <small v-if="errors.model" class="field-error" role="alert">{{ translateLegacy(errors.model) }}</small>
        </label>
      </template>
      <CompositeTranslationFields v-else :draft="compositeFormDraft" :members="members" :errors="compositeErrors" :active="active && ownedOpen && serviceType === 'composite'" :context="props.config || props.context" :show-name="false" :onUpdate="actions.composite" />
      <footer>
        <button type="button" class="secondary-button" :onClick="actions.close">{{ t('common.cancel') }}</button>
        <button type="submit" class="primary-button" data-testid="custom-service-save">{{ translateLegacy('保存服务') }}</button>
      </footer>
    </form>
  </el-dialog>
</template>
<script setup lang="ts">
import {computed, reactive, ref, watch, withKeys, withModifiers} from 'vue'
import {Config} from '@/src/core/config/model'
import {useUiI18n, localizeServiceOptions} from '@/src/ui/i18n'
import {useSettingsActionContext} from '../../model/useSettingsActionContext'
import {CUSTOM_OPENAI_RESERVED_MODEL_ID, MAX_CUSTOM_OPENAI_MODEL_LENGTH, MAX_CUSTOM_OPENAI_PROVIDER_ENDPOINT_LENGTH, MAX_CUSTOM_OPENAI_PROVIDER_NAME_LENGTH} from '@/src/core/config/customOpenAI'
import {createCompositeTranslationDraft, getCompositeMemberOptions, validateCompositeTranslationDraft, type CompositeTranslationDraft, type CompositeTranslationDraftErrors} from '@/src/ui/view-model/compositeServiceEditor'
import CompositeTranslationFields from './CompositeTranslationFields.vue'

interface CustomOpenAIProviderDraft {name: string; endpoint: string; apiKey: string; model: string}
type CustomServiceType = 'interface' | 'composite'
const props = withDefaults(defineProps<{modelValue: boolean; config?: Config; active?: boolean; context?: unknown; maximumNameLength?: number; maximumEndpointLength?: number; maximumModelLength?: number}>(), {active: true, maximumNameLength: MAX_CUSTOM_OPENAI_PROVIDER_NAME_LENGTH, maximumEndpointLength: MAX_CUSTOM_OPENAI_PROVIDER_ENDPOINT_LENGTH, maximumModelLength: MAX_CUSTOM_OPENAI_MODEL_LENGTH})
const emit = defineEmits<{'update:modelValue': [value: boolean]; submit: [draft: CustomOpenAIProviderDraft]; 'submit:composite': [draft: CompositeTranslationDraft]}>()
const {t, translateLegacy} = useUiI18n()
const nameInput = ref<HTMLInputElement | null>(null)
const draft = reactive<CustomOpenAIProviderDraft>({name: '', endpoint: '', apiKey: '', model: ''})
const compositeDraft = reactive(createCompositeTranslationDraft())
const compositeErrors = ref<CompositeTranslationDraftErrors>({})
const serviceType = ref<CustomServiceType>('interface')
const fallbackConfig = new Config()
const memberConfig = computed(() => props.config || fallbackConfig)
const members = computed(() => localizeServiceOptions(getCompositeMemberOptions(memberConfig.value), memberConfig.value.customOpenAIProviders, translateLegacy))
const compositeFormDraft = computed(() => ({...compositeDraft, name: draft.name}))
const ownedOpen = ref(props.modelValue)
const errors = reactive({name: '', endpoint: '', model: ''})
const nameError = computed(() => serviceType.value === 'composite' ? compositeErrors.value.name ? t(compositeErrors.value.name) : '' : translateLegacy(errors.name))
const {active, capture} = useSettingsActionContext(() => props.active !== false, () => [props.context, props.config, props.modelValue, serviceType.value])
const actions = computed(() => {
  const current = capture()
  return {
    close: () => {if (current()) closeDialog()},
    draft: (field: keyof CustomOpenAIProviderDraft, event: Event) => {
      if (!current() || !ownedOpen.value || (field !== 'name' && serviceType.value !== 'interface') || !(event.target instanceof HTMLInputElement)) return
      draft[field] = event.target.value
      if (field !== 'apiKey') errors[field] = ''
      if (field === 'name') compositeErrors.value = {...compositeErrors.value, name: undefined}
    },
    type: (value: CustomServiceType) => {
      if (!current() || !ownedOpen.value || !['interface', 'composite'].includes(value)) return
      serviceType.value = value
      errors.name = '';errors.endpoint = '';errors.model = '';compositeErrors.value = {}
    },
    composite: (patch: Partial<CompositeTranslationDraft>) => {if (current() && ownedOpen.value && serviceType.value === 'composite') {Object.assign(compositeDraft, patch);compositeErrors.value = {}}},
    focus: () => {if (current()) focusFirstField()},
    submit: () => {if (current()) submitProvider()},
    update: (open: boolean) => {if (current()) updateOpenState(open)},
  }
})
function resetDraft(): void {
  Object.assign(draft, {name: '', endpoint: '', apiKey: '', model: ''})
  Object.assign(compositeDraft, createCompositeTranslationDraft())
  errors.name = '';errors.endpoint = '';errors.model = '';compositeErrors.value = {};serviceType.value = 'interface'
}
function focusFirstField(): void {if (active.value && ownedOpen.value && props.modelValue) nameInput.value?.focus()}
function updateOpenState(value: boolean): void {if (active.value && ownedOpen.value && !value) closeDialog()}
function closeDialog(): void {const wasOpen = ownedOpen.value;ownedOpen.value = false;resetDraft();if (wasOpen) emit('update:modelValue', false)}
function isValidEndpoint(value: string): boolean {try {return ['http:', 'https:'].includes(new URL(value).protocol)} catch {return false}}
function submitProvider(): void {
  if (!active.value || !ownedOpen.value || !props.modelValue) return
  if (serviceType.value === 'composite') {
    const result = validateCompositeTranslationDraft(compositeFormDraft.value, members.value)
    compositeErrors.value = result.errors
    if (!result.valid) return
    closeDialog();emit('submit:composite', result.draft);return
  }
  const value: CustomOpenAIProviderDraft = {name: draft.name.trim(), endpoint: draft.endpoint.trim(), apiKey: draft.apiKey.trim(), model: draft.model.trim()}
  errors.name = !value.name ? '请输入服务名称' : value.name.length > props.maximumNameLength ? `服务名称最多 ${props.maximumNameLength} 个字符` : ''
  errors.endpoint = !value.endpoint ? '请输入接口地址' : value.endpoint.length > props.maximumEndpointLength ? `接口地址最多 ${props.maximumEndpointLength} 个字符` : isValidEndpoint(value.endpoint) ? '' : '请输入有效的 HTTP 或 HTTPS 地址'
  errors.model = !value.model ? '请输入至少一个模型' : value.model.length > props.maximumModelLength ? `模型标识最多 ${props.maximumModelLength} 个字符` : value.model === CUSTOM_OPENAI_RESERVED_MODEL_ID ? `“${CUSTOM_OPENAI_RESERVED_MODEL_ID}”是界面保留名称，请换一个模型标识` : ''
  if (errors.name || errors.endpoint || errors.model) return
  closeDialog();emit('submit', value)
}
watch(() => props.modelValue, open => {resetDraft();ownedOpen.value = open && active.value}, {flush: 'sync'})
watch(() => [active.value, props.context, props.config], () => closeDialog(), {flush: 'sync'})
</script>
<style scoped>
.custom-provider-form { display: grid; gap: 15px; color: var(--ink, #172033); }
.custom-provider-form > label { display: grid; gap: 6px; }
.custom-provider-form > label > span { font-size: 12px; font-weight: 600; }
.custom-provider-form > label > span small, .custom-provider-form > label > small { color: var(--muted, #8b93a4); font-size: 11px; font-weight: 400; line-height: 1.6; }
.custom-provider-form input { box-sizing: border-box; width: 100%; min-height: 38px; padding: 8px 10px; border: 1px solid var(--line, #dfe3eb); border-radius: 8px; color: inherit; background: var(--surface, #fff); font: inherit; font-size: 13px; }
.custom-provider-form input:focus-visible { outline: 2px solid var(--brand, #ef4776); outline-offset: 1px; }
.custom-provider-form input[aria-invalid='true'] { border-color: var(--el-color-danger, #d9345e); }
.custom-provider-form .field-error { color: var(--el-color-danger, #c52f58); }
.custom-service-types { display: inline-grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px; padding: 3px; width: fit-content; max-width: 100%; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-soft); }
.custom-service-types button { min-height: 32px; padding: 5px 14px; border: 0; border-radius: 7px; color: var(--muted); background: transparent; font: inherit; font-size: 12px; cursor: pointer; }
.custom-service-types button[aria-pressed='true'] { color: var(--brand-strong); background: var(--surface); box-shadow: 0 2px 6px rgba(31, 40, 61, .08); }
.custom-provider-form footer { display: flex; justify-content: flex-end; gap: 9px; padding-top: 2px; }
.custom-provider-form footer button { min-height: 36px; padding: 7px 14px; border-radius: 8px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.secondary-button { border: 1px solid var(--line); color: var(--muted); background: var(--surface); }
.primary-button { border: 1px solid var(--brand, #ef4776); color: #fff; background: var(--brand, #ef4776); }
</style>
