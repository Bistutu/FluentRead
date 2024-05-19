export const services = {
    // 机器翻译
    microsoft: 'microsoft',
    deepL: 'deepL',
    google: 'google',
    xiaoniu: 'xiaoniu',
    // AI 翻译
    openai: 'openai',
    gemini: 'gemini',
    yiyan: 'yiyan',
    tongyi: 'tongyi',
    zhipu: 'zhipu',
    moonshot: 'moonshot',
    claude: 'claude',
    custom: 'custom',
    infini: 'infini',
    baidu: 'baidu',
    baichuan: 'baichuan',
    // 阵营划分
    machine: new Set(["microsoft", "deepL", "google", "xiaoniu", "baidu"]),
    ai: new Set(["openai", "gemini", "yiyan", "tongyi", "zhipu",
        "moonshot", "claude", "custom", "infini","baichuan"]),
    // 需要 token，或者 ak/sk
    useToken: new Set(["openai", "gemini", "tongyi", "zhipu", "moonshot", "claude", "deepL", "xiaoniu", "infini","custom","baichuan"]),
    useAkSk: new Set(["yiyan"]),
    // 需要 model
    useModel: new Set(["openai", "gemini", "yiyan", "tongyi", "zhipu", "moonshot", "claude", "custom", "infini","baichuan"]),
    // 支持代理
    useProxy: new Set(["openai", "claude", "gemini", "google", "deepl", "moonshot", "tongyi", "xiaoniu","baichuan"]),
    // 函数
    isMachine: (service: string) => services.machine.has(service),
    isAI: (service: string) => services.ai.has(service),
    isCustom: (service: string) => service === "custom",
    isUseToken: (service: string) => services.useToken.has(service),
    isUseAkSk: (service: string) => services.useAkSk.has(service),
    isUseAppIdKey: (service: string) => service === "baidu",
    isUseProxy: (service: string) => services.useProxy.has(service),
    isUseModel: (service: string) => services.useModel.has(service),
}

export const customModelString = "自定义模型"
export const models = new Map<string, Array<string>>([
    [services.openai, ["gpt-3.5-turbo", "gpt-4o", "gpt-4", "gpt-4-turbo", customModelString]],
    [services.gemini, ["gemini-pro", "gemini-1.5-pro", "gemini-flash-1.5", customModelString]],
    [services.yiyan, ["ERNIE-Bot 4.0", "ERNIE-Bot"]],  // 因文心一言模式不同，暂不支持自定义模型（还需根据model获取最终的url请求参数）
    [services.tongyi, ["qwen-turbo", "qwen-plus", "qwen-max", "qwen-max-longcontext", customModelString]],
    [services.zhipu, ["glm-4", "glm-4v", "glm-3-turbo", customModelString]],
    [services.moonshot, ["moonshot-v1-8k", customModelString]],
    [services.claude, ["claude3-Haiku", "claude3-Sonnet", "claude3-Opus"]],    // claude 也不支持自定义模型
    [services.custom, ["gpt-3.5-turbo","gpt-4o", "gpt-4", "gpt-4-turbo","gemma:7b", "llama2:7b", "mistral:7b", customModelString]],
    [services.infini, ["infini-megrez-7b", "llama-2-13b-chat", "qwen-14b-chat", "llama-2-70b-chat", "qwen-72b-chat", customModelString]],
    [services.baichuan, ["Baichuan2-Turbo", "Baichuan2-53B", customModelString]],
]);

