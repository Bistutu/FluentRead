<!--
 * @file src/features/settings/ui/TranslationLoadingStyleSettings.vue
 * 文件职责：用一个样式选择器控制界面动画，让用户在“界面风格”页面比较预设或选择末尾“无”关闭动态效果。
 * 主要内容：用单层标题和说明引出 15 种运行时预览及独立静态选项，原生单选控件支持关闭后直接选择任意样式恢复动画。
 * 模块边界：本组件只修改父级传入的 Config 字段，不持久化配置、不创建网页内加载指示器，也不决定运行时动画调度策略。
-->
<template>
  <SettingsGroup
    :title="t('settings.advanced.translationLoadingStyle')"
    :description="t('settings.interface.animationLoading.description')"
  >
    <div class="loading-style-settings">
      <div
        class="loading-style-picker"
        role="radiogroup"
        :aria-label="t('settings.advanced.translationLoadingStyleAria')"
      >
        <label
          v-for="option in translationLoadingStyleChoices"
          :key="option.value"
          class="loading-style-option"
          :class="{
            selected: selectedStyle === option.value,
            'is-none': option.value === 'none',
          }"
          :data-loading-style-choice="option.value"
        >
          <input
            v-model="selectedStyle"
            class="loading-style-radio"
            type="radio"
            name="translation-loading-style"
            :value="option.value"
            :aria-label="t('settings.advanced.translationLoadingStyleOptionAria', {
              label: t(option.labelKey),
              description: t(option.descriptionKey),
            })"
          >

          <span
            class="loading-style-preview"
            aria-hidden="true"
          >
            <i class="loading-style-preview-line" />
            <TranslationLoadingPreview
              v-if="option.value !== 'none'"
              :loading-style="option.value"
              :animated="props.config.animations"
            />
          </span>

          <span class="loading-style-copy">
            <strong>{{ t(option.labelKey) }}<span v-if="option.value === 'none'" class="loading-style-static-badge">{{ t('settings.advanced.translationLoadingStyle.none.badge') }}</span></strong>
            <small>{{ t(option.descriptionKey) }}</small>
          </span>

          <span class="loading-style-check" aria-hidden="true"><i /></span>
        </label>
      </div>
    </div>
  </SettingsGroup>
</template>

<script lang="ts" setup>
import type { Config } from '@/src/core/config/model'
import { computed } from 'vue'
import { applyTranslationLoadingStyleChoice, getTranslationLoadingStyleChoice, translationLoadingStyleChoices } from '@/src/core/config/translationLoadingStyle'
import TranslationLoadingPreview from '@/src/ui/components/TranslationLoadingPreview.vue'
import { useUiI18n } from '@/src/ui/i18n'
import SettingsGroup from './components/SettingsGroup.vue'

const props = defineProps<{
  config: Config
}>()
const { t } = useUiI18n()
const selectedStyle = computed({
  get: () => getTranslationLoadingStyleChoice(props.config),
  set: value => applyTranslationLoadingStyleChoice(props.config, value),
})
</script>

<style scoped>
.loading-style-settings {
  padding: 16px 20px;
}

.loading-style-picker {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 156px), 1fr));
  width: 100%;
  gap: 8px;
}

.loading-style-option {
  position: relative;
  display: grid;
  grid-template-rows: 44px auto;
  gap: 8px;
  min-width: 0;
  min-height: 112px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink);
  background: var(--surface);
  cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
}

.loading-style-option:hover {
  border-color: rgba(239, 71, 118, .38);
  background: var(--surface-soft);
}

.loading-style-option.selected {
  border-color: var(--brand);
  background: var(--brand-soft);
  box-shadow: 0 0 0 2px rgba(239, 71, 118, .08);
}

.loading-style-option.is-none:not(.selected) {
  border-style: dashed;
  border-color: var(--muted);
}

.loading-style-static-badge {
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--muted);
  background: var(--surface-soft);
  font-size: 9px;
  font-weight: 400;
}

.loading-style-radio {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  border: 0;
  white-space: nowrap;
}

.loading-style-radio:focus-visible ~ .loading-style-preview {
  outline: 2px solid rgba(239, 71, 118, .34);
  outline-offset: 2px;
}

.loading-style-preview {
  position: relative;
  display: flex;
  width: 100%;
  height: 44px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-soft);
}

.loading-style-preview-line {
  display: block;
  width: 30px;
  height: 3px;
  margin-right: 1px;
  border-radius: 999px;
  background: var(--muted);
  opacity: .34;
}

.loading-style-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
  padding-right: 15px;
}

.loading-style-copy strong {
  font-size: 11.5px;
  line-height: 1.35;
}

.loading-style-copy small {
  color: var(--muted);
  font-size: 9px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.loading-style-check {
  position: absolute;
  right: 9px;
  bottom: 10px;
  display: grid;
  width: 13px;
  height: 13px;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
}

.loading-style-option.selected .loading-style-check {
  border-color: var(--brand);
  background: var(--brand);
}

.loading-style-check > i {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: #fff;
  opacity: 0;
}

.loading-style-option.selected .loading-style-check > i {
  opacity: 1;
}

@media (max-width: 700px) {
  .loading-style-settings {
    padding: 11px 12px;
  }
}

@media (max-width: 480px) {
  .loading-style-picker {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 340px) {
  .loading-style-picker {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
