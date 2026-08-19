import { currentModelIds, defaultModels, defaultOption, services, servicesType } from "./option";
import type { MiniMaxBillingPlan, MiniMaxRegion } from "./option";
import { normalizeCustomBodyMapping } from "./custom-body";

export type DeepSeekApiType = 'auto' | 'responses' | 'chat';
export type DeepSeekThinkingMode = 'enabled' | 'disabled';
export type VideoSubtitleDisplayMode = 'bilingual' | 'translation-only' | 'original-only';
export const DEFAULT_VIDEO_SUBTITLE_FONT_SIZE = 100;
export const DEFAULT_NEW_API_URL = 'http://localhost:3000';
export const VIDEO_SUBTITLE_FONT_SIZE_OPTIONS = [80, 90, 100, 110, 120, 140, 160] as const;

export function normalizeVideoSubtitleFontSize(value: unknown): number {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number)) return DEFAULT_VIDEO_SUBTITLE_FONT_SIZE;
    return Math.min(160, Math.max(80, Math.round(number / 10) * 10));
}

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
    videoTranslationEnabled: boolean; // 是否启用视频字幕翻译 Beta
    videoService: string; // 视频字幕独立翻译服务
    videoServiceDefaultMigrated: boolean; // 是否已迁移视频字幕默认服务
    videoSubtitleVisible: boolean; // 是否显示 FluentRead 视频字幕
    videoSubtitleDisplayMode: VideoSubtitleDisplayMode; // 视频字幕显示模式
    videoSubtitleFontSize: number; // 视频字幕字号百分比
    token: IMapping;
    requireApiKey: Record<string, boolean>; // 按服务和模型保存 API Key 校验开关
    minimaxBillingPlan: MiniMaxBillingPlan; // MiniMax 计费方案
    minimaxRegion: MiniMaxRegion; // MiniMax API 区域
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
    enableAIContext: boolean; // 是否为 AI 翻译附加网页上下文
    contextMenuEnabled: boolean; // 是否显示右键全文翻译菜单
    disableFloatingBall: boolean; // 是否禁用悬浮球
    floatingBallPosition: 'left' | 'right'; // 悬浮球位置
    floatingBallHotkey: string; // 悬浮球快捷键
    customFloatingBallHotkey: string; // 自定义悬浮球快捷键
    customHotkey: string; // 自定义鼠标悬浮快捷键
    disableSelectionTranslator: boolean; // 是否禁用划词翻译
    selectionAreaEnabled: boolean; // 是否启用圈选翻译
    disableImageTranslator: boolean; // 是否禁用图片翻译
    deeplx: string; // DeepLX 服务地址
    selectionTranslatorMode: string; // 划词翻译显示模式: 'disabled' | 'bilingual' | 'translation-only'
    selectionTranslatorTrigger: string; // 划词翻译触发方式: 'direct' | 'icon' | 'dot'
    newApiUrl: string; // NewAPI地址
    maxConcurrentTranslations: number; // 最大并发翻译数量
    youdaoAppKey: string; // 有道翻译 App Key
    youdaoAppSecret: string; // 有道翻译 App Secret
    tencentSecretId: string; // 腾讯云 Secret ID
    tencentSecretKey: string; // 腾讯云 Secret Key
    azureOpenaiEndpoint: string; // Azure OpenAI 端点地址
    animations: boolean; // 是否启用动画效果
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
        this.videoTranslationEnabled = false; // Beta 功能默认关闭
        this.videoService = services.microsoft; // 视频字幕默认使用微软翻译
        this.videoServiceDefaultMigrated = true;
        this.videoSubtitleVisible = true; // 默认显示视频译文
        this.videoSubtitleDisplayMode = 'bilingual'; // 默认双语显示
        this.videoSubtitleFontSize = DEFAULT_VIDEO_SUBTITLE_FONT_SIZE; // 默认字幕字号
        this.token = {};
        this.requireApiKey = {};
        this.minimaxBillingPlan = 'payg';
        this.minimaxRegion = 'cn';
        this.ak = '';
        this.sk = '';
        this.appid = '';
        this.key = '';
        this.model = Object.fromEntries(defaultModels);
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
        this.enableAIContext = false; // 默认关闭 AI 智能上下文，避免意外增加请求体和费用
        this.contextMenuEnabled = true; // 默认显示右键全文翻译入口
        this.disableFloatingBall = true; // 默认关闭悬浮球
        this.floatingBallPosition = 'right'; // 默认在右侧
        this.floatingBallHotkey = 'Alt+T'; // 默认快捷键为 Alt+T
        this.customFloatingBallHotkey = ''; // 自定义快捷键为空
        this.customHotkey = ''; // 自定义鼠标悬浮快捷键为空
        this.disableSelectionTranslator = true; // 默认关闭划词翻译
        this.selectionAreaEnabled = false; // 圈选翻译需要用户主动开启，避免意外截图
        this.disableImageTranslator = true; // 默认关闭图片翻译，避免首次安装后扫描网页图片
        this.deeplx = defaultOption.deeplx; // DeepLX 默认服务地址
        this.selectionTranslatorMode = 'disabled'; // 默认关闭划词翻译
        this.selectionTranslatorTrigger = 'icon'; // 默认显示可发现的操作图标
        this.newApiUrl = DEFAULT_NEW_API_URL; // NewAPI 默认地址
        this.maxConcurrentTranslations = 6; // 默认最大并发数为6
        this.youdaoAppKey = ''; // 有道翻译 App Key
        this.youdaoAppSecret = ''; // 有道翻译 App Secret
        this.tencentSecretId = ''; // 腾讯云 Secret ID
        this.tencentSecretKey = ''; // 腾讯云 Secret Key
        this.azureOpenaiEndpoint = ''; // Azure OpenAI 端点地址
        this.animations = true; // 默认启用动画
        this.inputBoxTranslationTrigger = 'disabled'; // 默认关闭输入框翻译
        this.inputBoxTranslationTarget = 'en'; // 默认翻译成英文
        this.deepseekApiType = 'auto'; // DeepSeek 默认自动选择 API 格式
        this.deepseekThinkingMode = 'disabled'; // 翻译默认关闭思考模式，降低延迟和输出噪音
    }
}

