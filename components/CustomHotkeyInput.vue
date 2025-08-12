<template>
  <div class="custom-hotkey-input">
    <!-- 自定义快捷键输入对话框 -->
    <el-dialog
      v-model="dialogVisible"
      title="自定义快捷键"
      width="300px"
      :close-on-click-modal="false"
      :modal="false"
      :append-to-body="true"
      :destroy-on-close="true"
      @close="handleCancel"
    >
      <div class="hotkey-input-container">
        <div class="input-section">
          <el-text class="input-label">
            请按下您想要设置的快捷键组合：
          </el-text>
          <div 
            class="hotkey-input-field"
            :class="{ 
              'recording': isRecording, 
              'error': errorMessage,
              'success': parsedHotkey?.isValid && !errorMessage 
            }"
            @click="startRecording"
            @keydown="handleKeyDown"
            @keyup="handleKeyUp"
            tabindex="0"
            ref="inputField"
          >
            <div v-if="!isRecording && !currentHotkey" class="placeholder">
              点击这里开始录制快捷键...
            </div>
            <div v-else-if="isRecording" class="recording-text">
              <el-icon class="recording-icon"><Loading /></el-icon>
              正在录制，请按下快捷键...
            </div>
            <div v-else-if="currentHotkey" class="hotkey-display">
              {{ parsedHotkey?.displayName || currentHotkey }}
            </div>
          </div>
          
          <!-- 错误提示 -->
          <div v-if="errorMessage" class="error-message">
            <el-icon><WarningFilled /></el-icon>
            {{ errorMessage }}
          </div>
          
          <!-- 冲突警告 -->
          <div v-if="conflictWarning" class="warning-message">
            <el-icon><Warning /></el-icon>
            {{ conflictWarning }}
          </div>
          
          <!-- 成功提示 -->
          <div v-if="parsedHotkey?.isValid && !errorMessage && !conflictWarning" class="success-message">
            <el-icon><CircleCheckFilled /></el-icon>
            快捷键有效，可以使用
          </div>
        </div>

        <!-- 预设快捷键推荐 -->
        <div class="preset-section">
          <el-text class="section-title">或选择推荐的快捷键：</el-text>
          <div class="preset-buttons">
            <el-button
              v-for="preset in recommendedHotkeys"
              :key="preset.value"
              size="small"
              :type="currentHotkey === preset.value ? 'primary' : 'default'"
              @click="selectPreset(preset.value)"
              class="preset-button"
            >
              {{ preset.label }}
            </el-button>
          </div>
        </div>

        <!-- 简化说明 -->
        <div class="help-section">
          <el-text size="small" type="info">
            提示：建议使用修饰键组合（如 Ctrl+字母），避免与系统快捷键冲突。注意：不能使用 CMD 充当快捷键
          </el-text>
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="handleCancel">取消</el-button>
          <el-button @click="clearHotkey" v-if="currentHotkey">清除</el-button>
          <el-button 
            type="primary" 
            @click="handleConfirm"
            :disabled="!canConfirm"
          >
            确认
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts" name="CustomHotkeyInput">
import { ref, computed, nextTick, watch } from 'vue';
import { ElDialog, ElButton, ElText, ElIcon, ElCollapse, ElCollapseItem } from 'element-plus';
import { Loading, WarningFilled, Warning, CircleCheckFilled } from '@element-plus/icons-vue';
import { parseHotkey, matchesHotkey, validateHotkeyConflicts, type ParsedHotkey } from '@/entrypoints/utils/hotkey';

// Props
interface Props {
  modelValue: boolean;
  currentValue?: string;
}

const props = withDefaults(defineProps<Props>(), {
  currentValue: ''
});

// Emits
interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'confirm', hotkey: string): void;
  (e: 'cancel'): void;
}

const emit = defineEmits<Emits>();

// 响应式数据
const dialogVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});

const currentHotkey = ref(props.currentValue || '');
const isRecording = ref(false);
const pressedKeys = ref(new Set<string>());
const errorMessage = ref('');
const conflictWarning = ref('');
const inputField = ref<HTMLElement>();

// 解析当前快捷键
const parsedHotkey = computed<ParsedHotkey | null>(() => {
  if (!currentHotkey.value || currentHotkey.value === 'none') return null;
  return parseHotkey(currentHotkey.value);
});

// 检查是否可以确认
const canConfirm = computed(() => {
  return currentHotkey.value === 'none' || 
         (parsedHotkey.value?.isValid && !errorMessage.value);
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
  currentHotkey.value = newValue || '';
});

// 监听快捷键变化，进行验证
watch(currentHotkey, (newValue) => {
  validateCurrentHotkey(newValue);
});

