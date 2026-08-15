<template>
  <section class="service-catalog" aria-label="配置翻译服务与模型">
    <div class="catalog-layout">
      <aside class="service-rail" aria-label="翻译服务列表">
        <label class="catalog-search">
          <span aria-hidden="true">⌕</span>
          <input v-model.trim="serviceQuery" type="search" placeholder="搜索翻译服务" />
        </label>

        <div v-if="filteredGroups.length" class="service-groups">
          <section v-for="group in filteredGroups" :key="group.id" class="service-group">
            <div class="group-heading">
              <strong>{{ group.label }}</strong>
              <span>{{ group.items.length }} 项</span>
            </div>
            <button
              v-for="item in group.items"
              :key="item.value"
              type="button"
              class="service-item"
              :class="{ active: service === item.value }"
              :aria-pressed="service === item.value"
              @click="$emit('update:service', item.value)"
            >
              <ServiceIcon :service="item.value" :label="item.label" />
              <span class="service-copy">
                <strong>{{ item.label }}</strong>
                <small>{{ group.id === 'machine' ? '机器翻译' : 'AI 翻译' }}</small>
              </span>
              <span v-if="service === item.value" class="current-dot" title="默认服务"></span>
            </button>
          </section>
        </div>
        <p v-else class="catalog-empty">没有匹配的翻译服务</p>
      </aside>

      <section class="service-detail" aria-label="当前翻译服务详情">
        <div class="detail-hero">
          <ServiceIcon :service="service" :label="selectedService?.label" size="large" />
          <div>
            <div class="detail-title-row">
              <h4>{{ selectedService?.label || '尚未配置服务' }}</h4>
              <span class="active-badge">默认配置</span>
            </div>
          </div>
        </div>

        <div v-if="showModel" class="model-section">
          <div class="model-heading">
            <div>
              <span>模型列表</span>
              <strong>{{ selectedModel || '尚未选择模型' }}</strong>
            </div>
            <label v-if="modelOptions.length > commonModelCount" class="model-search">
              <span aria-hidden="true">⌕</span>
              <input v-model.trim="modelQuery" type="search" placeholder="搜索模型" />
            </label>
          </div>

          <div v-if="displayedModels.length" class="model-list">
            <div class="model-list-heading">
              <strong>{{ modelQuery ? '搜索结果' : moreModelsOpen ? '全部模型' : '常用模型' }}</strong>
              <span>{{ displayedModels.length }}</span>
            </div>
            <div id="model-options" class="model-grid" role="listbox" aria-label="可用模型">
              <button
                v-for="model in displayedModels"
                :key="model"
                type="button"
                class="model-item"
                :class="{ active: selectedModel === model, custom: model === customModelLabel }"
                role="option"
                :aria-selected="selectedModel === model"
                @click="$emit('update:model', model)"
              >
                <ServiceIcon :service="model === customModelLabel ? 'custom' : service" :label="model" size="model" />
                <span>
                  <strong>{{ model }}</strong>
                  <small>{{ model === customModelLabel ? '填写服务商支持的模型标识' : '使用此模型进行翻译' }}</small>
                </span>
                <span v-if="selectedModel === model" class="checkmark">✓</span>
              </button>
            </div>

            <button
              v-if="!modelQuery && moreModels.length"
              type="button"
              class="more-models-toggle"
              :aria-expanded="moreModelsOpen"
              aria-controls="model-options"
              @click="moreModelsOpen = !moreModelsOpen"
            >
              <span>
                <strong>更多模型</strong>
                <small>{{ moreModels.length }} 个较少使用的模型</small>
              </span>
              <b>{{ moreModelsOpen ? '收起' : '展开' }} <i aria-hidden="true">⌄</i></b>
            </button>
          </div>
          <p v-else class="catalog-empty">没有匹配的模型</p>
        </div>

        <div v-else class="no-model-panel">
          <span aria-hidden="true">✓</span>
          <div><strong>此服务无需模型配置</strong><p>机器翻译直接使用自身引擎。</p></div>
        </div>

        <div class="service-configuration-slot" aria-label="当前服务配置">
          <slot name="configuration" />
        </div>

      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ServiceIcon from '@/components/ServiceIcon.vue'
import { customModelString } from '@/entrypoints/utils/option'
import {
  buildServiceGroups,
  filterModels,
  filterServiceGroups,
  splitModelOptions,
  type ServiceOption,
} from '@/entrypoints/utils/serviceCatalog'

