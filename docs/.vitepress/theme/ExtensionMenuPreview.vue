<!-- 按 PopupApp.vue、UiLanguageOnboarding.vue 及隔离浏览器中的真实界面缩绘；只演示界面，不读写扩展配置。 -->
<script setup lang="ts">
import { withBase } from 'vitepress'
import StepCallout from './StepCallout.vue'
const props = defineProps<{
  en?: boolean
  mode?: 'main' | 'welcome' | 'language' | 'hover' | 'selection'
  target?: 'hover' | 'selection' | 'translate' | 'language'
  number?: number
  restore?: boolean
}>()
const t = (zh: string, en: string) => (props.en ? en : zh)
const features = [
  { id: 'hover', icon: '↖', title: t('鼠标悬停翻译', 'Hover translation'), hint: 'Ctrl' },
  {
    id: 'selection',
    icon: '[I]',
    title: t('划词翻译', 'Selection translation'),
    hint: t('已关闭', 'Off'),
  },
  { id: 'image', icon: '▧', title: t('图片翻译', 'Image translation'), hint: 'Shift+Z' },
  {
    id: 'document',
    icon: '▤',
    title: t('文档翻译', 'Document translation'),
    hint: 'PDF / Word / …',
  },
]
</script>
<template>
  <div class="em" :class="{ 'em-onboarding': mode === 'welcome' || mode === 'language' }">
    <template v-if="mode === 'welcome' || mode === 'language'">
      <div class="em-brand">
        <img :src="withBase('/brand-icon.webp')" alt="" width="26" height="26" /><b>{{ t('流畅阅读', 'FluentRead') }}</b>
      </div>
      <template v-if="mode === 'welcome'">
        <div class="em-welcome-art" aria-hidden="true">
          <span
            v-for="word in [
              '你好',
              'Welcome',
              'こんにちは',
              '안녕하세요',
              'Bonjour',
              'Привет',
              'Hola',
              'Hallo',
              'Olá',
              'Ciao',
            ]"
            :key="word"
            >{{ word }}</span
          >
        </div>
        <strong class="em-welcome-title">欢迎使用<small>Welcome</small></strong>
        <p>让语言更近，让世界更大。<br />Closer languages. A bigger world.</p>
        <span class="em-action em-target">
          设置界面语言<small>Set interface language</small>
          <StepCallout
            :number="number ?? 2"
            :text="t('点击设置界面语言', 'Set the interface language')"
          />
        </span>
      </template>
      <template v-else>
        <strong class="em-welcome-title">设置界面语言<small>Set interface language</small></strong>
        <div class="em-language-options">
          <span :class="{ selected: !en }">简体中文 / Simplified Chinese</span
          ><span :class="{ selected: en }">英语 / English</span><span>日本語 / Japanese</span
          ><span>한국어 / Korean</span>
        </div>
        <span class="em-action em-target"
          >确认 / Confirm<StepCallout
            :number="number ?? 3"
            :text="t('选好语言后确认', 'Confirm your language')"
        /></span>
      </template>
    </template>
    <template v-else>
      <div class="em-main" :class="{ dimmed: mode === 'hover' || mode === 'selection' }">
        <header class="em-header">
          <div class="em-brand">
            <img :src="withBase('/brand-icon.webp')" alt="" width="22" height="22" /><span
              ><b>{{ t('流畅阅读', 'FluentRead') }}</b
              ><small>v0.0.35</small></span
            >
          </div>
          <span class="em-setting">⚙ {{ t('设置', 'Settings') }}</span>
        </header>
        <div class="em-translation-card">
          <div class="em-languages" :class="{ 'em-target em-room': target === 'language' }">
            <span
              ><small>{{ t('源语言', 'Source') }}</small
              ><b>{{ t('自动检测', 'Auto detect') }}⌄</b></span
            ><i>→</i
            ><span
              ><small>{{ t('目标语言', 'Target') }}</small
              ><b>{{ t('简体中文', 'English') }}⌄</b></span
            >
            <StepCallout
              v-if="target === 'language'"
              :number="number ?? 4"
              :text="t('确认目标语言', 'Check the target language')"
            />
          </div>
          <div class="em-providers">
            <b>{{ t('翻译服务', 'Translation providers') }}</b
            ><span>⇥ &nbsp; ›</span>
          </div>
          <div class="em-translate-row" :class="{ 'em-room': target === 'translate' }">
            <span class="em-action" :class="{ 'em-target': target === 'translate' }"
              >A↔译 &nbsp;{{
                restore
                  ? t('恢复当前网页', 'Restore this page')
                  : t('翻译当前网页', 'Translate this page')
              }}<StepCallout
                v-if="target === 'translate'"
                :number="number ?? 5"
                :text="
                  restore
                    ? t('恢复原文', 'Restore the original')
                    : t('点击翻译当前网页', 'Translate the webpage')
                " /></span
            ><span class="em-section">{{ t('局部', 'Section') }}</span>
          </div>
          <div class="em-site">
            <span>{{ t('始终翻译此网站', 'Always translate') }} ○</span
            ><span>{{ t('在此网站禁用扩展', 'Disable on this site') }} ○</span>
          </div>
        </div>
        <div
          class="em-features"
          :class="{ 'em-room': target === 'hover' || target === 'selection' }"
        >
          <span
            v-for="feature in features"
            :key="feature.id"
            class="em-feature"
            :class="{ 'em-target': target === feature.id }"
            ><i>{{ feature.icon }}</i
            ><span
              ><b>{{ feature.title }}</b
              ><small>{{ feature.hint }}</small></span
            ><StepCallout
              v-if="target === feature.id"
              :number="number ?? 1"
              :text="t('点击这张功能卡片', 'Open this feature card')"
          /></span>
        </div>
        <footer>
          <span>{{ t('已完成 0 次翻译', '0 translations') }}</span
          ><span>{{ t('开源项目', 'Open source') }} ↗</span
          ><span>{{ t('清除缓存', 'Clear cache') }}</span>
        </footer>
      </div>
      <div v-if="mode === 'hover' || mode === 'selection'" class="em-drawer">
        <div class="em-handle"></div>
        <strong
          >{{
            mode === 'hover'
              ? t('鼠标悬停翻译设置', 'Hover translation settings')
              : t('划词翻译设置', 'Selection translation settings')
          }}<span>×</span></strong
        >
        <p>
          {{
            mode === 'hover'
              ? t(
                  '将鼠标停在段落上，按快捷键查看译文。',
                  'Hover over a paragraph and press the shortcut.'
                )
              : t('选中网页文字，按你的偏好获取译文。', 'Select text to translate it.')
          }}
        </p>
        <div class="em-switch-row">
          <b>{{
            mode === 'hover'
              ? t('默认悬浮快捷键', 'Default hover shortcut')
              : t('划词翻译', 'Selection translation')
          }}</b
          ><span class="em-toggle em-target"
            ><i></i
            ><StepCallout :number="number ?? 2" :text="t('确认开关已开启', 'Turn the switch on')"
          /></span>
        </div>
        <div v-if="mode === 'hover'" class="em-key-preview">
          ↖ &nbsp; + &nbsp; <kbd>Control</kbd> &nbsp; = &nbsp; {{ t('即时翻译', 'Translate') }}
        </div>
        <div v-else class="em-selection-options">
          <small>{{ t('翻译模式', 'Translation mode') }}</small>
          <div>
            <span class="selected">{{ t('双语显示', 'Bilingual') }}</span
            ><span>{{ t('仅译文', 'Translation only') }}</span>
          </div>
          <small>{{ t('默认呈现', 'Default presentation') }}</small>
          <div>
            <span class="selected">{{ t('普通翻译', 'Simple translation') }}</span
            ><span>{{ t('卡片模式', 'Card mode') }}</span>
          </div>
        </div>
        <small class="em-more">{{ t('更多设置', 'More settings') }} ↗</small>
      </div>
    </template>
  </div>
