import {method, urls} from "../utils/constant";
import {commonMsgTemplate} from "../utils/template";
import {config} from "@/entrypoints/utils/config";
import {contentPostHandler} from "@/entrypoints/utils/check";

async function azureOpenai(message: any) {
    try {
        // 验证必要的配置
        const apiKey = config.token[config.service];
        if (!apiKey || apiKey.trim() === '') {
            throw new Error('Azure OpenAI API Key 未配置，请在设置中输入有效的 API Key');
        }

        const endpoint = config.azureOpenaiEndpoint;
        if (!endpoint || endpoint.trim() === '') {
            throw new Error('Azure OpenAI 端点地址未配置，请在设置中输入完整的端点地址');
        }

        // 验证端点地址格式
        if (!endpoint.includes('openai.azure.com') || !endpoint.includes('/chat/completions')) {
            throw new Error('Azure OpenAI 端点地址格式不正确，请确保包含正确的域名和路径');
        }

        const headers = new Headers({
            'Content-Type': 'application/json',
            'api-key': apiKey
        });
                
        const resp = await fetch(endpoint, {
            method: method.POST,
            headers,
            body: commonMsgTemplate(message.origin)
        });

        if (!resp.ok) {
            const errorText = await resp.text();
            let errorMessage = `Azure OpenAI API 调用失败: ${resp.status} ${resp.statusText}`;
            
            // 根据状态码提供更具体的错误信息
            switch (resp.status) {
                case 401:
                    errorMessage = 'API Key 无效或已过期，请检查您的 Azure OpenAI API Key';
                    break;
                case 404:
                    errorMessage = '端点地址不存在，请检查资源名称和部署名称是否正确';
                    break;
                case 429:
                    errorMessage = 'API 调用频率超限，请稍后重试或检查配额设置';
                    break;
                case 500:
                    errorMessage = 'Azure OpenAI 服务内部错误，请稍后重试';
                    break;
                default:
                    errorMessage += `\n详细信息: ${errorText}`;
            }
            
            throw new Error(errorMessage);
        }

        const result = await resp.json();
        
        if (!result.choices || !result.choices[0] || !result.choices[0].message) {
            throw new Error('Azure OpenAI 返回数据格式异常，请检查模型配置');
        }
        
        return contentPostHandler(result.choices[0].message.content);
    } catch (error) {
        console.error('Azure OpenAI API调用失败:', error);
        throw error;
    }
}

export default azureOpenai;
