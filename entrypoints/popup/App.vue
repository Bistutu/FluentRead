<template>
  <main class="popup-shell">
    <header class="popup-header">
      <div class="brand">
        <img src="/icon/128.png" alt="" />
        <div>
          <strong>流畅阅读</strong>
          <small>FluentRead · V{{ version }}</small>
        </div>
      </div>
      <div class="header-actions">
        <button class="donation-button" type="button" title="赞赏流畅阅读" aria-label="打开赞赏页" @click="openDonation()">
          <Coffee />
          <span>赞赏</span>
        </button>
        <button class="settings-button" type="button" title="完整设置" aria-label="打开完整设置" @click="openOptions()">
          <Setting />
          <span>设置</span>
        </button>
      </div>
    </header>

    <Transition name="donation-fade">
      <div
        v-if="donationVisible"
        class="donation-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="donation-title"
        @click.self="closeDonation"
      >
        <section class="donation-card">
          <button class="donation-close" type="button" aria-label="关闭赞赏页" @click="closeDonation">×</button>
          <div class="donation-icon" aria-hidden="true"><Coffee /></div>
          <span class="eyebrow">软件开源免费</span>
          <h2 id="donation-title">如果你喜欢这款软件，</h2>
          <p class="donation-description">可以扫描微信赞赏码支持作者，感谢鼓励。</p>
          <div class="donation-qr-frame">
            <img src="/misc/approve.jpg" alt="流畅阅读赞赏码" />
          </div>
        </section>
      </div>
    </Transition>

    <section class="hero-card">
      <div class="hero-heading">
        <div>
          <span class="eyebrow">网页翻译</span>
          <h1>{{ config.on ? '让阅读自然地流动' : '翻译功能已暂停' }}</h1>
        </div>
        <button class="switch" type="button" role="switch" :aria-checked="config.on" :aria-label="config.on ? '暂停插件' : '启用插件'" @click="setPluginEnabled(!config.on)"><i /></button>
      </div>

      <div class="language-pair">
        <label>
          <span>源语言</span>
          <select v-model="config.from" :disabled="!config.on">
            <option v-for="item in options.form" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <span class="arrow">→</span>
        <label>
          <span>目标语言</span>
          <select v-model="config.to" :disabled="!config.on">
            <option v-for="item in options.to" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
      </div>

      <div ref="servicePicker" class="service-picker">
        <button
          class="service-field"
          type="button"
          :disabled="!config.on"
          aria-haspopup="listbox"
          :aria-expanded="servicePickerOpen"
          :aria-label="servicePickerAriaLabel"
          :data-selected-model="serviceModelLabel || undefined"
          @click="toggleServicePicker"
        >
          <ServiceIcon :service="config.service" :label="serviceLabel" />
          <span class="service-copy">
            <small>翻译服务</small>
            <span class="service-value">
              <strong>{{ serviceLabel }}</strong>
              <em v-if="serviceModelLabel" class="service-model" :title="serviceModelLabel">{{ serviceModelLabel }}</em>
            </span>
          </span>
          <span class="chevron" :class="{ open: servicePickerOpen }">⌄</span>
        </button>

        <div v-if="servicePickerOpen" class="service-picker-panel" role="listbox" aria-label="翻译服务列表">
          <div class="service-picker-heading">
            <div><strong>选择翻译服务</strong><small>常用服务优先，更多服务已收起</small></div>
            <span>{{ serviceOptions.length }}</span>
          </div>

          <div class="service-group">
            <span class="service-group-label">常用服务</span>
            <button
              v-for="item in popularServiceOptions"
              :key="item.value"
              class="service-option"
              type="button"
              role="option"
              :data-service-value="item.value"
              :aria-selected="config.service === item.value"
              @click="selectService(item.value)"
            >
              <ServiceIcon :service="item.value" :label="item.label" size="small" />
              <span>{{ item.label }}</span>
              <span v-if="config.service === item.value" class="service-option-check">✓</span>
            </button>
          </div>

          <button class="service-more-toggle" type="button" :aria-expanded="moreServicesOpen" @click="moreServicesOpen = !moreServicesOpen">
            <span>更多服务</span>
            <span class="service-more-meta">{{ moreServiceOptions.length }} 项 <b :class="{ open: moreServicesOpen }">⌄</b></span>
          </button>

          <div v-if="moreServicesOpen" class="service-group service-group-more">
            <button
              v-for="item in moreServiceOptions"
              :key="item.value"
              class="service-option"
              type="button"
              role="option"
              :data-service-value="item.value"
              :aria-selected="config.service === item.value"
              @click="selectService(item.value)"
            >
              <ServiceIcon :service="item.value" :label="item.label" size="small" />
              <span>{{ item.label }}</span>
              <span v-if="config.service === item.value" class="service-option-check">✓</span>
            </button>
          </div>
        </div>
      </div>

      <div v-if="credentialWarning" class="credential-warning" role="alert">
        <span><strong>配置提醒</strong>{{ credentialWarning }}</span>
        <button type="button" @click="openOptions('settings-services')">去设置</button>
      </div>

      <button
        class="translate-button"
        :class="{ translated: pageTranslated }"
        type="button"
        :disabled="!config.on || translating"
        :aria-pressed="pageTranslated"
        @click="togglePageTranslation"
      >
        <span v-if="translating" class="spinner" />
        <span v-else class="translate-glyph">A↔译</span>
        <span class="translate-label">{{ pageTranslated ? '恢复当前网页' : '翻译当前网页' }}</span>
        <kbd class="translate-hotkey" :class="{ disabled: fullPageHotkey === '未设置' }">{{ fullPageHotkey }}</kbd>
      </button>
      <p v-if="notice" class="notice" :class="noticeType">{{ notice }}</p>
    </section>

    <section class="features">
      <span class="eyebrow features-eyebrow">快捷功能</span>
      <div class="feature-grid">
        <button class="feature-card" type="button" :disabled="!config.on" @click="openDrawer('hover')">
          <span class="feature-icon rose">↖</span>
          <span><strong>鼠标悬停翻译</strong><small>{{ hoverSummary }}</small></span>
          <i :class="{ active: config.hotkey !== 'none' }" />
        </button>
        <button class="feature-card" type="button" :disabled="!config.on" @click="openDrawer('selection')">
          <span class="feature-icon violet">I</span>
          <span><strong>划词翻译</strong><small>{{ selectionSummary }}</small></span>
          <i :class="{ active: config.selectionTranslatorMode !== 'disabled' || config.selectionAreaEnabled }" />
        </button>
        <button class="feature-card" type="button" :disabled="!config.on" @click="openDrawer('floating')">
          <span class="feature-icon blue">◉</span>
          <span><strong>全文悬浮球</strong><small>{{ config.disableFloatingBall ? '已关闭' : floatingSummary }}</small></span>
          <i :class="{ active: !config.disableFloatingBall }" />
        </button>
        <button class="feature-card" type="button" :disabled="!config.on" @click="openDrawer('appearance')">
          <span class="feature-icon amber">Aa</span>
          <span><strong>译文显示</strong><small>{{ displaySummary }}</small></span>
          <b>›</b>
        </button>
        <button class="feature-card" type="button" :disabled="!config.on" @click="openDrawer('image')">
          <span class="feature-icon teal">▧</span>
          <span class="feature-copy">
            <span class="feature-title"><strong>图片翻译</strong><em class="beta-badge">Beta 测试</em></span>
            <small>{{ imageTranslationSummary }}</small>
          </span>
          <i :class="{ active: !config.disableImageTranslator }" />
        </button>
        <button
          class="feature-card video-feature-card"
          :class="{ 'needs-enable': !config.videoTranslationEnabled }"
          data-feature="video-subtitle"
          type="button"
          :disabled="!config.on"
          :aria-label="config.videoTranslationEnabled ? '打开视频字幕设置，当前已开启' : '打开视频字幕设置，点击开启字幕翻译'"
          @click="openDrawer('video')"
        >
          <span class="feature-icon teal">CC</span>
          <span class="feature-copy">
            <span class="feature-title"><strong>视频字幕</strong><em class="beta-badge">Beta 测试</em></span>
            <small>{{ videoSummary }}</small>
          </span>
          <i :class="{ active: config.videoTranslationEnabled }" />
        </button>
      </div>
    </section>

    <footer>
      <span>已完成 {{ config.count }} 次翻译</span>
      <a
        class="opensource-link"
        href="https://github.com/Bistutu/FluentRead"
        target="_blank"
        rel="noreferrer"
        aria-label="在 GitHub 查看流畅阅读开源项目"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 .3a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.26c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.95 0-1.31.47-2.38 1.24-3.22-.12-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.62-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .3" />
        </svg>
        <span>开源项目</span>
        <span class="external-mark" aria-hidden="true">↗</span>
      </a>
      <button type="button" :disabled="clearingCache" @click="clearCache">{{ clearingCache ? '清理中…' : '清除缓存' }}</button>
    </footer>

    <el-drawer
      v-model="drawerVisible"
      direction="btt"
      size="auto"
      :with-header="false"
      :append-to-body="true"
      modal-class="popup-drawer-modal"
      class="popup-drawer"
    >
      <div class="drawer-handle" />
      <header class="drawer-header">
        <div><span class="eyebrow">快捷设置</span><h2>{{ drawerTitle }}</h2><p>{{ drawerDescription }}</p></div>
        <button type="button" aria-label="关闭" @click="drawerVisible = false">×</button>
      </header>

      <div v-if="activeDrawer === 'hover'" class="drawer-content">
        <div class="interaction-preview"><span class="cursor">↖</span><span>＋</span><kbd>{{ hoverKey }}</kbd><span>＝</span><strong>即时翻译</strong></div>
        <div class="setting-row">
          <span><strong>启用鼠标悬停翻译</strong><small>按住快捷键并悬停在文本上</small></span>
          <button class="switch compact" type="button" role="switch" :aria-checked="config.hotkey !== 'none'" aria-label="启用或关闭鼠标悬停翻译" @click="toggleHover"><i /></button>
        </div>
        <div class="choice-block">
          <label>触发快捷键</label>
          <div class="chips two">
            <button v-for="item in hoverChoices" :key="item.value" type="button" :class="{ selected: config.hotkey === item.value }" @click="setHoverHotkey(item.value)">{{ item.label }}</button>
          </div>
          <button v-if="config.hotkey === 'custom'" class="secondary-action" type="button" @click="showCustomMouseHotkeyDialog = true">
            {{ config.customHotkey ? `当前：${config.customHotkey}` : '录制自定义快捷键' }}
          </button>
        </div>
      </div>

      <div v-else-if="activeDrawer === 'selection'" class="drawer-content">
        <div class="selection-mode-tabs" role="tablist" aria-label="翻译方式">
          <button class="selection-mode-tab" :class="{ selected: selectionDrawerTab === 'text' }" type="button" role="tab" :aria-selected="selectionDrawerTab === 'text'" aria-controls="selection-text-panel" @click="selectionDrawerTab = 'text'">划词翻译</button>
          <button class="selection-mode-tab" :class="{ selected: selectionDrawerTab === 'area' }" type="button" role="tab" :aria-selected="selectionDrawerTab === 'area'" aria-controls="selection-area-panel" @click="selectionDrawerTab = 'area'">圈选翻译</button>
        </div>

        <div v-if="selectionDrawerTab === 'text'" id="selection-text-panel" role="tabpanel">
          <div class="interaction-preview"><span class="selection-box">选择文字</span><span>＋</span><i class="pink-dot" /><span>＝</span><strong>翻译所选内容</strong></div>
          <div class="setting-row">
            <span><strong>启用划词翻译</strong><small>选中文字后显示可操作的翻译入口</small></span>
            <button class="switch compact" type="button" role="switch" :aria-checked="config.selectionTranslatorMode !== 'disabled'" aria-label="启用或关闭划词翻译" @click="setSelectionMode(config.selectionTranslatorMode === 'disabled' ? 'bilingual' : 'disabled')"><i /></button>
          </div>
          <div class="choice-block">
            <label>显示方式</label>
            <div class="chips two">
              <button v-for="item in selectionModes" :key="item.value" type="button" :class="{ selected: config.selectionTranslatorMode === item.value }" @click="setSelectionMode(item.value)">{{ item.label }}</button>
            </div>
          </div>
          <div class="choice-block">
            <label>触发方式</label>
            <div class="chips three">
              <button v-for="item in selectionTriggers" :key="item.value" type="button" :class="{ selected: config.selectionTranslatorTrigger === item.value }" @click="setSelectionTrigger(item.value)">{{ item.label }}</button>
            </div>
            <small class="drawer-hint">图标和小点会固定显示在选区旁，不需要悬停才能发现。</small>
          </div>
        </div>

        <div v-else id="selection-area-panel" class="selection-area-panel" role="tabpanel">
          <div class="area-translation-block">
            <div class="area-translation-heading">
              <div>
                <strong>启用圈选翻译</strong>
                <small>翻译图片或无法直接选中的页面文字</small>
              </div>
              <button class="switch compact" type="button" role="switch" :aria-checked="config.selectionAreaEnabled" aria-label="启用或关闭圈选翻译" @click="setAreaEnabled(!config.selectionAreaEnabled)"><i /></button>
            </div>
            <div class="area-translation-preview" aria-keyshortcuts="Shift+Z"><div class="area-hotkey"><kbd>Shift</kbd><kbd>Z</kbd></div><span>＋</span><i class="area-ring" /><span>＝</span><strong>翻译选中区域</strong></div>
            <small class="drawer-hint">按住 Shift + Z 拖拽页面区域，释放鼠标后识别并翻译；结果会覆盖在当前区域上，按 Esc 可关闭。</small>
          </div>
        </div>
      </div>

      <div v-else-if="activeDrawer === 'floating'" class="drawer-content">
        <div class="setting-row">
          <span><strong>启用全文翻译悬浮球</strong><small>在页面边缘快速翻译或恢复全文</small></span>
          <button class="switch compact" type="button" role="switch" :aria-checked="!config.disableFloatingBall" aria-label="启用或关闭全文翻译悬浮球" @click="setFloatingEnabled(config.disableFloatingBall)"><i /></button>
        </div>
        <div class="choice-block">
          <label>悬浮位置</label>
          <div class="chips two">
            <button type="button" :class="{ selected: config.floatingBallPosition === 'left' }" @click="config.floatingBallPosition = 'left'">页面左侧</button>
            <button type="button" :class="{ selected: config.floatingBallPosition === 'right' }" @click="config.floatingBallPosition = 'right'">页面右侧</button>
          </div>
        </div>
        <label class="select-row">
          <span><strong>全文翻译快捷键</strong><small>无需点击悬浮球即可切换</small></span>
          <select v-model="config.floatingBallHotkey" @change="handleFloatingHotkeyChange">
            <option v-for="item in options.floatingBallHotkeys" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <button v-if="config.floatingBallHotkey === 'custom'" class="secondary-action" type="button" @click="showCustomHotkeyDialog = true">
          {{ config.customFloatingBallHotkey ? `当前：${config.customFloatingBallHotkey}` : '录制自定义快捷键' }}
        </button>
      </div>

      <div v-else-if="activeDrawer === 'image'" class="drawer-content">
        <div class="image-translation-preview">
          <div class="image-translation-preview-art"><span>文字</span><b>文</b></div>
          <div>
            <span class="feature-title"><strong>悬停图片显示翻译入口</strong><em class="beta-badge">Beta 测试</em></span>
            <small>点击图片右上角的小图标即可识别并翻译图片文字</small>
          </div>
        </div>
        <div class="setting-row">
          <span><strong>启用图片翻译</strong><small>在网页图片右上角显示“文”按钮</small></span>
          <button class="switch compact" type="button" role="switch" :aria-checked="!config.disableImageTranslator" aria-label="启用或关闭图片翻译" @click="setImageTranslatorEnabled(config.disableImageTranslator)"><i /></button>
        </div>
      </div>

      <div v-else-if="activeDrawer === 'video'" class="drawer-content">
        <div class="video-beta-banner"><span class="feature-icon teal">CC</span><span><strong>FluentRead · YouTube 字幕翻译</strong><small>Beta 测试 · 只处理播放器已经提供的字幕文本</small></span></div>
        <div class="setting-row video-enable-row" :class="{ 'needs-enable': !config.videoTranslationEnabled }">
          <span><strong>{{ config.videoTranslationEnabled ? '视频字幕翻译已开启' : '开启字幕翻译' }}</strong><small>{{ config.videoTranslationEnabled ? '正在 YouTube 原生字幕下方显示中文译文' : '点击右侧开关，在 YouTube 播放器中显示中文译文' }}</small></span>
          <button class="switch compact" type="button" role="switch" :aria-checked="config.videoTranslationEnabled" aria-label="启用或关闭视频字幕翻译" @click="setVideoTranslationEnabled(!config.videoTranslationEnabled)"><i /></button>
        </div>
        <label class="select-row">
          <span><strong>视频翻译服务</strong><small>与网页翻译服务独立保存</small></span>
          <select v-model="config.videoService" :disabled="!config.videoTranslationEnabled">
            <option v-for="item in videoServiceOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </label>
        <label class="select-row">
          <span><strong>字幕字号</strong><small>只调整 FluentRead 显示的原文和译文</small></span>
          <select v-model.number="config.videoSubtitleFontSize" aria-label="视频字幕字号" :disabled="!config.videoTranslationEnabled">
            <option v-for="size in videoSubtitleFontSizeOptions" :key="size" :value="size">{{ size === 100 ? '默认' : `${size}%` }}</option>
          </select>
        </label>
        <small class="drawer-hint">目前支持 YouTube；播放器内会显示 FluentRead 图标，可切换字幕模式、显示状态和下载 SRT。视频默认使用微软翻译；AI 服务会提前预取字幕，如切换 DeepLX，可在完整设置中配置服务地址。</small>
      </div>

      <div v-else class="drawer-content">
        <div class="choice-block">
          <label>翻译模式</label>
          <div class="chips two">
            <button v-for="item in options.display" :key="item.value" type="button" :class="{ selected: config.display === item.value }" @click="config.display = item.value">{{ item.label }}</button>
          </div>
        </div>
        <label v-if="config.display === 1" class="select-row">
          <span><strong>译文样式</strong><small>双语对照时译文的视觉效果</small></span>
          <select v-model.number="config.style"><option v-for="item in styleOptions" :key="item.value" :value="item.value">{{ item.label }}</option></select>
        </label>
        <label class="select-row">
          <span><strong>界面主题</strong><small>同时应用到完整设置页面</small></span>
          <select v-model="config.theme"><option v-for="item in options.theme" :key="item.value" :value="item.value">{{ item.label }}</option></select>
        </label>
      </div>

      <button v-if="activeDrawer !== 'image'" class="drawer-settings-link" type="button" @click="openOptions(drawerSettingsSection[activeDrawer])">在完整设置中查看全部选项 ↗</button>
    </el-drawer>

    <CustomHotkeyInput v-model="showCustomHotkeyDialog" :current-value="config.customFloatingBallHotkey" @confirm="confirmFloatingHotkey" @cancel="cancelFloatingHotkey" />
    <CustomHotkeyInput v-model="showCustomMouseHotkeyDialog" :current-value="config.customHotkey" @confirm="confirmMouseHotkey" @cancel="cancelMouseHotkey" />
  </main>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue';