const props = defineProps<{
  service: string
  selectedModel?: string
  services: ServiceOption[]
  modelOptions: string[]
  showModel: boolean
}>()

defineEmits<{
  'update:service': [value: string]
  'update:model': [value: string]
}>()

const serviceQuery = ref('')
const modelQuery = ref('')
const moreModelsOpen = ref(false)
const commonModelCount = 4
const customModelLabel = customModelString

const groups = computed(() => buildServiceGroups(props.services))
const filteredGroups = computed(() => filterServiceGroups(groups.value, serviceQuery.value))
const filteredModels = computed(() => filterModels(props.modelOptions, modelQuery.value))
const modelGroups = computed(() => splitModelOptions(props.modelOptions, props.selectedModel, commonModelCount))
const moreModels = computed(() => modelGroups.value.more)
const displayedModels = computed(() => modelQuery.value
  ? filteredModels.value
  : moreModelsOpen.value ? [...modelGroups.value.common, ...moreModels.value] : modelGroups.value.common)
const selectedService = computed(() => groups.value.flatMap((group) => group.items).find((item) => item.value === props.service))

watch(() => props.service, () => {
  modelQuery.value = ''
  moreModelsOpen.value = false
})

watch(modelQuery, () => {
  moreModelsOpen.value = false
})

</script>