const modelMigrations: Record<string, Record<string, string>> = {
    [services.openai]: {
        gpt5: currentModelIds.openai,
    },
    [services.zhipu]: {
        'glm-4.5': currentModelIds.zhipu,
        'GLM-4-Flash': currentModelIds.zhipuFlash,
        'glm-4-plus': currentModelIds.zhipu,
        'glm-4': currentModelIds.zhipu,
        'glm-4v': currentModelIds.zhipu,
    },
    [services.moonshot]: {
        'kimi-k2-0711-preview': currentModelIds.moonshot,
        'kimi-k2-turbo-preview': currentModelIds.moonshot,
        'moonshot-v1-auto': currentModelIds.moonshot,
        'moonshot-v1-8k': currentModelIds.moonshot,
        'moonshot-v1-32k': currentModelIds.moonshot,
    },
    [services.claude]: {
        'claude-sonnet-4-0': currentModelIds.claudeSonnet,
        'claude-opus-4-1': currentModelIds.claudeOpus,
        'claude-3-5-sonnet': currentModelIds.claudeSonnet,
        'claude-3-5-sonnet-20241022': currentModelIds.claudeSonnet,
        'claude-3-opus': currentModelIds.claudeOpus,
        'claude-3-opus-20240229': currentModelIds.claudeOpus,
        'claude-3-5-haiku': currentModelIds.claudeHaiku,
        'claude-3-5-haiku-20241022': currentModelIds.claudeHaiku,
        'claude-3-5-haiku-latest': currentModelIds.claudeHaiku,
    },
    [services.grok]: {
        'grok-4-0709': currentModelIds.grok,
    },
    [services.groq]: {
        'llama-3.3-70b-versatile': currentModelIds.groqLarge,
        'llama-3.1-8b-instant': currentModelIds.groqSmall,
        'llama3-8b-8192': currentModelIds.groqSmall,
    },
    [services.yiyan]: {
        'ERNIE-Bot 4.0': currentModelIds.yiyan,
        'ERNIE-Bot': currentModelIds.yiyan,
        'ERNIE-Speed-8K': currentModelIds.yiyanFast,
    },
    [services.minimax]: {
        chatcompletion_v2: currentModelIds.minimax,
        'MiniMax-Text-01': currentModelIds.minimax,
    },
    [services.jieyue]: {
        'step-1-8k': currentModelIds.jieyue,
    },
    [services.huanYuan]: {
        'hunyuan-turbos-latest': currentModelIds.huanYuan,
        'hunyuan-t1-latest': currentModelIds.huanYuan,
        'hunyuan-a13b': currentModelIds.huanYuan,
        'hunyuan-lite': currentModelIds.huanYuan,
        'hunyuan-standard': currentModelIds.huanYuan,
    },
    [services.infini]: {
        'llama-2-13b-chat': currentModelIds.infiniGeneral,
        'llama-3.3-70b-instruct': currentModelIds.infiniGeneral,
        'qwen2.5-14b-instruct': currentModelIds.infiniGeneral,
        'gemma-2-27b-it': currentModelIds.infiniGeneral,
        'glm-4-9b-chat': currentModelIds.infiniZhipu,
    },
};