import browser from 'webextension-polyfill';
import {
  config as runtimeConfig,
  configReady,
  saveConfig,
  requestConfigSave,
  subscribeConfig,
} from '@/entrypoints/utils/config';
import { Setting } from '@element-plus/icons-vue';
import { Config, VIDEO_SUBTITLE_FONT_SIZE_OPTIONS } from '@/entrypoints/utils/model';
import { options } from '@/entrypoints/utils/option';
import { getMissingCredentialMessage } from '@/entrypoints/utils/configValidation';
import { getSelectedModelLabel } from '@/entrypoints/utils/serviceCatalog';
import ServiceIcon from '@/components/ServiceIcon.vue';

type DrawerName = 'hover' | 'selection' | 'floating' | 'appearance' | 'image' | 'video';
type SettingsSection = 'settings-general' | 'settings-shortcuts' | 'settings-services' | 'settings-video';
const CustomHotkeyInput = defineAsyncComponent(() => import('@/components/CustomHotkeyInput.vue'));
const version = process.env.VUE_APP_VERSION;
const config = ref(new Config());
const drawerVisible = ref(false);
const activeDrawer = ref<DrawerName>('hover');
const selectionDrawerTab = ref<'text' | 'area'>('text');
const translating = ref(false);
const pageTranslated = ref(false);
const clearingCache = ref(false);
const donationVisible = ref(false);
const notice = ref('');
const noticeType = ref<'success' | 'error'>('success');
const showCustomHotkeyDialog = ref(false);
const showCustomMouseHotkeyDialog = ref(false);
const servicePicker = ref<HTMLElement | null>(null);
const servicePickerOpen = ref(false);
const moreServicesOpen = ref(false);
const hydrated = ref(false);
let lastSerialized = '';
let applyingExternalConfig = false;
let pageExitSaveStarted = false;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
const darkMode = window.matchMedia('(prefers-color-scheme: dark)');
const drawerSettingsSection: Record<DrawerName, SettingsSection> = {
  hover: 'settings-shortcuts',
  selection: 'settings-shortcuts',
  floating: 'settings-shortcuts',
  appearance: 'settings-general',
  image: 'settings-general',
  video: 'settings-video',
};
const persistConfig = (value: unknown) => requestConfigSave(value, browser.runtime.sendMessage.bind(browser.runtime));