// 验证当前快捷键
function validateCurrentHotkey(hotkeyString: string) {
  errorMessage.value = '';
  conflictWarning.value = '';
  
  if (!hotkeyString || hotkeyString === 'none') return;
  
  const parsed = parseHotkey(hotkeyString);
  
  if (!parsed.isValid) {
    errorMessage.value = parsed.errorMessage || '无效的快捷键';
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
  if (isRecording.value) return;
  
  isRecording.value = true;
  pressedKeys.value.clear();
  errorMessage.value = '';
  conflictWarning.value = '';
  
  // 聚焦输入框
  await nextTick();
  inputField.value?.focus();
}

// 处理按键按下
function handleKeyDown(event: KeyboardEvent) {
  if (!isRecording.value) return;
  
  event.preventDefault();
  event.stopPropagation();
  
  // 记录按下的键
  if (event.ctrlKey) pressedKeys.value.add('ctrl');
  if (event.altKey) pressedKeys.value.add('alt');
  if (event.shiftKey) pressedKeys.value.add('shift');
  if (event.metaKey) pressedKeys.value.add('meta');
  
  // 处理普通按键
  const key = event.key.toLowerCase();
  const code = event.code?.toLowerCase();
  
  // 忽略单独的修饰键
  if (['control', 'alt', 'shift', 'meta'].includes(key)) {
    return;
  }
  
  // 记录普通按键
  if (key.length === 1) {
    pressedKeys.value.add(key);
  } else if (code?.startsWith('key')) {
    pressedKeys.value.add(code.slice(3));
  } else if (/^f\d+$/.test(key)) {
    pressedKeys.value.add(key);
  } else {
    // 特殊键处理
    const specialKeys = {
      'escape': 'escape',
      'enter': 'enter',
      'space': 'space',
      'tab': 'tab',
      'backspace': 'backspace',
      'delete': 'delete',
      'arrowup': 'arrowup',
      'arrowdown': 'arrowdown',
      'arrowleft': 'arrowleft',
      'arrowright': 'arrowright'
    };
    
    if (specialKeys[key as keyof typeof specialKeys]) {
      pressedKeys.value.add(specialKeys[key as keyof typeof specialKeys]);
    }
  }
}

// 处理按键释放
function handleKeyUp(event: KeyboardEvent) {
  if (!isRecording.value) return;
  
  event.preventDefault();
  event.stopPropagation();
  
  // 延迟一点再生成快捷键，确保所有键都被记录
  setTimeout(() => {
    if (pressedKeys.value.size > 0) {
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
  
  if (regularKey) {
    currentHotkey.value = [...modifiers, regularKey].join('+');
  }
  
  isRecording.value = false;
  pressedKeys.value.clear();
}

// 选择预设快捷键
function selectPreset(value: string) {
  currentHotkey.value = value;
  isRecording.value = false;
  pressedKeys.value.clear();
}

// 清除快捷键
function clearHotkey() {
  currentHotkey.value = '';
  isRecording.value = false;
  pressedKeys.value.clear();
  errorMessage.value = '';
  conflictWarning.value = '';
}

// 确认
function handleConfirm() {
  if (!canConfirm.value) return;
  
  emit('confirm', currentHotkey.value);
  dialogVisible.value = false;
}

// 取消
function handleCancel() {
  currentHotkey.value = props.currentValue || '';
  isRecording.value = false;
  pressedKeys.value.clear();
  errorMessage.value = '';
  conflictWarning.value = '';
  emit('cancel');
  dialogVisible.value = false;
}
</script>

<style scoped>
.custom-hotkey-input {
  width: 100%;
}

.hotkey-input-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.input-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.input-label {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.hotkey-input-field {
  min-height: 50px;
  border: 2px solid var(--el-border-color);
  border-radius: 6px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-bg-color);
  position: relative;
}

.hotkey-input-field:hover {
  border-color: var(--el-color-primary);
}

.hotkey-input-field:focus {
  outline: none;
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8);
}

.hotkey-input-field.recording {
  border-color: var(--el-color-warning);
  background: var(--el-color-warning-light-9);
  animation: pulse 2s infinite;
}

.hotkey-input-field.error {
  border-color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}

.hotkey-input-field.success {
  border-color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 var(--el-color-warning-light-5); }
  70% { box-shadow: 0 0 0 8px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}

.placeholder {
  color: var(--el-text-color-placeholder);
  font-style: italic;
}

.recording-text {
  color: var(--el-color-warning);
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}

.recording-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.hotkey-display {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-color-primary);
  padding: 8px 16px;
  background: var(--el-color-primary-light-9);
  border-radius: 6px;
  border: 1px solid var(--el-color-primary-light-7);
}

.error-message {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--el-color-danger);
  font-size: 14px;
  padding: 8px 12px;
  background: var(--el-color-danger-light-9);
  border-radius: 6px;
  border: 1px solid var(--el-color-danger-light-7);
}

.warning-message {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--el-color-warning);
  font-size: 14px;
  padding: 8px 12px;
  background: var(--el-color-warning-light-9);
  border-radius: 6px;
  border: 1px solid var(--el-color-warning-light-7);
}

.success-message {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--el-color-success);
  font-size: 14px;
  padding: 8px 12px;
  background: var(--el-color-success-light-9);
  border-radius: 6px;
  border: 1px solid var(--el-color-success-light-7);
}

.preset-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.preset-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.preset-button {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}

.help-section {
  margin-top: 4px;
}

.help-content {
  padding: 0 4px;
}

.help-content h4 {
  margin: 16px 0 8px 0;
  color: var(--el-text-color-primary);
  font-size: 14px;
}

.help-content ul {
  margin: 8px 0;
  padding-left: 20px;
}

.help-content li {
  margin: 4px 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.5;
}

.help-content strong {
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
