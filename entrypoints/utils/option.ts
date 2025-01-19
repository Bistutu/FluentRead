export const services = {
    // 传统机器翻译
    microsoft: "microsoft",
    deepL: "deepL",
    google: "google",
    xiaoniu: "xiaoniu",
    // 大模型翻译
    openai: "openai",
    gemini: "gemini",
    yiyan: "yiyan",
    tongyi: "tongyi",
    zhipu: "zhipu",
    moonshot: "moonshot",
    claude: "claude",
    custom: "custom",
    infini: "infini",
    // baidu: 'baidu',
    baichuan: "baichuan",
    lingyi: "lingyi",
    deepseek: "deepseek",
    minimax: "minimax",
    jieyue: "jieyue", // 阶跃星辰
    graq: "graq",
    cozecom: "cozecom", // coze 支持机器人不支持模型
    cozecn: "cozecn",
    huanYuan: "huanYuan", // 腾讯混元
    doubao: "doubao", // 字节豆包
    siliconCloud: "siliconCloud", // 硅流
    openrouter: "openrouter", // openrouter
};

export const servicesType = {
    // 阵营划分
    machine: new Set([services.microsoft, services.deepL, services.google, services.xiaoniu,]),
    AI: new Set([
        services.openai,
        services.gemini,
        services.yiyan,
        services.tongyi,
        services.zhipu,
        services.moonshot,
        services.claude, services.custom,
        services.infini,
        services.baichuan,
        services.deepseek,
        services.lingyi,
        services.minimax,
        services.jieyue,
        services.graq,
        services.cozecom,
        services.cozecn,
        services.huanYuan,
        services.doubao,
        services.siliconCloud,
        services.openrouter,
    ]),
    // 需要 token
    useToken: new Set([
        services.openai,
        services.gemini,
        services.tongyi,
        services.zhipu,
        services.moonshot,
        services.claude,
        services.deepL,
        services.xiaoniu,
        services.infini,
        services.baichuan,
        services.deepseek,
        services.lingyi,
        services.minimax,
        services.jieyue,
        services.graq,
        services.custom,
        services.cozecom,
        services.cozecn,
        services.huanYuan,
        services.doubao,
        services.siliconCloud,
        services.openrouter,
    ]),
    // 需要 model
    useModel: new Set([
        services.openai,
        services.gemini,
        services.yiyan,
        services.tongyi,
        services.zhipu,
        services.moonshot,
        services.claude,
        services.custom,
        services.infini,
        services.baichuan,
        services.deepseek,
        services.lingyi,
        services.minimax,
        services.jieyue,
        services.graq,
        services.huanYuan,
        services.doubao,
        services.siliconCloud,
        services.openrouter,
    ]),
    // 支持代理
    useProxy: new Set([
        services.openai,
        services.gemini,
        services.claude,
        services.google,
        services.deepL,
        services.moonshot,
        services.tongyi,
        services.xiaoniu,
        services.baichuan,
        services.deepseek,
        services.lingyi,
        services.jieyue,
        services.graq,
        services.cozecom,
        services.cozecn,
        services.huanYuan,
        services.doubao,
        services.siliconCloud,
        services.openrouter,
    ]),

    isMachine: (service: string) => servicesType.machine.has(service),
    isAI: (service: string) => servicesType.AI.has(service),
    isUseToken: (service: string) => servicesType.useToken.has(service),
    isUseProxy: (service: string) => servicesType.useProxy.has(service),
    isUseModel: (service: string) => servicesType.useModel.has(service),
    isCustom: (service: string) => service === services.custom,
    isUseAkSk: (service: string) => service === services.yiyan,
    isCoze: (service: string) => service === services.cozecom || service === services.cozecn,
};