const serviceOptions = computed(() => options.services.filter((item: any) => !item.disabled));
const videoServiceOptions = computed(() => options.services.filter((item: any) => !item.disabled));
const videoSubtitleFontSizeOptions = VIDEO_SUBTITLE_FONT_SIZE_OPTIONS;
const popularServiceValues = ['freeTranslation', 'microsoft', 'google', 'deepL', 'deeplx', 'deepseek', 'openai', 'gemini', 'claude'];
const popularServiceOptions = computed(() => popularServiceValues
  .map(value => serviceOptions.value.find((item: any) => item.value === value))
  .filter((item): item is any => Boolean(item)));
const moreServiceOptions = computed(() => serviceOptions.value.filter((item: any) => !popularServiceValues.includes(item.value)));
const styleOptions = computed(() => options.styles.filter((item: any) => !item.disabled));
const serviceLabel = computed(() => serviceOptions.value.find((item: any) => item.value === config.value.service)?.label || config.value.service);
const serviceModelLabel = computed(() => getSelectedModelLabel(config.value.service, config.value.model, config.value.customModel));
const servicePickerAriaLabel = computed(() => serviceModelLabel.value
  ? `翻译服务：${serviceLabel.value}，当前模型：${serviceModelLabel.value}`
  : `翻译服务：${serviceLabel.value}`);
