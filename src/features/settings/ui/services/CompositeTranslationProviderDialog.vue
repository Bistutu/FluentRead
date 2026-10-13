<!--
 * @file src/features/settings/ui/services/CompositeTranslationProviderDialog.vue
 * 文件职责：提供从现有翻译服务创建组合服务的对话框。
 * 主要内容：打开时重置草稿，复用成员表单和校验，至少选择两项普通服务；关闭、停用、配置替换和重开时使旧回调失效。
 * 模块边界：提交不含凭据的草稿，由 SettingsSections 分配稳定 ID 并持久化；不直接保存、不发起翻译或连接测试。
 -->
<template>
  <el-dialog :key="revision" :model-value="ownedOpen && active" :onUpdate:modelValue="actions.open" :title="t('settings.services.composite.title')" width="min(620px, calc(100vw - 32px))" append-to-body destroy-on-close>
    <form class="composite-provider-form" :onSubmit="withModifiers(actions.submit, ['prevent'])">
      <CompositeTranslationFields :draft="draft" :members="members" :errors="errors" :active="active && ownedOpen" :context="props.context" :onUpdate="actions.update" />
      <footer>
        <button type="button" :onClick="actions.close">{{ t('common.cancel') }}</button>
        <button type="submit" class="is-primary" data-testid="composite-service-save">{{ t('settings.services.composite.save') }}</button>
      </footer>
    </form>
  </el-dialog>
</template>
<script setup lang="ts">
import {computed, reactive, ref, watch, withModifiers} from 'vue'
import type {Config} from '@/src/core/config/model'
import {useUiI18n, localizeServiceOptions} from '@/src/ui/i18n'
import {createCompositeTranslationDraft, getCompositeMemberOptions, validateCompositeTranslationDraft, type CompositeTranslationDraft, type CompositeTranslationDraftErrors} from '@/src/ui/view-model/compositeServiceEditor'
import {useSettingsActionContext} from '../../model/useSettingsActionContext'
import CompositeTranslationFields from './CompositeTranslationFields.vue'

const props = withDefaults(defineProps<{modelValue: boolean; config: Config; active?: boolean; context?: unknown}>(), {active: true})
const emit = defineEmits<{'update:modelValue': [value: boolean]; submit: [draft: CompositeTranslationDraft]}>()
const {t, translateLegacy} = useUiI18n()
const members = computed(() => localizeServiceOptions(getCompositeMemberOptions(props.config), props.config.customOpenAIProviders, translateLegacy))
const draft = reactive(createCompositeTranslationDraft())
const errors = ref<CompositeTranslationDraftErrors>({})
const ownedOpen = ref(props.modelValue)
const {active, capture, revision} = useSettingsActionContext(() => props.active, () => [props.context, props.config, props.modelValue])
function reset() {Object.assign(draft, createCompositeTranslationDraft());errors.value = {}}
function close() {const wasOpen = ownedOpen.value;ownedOpen.value = false;reset();if (wasOpen) emit('update:modelValue', false)}
const actions = computed(() => {
  const current = capture()
  return {
    close: () => {if (current()) close()},
    open: (open: boolean) => {if (current() && !open) close()},
    update: (patch: Partial<CompositeTranslationDraft>) => {if (current() && ownedOpen.value) {Object.assign(draft, patch);errors.value = {}}},
    submit: () => {
      if (!current() || !ownedOpen.value || !props.modelValue) return
      const result = validateCompositeTranslationDraft(draft, members.value)
      errors.value = result.errors
      if (!result.valid) return
      close()
      emit('submit', result.draft)
    },
  }
})
watch(() => props.modelValue, open => {reset();ownedOpen.value = open && active.value}, {flush: 'sync'})
watch(() => [active.value, props.context, props.config], () => close(), {flush: 'sync'})
</script>
<style scoped>
.composite-provider-form { display: grid; gap: 18px; }
footer { display: flex; justify-content: flex-end; gap: 9px; }
button { min-height: 38px; padding: 8px 14px; border: 1px solid var(--line, #dfe3eb); border-radius: 9px; color: var(--ink, #172033); background: var(--surface, #fff); font: inherit; font-size: 13px; cursor: pointer; }
button.is-primary { border-color: var(--brand, #ef4776); color: white; background: var(--brand, #ef4776); }
</style>
