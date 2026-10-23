<!--
@file src/features/settings/ui/components/SettingsItem.vue
文件职责：统一单条设置的标签、辅助说明和操作控件布局，使长配置页面保持清晰的阅读节奏与对齐关系。
主要内容：支持常规双列和 stacked 单列模式、禁用视觉状态、可整体替换的文案区、可单独替换的说明行与控制区插槽；行间距消费共用卡片 token，长文案与多控件自然换行，窄屏输入控件转为纵向，独立开关仍与标签同行；补充说明可通过 help 收进标签旁的提示图标，不占用常驻版面。
模块边界：本组件只处理展示和插槽排版，不拥有字段值、不触发持久化；只有独立开关行将文案区点击转发给原控件，其禁用与键盘行为仍由原控件处理。
-->
<template>
  <div class="settings-item" :class="{ stacked, disabled }" @click="toggleSimpleSwitch">
    <div class="settings-item-copy">
      <slot name="copy">
        <strong class="settings-item-label"><span>{{ label }}</span><FieldHelp v-if="help" :content="help" /></strong>
        <slot name="description"><small v-if="description">{{ description }}</small></slot>
      </slot>
    </div>
    <div class="settings-item-control">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import FieldHelp from './FieldHelp.vue'

function toggleSimpleSwitch(event: MouseEvent): void {
  if (props.disabled || !(event.target instanceof Element)) return
  const target = event.target
  if (target.closest('button, a, input, select, textarea, .el-switch, [role="button"]') || window.getSelection()?.toString()) return
  const row = event.currentTarget as HTMLElement
  const control = row.querySelector<HTMLElement>(':scope > .settings-item-control > .el-switch:not(.is-disabled)')
  control?.click()
}

const props = withDefaults(defineProps<{
  label: string
  description?: string
  help?: string
  stacked?: boolean
  disabled?: boolean
}>(), {
  description: '',
  help: '',
  stacked: false,
  disabled: false,
})
</script>

<style scoped>
.settings-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(200px, 320px);
  align-items: center;
  gap: var(--fr-settings-row-gap, 24px);
  min-height: var(--fr-settings-row-min-height, 66px);
  padding: var(--fr-settings-row-padding-block, 14px) var(--fr-card-padding-inline, 20px);
  transition: background 150ms ease;
}

.settings-item:hover { background: transparent; }
.settings-item.disabled { opacity: .58; }

.settings-item-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
  overflow-wrap: anywhere;
}

.settings-item-copy :deep(strong) {
  color: var(--ink);
  font-size: 13px;
  font-weight: 550;
  line-height: 1.45;
}

/* 自定义文案插槽也可复用标签行样式，因此从文案区向下穿透匹配。 */
.settings-item-copy :deep(.settings-item-label) {
  display: flex;
  align-items: center;
  gap: 2px;
}

/* 提示图标的点击区大于文字行高，用负外边距避免把带提示的行撑高。 */
.settings-item-copy :deep(.settings-item-label .field-help) { margin: -3px 0; }

.settings-item-copy :deep(small) {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}

.settings-item-control {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.settings-item-control :deep(.el-select),
.settings-item-control :deep(.el-input),
.settings-item-control :deep(.el-input-number),
.settings-item-control :deep(.hotkey-config) {
  width: 100%;
  max-width: 360px;
}

.settings-item.stacked {
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  gap: 12px;
}

.settings-item.stacked .settings-item-control {
  justify-content: stretch;
}

.settings-item.stacked .settings-item-control > :deep(*) {
  width: 100%;
  max-width: none;
}

@media (max-width: 700px) {
  .settings-item {
    grid-template-columns: minmax(0, 1fr) minmax(170px, 44%);
    gap: 14px;
    min-height: var(--fr-settings-row-min-height, 62px);
    padding: var(--fr-settings-row-padding-block, 12px) var(--fr-card-padding-inline, 16px);
  }
}

@media (max-width: 480px) {
  .settings-item {
    grid-template-columns: minmax(0, 1fr);
    align-items: stretch;
    gap: 9px;
  }

  .settings-item-control { justify-content: stretch; }
  .settings-item-control :deep(.el-select),
  .settings-item-control :deep(.el-input),
  .settings-item-control :deep(.el-input-number),
  .settings-item-control :deep(.hotkey-config) { max-width: none; }

  .settings-item:not(.stacked):has(> .settings-item-control > .el-switch) {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
  }
  .settings-item:not(.stacked):has(> .settings-item-control > .el-switch) .settings-item-control { justify-content: flex-end; }
}

@media (prefers-reduced-motion: reduce) {
  .settings-item { transition: none; }
}
</style>
