<!--
 @file src/ui/components/CustomHotkeyInput.vue
 文件职责：提供可复用的自定义快捷键对话框，支持键盘录制、预设选择、冲突校验、清除与无障碍确认流程。
 主要内容：通过 Teleport 渲染模态层，接收显示、当前值与业务校验 props，单计时器完成键盘录制；录制未完成时拒绝确认旧值，关闭、重开、配置变化与卸载清理旧录制，当前业务冲突随配置变化同步校验，清除和确认均校验业务冲突，异步焦点只归当前弹窗所有，发出 update、confirm、cancel。
 模块边界：组件只产生规范化快捷键值，不持久化配置、不绑定具体悬浮或划词动作，也不注册页面级永久监听；调用方决定上下文和保存策略，解析规则归 core/hotkey。
-->
<template>
  <Teleport to="body">
    <div
      v-ui-i18n
      v-if="dialogVisible"
      class="custom-hotkey-overlay"
      role="presentation"
      @keydown.esc="handleCancel"
    >
      <section
        ref="dialogRoot"
        class="custom-hotkey-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-hotkey-title"
        aria-describedby="custom-hotkey-description"
        tabindex="-1"
        @click.stop
        @keydown.tab="trapFocus"
      >
        <header class="dialog-header">
          <div class="dialog-heading">
            <h2 id="custom-hotkey-title">自定义快捷键</h2>
            <p id="custom-hotkey-description">为当前功能设置一个顺手、易记且不容易冲突的按键组合</p>
          </div>
          <button class="dialog-close" type="button" aria-label="关闭自定义快捷键" @click="handleCancel">
            <UiIcon name="close" />
          </button>
        </header>

        <div class="dialog-body">
          <section class="recording-card" :class="{ 'is-recording': isRecording }">
            <div class="section-heading">
              <div>
                <h3>按下你想使用的快捷键</h3>
              </div>
              <span class="state-badge" :class="{ active: isRecording, ready: !!currentHotkey && !isRecording }">
                {{ isRecording ? '录制中' : currentHotkey ? '已设置' : '待设置' }}
              </span>
            </div>

            <button
              ref="inputField"
              type="button"
              class="hotkey-input-field"
              :class="{
                recording: isRecording,
                error: !!errorMessage,
                warning: !!conflictWarning,
                success: isValidHotkey
              }"
              :aria-label="isRecording ? '正在录制快捷键，请按下组合键' : currentHotkey ? `当前快捷键为 ${displayHotkey}` : '点击开始录制快捷键'"
              @click="startRecording"
              @keydown="handleKeyDown"
              @keyup="handleKeyUp"
            >
              <span v-if="!isRecording && !currentHotkey" class="placeholder">
                点击后按下快捷键组合
              </span>
              <span v-else-if="isRecording" class="recording-text">
                <el-icon class="recording-icon"><Loading /></el-icon>
                正在录制，请按下快捷键…
              </span>
              <span v-else class="hotkey-display">
                <kbd>{{ displayHotkey }}</kbd>
              </span>
            </button>

            <p class="field-hint">支持 Ctrl、Alt、Shift 与字母或功能键组合；不支持使用 CMD/Meta 键</p>
          </section>

          <div
            v-if="errorMessage || conflictWarning || isValidHotkey"
            class="hotkey-status"
            :class="{ error: !!errorMessage, warning: !!conflictWarning && !errorMessage, success: isValidHotkey }"
            :role="errorMessage ? 'alert' : 'status'"
            aria-live="polite"
          >
            <el-icon v-if="errorMessage"><WarningFilled /></el-icon>
            <el-icon v-else-if="conflictWarning"><Warning /></el-icon>
            <el-icon v-else><CircleCheckFilled /></el-icon>
            <span>{{ errorMessage || conflictWarning || '快捷键有效，可以使用' }}</span>
          </div>

          <section class="preset-section">
            <div class="section-heading preset-heading">
              <div>
                <h3>推荐快捷键</h3>
              </div>
              <span class="section-note">也可以直接录制</span>
            </div>
            <div class="preset-buttons">
              <button
                v-for="preset in recommendedHotkeys"
                :key="preset.value"
                type="button"
                class="preset-button"
                :class="{ selected: currentHotkey === preset.value }"
                :aria-label="preset.label"
                :aria-pressed="currentHotkey === preset.value"
                @click="selectPreset(preset.value)"
              >
                <kbd>{{ preset.label }}</kbd>
              </button>
            </div>
          </section>

          <aside class="help-section">
            <span class="help-icon"><UiIcon name="info" :size="16" /></span>
            <p>建议使用修饰键组合，避免与浏览器、系统或网页已有快捷键冲突。设置完成后，快捷键会立即应用。</p>
          </aside>
        </div>

        <footer class="dialog-footer">
          <button v-if="currentHotkey" class="clear-button" type="button" @click="clearHotkey">清除快捷键</button>
          <div class="dialog-actions">
            <button class="secondary-button" type="button" @click="handleCancel">取消</button>
            <button class="primary-button" type="button" :disabled="!canConfirm" @click="handleConfirm">确认</button>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts" name="CustomHotkeyInput">
