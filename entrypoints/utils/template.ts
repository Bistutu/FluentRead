// 消息模板工具
import {currentModelIds, customModelString, defaultOption, services} from "./option";
import {config} from "@/entrypoints/utils/config";
import {mergeCustomBody} from "./custom-body";
import {migrateModelIdentifier} from "./model";

export {mergeCustomBody};

// 读取当前服务的自定义请求体（JSON 字符串）
function currentCustomBody(): string | undefined {
    return config.customBody?.[config.service];
}

function currentConfiguredModel(service: string): string {
    const selectedModel = config.model[service];
    if (selectedModel === customModelString) {
        return config.customModel[service] || '';
    }
    return migrateModelIdentifier(service, selectedModel || '');
}

// openai 格式的消息模板（通用模板）
export function commonMsgTemplate(origin: string) {
    let model = currentConfiguredModel(config.service);

    // 删除模型名称中的中文括号及其内容，如"gpt-4（推荐）" -> "gpt-4"
    model = model.replace(/（.*）/g, "");

    let system = config.system_role[config.service] || defaultOption.system_role;
    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', origin);

    const payload: any = {
        'model': model,
        "temperature": 1.0,
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': user},
        ]
    };

    return JSON.stringify(mergeCustomBody(payload, currentCustomBody()))
}

// deepseek
export function getCurrentModel(): string {
    const selectedModel = currentConfiguredModel(config.service);
    const normalizedModel = (selectedModel || '').replace(/（.*）/g, "");

    // 运行时兜底：后台脚本若早于配置迁移读取到旧值，仍使用可用的 V4 模型。
    if (normalizedModel === 'deepseek-chat' || normalizedModel === 'deepseek-reasoner') {
        return currentModelIds.deepseek;
    }

    return normalizedModel;
}

function getDeepSeekThinkingMode(): 'enabled' | 'disabled' {
    const selectedModel = config.model[config.service];
    if (selectedModel === 'deepseek-reasoner') return 'enabled';
    if (selectedModel === 'deepseek-chat') return 'disabled';
    return config.deepseekThinkingMode === 'enabled' ? 'enabled' : 'disabled';
}

function deepseekPrompt(origin: string) {
    return {
        system: config.system_role[config.service] || defaultOption.system_role,
        user: (config.user_role[config.service] || defaultOption.user_role)
            .replace('{{to}}', config.to)
            .replace('{{origin}}', origin),
    };
}

// Responses API 格式供明确支持该协议的端点使用。
export function deepseekResponsesMsgTemplate(origin: string) {
    const model = getCurrentModel();
    const {system, user} = deepseekPrompt(origin);
    const payload: any = {
        model,
        instructions: system,
        input: user,
    };

    if (getDeepSeekThinkingMode() === 'disabled') {
        payload.temperature = 0.7;
    }

    return JSON.stringify(payload);
}

// DeepSeek 官方 V4 Chat Completion 格式。
export function deepseekMsgTemplate(origin: string) {
    const model = getCurrentModel();
    const {system, user} = deepseekPrompt(origin);
    const thinking = getDeepSeekThinkingMode();
    const payload: any = {
        model,
        messages: [
            {role: 'system', content: system},
            {role: 'user', content: user},
        ],
        thinking: {type: thinking},
    };

    if (thinking === 'disabled') {
        payload.temperature = 0.7;
    }

    return JSON.stringify(mergeCustomBody(payload, currentCustomBody()));
}

// gemini
export function geminiMsgTemplate(origin: string) {
    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', origin);

    const payload: any = {
        "contents": [
            {"role": "user", "parts": [{"text": user}]},
        ]
    };

    return JSON.stringify(mergeCustomBody(payload, currentCustomBody()))
}

// claude
export function claudeMsgTemplate(origin: string) {
    const model = currentConfiguredModel(services.claude);

    let system = config.system_role[config.service] || defaultOption.system_role;
    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', origin);

    const payload: any = {
        model: model,
        max_tokens: 4096,
        stream: false,
        system: system,
        messages: [
            {role: "user", content: user},
        ]
    };

    return JSON.stringify(mergeCustomBody(payload, currentCustomBody()))
}

// 通义千问
export function tongyiMsgTemplate(origin: string) {
    const model = currentConfiguredModel(config.service);
    const normalTemplate = () => {
        let system = config.system_role[config.service] || defaultOption.system_role;
        let user = (config.user_role[config.service] || defaultOption.user_role)
            .replace('{{to}}', config.to).replace('{{origin}}', origin);

        const payload: any = {
            "model": model,
            "enable_thinking": false,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ]
        };
        return JSON.stringify(mergeCustomBody(payload, currentCustomBody()))
    }
    // 翻译模型qwen-mt-plus和qwen-mt-turbo的格式和通用的不同
    const mtModelTemplate = () => {
        const langMap = [
            {value: "zh-Hans", target: "zh"},
            {value: "en"},
            {value: "ja"},
            {value: "ko"},
            {value: "fr"},
            {value: "ru"},
        ]
        let targetItem = langMap.find(i => i.value === config.to) || langMap[0]
        let targetLang = targetItem.target || targetItem.value
        const payload: any = {
            "model": model,
            "messages": [
                {"role": "user", "content": origin},
            ],
            "translation_options": {
                "source_lang": "auto",
                "target_lang": targetLang
            }
        };
        return JSON.stringify(mergeCustomBody(payload, currentCustomBody()))
    }
    return model.startsWith("qwen-mt") ? mtModelTemplate() : normalTemplate()

}

export function cozeTemplate(origin: string) {

    let system = config.system_role[config.service] || defaultOption.system_role;
    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', origin);

    const payload: any = {
        bot_id: config.robot_id[config.service],
        user: "FluentRead",
        query: system + user,
        stream: false
    };

    return JSON.stringify(mergeCustomBody(payload, currentCustomBody()));
}
