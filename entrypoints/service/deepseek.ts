import { method, urls } from "../utils/constant";
import { deepseekMsgTemplate } from "../utils/template";
import { config } from "@/entrypoints/utils/config";
import { contentPostHandler } from "@/entrypoints/utils/check";

async function deepseek(message: any) {
    try {
        console.log('deepseek:', message);
        console.log('deepseek config:', config);
        console.log('是否右键翻译:', message.isContextMenu);

        const headers = new Headers({
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.token[message.service || config.service]}`
        });

        const url = config.proxy[message.service || config.service] || urls[message.service || config.service];
        const { template, trainingData } = deepseekMsgTemplate(message.origin, message.isContextMenu);

        const resp = await fetch(url, {
            method: method.POST,
            headers,
            body: template
        });

        if (!resp.ok) {
            throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
        }

        const result = await resp.json();
        console.log('deepseek result:', result);
        
        // 将训练数据作为附加信息返回
        const translatedText = result.choices[0].message.content;
        return {
            text: contentPostHandler(translatedText),
            trainingData: {
                ...trainingData,
                output: translatedText
            }
        };
    } catch (error) {
        console.error('API调用失败:', error);
        throw error;
    }
}

export default deepseek;