</template>
<style scoped>
.em {
  position: absolute;
  top: 0;
  right: 10px;
  z-index: 3;
  width: 280px;
  max-width: calc(100% - 20px);
  padding: 12px;
  border: 1px solid #e1e4ee;
  border-radius: 0 0 10px 10px;
  background: white;
  box-shadow: 0 10px 28px #26232c16;
  color: #20283d;
  font-size: 10px;
  line-height: 1.5;
}
.em-header,
.em-brand {
  display: flex;
  align-items: center;
  gap: 7px;
}
.em-header {
  justify-content: space-between;
  margin-bottom: 10px;
}
.em-brand > span {
  display: flex;
  flex-direction: column;
}
.em b {
  font-size: 10px;
}
.em small {
  font-size: 8px;
  color: #7d879b;
}
.em-setting,
.em-section {
  padding: 5px 7px;
  border: 1px solid #e3e7f0;
  border-radius: 6px;
  white-space: nowrap;
}
.em-translation-card {
  padding: 10px;
  background: #f8f9fc;
  border: 1px solid #e1e4ee;
  border-radius: 10px;
}
.em-languages {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
}
.em-languages > span {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.em-languages b {
  display: flex;
  justify-content: space-between;
  padding: 6px;
  border: 1px solid #e1e4ee;
  border-radius: 6px;
  background: white;
}
.em-languages i {
  font-style: normal;
  color: #9ba4b5;
}
.em-providers {
  display: flex;
  justify-content: space-between;
  margin: 8px 0;
  padding: 8px;
  border: 1px solid #e1e4ee;
  border-radius: 6px;
}
.em-providers > span {
  color: #ec477b;
}
.em-translate-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.em-action {
  position: relative;
  display: block;
  flex: 1;
  padding: 9px 6px;
  border-radius: 7px;
  background: #f3447c;
  color: white;
  font-size: 10px;
  text-align: center;
}
.em-section {
  color: #ec477b;
  background: white;
}
.em-site {
  display: flex;
  gap: 5px;
  margin-top: 8px;
  font-size: 7px;
  color: #7d879b;
}
.em-site > span {
  border: 1px solid #e1e4ee;
  border-radius: 5px;
  padding: 3px;
}
.em-features {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  margin-top: 10px;
}
.em-feature {
  position: relative;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 5px;
  border: 1px solid #e1e4ee;
  border-radius: 8px;
}
.em-feature > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.em-feature b {
  font-size: 9px;
}
.em-feature i {
  padding: 4px;
  border-radius: 5px;
  background: #fff0f5;
  color: #ec477b;
  font-style: normal;
}
.em footer {
  display: flex;
  justify-content: space-between;
  gap: 5px;
  margin-top: 10px;
  color: #7d879b;
  font-size: 7px;
}
.em-target {
  position: relative;
  outline: 2px solid #b92252;
  outline-offset: 3px;
}
.em-room {
  margin-bottom: 58px;
}
.em-action :deep(.sc-end),
.em-languages :deep(.sc-end) {
  right: 8px;
}
.em-feature :deep(.sc-end) {
  right: -5px;
  max-width: 130px;
}
.em-onboarding {
  padding: 14px 14px 64px;
  border-radius: 12px;
  top: 12px;
}
.em-welcome-art {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 10px;
  margin: 10px 0;
  padding: 8px;
  border: 1px solid #f8d5e2;
  border-radius: 14px;
  background: linear-gradient(130deg, #fff1f6, #f1f6ff);
}
.em-welcome-art span {
  font-size: 8px;
  padding: 2px;
  border-radius: 15px;
  background: white;
  text-align: center;
  color: #ef447c;
  transform: rotate(-2deg);
  font-weight: 650;
}
.em-welcome-title {
  display: flex;
  flex-direction: column;
  margin: 12px 0 8px;
  font-size: 16px;
}
.em p {
  margin: 0 0 14px;
  color: #7d879b;
  font-size: 9px;
  line-height: 1.6;
}
.em-action small {
  display: block;
  color: white;
}
.em-language-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 14px 0;
}
.em-language-options > span {
  padding: 8px;
  border: 1px solid #e1e4ee;
  border-radius: 7px;
  font-size: 10px;
}
.em .selected {
  color: #ef447c;
  border-color: #f5abc4;
  background: #fff5f8;
}
.em-main.dimmed {
  filter: blur(1.5px);
  opacity: 0.3;
}
.em-drawer {
  position: absolute;
  inset: auto -1px -1px;
  padding: 10px 14px 14px;
  border: 1px solid #e1e4ee;
  border-radius: 14px 14px 0 0;
  background: white;
  box-shadow: 0 -18px 40px #20283d20;
}
.em-handle {
  width: 30px;
  height: 3px;
  margin: 0 auto 10px;
  border-radius: 4px;
  background: #e4e7ee;
}
.em-drawer > strong {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.em-drawer p {
  margin: 5px 0 10px;
}
.em-switch-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  margin-bottom: 64px;
  border: 1px solid #e1e4ee;
  border-radius: 7px;
  background: #f7f8fc;
}
.em-toggle {
  position: relative;
  width: 28px;
  height: 16px;
  border-radius: 10px;
  background: #f3447c;
}
.em-toggle > i {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: white;
}
.em-key-preview {
  padding: 10px 5px;
  border: 1px solid #e1e4ee;
  border-radius: 7px;
  background: #f7f8fc;
  text-align: center;
  font-size: 10px;
}
.em-key-preview kbd {
  padding: 5px 7px;
  border-radius: 5px;
  background: #262b36;
  color: white;
}
.em-more {
  display: block;
  margin-top: 12px;
}
.em-selection-options > div {
  display: flex;
  gap: 6px;
  margin: 5px 0 8px;
}
.em-selection-options > div > span {
  flex: 1;
  padding: 6px 3px;
  border: 1px solid #e1e4ee;
  border-radius: 5px;
  font-size: 9px;
  text-align: center;
}
@container (max-width:480px) {
  .em-action :deep(.sc-end) {
    max-width: 140px;
  }
  .em-feature b {
    font-size: 8px;
  }
  .em-feature {
    gap: 3px;
    padding-inline: 4px;
  }
  .em-feature :deep(.sc-end) {
    right: -8px;
    max-width: 105px;
  }
  .em-site {
    font-size: 6px;
  }
  .em-onboarding {
    padding-inline: 14px;
  }
}
</style>
