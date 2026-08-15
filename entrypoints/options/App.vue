<template>
  <div class="settings-app">
    <aside class="sidebar">
      <div class="brand">
        <img src="/icon/128.png" alt="" />
        <div><strong>流畅阅读</strong><small>FluentRead · V{{ version }}</small></div>
      </div>

      <nav aria-label="设置分类">
        <section v-for="group in navigationGroups" :key="group.label" class="nav-group">
          <span class="nav-group-label">{{ group.label }}</span>
          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            :class="{ active: activeSection === item.id }"
            :aria-current="activeSection === item.id ? 'page' : undefined"
            @click="selectSection(item.id)"
          >
            <span class="nav-icon">{{ item.icon }}</span>
            <span><strong>{{ item.label }}</strong><small>{{ item.description }}</small></span>
          </button>
        </section>
      </nav>
    </aside>

    <main class="workspace">
      <header class="topbar">
        <div>
          <span class="eyebrow">{{ activeItem.group }}</span>
          <h1>{{ activeItem.heading }}</h1>
          <p>{{ activeItem.summary }}</p>
        </div>
        <label class="search-box">
          <span aria-hidden="true">⌕</span>
          <input v-model.trim="query" type="search" placeholder="搜索设置，例如：快捷键、缓存、OpenAI" />
        </label>
      </header>

      <div v-if="query && filteredResults.length" class="search-results">
        <button v-for="result in filteredResults" :key="result.id" type="button" @click="selectResult(result.id)">
          <span><strong>{{ result.label }}</strong><small>{{ result.searchDescription }}</small></span><b>打开 →</b>
        </button>
      </div>
      <div v-else-if="query" class="search-empty">没有找到“{{ query }}”相关设置</div>

      <section class="settings-card" :aria-label="activeItem.heading">
        <div class="card-intro">
          <span class="eyebrow">{{ activeItem.kicker }}</span>
          <h2>{{ activeItem.title }}</h2>
          <p>{{ activeItem.detail }}</p>
        </div>
        <Main :active-section="activeSection" />
      </section>

      <footer>FluentRead V{{ version }} · 为更自然的双语阅读而设计</footer>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Main from '@/components/Main.vue'

type NavigationItem = {
  id: string
  icon: string
  label: string
  description: string
  group: string
  heading: string
  summary: string
  kicker: string
  title: string
  detail: string
  searchDescription: string
}

const version = process.env.VUE_APP_VERSION
const query = ref('')
const activeSection = ref('settings-general')

const navigationGroups: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: '基础设置',
    items: [
      {
        id: 'settings-general', icon: '⌂', label: '通用设置', description: '状态与显示', group: '基础设置',
        heading: '调整你的阅读体验', summary: '管理插件状态、翻译模式和译文的基础显示方式。',
        kicker: '阅读偏好', title: '通用设置', detail: '常用开关集中在这里，修改后会自动保存。',
        searchDescription: '插件启停、双语模式、译文样式与主题',
      },
      {
        id: 'settings-services', icon: '译', label: '翻译服务', description: '服务与模型', group: '基础设置',
        heading: '选择翻译服务与模型', summary: '按机器翻译和 AI 翻译分类，清楚管理当前服务、模型及连接参数。',
        kicker: '翻译能力', title: '服务目录', detail: '先选择服务，再配置模型和该服务实际需要的参数。',
        searchDescription: '微软翻译、OpenAI、DeepSeek、Gemini、模型与令牌',
      },
    ],
  },
  {
    label: '阅读工具',
    items: [
      {
        id: 'settings-shortcuts', icon: '⌘', label: '交互与快捷键', description: '悬停、划词、全文', group: '阅读工具',
        heading: '让翻译顺手发生', summary: '统一设置鼠标悬停、划词和全文翻译的触发习惯。',
        kicker: '操作方式', title: '交互与快捷键', detail: '为高频动作选择容易记忆且不冲突的触发方式。',
        searchDescription: '鼠标悬停、划词翻译、全文翻译与自定义按键',
      },
    ],
  },
  {
    label: '系统与数据',
    items: [
      {
        id: 'settings-advanced', icon: '◇', label: '高级选项', description: '性能与模板', group: '系统与数据',
        heading: '精细控制运行方式', summary: '管理缓存、动画、并发、悬浮工具、代理和 AI 提示词。',
        kicker: '运行策略', title: '高级选项', detail: '这些设置更偏向性能、兼容性和高级翻译行为。',
        searchDescription: '缓存、动画、并发、悬浮球、输入框、代理与提示词',
      },
      {
        id: 'settings-data', icon: '⇅', label: '配置管理', description: '导入与导出', group: '系统与数据',
        heading: '备份与迁移配置', summary: '导出当前设置，或从已有配置恢复你的使用习惯。',
        kicker: '数据工具', title: '配置管理', detail: '通过 JSON 完成配置备份、迁移与恢复。',
        searchDescription: '备份、迁移、导出与导入 JSON 配置',
      },
    ],
  },
]

const navigation = navigationGroups.flatMap((group) => group.items)
const activeItem = computed(() => navigation.find((item) => item.id === activeSection.value) || navigation[0])

const filteredResults = computed(() => {
  if (!query.value) return []
  const keyword = query.value.toLocaleLowerCase()
  return navigation.filter((item) =>
    `${item.label}${item.description}${item.heading}${item.summary}${item.searchDescription}`
      .toLocaleLowerCase()
      .includes(keyword),
  )
})

function selectSection(id: string) {
  if (!navigation.some((item) => item.id === id)) return
  activeSection.value = id
  query.value = ''
  history.replaceState(null, '', `#${id}`)
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function selectResult(id: string) {
  selectSection(id)
}

onMounted(() => {
  const requestedSection = window.location.hash.slice(1)
  if (navigation.some((item) => item.id === requestedSection)) {
    activeSection.value = requestedSection
  }
})
</script>
