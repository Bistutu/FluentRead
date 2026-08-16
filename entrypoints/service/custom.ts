import {commonMsgTemplate} from "../utils/template";
import {method} from "../utils/constant";
import {services} from "@/entrypoints/utils/option";
import {config} from "@/entrypoints/utils/config";
import {contentPostHandler} from "@/entrypoints/utils/check";
import {appendOptionalBearer} from './auth';

async function custom(message: any) {

    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    appendOptionalBearer(headers, config.token[services.custom]);

    const resp = await fetch(config.custom, {
        method: method.POST,
        headers: headers,
        body: commonMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt)
    });

    if (resp.ok) {
        let result = await resp.json();
        return  contentPostHandler(result.choices[0].message.content);
    } else {
        console.log("翻译失败：", resp);
        throw new Error(`翻译失败: ${resp.status} ${resp.statusText} body: ${await resp.text()}`);
    }
}

export default custom;
