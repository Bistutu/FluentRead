/**
 * 快捷键处理工具函数
 */

// 支持的修饰键
export const MODIFIER_KEYS: Record<string, string[]> = {
  ctrl: ['control', 'ctrl'],
  alt: ['alt', 'option'],
  shift: ['shift'],
  meta: ['meta', 'cmd', 'command']
};

// 支持的普通按键
export const REGULAR_KEYS = {
  // 字母
  a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f', g: 'g', h: 'h', i: 'i', j: 'j',
  k: 'k', l: 'l', m: 'm', n: 'n', o: 'o', p: 'p', q: 'q', r: 'r', s: 's', t: 't',
  u: 'u', v: 'v', w: 'w', x: 'x', y: 'y', z: 'z',
  // 数字
  '0': '0', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  // 功能键
  f1: 'f1', f2: 'f2', f3: 'f3', f4: 'f4', f5: 'f5', f6: 'f6',
  f7: 'f7', f8: 'f8', f9: 'f9', f10: 'f10', f11: 'f11', f12: 'f12',
  // 特殊键
  space: 'space',
  enter: 'enter',
  escape: 'escape',
  tab: 'tab',
  backspace: 'backspace',
  delete: 'delete',
  insert: 'insert',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
  arrowup: 'arrowup',
  arrowdown: 'arrowdown',
  arrowleft: 'arrowleft',
  arrowright: 'arrowright',
  // 符号键
  '`': '`', '~': '~',
  '-': '-', '_': '_',
  '=': '=', '+': '+',
  '[': '[', '{': '{',
  ']': ']', '}': '}',
  '\\': '\\', '|': '|',
  ';': ';', ':': ':',
  "'": "'", '"': '"',
  ',': ',', '<': '<',
  '.': '.', '>': '>',
  '/': '/', '?': '?',
} as const;

// 快捷键解析结果接口
export interface ParsedHotkey {
  modifiers: string[];
  key: string;
  isValid: boolean;
  displayName: string;
  errorMessage?: string;
}

/**
 * 解析快捷键字符串
 * @param hotkeyString 快捷键字符串，如 "Ctrl+Alt+T"
 * @returns 解析结果
 */
export function parseHotkey(hotkeyString: string): ParsedHotkey {
  if (!hotkeyString || hotkeyString.trim() === '') {
    return {
      modifiers: [],
      key: '',
      isValid: false,
      displayName: '',
      errorMessage: '快捷键不能为空'
    };
  }

  const parts = hotkeyString.toLowerCase().split('+').map(part => part.trim());
  
  if (parts.length === 0) {
    return {
      modifiers: [],
      key: '',
      isValid: false,
      displayName: '',
      errorMessage: '无效的快捷键格式'
    };
  }

  const modifiers: string[] = [];
  let key = '';
  
  // 检查每个部分
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    
    if (i === parts.length - 1) {
      // 最后一个部分应该是普通按键
      if (REGULAR_KEYS[part as keyof typeof REGULAR_KEYS]) {
        key = part;
      } else {
        return {
          modifiers,
          key: part,
          isValid: false,
          displayName: '',
          errorMessage: `不支持的按键: ${part}`
        };
      }
    } else {
      // 前面的部分应该是修饰键
      let isValidModifier = false;
      for (const [modifierKey, aliases] of Object.entries(MODIFIER_KEYS)) {
        if (aliases.includes(part)) {
          if (!modifiers.includes(modifierKey)) {
            modifiers.push(modifierKey);
          }
          isValidModifier = true;
          break;
        }
      }
      
      if (!isValidModifier) {
        return {
          modifiers,
          key,
          isValid: false,
          displayName: '',
          errorMessage: `不支持的修饰键: ${part}`
        };
      }
    }
  }

  // 验证至少有一个修饰键（避免占用单个字母键）
  if (modifiers.length === 0 && key.length === 1 && /[a-z]/.test(key)) {
    return {
      modifiers,
      key,
      isValid: false,
      displayName: '',
      errorMessage: '单个字母键需要与修饰键组合使用'
    };
  }

  // 禁用包含 CMD/Meta 键的快捷键组合
  if (modifiers.includes('meta')) {
    return {
      modifiers,
      key,
      isValid: false,
      displayName: '',
      errorMessage: 'CMD 键已被禁用，请使用其他修饰键组合'
    };
  }

  // 生成显示名称
  const displayName = generateDisplayName(modifiers, key);
  
  return {
    modifiers,
    key,
    isValid: true,
    displayName,
  };
}

