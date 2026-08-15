import { defaultOption, services } from "./option";
import { normalizeCustomBodyMapping } from "./custom-body";

export type DeepSeekApiType = 'auto' | 'responses' | 'chat';
export type DeepSeekThinkingMode = 'enabled' | 'disabled';

interface IMapping {
    [key: string]: string;
}

// 内包，存储额外信息
interface IExtra {
    [key: string]: any
}

export class Config {
    on: boolean; // 是否开启
    autoTranslate: boolean; // 是否即时翻译
    from: string;
    to: string;
    hotkey: string;
    style: number;
    display: number = 1;
    service: string;
    token: IMapping;
    ak: string;
    sk: string;
    appid: string;
    key: string;
    model: IMapping;
    customModel: IMapping;  // 自定义模型名称
    customBody: IMapping;  // 自定义请求体（JSON 字符串，按服务存储），会合并进请求体
    proxy: IMapping;  // 代理地址
    custom: string; // 本地服务地址
    extra: IExtra;  // 额外信息（内包信息）
    robot_id: IMapping;  // 机器人 ID（兼容 coze）
    system_role: IMapping;
    user_role: IMapping;
    count: number;  // 翻译次数
    theme: string;  // 主题模式：'auto' | 'light' | 'dark'
    useCache: boolean; // 是否使用缓存
    disableFloatingBall: boolean; // 是否禁用悬浮球
    floatingBallPosition: 'left' | 'right'; // 悬浮球位置
    floatingBallHotkey: string; // 悬浮球快捷键
    customFloatingBallHotkey: string; // 自定义悬浮球快捷键
    customHotkey: string; // 自定义鼠标悬浮快捷键
    disableSelectionTranslator: boolean; // 是否禁用划词翻译
    deeplx: string; // DeepLX 服务地址
    selectionTranslatorMode: string; // 划词翻译显示模式: 'disabled' | 'bilingual' | 'translation-only'
    newApiUrl: string; // NewAPI地址
    maxConcurrentTranslations: number; // 最大并发翻译数量
    youdaoAppKey: string; // 有道翻译 App Key
    youdaoAppSecret: string; // 有道翻译 App Secret
    tencentSecretId: string; // 腾讯云 Secret ID
    tencentSecretKey: string; // 腾讯云 Secret Key
    azureOpenaiEndpoint: string; // Azure OpenAI 端点地址
    animations: boolean; // 是否启用动画效果
    translationStatus: boolean; // 是否启用全文翻译进度面板
    inputBoxTranslationTrigger: string; // 输入框翻译触发方式
    inputBoxTranslationTarget: string; // 输入框翻译目标语言
    deepseekApiType: DeepSeekApiType; // DeepSeek API 格式
    deepseekThinkingMode: DeepSeekThinkingMode; // DeepSeek Chat Completion 思考模式

    constructor() {
        this.on = true;
        this.autoTranslate = false;
        this.from = defaultOption.from;
        this.to = defaultOption.to;
        this.style = defaultOption.style;
        this.display = defaultOption.display;
        this.hotkey = defaultOption.hotkey;
        this.service = defaultOption.service;
        this.token = {};
        this.ak = '';
        this.sk = '';
        this.appid = '';
        this.key = '';
        this.model = {};
        this.customModel = {};
        this.customBody = {};
        this.proxy = {};
        this.custom = defaultOption.custom;
        this.extra = {};
        this.robot_id = {};
        this.system_role = systemRoleFactory();
        this.user_role = userRoleFactory();
        this.count = 0;
        this.theme = 'auto';  // 默认跟随系统
        this.useCache = true; // 默认开启缓存
        this.disableFloatingBall = false; // 默认启用悬浮球
        this.floatingBallPosition = 'right'; // 默认在右侧
        this.floatingBallHotkey = 'Alt+T'; // 默认快捷键为 Alt+T
        this.customFloatingBallHotkey = ''; // 自定义快捷键为空
        this.customHotkey = ''; // 自定义鼠标悬浮快捷键为空
        this.disableSelectionTranslator = false; // 默认不禁用划词翻译
        this.deeplx = ''; // DeepLX 默认服务地址
        this.selectionTranslatorMode = 'bilingual'; // 默认双语显示模式
        this.newApiUrl = 'http://localhost:3000'; // NewAPI 默认地址
        this.maxConcurrentTranslations = 6; // 默认最大并发数为6
        this.youdaoAppKey = ''; // 有道翻译 App Key
        this.youdaoAppSecret = ''; // 有道翻译 App Secret
        this.tencentSecretId = ''; // 腾讯云 Secret ID
        this.tencentSecretKey = ''; // 腾讯云 Secret Key
        this.azureOpenaiEndpoint = ''; // Azure OpenAI 端点地址
        this.animations = true; // 默认启用动画
        this.translationStatus = true; // 默认启用翻译进度面板
        this.inputBoxTranslationTrigger = 'disabled'; // 默认关闭输入框翻译
        this.inputBoxTranslationTarget = 'en'; // 默认翻译成英文
        this.deepseekApiType = 'auto'; // DeepSeek 默认自动选择 API 格式
        this.deepseekThinkingMode = 'disabled'; // 翻译默认关闭思考模式，降低延迟和输出噪音
    }
}

/**
 * 将存储或导入的普通对象补齐为当前配置结构，并迁移已退役的 DeepSeek 模型名。
 */
export function normalizeConfig(value: unknown): Config {
    const normalized = new Config();
    const source = value && typeof value === 'object' ? value as Partial<Config> : {};
    Object.assign(normalized, source);

    normalized.model = isRecord(source.model) ? {...source.model} : {};
    normalized.customModel = isRecord(source.customModel) ? {...source.customModel} : {};
    normalized.customBody = normalizeCustomBodyMapping(source.customBody);

    const selectedModel = normalized.model[services.deepseek];
    const configuredThinkingMode = source.deepseekThinkingMode;

    if (selectedModel === 'deepseek-chat') {
        normalized.model[services.deepseek] = 'deepseek-v4-flash';
        normalized.deepseekThinkingMode = 'disabled';
    } else if (selectedModel === 'deepseek-reasoner') {
        // 官方迁移指南要求 reasoner 使用 v4-flash 并显式开启 thinking。
        normalized.model[services.deepseek] = 'deepseek-v4-flash';
        normalized.deepseekThinkingMode = 'enabled';
    } else if (configuredThinkingMode !== 'enabled' && configuredThinkingMode !== 'disabled') {
        // 兼容 #219 的早期配置：该实现把 v4-pro 作为默认思考模型。
        normalized.deepseekThinkingMode = selectedModel === 'deepseek-v4-pro' ? 'enabled' : 'disabled';
    }

    if (!['auto', 'responses', 'chat'].includes(normalized.deepseekApiType)) {
        normalized.deepseekApiType = 'auto';
    }

    return normalized;
}

function isRecord(value: unknown): value is Record<string, string> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 构建所有服务的 system_role
function systemRoleFactory(): IMapping {
    let systems_role: IMapping = {};
    Object.keys(services).forEach(key => systems_role[key] = defaultOption.system_role);
    return systems_role;
}

// 构建所有服务的 user_role
function userRoleFactory(): IMapping {
    let users_role: IMapping = {};
    Object.keys(services).forEach(key => users_role[key] = defaultOption.user_role);
    return users_role;
}
