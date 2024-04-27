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
    ollama: 'ollama',
    infini: 'infini',
    baidu: 'baidu',
    // 阵营划分
    machine: new Set(["microsoft", "deepL", "google", "xiaoniu", "baidu"]),
    ai: new Set(["openai", "gemini", "yiyan", "tongyi", "zhipu", "moonshot", "claude", "ollama", "infini"]),
    // 需要 token，或者 ak/sk
    useToken: new Set(["openai", "gemini", "tongyi", "zhipu", "moonshot", "claude", "deepL", "xiaoniu", "infini"]),
    useAkSk: new Set(["yiyan"]),
    // 需要 model
    useModel: new Set(["openai", "gemini", "yiyan", "tongyi", "zhipu", "moonshot", "claude", "ollama", "infini"]),
    // 支持代理
    useProxy: new Set(["openai", "claude", "gemini","google"]),
    // 函数
    isMachine: (service: string) => services.machine.has(service),
    isAI: (service: string) => services.ai.has(service),
    isNative: (service: string) => service === "ollama",
    isUseToken: (service: string) => services.useToken.has(service),
    isUseAkSk: (service: string) => services.useAkSk.has(service),
    isUseAppIdKey: (service: string) => service === "baidu",
    isUseProxy: (service: string) => services.useProxy.has(service),
    isUseModel: (service: string) => services.useModel.has(service),
}

export const customModelString = "自定义模型"
export const models = new Map<string, Array<string>>([
    [services.openai, ["gpt-3.5-turbo", "gpt-4", "gpt-4-turbo-preview", customModelString]],
    [services.gemini, ["gemini-pro", customModelString]],
    [services.yiyan, ["ERNIE-Bot 4.0", "ERNIE-Bot"]],  // 因文心一言模式不同，暂不支持自定义模型（还需根据model获取最终的url请求参数）
    [services.tongyi, ["qwen-turbo", "qwen-plus", "qwen-max", "qwen-max-longcontext", customModelString]],
    [services.zhipu, ["glm-4", "glm-4v", "glm-3-turbo", customModelString]],
    [services.moonshot, ["moonshot-v1-8k", customModelString]],
    [services.claude, ["claude3-Haiku", "claude3-Sonnet", "claude3-Opus"]],    // claude 也不支持自定义模型
    [services.ollama, ["gemma:7b", "llama2:7b", "mistral:7b", customModelString]],
    [services.infini, ["infini-megrez-7b", "llama-2-13b-chat", "qwen-14b-chat", "llama-2-70b-chat", "qwen-72b-chat", customModelString]],
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
        {
            value: services.deepL,
            label: 'DeepL翻译',
        },
        {
            value: services.xiaoniu,
            label: '小牛翻译',
        },
        {
            value: services.baidu,
            label: '百度翻译(Beta)',
        },
        // free 接口，翻译 html 会出现问题，隐藏。
        // {
        //     value: services.google,
        //     label: 'Google翻译',
        // },
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
            label: 'Kimi（月之暗面）',
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
            label: '无向芯穹Infini',
        },
        {
            value: services.ollama,
            label: 'Ollama本地模型',
        },
    ],
}

export const defaultOption = {
    on: true,
    from: 'auto',
    to: 'zh-Hans',
    hotkey: 'Control',
    service: services.microsoft,
    native: 'http://localhost:11434/v1/chat/completions',
    system_role: 'You are a professional, authentic translation engine, only returns translations.',
    user_role: `Please translate them into {{to}}, please do not explain my original text.:

{{origin}}`,
    count: 0,
}