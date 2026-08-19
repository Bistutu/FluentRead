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

      <section class="settings-card" :class="{ 'services-view': activeSection === 'settings-services', 'translation-center-view': activeSection === 'settings-translation-center' }" :aria-label="activeItem.heading">
        <div v-if="!['settings-services', 'settings-about', 'settings-translation-center'].includes(activeSection)" class="card-intro">
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

    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Main from '@/components/Main.vue'
import { navigationGroups, navigationItems } from './navigation'

const version = process.env.VUE_APP_VERSION
const query = ref('')
const activeSection = ref('settings-general')

const navigation = navigationItems
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