/**
 * 生成快捷键显示名称
 * @param modifiers 修饰键数组
 * @param key 普通按键
 * @returns 显示名称
 */
function generateDisplayName(modifiers: string[], key: string): string {
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const modifierDisplayNames: Record<string, string> = isMac ? 
    {
      ctrl: 'Control',
      alt: 'Option', 
      shift: 'Shift',
      meta: 'Cmd'
    } : 
    {
      ctrl: 'Ctrl',
      alt: 'Alt',
      shift: 'Shift', 
      meta: 'Win'
    };

  const keyDisplayName = key.charAt(0).toUpperCase() + key.slice(1);
  const modifierNames = modifiers.map(mod => modifierDisplayNames[mod] || mod);
  
  return [...modifierNames, keyDisplayName].join('+');
}

/**
 * 检查事件是否匹配指定的快捷键
 * @param event 键盘事件
 * @param parsedHotkey 解析后的快捷键
 * @returns 是否匹配
 */
export function matchesHotkey(event: KeyboardEvent, parsedHotkey: ParsedHotkey): boolean {
  if (!parsedHotkey.isValid) return false;

  // 检查修饰键
  const requiredModifiers = new Set(parsedHotkey.modifiers);
  const actualModifiers = new Set();
  
  if (event.ctrlKey) actualModifiers.add('ctrl');
  if (event.altKey) actualModifiers.add('alt');
  if (event.shiftKey) actualModifiers.add('shift');
  if (event.metaKey) actualModifiers.add('meta');

  // 修饰键必须完全匹配
  if (requiredModifiers.size !== actualModifiers.size) return false;
  for (const modifier of requiredModifiers) {
    if (!actualModifiers.has(modifier)) return false;
  }

  // 检查普通按键
  const eventKey = event.key.toLowerCase();
  const eventCode = event.code?.toLowerCase();
  
  // 处理特殊按键映射
  const keyMappings: Record<string, string[]> = {
    'space': [' ', 'space'],
    'enter': ['enter', 'return'],
    'escape': ['escape', 'esc'],
    'backspace': ['backspace'],
    'delete': ['delete', 'del'],
    'tab': ['tab'],
    'arrowup': ['arrowup', 'up'],
    'arrowdown': ['arrowdown', 'down'],
    'arrowleft': ['arrowleft', 'left'],
    'arrowright': ['arrowright', 'right'],
  };

  if (keyMappings[parsedHotkey.key]) {
    return keyMappings[parsedHotkey.key].includes(eventKey) || 
           keyMappings[parsedHotkey.key].some(k => eventCode?.includes(k));
  }

  // 普通字母数字键
  if (/^[a-z0-9]$/.test(parsedHotkey.key)) {
    return eventKey === parsedHotkey.key || eventCode === `key${parsedHotkey.key}`;
  }

  // 功能键
  if (/^f\d+$/.test(parsedHotkey.key)) {
    return eventKey === parsedHotkey.key || eventCode === parsedHotkey.key;
  }

  // 符号键直接比较
  return eventKey === parsedHotkey.key;
}

/**
 * 验证快捷键是否与系统快捷键冲突
 * @param parsedHotkey 解析后的快捷键
 * @returns 冲突信息
 */
