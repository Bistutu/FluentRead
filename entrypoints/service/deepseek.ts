import { method, urls } from "../utils/constant";
import { deepseekMsgTemplate, deepseekResponsesMsgTemplate, getCurrentModel } from "../utils/template";
import { config } from "@/entrypoints/utils/config";
import { contentPostHandler } from "@/entrypoints/utils/check";

// deepseek-v4-* 系列模型走官方的 Responses API（POST /responses）
// 其他模型（含自定义模型）走 OpenAI 兼容的 chat completions 接口
// API 格式由设置中的 deepseekApiType 控制：'responses' 强制 Responses API，'chat' 强制 Chat Completion，'auto' 按模型支持情况自动选择
function useResponsesApi(model: string) {
    const apiType = config.deepseekApiType;
    if (apiType === 'responses') return true;
    if (apiType === 'chat') return false;
    // auto: v4-flash 官方原生支持 Responses API；v4-pro 支持尚在灰度，走 chat completions 最稳
    return model === 'deepseek-v4-flash';
}

async function deepseek(message: any) {
    try {
        const headers = new Headers({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.token[config.service]}`
        });

        const model = getCurrentModel();
        const endpoint = config.proxy[config.service] || urls[config.service];

        // 去掉可能存在的 /chat/completions 后缀得到 base URL，再按所选 API 格式拼接端点。
        // 这样无论配置的是完整端点（.../chat/completions）还是 base URL（.../v1），
        // payload 与端点都由同一个 isResponses 决定，不会出现格式错配。
        const isResponses = useResponsesApi(model);
        // 去掉 /chat/completions 后缀和多余的尾斜杠，得到干净的 base URL
        const baseUrl = endpoint.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');
        const url = isResponses ? `${baseUrl}/responses` : `${baseUrl}/chat/completions`;

        const resp = await fetch(url, {
            method: method.POST,
            headers,
            body: isResponses
                ? deepseekResponsesMsgTemplate(message.origin)
                : deepseekMsgTemplate(message.origin)
        });

        if (!resp.ok) {
            throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
        }

        const result = await resp.json();

        // Responses API: output 数组中的 message 类型内容；chat completions: choices[0].message.content
        if (isResponses) {
            if (typeof result.output_text === 'string' && result.output_text) {
                return contentPostHandler(result.output_text);
            }
            const output = result.output || [];
            const text = output
                .filter((item: any) => item.type === 'message' && item.content)
                .flatMap((item: any) => item.content)
                .filter((part: any) => part.type === 'output_text')
                .map((part: any) => part.text)
                .join('');
            if (text) {
                return contentPostHandler(text);
            }
            throw new Error('翻译失败: 上游未返回内容');
        }

        if (result.choices && result.choices.length > 0) {
            return contentPostHandler(result.choices[0].message.content);
        }
        throw new Error('翻译失败: 上游未返回内容');
    } catch (error) {
        console.error('API调用失败:', error);
        throw error;
    }
}

export default deepseek;