const credentialWarning = computed(() => getMissingCredentialMessage(config.value.service, config.value));
const videoServiceLabel = computed(() => videoServiceOptions.value.find((item: any) => item.value === config.value.videoService)?.label || config.value.videoService);
const styleLabel = computed(() => styleOptions.value.find((item: any) => item.value === config.value.style)?.label || '默认样式');
const hoverKey = computed(() => config.value.hotkey === 'custom' ? (config.value.customHotkey || '自定义') : config.value.hotkey);
const hoverSummary = computed(() => config.value.hotkey === 'none' ? '已关闭' : `${hoverKey.value} + 鼠标悬停`);
const fullPageHotkey = computed(() => {
  const hotkey = config.value.floatingBallHotkey === 'custom'
    ? config.value.customFloatingBallHotkey
    : config.value.floatingBallHotkey;
  return hotkey && hotkey !== 'none' ? hotkey : '未设置';
});
const selectionSummary = computed(() => {
  const textSummary = ({ disabled: '已关闭', bilingual: '双语显示', 'translation-only': '仅显示译文' }[config.value.selectionTranslatorMode] || '双语显示');
  if (!config.value.selectionAreaEnabled) return textSummary;
  return textSummary === '已关闭' ? '圈选翻译已启用' : `${textSummary} · 圈选翻译`;
});
const floatingSummary = computed(() => `${config.value.floatingBallPosition === 'left' ? '页面左侧' : '页面右侧'} · ${fullPageHotkey.value}`);
const displaySummary = computed(() => config.value.display === 1 ? `双语 · ${styleLabel.value}` : '仅显示译文');
const imageTranslationSummary = computed(() => config.value.disableImageTranslator ? '已关闭' : '悬停图片');
const videoSummary = computed(() => config.value.videoTranslationEnabled ? `${videoServiceLabel.value} · YouTube` : '点击开启 · YouTube');
const drawerTitle = computed(() => ({ hover: '鼠标悬停翻译设置', selection: '划词翻译设置', floating: '全文悬浮球设置', appearance: '译文显示设置', image: '图片翻译设置', video: '视频字幕设置' }[activeDrawer.value]));
const drawerDescription = computed(() => ({
  hover: '把鼠标停在文本上，用轻量快捷键获取即时译文。',
  selection: '选中文字或圈选页面区域，按你的偏好获取译文。',
  floating: '把全文翻译入口固定在最顺手的位置。',
  appearance: '调整双语布局、译文样式与界面主题。',
  image: '把鼠标移到图片上，从图片右上角打开翻译入口。',
  video: '在 YouTube 播放器中显示实时字幕译文。',
}[activeDrawer.value]));
const hoverChoices = [
  { value: 'Control', label: 'Ctrl' },
  { value: 'Alt', label: 'Alt / Option' },
  { value: 'Shift', label: 'Shift' },
  { value: 'custom', label: '自定义' },
];
const selectionModes = [
  { value: 'bilingual', label: '双语显示' },
  { value: 'translation-only', label: '仅译文' },
];
const selectionTriggers = [
  { value: 'direct', label: '直接弹出' },
  { value: 'icon', label: '显示图标' },
  { value: 'dot', label: '显示小点' },
];