<style scoped>
.service-catalog { display: flex; height: clamp(520px, calc(100vh - 270px), 760px); min-height: 520px; margin: 2px 0 20px; border: 1px solid #e4e7ef; border-radius: 20px; overflow: hidden; background: #fff; flex-direction: column; }
.catalog-layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 0; flex: 1; overflow: hidden; }
.service-rail { min-height: 0; padding: 16px 12px 18px; border-right: 1px solid #eceef3; background: #fafbfc; overflow-y: auto; }
.catalog-search, .model-search { display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 11px; border: 1px solid #dfe3eb; border-radius: 11px; background: #fff; }
.catalog-search span, .model-search span { color: #8991a2; font-size: 16px; }
.catalog-search input, .model-search input { width: 100%; min-width: 0; border: 0; outline: 0; color: #172033; background: transparent; font-size: 13px; }
.service-groups { display: grid; gap: 18px; margin-top: 17px; }
.group-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px; padding: 8px 9px; border-bottom: 1px solid #e5e8ef; color: #667187; background: #f3f5f9; }
.group-heading strong { color: #46526a; font-size: 12px; letter-spacing: .05em; }
.group-heading span { font-size: 10px; }
.service-group { min-width: 0; }
.service-item { display: grid; grid-template-columns: 40px minmax(0, 1fr) 8px; align-items: center; gap: 10px; width: 100%; padding: 10px; border: 1px solid transparent; border-radius: 12px; color: #172033; background: transparent; text-align: left; cursor: pointer; transition: 150ms ease; }
.service-item:hover { border-color: #e2e5ec; background: #fff; transform: translateX(2px); }
.service-item.active { border-color: #f3c4d1; background: #fff0f4; box-shadow: 0 7px 18px rgba(214, 50, 96, .08); }
.service-copy { display: flex; min-width: 0; flex-direction: column; }
.service-copy strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.service-copy small { margin-top: 3px; color: #9097a7; font-size: 10px; }
.current-dot { width: 7px; height: 7px; border-radius: 50%; background: #ef4776; box-shadow: 0 0 0 4px rgba(239, 71, 118, .12); }
.service-detail { display: flex; min-width: 0; min-height: 0; margin: 14px; padding: 22px; border: 1px solid #e4e7ef; border-radius: 16px; background: #fff; flex-direction: column; overflow: hidden; }
.service-detail > .detail-hero,
.service-detail > .model-section,
.service-detail > .no-model-panel,
.service-detail > .service-configuration-slot { width: min(100%, 1080px); }
.detail-hero { display: flex; align-items: flex-start; gap: 13px; padding-bottom: 20px; border-bottom: 1px solid #eceef3; }
.detail-hero > div:last-child { min-width: 0; }
.detail-title-row { display: flex; align-items: center; gap: 9px; }
.detail-title-row h4 { margin: 1px 0 5px; color: #172033; font-size: 22px; }
.active-badge { padding: 4px 8px; border-radius: 999px; color: #bd2853; background: #ffe9ef; font-size: 10px; font-weight: 800; }
.detail-hero p { margin: 0; color: #737c8f; font-size: 13px; line-height: 1.6; }
.model-section { display: flex; min-height: 0; margin-top: 20px; flex: 0 0 auto; flex-direction: column; }
.model-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 15px; margin-bottom: 12px; }
.model-heading > div { display: flex; min-width: 0; flex-direction: column; }
.model-heading span { color: #81899a; font-size: 11px; font-weight: 750; }
.model-heading strong { overflow: hidden; margin-top: 3px; color: #172033; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.model-search { width: 168px; height: 34px; }
.model-list { display: flex; min-height: 0; flex: 1; flex-direction: column; }
.model-list-heading { display: flex; align-items: center; justify-content: space-between; margin: 0 2px 8px; color: #81899a; flex: 0 0 auto; }
.model-list-heading strong { font-size: 12px; }
.model-list-heading span { font-size: 11px; }
.model-grid { display: grid; min-height: 0; max-height: 246px; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; align-content: start; overflow-y: auto; padding: 1px 4px 4px 1px; }
.model-item { display: grid; grid-template-columns: 30px minmax(0, 1fr) 16px; align-items: center; gap: 9px; min-width: 0; padding: 10px; border: 1px solid #e4e7ee; border-radius: 12px; color: #172033; background: #fff; text-align: left; cursor: pointer; transition: 150ms ease; }
.model-item:hover { border-color: #f0a9bc; transform: translateY(-1px); }
.model-item.active { border-color: #ef4776; background: #fff4f7; box-shadow: 0 7px 16px rgba(214, 50, 96, .08); }
.model-item > span:nth-child(2) { display: flex; min-width: 0; flex-direction: column; }
.model-item strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.model-item small { overflow: hidden; margin-top: 3px; color: #9299a8; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.checkmark { color: #da315f; font-size: 12px; font-weight: 900; }
.more-models-toggle { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 12px; width: 100%; margin-top: 10px; padding: 11px 12px; border: 1px solid #e4e7ee; border-radius: 12px; color: #172033; background: #fafbfc; text-align: left; cursor: pointer; }
.more-models-toggle:hover { border-color: #f0a9bc; background: #fff8fa; }
.more-models-toggle > span { display: flex; flex-direction: column; }
.more-models-toggle strong { font-size: 10px; }
.more-models-toggle small { margin-top: 2px; color: #9299a8; font-size: 8px; }
.more-models-toggle b { color: #c72a56; font-size: 9px; font-weight: 750; white-space: nowrap; }
.more-models-toggle i { display: inline-block; margin-left: 3px; font-style: normal; transition: transform 150ms ease; }
.more-models-toggle[aria-expanded="true"] i { transform: rotate(180deg); }
.no-model-panel { display: flex; align-items: center; gap: 12px; margin-top: 20px; padding: 18px; border: 1px solid #d9eee5; border-radius: 14px; background: #f2faf6; }
.no-model-panel > span { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; color: #fff; background: #28aa79; font-size: 14px; }
.no-model-panel strong { color: #185d46; font-size: 15px; }
.no-model-panel p { margin: 4px 0 0; color: #628074; font-size: 12px; }
.service-configuration-slot { min-height: 0; margin-top: 20px; padding-top: 20px; border-top: 1px solid #eceef3; overflow-y: auto; flex: 1; }
.catalog-empty { margin: 20px 8px; color: #9299a8; font-size: 10px; text-align: center; }
@media (max-width: 900px) {
  .catalog-layout { grid-template-columns: 220px minmax(0, 1fr); }
  .model-grid { grid-template-columns: 1fr; }
}
@media (max-width: 700px) {
  .service-catalog { height: auto; min-height: 0; }
  .catalog-layout { display: block; flex: 0 0 auto; }
  .service-rail { border-right: 0; border-bottom: 1px solid #eceef3; }
  .service-groups { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .service-detail { padding: 18px; }
  .model-heading { align-items: stretch; flex-direction: column; }
  .model-search { width: 100%; }
  .service-detail { min-height: 520px; margin: 0; padding: 18px; border: 0; border-radius: 0; overflow: visible; }
  .model-grid { max-height: 400px; }
  .service-configuration-slot { max-height: none; overflow: visible; }
}
</style>