export const options = {
    on: [{
        value: true,
        label: "开启"
    }, {
        value: false,
        label: "关闭"
    }],
    form: [
        {
            value: 'auto',
            label: '自动检测',
        },
    ],
    to: [
        {
            value: 'zh-Hans',
            label: '中文',
        },
        {
            value: 'en',
            label: '英语',
        },
        {
            value: 'ja',
            label: '日语',
        },
        {
            value: 'ko',
            label: '韩语',
        },
        {
            value: 'fr',
            label: '法语',
        },
        {
            value: 'ru',
            label: '俄语',
        },
    ],
    keys: [
        {
            value: "Control",
            label: "Ctrl"
        },
        {
            value: "Alt",
            label: "Alt"
        },
        {
            value: "Shift",
            label: "Shift"
        },
        // 反引号键
        {
            value: "`",
            label: "波浪号键"
        },
        // 鼠标双击左键
        {
            value: 'DoubleClick',
            label: "鼠标双击"
        },
        // 鼠标长按
        {
            value: 'LongPress',
            label: "鼠标长按"
        },
        {
            value: 'MiddleClick',
            label: "鼠标中键"
        }
    ],
    services: [
        {
            value: 'machine',
            label: '机器翻译',
            disabled: true,
        },
        {
            value: services.microsoft,
            label: '微软翻译',
        },
        // 谷歌翻译只在双语模式中使用
        {
            value: services.google,
            label: '谷歌翻译',
            hidden: true,
        },
        {
            value: services.deepL,
            label: 'DeepL翻译',
        },
        {
            value: services.baidu,
            label: '百度翻译',
        },
        {
            value: services.xiaoniu,
            label: '小牛翻译',
        },
        {
            value: 'ai',
            label: 'AI翻译',
            disabled: true,
        },
        {
            value: services.openai,
            label: 'OpenAI',
            model: "gpt-3.5-turbo",
        },
        {
            value: services.moonshot,
            label: 'Kimi',
            model: "moonshot-v1-8k",
        },
        {
            value: services.claude,
            label: 'Claude',
            model: "Haiku",
        },
        {
            value: services.gemini,
            label: 'Gemini',
            model: "gemini-pro",
        },
        {
            value: services.zhipu,
            label: '智谱清言',
            model: "glm-3-turbo",
        },
        {
            value: services.tongyi,
            label: '通义千问',
            model: "qwen-turbo",
        },
        {
            value: services.yiyan,
            label: '文心一言',
            model: "ERNIE-Bot",
        },
        {
            value: services.infini,
            label: '无向芯穹',
        },
        {
            value: services.baichuan,
            label: '百川大模型',
            model: "Baichuan2-Turbo",
        },
        {
            value: services.custom,
            label: '⭐自定义⭐️',
        },
    ],
    display: [
        {
            value: 0,
            label: '仅译文',
        },
        {
            value: 1,
            label: '双语模式',
        },
    ],
    // 双语翻译的 9 种模式：默认、弱化、实线下划线、虚线下划线、学习模式、透明模式、白纸阴影、马克笔、引用、加粗
    styles: [
        {
            value: 0,
            label: '默认样式',
            class: 'fluent-display-default',
        },
        {
            value: 1,
            label: '弱化',
            class: 'fluent-display-dimmed',
        },
        {
            value: 2,
            label: '实线下划线',
            class: 'fluent-display-solid-underline',
        },
        {
            value: 3,
            label: '虚线下划线',
            class: 'fluent-display-dot-underline',
        },
        {
            value: 4,
            label: '学习效果',
            class: 'fluent-display-learning-mode',
        },
        {
          value: 5,
            label: '透明',
            class: 'fluent-display-transparent-mode',
        },
        {
            value: 6,
            label: '阴影',
            class: 'fluent-display-card-mode',
        },
        {
            value: 7,
            label: '马克笔',
            class: 'fluent-display-marker',
        },
        {
            value: 8,
            label: '引用',
            class: 'fluent-display-quote',
        },
        {
            value: 9,
            label: '加粗',
            class: 'fluent-display-bold',
        },
    ],
}

export const defaultOption = {
    on: true,
    from: 'auto',
    to: 'zh-Hans',
    display: 0,
    style: 0,
    hotkey: 'Control',
    service: services.microsoft,
    custom: 'http://localhost:11434/v1/chat/completions',
    system_role: 'You are a professional, authentic translation engine, only returns translations.',
    user_role: `Please translate them into {{to}}, please do not explain my original text.:

{{origin}}`,
    count: 0,
}