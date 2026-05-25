import {customModelString, defaultOption, services} from "./option";
import {config} from "@/entrypoints/utils/config";

const BATCH_SYSTEM_ROLE = `You are a professional, authentic translation engine. You receive a JSON array of texts from a single document. Translate ALL texts into the specified language, leveraging the full context across the entire array for consistent terminology, tone, and high-quality translations. You MUST respond with ONLY a raw JSON array of the EXACT same length and order — each element is the translation of the corresponding input element. No markdown code fences, no explanations, no notes.`;

function isBatchOrigin(origin: string): boolean {
    if (!origin.startsWith('[') || !origin.endsWith(']')) return false;
    try {
        const parsed = JSON.parse(origin);
        return Array.isArray(parsed) && parsed.length > 1 && parsed.every(item => typeof item === 'string');
    } catch {
        return false;
    }
}

function batchUserContent(origin: string): string {
    return `Translate into ${config.to}:\n\n${origin}`;
}

function resolveModel(): string {
    let model = config.model[config.service] === customModelString ? config.customModel[config.service] : config.model[config.service];
    return model.replace(/（.*）/g, "");
}

export function commonMsgTemplate(origin: string) {
    if (isBatchOrigin(origin)) {
        return JSON.stringify({
            'model': resolveModel(),
            "temperature": 1.0,
            'messages': [
                {'role': 'system', 'content': BATCH_SYSTEM_ROLE},
                {'role': 'user', 'content': batchUserContent(origin)},
            ]
        });
    }

    let model = resolveModel();
    let system = config.system_role[config.service] || defaultOption.system_role;
    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', origin);

    return JSON.stringify({
        'model': model,
        "temperature": 1.0,
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': user},
        ]
    })
}

export function deepseekMsgTemplate(origin: string) {
    if (isBatchOrigin(origin)) {
        const payload: any = {
            'model': resolveModel(),
            'messages': [
                {'role': 'system', 'content': BATCH_SYSTEM_ROLE},
                {'role': 'user', 'content': batchUserContent(origin)},
            ]
        };
        if (resolveModel() !== 'deepseek-reasoner') {
            payload.temperature = 0.7;
        }
        return JSON.stringify(payload);
    }

    let model = resolveModel();
    let system = config.system_role[config.service] || defaultOption.system_role;
    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', origin);

    const payload: any = {
        'model': model,
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': user},
        ]
    };

    if (model !== 'deepseek-reasoner') {
        payload.temperature = 0.7;
    }

    return JSON.stringify(payload);
}

export function geminiMsgTemplate(origin: string) {
    if (isBatchOrigin(origin)) {
        return JSON.stringify({
            "contents": [
                {"role": "user", "parts": [{"text": BATCH_SYSTEM_ROLE + "\n\n" + batchUserContent(origin)}]},
            ]
        });
    }

    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', origin);

    return JSON.stringify({
        "contents": [
            {"role": "user", "parts": [{"text": user}]},
        ]
    })
}

export function claudeMsgTemplate(origin: string) {
    let model = config.model[services.claude];
    if (model === "claude-3-5-haiku") model = "claude-3-5-haiku-20241022";
    else if (model === "claude-3-5-sonnet") model = "claude-3-5-sonnet-20241022";
    else if (model === "claude-3-opus") model = "claude-3-opus-20240229";

    if (isBatchOrigin(origin)) {
        return JSON.stringify({
            model: model,
            max_tokens: 4096,
            stream: false,
            system: BATCH_SYSTEM_ROLE,
            messages: [
                {role: "user", content: batchUserContent(origin)},
            ]
        });
    }

    let system = config.system_role[config.service] || defaultOption.system_role;
    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', origin);

    return JSON.stringify({
        model: model,
        max_tokens: 4096,
        stream: false,
        system: system,
        messages: [
            {role: "user", content: user},
        ]
    })
}

export function tongyiMsgTemplate(origin: string) {
    let model = config.model[config.service] === customModelString ? config.customModel[config.service] : config.model[config.service]

    if (model.startsWith("qwen-mt")) {
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
        return JSON.stringify({
            "model": model,
            "messages": [
                {"role": "user", "content": origin},
            ],
            "translation_options": {
                "source_lang": "auto",
                "target_lang": targetLang
            }
        })
    }

    if (isBatchOrigin(origin)) {
        return JSON.stringify({
            "model": model,
            "enable_thinking": false,
            "messages": [
                {"role": "system", "content": BATCH_SYSTEM_ROLE},
                {"role": "user", "content": batchUserContent(origin)},
            ]
        });
    }

    let system = config.system_role[config.service] || defaultOption.system_role;
    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', origin);

    return JSON.stringify({
        "model": model,
        "enable_thinking": false,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
    })
}

export function yiyanMsgTemplate(origin: string) {
    if (isBatchOrigin(origin)) {
        return JSON.stringify({
            'temperature': 0.7,
            'disable_search': true,
            'messages': [
                {"role": "user", "content": BATCH_SYSTEM_ROLE + "\n\n" + batchUserContent(origin)},
            ],
        });
    }

    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', origin);

    return JSON.stringify({
        'temperature': 0.7,
        'disable_search': true,
        'messages': [
            {"role": "user", "content": user},
        ],
    })
}

export function minimaxTemplate(origin: string) {
    if (isBatchOrigin(origin)) {
        return JSON.stringify({
            model: "MiniMax-Text-01",
            stream: false,
            temperature: 0.7,
            messages: [
                {role: 'system', content: BATCH_SYSTEM_ROLE},
                {role: 'user', content: batchUserContent(origin)},
            ]
        });
    }

    let system = config.system_role[config.service] || defaultOption.system_role;
    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', origin);

    return JSON.stringify({
        model: "MiniMax-Text-01",
        stream: false,
        temperature: 0.7,
        messages: [
            {role: 'system', content: system},
            {role: 'user', content: user},
        ]
    })
}

export function cozeTemplate(origin: string) {
    if (isBatchOrigin(origin)) {
        return JSON.stringify({
            bot_id: config.robot_id[config.service],
            user: "FluentRead",
            query: BATCH_SYSTEM_ROLE + "\n\n" + batchUserContent(origin),
            stream: false
        });
    }

    let system = config.system_role[config.service] || defaultOption.system_role;
    let user = (config.user_role[config.service] || defaultOption.user_role)
        .replace('{{to}}', config.to).replace('{{origin}}', origin);

    return JSON.stringify({
        bot_id: config.robot_id[config.service],
        user: "FluentRead",
        query: system + user,
        stream: false
    });
}
