import {getMimoEndpoint, method, MINIMAX_ENDPOINTS, urls} from "../utils/constant";
import {commonMsgTemplate} from "../utils/template";
import {config} from "@/entrypoints/utils/config";
import {contentPostHandler} from "@/entrypoints/utils/check";
import { services } from "../utils/option";
import { appendOptionalBearer } from './auth';
import {formatServiceError} from '@/entrypoints/utils/serviceError';

async function common(message: any) {
    try {
        const service = message.serviceOverride || config.service;

        const headers = new Headers({'Content-Type': 'application/json'});
        appendOptionalBearer(headers, config.token[service]);

        if(service === services.openrouter){
            headers.append('HTTP-Referer', 'https://fluent.thinkstu.com');
            headers.append('X-Title', 'FluentRead');
        }
                
        const url = config.proxy[service]
            || (service === services.minimax
                ? MINIMAX_ENDPOINTS[
                    config.minimaxBillingPlan === 'token-plan' ? 'token-plan' : 'payg'
                ][config.minimaxRegion === 'cn' ? 'cn' : 'global']
                : service === services.mimo
                    ? getMimoEndpoint(config.mimoBillingPlan, config.mimoRegion)
                : urls[service]);

        const resp = await fetch(url, {
            method: method.POST,
            headers,
            body: commonMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.modelOverride)
        });

        if (!resp.ok) {
            throw new Error(formatServiceError(
                service,
                `翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`,
            ));
        }

        const result = await resp.json();
        return contentPostHandler(result.choices[0].message.content);
    } catch (error) {
        console.error('API调用失败:', error);
        throw error;
    }
}

export default common;
