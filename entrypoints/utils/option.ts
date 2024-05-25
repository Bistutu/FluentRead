export const services = {
    microsoft: 'microsoft',
    deepL: 'deepL',
    deepLx: 'deepLx',
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
    lingyi: 'lingyi',
    deepseek: 'deepseek',
    minimax: 'minimax',
    jieyue: "jieyue",    // 阶跃星辰
    graq: 'graq',
    cozecom: 'cozecom', // coze 支持机器人不支持模型
    cozecn: 'cozecn',
}

export const servicesType = {
    // 阵营划分
    machine: new Set([
        services.microsoft, services.deepL, services.google, services.xiaoniu, services.baidu, services.deepLx
    ]),
    AI: new Set([
        services.openai, services.gemini, services.yiyan, services.tongyi, services.zhipu, services.moonshot,
        services.claude, services.custom, services.infini, services.baichuan, services.deepseek, services.lingyi,
        services.minimax, services.jieyue, services.graq, services.cozecom, services.cozecn
    ]),
    // 需要 token
    useToken: new Set([
        services.openai, services.gemini, services.tongyi, services.zhipu, services.moonshot, services.claude,
        services.deepL, services.xiaoniu, services.infini, services.baichuan, services.deepseek, services.lingyi,
        services.minimax, services.jieyue, services.graq, services.custom, , services.cozecom, services.cozecn
    ]),
    // 需要 model
    useModel: new Set([
        services.openai, services.gemini, services.yiyan, services.tongyi, services.zhipu, services.moonshot,
        services.claude, services.custom, services.infini, services.baichuan, services.deepseek, services.lingyi,
        services.minimax, services.jieyue, services.graq
    ]),
    // 支持代理
    useProxy: new Set([
        services.openai, services.gemini, services.claude, services.google, services.deepL, services.moonshot,
        services.tongyi, services.xiaoniu, services.baichuan, services.deepseek, services.lingyi, services.deepLx,
        services.jieyue, services.graq, services.cozecom, services.cozecn
    ]),

    isMachine: (service: string) => servicesType.machine.has(service),
    isAI: (service: string) => servicesType.AI.has(service),
    isUseToken: (service: string) => servicesType.useToken.has(service),
    isUseProxy: (service: string) => servicesType.useProxy.has(service),
    isUseModel: (service: string) => servicesType.useModel.has(service),
    isCustom: (service: string) => service === services.custom,
    isUseAkSk: (service: string) => service === services.yiyan,
    isUseAppIdKey: (service: string) => service === services.baidu,
    isCoze: (service: string) => service === services.cozecom || service === services.cozecn,
}

export const customModelString = "自定义模型"
export const models = new Map<string, Array<string>>([
    [services.openai, ["gpt-3.5-turbo", "gpt-4o", "gpt-4", "gpt-4-turbo", customModelString]],
    [services.gemini, ["gemini-pro", "gemini-1.5-pro", "gemini-1.5-flash", customModelString]],
    [services.yiyan, ["ERNIE-Bot 4.0", "ERNIE-Bot", "ERNIE-Speed-8K", "ERNIE-Speed-128K"]],  // 因文心一言模式不同，暂不支持自定义模型（还需根据model获取最终的url请求参数）
    [services.tongyi, ["qwen-long","qwen-turbo", "qwen-plus", "qwen-max", "qwen-max-longcontext", customModelString]],
    [services.zhipu, ["glm-4", "glm-4v", "glm-3-turbo", customModelString]],
    [services.moonshot, ["moonshot-v1-8k", customModelString]],
    [services.claude, ["claude3-Haiku", "claude3-Sonnet", "claude3-Opus"]],    // claude 也不支持自定义模型
    [services.custom, ["gpt-3.5-turbo", "gpt-4o", "gpt-4", "gpt-4-turbo", "gemma:7b", "llama2:7b", "mistral:7b", customModelString]],
    [services.infini, ["infini-megrez-7b", "llama-2-13b-chat", "qwen-14b-chat", "llama-2-70b-chat", "qwen-72b-chat", customModelString]],
    [services.baichuan, ["Baichuan2-Turbo", "Baichuan2-53B", customModelString]],
    [services.lingyi, ["yi-spark", "yi-medium", "yi-large", "yi-large-turbo", customModelString]],
    [services.deepseek, ["deepseek-chat", customModelString]],
    [services.minimax, ["chatcompletion_v2"]],
    [services.jieyue, ["step-1-8k", customModelString]],
    [services.graq, ["gemma-7b-it", "mixtral-8x7b-32768", "llama3-70b-8192", "llama3-8b-8192", customModelString]],
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
            label: "鼠标滚轮单击"
        },
        {
            value: 'touchscreen',
            label: "触屏设备选项",
            disabled: true,
        },
        {
            value: 'TwoFinger',
            label: "双指翻译",
        },
        {
            value: 'ThreeFinger',
            label: "三指翻译",
        },
        {
            value: 'FourFinger',
            label: "四指翻译",
        },
        {
            value: 'DoubleClickScree',
            label: "双击翻译",
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
        // {
        //     value:services.deepLx,
        //     label: 'DeepLx',
        //     hidden: true,
        // },
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
            value: services.cozecom,
            label: 'Coze国际版',
        },
        {
            value: services.cozecn,
            label: 'Coze国内版',
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
            value: services.graq,
            label: 'Graq',
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
            value: services.baichuan,
            label: '百川大模型',
        },
        {
            value: services.lingyi,
            label: '零一万物',
        },
        {
            value: services.deepseek,
            label: 'DeepSeek',
        },
        {
            value: services.minimax,
            label: 'MiniMax',
        },
        {
            value: services.jieyue,
            label: '阶跃星辰'
        },
        {
            value: services.infini,
            label: '无向芯穹',
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
            label: '加粗',
            class: 'fluent-display-bold',
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
            label: '弱化',
            class: 'fluent-display-dimmed',
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
            label: '学习效果',
            class: 'fluent-display-learning-mode',
        },
        {
            value: 8,
            label: '马克笔',
            class: 'fluent-display-marker',
        },
        {
            value: 9,
            label: '引用',
            class: 'fluent-display-quote',
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
    system_role: 'You are a professional, authentic machine translation engine. You only return the translated text, without any explanations.',
    user_role: `Translate the following text into {{to}}, output translation text directly without any extra information:

{{origin}}`,
    count: 0,
}