function applyTheme(theme: string) {
  document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'auto' && darkMode.matches));
}

async function hydrate() {
  await configReady;
  Object.assign(config.value, runtimeConfig);
  lastSerialized = JSON.stringify(config.value);
  hydrated.value = true;
  applyTheme(config.value.theme || 'auto');
}
void hydrate();

const unsubscribeConfig = subscribeConfig((value) => {
  const serialized = JSON.stringify(value);
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  applyingExternalConfig = true;
  try {
    Object.assign(config.value, value);
  } finally {
    applyingExternalConfig = false;
  }
});

watch(config, async value => {
  if (!hydrated.value || applyingExternalConfig) return;
  const serialized = JSON.stringify(value);
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  await persistConfig(value).catch((error) => console.warn('[FluentRead] 保存 popup 设置失败', error));
}, { deep: true, flush: 'sync' });
watch(() => config.value.theme, theme => applyTheme(theme || 'auto'));
darkMode.onchange = () => { if (config.value.theme === 'auto') applyTheme('auto'); };

function closeServicePicker(event?: Event) {
  if (event && servicePicker.value?.contains(event.target as Node)) return;
  servicePickerOpen.value = false;
}
function openDonation() { donationVisible.value = true; }
function closeDonation() { donationVisible.value = false; }
function handleDonationKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && donationVisible.value) closeDonation();
}
function handleServicePickerKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeServicePicker();
}
function toggleServicePicker() {
  if (!config.value.on) return;
  servicePickerOpen.value = !servicePickerOpen.value;
  if (servicePickerOpen.value) moreServicesOpen.value = !popularServiceValues.includes(config.value.service);
}
function selectService(value: string) {
  config.value.service = value;
  servicePickerOpen.value = false;
}
onMounted(() => {
  document.addEventListener('pointerdown', closeServicePicker);
  document.addEventListener('keydown', handleServicePickerKeydown);
  document.addEventListener('keydown', handleDonationKeydown);
});
onUnmounted(() => {
  persistOnPageExit();
  window.removeEventListener('pagehide', saveOnPageHide);
  unsubscribeConfig();
  document.removeEventListener('pointerdown', closeServicePicker);
  document.removeEventListener('keydown', handleServicePickerKeydown);
  document.removeEventListener('keydown', handleDonationKeydown);
  darkMode.onchange = null;
  if (noticeTimer) clearTimeout(noticeTimer);
});

