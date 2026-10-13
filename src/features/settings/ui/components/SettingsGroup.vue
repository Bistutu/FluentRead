<!--
@file src/features/settings/ui/components/SettingsGroup.vue
文件职责：建立设置页面的二级分组容器，用清晰的标题、说明和单层细边框区分相关配置而不重复页面级介绍。
主要内容：将可选标题、说明与设置项包入无阴影的统一圆角边框，用带品牌标记的浅底标题栏区分分组，较大的标题、可选辅助插槽与小字说明横向排列并自然换行；统一处理组内设置行的分隔，并适配主题与窄屏。
模块边界：本组件是无业务状态的布局壳，不解释配置、不读写 store，也不决定导航分类；具体字段及控件由调用页面和 SettingsItem 提供。
-->
<template>
  <section class="settings-group">
    <header v-if="title || description" class="settings-group-heading settings-card-heading">
      <h2 v-if="title">{{ title }}</h2>
      <slot name="heading-extra" />
      <p v-if="description">{{ description }}</p>
    </header>
    <div class="settings-group-body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import './settings-card-heading.css'
defineProps<{
  title?: string
  description?: string
}>()
</script>

<style scoped>
.settings-group {
  box-sizing: border-box;
  width: min(100%, 1080px);
  min-width: 0;
  margin: 0 auto 24px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: none;
}

.settings-group-heading {
  margin: 0;
  padding: 12px 20px;
  border-bottom: 1px solid var(--line);
  border-radius: 11px 11px 0 0;
}

.settings-group-body {
  overflow: hidden;
  border-radius: 11px;
  background: transparent;
}

.settings-group-heading + .settings-group-body {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

.settings-group-body :deep(.el-row) {
  min-height: 60px !important;
  margin: 0 !important;
  padding: 14px 20px !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

.settings-group-body :deep(:is(.settings-item, .el-row) + :is(.settings-item, .el-row)) {
  border-top: 1px solid var(--line) !important;
}

.settings-group-body :deep(.el-row:hover) {
  background: transparent !important;
  transform: none !important;
}

@media (max-width: 700px) {
  .settings-group { margin-bottom: 14px; }
  .settings-group-heading { padding: 11px 20px; }
}
</style>