export const customModelString = "自定义模型";
export const models = new Map<string, Array<string>>([
    [services.openai, ["gpt-4o-mini", "gpt-4o", "o1", "o1-mini", "gpt-3.5-turbo", customModelString]],
    [services.gemini, ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro", "gemini-2.0-flash-exp", customModelString]],
    [services.yiyan, ["ERNIE-Bot 4.0", "ERNIE-Bot", "ERNIE-Speed-8K"]],
    [services.tongyi, ["qwen-long", "qwen-turbo", "qwen-plus", "qwen-max", "qwen-max-longcontext", customModelString]],
    [services.zhipu, ["GLM-4-Flash", "glm-4-plus", "glm-4", "glm-4v", "glm-3-turbo", customModelString]],
    [services.moonshot, ["moonshot-v1-8k", "moonshot-v1-32k", customModelString]],
    [services.claude, ["claude-3-5-haiku", "claude-3-5-sonnet", "claude-3-opus"]],
    [services.custom, ["gpt-3.5-turbo", "gpt-4o", "gpt-4", "gpt-4-turbo", "gemma:7b", "llama2:7b", "mistral:7b", customModelString]],
    [services.infini, ["llama-2-13b-chat", "llama-3.3-70b-instruct", "qwen2.5-14b-instruct","gemma-2-27b-it", "glm-4-9b-chat", customModelString]],
    [services.baichuan, ["Baichuan4-Air", "Baichuan4-Turbo", "Baichuan4", customModelString]],
    [services.lingyi, ["yi-lightning", customModelString]],
    [services.deepseek, ["deepseek-chat", customModelString]],
    [services.minimax, ["chatcompletion_v2"]],
    [services.jieyue, ["step-1-8k", customModelString]],
    [services.huanYuan, ["hunyuan-lite", "hunyuan-standard", "hunyuan-turbo", customModelString]],
    [services.doubao, [customModelString]],

    // mix model
    [services.siliconCloud, ["Qwen/Qwen2.5-7B-Instruct（免费）", "meta-llama/Meta-Llama-3.1-8B-Instruct（免费）", "internlm/internlm2_5-7b-chat（免费）", "THUDM/glm-4-9b-chat（免费）", "01-ai/Yi-1.5-9B-Chat-16K（免费）", "google/gemma-2-9b-it（免费）", customModelString]],
    [services.graq, ["llama-3.1-8b-instant（免费）", "llama3-8b-8192（免费）", "llama-3.3-70b-versatile（免费）", "gemma2-9b-it（免费）", "mixtral-8x7b-32768（免费）", "whisper-large-v3（免费）", customModelString]],
    [services.openrouter, ["meta-llama/llama-3.1-8b-instruct（免费）", "google/gemini-2.0-flash-exp（免费）", "qwen/qwen-2-7b-instruct（免费）", "huggingfaceh4/zephyr-7b-beta（免费）", customModelString]]
]);

export const options = {
    on: [
        {value: true, label: "开启"},
        {value: false, label: "关闭"},
    ],
    form: [{value: "auto", label: "自动检测"}],
    to: [
        {value: "zh-Hans", label: "中文"},
        {value: "en", label: "英语"},
        {value: "ja", label: "日语"},
        {value: "ko", label: "韩语"},
        {value: "fr", label: "法语"},
        {value: "ru", label: "俄语"},
    ],
    keys: [
        {value: "Computer", label: "键盘选项", disabled: true},
        {value: "Control", label: "Ctrl"},
        {value: "Alt", label: "Alt"},
        {value: "Shift", label: "Shift"},
        {value: "`", label: "波浪号键"},

        {value: "mouse", label: "鼠标选项", disabled: true}, 
        {value: "DoubleClick", label: "鼠标双击"},
        {value: "LongPress", label: "鼠标长按"},
        {value: "MiddleClick", label: "鼠标滚轮单击"},

        {value: "touchscreen", label: "触屏设备选项", disabled: true},
        {value: "TwoFinger", label: "双指翻译"},
        {value: "ThreeFinger", label: "三指翻译"},
        {value: "FourFinger", label: "四指翻译"},
        {value: "DoubleClickScree", label: "双击翻译"},
        {value: "TripleClickScree", label: "三击翻译"},
    ],
    services: [
        // 传统机器翻译
        {value: "machine", label: "机器翻译", disabled: true},
        {value: services.microsoft, label: "微软翻译"},
        {value: services.google, label: "谷歌翻译"},
        {value: services.deepL, label: "DeepL"},
        {value: services.xiaoniu, label: "小牛翻译"},
        // 大模型翻译
        {value: "ai", label: "AI翻译", disabled: true},
        {value: services.deepseek, label: "DeepSeek⭐️"},
        {value: services.siliconCloud, label: "SiliconCloud⭐️"},
        {value: services.openai, label: "OpenAI"},
        {value: services.moonshot, label: "Kimi"},
        {value: services.huanYuan, label: "腾讯混元"},
        {value: services.doubao, label: "字节豆包"},
        {value: services.tongyi, label: "阿里通义"},
        {value: services.openrouter, label: "OpenRouter"},
        {value: services.graq, label: "Graq"},
        {value: services.zhipu, label: "智谱清言"},
        {value: services.baichuan, label: "百川智能"},
        {value: services.lingyi, label: "零一万物"},
        {value: services.minimax, label: "MiniMax"},
        {value: services.jieyue, label: "阶跃星辰"},
        {value: services.infini, label: "无向芯穹"},
        {value: services.cozecom, label: "Coze国际"},
        {value: services.cozecn, label: "Coze国内"},
        {value: services.claude, label: "Claude"},
        {value: services.gemini, label: "Gemini"},
        {value: services.yiyan, label: "文心一言"},
        {value: services.custom, label: "⭐自定义⭐️"},
    ],
    display: [
        {value: 0, label: "仅译文模式"},
        {value: 1, label: "双语对照模式"},
    ],
    // 双语翻译的 15 种模式：默认、加粗、实线下划线、虚线下划线、弱化、透明、阴影、学习效果、马克笔、引用、高亮、背景色、斜体、边框、文字阴影
    styles: [
        // 基础样式
        {value: "basic", label: "基础样式", disabled: true},
        {value: 0, label: "朴素模式", class: "fluent-display-default", group: "basic"},
        {value: 1, label: "加粗显示", class: "fluent-display-bold", group: "basic"},
        {value: 2, label: "优雅斜体", class: "fluent-display-italic", group: "basic"},
        {value: 3, label: "立体阴影", class: "fluent-display-text-shadow", group: "basic"},
        
        // 下划线系列
        {value: "underline", label: "下划线系列", disabled: true},
        {value: 4, label: "蓝色实线", class: "fluent-display-solid-underline", group: "underline"},
        {value: 5, label: "优雅虚线", class: "fluent-display-dot-underline", group: "underline"},
        {value: 6, label: "活泼波浪", class: "fluent-display-wavy", group: "underline"},
        
        // 卡片系列
        {value: "card", label: "卡片系列", disabled: true},
        {value: 7, label: "简约卡片", class: "fluent-display-card-mode", group: "card"},
        {value: 8, label: "渐变卡片", class: "fluent-display-modern-card", group: "card"},
        {value: 9, label: "纸张卡片", class: "fluent-display-paper", group: "card"},
        
        // 高亮系列
        {value: "highlight", label: "高亮系列", disabled: true},
        {value: 10, label: "学习标记", class: "fluent-display-learning-mode", group: "highlight"},
        {value: 11, label: "荧光标记", class: "fluent-display-marker", group: "highlight"},
        {value: 12, label: "柔和渐变", class: "fluent-display-highlight-fade", group: "highlight"},
        
        // 背景色系列
        {value: "background", label: "背景色系列", disabled: true},
        {value: 13, label: "温暖黄底", class: "fluent-display-lightyellow"},
        {value: 14, label: "清新蓝底", class: "fluent-display-lightblue"},
        {value: 15, label: "素雅灰底", class: "fluent-display-lightgray"},
        
        // 特殊效果
        {value: "special", label: "特殊效果", disabled: true},
        {value: 16, label: "典雅引用", class: "fluent-display-quote"},
        {value: 17, label: "轻巧边框", class: "fluent-display-border"},
        {value: 18, label: "阅读焦点", class: "fluent-display-focus"},
        {value: 19, label: "简约底线", class: "fluent-display-clean"},
        
        // 专业样式
        {value: "pro", label: "专业样式", disabled: true},
        {value: 20, label: "代码风格", class: "fluent-display-tech"},
        {value: 21, label: "书籍风格", class: "fluent-display-elegant"},
        
        // 透明度
        {value: "transparent", label: "透明效果", disabled: true},
        {value: 22, label: "半透明弱化", class: "fluent-display-dimmed"},
        {value: 23, label: "轻透明感", class: "fluent-display-transparent-mode"},
    ],
    theme: [
        {value: "auto", label: "跟随操作系统"},
        {value: "light", label: "亮色主题"},
        {value: "dark", label: "暗色主题"},
    ],
};

export const defaultOption = {
    on: true,
    from: "auto",
    to: "zh-Hans",
    style: 1,
    display: 1,
    hotkey: "Control",
    service: services.microsoft,
    custom: "http://localhost:11434/v1/chat/completions",
    system_role:
        "You are a professional, authentic machine translation engine. You only return the translated text, without any explanations.",
    user_role: `Translate the following text into {{to}}, If translation is unnecessary (e.g. proper nouns, codes, etc.), return the original text. NO explanations. NO notes:

{{origin}}`,
    count: 0,
};

