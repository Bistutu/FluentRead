// 消息模板工具
import {Config} from "./model";
import {customModelString, defaultOption, services} from "./option";

// openai 格式的消息模板（通用）
export function commonMsgTemplate(config: Config, origin: string) {
    // 检测是否使用自定义模型
    let model = config.model[config.service] === customModelString ? config.customModel[config.service] : config.model[config.service]

    let system = config.system_role[config.service] || defaultOption.system_role;
    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', 'hello');

    return JSON.stringify({
        'model': model,
        "temperature": 0.3,
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': user},
            {'role': "assistant", 'content': '你好'},
            {'role': 'user', 'content': origin}
        ]
    })
}

// gemini
export function geminiMsgTemplate(config: Config, origin: string) {
    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', 'hello');

    return JSON.stringify({
        "contents": [
            {"role": "user", "parts": [{"text": user}]},
            {"role": "model", "parts": [{"text": "你好"}]},
            {"role": "user", "parts": [{"text": origin}]}]
    })
}

// claude
export function claudeMsgTemplate(config: Config, origin: string) {
    let model = config.model[services.claude];
    if (model === "Haiku") model = "claude-3-haiku-20240307";
    else if (model === "Sonnet") model = "claude-3-sonnet-20240229";
    else if (model === "Opus") model = "claude-3-opus-20240229";

    let system = config.system_role[config.service] || defaultOption.system_role;
    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', 'hello');

    return JSON.stringify({
        model: model,
        max_tokens: 4096,
        stream: false,
        system: system,
        messages: [
            {role: "user", content: user},
            {role: "assistant", content: "你好"},
            {role: "user", content: origin}
        ]
    })
}

// 通义千问
export function tongyiMsgTemplate(config: Config, origin: string) {
    let model = config.model[config.service] === customModelString ? config.customModel[config.service] : config.model[config.service]

    let system = config.system_role[config.service] || defaultOption.system_role;
    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', 'hello');

    return JSON.stringify({
        "model": model,
        "input": {
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
                {"role": "assistant", "content": "你好"},
                {"role": "user", "content": origin}
            ]
        },
        "parameters": {}
    })
}

// 文心一言
export function yiyanMsgTemplate(config: Config, origin: string) {
    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', 'hello');

    return JSON.stringify({
        'temperature': 0.3, // 随机度
        'disable_search': true, // 禁用搜索
        'messages': [
            {"role": "user", "content": user},
            {"role": "assistant", "content": "你好"},
            {"role": "user", "content": origin}
        ],
    })
}

export function minimaxTemplate(config: Config, origin: string) {

    let system = config.system_role[config.service] || defaultOption.system_role;
    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', 'hello');

    return JSON.stringify({
        model: "abab6.5-chat",
        stream: false,
        temperature: 0.3,
        messages: [
            {role: 'system', content: system},
            {role: 'user', content: user},
            {role: 'assistant', content: '你好'},
            {role: 'user', content: origin}
        ]
    })
}