export function validateHotkeyConflicts(parsedHotkey: ParsedHotkey): { 
  hasConflict: boolean; 
  conflictDescription?: string 
} {
  if (!parsedHotkey.isValid) {
    return { hasConflict: false };
  }

  const { modifiers, key } = parsedHotkey;
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  // 常见的系统快捷键冲突检测
  const commonConflicts = [
    // Windows/Linux 系统快捷键
    { modifiers: ['ctrl'], key: 'c', desc: '复制' },
    { modifiers: ['ctrl'], key: 'v', desc: '粘贴' },
    { modifiers: ['ctrl'], key: 'x', desc: '剪切' },
    { modifiers: ['ctrl'], key: 'z', desc: '撤销' },
    { modifiers: ['ctrl'], key: 'y', desc: '重做' },
    { modifiers: ['ctrl'], key: 'a', desc: '全选' },
    { modifiers: ['ctrl'], key: 's', desc: '保存' },
    { modifiers: ['ctrl'], key: 'o', desc: '打开' },
    { modifiers: ['ctrl'], key: 'n', desc: '新建' },
    { modifiers: ['ctrl'], key: 'w', desc: '关闭标签页' },
    { modifiers: ['ctrl'], key: 't', desc: '新建标签页' },
    { modifiers: ['ctrl'], key: 'r', desc: '刷新页面' },
    { modifiers: ['ctrl'], key: 'f', desc: '查找' },
    { modifiers: ['ctrl'], key: 'h', desc: '历史记录' },
    { modifiers: ['ctrl'], key: 'd', desc: '添加书签' },
    { modifiers: ['alt'], key: 'f4', desc: '关闭程序' },
    { modifiers: ['ctrl', 'shift'], key: 't', desc: '重新打开关闭的标签页' },
    { modifiers: ['ctrl', 'shift'], key: 'n', desc: '无痕模式' },
    { modifiers: ['ctrl', 'shift'], key: 'delete', desc: '清除浏览数据' },
    
    // macOS 系统快捷键
    { modifiers: ['meta'], key: 'c', desc: '复制' },
    { modifiers: ['meta'], key: 'v', desc: '粘贴' },
    { modifiers: ['meta'], key: 'x', desc: '剪切' },
    { modifiers: ['meta'], key: 'z', desc: '撤销' },
    { modifiers: ['meta'], key: 'a', desc: '全选' },
    { modifiers: ['meta'], key: 's', desc: '保存' },
    { modifiers: ['meta'], key: 'o', desc: '打开' },
    { modifiers: ['meta'], key: 'n', desc: '新建' },
    { modifiers: ['meta'], key: 'w', desc: '关闭标签页' },
    { modifiers: ['meta'], key: 't', desc: '新建标签页' },
    { modifiers: ['meta'], key: 'r', desc: '刷新页面' },
    { modifiers: ['meta'], key: 'f', desc: '查找' },
    { modifiers: ['meta'], key: 'q', desc: '退出程序' },
    { modifiers: ['meta'], key: 'space', desc: 'Spotlight搜索' },
  ];

  for (const conflict of commonConflicts) {
    if (conflict.modifiers.length === modifiers.length && 
        conflict.key === key &&
        conflict.modifiers.every(mod => modifiers.includes(mod))) {
      return {
        hasConflict: true,
        conflictDescription: `与系统快捷键冲突: ${conflict.desc}`
      };
    }
  }

  return { hasConflict: false };
}

/**
 * 预设的快捷键选项
 */
export const PRESET_HOTKEYS = [
  { value: "Alt+T", label: "Alt+T / Option+T" },
  { value: "Alt+A", label: "Alt+A / Option+A" },
  { value: "Alt+S", label: "Alt+S / Option+S" },
  { value: "Alt+D", label: "Alt+D / Option+D" },
  { value: "Alt+Q", label: "Alt+Q / Option+Q" },
  { value: "Ctrl+Alt+T", label: "Ctrl+Alt+T / Control+Option+T" },
  { value: "Ctrl+Alt+A", label: "Ctrl+Alt+A / Control+Option+A" },
  { value: "Ctrl+Shift+T", label: "Ctrl+Shift+T / Control+Shift+T" },
  { value: "Ctrl+Shift+A", label: "Ctrl+Shift+A / Control+Shift+A" },
  { value: "F9", label: "F9" },
  { value: "F10", label: "F10" },
  { value: "F11", label: "F11" },
  { value: "F12", label: "F12" },
  { value: "none", label: "禁用快捷键" },
  { value: "custom", label: "自定义快捷键..." },
];