function saveOnPageHide() {
  persistOnPageExit();
}
window.addEventListener('pagehide', saveOnPageHide);

// Firefox 可能同时触发 pagehide 和 unmounted；只提交一次最新快照。
function persistOnPageExit() {
  if (!hydrated.value || pageExitSaveStarted) return;
  pageExitSaveStarted = true;
  void saveConfig(config.value).catch((error) => console.warn('[FluentRead] popup 关闭前本地保存设置失败', error));
  void persistConfig(config.value).catch((error) => console.warn('[FluentRead] popup 关闭前后台保存设置失败', error));
}

function showNotice(message: string, type: 'success' | 'error' = 'success') {
  notice.value = message;
  noticeType.value = type;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.value = ''; }, 2200);
}

async function broadcast(message: Record<string, unknown>) {
  const tabs = await browser.tabs.query({});
  await Promise.allSettled(tabs.filter(tab => tab.id).map(tab => browser.tabs.sendMessage(tab.id!, message)));
}

function setPluginEnabled(enabled: boolean) {
  config.value.on = enabled;
  if (!enabled) {
    void broadcast({ type: 'toggleFloatingBall', isEnabled: false });
    void broadcast({ type: 'updateSelectionTranslatorMode', mode: 'disabled' });
    void broadcast({ type: 'toggleSelectionAreaTranslator', isEnabled: false });
    void broadcast({ type: 'toggleImageTranslator', isEnabled: false });
    return;
  }

  void broadcast({ type: 'toggleFloatingBall', isEnabled: !config.value.disableFloatingBall });
  void broadcast({ type: 'updateSelectionTranslatorMode', mode: config.value.selectionTranslatorMode });
  void broadcast({ type: 'toggleSelectionAreaTranslator', isEnabled: config.value.selectionAreaEnabled });
  void broadcast({ type: 'toggleImageTranslator', isEnabled: !config.value.disableImageTranslator });
}

