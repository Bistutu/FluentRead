<!--
 * @file src/features/settings/ui/services/ServiceNatureBadge.vue
 * 文件职责：使用共享服务标签样式展示接口性质徽章。
 * 主要内容：为 DeepLX 提供本地化的免费非官方标记，为 B站独立入口与免费聚合项展示免费标记，为用户组合展示组合标记；这些中性标签与默认、已保存等状态保持同一尺寸，供目录、详情标题和免费服务卡片共用。
 * 模块边界：仅展示已知服务的性质，不判断连接状态、费用或修改配置。
 -->
<template>
  <span v-if="service === 'deeplx'" class="service-badge service-nature-badge" :data-service-nature-badge="service" :title="t('settings.services.library.freeUnofficial')">{{ t('settings.services.library.freeUnofficial') }}</span>
  <span v-else-if="service === 'bilibili' || service === 'bilibiliFree'" class="service-badge service-nature-badge" :data-service-nature-badge="service" :title="translateLegacy('免费')">{{ translateLegacy('免费') }}</span>
  <span v-else-if="isCompositeTranslationProviderId(service)" class="service-badge service-nature-badge" :data-service-nature-badge="service" :title="t('settings.services.composite.badge')">{{ t('settings.services.composite.badge') }}</span>
</template>
<script setup lang="ts">
import './service-badges.css'
import { useUiI18n } from '@/src/ui/i18n'
import {isCompositeTranslationProviderId} from '@/src/core/config/compositeTranslation'
defineProps<{ service: string }>()
const { t, translateLegacy } = useUiI18n()
</script>