/**
 * 将存储或导入的普通对象补齐为当前配置结构，并迁移已退役或错误的模型编号。
 */
export function normalizeConfig(value: unknown): Config {
    const normalized = new Config();
    // Vue 的响应式对象是 Proxy。Chrome 的 runtime 通道有时会替调用方
    // 做隐式转换，但 Firefox 会严格按 structured clone 处理并直接抛出
    // DataCloneError，所以配置边界必须先落成纯对象。
    const source = value && typeof value === 'object'
        ? cloneConfigValue(value) as Partial<Config>
        : {};
    Object.assign(normalized, source);
    delete (normalized as unknown as Record<string, unknown>).translationStatus;
    // __fluentConfigRevision 只用于 storage 的写入顺序判断，不能进入运行时
    // 配置或历史快照，否则默认配置与同值的页面快照会因内部字段不同而无法去重。
    delete (normalized as unknown as Record<string, unknown>).__fluentConfigRevision;

    normalized.token = normalizeStringMapping(source.token);
    normalized.model = normalizeStringMapping(source.model);
    normalized.requireApiKey = isBooleanMapping(source.requireApiKey) ? {...source.requireApiKey} : {};
    normalized.customModel = normalizeStringMapping(source.customModel);
    normalized.proxy = normalizeStringMapping(source.proxy);
    normalized.robot_id = normalizeStringMapping(source.robot_id);
    normalized.system_role = {
        ...systemRoleFactory(),
        ...normalizeStringMapping(source.system_role),
    };
    normalized.user_role = {
        ...userRoleFactory(),
        ...normalizeStringMapping(source.user_role),
    };
    normalized.customBody = normalizeCustomBodyMapping(source.customBody);

    if (typeof normalized.custom !== 'string') normalized.custom = defaultOption.custom;
    if (typeof normalized.newApiUrl !== 'string') normalized.newApiUrl = DEFAULT_NEW_API_URL;

    if (typeof normalized.videoTranslationEnabled !== 'boolean') {
        normalized.videoTranslationEnabled = false;
    }
    // 早期 Beta 版本曾把 DeepLX 写成默认值。只对没有迁移标记的旧配置
    // 执行一次迁移，避免覆盖用户在新版本中主动选择的 DeepLX。
    const shouldMigrateLegacyVideoDefault = source.videoService === services.deeplx
        && source.videoServiceDefaultMigrated !== true;
    const supportsVideoService = servicesType.machine.has(normalized.videoService)
        || servicesType.isAI(normalized.videoService);
    if (shouldMigrateLegacyVideoDefault || !supportsVideoService) {
        normalized.videoService = services.microsoft;
    }
    normalized.videoServiceDefaultMigrated = true;
    if (typeof normalized.videoSubtitleVisible !== 'boolean') {
        normalized.videoSubtitleVisible = true;
    }
    if (!['bilingual', 'translation-only', 'original-only'].includes(normalized.videoSubtitleDisplayMode)) {
        normalized.videoSubtitleDisplayMode = 'bilingual';
    }
    normalized.videoSubtitleFontSize = normalizeVideoSubtitleFontSize(normalized.videoSubtitleFontSize);

    migrateModelIdentifiers(normalized.model);

    // 旧配置可能没有保存过模型选择；为所有 AI 服务补齐各自的默认模型。
    defaultModels.forEach((defaultModel, service) => {
        if (!normalized.model[service]) normalized.model[service] = defaultModel;
    });

    const selectedModel = normalized.model[services.deepseek];
    const configuredThinkingMode = source.deepseekThinkingMode;

    if (selectedModel === 'deepseek-chat') {
        normalized.model[services.deepseek] = currentModelIds.deepseek;
        normalized.deepseekThinkingMode = 'disabled';
    } else if (selectedModel === 'deepseek-reasoner') {
        // 官方迁移指南要求 reasoner 使用 v4-flash 并显式开启 thinking。
        normalized.model[services.deepseek] = currentModelIds.deepseek;
        normalized.deepseekThinkingMode = 'enabled';
    } else if (configuredThinkingMode !== 'enabled' && configuredThinkingMode !== 'disabled') {
        // 兼容 #219 的早期配置：该实现把 v4-pro 作为默认思考模型。
        normalized.deepseekThinkingMode = selectedModel === 'deepseek-v4-pro' ? 'enabled' : 'disabled';
    }

    if (!['auto', 'responses', 'chat'].includes(normalized.deepseekApiType)) {
        normalized.deepseekApiType = 'auto';
    }

    if (!['payg', 'token-plan'].includes(normalized.minimaxBillingPlan)) {
        normalized.minimaxBillingPlan = 'payg';
    }

    if (!['global', 'cn'].includes(normalized.minimaxRegion)) {
        normalized.minimaxRegion = 'cn';
    }

    if (!['disabled', 'bilingual', 'translation-only'].includes(normalized.selectionTranslatorMode)) {
        normalized.selectionTranslatorMode = 'disabled';
    }
    if (!['direct', 'icon', 'dot'].includes(normalized.selectionTranslatorTrigger)) {
        normalized.selectionTranslatorTrigger = 'icon';
    }
    normalized.disableSelectionTranslator = normalized.selectionTranslatorMode === 'disabled';
    if (typeof normalized.selectionAreaEnabled !== 'boolean') {
        normalized.selectionAreaEnabled = false;
    }
    if (typeof normalized.contextMenuEnabled !== 'boolean') {
        normalized.contextMenuEnabled = true;
    }

    return normalized;
}

function cloneConfigValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(cloneConfigValue);
    if (!isRecord(value)) return value;

    const cloned: Record<string, unknown> = {};
    for (const key of Object.keys(value)) cloned[key] = cloneConfigValue(value[key]);
    return cloned;
}

function migrateModelIdentifiers(configuredModels: IMapping): void {
    for (const service of Object.keys(modelMigrations)) {
        const selectedModel = configuredModels[service];
        if (!selectedModel) continue;
        configuredModels[service] = migrateModelIdentifier(service, selectedModel);
    }
}

/**
 * 将单个官方预设的旧编号映射到当前编号，供配置加载与请求模板共同兜底。
 * 自定义模型应由调用方跳过此函数，以免改写私有部署别名。
 */
export function migrateModelIdentifier(service: string, selectedModel: string): string {
    return modelMigrations[service]?.[selectedModel] || selectedModel;
}

function isRecord(value: unknown): value is Record<string, string> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStringMapping(value: unknown): IMapping {
    if (!isRecord(value)) return {};
    return Object.fromEntries(
        Object.entries(value).filter(([, item]) => typeof item === 'string'),
    );
}

function isBooleanMapping(value: unknown): value is Record<string, boolean> {
    return typeof value === 'object'
        && value !== null
        && !Array.isArray(value)
        && Object.values(value).every((item) => typeof item === 'boolean');
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
