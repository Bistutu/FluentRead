<!--
 * @file src/features/settings/ui/services/CompositeTranslationFields.vue
 * 文件职责：渲染组合翻译服务的共用草稿表单，提供命名、普通服务选择、顺序调整、移除和策略设置。
 * 主要内容：用可访问的原生输入展示三种故障转移策略及逐路超时，候选排除已选成员，操作捕获当前草稿与成员目录身份。
 * 模块边界：只发出草稿补丁，不写配置、不复制模型或密钥、不发起请求；创建对话框和已有服务编辑器分别负责校验与保存。
 -->
<template>
  <div class="composite-fields" data-composite-fields>
    <label class="composite-field">
      <strong>{{ t('settings.services.composite.name') }}</strong>
      <input :value="draft.name" :disabled="!active" :maxlength="MAX_COMPOSITE_SERVICE_NAME_LENGTH" :aria-label="t('settings.services.composite.name')" :placeholder="t('settings.services.composite.namePlaceholder')" :aria-invalid="Boolean(errors.name)" data-testid="composite-service-name" :onInput="actions.name" />
      <small v-if="errors.name" class="field-error" role="alert">{{ t(errors.name) }}</small>
    </label>
    <fieldset class="composite-members">
      <legend>{{ t('settings.services.composite.members') }}</legend>
      <p class="field-help">{{ t('settings.services.composite.membersHelp') }}</p>
      <ol v-if="draft.services.length" class="composite-member-list">
        <li v-for="(service, index) in draft.services" :key="service" :data-composite-member="service">
          <span class="member-number">{{ index + 1 }}</span>
          <span class="member-name">{{ memberLabel(service) }}</span>
          <div class="member-actions">
            <button type="button" :disabled="!active || index === 0" :aria-label="t('settings.services.composite.moveUp', {service: memberLabel(service)})" :onClick="actions.move.bind(null, service, -1)">↑</button>
            <button type="button" :disabled="!active || index === draft.services.length - 1" :aria-label="t('settings.services.composite.moveDown', {service: memberLabel(service)})" :onClick="actions.move.bind(null, service, 1)">↓</button>
            <button type="button" :disabled="!active" :aria-label="t('settings.services.composite.removeMember', {service: memberLabel(service)})" :onClick="actions.remove.bind(null, service)">×</button>
          </div>
        </li>
      </ol>
      <p v-else class="field-help" data-composite-empty role="status">{{ t('settings.services.composite.empty') }}</p>
      <div class="member-add">
        <select :value="selectedMember" :disabled="!active || !availableMembers.length" :aria-label="t('settings.services.composite.selectMember')" data-testid="composite-member-select" :onChange="actions.selectMember">
          <option value="">{{ t('settings.services.composite.selectMember') }}</option>
          <option v-for="member in availableMembers" :key="member.value" :value="member.value">{{ member.label }}</option>
        </select>
        <button type="button" :disabled="!active || !selectedMember" data-testid="composite-member-add" :onClick="actions.add">{{ t('settings.services.composite.addMember') }}</button>
      </div>
      <small v-if="errors.services" class="field-error" role="alert">{{ t(errors.services) }}</small>
    </fieldset>
    <fieldset class="composite-strategies">
      <legend>{{ t('settings.services.composite.strategy') }}</legend>
      <label v-for="strategy in strategies" :key="strategy" :class="{'is-selected': draft.strategy === strategy}">
        <input type="radio" :name="strategyRadioName" :value="strategy" :checked="draft.strategy === strategy" :disabled="!active" :onChange="actions.strategy.bind(null, strategy)" />
        <span><strong>{{ t(`settings.services.composite.${strategy}`) }}</strong><small>{{ t(`settings.services.composite.${strategy}Help`) }}</small></span>
      </label>
    </fieldset>
    <label class="composite-field timeout-field">
      <strong>{{ t('settings.services.composite.timeout') }}</strong>
      <input type="number" :value="draft.timeoutMs / 1000" min="1" max="45" step="1" :disabled="!active" :aria-label="t('settings.services.composite.timeout')" :aria-invalid="Boolean(errors.timeoutMs)" data-testid="composite-member-timeout" :onInput="actions.timeout" />
      <small class="field-help">{{ t('settings.services.composite.timeoutHelp') }}</small>
      <small v-if="errors.timeoutMs" class="field-error" role="alert">{{ t(errors.timeoutMs) }}</small>
    </label>
    <p class="shared-config-help">{{ t('settings.services.composite.sharedConfig') }}</p>
  </div>