function openDrawer(name: DrawerName) { activeDrawer.value = name; drawerVisible.value = true; }
async function openOptions(section?: SettingsSection) {
  if (section) {
    await browser.tabs.create({ url: `${browser.runtime.getURL('options.html')}#${section}` });
  } else {
    await browser.runtime.openOptionsPage();
  }
  window.close();
}

async function togglePageTranslation() {
  if (credentialWarning.value) {
    showNotice(credentialWarning.value, 'error');
    return;
  }

  translating.value = true;
  const action = pageTranslated.value ? 'restore' : 'fullPage';
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    const response = await browser.tabs.sendMessage(tab.id, { type: 'contextMenuTranslate', action }) as { status?: string } | undefined;
    if (response?.status !== 'success') throw new Error(response?.status === 'disabled' ? 'Plugin disabled' : 'Translation failed');
    pageTranslated.value = action === 'fullPage';
    showNotice(pageTranslated.value ? '正在翻译当前网页' : '已恢复网页原文');
  } catch (error) {
    console.error(error);
    showNotice('当前页面暂不支持翻译，请刷新后重试', 'error');
  } finally { translating.value = false; }
}

async function clearCache() {
  clearingCache.value = true;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    await browser.tabs.sendMessage(tab.id, { message: 'clearCache' });
    showNotice('全部翻译缓存已清除');
  } catch (error) {
    console.error(error);
    showNotice('缓存清除失败', 'error');
  } finally { clearingCache.value = false; }
}

