import { defaultOption, services } from "./option";

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
    }
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
