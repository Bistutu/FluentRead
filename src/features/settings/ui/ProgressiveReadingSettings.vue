<!--
 * @file src/features/settings/ui/ProgressiveReadingSettings.vue
 * 文件职责：在网页翻译设置中介绍学习面板，并提供默认仅点击、可选自定义快捷键的入口。
 * 主要内容：复用录制对话框和配置归属草稿，确认时重新检查既有动作与纯修饰键冲突；取消保持旧配置，清除后不再监听快捷键，隐藏或配置更换使旧确认失效。
 * 模块边界：只修改传入的配置偏好，不持久化、不监听网页、不改变四种阅读方式；纯按键规则归 core/config/progressiveReading，统一保存由设置中心负责。
 -->
<template>
  <SettingsGroup :title="t('progressiveReading.settings.title')" :description="t('progressiveReading.entry.description')">
    <SettingsItem :label="t('progressiveReading.settings.hotkey')" :description="t('progressiveReading.settings.hotkeyDescription')">
      <div class="reading-hotkey-config">
        <el-select :model-value="props.config.progressiveReadingHotkey" data-testid="progressive-reading-hotkey" :aria-label="t('progressiveReading.settings.hotkey')" @change="handleHotkeyChange">
          <el-option value="none" :label="t('progressiveReading.settings.none')" />
          <el-option value="custom" :label="t('progressiveReading.settings.custom')" />
        </el-select>
        <div v-if="props.config.progressiveReadingHotkey === 'custom'" class="reading-hotkey-custom">
          <span data-i18n-ignore>{{ hotkeyDisplayName }}</span>
          <el-button size="small" type="text" data-testid="progressive-reading-hotkey-edit" :aria-label="t('progressiveReading.settings.edit')" :title="t('progressiveReading.settings.edit')" @click="openCustomHotkeyDialog"><el-icon><Edit /></el-icon></el-button>
        </div>
      </div>
    </SettingsItem>
  </SettingsGroup>
  <CustomHotkeyInput v-model="showCustomHotkeyDialog" :current-value="props.config.customProgressiveReadingHotkey" :validate="findHotkeyConflict" @confirm="handleCustomHotkeyConfirm" @cancel="closeCustomHotkeyDialog" />
</template>
<script setup lang="ts">
import {computed, defineAsyncComponent} from 'vue';
import {Edit} from '@element-plus/icons-vue';
import {ElMessage} from 'element-plus';
import type {Config} from '@/src/core/config/model';
import {findProgressiveReadingHotkeyConflict, normalizeCustomProgressiveReadingHotkey, progressiveReadingHotkeyDisplayName} from '@/src/core/config/progressiveReading';
import {useUiI18n} from '@/src/ui/i18n';
import {useHotkeyDraft} from './useHotkeyDraft';
import SettingsGroup from './components/SettingsGroup.vue';
import SettingsItem from './components/SettingsItem.vue';
const CustomHotkeyInput = defineAsyncComponent(() => import('@/src/ui/components/CustomHotkeyInput.vue'));
const props = withDefaults(defineProps<{config: Config; active?: boolean}>(), {active: true});
const {t} = useUiI18n();
const {active: editorActive, showCustomHotkeyDialog, isCurrentDraft, openCustomHotkeyDialog, closeCustomHotkeyDialog, commitHotkeyDraft} = useHotkeyDraft(
    () => props.config, {mode: 'progressiveReadingHotkey', custom: 'customProgressiveReadingHotkey'}, () => props.active,
);
const hotkeyDisplayName = computed(() => progressiveReadingHotkeyDisplayName(props.config.progressiveReadingHotkey, props.config.customProgressiveReadingHotkey));
function findHotkeyConflict(hotkey: string): string {
    const owner = findProgressiveReadingHotkeyConflict(props.config, hotkey);
    if (!owner) return '';
    const labels = {hover: 'popup.hoverTranslation', page: 'quickTranslation.commonFullPageShortcut', selection: 'popup.selectionTranslation',
        area: 'popup.areaTranslation', paragraph: 'paragraphCopy.settings.title', section: 'sectionTranslation.settings.title',
        input: 'options.panel.input', highlight: 'informationHighlight.title', profile: 'progressiveReading.settings.profiles'};
    return t('progressiveReading.settings.conflict', {feature: t(labels[owner])});
}
function handleHotkeyChange(value: string): void {
    if (!editorActive.value || !['none', 'custom'].includes(value)) return;
    if (value === 'custom') {
        if (!normalizeCustomProgressiveReadingHotkey(props.config.customProgressiveReadingHotkey)) {openCustomHotkeyDialog();return;}
        const conflict = findHotkeyConflict(props.config.customProgressiveReadingHotkey);
        if (conflict) {ElMessage.warning(conflict);return;}
    }
    closeCustomHotkeyDialog();
    props.config.progressiveReadingHotkey = value;
}
function handleCustomHotkeyConfirm(hotkey: string): void {
    if (!isCurrentDraft()) {closeCustomHotkeyDialog();return;}
    const canonical = normalizeCustomProgressiveReadingHotkey(hotkey);
    if (hotkey !== 'none' && !canonical) return;
    const conflict = findHotkeyConflict(canonical);
    if (conflict) {ElMessage.warning(conflict);return;}
    if (!commitHotkeyDraft(canonical ? 'custom' : 'none', canonical)) return;
    ElMessage({message: canonical ? t('progressiveReading.settings.set', {shortcut: hotkeyDisplayName.value})
        : t('progressiveReading.entry.clickOnly'), type: 'success', duration: 2000});
}
</script>
<style scoped>
.reading-hotkey-config {display: flex; flex-direction: column; gap: 8px; width: 100%;}
.reading-hotkey-custom {display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 8px; border: 1px dashed var(--line, #e7e9f0); border-radius: 8px;}
.reading-hotkey-custom span {font-size: 12px; color: var(--ink, #172033); overflow-wrap: anywhere;}
</style>