import UiIcon from './UiIcon.vue'
import { ref, computed, nextTick, watch, watchEffect, onBeforeUnmount } from 'vue';
import { ElIcon } from 'element-plus';
import { Loading, WarningFilled, Warning, CircleCheckFilled } from '@element-plus/icons-vue';
import {
  normalizeHotkeyEventKey,
  parseHotkey,
  REGULAR_KEYS,
  validateHotkeyConflicts,
  type ParsedHotkey,
} from '@/src/core/hotkey';

// 组件输入
interface Props {
  modelValue: boolean;
  currentValue?: string;
  validate?: (hotkey: string) => string;
}

const props = withDefaults(defineProps<Props>(), {
  currentValue: ''
});

// 组件事件
interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'confirm', hotkey: string): void;
  (e: 'cancel'): void;
}

const emit = defineEmits<Emits>();

// 响应式数据
const dialogVisible = computed(() => props.modelValue);

const currentHotkey = ref(props.currentValue || '');
const isRecording = ref(false);
const pressedKeys = ref(new Set<string>());
const errorMessage = ref('');
const conflictWarning = ref('');
const inputField = ref<HTMLElement>();
const dialogRoot = ref<HTMLElement>();
const previouslyFocusedElement = ref<HTMLElement | null>(null);
let recordingTimer: ReturnType<typeof setTimeout> | null = null;
let recordingGeneration = 0;
let visibilityGeneration = 0;
let disposed = false;

function stopRecording() {
  if (recordingTimer !== null) clearTimeout(recordingTimer);
  recordingTimer = null;
  recordingGeneration += 1;
  isRecording.value = false;
  pressedKeys.value.clear();
}

// 解析当前快捷键
const parsedHotkey = computed<ParsedHotkey | null>(() => {
  if (!currentHotkey.value || currentHotkey.value === 'none') return null;
  return parseHotkey(currentHotkey.value);
});

const isValidHotkey = computed(() => Boolean(
  !isRecording.value && parsedHotkey.value?.isValid && !errorMessage.value && !conflictWarning.value,
));

const displayHotkey = computed(() => {
  if (currentHotkey.value === 'none') return '已禁用';
  return parsedHotkey.value?.displayName || currentHotkey.value;
});

// 检查是否可以确认
const canConfirm = computed(() => {
  return !isRecording.value && (currentHotkey.value === 'none' || Boolean(parsedHotkey.value?.isValid)) && !errorMessage.value;
});

// 推荐的快捷键
const recommendedHotkeys = [
  { value: 'Alt+T', label: 'Alt+T' },
  { value: 'Alt+Q', label: 'Alt+Q' },
  { value: 'Alt+D', label: 'Alt+D' },
  { value: 'F9', label: 'F9' },
  { value: 'F10', label: 'F10' },
];

// 监听当前值变化
watch(() => props.currentValue, (newValue) => {
  stopRecording();
  currentHotkey.value = newValue || '';
});