function toggleHover() { config.value.hotkey = config.value.hotkey === 'none' ? 'Control' : 'none'; }
function setHoverHotkey(value: string) {
  config.value.hotkey = value;
  if (value === 'custom' && !config.value.customHotkey) showCustomMouseHotkeyDialog.value = true;
}
function setSelectionMode(mode: string) {
  config.value.selectionTranslatorMode = mode;
  config.value.disableSelectionTranslator = mode === 'disabled';
  void broadcast({ type: 'updateSelectionTranslatorMode', mode });
}
function setSelectionTrigger(trigger: string) {
  config.value.selectionTranslatorTrigger = trigger;
}
function setAreaEnabled(enabled: boolean) {
  config.value.selectionAreaEnabled = enabled;
  void broadcast({ type: 'toggleSelectionAreaTranslator', isEnabled: enabled });
}
function setFloatingEnabled(enabled: boolean) {
  config.value.disableFloatingBall = !enabled;
  void broadcast({ type: 'toggleFloatingBall', isEnabled: enabled });
}
function setImageTranslatorEnabled(enabled: boolean) {
  config.value.disableImageTranslator = !enabled;
  void broadcast({ type: 'toggleImageTranslator', isEnabled: enabled });
}
function setVideoTranslationEnabled(enabled: boolean) {
  config.value.videoTranslationEnabled = enabled;
}
function handleFloatingHotkeyChange() {
  if (config.value.floatingBallHotkey === 'custom' && !config.value.customFloatingBallHotkey) showCustomHotkeyDialog.value = true;
}
function confirmFloatingHotkey(hotkey: string) { config.value.customFloatingBallHotkey = hotkey; config.value.floatingBallHotkey = 'custom'; }
function cancelFloatingHotkey() { if (!config.value.customFloatingBallHotkey) config.value.floatingBallHotkey = 'Alt+T'; }
function confirmMouseHotkey(hotkey: string) { config.value.customHotkey = hotkey; config.value.hotkey = 'custom'; }
function cancelMouseHotkey() { if (!config.value.customHotkey) config.value.hotkey = 'Control'; }
</script>
