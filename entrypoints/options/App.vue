<template>
  <div class="settings-app">
    <aside class="sidebar">
      <div class="brand">
        <img src="/icon/128.png" alt="" />
        <div><strong>流畅阅读</strong><small>FluentRead · V{{ version }}</small></div>
      </div>

      <nav aria-label="设置分类">
        <button
          v-for="item in navigation"
          :key="item.id"
          type="button"
          :class="{ active: activeSection === item.id }"
          @click="scrollTo(item.id)"
        >
          <span class="nav-icon">{{ item.icon }}</span>
          <span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span>
        </button>
      </nav>

      <div class="sidebar-note">
        <span>隐私优先</span>
        <p>配置保存在浏览器本地，令牌不会上传到流畅阅读服务器。</p>
      </div>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <div>
          <span class="eyebrow">偏好设置</span>
          <h1>打造你的流畅阅读体验</h1>
          <p>翻译服务、交互习惯与高级能力，都可以在这里精细调整。</p>
        </div>
        <label class="search-box">
          <span>⌕</span>
          <input v-model.trim="query" type="search" placeholder="搜索设置，例如：快捷键、缓存、OpenAI" />
        </label>
      </header>

      <div v-if="query && filteredResults.length" class="search-results">
        <button v-for="result in filteredResults" :key="result.label" type="button" @click="selectResult(result.id)">
          <span><strong>{{ result.label }}</strong><small>{{ result.description }}</small></span><b>前往 →</b>
        </button>
      </div>
      <div v-else-if="query" class="search-empty">没有找到“{{ query }}”相关设置</div>

      <section class="settings-card" aria-label="完整设置">
        <div class="card-intro">
          <span class="eyebrow">全部选项</span>
          <h2>功能与服务</h2>
          <p>改动会自动保存，并同步到已打开的网页。</p>
        </div>
        <Main />
      </section>

      <footer>FluentRead V{{ version }} · 为更自然的双语阅读而设计</footer>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import Main from '@/components/Main.vue'

const version = process.env.VUE_APP_VERSION
const query = ref('')
const activeSection = ref('settings-general')

const navigation = [
  { id: 'settings-general', icon: '⌂', label: '通用', description: '状态与显示' },
  { id: 'settings-services', icon: '译', label: '翻译服务', description: '语言与模型' },
  { id: 'settings-shortcuts', icon: '⌘', label: '交互与快捷键', description: '悬停、划词、全文' },
  { id: 'settings-advanced', icon: '◇', label: '高级选项', description: '缓存、性能与模板' },
  { id: 'settings-data', icon: '⇅', label: '配置管理', description: '导入与导出' },
]

const searchItems = [
  { id: 'settings-general', label: '插件状态与译文显示', description: '启停、双语模式、译文样式、主题' },
  { id: 'settings-services', label: '翻译服务与目标语言', description: '微软翻译、OpenAI、DeepL、Gemini 等' },
  { id: 'settings-shortcuts', label: '悬停、划词与全文快捷键', description: '设置触发方式与自定义按键' },
  { id: 'settings-advanced', label: '缓存、动画与并发', description: '性能、输入框翻译、代理及提示词' },
  { id: 'settings-data', label: '导入与导出配置', description: '备份或迁移本地设置' },
]

const filteredResults = computed(() => {
  if (!query.value) return []
  const keyword = query.value.toLocaleLowerCase()
  return searchItems.filter((item) => `${item.label}${item.description}`.toLocaleLowerCase().includes(keyword))
})

function scrollTo(id: string) {
  activeSection.value = id
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function selectResult(id: string) {
  query.value = ''
  requestAnimationFrame(() => scrollTo(id))
}

function updateActiveSection() {
  let closest = navigation[0].id
  let closestDistance = Number.POSITIVE_INFINITY
  for (const item of navigation) {
    const element = document.getElementById(item.id)
    if (!element) continue
    const distance = Math.abs(element.getBoundingClientRect().top - 150)
    if (distance < closestDistance) {
      closest = item.id
      closestDistance = distance
    }
  }
  activeSection.value = closest
}

onMounted(() => window.addEventListener('scroll', updateActiveSection, { passive: true }))
onUnmounted(() => window.removeEventListener('scroll', updateActiveSection))
</script>
