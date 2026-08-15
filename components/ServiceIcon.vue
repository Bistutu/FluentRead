<template>
  <span class="service-brand-icon" :class="[`service-brand-icon--${size}`, `service-brand-icon--${tone}`]" :title="label" aria-hidden="true">
    <svg v-if="service === 'microsoft'" viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/></svg>
    <svg v-else-if="service === 'google'" viewBox="0 0 24 24"><text x="12" y="17" text-anchor="middle">G</text></svg>
    <svg v-else-if="service === 'chromeTranslator'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4h8M5 8l4 7M19 8l-4 7"/></svg>
    <svg v-else-if="service === 'openai' || service === 'azureOpenai'" viewBox="0 0 24 24"><path d="M12 4.2a3.4 3.4 0 0 1 5.8 2.4 3.4 3.4 0 0 1 1.9 5.8 3.4 3.4 0 0 1-3.4 5.2 3.4 3.4 0 0 1-5.8 2.2 3.4 3.4 0 0 1-5.8-2.4 3.4 3.4 0 0 1-1.9-5.8A3.4 3.4 0 0 1 6.2 6.4 3.4 3.4 0 0 1 12 4.2Z"/><path d="m8.2 8.5 7.5 4.3M15.8 8.5l-7.5 4.3M12 6v8.7M12 18v-2.2"/></svg>
    <svg v-else-if="service === 'gemini'" viewBox="0 0 24 24"><path d="m12 2 2.1 7.9L22 12l-7.9 2.1L12 22l-2.1-7.9L2 12l7.9-2.1L12 2Z"/></svg>
    <svg v-else-if="service === 'claude'" viewBox="0 0 24 24"><path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9 4.9 19.1"/><circle cx="12" cy="12" r="2.4"/></svg>
    <svg v-else-if="service === 'deepseek'" viewBox="0 0 24 24"><path d="M4 15.2c2.6 3.6 7.8 5.1 12 2.5 2.3-1.4 3.4-3.7 3.1-5.8-.3-2.3-2.2-4-4.5-4.2-1.7-.2-3.2.5-4.2 1.8 1.7-.4 3.4.1 4.4 1.3-2.2-.8-4.7-.2-6.1 1.8-.8 1-2.5 1.7-4.7 2.6Z"/><circle cx="15.8" cy="10.6" r=".8"/></svg>
    <svg v-else-if="service === 'deepL' || service === 'deeplx'" viewBox="0 0 24 24"><path d="M5 4h9.2a5.8 5.8 0 0 1 0 11.6H9.8L5 20V4Z"/><path d="M9 8h5M9 11h4"/></svg>
    <svg v-else-if="service === 'grok'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m7.8 7.8 8.4 8.4M16.8 7.3l-4.1 4.1"/></svg>
    <svg v-else-if="service === 'custom'" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
    <svg v-else-if="service === 'tongyi' || service === 'doubao' || service === 'yiyan' || service === 'zhipu'" viewBox="0 0 24 24"><path d="M12 3.5 19 7v10l-7 3.5L5 17V7l7-3.5Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>
    <svg v-else viewBox="0 0 24 24"><path d="M12 3.5 19.5 8v8L12 20.5 4.5 16V8L12 3.5Z"/><circle cx="12" cy="12" r="2.5"/></svg>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  service: string
  label?: string
  size?: 'small' | 'medium' | 'large' | 'model'
}>(), {
  label: '',
  size: 'medium',
})

const tone = computed(() => {
  if (['openai', 'azureOpenai', 'newapi'].includes(props.service)) return 'violet'
  if (['deepseek', 'deepL', 'deeplx', 'microsoft'].includes(props.service)) return 'blue'
  if (['gemini', 'google', 'chromeTranslator'].includes(props.service)) return 'green'
  return 'rose'
})
</script>

<style scoped>
.service-brand-icon { display: grid; place-items: center; flex: none; border-radius: 11px; color: #d42f60; background: #ffeaf0; }
.service-brand-icon--small { width: 25px; height: 25px; border-radius: 8px; }
.service-brand-icon--medium { width: 40px; height: 40px; }
.service-brand-icon--large { width: 48px; height: 48px; border-radius: 14px; }
.service-brand-icon--model { width: 30px; height: 30px; border-radius: 9px; }
.service-brand-icon--blue { color: #2c65bb; background: #eaf2ff; }
.service-brand-icon--green { color: #18835d; background: #e9f8f1; }
.service-brand-icon--violet { color: #694bc2; background: #f0ebff; }
.service-brand-icon svg { width: 57%; height: 57%; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.8; }
.service-brand-icon--small svg, .service-brand-icon--model svg { width: 62%; height: 62%; }
.service-brand-icon svg text { fill: currentColor; stroke: none; font-family: Arial, sans-serif; font-size: 15px; font-weight: 800; }
.service-brand-icon svg rect { fill: currentColor; stroke: none; }
.service-brand-icon svg circle:first-child { fill: none; }
.service-brand-icon--green svg text { fill: #18835d; }
</style>