</template>
<script setup lang="ts">
import {computed, ref, useId} from 'vue'
import type {CompositeTranslationStrategy} from '@/src/core/config/compositeTranslation'
import {useUiI18n} from '@/src/ui/i18n'
import {MAX_COMPOSITE_SERVICE_NAME_LENGTH, type CompositeTranslationDraft, type CompositeTranslationDraftErrors} from '@/src/ui/view-model/compositeServiceEditor'
import type {ServiceOption} from '@/src/ui/view-model/serviceCatalog'
import {useSettingsActionContext} from '../../model/useSettingsActionContext'

const props = withDefaults(defineProps<{draft: CompositeTranslationDraft; members: ServiceOption[]; errors?: CompositeTranslationDraftErrors; active?: boolean; context?: unknown}>(), {active: true, errors: () => ({})})
const emit = defineEmits<{update: [patch: Partial<CompositeTranslationDraft>]}>()
const {t} = useUiI18n()
const selectedMember = ref('')
const strategies: CompositeTranslationStrategy[] = ['sequential', 'random', 'smart']
const strategyRadioName = useId()
const availableMembers = computed(() => props.members.filter(member => !props.draft.services.includes(member.value)))
const memberNames = computed(() => new Map(props.members.map(member => [member.value, member.label])))
const memberLabel = (service: string) => memberNames.value.get(service) || service
const {active, capture} = useSettingsActionContext(() => props.active, () => [props.context, props.draft, props.members, props.draft.services.join('\0')])
function inputValue(event: Event): string {return (event.currentTarget as HTMLInputElement | null)?.value || ''}
const actions = computed(() => {
  const current = capture()
  return {
    name: (event: Event) => {if (current()) emit('update', {name: inputValue(event)})},
    timeout: (event: Event) => {if (current()) emit('update', {timeoutMs: inputValue(event).trim() ? Number(inputValue(event)) * 1000 : NaN})},
    selectMember: (event: Event) => {if (current()) selectedMember.value = inputValue(event)},
    strategy: (strategy: CompositeTranslationStrategy) => {if (current()) emit('update', {strategy})},
    add: () => {
      if (!current() || !availableMembers.value.some(member => member.value === selectedMember.value)) return
      emit('update', {services: [...props.draft.services, selectedMember.value]})
      selectedMember.value = ''
    },
    move: (service: string, direction: number) => {
      if (!current()) return
      const services = [...props.draft.services], index = services.indexOf(service), target = index + direction
      if (index < 0 || target < 0 || target >= services.length) return
      ;[services[index], services[target]] = [services[target], services[index]]
      emit('update', {services})
    },
    remove: (service: string) => {if (current()) emit('update', {services: props.draft.services.filter(member => member !== service)})},
  }
})
</script>
<style scoped>
.composite-fields { display: grid; gap: 18px; min-width: 0; color: var(--ink, #172033); }
.composite-field { display: grid; gap: 7px; }
.composite-field > strong, legend { font-size: 13px; font-weight: 650; }
fieldset { display: grid; gap: 8px; min-width: 0; margin: 0; padding: 0; border: 0; }
legend { margin-bottom: 8px; }
input:not([type='radio']), select { box-sizing: border-box; width: 100%; min-width: 0; min-height: 40px; padding: 8px 11px; border: 1px solid var(--line, #dfe3eb); border-radius: 9px; background: var(--surface, #fff); color: inherit; font: inherit; font-size: 13px; }
input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--brand, #ef4776); outline-offset: 2px; }
input[aria-invalid='true'] { border-color: var(--el-color-danger, #d9345e); }
.field-help, .shared-config-help { margin: 0; color: var(--muted, #737c8f); font-size: 12px; line-height: 1.7; }
.field-error { color: var(--el-color-danger, #c52f58); font-size: 12px; }
.composite-member-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.composite-member-list li { display: flex; align-items: center; gap: 9px; min-width: 0; min-height: 44px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface-soft, #f7f8fb); }
.member-number { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.member-name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
.member-actions { display: flex; flex: none; gap: 4px; }
button { min-height: 36px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
button:disabled, input:disabled, select:disabled { opacity: .5; cursor: default; }
.member-actions button { min-width: 36px; }
.member-add { display: flex; gap: 8px; }
.member-add button { flex: none; }
.composite-strategies label { display: flex; align-items: flex-start; gap: 9px; padding: 10px 11px; border: 1px solid var(--line); border-radius: 9px; cursor: pointer; }
.composite-strategies label.is-selected { border-color: var(--brand-border); background: var(--brand-soft); }
.composite-strategies input { margin: 3px 0 0; accent-color: var(--brand, #ef4776); }
.composite-strategies span { display: grid; gap: 3px; }
.composite-strategies strong { font-size: 13px; font-weight: 650; }
.composite-strategies small { color: var(--muted); font-size: 12px; line-height: 1.6; }
.timeout-field input { max-width: 130px; }
.shared-config-help { padding: 10px 12px; border-radius: 9px; background: var(--surface-soft); }
</style>
