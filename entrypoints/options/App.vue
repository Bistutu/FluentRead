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

      <section class="settings-card" :class="{ 'services-view': activeSection === 'settings-services' }" :aria-label="activeItem.heading">
        <div v-if="activeSection !== 'settings-services'" class="card-intro">
          <span class="eyebrow">{{ activeItem.kicker }}</span>
          <h2>{{ activeItem.title }}</h2>
          <p>{{ activeItem.detail }}</p>
        </div>
        <section v-if="activeSection === 'settings-about'" id="settings-about" class="about-page" aria-labelledby="about-title">
          <div class="about-hero">
            <img class="about-logo" src="/icon/128.png" alt="流畅阅读图标" />
            <div>
              <span class="eyebrow">关于流畅阅读</span>
              <h3 id="about-title">让双语阅读自然发生</h3>
              <p>流畅阅读是一款开源浏览器翻译插件，帮助你在阅读网页时更自然地理解不同语言的内容。</p>
              <span class="about-version">FluentRead · V{{ version }}</span>
            </div>
          </div>

          <div class="about-grid">
            <article class="about-panel">
              <span class="about-panel-kicker">核心体验</span>
              <h3>为阅读而生</h3>
              <p>从网页翻译到划词、悬浮与快捷键，把常用能力放在真正需要的位置。</p>
              <div class="about-feature-list">
                <span><b>译</b>网页双语阅读</span>
                <span><b>⌘</b>顺手的阅读工具</span>
                <span><b>AI</b>灵活的翻译服务</span>
              </div>
            </article>

            <article class="about-panel about-links-panel">
              <span class="about-panel-kicker">了解更多</span>
              <h3>一起让它变得更好</h3>
              <p>查看项目代码、使用文档，或反馈你在阅读中的想法。</p>
              <div class="about-links">
                <a href="https://github.com/Bistutu/FluentRead" target="_blank" rel="noreferrer">开源项目 <span>↗</span></a>
                <a href="https://fluent.thinkstu.com/" target="_blank" rel="noreferrer">使用文档 <span>↗</span></a>
                <a href="https://github.com/Bistutu/FluentRead/issues" target="_blank" rel="noreferrer">问题反馈 <span>↗</span></a>
              </div>
            </article>
          </div>

          <p class="about-footer">感谢你使用流畅阅读。</p>
        </section>
        <Main v-else :active-section="activeSection" />
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
        heading: '配置翻译服务与模型', summary: '按机器翻译和 AI 翻译分类，配置之后网页翻译默认使用的服务、模型及连接参数。',
        kicker: '翻译能力', title: '翻译服务与模型', detail: '配置网页翻译默认使用的服务、模型和连接参数。',
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
  {
    label: '关于',
    items: [
      {
        id: 'settings-about', icon: 'i', label: '关于流畅阅读', description: '版本与项目', group: '关于',
        heading: '关于流畅阅读', summary: '了解插件版本、核心体验与项目入口。',
        kicker: '关于项目', title: '关于流畅阅读', detail: '一个让双语阅读更自然的开源浏览器翻译插件。',
        searchDescription: '版本、开源项目、使用文档与问题反馈',
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