watch(dialogVisible, (visible) => {
  const generation = ++visibilityGeneration;
  stopRecording();
  if (visible) {
    currentHotkey.value = props.currentValue || '';
    errorMessage.value = '';
    conflictWarning.value = '';
    validateCurrentHotkey(currentHotkey.value);
    previouslyFocusedElement.value = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    nextTick(() => {
      if (!disposed && generation === visibilityGeneration && dialogVisible.value) dialogRoot.value?.focus({preventScroll: true});
    });
  } else {
    restorePreviousFocus();
  }
}, {immediate: true});

function restorePreviousFocus() {
  const previous = previouslyFocusedElement.value;
  const root = dialogRoot.value;
  previouslyFocusedElement.value = null;
  if (!previous) return;
  nextTick(() => {
    const current = document.activeElement;
    if (previous.isConnected && (!current || current === document.body || root?.contains(current))) previous.focus({preventScroll: true});
  });
}
onBeforeUnmount(() => {disposed = true; visibilityGeneration += 1; stopRecording(); restorePreviousFocus();});

function trapFocus(event: KeyboardEvent) {
  const root = dialogRoot.value;
  if (!root) return;
  const focusable = [...root.querySelectorAll<HTMLElement>(
    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )].filter(element => element.getClientRects().length > 0);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (!activeElement || !focusable.includes(activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// 业务校验会读取当前功能的响应式快捷键配置；冲突变化时无需重录同一个值。
watchEffect(() => {
  if (!isRecording.value) validateCurrentHotkey(currentHotkey.value);
});

// 验证当前快捷键
function validateCurrentHotkey(hotkeyString: string) {
  errorMessage.value = '';
  conflictWarning.value = '';

  if (!hotkeyString) return;
  if (hotkeyString === 'none') {
    // 清除可能回到业务默认组合，是否被占用由调用方决定。
    errorMessage.value = props.validate?.(hotkeyString) || '';
    return;
  }

  const parsed = parseHotkey(hotkeyString);

  if (!parsed.isValid) {
    errorMessage.value = parsed.errorMessage || '无效的快捷键';
    return;
  }

  const contextualError = props.validate?.(hotkeyString) || '';
  if (contextualError) {
    errorMessage.value = contextualError;
    return;
  }

  // 检查冲突
  const conflictCheck = validateHotkeyConflicts(parsed);
  if (conflictCheck.hasConflict) {
    conflictWarning.value = conflictCheck.conflictDescription || '可能存在冲突';
  }
}

// 开始录制快捷键
async function startRecording() {
  if (disposed || !dialogVisible.value || isRecording.value) return;

  stopRecording();
  const generation = recordingGeneration;
  isRecording.value = true;
  pressedKeys.value.clear();
  errorMessage.value = '';
  conflictWarning.value = '';

  // 聚焦输入框
  await nextTick();
  if (!disposed && generation === recordingGeneration && dialogVisible.value && isRecording.value) inputField.value?.focus();
}

// 处理按键按下
function handleKeyDown(event: KeyboardEvent) {
  if (disposed || !dialogVisible.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    handleCancel();
    return;
  }
  if (!isRecording.value) return;

  event.preventDefault();
  event.stopPropagation();

  // 记录按下的键
  if (event.ctrlKey) pressedKeys.value.add('ctrl');
  if (event.altKey) pressedKeys.value.add('alt');
  if (event.shiftKey) pressedKeys.value.add('shift');
  if (event.metaKey) pressedKeys.value.add('meta');

  // 处理普通按键
  const key = normalizeHotkeyEventKey(event);

  // 忽略单独的修饰键
  if (['ctrl', 'alt', 'shift', 'meta'].includes(key)) {
    return;
  }

  // 只记录规则引擎支持的逻辑键；录制与页面运行时必须采用同一种布局语义。
  if (Object.prototype.hasOwnProperty.call(REGULAR_KEYS, key)) pressedKeys.value.add(key);
}

// 处理按键释放
function handleKeyUp(event: KeyboardEvent) {
  if (disposed || !dialogVisible.value || !isRecording.value) return;

  event.preventDefault();
  event.stopPropagation();

  // 尚无普通键时立即清空草稿；已有普通键则保留组合，允许先释放修饰键。
  if (![...pressedKeys.value].some(key => Object.prototype.hasOwnProperty.call(REGULAR_KEYS, key))) pressedKeys.value.clear();

  // 延迟一点再生成快捷键，确保所有键都被记录
  if (recordingTimer !== null) clearTimeout(recordingTimer);
  recordingTimer = setTimeout(() => {
    recordingTimer = null;
    if (!disposed && dialogVisible.value && isRecording.value && pressedKeys.value.size > 0) {
      generateHotkeyFromKeys();
    }
  }, 100);
}

// 从按键生成快捷键字符串
function generateHotkeyFromKeys() {
  const modifiers: string[] = [];
  let regularKey = '';

  // 提取修饰键
  if (pressedKeys.value.has('ctrl')) modifiers.push('Ctrl');
  if (pressedKeys.value.has('alt')) modifiers.push('Alt');
  if (pressedKeys.value.has('shift')) modifiers.push('Shift');
  if (pressedKeys.value.has('meta')) modifiers.push('Meta');

  // 提取普通按键（找到最后一个非修饰键）
  for (const key of pressedKeys.value) {
    if (!['ctrl', 'alt', 'shift', 'meta'].includes(key)) {
      regularKey = key.toUpperCase();
    }
  }

  if (!regularKey) {
    // 等待期间新按下修饰键仍不算完成一次录制；普通键会重新记录当时仍按住的修饰键。
    pressedKeys.value.clear();
    return;
  }

  currentHotkey.value = [...modifiers, regularKey].join('+');
  stopRecording();
}

// 选择预设快捷键
function selectPreset(value: string) {
  currentHotkey.value = value;
  stopRecording();
}

// 清除快捷键
function clearHotkey() {
  currentHotkey.value = 'none';
  stopRecording();
  validateCurrentHotkey(currentHotkey.value);
}

// 确认
function handleConfirm() {
  if (disposed || !dialogVisible.value) return;
  validateCurrentHotkey(currentHotkey.value);
  if (!canConfirm.value) return;

  emit('confirm', currentHotkey.value);
}

// 取消
function handleCancel() {
  currentHotkey.value = props.currentValue || '';
  stopRecording();
  errorMessage.value = '';
  conflictWarning.value = '';
  emit('cancel');
  emit('update:modelValue', false);
}
</script>

<style scoped>
.custom-hotkey-overlay {
  position: fixed; z-index: 3000; inset: 0;
  display: flex; align-items: center; justify-content: center;
  padding: 20px; overflow-y: auto; background: rgba(23, 32, 51, .38);
  backdrop-filter: blur(4px); font-family: inherit;
}
.custom-hotkey-dialog {
  display: flex; flex-direction: column; width: min(500px, 100%);
  max-height: calc(100dvh - 40px); min-height: 0; overflow: hidden;
  border: 1px solid var(--line); border-radius: 16px; outline: none;
  color: var(--ink); background: var(--surface); box-shadow: 0 16px 48px rgba(23,32,51,.16);
}
.dialog-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 20px 22px 16px; border-bottom: 1px solid var(--line); }
.dialog-heading, .section-heading { min-width: 0; }
.dialog-heading h2, .section-heading h3 { margin: 0; color: var(--ink); font-weight: 600; line-height: 1.4; }
.dialog-heading h2 { font-size: 18px; }
.dialog-heading p { margin: 6px 0 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.dialog-close { display: grid; flex: none; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 8px; color: var(--muted); background: transparent; cursor: pointer; }
.dialog-close:hover { color: var(--ink); background: var(--surface-soft); }
.dialog-body { display: grid; gap: 20px; min-height: 0; padding: 20px 22px; overflow-y: auto; overscroll-behavior: contain; }
.recording-card { display: grid; gap: 12px; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.section-heading h3 { font-size: 13px; }
.state-badge { flex: none; padding: 3px 8px; border-radius: 6px; color: var(--muted); background: var(--surface-soft); font-size: 10px; white-space: nowrap; }
.state-badge.active, .state-badge.ready { color: var(--brand-strong); background: var(--brand-soft); }
.hotkey-input-field {
  display: flex; align-items: center; justify-content: center; width: 100%; min-height: 72px;
  padding: 14px; border: 1px dashed var(--line); border-radius: 10px;
  color: var(--muted); background: var(--surface-soft); cursor: pointer; font: inherit;
  transition: border-color 160ms ease, background 160ms ease;
}
.hotkey-input-field:hover { border-color: var(--brand); }
.hotkey-input-field.recording { border-style: solid; border-color: var(--brand); color: var(--brand-strong); background: var(--brand-soft); }
.hotkey-input-field.error, .hotkey-status.error { border-color: color-mix(in srgb,var(--fr-danger) 35%,var(--line)); color: var(--fr-danger); background: var(--fr-danger-soft); }
.hotkey-input-field.warning, .hotkey-status.warning { border-color: color-mix(in srgb,var(--fr-warning) 35%,var(--line)); color: var(--fr-warning); background: var(--fr-warning-soft); }
.hotkey-input-field.success { border-style: solid; border-color: var(--line); color: var(--ink); background: var(--surface-soft); }
.placeholder, .recording-text { font-size: 13px; }
.recording-text { display: inline-flex; align-items: center; gap: 8px; }
.recording-icon { animation: hotkey-spin 1s linear infinite; }
@keyframes hotkey-spin { to { transform: rotate(360deg); } }
.hotkey-display kbd, .preset-button kbd { font-family: 'SFMono-Regular', 'SF Mono', monospace; font-size: 12px; font-weight: 500; }
.hotkey-display kbd { padding: 7px 12px; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 7px; color: var(--ink); background: var(--surface); font-size: 16px; }
.field-hint, .section-note { color: var(--muted); font-size: 11px; line-height: 1.6; }
.field-hint { margin: 0; }
.section-note { flex: none; }
.hotkey-status { display: flex; align-items: flex-start; gap: 8px; padding: 9px 12px; border: 1px solid transparent; border-radius: 8px; font-size: 12px; line-height: 1.5; }
.hotkey-status.success { color: var(--fr-success); background: var(--fr-success-soft); }
.preset-section { display: grid; gap: 10px; }
.preset-buttons { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.preset-button { display: flex; min-height: 36px; align-items: center; justify-content: center; padding: 7px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); background: var(--surface); cursor: pointer; }
.preset-button:hover { border-color: var(--brand); background: var(--surface-soft); }
.preset-button.selected { border-color: var(--brand); color: var(--brand-strong); background: var(--brand-soft); }
.help-section { display: flex; align-items: flex-start; gap: 8px; color: var(--muted); }
.help-icon { display: flex; flex: none; margin-top: 2px; }
.help-section p { margin: 0; font-size: 11px; line-height: 1.6; }
.dialog-footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 22px; border-top: 1px solid var(--line); }
.dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-left: auto; }
.clear-button, .secondary-button, .primary-button { min-height: 36px; padding: 0 14px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 500; }
.clear-button { padding: 0; border: 0; color: var(--fr-danger); background: transparent; }
.clear-button:hover { text-decoration: underline; }
.secondary-button { border: 1px solid var(--line); color: var(--ink); background: var(--surface); }
.secondary-button:hover { background: var(--surface-soft); }
.primary-button { border: 1px solid var(--brand); color: #fff; background: var(--brand); }
.primary-button:hover:not(:disabled) { background: var(--brand-strong); border-color: var(--brand-strong); }
.primary-button:disabled { border-color: var(--line); color: var(--muted); background: var(--surface-soft); cursor: not-allowed; }
.custom-hotkey-dialog button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
@media (max-width: 560px) {
  .custom-hotkey-overlay { padding: 12px; }
  .custom-hotkey-dialog { max-height: calc(100dvh - 24px); }
  .dialog-header, .dialog-body { padding: 16px; }
  .dialog-footer { padding: 12px 16px; }
  .preset-buttons { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .section-note { display: none; }
}
@media (max-width: 360px) {
  .dialog-footer { align-items: stretch; flex-direction: column-reverse; }
  .dialog-actions { width: 100%; }
  .dialog-actions button { flex: 1; }
  .clear-button { align-self: flex-start; }
}
@media (prefers-reduced-motion: reduce) { .recording-icon { animation: none; } .hotkey-input-field { transition: none; } }
</style>
